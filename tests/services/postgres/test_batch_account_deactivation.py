import asyncio
import io
from types import SimpleNamespace

from fastapi import UploadFile

from deeptutor.api.routers import auth
from deeptutor.services.auth import TokenPayload


def test_postgres_batch_delete_deactivates_only_found_users(monkeypatch):
    class Users:
        def __init__(self):
            self.deactivated = []

        async def get_user_by_username(self, username):
            return {"id": "id-a"} if username == "alice" else None

        async def deactivate(self, user_id):
            self.deactivated.append(user_id)
            return True

    users = Users()
    actions = []
    monkeypatch.setattr(auth, "postgres_accounts_enabled", lambda: True)
    monkeypatch.setattr(auth, "get_postgres_web_account_gateway", lambda: SimpleNamespace(users=users))
    monkeypatch.setattr(auth, "log_admin_action", lambda *args, **kwargs: actions.append((args, kwargs)))
    result = asyncio.run(auth.batch_remove_users(
        auth.AdminBatchDeleteRequest(usernames=["alice", "missing"]),
        TokenPayload(username="root", role="admin", user_id="admin-id"),
    ))
    assert result["deleted_count"] == 1
    assert result["failed_count"] == 1
    assert users.deactivated == ["id-a"]
    assert actions[0][0] == ("user_deactivate",)


def test_postgres_csv_import_uses_postgres_registration(monkeypatch):
    class Users:
        def __init__(self):
            self.created = []

        async def register(self, username, password, *, preset):
            self.created.append((username, preset))
            return "id-" + username

    users = Users()
    actions = []
    monkeypatch.setattr(auth, "postgres_accounts_enabled", lambda: True)
    monkeypatch.setattr(auth, "get_postgres_web_account_gateway", lambda: SimpleNamespace(users=users))
    monkeypatch.setattr(auth, "AUTH_ENABLED", True)
    monkeypatch.setattr(auth, "log_admin_action", lambda *args, **kwargs: actions.append((args, kwargs)))
    file = UploadFile(filename="users.csv", file=io.BytesIO(
        b"username,password,preset\nalice,secret-password-123,standard\n"
    ))
    result = asyncio.run(auth.admin_import_users(
        file, TokenPayload(username="root", role="admin", user_id="admin-id"),
    ))
    assert result["created_count"] == 1
    assert users.created == [("alice", "standard")]
    assert actions[0][0] == ("user_create",)
