from __future__ import annotations

from pathlib import Path

import pytest

from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.services.session import close_postgres_session_stores
from deeptutor.services.session.postgres_store import PostgresSessionStore
from deeptutor.tools.question_bank import run_question_bank


@pytest.mark.asyncio
async def test_question_bank_tool_selects_owner_scoped_postgres(
    two_owners, engine, database_url, monkeypatch, tmp_path
):
    owner_a, owner_b = two_owners
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)
    session_id = await PostgresSessionStore(engine).create_session(owner_a)
    await PostgresSessionStore(engine).notebook.upsert_entries(owner_a, session_id, [{
        "question_id": "q1", "question": "2 + 2?", "is_correct": False,
    }])
    try:
        def bind(owner):
            return set_current_user(CurrentUser(
                id=owner, username=owner, role="user",
                scope=UserScope(kind="user", user_id=owner,
                                root=Path(tmp_path) / owner),
            ))

        token = bind(owner_a)
        try:
            from deeptutor.agents._shared.tool_composition import user_has_question_bank

            assert user_has_question_bank()
            listed = await run_question_bank(action="list", filter_mode="wrong")
            assert listed.summary["total"] == 1
            entry_id = listed.summary["entry_ids"][0]
            filed = await run_question_bank(
                action="organize", entry_ids=[entry_id], category="Math")
            assert filed.summary["changed"] == 1
            assert (await run_question_bank(
                action="list", category="math")).summary["total"] == 1
        finally:
            reset_current_user(token)

        token = bind(owner_b)
        try:
            assert not user_has_question_bank()
            assert (await run_question_bank(action="overview")).summary["stats"]["total"] == 0
        finally:
            reset_current_user(token)
    finally:
        await close_postgres_session_stores()
