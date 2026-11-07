from pathlib import Path
import os
import uuid

import psycopg

from deeptutor.multi_user import audit
from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope


def test_postgres_audit_persists_admin_and_usage_without_local_jsonl(database_url, monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setattr(audit, "SYSTEM_ROOT", tmp_path)
    actor = "audit_" + uuid.uuid4().hex
    url = database_url.replace("postgresql+asyncpg://", "postgresql://", 1)

    token = set_current_user(CurrentUser(
        id=actor, username="root", role="admin",
        scope=UserScope(kind="admin", user_id=actor, root=Path(tmp_path) / "admin"),
    ))
    try:
        audit.log_admin_action("user_create", target_user_id="learner", summary={"source": "csv"})
    finally:
        reset_current_user(token)
    token = set_current_user(CurrentUser(
        id=actor, username="learner", role="user",
        scope=UserScope(kind="user", user_id=actor, root=Path(tmp_path) / "user"),
    ))
    try:
        audit.log_usage("book", "book-1", "read")
    finally:
        reset_current_user(token)

    with psycopg.connect(url) as db:
        rows = db.execute(
            "SELECT kind,action,payload_json FROM account_audit_events WHERE actor_id=%s ORDER BY id",
            (actor,),
        ).fetchall()
    cleanup_url = os.environ.get("TEST_DATABASE_ADMIN_URL")
    if cleanup_url:
        with psycopg.connect(cleanup_url.replace("postgresql+asyncpg://", "postgresql://", 1)) as db:
            db.execute("DELETE FROM account_audit_events WHERE actor_id=%s", (actor,))
    assert [(row[0], row[1]) for row in rows] == [("admin", "user_create"), ("usage", "read")]
    assert rows[0][2]["target_user_id"] == "learner"
    assert not (tmp_path / "audit/usage.jsonl").exists()
