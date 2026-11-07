from pathlib import Path
import os
import uuid

from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
import psycopg
import pytest

from deeptutor.api.routers import marginnote4
from deeptutor.capabilities.marginnote4.store import PostgresMarginNoteStore
from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope


@pytest.mark.asyncio
async def test_marginnote4_pair_sync_revoke_and_owner_isolation(
    two_owners, database_url, monkeypatch, tmp_path
):
    owner_a, owner_b = two_owners
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    kb_name = f"mn4-{uuid.uuid4().hex}"
    app = FastAPI()
    app.dependency_overrides[marginnote4.require_auth] = lambda: None

    @app.middleware("http")
    async def bind_user(request: Request, call_next):
        if request.url.path.endswith(("/sync", "/heartbeat")):
            return await call_next(request)
        owner = owner_b if request.headers.get("x-owner") == "b" else owner_a
        token = set_current_user(CurrentUser(
            id=owner, username=owner, role="user",
            scope=UserScope(kind="user", user_id=owner, root=Path(tmp_path) / owner),
        ))
        try:
            return await call_next(request)
        finally:
            reset_current_user(token)

    app.include_router(marginnote4.router, prefix="/api/marginnote4")
    headers = {"x-mn4-kb": kb_name}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        missing = await client.post("/api/marginnote4/heartbeat", headers={**headers,
            "authorization": "MarginNote missing:wrong"})
        assert missing.status_code == 403
        paired = await client.post("/api/marginnote4/pair", json={"device_name": "Tablet"}, headers=headers)
        assert paired.status_code == 200, paired.text
        credential = paired.json()
        device_headers = {**headers, "authorization":
                          f"MarginNote {credential['device_id']}:{credential['token']}"}
        synced = await client.post("/api/marginnote4/sync", headers=device_headers, json={
            "cursor": "first", "objects": [{"object_id": "note-1", "object_type": "note",
                                           "title": "Calculus", "content": "Derivative"}],
        })
        assert synced.status_code == 200, synced.text
        assert synced.json()["stored"] == 1
        assert (await client.post("/api/marginnote4/heartbeat", headers=device_headers)).json()["object_count"] == 1
        restarted = PostgresMarginNoteStore(owner_a, kb_name)
        assert restarted.count() == 1
        assert restarted.get_cursor(credential["device_id"])
        assert restarted.get("note-1").title == "Calculus"
        assert PostgresMarginNoteStore(owner_b, kb_name).count() == 0
        assert not (tmp_path / owner_a / "user/marginnote4").exists()
        foreign = await client.get("/api/marginnote4/status", headers={**headers, "x-owner": "b"})
        assert foreign.json()["objects"] == 0
        revoked = await client.delete(f"/api/marginnote4/devices/{credential['device_id']}", headers=headers)
        assert revoked.status_code == 200
        assert (await client.post("/api/marginnote4/heartbeat", headers=device_headers)).status_code == 403
    cleanup_url = os.environ.get("TEST_DATABASE_ADMIN_URL")
    if cleanup_url:
        with psycopg.connect(cleanup_url.replace("postgresql+asyncpg://", "postgresql://", 1)) as db:
            db.execute("DELETE FROM marginnote4_states WHERE kb_name=%s AND owner_user_id IN (%s,%s)",
                       (kb_name, owner_a, owner_b))
