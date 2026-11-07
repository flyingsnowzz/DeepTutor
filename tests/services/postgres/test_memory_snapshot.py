"""Memory snapshots use the authenticated PostgreSQL owner in PG mode."""

from __future__ import annotations

import json
import uuid

import psycopg
import pytest

from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser
from deeptutor.multi_user.paths import scope_for_user
from deeptutor.services.memory.snapshot import adapters


@pytest.mark.asyncio
async def test_chat_and_quiz_snapshots_are_owner_scoped(two_owners, database_url, monkeypatch):
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    owner_a, owner_b = two_owners
    sid_a, sid_b = f"snap-{uuid.uuid4().hex}", f"snap-{uuid.uuid4().hex}"
    message_a, message_b = [uuid.uuid4().int % 10**15 for _ in range(2)]
    runtime_url = database_url.replace(
        "postgresql+asyncpg://", "postgresql://", 1
    )

    for owner, sid, message_id, title in (
        (owner_a, sid_a, message_a, "Alice chat"),
        (owner_b, sid_b, message_b, "Bob chat"),
    ):
        with psycopg.connect(runtime_url) as db:
            db.execute("SELECT set_config('app.user_id', %s, true)", (owner,))
            db.execute(
                "INSERT INTO sessions(id,owner_user_id,title,preferences_json) "
                "VALUES (%s,%s,%s,%s::jsonb)",
                (sid, owner, title, json.dumps({"workspace_id": "custom"})),
            )
            db.execute(
                "INSERT INTO messages(id,owner_user_id,session_id,role,content) "
                "VALUES (%s,%s,%s,'user',%s)",
                (message_id, owner, sid, f"{title} body"),
            )
            db.execute(
                "INSERT INTO assessment_cards"
                "(owner_user_id,session_id,origin_type,origin_ref,question_id,card_json) "
                "VALUES (%s,%s,'snapshot-test',%s,'q1',%s::jsonb)",
                (owner, sid, sid, json.dumps({
                    "question": f"{title} question", "user_answer": "yes",
                    "correct_answer": "yes", "is_correct": True,
                })),
            )
            db.commit()

    def snapshot(owner: str):
        token = set_current_user(CurrentUser(
            id=owner, username=owner, role="user",
            scope=scope_for_user(owner, is_admin=False),
        ))
        try:
            return (
                adapters.read_chat_entities(),
                adapters.probe_chat_entities(),
                adapters.read_quiz_entities(),
            )
        finally:
            reset_current_user(token)

    try:
        for owner, own_sid, other_sid, title in (
            (owner_a, sid_a, sid_b, "Alice chat"),
            (owner_b, sid_b, sid_a, "Bob chat"),
        ):
            chats, probes, quizzes = snapshot(owner)
            assert [item.id for item in chats] == [f"ws:custom:{own_sid}"]
            assert [item.id for item in probes] == [f"ws:custom:{own_sid}"]
            assert chats[0].fingerprint == probes[0].fingerprint
            assert f"{title} body" in chats[0].content
            assert other_sid not in chats[0].content
            assert [item.id for item in quizzes] == [f"ws:custom:{own_sid}:q1"]
            assert f"{title} question" in quizzes[0].content
    finally:
        for owner, sid in ((owner_a, sid_a), (owner_b, sid_b)):
            with psycopg.connect(runtime_url) as db:
                db.execute("SELECT set_config('app.user_id', %s, true)", (owner,))
                db.execute("DELETE FROM assessment_cards WHERE session_id=%s", (sid,))
                db.execute("DELETE FROM messages WHERE session_id=%s", (sid,))
                db.execute("DELETE FROM sessions WHERE id=%s", (sid,))
                db.commit()


def test_postgres_snapshot_read_failure_does_not_report_deleted_entities(monkeypatch):
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")

    def unavailable():
        raise ConnectionError("database unavailable")

    monkeypatch.setattr(adapters, "_read_postgres_chat_entities", unavailable)
    monkeypatch.setattr(adapters, "_probe_postgres_chat_entities", unavailable)
    monkeypatch.setattr(adapters, "_read_postgres_quiz_entities", unavailable)
    for surface in ("chat", "quiz"):
        with pytest.raises(ConnectionError, match="database unavailable"):
            adapters.read_entities(surface)
    with pytest.raises(ConnectionError, match="database unavailable"):
        adapters.read_stamps("chat")
