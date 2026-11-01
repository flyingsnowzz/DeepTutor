"""The new SaaS/MCP platform path must not create business SQLite files.

Regression guard for T2: with DATABASE_URL set and an isolated
DEEPTUTOR_HOME, exercising accounts/sessions/practice/mastery repositories
and a full MCP job lifecycle must not produce any ``*.sqlite*`` file.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set")


async def _wait(service, job_id, owner):
    for _ in range(100):
        job = await service.get(job_id=job_id, owner_user_id=owner)
        if job.status in {"succeeded", "failed", "canceled"}:
            return job
        await asyncio.sleep(0.02)
    raise AssertionError("job did not terminate")


def _sqlite_files(root: Path) -> set[str]:
    if not root.exists():
        return set()
    return {str(p) for p in root.rglob("*") if p.is_file() and p.suffix.startswith(".sqlite")}


@pytest.mark.asyncio
async def test_platform_path_writes_only_postgres(tmp_path, monkeypatch):
    monkeypatch.setenv("DEEPTUTOR_HOME", str(tmp_path))

    from deeptutor.services.jobs.runner import DeterministicCapabilityRunner
    from deeptutor.services.platform import build_platform_services
    from deeptutor.services.storage.object_store import InMemoryObjectStore

    platform = build_platform_services(
        object_store=InMemoryObjectStore(),
        runner=DeterministicCapabilityRunner(),
    )
    owner = f"nosqlite_{uuid.uuid4().hex[:10]}"
    try:
        before = _sqlite_files(tmp_path)

        # Account + all first-party repositories.
        await platform.accounts.ensure_user(owner, display_name="No SQLite")
        session_id = await platform.sessions.create_session(owner, title="t")
        await platform.sessions.get_session(owner, session_id)
        await platform.practice.add_entry(owner, {"question": "1+1", "question_id": "q1"})
        path_id = await platform.mastery.create_path(owner, {"topic": "算术"})
        await platform.mastery.append_event(owner, path_id, "path_started", {})

        # MCP job lifecycle incl. artifact metadata + usage.
        job = await platform.jobs.submit(
            owner_user_id=owner,
            capability="visualize",
            payload={"prompt": "学习闭环"},
            idempotency_key=f"k-{uuid.uuid4().hex[:8]}",
        )
        done = await _wait(platform.jobs, job.id, owner)
        assert done.status == "succeeded" and done.artifacts
        await platform.jobs.artifact_url(artifact_ref=done.artifacts[0].id, owner_user_id=owner)

        after = _sqlite_files(tmp_path)
        assert after == before, f"platform path created SQLite files: {sorted(after - before)}"
    finally:
        from sqlalchemy import text

        async with platform.engine.begin() as db:
            for stmt in (
                "DELETE FROM usage_events WHERE owner_user_id=:o",
                "DELETE FROM artifacts WHERE owner_user_id=:o",
                "DELETE FROM jobs WHERE owner_user_id=:o",
                "DELETE FROM mastery_events WHERE owner_user_id=:o",
                "DELETE FROM mastery_interactions WHERE owner_user_id=:o",
                "DELETE FROM practice_entries WHERE owner_user_id=:o",
                "DELETE FROM mastery_paths WHERE owner_user_id=:o",
                "DELETE FROM turns WHERE owner_user_id=:o",
                "DELETE FROM sessions WHERE owner_user_id=:o",
                "DELETE FROM subscriptions WHERE owner_user_id=:o",
                "DELETE FROM users WHERE id=:o",
            ):
                await db.execute(text(stmt), {"o": owner})
        await platform.close()
