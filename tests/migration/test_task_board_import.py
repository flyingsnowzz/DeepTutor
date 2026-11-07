import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from deeptutor.services.task_board import CreateCard, TaskBoardStore
from scripts.migration.sqlite_to_postgres.migrate import migrate_task_board_db


@pytest.mark.asyncio
async def test_task_board_import_preserves_snapshot_and_refuses_divergence(tmp_path, monkeypatch):
    import os

    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL required")
    source = tmp_path / "tasks.sqlite"
    local = TaskBoardStore(source)
    local.create(CreateCard(title="Read", due_date="2026-11-06"), "course-a")
    owner = "board_" + uuid.uuid4().hex[:12]
    engine = create_async_engine(url)
    try:
        assert (await migrate_task_board_db(source, owner, False))["task_cards"] == 1
        await migrate_task_board_db(source, owner, True)
        await migrate_task_board_db(source, owner, True)
        async with engine.connect() as db:
            row = (await db.execute(text("""
                SELECT board_json,revision FROM task_boards WHERE owner_user_id=:owner
            """), {"owner": owner})).one()
            assert row.revision == 1
            assert row.board_json["cards"][0]["title"] == "Read"
        local.create(CreateCard(title="Write"), "course-a")
        with pytest.raises(RuntimeError, match="reconcile"):
            await migrate_task_board_db(source, owner, True)
    finally:
        async with engine.begin() as db:
            await db.execute(text("DELETE FROM migration_batches WHERE owner_user_id=:owner"), {"owner": owner})
            await db.execute(text("DELETE FROM task_boards WHERE owner_user_id=:owner"), {"owner": owner})
            await db.execute(text("DELETE FROM subscriptions WHERE owner_user_id=:owner"), {"owner": owner})
            await db.execute(text("DELETE FROM users WHERE id=:owner"), {"owner": owner})
        await engine.dispose()
