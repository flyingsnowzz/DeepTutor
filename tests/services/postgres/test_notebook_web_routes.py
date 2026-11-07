from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
import httpx
import pytest
from sqlalchemy import text

from deeptutor.api.routers.question_notebook import router
from deeptutor.api.routers.practice import router as practice_router
from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.services.session import close_postgres_session_stores
from deeptutor.services.session.postgres_store import PostgresSessionStore


@pytest.mark.asyncio
async def test_postgres_question_notebook_web_roundtrip(
    two_owners, engine, database_url, monkeypatch, tmp_path
):
    owner_a, owner_b = two_owners
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)
    session_id = await PostgresSessionStore(engine).create_session(owner_a)
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

    app.include_router(router, prefix="/api/question-notebook")
    app.include_router(practice_router, prefix="/api/practice")
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            created = await client.post("/api/question-notebook/entries/upsert", json={
                "session_id": session_id, "question_id": "q1",
                "question": "1 + 1?", "turn_id": "t1",
            })
            assert created.status_code == 200, created.text
            entry_id = created.json()["id"]
            owner_navigation = await PostgresSessionStore(engine).notebook.navigation(owner_a)
            assert owner_navigation[0]["id"] == entry_id
            assert await PostgresSessionStore(engine).notebook.navigation(owner_b) == []
            assert created.json()["practice"]["is_mistake"] is True
            overview = await client.get("/api/practice/summary")
            assert overview.status_code == 200, overview.text
            assert overview.json()["total"] == 1
            assert overview.json()["mistakes"] == 1
            assert (await client.get("/api/practice/summary", headers={"x-owner": "b"})).json()["total"] == 0
            async with engine.begin() as db:
                await db.execute(text("SELECT set_config('app.user_id', :owner, true)"), {"owner": owner_a})
                await db.execute(text("""UPDATE notebook_practice_state SET due_at=now() - interval '1 second'
                    WHERE entry_id=:entry AND owner_user_id=:owner"""),
                    {"entry": entry_id, "owner": owner_a})
            queue = await client.get("/api/practice/queue")
            assert queue.status_code == 200, queue.text
            assert queue.json()[0]["entry"]["id"] == entry_id
            analytics = await client.get("/api/practice/analytics", params={"days": 7})
            assert analytics.status_code == 200, analytics.text
            assert analytics.json()["totals"]["questions"] == 1
            state = await client.get(f"/api/practice/questions/{entry_id}")
            assert state.status_code == 200, state.text
            assert state.json()["state"]["is_mistake"] is True
            request_id = "review_request_123456"
            review_payload = {"answer": "3", "rating": "again", "version": 0,
                              "request_id": request_id}
            foreign_review = await client.post(
                f"/api/practice/questions/{entry_id}/review",
                json=review_payload, headers={"x-owner": "b"})
            assert foreign_review.status_code == 404
            reviewed = await client.post(
                f"/api/practice/questions/{entry_id}/review", json=review_payload)
            assert reviewed.status_code == 200, reviewed.text
            assert reviewed.json()["version"] == 1
            reviewed_card = await client.get(f"/api/question-notebook/entries/{entry_id}")
            assert reviewed_card.json()["practice"]["last_rating"] == "again"
            repeated = await client.post(
                f"/api/practice/questions/{entry_id}/review", json=review_payload)
            assert repeated.json() == reviewed.json()
            conflict = await client.post(
                f"/api/practice/questions/{entry_id}/review",
                json={**review_payload, "request_id": "review_request_654321"})
            assert conflict.status_code == 409
            revised = await client.post("/api/question-notebook/entries/upsert", json={
                "session_id": session_id, "question_id": "q1",
                "question": "1 + 1 = ?", "turn_id": "t1",
            })
            assert revised.status_code == 200, revised.text
            assert revised.json()["practice"]["version"] == 2
            listed = await client.get("/api/question-notebook/entries")
            assert listed.status_code == 200 and listed.json()["total"] == 1
            stats = await client.get("/api/question-notebook/stats")
            assert stats.status_code == 200 and stats.json()["total"] == 1
            assert stats.json()["wrong"] == 1
            assert stats.json()["uncategorized"] == 1
            foreign_stats = await client.get(
                "/api/question-notebook/stats", headers={"x-owner": "b"}
            )
            assert foreign_stats.json()["total"] == 0
            materials = await client.get("/api/question-notebook/materials")
            assert materials.status_code == 200 and materials.json() == []
            category = await client.post(
                "/api/question-notebook/categories", json={"name": "Math"}
            )
            assert category.status_code == 201, category.text
            category_id = category.json()["id"]
            assert (await client.post(
                "/api/question-notebook/categories", json={"name": "math"}
            )).status_code == 409
            assert (await client.post(
                f"/api/question-notebook/entries/{entry_id}/categories",
                json={"category_id": category_id}, headers={"x-owner": "b"},
            )).status_code == 404
            linked = await client.post(
                f"/api/question-notebook/entries/{entry_id}/categories",
                json={"category_id": category_id},
            )
            assert linked.status_code == 200, linked.text
            categories = await client.get("/api/question-notebook/categories")
            assert categories.json()[0]["entry_count"] == 1
            filtered = await client.get(
                "/api/question-notebook/entries", params={"category_id": category_id}
            )
            assert filtered.status_code == 200 and filtered.json()["total"] == 1
            assert filtered.json()["items"][0]["categories"][0]["name"] == "Math"
            assert (await client.get(
                "/api/question-notebook/entries", params={"uncategorized": True}
            )).json()["total"] == 0
            upload = await client.post(
                "/api/practice/import/preview",
                files={"file": ("questions.csv", "题目,题型,A,B,答案,标签\n2+2=?,单选题,3,4,B,数学\n".encode())},
                data={"target": "mistakes"},
            )
            assert upload.status_code == 200, upload.text
            token = upload.json()["token"]
            assert token
            foreign_commit = await client.post(
                "/api/practice/import/commit", json={"token": token},
                headers={"x-owner": "b"})
            assert foreign_commit.status_code == 404
            imported = await client.post(
                "/api/practice/import/commit", json={"token": token})
            assert imported.status_code == 200, imported.text
            assert imported.json()["created"] == 1
            assert (await client.post(
                "/api/practice/import/commit", json={"token": token}
            )).json() == imported.json()
            assert (await client.get(
                "/api/question-notebook/entries", params={"mistakes_only": True}
            )).json()["total"] == 2
            foreign = await client.get(
                f"/api/question-notebook/entries/{entry_id}", headers={"x-owner": "b"}
            )
            assert foreign.status_code == 404
            updated = await client.patch(
                f"/api/question-notebook/entries/{entry_id}",
                json={"bookmarked": True},
            )
            assert updated.status_code == 200
            got = await client.get(f"/api/question-notebook/entries/{entry_id}")
            assert got.json()["bookmarked"] is True
            deleted = await client.delete(f"/api/question-notebook/entries/{entry_id}")
            assert deleted.status_code == 200
            assert (await client.get("/api/question-notebook/entries")).json()["total"] == 1
    finally:
        await close_postgres_session_stores()
