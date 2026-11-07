"""Workspace discovery reports PostgreSQL conversations for the active owner."""

from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import text

from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.services.session.postgres_store import PostgresSessionStore
from deeptutor.services.workspace.data_migration import _feature_path, _selected_artifact_files, discover
from deeptutor.services.workspace.dependencies import dependency_closure
from deeptutor.services.path_service import get_path_service


def _bind(owner: str, root: Path):
    return set_current_user(CurrentUser(
        id=owner, username=owner, role="user",
        scope=UserScope(kind="user", user_id=owner, root=root / owner),
    ))


@pytest.mark.asyncio
async def test_discover_uses_owner_scoped_postgres_sessions(
    two_owners, engine, database_url, monkeypatch, tmp_path,
):
    owner_a, owner_b = two_owners
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)
    store = PostgresSessionStore(engine)
    session_a = await store.create_session(owner_a, "Alice only")
    session_b = await store.create_session(owner_b, "Bob only")
    try:
        for owner in (owner_a, owner_b):
            token = _bind(owner, tmp_path)
            try:
                result = discover()
                assert result["session_backend"] == "postgres"
                assert result["transfer_available"] is False
                assert result["features"][0]["sessions"] == 1
                assert not (tmp_path / owner / "user/chat_history.db").exists()
            finally:
                reset_current_user(token)
    finally:
        await store.delete_session(owner_a, session_a)
        await store.delete_session(owner_b, session_b)


@pytest.mark.asyncio
async def test_dependency_closure_reads_postgres_message_references(
    two_owners, engine, database_url, monkeypatch, tmp_path,
):
    owner_a, owner_b = two_owners
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)
    store = PostgresSessionStore(engine)
    source = await store.create_session(owner_a, "Source")
    referenced = await store.create_session(owner_a, "Referenced")
    foreign = await store.create_session(owner_b, "Foreign")
    try:
        async with engine.begin() as db:
            await db.execute(text("SELECT set_config('app.user_id', :owner, true)"), {"owner": owner_a})
            await db.execute(text("""INSERT INTO messages
                (owner_user_id,session_id,role,content,metadata_json)
                VALUES (:owner,:session,'user','question',CAST(:metadata AS JSONB))"""), {
                    "owner": owner_a, "session": source,
                    "metadata": '{"historyReferences": ["' + referenced + '", "' + foreign + '"]}',
                })
        token = _bind(owner_a, tmp_path)
        try:
            rows = [
                {"id": row["id"], "preferences_json": "{}"}
                for row in await store.list_sessions(owner_a)
            ]
            features, ids = dependency_closure(
                get_path_service(), rows, ["chat"], session_ids={source},
            )
            assert "chat" in features
            assert referenced in ids
            assert foreign not in ids
            assert not (tmp_path / owner_a / "user/chat_history.db").exists()
        finally:
            reset_current_user(token)
    finally:
        for owner, session in ((owner_a, source), (owner_a, referenced), (owner_b, foreign)):
            await store.delete_session(owner, session)


