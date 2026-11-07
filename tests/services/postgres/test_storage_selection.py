from __future__ import annotations

from pathlib import Path
import uuid

import pytest

from deeptutor.learning.models import LearningProgress, TopicMetadata
from deeptutor.learning.navigation import learner_has_topics
from deeptutor.learning.storage import LearningStore
from deeptutor.learning.storage_postgres_sync import PostgresLearningStore
from deeptutor.app.facade import DeepTutorApp
from deeptutor.app.container import ApplicationContainer
from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.services.session import close_postgres_session_stores, get_session_store
from deeptutor.services.session.sqlite_store import get_sqlite_session_store
from deeptutor_cli.app import create_cli_app


def test_required_postgres_revision_matches_alembic_head():
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from deeptutor.services.postgres.database import REQUIRED_POSTGRES_REVISION

    root = Path(__file__).resolve().parents[3]
    head = ScriptDirectory.from_config(Config(str(root / "alembic.ini"))).get_current_head()
    assert REQUIRED_POSTGRES_REVISION == head


@pytest.mark.asyncio
async def test_postgres_container_requires_current_schema_revision(
    database_url, monkeypatch,
):
    import deeptutor.services.postgres.database as postgres_database

    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)
    await postgres_database.validate_postgres_schema()
    monkeypatch.setattr(postgres_database, "REQUIRED_POSTGRES_REVISION", "missing_test_revision")
    container = ApplicationContainer.build()
    with pytest.raises(RuntimeError, match="schema revision"):
        await container.start()
    assert not container._started
    assert container._module_lease is None


@pytest.mark.asyncio
async def test_postgres_schema_check_fails_closed_when_database_is_unavailable(monkeypatch):
    from deeptutor.services.postgres.database import validate_postgres_schema

    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://invalid:invalid@127.0.0.1:1/unavailable")
    with pytest.raises(RuntimeError, match="schema check failed"):
        await validate_postgres_schema()


def _user(owner: str, root: Path) -> CurrentUser:
    return CurrentUser(
        id=owner, username=owner, role="user",
        scope=UserScope(kind="user", user_id=owner, root=root),
    )


@pytest.mark.asyncio
async def test_postgres_selector_binds_both_stores_to_current_user(
    two_owners, database_url, monkeypatch, tmp_path
):
    owner_a, owner_b = two_owners
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)
    path_id = f"path_{uuid.uuid4().hex}"
    token = set_current_user(_user(owner_a, tmp_path / "a"))
    try:
        learning_a = LearningStore()
        assert isinstance(learning_a, PostgresLearningStore)
        learning_a.save(LearningProgress(book_id=path_id))
        learning_a.put_topic(TopicMetadata(path_id=path_id, goal="导数"), [])
        assert learner_has_topics()
        session_a = await get_session_store().create_session("Alice")
        assert session_a["id"]
        with pytest.raises(RuntimeError, match="unavailable"):
            get_sqlite_session_store()
        with pytest.raises(RuntimeError, match="Explicit SQLite"):
            LearningStore(root=tmp_path / "sqlite")
    finally:
        reset_current_user(token)

    token = set_current_user(_user(owner_b, tmp_path / "b"))
    try:
        assert LearningStore().load(path_id) is None
        assert not learner_has_topics()
        assert await get_session_store().get_session(session_a["id"]) is None
    finally:
        reset_current_user(token)
        await close_postgres_session_stores()


def test_postgres_selector_requires_owner(monkeypatch):
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.delenv("DEEPTUTOR_DEFAULT_OWNER_USER_ID", raising=False)
    with pytest.raises(RuntimeError, match="authenticated user"):
        LearningStore()


def test_postgres_selector_rejects_local_accounts(monkeypatch):
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "local")
    with pytest.raises(RuntimeError, match="ACCOUNT_BACKEND=postgres"):
        get_session_store()


@pytest.mark.asyncio
async def test_sdk_explicit_owner_binds_postgres_store(two_owners, database_url, monkeypatch):
    owner_a, owner_b = two_owners
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)
    app_a = DeepTutorApp(user_id=owner_a)
    app_b = DeepTutorApp(user_id=owner_b)
    try:
        with app_a._workspace_context():
            created = await get_session_store().create_session("SDK session")
            assert created["id"]
        with app_b._workspace_context():
            assert await get_session_store().get_session(created["id"]) is None
        token = set_current_user(_user(owner_b, Path("/tmp/user-b")))
        try:
            with pytest.raises(PermissionError, match="conflicts"):
                with app_a._workspace_context():
                    pass
        finally:
            reset_current_user(token)
    finally:
        await close_postgres_session_stores()


def test_cli_requires_explicit_postgres_user(monkeypatch):
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.delenv("DEEPTUTOR_CLI_USER_ID", raising=False)
    with pytest.raises(RuntimeError, match="DEEPTUTOR_CLI_USER_ID"):
        create_cli_app()
    monkeypatch.setenv("DEEPTUTOR_CLI_USER_ID", "selected-user")
    assert create_cli_app().user_id == "selected-user"
