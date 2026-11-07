from __future__ import annotations

import asyncio

import pytest

from deeptutor.services.session.postgres_store import PostgresSessionStore
from deeptutor.services.session.protocol import ActiveTurnConflict


@pytest.mark.asyncio
async def test_owner_scoped_turn_admission_events_and_fencing(two_owners, engine):
    owner_a, owner_b = two_owners
    store = PostgresSessionStore(engine)
    session_id = await store.create_session(owner_a)

    async def begin():
        return await store.begin_turn(owner_a, session_id, "chat", fencing_token=7)

    results = await asyncio.gather(begin(), begin(), return_exceptions=True)
    turns = [item for item in results if isinstance(item, dict)]
    conflicts = [item for item in results if isinstance(item, ActiveTurnConflict)]
    assert len(turns) == len(conflicts) == 1
    turn_id = turns[0]["id"]
    assert (await store.get_active_turn(owner_a, session_id))["id"] == turn_id
    assert [row["id"] for row in await store.list_active_turns(owner_a, session_id)] == [turn_id]
    assert any(row["id"] == turn_id for row in await store.list_nonterminal_turns(owner_a))
    assert await store.get_turn(owner_b, turn_id) is None
    with pytest.raises(PermissionError):
        await store.begin_turn(owner_b, session_id)

    with pytest.raises(RuntimeError, match="lease lost"):
        await store.append_events(owner_a, turn_id, [{"type": "token"}], fencing_token=8)
    event = {"type": "token", "content": "你好", "metadata": {"part": 1}}
    appended = await store.append_events(owner_a, turn_id, [event], fencing_token=7)
    assert appended[0]["seq"] == 1
    replayed = await store.append_events(owner_a, turn_id, [{**event, "seq": 1}], fencing_token=7)
    assert replayed[0]["seq"] == 1
    with pytest.raises(ValueError, match="event conflict"):
        await store.append_events(owner_a, turn_id, [{"type": "token", "content": "different", "seq": 1}])
    assert [row["content"] for row in await store.get_events(owner_a, turn_id)] == ["你好"]
    assert await store.get_events(owner_b, turn_id) == []
    assistant = await store.add_message(owner_a, session_id, "assistant", "你好")
    assert not await store.link_turn_message(owner_b, turn_id, assistant)
    assert await store.link_turn_message(owner_a, turn_id, assistant)
    assert (await store.get_turn(owner_a, turn_id))["assistant_message_id"] == assistant
    assert not await store.transition_turn(owner_a, turn_id, "completed", fencing_token=8)
    assert await store.transition_turn(owner_a, turn_id, "completed", fencing_token=7)
    assert await store.get_active_turn(owner_a, session_id) is None
    assert (await store.begin_turn(owner_a, session_id))["status"] == "running"
