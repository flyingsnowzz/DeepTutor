from __future__ import annotations

import pytest

from deeptutor.services.session.postgres_store import PostgresSessionStore


@pytest.mark.asyncio
async def test_delete_turn_by_message_preserves_sibling_branch(two_owners, engine):
    owner_a, owner_b = two_owners
    store = PostgresSessionStore(engine)
    session_id = await store.create_session(owner_a)
    user_id = await store.add_message(
        owner_a, session_id, "user", "question",
        attachments=[{"id": "user-attachment"}],
    )
    first = await store.add_message(
        owner_a, session_id, "assistant", "first", parent_message_id=user_id,
        attachments=[{"id": "first-attachment"}],
    )
    second = await store.add_message(
        owner_a, session_id, "assistant", "second", parent_message_id=user_id,
    )
    assert not (await store.delete_turn_by_message(owner_b, session_id, first))["deleted"]
    removed = await store.delete_turn_by_message(owner_a, session_id, first)
    assert removed == {
        "deleted": True, "attachment_ids": ["first-attachment"],
        "turn_id": None, "was_active": False,
    }
    messages = await store.get_messages(owner_a, session_id)
    assert {item["id"] for item in messages} == {user_id, second}
    assert (await store.delete_turn_by_message(owner_a, session_id, user_id))["deleted"]
    assert await store.get_messages(owner_a, session_id) == []


@pytest.mark.asyncio
async def test_delete_turn_by_message_refuses_active_turn(two_owners, engine):
    owner_a, _ = two_owners
    store = PostgresSessionStore(engine)
    session_id = await store.create_session(owner_a)
    turn = await store.begin_turn(owner_a, session_id, "chat")
    user_id = await store.add_message(
        owner_a, session_id, "user", "question",
        metadata={"turn_id": turn["id"]},
    )
    blocked = await store.delete_turn_by_message(owner_a, session_id, user_id)
    assert blocked["was_active"] and not blocked["deleted"]
    assert any(item["id"] == user_id for item in await store.get_messages(owner_a, session_id))
    assert await store.transition_turn(owner_a, turn["id"], "completed")
    removed = await store.delete_turn_by_message(owner_a, session_id, user_id)
    assert removed["deleted"] and removed["turn_id"] == turn["id"]
    assert await store.get_turn(owner_a, turn["id"]) is None
