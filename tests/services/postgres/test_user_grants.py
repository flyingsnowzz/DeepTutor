from pathlib import Path
import asyncio
import os

import pytest
import psycopg
import uuid

from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.grants import (
    load_grant, restore_grant_if_unchanged, save_grant, save_grant_with_receipt,
)
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.api.routers import multi_user
from deeptutor.services.accounts.first_party import FirstPartyAccountService
from deeptutor.services.postgres.database import authentication_database_url


def test_postgres_grants_owner_scope_restart_and_conditional_restore(two_owners, database_url, monkeypatch, tmp_path):
    a, b = two_owners
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    url = authentication_database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(url) as db:
        for owner in (a, b):
            db.execute(
                "INSERT INTO first_party_credentials(owner_user_id,password_hash) VALUES (%s,%s)",
                (owner, "test-hash"),
            )
    admin = set_current_user(CurrentUser(
        id="admin-test", username="root", role="admin",
        scope=UserScope(kind="admin", user_id="admin-test", root=Path(tmp_path) / "admin"),
    ))
    try:
        assert load_grant(a)["enabled_tools"] is None
        first, receipt = save_grant_with_receipt(a, {"enabled_tools": ["reason"]})
        assert first["enabled_tools"] == ["reason"]
        assert load_grant(a)["enabled_tools"] == ["reason"]
        save_grant(a, {"enabled_tools": []})
        assert not restore_grant_if_unchanged(a, receipt)
        current, receipt2 = save_grant_with_receipt(a, {"enabled_tools": ["web_search"]})
        assert restore_grant_if_unchanged(a, receipt2)
        assert load_grant(a)["enabled_tools"] == []
        assert load_grant(b)["enabled_tools"] is None
        result = asyncio.run(multi_user.put_user_grants(
            a, multi_user.GrantPayload(grant={"enabled_tools": ["reason"]}), object(),
        ))
        assert result["grant"]["enabled_tools"] == ["reason"]
        assert asyncio.run(multi_user.get_user_grants(a, object()))["grant"]["enabled_tools"] == ["reason"]
    finally:
        reset_current_user(admin)

    ordinary = set_current_user(CurrentUser(
        id=b, username="other", role="user",
        scope=UserScope(kind="user", user_id=b, root=Path(tmp_path) / b),
    ))
    try:
        with pytest.raises(PermissionError):
            load_grant(a)
        assert load_grant(b)["enabled_tools"] is None
    finally:
        reset_current_user(ordinary)
    assert not (Path(tmp_path) / "admin/grants").exists()
    cleanup_url = os.environ.get("TEST_DATABASE_ADMIN_URL")
    if cleanup_url:
        with psycopg.connect(cleanup_url.replace("postgresql+asyncpg://", "postgresql://", 1)) as db:
            db.execute("DELETE FROM user_grants WHERE owner_user_id IN (%s,%s)", (a, b))
            db.execute("DELETE FROM first_party_credentials WHERE owner_user_id IN (%s,%s)", (a, b))


@pytest.mark.asyncio
async def test_learner_registration_creates_restrictive_grant_in_same_transaction(auth_engine, database_url):
    username = "learner_" + uuid.uuid4().hex[:12]
    service = FirstPartyAccountService(auth_engine)
    user_id = await service.register(username, "secure-test-password", preset="learner")
    url = authentication_database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
    try:
        with psycopg.connect(url) as db:
            row = db.execute(
                "SELECT grant_json FROM user_grants WHERE owner_user_id=%s", (user_id,)
            ).fetchone()
        assert row is not None
        assert row[0]["enabled_tools"] == []
        assert row[0]["learning_policy"]["allowed_surfaces"] == ["chat", "reading"]
    finally:
        cleanup_url = os.environ.get("TEST_DATABASE_ADMIN_URL")
        if cleanup_url:
            with psycopg.connect(cleanup_url.replace("postgresql+asyncpg://", "postgresql://", 1)) as db:
                db.execute("DELETE FROM auth_identities WHERE owner_user_id=%s", (user_id,))
                db.execute("DELETE FROM subscriptions WHERE owner_user_id=%s", (user_id,))
                db.execute("DELETE FROM users WHERE id=%s", (user_id,))
