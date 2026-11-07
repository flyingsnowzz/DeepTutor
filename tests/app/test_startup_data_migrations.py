from __future__ import annotations

import pytest

from deeptutor.app.container import ApplicationContainer
from deeptutor.multi_user.context import get_current_user_or_none
from deeptutor.multi_user.models import CurrentUser
from deeptutor.multi_user.paths import scope_for_user


@pytest.mark.asyncio
async def test_startup_data_migrations_run_legacy_then_workspace_upgrade(monkeypatch) -> None:
    container = object.__new__(ApplicationContainer)
    calls: list[str] = []

    async def migrate_legacy() -> list[dict[str, object]]:
        calls.append("legacy")
        return [{"imported": 2}]

    async def migrate_workspace() -> list[dict[str, object]]:
        calls.append("workspace")
        return [{"migrated": 3}]

    container.migrate_all_legacy_chats = migrate_legacy  # type: ignore[method-assign]
    container.migrate_all_workspace_preferences = migrate_workspace  # type: ignore[method-assign]
    monkeypatch.setattr(container, "_local_users", lambda: [])

    reports = await container.run_startup_data_migrations()

    assert calls == ["legacy", "workspace"]
    assert reports == {
        "legacy_chat": [{"imported": 2}],
        "workspace_preferences": [{"migrated": 3}],
        "book_chats": [],
        "workspace_data": [],
    }


@pytest.mark.asyncio
async def test_postgres_startup_skips_local_migrations(monkeypatch) -> None:
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    container = object.__new__(ApplicationContainer)

    async def unexpected() -> None:
        raise AssertionError("local migration ran in PostgreSQL mode")

    container.migrate_all_legacy_chats = unexpected  # type: ignore[method-assign]
    assert await container.run_startup_data_migrations() == {
        "legacy_chat": [], "workspace_preferences": [], "book_chats": [], "workspace_data": [],
    }


@pytest.mark.asyncio
async def test_postgres_assessment_recovery_uses_each_user_scope(monkeypatch) -> None:
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    container = object.__new__(ApplicationContainer)
    users = [
        CurrentUser(id=uid, username=uid, role="user", scope=scope_for_user(uid, is_admin=False))
        for uid in ("recovery-a", "recovery-b")
    ]

    async def runtime_users() -> list[CurrentUser]:
        return users

    seen: list[str] = []

    async def reconcile() -> tuple[int, int]:
        current = get_current_user_or_none()
        assert current is not None
        seen.append(current.id)
        return 1, 0

    container._runtime_users = runtime_users  # type: ignore[method-assign]
    monkeypatch.setattr("deeptutor.learning.assessment.reconcile_linked_assessments", reconcile)
    assert await container.reconcile_linked_assessments() == (2, 0)
    assert seen == ["recovery-a", "recovery-b"]
    assert get_current_user_or_none() is None
