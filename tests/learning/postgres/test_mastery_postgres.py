from __future__ import annotations

import uuid

import pytest

from deeptutor.learning.storage_postgres import (
    OwnershipError,
    PathLeaseConflictError,
    PostgresMasteryRepository,
    RevisionConflictError,
)
from deeptutor.services.session.postgres_store import PostgresSessionStore


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
async def test_deleting_mastery_path_cascades_only_for_owner(two_owners, engine):
    owner_a, owner_b = two_owners
    repo = PostgresMasteryRepository(engine)
    path_id = await repo.create_path(owner_a, {"topic": "函数"})
    await repo.append_event(owner_a, path_id, "created", {})
    await repo.add_interaction(owner_a, path_id, status="answered", question={"q": "x"})

    assert await repo.delete_path(owner_b, path_id) is False
    assert await repo.load_path(owner_a, path_id) is not None
    assert await repo.delete_path(owner_a, path_id) is True
    assert await repo.load_path(owner_a, path_id) is None
    assert await repo.list_events(owner_a, path_id) == []
    assert await repo.list_interactions(owner_a, path_id) == []
    assert await repo.delete_path(owner_a, path_id) is False


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
    assert await repo.get_active_interaction(owner_b, path_a) is None


@pytest.mark.asyncio
async def test_mastery_interaction_and_lease_reads_are_private(two_owners, engine):
    owner_a, owner_b = two_owners
    repo = PostgresMasteryRepository(engine)
    path_id = await repo.create_path(owner_a, {"topic": "Integrals"})
    interaction_id = await repo.add_interaction(
        owner_a, path_id, status="awaiting_input", question={"question_type": "short_answer"},
        session_id="session-a", turn_id="turn-a",
    )
    interaction = await repo.get_interaction(owner_a, path_id, interaction_id)
    assert interaction["status"] == "awaiting_input"
    assert (await repo.get_active_interaction(owner_a, path_id))["interaction_id"] == interaction_id
    assert [item["interaction_id"] for item in await repo.list_interactions(owner_a, path_id)] == [interaction_id]
    assert await repo.get_interaction(owner_b, path_id, interaction_id) is None
    assert await repo.list_interactions(owner_b, path_id) == []
    await repo.acquire_path_lease(owner_a, path_id, "session-a", "turn-a")
    assert (await repo.get_path_lease(owner_a, path_id))["turn_id"] == "turn-a"
    assert await repo.get_path_lease(owner_b, path_id) is None
    assert await repo.release_leases_for_turn(owner_b, "turn-a") == ""
    assert await repo.release_leases_for_turn(owner_a, "turn-a") == path_id


@pytest.mark.asyncio
async def test_mastery_compare_and_swap_rejects_stale_and_foreign_writes(two_owners, engine):
    owner_a, owner_b = two_owners
    repo = PostgresMasteryRepository(engine)
    path_id = await repo.create_path(owner_a, {"topic": "函数"})

    assert await repo.save_path_if_revision(
        owner_a, path_id, {"topic": "函数进阶"}, expected_revision=1
    ) == 2
    with pytest.raises(RevisionConflictError):
        await repo.save_path_if_revision(
            owner_a, path_id, {"topic": "过期内容"}, expected_revision=1
        )
    with pytest.raises(OwnershipError):
        await repo.save_path_if_revision(
            owner_b, path_id, {"topic": "越权内容"}, expected_revision=2
        )
    assert (await repo.load_path(owner_a, path_id))["topic"] == "函数进阶"


@pytest.mark.asyncio
async def test_mastery_revision_commits_events_atomically(two_owners, engine):
    owner_a, owner_b = two_owners
    repo = PostgresMasteryRepository(engine)
    path_id = await repo.create_path(owner_a, {"topic": "初始"})
    event = ("topic.updated", {"value": 1}, "session-1", "turn-1")
    revision = await repo.save_path_if_revision(
        owner_a, path_id, {"topic": "更新"}, expected_revision=1, events=[event]
    )
    assert revision == 2
    rows = await repo.list_events(owner_a, path_id)
    assert [(row["revision"], row["event_type"], row["session_id"], row["turn_id"]) for row in rows] == [
        (2, "topic.updated", "session-1", "turn-1")
    ]
    assert await repo.list_events(owner_b, path_id) == []

    with pytest.raises(ValueError):
        await repo.save_path_if_revision(
            owner_a, path_id, {"topic": "应回滚"}, expected_revision=2,
            events=[("", {}, "", "")],
        )
    assert (await repo.load_path(owner_a, path_id))["topic"] == "更新"
    assert len(await repo.list_events(owner_a, path_id)) == 1


@pytest.mark.asyncio
async def test_mastery_session_binding_and_lease_are_owner_scoped(two_owners, engine):
    owner_a, owner_b = two_owners
    repo = PostgresMasteryRepository(engine)
    sessions = PostgresSessionStore(engine)
    path_id = await repo.create_path(owner_a, {"topic": "导数"})
    session_a = await sessions.create_session(owner_a)
    session_b = await sessions.create_session(owner_b)

    await repo.bind_session(owner_a, path_id, session_a)
    await repo.bind_session(owner_a, path_id, session_a)
    assert await repo.list_session_ids(owner_a, path_id) == [session_a]
    assert await repo.list_session_ids(owner_b, path_id) == []
    with pytest.raises(OwnershipError):
        await repo.bind_session(owner_a, path_id, session_b)

    turn_a = "turn-a-" + uuid.uuid4().hex
    await repo.acquire_path_lease(owner_a, path_id, session_a, turn_a)
    with pytest.raises(PathLeaseConflictError):
        await repo.acquire_path_lease(owner_a, path_id, session_a, "turn-b-" + uuid.uuid4().hex)
    with pytest.raises(OwnershipError):
        await repo.acquire_path_lease(owner_b, path_id, session_b, "turn-c-" + uuid.uuid4().hex)
    assert not await repo.release_path_lease(owner_b, path_id, turn_a)
    assert await repo.release_path_lease(owner_a, path_id, turn_a)


@pytest.mark.asyncio
async def test_mastery_topic_sources_replace_atomically_and_are_private(two_owners, engine):
    owner_a, owner_b = two_owners
    repo = PostgresMasteryRepository(engine)
    path_id = await repo.create_path(owner_a, {"topic": "极限"})
    await repo.put_topic(
        owner_a, path_id, goal="理解极限", sources=[
            {"source_id": "src-" + uuid.uuid4().hex, "kind": "document", "label": "教材"},
        ],
    )
    topic = await repo.get_topic(owner_a, path_id)
    assert topic["goal"] == "理解极限"
    assert [source["label"] for source in topic["sources"]] == ["教材"]
    assert await repo.get_topic(owner_b, path_id) is None
    with pytest.raises(OwnershipError):
        await repo.put_topic(owner_b, path_id, goal="越权")
    await repo.put_topic(owner_a, path_id, goal="掌握极限", sources=[])
    assert (await repo.get_topic(owner_a, path_id))["sources"] == []
