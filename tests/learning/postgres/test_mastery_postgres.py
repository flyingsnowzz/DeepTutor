from __future__ import annotations

import uuid

import pytest

from deeptutor.learning.storage_postgres import PostgresMasteryRepository


@pytest.mark.asyncio
async def test_mastery_path_owner_isolation_and_revision_bump(two_owners, engine):
    owner_a, owner_b = two_owners
    repo = PostgresMasteryRepository(engine)

    path_id = f"path_demo_{uuid.uuid4().hex[:10]}"
    first = await repo.create_path(owner_a, {"path_id": path_id, "topic": "二次函数"})
    assert first == path_id
    # Upsert bumps revision instead of duplicating.
    await repo.create_path(owner_a, {"path_id": path_id, "topic": "二次函数 v2"})

    state = await repo.load_path(owner_a, path_id)
    assert state["topic"] == "二次函数 v2"
    listed = await repo.list_paths(owner_a)
    assert {p["path_id"] for p in listed} == {path_id}
    assert listed[0]["revision"] >= 2

    # B cannot read or list A's path.
    assert await repo.load_path(owner_b, path_id) is None
    assert await repo.list_paths(owner_b) == []


@pytest.mark.asyncio
async def test_mastery_events_and_interactions_owner_scoped(two_owners, engine):
    owner_a, owner_b = two_owners
    repo = PostgresMasteryRepository(engine)

    path_a = await repo.create_path(owner_a, {"topic": "导数"})
    ev1 = await repo.append_event(owner_a, path_a, "path_started", {"step": 1})
    ev2 = await repo.append_event(owner_a, path_a, "interaction_recorded", {"step": 2})
    assert ev1 != ev2
    revisions = [e["revision"] for e in await repo.list_events(owner_a, path_a)]
    assert revisions == [1, 2]

    await repo.add_interaction(
        owner_a,
        path_a,
        status="answered",
        question={"q": "1+1"},
        user_answer="2",
        result={"correct": True},
    )

    # B must not be able to write evidence onto A's path (FK path ownership).
    with pytest.raises(Exception):
        await repo.append_event(owner_b, path_a, "intrusion", {})
    with pytest.raises(Exception):
        await repo.add_interaction(
            owner_b,
            path_a,
            status="answered",
            question={"q": "x"},
        )

    assert await repo.list_events(owner_b, path_a) == []
