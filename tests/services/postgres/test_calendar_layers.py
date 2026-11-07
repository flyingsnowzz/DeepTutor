from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import text

from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.services.calendar.layers import read_layers
from deeptutor.services.session.postgres_store import PostgresSessionStore


@pytest.mark.asyncio
async def test_postgres_calendar_layers_owner_and_workspace(
    two_owners, engine, database_url, monkeypatch, tmp_path
):
    owner_a, owner_b = two_owners
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setattr("deeptutor.modules.catalog.module_enabled", lambda _: True)
    sessions = PostgresSessionStore(engine)
    session_id = await sessions.create_session(owner_a, "Calculus")
    now = datetime.now(timezone.utc)
    async with engine.begin() as db:
        await db.execute(text("SELECT set_config('app.user_id', :owner, true)"), {"owner": owner_a})
        await db.execute(text("""
            UPDATE sessions SET preferences_json=CAST(:prefs AS JSONB)
            WHERE id=:session AND owner_user_id=:owner
        """), {"prefs": '{"workspace_id":"course-a"}',
               "session": session_id, "owner": owner_a})
        await db.execute(text("""
            INSERT INTO messages (owner_user_id,session_id,role,content,created_at)
            VALUES (:owner,:session,'user','Study',:created)
        """), {"owner": owner_a, "session": session_id, "created": now})
    await sessions.notebook.upsert_entries(owner_a, session_id, [{
        "question_id": "q1", "question": "2 + 2?", "is_correct": False,
    }])
    start = now - timedelta(hours=1)
    end = now + timedelta(days=2)

    async def layers(owner: str, workspace: str):
        token = set_current_user(CurrentUser(
            id=owner, username=owner, role="user",
            scope=UserScope(kind="user", user_id=owner, root=Path(tmp_path) / owner),
        ))
        try:
            return await asyncio.to_thread(read_layers, workspace, start, end, "UTC")
        finally:
            reset_current_user(token)

    result = await layers(owner_a, "course-a")
    assert sum(day.practice for day in result.reviews) == 1
    assert sum(day.session_count for day in result.footprints) == 1
    assert result.footprints[0].sessions[0].id == session_id
    assert (await layers(owner_a, "course-b")).footprints == []
    assert (await layers(owner_b, "course-a")).footprints == []
