import asyncio

import pytest

from deeptutor.services.jobs.service import InMemoryJobService


async def wait_terminal(service, job_id, owner="user-a"):
    for _ in range(50):
        job = await service.get(job_id=job_id, owner_user_id=owner)
        if job.status in {"succeeded", "failed", "canceled"}:
            return job
        await asyncio.sleep(0.01)
    raise AssertionError("job did not reach terminal state")


@pytest.mark.asyncio
async def test_idempotent_submit_returns_same_job():
    service = InMemoryJobService()
    first = await service.submit(
        owner_user_id="user-a",
        capability="visualize",
        payload={"prompt": "draw learning loop"},
        idempotency_key="same-key",
    )
    second = await service.submit(
        owner_user_id="user-a",
        capability="visualize",
        payload={"prompt": "different request"},
        idempotency_key="same-key",
    )
    assert first.id == second.id


@pytest.mark.asyncio
async def test_owner_cannot_read_other_users_job():
    service = InMemoryJobService()
    job = await service.submit(
        owner_user_id="user-a",
        capability="visualize",
        payload={"prompt": "draw"},
    )
    with pytest.raises(Exception):
        await service.get(job_id=job.id, owner_user_id="user-b")


@pytest.mark.asyncio
async def test_visualize_job_creates_artifact_and_presigned_url():
    service = InMemoryJobService()
    job = await service.submit(
        owner_user_id="user-a",
        capability="visualize",
        payload={"prompt": "draw learning loop"},
    )
    job = await wait_terminal(service, job.id)
    assert job.status == "succeeded"
    assert job.artifacts
    artifact = job.artifacts[0]
    url = await service.artifact_url(artifact_ref=artifact.id, owner_user_id="user-a")
    assert url.startswith("memory://")
