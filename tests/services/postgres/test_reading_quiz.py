from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
import httpx
import pytest

from deeptutor.api.routers import reading_extensions
from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.services.session import close_postgres_session_stores, get_session_store


@pytest.mark.asyncio
async def test_postgres_reading_quiz_owner_and_reward_roundtrip(
    two_owners, database_url, monkeypatch, tmp_path
):
    owner_a, owner_b = two_owners
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setattr(reading_extensions, "assert_learning_material", lambda _: None)

    class ReadingStub:
        def manifest(self, material_id):
            return type("Manifest", (), {"title": "Atlas"})()

    monkeypatch.setattr(reading_extensions, "ReadingStore", ReadingStub)
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

    app.include_router(reading_extensions.router, prefix="/api/reading")
    questions = [{"id": "q1", "prompt": "Ocean?", "choices": ["Pacific", "Atlantic"],
                  "correct_choice_index": 1}]
    try:
        token = set_current_user(CurrentUser(
            id=owner_a, username=owner_a, role="user",
            scope=UserScope(kind="user", user_id=owner_a, root=Path(tmp_path) / owner_a),
        ))
        try:
            assert await get_session_store().put_reading_quiz_pending("atlas", 4, questions) == 1
        finally:
            reset_current_user(token)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            payload = {"locator": 4, "session_id": "", "turn_id": "",
                       "answers": [{"question_id": "q1", "selected_index": 1}],
                       "submission_id": "first"}
            url = "/api/reading/materials/atlas/extensions/quiz/answers"
            foreign = await client.post(url, json=payload, headers={"x-owner": "b"})
            assert foreign.status_code == 409
            response = await client.post(url, json=payload)
            assert response.status_code == 200, response.text
            assert response.json()["reward"]["stars"] == 1
            repeated = await client.post(url, json=payload)
            assert repeated.status_code == 200
            rewards = await client.get("/api/reading/materials/atlas/quiz/rewards")
            assert rewards.json()["total_stars"] == 1
            foreign_rewards = await client.get(
                "/api/reading/materials/atlas/quiz/rewards", headers={"x-owner": "b"})
            assert foreign_rewards.json()["total_stars"] == 0
    finally:
        await close_postgres_session_stores()
