from __future__ import annotations

import uuid

import pytest

from deeptutor.services.practice.postgres import PostgresPracticeRepository


def _entry(question: str):
    return {
        "origin_type": "deep_question",
        "origin_ref": "turn-1",
        "question_id": f"q-{question}",
        "question": question,
        "question_type": "single_choice",
        "options": {"A": "x", "B": "y"},
        "correct_answer": "A",
        "explanation": "because",
        "difficulty": "medium",
        "user_answer": "B",
        "source": "deep_question",
        "is_correct": False,
        "resolved": False,
        "bookmarked": False,
    }


@pytest.mark.asyncio
async def test_practice_entries_owner_isolation_and_idempotency(two_owners, engine):
    owner_a, owner_b = two_owners
    repo = PostgresPracticeRepository(engine)

    fixed_id = f"practice_fixed_{uuid.uuid4().hex[:10]}"
    await repo.add_entry(owner_a, {**_entry("A 的错题"), "id": fixed_id})
    # Same id for a different owner is rejected: id alone never grants access.
    with pytest.raises(PermissionError):
        await repo.add_entry(owner_b, {**_entry("B 的错题"), "id": fixed_id})

    a_entries = await repo.list_entries(owner_a)
    b_entries = await repo.list_entries(owner_b)
    assert len(a_entries) == 1 and a_entries[0]["question"] == "A 的错题"
    assert b_entries == []

    # B cannot toggle A's bookmark.
    assert await repo.set_bookmark(owner_b, fixed_id, True) is False
    assert await repo.set_bookmark(owner_a, fixed_id, True) is True
    assert (await repo.list_entries(owner_a))[0]["bookmarked"] is True

    # Re-adding the same id for A is a no-op (idempotent import).
    await repo.add_entry(owner_a, {**_entry("A 的错题-重复"), "id": fixed_id})
    again = await repo.list_entries(owner_a)
    assert len(again) == 1 and again[0]["question"] == "A 的错题"


@pytest.mark.asyncio
async def test_practice_generated_ids_are_distinct(two_owners, engine):
    owner_a, owner_b = two_owners
    repo = PostgresPracticeRepository(engine)
    id_a = await repo.add_entry(owner_a, _entry("q1"))
    id_b = await repo.add_entry(owner_b, _entry("q2"))
    assert id_a != id_b and id_a.startswith("practice_")
