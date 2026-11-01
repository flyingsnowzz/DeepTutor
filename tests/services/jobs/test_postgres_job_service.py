import asyncio
import os
import uuid

import pytest

from deeptutor.services.jobs.runner import CapabilityRunResult
from deeptutor.services.jobs.postgres import PostgresJobService
from deeptutor.services.storage.object_store import InMemoryObjectStore

pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set")


class StaticRunner:
    async def run(self, *, capability: str, payload: dict):
        mermaid = "flowchart LR\nA-->B"
        return CapabilityRunResult(
            result={"render_type": "mermaid"},
            artifacts=[{
                "key_suffix": "diagram.mmd",
                "data": mermaid.encode(),
                "kind": "visualization_source",
                "mime_type": "text/vnd.mermaid",
                "filename": "diagram.mmd",
            }] if capability == "visualize" else [],
            usage={"provider": "test", "model": "fake", "prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
        )


class SlowRunner:
    async def run(self, *, capability: str, payload: dict):
        await asyncio.sleep(2)
        return CapabilityRunResult(result={"ok": True}, artifacts=[], usage={})


async def _wait(service, job_id, owner):
    for _ in range(100):
        job = await service.get(job_id=job_id, owner_user_id=owner)
        if job.status in {"succeeded", "failed", "canceled"}:
            return job
        await asyncio.sleep(0.02)
    raise AssertionError("job did not terminate")


@pytest.mark.asyncio
async def test_postgres_job_idempotency_owner_isolation_artifact_and_usage():
    owner_a = f"user-a-{uuid.uuid4().hex[:8]}"
    owner_b = f"user-b-{uuid.uuid4().hex[:8]}"
    service = PostgresJobService(
        os.environ["DATABASE_URL"],
        object_store=InMemoryObjectStore(),
        runner=StaticRunner(),
    )
    try:
        first = await service.submit(
            owner_user_id=owner_a,
            capability="visualize",
            payload={"prompt": "draw"},
            idempotency_key="same-key",
        )
        second = await service.submit(
            owner_user_id=owner_a,
            capability="visualize",
            payload={"prompt": "different"},
            idempotency_key="same-key",
        )
        assert first.id == second.id
        job = await _wait(service, first.id, owner_a)
        assert job.status == "succeeded"
        assert job.artifacts
        url = await service.artifact_url(artifact_ref=job.artifacts[0].id, owner_user_id=owner_a)
        assert url.startswith("memory://")

        with pytest.raises(Exception):
            await service.get(job_id=job.id, owner_user_id=owner_b)
        with pytest.raises(Exception):
            await service.artifact_url(artifact_ref=job.artifacts[0].id, owner_user_id=owner_b)
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_postgres_job_cancel():
    owner = f"user-cancel-{uuid.uuid4().hex[:8]}"
    service = PostgresJobService(os.environ["DATABASE_URL"], runner=SlowRunner())
    try:
        job = await service.submit(owner_user_id=owner, capability="deep_research", payload={"prompt": "slow"})
        await asyncio.sleep(0.05)
        canceled = await service.cancel(job_id=job.id, owner_user_id=owner)
        assert canceled.status == "canceled"
    finally:
        await service.close()
