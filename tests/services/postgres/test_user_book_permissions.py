from pathlib import Path
import os

import psycopg
import pytest

from deeptutor.api.routers import multi_user
from deeptutor.multi_user.book_permission import BookPermission, permission_for_user
from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.multi_user.postgres_book_permission import load, save
from deeptutor.services.postgres.database import authentication_database_url


@pytest.mark.asyncio
async def test_admin_book_permission_survives_reload_and_is_owner_scoped(
    two_owners, database_url, monkeypatch, tmp_path,
):
    first, second = two_owners
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    auth_url = authentication_database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(auth_url) as db:
        for owner in (first, second):
            db.execute(
                "INSERT INTO first_party_credentials(owner_user_id,password_hash) VALUES (%s,%s)",
                (owner, "test-hash"),
            )

    admin_token = set_current_user(CurrentUser(
        id="admin-test", username="root", role="admin",
        scope=UserScope(kind="admin", user_id="admin-test", root=Path(tmp_path) / "admin"),
    ))
    try:
        assert (await multi_user.get_user_book_permission(first, object()))["permission"]["books"] == {}
        result = await multi_user.put_user_book_permission(
            first, multi_user.BookPermissionPayload(create=False, default="read", books={}), object(),
        )
        assert result["permission"] == {"create": False, "default": "read", "books": {}}
        assert (await multi_user.get_user_book_permission(first, object()))["permission"] == result["permission"]
        assert (await multi_user.get_user_book_permission(second, object()))["permission"]["default"] == "none"
    finally:
        reset_current_user(admin_token)

    ordinary_token = set_current_user(CurrentUser(
        id=first, username="first", role="user",
        scope=UserScope(kind="user", user_id=first, root=Path(tmp_path) / first),
    ))
    try:
        assert permission_for_user(CurrentUser(
            id=first, username="first", role="user",
            scope=UserScope(kind="user", user_id=first, root=Path(tmp_path) / first),
        )).default == "read"
        with pytest.raises(PermissionError):
            load(second)
        with pytest.raises(PermissionError):
            save(second, BookPermission())
    finally:
        reset_current_user(ordinary_token)

    data_url = database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(data_url) as db:
        for owner in (first, second):
            db.execute("SELECT set_config('app.user_id', %s, true)", (owner,))
            db.execute("DELETE FROM user_book_permissions WHERE owner_user_id=%s", (owner,))
    cleanup_url = os.environ.get("TEST_DATABASE_ADMIN_URL")
    if cleanup_url:
        with psycopg.connect(cleanup_url.replace("postgresql+asyncpg://", "postgresql://", 1)) as db:
            db.execute("DELETE FROM first_party_credentials WHERE owner_user_id IN (%s,%s)", (first, second))
