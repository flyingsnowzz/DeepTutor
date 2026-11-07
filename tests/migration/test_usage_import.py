import json
import sqlite3
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from scripts.migration.sqlite_to_postgres.migrate import migrate_usage_db


@pytest.mark.asyncio
async def test_usage_import_is_owned_and_idempotent(tmp_path, monkeypatch):
    import os

    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL required")
    source = tmp_path / "usage.sqlite3"
    with sqlite3.connect(source) as db:
        db.execute("""CREATE TABLE llm_calls (
            call_id TEXT PRIMARY KEY, started_at REAL NOT NULL,
            session_id TEXT NOT NULL, turn_id TEXT NOT NULL, source TEXT NOT NULL,
            usage_json TEXT NOT NULL)""")
        db.execute("INSERT INTO llm_calls VALUES (?,?,?,?,?,?)", (
            "legacy-call", 123.5, "s", "t", "chat",
            json.dumps({"call_id": "legacy-call", "estimated": False, "total_tokens": 5}),
        ))
    owner = "usage_" + uuid.uuid4().hex[:12]
    other = "usage_" + uuid.uuid4().hex[:12]
    assert await migrate_usage_db(source, owner, False) == {"llm_call_ledger": 1}
    engine = create_async_engine(url)
    try:
        for _ in range(2):
            assert await migrate_usage_db(source, owner, True) == {"llm_call_ledger": 1}
        async with engine.connect() as db:
            rows = (await db.execute(text("""
                SELECT owner_user_id,started_at,usage_json FROM llm_call_ledger
                WHERE call_id='legacy-call' AND owner_user_id=:owner
            """), {"owner": owner})).all()
            assert len(rows) == 1
            assert rows[0].started_at == 123.5
            assert rows[0].usage_json["total_tokens"] == 5
            assert (await db.execute(text("""
                SELECT count(*) FROM llm_call_ledger WHERE owner_user_id=:owner
            """), {"owner": other})).scalar_one() == 0
    finally:
        async with engine.begin() as db:
            await db.execute(text("DELETE FROM migration_batches WHERE owner_user_id=:owner"), {"owner": owner})
            await db.execute(text("DELETE FROM llm_call_ledger WHERE owner_user_id=:owner"), {"owner": owner})
            await db.execute(text("DELETE FROM subscriptions WHERE owner_user_id=:owner"), {"owner": owner})
            await db.execute(text("DELETE FROM users WHERE id=:owner"), {"owner": owner})
        await engine.dispose()
