import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from deeptutor.services.calendar.models import EventInput
from deeptutor.services.calendar.store import CalendarStore
from scripts.migration.sqlite_to_postgres.migrate import migrate_calendar_db


@pytest.mark.asyncio
async def test_calendar_import_is_idempotent_and_rejects_divergence(tmp_path):
    import os

    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL required")
    source = tmp_path / "calendar.sqlite"
    local = CalendarStore(source)
    event = local.create(EventInput(
        title="Reading", start="2026-11-06T08:00:00Z",
        end="2026-11-06T09:00:00Z", tzid="UTC",
    ))["event"]
    owner = "calendar_" + uuid.uuid4().hex[:12]
    engine = create_async_engine(url)
    try:
        assert (await migrate_calendar_db(source, owner, False))["calendar_events"] == 1
        await migrate_calendar_db(source, owner, True)
        await migrate_calendar_db(source, owner, True)
        async with engine.connect() as db:
            row = (await db.execute(text("""
                SELECT revision,state_json FROM calendar_states WHERE owner_user_id=:owner
            """), {"owner": owner})).one()
            assert row.revision == 1
            assert len(row.state_json["events"]) == 1
        local.delete(event.id)
        with pytest.raises(RuntimeError, match="reconcile"):
            await migrate_calendar_db(source, owner, True)
    finally:
        async with engine.begin() as db:
            await db.execute(text("DELETE FROM migration_batches WHERE owner_user_id=:owner"), {"owner": owner})
            await db.execute(text("DELETE FROM calendar_states WHERE owner_user_id=:owner"), {"owner": owner})
            await db.execute(text("DELETE FROM subscriptions WHERE owner_user_id=:owner"), {"owner": owner})
            await db.execute(text("DELETE FROM users WHERE id=:owner"), {"owner": owner})
        await engine.dispose()
