from __future__ import annotations

import pytest

from deeptutor.services.session.postgres_store import PostgresSessionStore


@pytest.mark.asyncio
async def test_notebook_cards_are_owner_and_turn_scoped(two_owners, engine):
    owner_a, owner_b = two_owners
    sessions = PostgresSessionStore(engine)
    session_a = await sessions.create_session(owner_a)
    session_b = await sessions.create_session(owner_b)
    cards = sessions.notebook
    item = {
        "question_id": "q_1", "question": "1 + 1?", "turn_id": "turn-1",
        "origin_type": "conversation", "source": "deep_question",
        "is_correct": False, "user_answer": "3",
        "user_answer_images": [{"id": "img-1", "url": "stored://img-1"}],
    }
    assert await cards.upsert_entries(owner_a, session_a, [item]) == 1
    first = await cards.find_by_origin(owner_a, "conversation", session_a, "q_1", "turn-1")
    assert first["question"] == "1 + 1?"
    assert first["score_trend"] == "new"
    assert first["user_answer_images"][0]["id"] == "img-1"
    assert await cards.get_entry(owner_b, first["id"]) is None
    assert await cards.find_by_origin(owner_b, "conversation", session_a, "q_1", "turn-1") is None
    with pytest.raises(ValueError, match="Session not found"):
        await cards.upsert_entries(owner_b, session_a, [item])

    assert await cards.update_entry(owner_a, first["id"], {"bookmarked": True})
    revised = {**item, "is_correct": True, "user_answer": "2"}
    revised.pop("user_answer_images")
    assert await cards.upsert_entries(owner_a, session_a, [revised]) == 1
    first = await cards.get_entry(owner_a, first["id"])
    assert first["score_trend"] == "improved"
    assert first["resolved"] and first["bookmarked"]
    assert first["user_answer_images"][0]["id"] == "img-1"

    second = {**item, "turn_id": "turn-2"}
    await cards.upsert_entries(owner_a, session_a, [second])
    other = await cards.find_by_origin(owner_a, "conversation", session_a, "q_1", "turn-2")
    assert other["id"] != first["id"]
    assert await cards.find_by_origin(owner_a, "conversation", session_a, "q_1") is None
    await cards.upsert_entries(owner_b, session_b, [item])
    listed = await cards.list_entries(owner_a, bookmarked=True)
    assert listed["total"] == 1
    assert listed["items"][0]["id"] == first["id"]
    assert (await cards.list_entries(owner_b))["total"] == 1
    assert (await cards.list_entries(owner_a, search="1 + 1"))["total"] == 2
    assert (await cards.list_entries(owner_a, session_ids=[]))["total"] == 0
    assert not await cards.delete_entry(owner_b, first["id"])
    assert await cards.delete_entry(owner_a, first["id"])
    assert await cards.get_entry(owner_a, first["id"]) is None
