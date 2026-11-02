from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text

from deeptutor.services.accounts.service import AccountService
from deeptutor.services.hooks.service import HookError, HookService, ReviewTaskService
from deeptutor.services.postgres.database import create_engine

pytestmark = pytest.mark.skipif(
    os.environ.get("DATABASE_URL") is None, reason="DATABASE_URL not set"
)


@pytest_asyncio.fixture
async def owner():
    engine = create_engine(os.environ["DATABASE_URL"])
    uid = f"hook_{uuid.uuid4().hex[:10]}"
    await AccountService(engine).ensure_user(uid)
    try:
        yield uid, engine
    finally:
        async with engine.begin() as db:
            for table in ("hook_deliveries", "review_tasks"):
                await db.execute(text(f"DELETE FROM {table} WHERE owner_user_id=:o"), {"o": uid})
            await db.execute(text("DELETE FROM subscriptions WHERE owner_user_id=:o"), {"o": uid})
            await db.execute(text("DELETE FROM users WHERE id=:o"), {"o": uid})
        await engine.dispose()


@pytest.mark.asyncio
async def test_hook_idempotent_creates_one_review_task(owner):
    uid, engine = owner
    hooks = HookService(engine)
    reviews = ReviewTaskService(engine)
    key = f"wb:job_completed:{uuid.uuid4().hex[:12]}"

    first = await hooks.deliver(
        uid,
        event_type="job_completed",
        idempotency_key=key,
        channel="workbuddy",
        source_ref="job_123",
    )
    assert first["replayed"] is False and first["status"] == "processed"
    assert len(first["review_tasks"]) == 1

    second = await hooks.deliver(
        uid,
        event_type="job_completed",
        idempotency_key=key,
        channel="workbuddy",
        source_ref="job_123",
    )
    assert second["replayed"] is True
    assert len(second["review_tasks"]) == 1
    assert second["review_tasks"][0]["review_task_id"] == first["review_tasks"][0]["review_task_id"]

    due = await reviews.list_due(uid)
    assert len(due) == 1 and due[0]["kind"] == "quiz"
    assert due[0]["source_type"] == "hook"


@pytest.mark.asyncio
async def test_non_review_event_creates_no_task(owner):
    uid, engine = owner
    hooks = HookService(engine)
    result = await hooks.deliver(
        uid,
        event_type="session_opened",
        idempotency_key=f"wb:session:{uuid.uuid4().hex[:12]}",
    )
    assert result["review_tasks"] == []


@pytest.mark.asyncio
async def test_validation_and_complete(owner):
    uid, engine = owner
    hooks = HookService(engine)
    with pytest.raises(HookError):
        await hooks.deliver(uid, event_type="job_completed", idempotency_key="")
    result = await hooks.deliver(
        uid,
        event_type="material_finished",
        idempotency_key=f"mat:{uuid.uuid4().hex[:12]}",
    )
    task_id = result["review_tasks"][0]["review_task_id"]
    done = await ReviewTaskService(engine).complete(uid, task_id, result={"score": 1})
    assert done["status"] == "completed"
    again = await ReviewTaskService(engine).complete(uid, task_id)
    assert again is None
