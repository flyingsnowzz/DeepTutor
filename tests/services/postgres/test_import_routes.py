from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
import httpx
import pytest

from deeptutor.api.routers.imports import router
from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.services.session import close_postgres_session_stores


@pytest.mark.asyncio
async def test_postgres_import_routes_are_idempotent_and_owner_scoped(
    two_owners, database_url, monkeypatch, tmp_path
):
    owner_a, owner_b = two_owners
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)
    app = FastAPI()

    @app.middleware("http")
    async def bind_user(request: Request, call_next):
        owner = owner_b if request.headers.get("x-owner") == "b" else owner_a
        token = set_current_user(CurrentUser(
            id=owner, username=owner, role="user",
            scope=UserScope(kind="user", user_id=owner, root=Path(tmp_path) / owner),
        ))
        try:
            return await call_next(request)
        finally:
            reset_current_user(token)

    app.include_router(router, prefix="/api/imports")
    payload = {"source": "codex", "sessions": [{
        "external_id": "external-1", "title": "Imported",
        "created_at": 1000, "updated_at": 2000,
        "messages": [{"role": "user", "content": "question"},
                     {"role": "assistant", "content": "answer"}],
    }]}
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            created = await client.post("/api/imports/chat-history", json=payload)
            assert created.status_code == 200, created.text
            assert created.json()["imported"] == 1
            repeated = await client.post("/api/imports/chat-history", json=payload)
            assert repeated.json()["skipped"] == 1
            listed = await client.get("/api/imports/chat-history")
            assert listed.status_code == 200, listed.text
            assert listed.json()["sessions"][0]["message_count"] == 2
            foreign = await client.get(
                "/api/imports/chat-history", headers={"x-owner": "b"})
            assert foreign.json()["sessions"] == []
    finally:
        await close_postgres_session_stores()
