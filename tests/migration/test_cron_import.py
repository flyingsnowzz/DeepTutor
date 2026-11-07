import os
import uuid

import pytest

from deeptutor.services.cron.repository import SQLiteCronRepository
from scripts.migration.sqlite_to_postgres.migrate import migrate_cron_db


@pytest.mark.asyncio
async def test_cron_import_preserves_owner_and_revision(tmp_path):
    import psycopg

    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL required")
    sync_url = url.replace("postgresql+asyncpg://", "postgresql://", 1)
    source = tmp_path / "jobs.sqlite3"
    local = SQLiteCronRepository(source)
    job_id = "import_" + uuid.uuid4().hex[:12]
    local.upsert({"id": job_id, "owner": {"kind": "chat", "user_id": "alice"},
                  "state": {"next_run_at_ms": 123}, "message": "Remember"})
    with psycopg.connect(sync_url) as db:
        before = db.execute("SELECT revision FROM scheduled_jobs_meta WHERE id=1").fetchone()[0]
        prior_jobs = db.execute("SELECT count(*) FROM scheduled_jobs").fetchone()[0]
    if prior_jobs or before:
        pytest.skip("Shared cron target is not empty")
    try:
        assert await migrate_cron_db(source, False) == {"scheduled_jobs": 1, "revision": 1}
        await migrate_cron_db(source, True)
        await migrate_cron_db(source, True)
        with psycopg.connect(sync_url) as db:
            row = db.execute("SELECT owner_key,payload_json FROM scheduled_jobs WHERE id=%s",
                             (job_id,)).fetchone()
            assert row[0] == "chat:alice" and row[1]["message"] == "Remember"
        local.upsert({"id": job_id, "owner": {"kind": "chat", "user_id": "alice"},
                      "state": {"next_run_at_ms": 456}, "message": "Changed"})
        with pytest.raises(RuntimeError, match="reconcile"):
            await migrate_cron_db(source, True)
    finally:
        with psycopg.connect(sync_url) as db:
            db.execute("DELETE FROM scheduled_jobs WHERE id=%s", (job_id,))
            db.execute("UPDATE scheduled_jobs_meta SET revision=%s WHERE id=1", (before,))
