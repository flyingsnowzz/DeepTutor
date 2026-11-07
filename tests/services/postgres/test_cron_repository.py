import asyncio
from dataclasses import asdict
import uuid

import pytest

from deeptutor.services.cron.repository import PostgresCronRepository
from deeptutor.services.cron.service import CronService, CronOwner, CronSchedule, _now_ms


def test_postgres_cron_owner_revision_and_restart(database_url, monkeypatch):
    import psycopg

    monkeypatch.setenv("DATABASE_URL", database_url)
    url = database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(url) as db:
        before = db.execute("SELECT revision FROM scheduled_jobs_meta WHERE id=1").fetchone()[0]
    repo = PostgresCronRepository()
    first = CronService(repository=repo)
    owner = "cron_" + uuid.uuid4().hex[:12]
    job = first.add_job(
        name="Review", message="Review algebra",
        schedule=CronSchedule(kind="every", every_seconds=60),
        owner=CronOwner(kind="chat", user_id=owner, is_admin=False, session_id="s"),
    )
    try:
        restarted = CronService(repository=PostgresCronRepository())
        assert restarted.get_job(job.id).message == "Review algebra"
        assert restarted.list_jobs(f"chat:{owner}")[0].id == job.id
        assert restarted.list_jobs("chat:another") == []
        assert not restarted.cancel_job(job.id, owner_key="chat:another")
        assert restarted.cancel_job(job.id, owner_key=f"chat:{owner}")
        assert first.get_job(job.id) is None
    finally:
        with psycopg.connect(url) as db:
            db.execute("DELETE FROM scheduled_jobs WHERE id=%s", (job.id,))
            db.execute("UPDATE scheduled_jobs_meta SET revision=%s WHERE id=1", (before,))


def test_cron_factory_selects_postgres(database_url, monkeypatch):
    from deeptutor.services.cron import service as cron_service

    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setattr(cron_service, "_service", None)
    try:
        assert isinstance(cron_service.get_cron_service().repository, PostgresCronRepository)
        assert cron_service.get_cron_service().store_path is None
    finally:
        monkeypatch.setattr(cron_service, "_service", None)


@pytest.mark.asyncio
async def test_overdue_postgres_one_shot_runs_after_restart(database_url, monkeypatch):
    import psycopg

    monkeypatch.setenv("DATABASE_URL", database_url)
    url = database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(url) as db:
        before = db.execute("SELECT revision FROM scheduled_jobs_meta WHERE id=1").fetchone()[0]
    first = CronService(repository=PostgresCronRepository())
    job = first.add_job(
        name="Overdue reminder", message="Review algebra",
        schedule=CronSchedule(kind="at", at_ms=_now_ms() + 60_000),
        owner=CronOwner(kind="chat", user_id="cron_" + uuid.uuid4().hex[:12],
                        is_admin=False, session_id="s"),
    )
    job.state.next_run_at_ms = _now_ms() - 1_000
    first.repository.upsert(asdict(job))
    fired = asyncio.Event()
    observed = []

    async def deliver(due):
        observed.append(due.id)
        fired.set()
        return "ok", None

    restarted = CronService(repository=PostgresCronRepository(), on_job=deliver)
    try:
        await restarted.start()
        await asyncio.wait_for(fired.wait(), timeout=2)
        assert observed == [job.id]
        for _ in range(100):
            if restarted.get_job(job.id) is None:
                break
            await asyncio.sleep(0.01)
        assert restarted.get_job(job.id) is None
        assert CronService(repository=PostgresCronRepository()).get_job(job.id) is None
    finally:
        await restarted.stop()
        with psycopg.connect(url) as db:
            db.execute("DELETE FROM scheduled_jobs WHERE id=%s", (job.id,))
            db.execute("UPDATE scheduled_jobs_meta SET revision=%s WHERE id=1", (before,))
