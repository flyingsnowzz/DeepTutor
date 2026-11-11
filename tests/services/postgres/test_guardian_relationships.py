from pathlib import Path
import os
import uuid

import psycopg
import pytest

from deeptutor.api.routers import multi_user
from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.guardians import guardian_can_access, list_relationships, relationship_by_id
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.services.accounts.first_party import FirstPartyAccountService


@pytest.mark.asyncio
async def test_postgres_guardian_authorization_is_scoped_and_revocable(auth_engine, database_url, monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    service = FirstPartyAccountService(auth_engine)
    suffix = uuid.uuid4().hex[:12]
    guardian = await service.register(f"guardian_{suffix}", "password-123")
    learner = await service.register(f"learner_{suffix}", "password-123", preset="learner")
    outsider = await service.register(f"outsider_{suffix}", "password-123")

    admin_token = set_current_user(CurrentUser(
        id="admin-test", username="root", role="admin",
        scope=UserScope(kind="admin", user_id="admin-test", root=Path(tmp_path) / "admin"),
    ))
    try:
        result = await multi_user.authorize_guardian_relationship(
            multi_user.GuardianAuthorizationPayload(
                guardian_user_id=guardian, learner_user_id=learner,
                permissions=["view_reports", "assign_materials"],
            ), object(),
        )
        relationship = result["relationship"]
        assert relationship["guardian_user_id"] == guardian
        assert relationship["learner_username"] == f"learner_{suffix}"
        assert len((await multi_user.list_guardian_relationships(False, object()))["relationships"]) >= 1
    finally:
        reset_current_user(admin_token)

    guardian_token = set_current_user(CurrentUser(
        id=guardian, username=f"guardian_{suffix}", role="user",
        scope=UserScope(kind="user", user_id=guardian, root=Path(tmp_path) / guardian),
    ))
    try:
        assert guardian_can_access(guardian, learner, "view_reports")
        assert len(list_relationships(guardian_user_id=guardian)) == 1
        assert relationship_by_id(relationship["id"])["id"] == relationship["id"]
    finally:
        reset_current_user(guardian_token)

    outsider_token = set_current_user(CurrentUser(
        id=outsider, username=f"outsider_{suffix}", role="user",
        scope=UserScope(kind="user", user_id=outsider, root=Path(tmp_path) / outsider),
    ))
    try:
        assert relationship_by_id(relationship["id"]) is None
        assert not guardian_can_access(guardian, learner, "view_reports")
        with pytest.raises(PermissionError):
            list_relationships(guardian_user_id=guardian)
    finally:
        reset_current_user(outsider_token)

    admin_token = set_current_user(CurrentUser(
        id="admin-test", username="root", role="admin",
        scope=UserScope(kind="admin", user_id="admin-test", root=Path(tmp_path) / "admin"),
    ))
    try:
        await multi_user.revoke_guardian_relationship(relationship["id"], object())
        assert not guardian_can_access(guardian, learner, "view_reports")
    finally:
        reset_current_user(admin_token)

    cleanup_url = os.environ.get("TEST_DATABASE_ADMIN_URL")
    if cleanup_url:
        with psycopg.connect(cleanup_url.replace("postgresql+asyncpg://", "postgresql://", 1)) as db:
            db.execute("DELETE FROM users WHERE id IN (%s,%s,%s)", (guardian, learner, outsider))
