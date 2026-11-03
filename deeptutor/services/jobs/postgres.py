"""Postgres-backed Job service for T1."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from ..storage.object_store import InMemoryObjectStore, ObjectStore
from .artifacts import validate_artifact
from .models import ArtifactRecord, JobRecord
from .runner import CapabilityRunner, DeterministicCapabilityRunner
from .service import JobConflictError, JobNotFoundError


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


class PostgresJobService:
    """Single-worker async job service backed by Postgres.

    T1 runs one MCP process, so jobs can be executed by local asyncio tasks while
    durable state lives in Postgres. T2 adds multi-worker claiming and HTTP auth.
    """

    def __init__(
        self,
        database_url: str | None = None,
        *,
        engine: AsyncEngine | None = None,
        object_store: ObjectStore | None = None,
        runner: CapabilityRunner | None = None,
        terminal_listener=None,
    ):
        # Called once after a job reaches a terminal state: (job, outcome|None,
        # error|None). Used by the cloud service for idempotent quota metering;
        # listener errors never change the persisted job state.
        self._terminal_listener = terminal_listener
        if engine is not None:
            self._engine = engine
            self._owns_engine = False
        else:
            url = database_url or os.environ.get("DATABASE_URL")
            if not url:
                raise RuntimeError("DATABASE_URL is required for PostgresJobService")
            self._engine = create_async_engine(url, future=True, pool_pre_ping=True)
            self._owns_engine = True
        self._session = async_sessionmaker(
            self._engine, expire_on_commit=False, class_=AsyncSession
        )
        self.object_store = object_store or InMemoryObjectStore()
        self.runner = runner or DeterministicCapabilityRunner()
        self._tasks: dict[str, asyncio.Task] = {}

    async def _ensure_owner(self, db: AsyncSession, owner_user_id: str) -> None:
        """Bootstrap the platform account so job FKs always resolve.

        MCP stdio (T1) uses a single local owner; HTTP auth in T3 will provision
        the same users/auth_identities rows at login time.
        """
        await db.execute(
            text(
                """INSERT INTO users (id, display_name) VALUES (:id, :name)
                   ON CONFLICT (id) DO NOTHING"""
            ),
            {"id": owner_user_id, "name": owner_user_id},
        )
        await db.execute(
            text(
                """INSERT INTO subscriptions (owner_user_id, plan, status)
                   VALUES (:id, 'free', 'active') ON CONFLICT (owner_user_id) DO NOTHING"""
            ),
            {"id": owner_user_id},
        )

    async def submit(
        self,
        *,
        owner_user_id: str,
        capability: str,
        payload: dict[str, Any],
        idempotency_key: str | None = None,
        source_channel: str = "first_party",
    ) -> JobRecord:
        async with self._session() as db:
            await self._ensure_owner(db, owner_user_id)
            if idempotency_key:
                row = (
                    await db.execute(
                        text(
                            "SELECT id FROM jobs WHERE owner_user_id=:owner AND idempotency_key=:key"
                        ),
                        {"owner": owner_user_id, "key": idempotency_key},
                    )
                ).scalar_one_or_none()
                if row:
                    return await self._get_owned(row, owner_user_id)

            job_id = new_id("job")
            session_id = new_id("sess")
            await db.execute(
                text(
                    """INSERT INTO jobs
                    (id, owner_user_id, session_id, capability, idempotency_key,
                     status, input_json, source_channel, started_at, created_at, updated_at)
                    VALUES
                    (:id,:owner,:session_id,:capability,:idem,
                     'running',:input,:channel,now(),now(),now())"""
                ),
                {
                    "id": job_id,
                    "owner": owner_user_id,
                    "session_id": session_id,
                    "capability": capability,
                    "channel": source_channel[:48],
                    "idem": idempotency_key,
                    "input": json.dumps(payload, ensure_ascii=False),
                },
            )
            await db.commit()

        job = JobRecord(
            id=job_id,
            owner_user_id=owner_user_id,
            session_id=session_id,
            capability=capability,
            input=payload,
            idempotency_key=idempotency_key,
            status="running",
        )
        self._tasks[job_id] = asyncio.create_task(self._run(job_id, owner_user_id))
        return job

    async def _run(self, job_id: str, owner_user_id: str) -> None:
        job = await self._get_owned(job_id, owner_user_id)
        terminal_outcome = None
        terminal_error = None
        try:
            outcome = await self.runner.run(
                capability=job.capability,
                payload={**job.input, "owner_user_id": job.owner_user_id},
            )
            artifacts: list[ArtifactRecord] = []
            for item in outcome.artifacts:
                data = item["data"]
                validate_artifact(mime_type=item["mime_type"], size_bytes=len(data))
                key = item.get("key") or f"{owner_user_id}/{job_id}/{item['key_suffix']}"
                stored = await self.object_store.put(key, data, item["mime_type"])
                artifact = ArtifactRecord(
                    id=new_id("art"),
                    owner_user_id=owner_user_id,
                    job_id=job_id,
                    key=stored.key,
                    bucket=stored.bucket,
                    kind=item["kind"],
                    mime_type=item["mime_type"],
                    filename=item["filename"],
                    size=stored.size,
                )
                artifacts.append(artifact)
                async with self._session() as db:
                    await db.execute(
                        text(
                            """INSERT INTO artifacts
                            (id, owner_user_id, job_id, object_key, bucket, kind, mime_type,
                             filename, size_bytes, created_at)
                            VALUES (:id,:owner,:job,:key,:bucket,:kind,:mime,:filename,:size,now())"""
                        ),
                        {
                            "id": artifact.id,
                            "owner": owner_user_id,
                            "job": job_id,
                            "key": artifact.key,
                            "bucket": artifact.bucket,
                            "kind": artifact.kind,
                            "mime": artifact.mime_type,
                            "filename": artifact.filename,
                            "size": artifact.size,
                        },
                    )
                    await db.commit()

            usage = outcome.usage or {}
            async with self._session() as db:
                await db.execute(
                    text(
                        """UPDATE jobs SET status='succeeded', result_json=:result,
                           updated_at=now(), finished_at=now() WHERE id=:id AND owner_user_id=:owner"""
                    ),
                    {
                        "id": job_id,
                        "owner": owner_user_id,
                        "result": json.dumps(outcome.result, ensure_ascii=False),
                    },
                )
                if usage:
                    await db.execute(
                        text(
                            """INSERT INTO usage_events
                            (owner_user_id, job_id, capability, provider, model,
                             prompt_tokens, completion_tokens, total_tokens, cost_usd, created_at)
                            VALUES (:owner,:job,:capability,:provider,:model,:prompt,:completion,:total,:cost,now())"""
                        ),
                        {
                            "owner": owner_user_id,
                            "job": job_id,
                            "capability": job.capability,
                            "provider": usage.get("provider"),
                            "model": usage.get("model"),
                            "prompt": int(usage.get("prompt_tokens", 0) or 0),
                            "completion": int(usage.get("completion_tokens", 0) or 0),
                            "total": int(usage.get("total_tokens", 0) or 0),
                            "cost": float(usage.get("total_cost_usd", 0) or 0),
                        },
                    )
                await db.commit()
                terminal_outcome = outcome
        except asyncio.CancelledError:
            await self._set_terminal(
                job_id,
                owner_user_id,
                "canceled",
                {"code": "JOB_CANCELED", "message": "Job canceled", "retryable": False},
            )
            terminal_error = {"code": "JOB_CANCELED", "message": "Job canceled"}
            raise
        except Exception as exc:  # noqa: BLE001
            terminal_error = {"code": "JOB_FAILED", "message": str(exc), "retryable": False}
            await self._set_terminal(job_id, owner_user_id, "failed", terminal_error)
        finally:
            self._tasks.pop(job_id, None)
            if self._terminal_listener is not None:
                try:
                    final_job = await self._get_owned(job_id, owner_user_id)
                    await self._terminal_listener(final_job, terminal_outcome, terminal_error)
                except Exception:  # noqa: BLE001
                    pass

    async def _set_terminal(self, job_id: str, owner: str, status: str, error: dict) -> None:
        async with self._session() as db:
            await db.execute(
                text(
                    """UPDATE jobs SET status=:status, error_json=:error, updated_at=now(),
                       finished_at=now()
                       WHERE id=:id AND owner_user_id=:owner
                         AND status NOT IN ('succeeded', 'failed', 'canceled')"""
                ),
                {"status": status, "error": json.dumps(error), "id": job_id, "owner": owner},
            )
            await db.commit()

    async def _row_to_job(self, row, artifacts: list[ArtifactRecord] | None = None) -> JobRecord:
        return JobRecord(
            id=row["id"],
            owner_user_id=row["owner_user_id"],
            session_id=row["session_id"],
            capability=row["capability"],
            input=row["input_json"],
            status=row["status"],
            idempotency_key=row["idempotency_key"],
            result=row["result_json"],
            error=row["error_json"],
            artifacts=artifacts or [],
            created_at=row["created_at"].timestamp(),
            updated_at=row["updated_at"].timestamp(),
            started_at=row["started_at"].timestamp() if row["started_at"] else None,
            finished_at=row["finished_at"].timestamp() if row["finished_at"] else None,
        )

    async def _get_owned(self, job_id: str, owner_user_id: str) -> JobRecord:
        async with self._session() as db:
            row = (
                (
                    await db.execute(
                        text("SELECT * FROM jobs WHERE id=:id AND owner_user_id=:owner"),
                        {"id": job_id, "owner": owner_user_id},
                    )
                )
                .mappings()
                .first()
            )
            if not row:
                raise JobNotFoundError(job_id)
            artifact_rows = (
                (
                    await db.execute(
                        text(
                            "SELECT * FROM artifacts WHERE owner_user_id=:owner AND job_id=:job ORDER BY created_at"
                        ),
                        {"owner": owner_user_id, "job": job_id},
                    )
                )
                .mappings()
                .all()
            )
            artifacts = [
                ArtifactRecord(
                    id=r["id"],
                    owner_user_id=r["owner_user_id"],
                    job_id=r["job_id"],
                    key=r["object_key"],
                    bucket=r["bucket"],
                    kind=r["kind"],
                    mime_type=r["mime_type"],
                    filename=r["filename"],
                    size=r["size_bytes"],
                    created_at=r["created_at"].timestamp(),
                )
                for r in artifact_rows
            ]
            return await self._row_to_job(row, artifacts)

    async def get(
        self, *, job_id: str, owner_user_id: str, include_events: bool = False
    ) -> JobRecord:
        return await self._get_owned(job_id, owner_user_id)

    async def cancel(
        self, *, job_id: str, owner_user_id: str, reason: str | None = None
    ) -> JobRecord:
        task = self._tasks.get(job_id)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await self._set_terminal(
            job_id,
            owner_user_id,
            "canceled",
            {"code": "JOB_CANCELED", "message": reason or "Canceled", "retryable": False},
        )
        return await self._get_owned(job_id, owner_user_id)

    async def reply(self, *, job_id: str, owner_user_id: str, reply: dict[str, Any]) -> JobRecord:
        job = await self._get_owned(job_id, owner_user_id)
        if job.status != "needs_input":
            raise JobConflictError(f"Job {job_id} is not waiting for input")
        payload = {**job.input, "replies": [*job.input.get("replies", []), reply]}
        async with self._session() as db:
            await db.execute(
                text(
                    """UPDATE jobs SET status='running', input_json=:input, error_json=NULL,
                       updated_at=now() WHERE id=:id AND owner_user_id=:owner"""
                ),
                {
                    "input": json.dumps(payload, ensure_ascii=False),
                    "id": job_id,
                    "owner": owner_user_id,
                },
            )
            await db.commit()
        self._tasks[job_id] = asyncio.create_task(self._run(job_id, owner_user_id))
        return await self._get_owned(job_id, owner_user_id)

    async def get_artifact(self, *, artifact_ref: str, owner_user_id: str) -> ArtifactRecord:
        async with self._session() as db:
            row = (
                (
                    await db.execute(
                        text("SELECT * FROM artifacts WHERE id=:id AND owner_user_id=:owner"),
                        {"id": artifact_ref, "owner": owner_user_id},
                    )
                )
                .mappings()
                .first()
            )
            if not row:
                raise JobNotFoundError(artifact_ref)
            return ArtifactRecord(
                id=row["id"],
                owner_user_id=row["owner_user_id"],
                job_id=row["job_id"],
                key=row["object_key"],
                bucket=row["bucket"],
                kind=row["kind"],
                mime_type=row["mime_type"],
                filename=row["filename"],
                size=row["size_bytes"],
                created_at=row["created_at"].timestamp(),
            )

    async def artifact_url(self, *, artifact_ref: str, owner_user_id: str) -> str:
        artifact = await self.get_artifact(artifact_ref=artifact_ref, owner_user_id=owner_user_id)
        return await self.object_store.presign_get(artifact.key, 900)

    async def close(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        await asyncio.gather(*self._tasks.values(), return_exceptions=True)
        if self._owns_engine:
            await self._engine.dispose()
