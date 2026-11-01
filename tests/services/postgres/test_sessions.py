from __future__ import annotations

import pytest

from deeptutor.services.session.postgres_store import PostgresSessionStore


@pytest.mark.asyncio
async def test_session_owner_isolation(two_owners, engine):
    owner_a, owner_b = two_owners
    store = PostgresSessionStore(engine)

    session_id = await store.create_session(owner_a, title="A 的会话")

    fetched = await store.get_session(owner_a, session_id)
    assert fetched is not None and fetched["title"] == "A 的会话"

    # Resource id alone never authorizes: owner B gets nothing.
    assert await store.get_session(owner_b, session_id) is None
    assert all(s["id"] != session_id for s in await store.list_sessions(owner_b))

    listed = await store.list_sessions(owner_a)
    assert any(s["id"] == session_id for s in listed)


@pytest.mark.asyncio
async def test_session_ids_are_unique(accounts, engine, owner_factory):
    owner = owner_factory("sessions")
    await accounts.ensure_user(owner)
    store = PostgresSessionStore(engine)
    ids = {await store.create_session(owner) for _ in range(3)}
    assert len(ids) == 3
