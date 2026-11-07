from __future__ import annotations

import pytest
from sqlalchemy import text

from deeptutor.services.session.postgres_store import PostgresSessionStore


@pytest.mark.asyncio
async def test_postgres_session_workspace_move_is_owned_and_preserves_messages(
    two_owners, engine
):
    owner_a, owner_b = two_owners
    repo = PostgresSessionStore(engine)
    session_id = await repo.create_session(owner_a, "Move me")
    async with engine.begin() as db:
        await db.execute(text("SELECT set_config('app.user_id', :owner, true)"), {"owner": owner_a})
        await db.execute(text("""
            INSERT INTO messages (owner_user_id,session_id,role,content)
            VALUES (:owner,:session,'user','Hello')
        """), {"owner": owner_a, "session": session_id})
    with pytest.raises(ValueError, match="not found"):
        await repo.move_session_workspace(owner_b, session_id, "course-b")
    with pytest.raises(ValueError, match="this workspace"):
        await repo.move_session_workspace(
            owner_a, session_id, "course-b", source_workspace_id="course-a")
    moved = await repo.move_session_workspace(owner_a, session_id, "course-b")
    assert moved["preferences"]["workspace_id"] == "course-b"
    assert (await repo.list_sessions(owner_a, workspace_id="course-b"))[0]["id"] == session_id
    assert await repo.list_sessions(owner_a, workspace_id="") == []
    messages = await repo.get_messages(owner_a, session_id)
    assert messages[0]["content"] == "Hello"
    async with engine.begin() as db:
        await db.execute(text("SELECT set_config('app.user_id', :owner, true)"), {"owner": owner_a})
        await db.execute(text("""
            UPDATE messages SET attachments_json=CAST('[{"id":"a"}]' AS JSONB)
            WHERE session_id=:session AND owner_user_id=:owner
        """), {"session": session_id, "owner": owner_a})
    with pytest.raises(ValueError, match="attachments"):
        await repo.move_session_workspace(owner_a, session_id, "course-c")
