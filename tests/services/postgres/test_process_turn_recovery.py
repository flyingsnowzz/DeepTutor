"""Recovery of a durable PostgreSQL turn after its in-memory lease disappears."""

from __future__ import annotations

import os
import uuid

import psycopg
import pytest

from deeptutor.app.container import (
    ApplicationContainer, close_application_container, set_application_container,
)
from deeptutor.multi_user.models import CurrentUser
from deeptutor.multi_user.paths import scope_for_user, user_context
from deeptutor.services.accounts.first_party import FirstPartyAccountService
from deeptutor.services.accounts.web_gateway import close_postgres_web_account_gateway
from deeptutor.services.session import get_session_store


@pytest.mark.asyncio
async def test_expired_turn_recovered_for_registered_postgres_user(
    auth_engine, database_url, monkeypatch,
) -> None:
    admin_url = os.environ.get("TEST_DATABASE_ADMIN_URL")
    if not admin_url:
        pytest.skip("cleanup requires TEST_DATABASE_ADMIN_URL")

    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    import deeptutor.services.accounts.web_gateway as gateway_module

    monkeypatch.setattr(gateway_module, "AUTH_ENABLED", True)
    monkeypatch.setattr(gateway_module, "AUTH_SECRET", "recovery-test-secret")
    gateway_module.get_postgres_web_account_gateway.cache_clear()

    username = "pgrecover_" + uuid.uuid4().hex[:12]
    owner = await FirstPartyAccountService(auth_engine).register(
        username, "secure-test-password"
    )
    user = CurrentUser(
        id=owner, username=username, role="user",
        scope=scope_for_user(owner, is_admin=False),
    )
    container = None
    try:
        with user_context(user):
            store = get_session_store()
            session = await store.ensure_session()
            turn = await store.begin_turn(session["id"], capability="chat")
            await store.append_events(turn["id"], [{"type": "content", "content": "partial"}])

        container = ApplicationContainer.build()
        set_application_container(container)
        await container.start()
        assert owner in {row.id for row in await container._runtime_users()}
        await container.recover_once()

        with user_context(user):
            resumed = get_session_store()
            recovered = await resumed.get_turn(turn["id"])
            events = await resumed.get_events(turn["id"])
        assert recovered is not None
        assert recovered["status"] == "failed"
        assert recovered["failure_code"] == "worker_lost"
        assert [event["type"] for event in events] == ["content", "error", "done"]
    finally:
        if container is not None:
            await close_application_container()
        await close_postgres_web_account_gateway()
        with psycopg.connect(admin_url.replace("postgresql+asyncpg://", "postgresql://", 1)) as db:
            row = db.execute("SELECT username FROM users WHERE id=%s", (owner,)).fetchone()
            assert row == (username,)
            for table in ("sessions", "auth_identities", "subscriptions"):
                db.execute(f"DELETE FROM {table} WHERE owner_user_id=%s", (owner,))
            db.execute("DELETE FROM users WHERE id=%s", (owner,))