@pytest.mark.asyncio
async def test_dependency_closure_scopes_mastery_and_reading_to_workspace(
    two_owners, engine, database_url, monkeypatch, tmp_path,
):
    owner_a, owner_b = two_owners
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)
    store = PostgresSessionStore(engine)
    source = await store.create_session(owner_a, "Source")
    linked = await store.create_session(owner_a, "Linked")
    other = await store.create_session(owner_a, "Other workspace")
    foreign = await store.create_session(owner_b, "Foreign")
    path_a, path_other = f"path_{uuid4().hex}", f"path_{uuid4().hex}"
    try:
        async with engine.begin() as db:
            await db.execute(text("SELECT set_config('app.user_id', :owner, true)"), {"owner": owner_a})
            await db.execute(text("""UPDATE sessions SET preferences_json=CAST(:prefs AS JSONB)
                WHERE id=:session AND owner_user_id=:owner"""), {
                    "owner": owner_a, "session": other, "prefs": '{"workspace_id":"other"}',
                })
            for path_id, session_id in ((path_a, source), (path_other, other)):
                await db.execute(text("""INSERT INTO mastery_paths
                    (path_id,owner_user_id,state_json,owner_session_id)
                    VALUES (:path,:owner,CAST(:state AS JSONB),:session)"""), {
                        "path": path_id, "owner": owner_a,
                        "state": '{"book_id":"' + path_id + '"}', "session": session_id,
                })
                await db.execute(text("""INSERT INTO mastery_path_sessions
                    (owner_user_id,path_id,session_id) VALUES (:owner,:path,:session)"""), {
                        "owner": owner_a, "path": path_id, "session": session_id,
                    })
            await db.execute(text("""INSERT INTO mastery_topic_sources
                (source_id,path_id,owner_user_id,kind,external_id,label)
                VALUES (:id,:path,:owner,'chat',:session,'Linked chat')"""), {
                    "id": f"source_{uuid4().hex}", "path": path_a,
                    "owner": owner_a, "session": linked,
                })
            await db.execute(text("""INSERT INTO mastery_topic_sources
                (source_id,path_id,owner_user_id,kind,external_id,label)
                VALUES (:id,:path,:owner,'file','unrelated','Other file')"""), {
                    "id": f"source_{uuid4().hex}", "path": path_other, "owner": owner_a,
                })
            await db.execute(text("""INSERT INTO reading_catalog_states
                (owner_user_id,workspace_id,revision,state_json)
                VALUES (:owner,'',0,CAST(:state AS JSONB))"""), {
                    "owner": owner_a,
                    "state": '{"reading_workspace_sessions":[{"session_id":"' + source + '"},'
                             '{"session_id":"' + foreign + '"}]}',
                })
        token = _bind(owner_a, tmp_path)
        try:
            rows = [{"id": source, "preferences_json": "{}"},
                    {"id": linked, "preferences_json": "{}"}]
            features, ids = dependency_closure(get_path_service(), rows, ["learning", "reading"])
            assert {source, linked} <= ids
            assert other not in ids and foreign not in ids
            assert "files" not in features
            assert not (tmp_path / owner_a / "user/learning/mastery/mastery.sqlite3").exists()
        finally:
            reset_current_user(token)
    finally:
        async with engine.begin() as db:
            await db.execute(text("SELECT set_config('app.user_id', :owner, true)"), {"owner": owner_a})
            await db.execute(text("DELETE FROM mastery_paths WHERE owner_user_id=:owner AND path_id IN (:first,:second)"), {
                "owner": owner_a, "first": path_a, "second": path_other,
            })
            await db.execute(text("DELETE FROM reading_catalog_states WHERE owner_user_id=:owner AND workspace_id=''"), {"owner": owner_a})
        for owner, session in ((owner_a, source), (owner_a, linked),
                               (owner_a, other), (owner_b, foreign)):
            await store.delete_session(owner, session)


@pytest.mark.asyncio
async def test_artifact_selection_uses_postgres_turns_without_opening_legacy_sqlite(
    two_owners, engine, database_url, monkeypatch, tmp_path,
):
    owner_a, owner_b = two_owners
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)
    store = PostgresSessionStore(engine)
    session_a = await store.create_session(owner_a, "With artifact")
    session_b = await store.create_session(owner_b, "Other owner")
    turn_a, turn_b = f"turn_{uuid4().hex}", f"turn_{uuid4().hex}"
    try:
        for owner, session_id, turn_id in ((owner_a, session_a, turn_a),
                                            (owner_b, session_b, turn_b)):
            async with engine.begin() as db:
                await db.execute(text("SELECT set_config('app.user_id', :owner, true)"), {"owner": owner})
                await db.execute(text("""INSERT INTO turns
                    (id,owner_user_id,session_id,status) VALUES
                    (:turn,:owner,:session,'completed')"""), {
                        "turn": turn_id, "owner": owner, "session": session_id,
                    })
        token = _bind(owner_a, tmp_path)
        try:
            paths = get_path_service()
            chat_root = _feature_path(paths, "chat")
            artifact = chat_root / turn_a / "result.txt"
            artifact.parent.mkdir(parents=True)
            artifact.write_text("owned result")
            legacy = paths.get_chat_history_db()
            legacy.parent.mkdir(parents=True, exist_ok=True)
            legacy.write_text("stale SQLite path must not be opened")
            selected = _selected_artifact_files(paths, {session_a})
            assert selected["chat"] == [f"{turn_a}/result.txt"]
            assert not any(turn_b in name for names in selected.values() for name in names)
        finally:
            reset_current_user(token)
    finally:
        for owner, session_id in ((owner_a, session_a), (owner_b, session_b)):
            await store.delete_session(owner, session_id)
