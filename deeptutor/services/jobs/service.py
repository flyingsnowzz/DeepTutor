"""In-process Job service for T1.

The service owns asynchronous job lifecycle while remaining storage-agnostic.
T2 introduces the multi-worker production version; T1 tests use the deterministic
runner and the stdio server uses the real TurnCapabilityRunner by default.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from ..storage.object_store import InMemoryObjectStore, ObjectStore
from .models import TERMINAL_STATUSES, ArtifactRecord, JobRecord, new_id
from .runner import CapabilityRunner, DeterministicCapabilityRunner


class JobConflictError(Exception):
    pass


class JobNotFoundError(Exception):
    pass


class InMemoryJobService:
    def __init__(
        self,
        object_store: ObjectStore | None = None,
        runner: CapabilityRunner | None = None,
    ):
        self._jobs: dict[str, JobRecord] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._idempotency: dict[tuple[str, str], str] = {}
        self._artifacts: dict[str, ArtifactRecord] = {}
        self.object_store = object_store or InMemoryObjectStore()
        self.runner = runner or DeterministicCapabilityRunner()

    async def submit(
        self,
        *,
        owner_user_id: str,
        capability: str,
        payload: dict[str, Any],
        idempotency_key: str | None = None,
    ) -> JobRecord:
        if idempotency_key:
            dedupe_key = (owner_user_id, idempotency_key)
            existing_id = self._idempotency.get(dedupe_key)
            if existing_id:
                return self._get_owned(existing_id, owner_user_id)

        job = JobRecord(
            id=new_id("job"),
            session_id=new_id("sess"),
            owner_user_id=owner_user_id,
            capability=capability,
            input=payload,
            idempotency_key=idempotency_key,
            status="queued",
        )
        self._jobs[job.id] = job
        if idempotency_key:
            self._idempotency[(owner_user_id, idempotency_key)] = job.id
        self._tasks[job.id] = asyncio.create_task(self._run(job))
        return job

    async def _run(self, job: JobRecord) -> None:
        job.status = "running"
        job.started_at = time.time()
        job.updated_at = job.started_at
        try:
            outcome = await self.runner.run(capability=job.capability, payload=job.input)
            for item in outcome.artifacts:
                data = item["data"]
                key = item.get("key") or f"{job.owner_user_id}/{job.id}/{item['key_suffix']}"
                stored = await self.object_store.put(key, data, item["mime_type"])
                artifact = ArtifactRecord(
                    id=new_id("art"),
                    owner_user_id=job.owner_user_id,
                    job_id=job.id,
                    key=stored.key,
                    bucket=stored.bucket,
                    kind=item["kind"],
                    mime_type=item["mime_type"],
                    filename=item["filename"],
                    size=stored.size,
                )
                job.artifacts.append(artifact)
                self._artifacts[artifact.id] = artifact
            job.result = outcome.result
            job.status = "succeeded"
        except asyncio.CancelledError:
            job.status = "canceled"
            job.error = {"code": "JOB_CANCELED", "message": "Job canceled", "retryable": False}
            raise
        except Exception as exc:  # noqa: BLE001 - mapped to stable job error
            job.status = "failed"
            job.error = {"code": "JOB_FAILED", "message": str(exc), "retryable": False}
        finally:
            job.updated_at = time.time()
            job.finished_at = job.updated_at
            self._tasks.pop(job.id, None)

    def _get_owned(self, job_id: str, owner_user_id: str) -> JobRecord:
        job = self._jobs.get(job_id)
        if job is None or job.owner_user_id != owner_user_id:
            raise JobNotFoundError(job_id)
        return job

    async def get(
        self, *, job_id: str, owner_user_id: str, include_events: bool = False
    ) -> JobRecord:
        return self._get_owned(job_id, owner_user_id)

    async def cancel(
        self, *, job_id: str, owner_user_id: str, reason: str | None = None
    ) -> JobRecord:
        job = self._get_owned(job_id, owner_user_id)
        if job.status not in TERMINAL_STATUSES:
            task = self._tasks.get(job_id)
            job.status = "canceled"
            job.error = {
                "code": "JOB_CANCELED",
                "message": reason or "Canceled",
                "retryable": False,
            }
            if task:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):  # noqa: BLE001
                    pass
        return job

    async def reply(self, *, job_id: str, owner_user_id: str, reply: dict[str, Any]) -> JobRecord:
        job = self._get_owned(job_id, owner_user_id)
        if job.status != "needs_input":
            raise JobConflictError(f"Job {job_id} is not waiting for input")
        job.input.setdefault("replies", []).append(reply)
        job.status = "queued"
        self._tasks[job.id] = asyncio.create_task(self._run(job))
        return job

    async def get_artifact(self, *, artifact_ref: str, owner_user_id: str) -> ArtifactRecord:
        artifact = self._artifacts.get(artifact_ref)
        if artifact is None or artifact.owner_user_id != owner_user_id:
            raise JobNotFoundError(artifact_ref)
        return artifact

    async def artifact_url(self, *, artifact_ref: str, owner_user_id: str) -> str:
        artifact = await self.get_artifact(artifact_ref=artifact_ref, owner_user_id=owner_user_id)
        return await self.object_store.presign_get(artifact.key, 900)
