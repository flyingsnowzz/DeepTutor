from __future__ import annotations

import uuid

import psycopg
import pytest

from deeptutor.learning.models import (
    InteractionStatus, LearningEvidence, LearningProgress, MasteryInteraction, PendingQuestion,
    TopicMetadata, TopicSource, TopicSourceKind,
)
from deeptutor.learning.storage import LearningConflictError, PathLeaseConflictError
from deeptutor.learning.storage_postgres_sync import PostgresLearningStore
from deeptutor.learning.storage_postgres import PostgresMasteryRepository
from deeptutor.services.session.postgres_store import PostgresSessionStore


@pytest.mark.asyncio
async def test_sync_mastery_store_owner_scope_cas_and_rollback(two_owners, database_url):
    owner_a, owner_b = two_owners
    a = PostgresLearningStore(owner_a, url=database_url)
    b = PostgresLearningStore(owner_b, url=database_url)
    path_id = f"path_{uuid.uuid4().hex}"

    progress = LearningProgress(book_id=path_id)
    a.save(progress)
    assert progress.version == 1
    assert a.exists(path_id)
    assert b.load(path_id) is None
    assert path_id in a.list_all()
    assert path_id not in b.list_all()

    stale = a.load(path_id)
    with a.transaction(path_id) as tx:
        tx.progress.name = "Updated"
        tx.emit("topic.updated", {"value": 1}, session_id="s1", turn_id="t1")
    assert a.load(path_id).version == 2
    assert a.load(path_id).name == "Updated"
    with pytest.raises(LearningConflictError):
        a.save(stale)

    with pytest.raises(RuntimeError):
        with a.transaction(path_id) as tx:
            tx.progress.name = "Rolled back"
            tx.touch()
            raise RuntimeError("abort")
    assert a.load(path_id).name == "Updated"
    assert a.load(path_id).version == 2

    b.delete(path_id)
    assert a.exists(path_id)
    a.delete(path_id)
    assert a.load(path_id) is None


@pytest.mark.asyncio
async def test_sync_mastery_store_requires_owner(database_url):
    with pytest.raises(ValueError, match="authenticated owner"):
        PostgresLearningStore("", url=database_url)


@pytest.mark.asyncio
async def test_sync_mastery_interactions_are_atomic_and_owner_scoped(two_owners, database_url):
    owner_a, owner_b = two_owners
    a = PostgresLearningStore(owner_a, url=database_url)
    b = PostgresLearningStore(owner_b, url=database_url)
    path_a = f"path_{uuid.uuid4().hex}"
    path_b = f"path_{uuid.uuid4().hex}"
    a.save(LearningProgress(book_id=path_a))
    b.save(LearningProgress(book_id=path_b))
    interaction_id = f"question_{uuid.uuid4().hex}"
    question = PendingQuestion(
        question_id=interaction_id, knowledge_point_id="kp-1",
        prompt="Question?", expected_answer="answer",
    )
    interaction = MasteryInteraction(
        interaction_id=interaction_id, path_id=path_a, question=question,
    )
    with a.transaction(path_a) as tx:
        tx.put_interaction(interaction)
        assert tx.active_interaction().interaction_id == interaction_id

    with a.transaction(path_a) as tx:
        saved = tx.get_interaction(interaction_id)
        assert saved.status == InteractionStatus.REGISTERED
        saved.status = InteractionStatus.GRADED
        tx.put_interaction(saved)
        assert tx.active_interaction() is None

    with b.transaction(path_b) as tx:
        assert tx.get_interaction(interaction_id) is None
        with pytest.raises(ValueError, match="another owner or path"):
            tx.put_interaction(MasteryInteraction(
                interaction_id=interaction_id, path_id=path_b, question=question,
            ))

    with a.transaction(path_a) as tx:
        assert tx.get_interaction(interaction_id).status == InteractionStatus.GRADED
        assert tx.abandon_active_interactions() == 0
    assert a.get_interaction(path_a, interaction_id).status == InteractionStatus.GRADED
    assert a.get_active_interaction(path_a) is None
    assert [item.interaction_id for item in a.list_interactions(path_a)] == [interaction_id]
    assert b.get_interaction(path_a, interaction_id) is None
    assert b.list_interactions(path_a) == []


@pytest.mark.asyncio
async def test_sync_mastery_module_preview_has_numeric_scoped_id(two_owners, database_url):
    owner_a, owner_b = two_owners
    a = PostgresLearningStore(owner_a, url=database_url)
    b = PostgresLearningStore(owner_b, url=database_url)
    path_id = f"path_{uuid.uuid4().hex}"
    a.save(LearningProgress(book_id=path_id))
    with a.transaction(path_id) as tx:
        preview_id = tx.record_module_preview({"modules": ["A"]}, session_id="s1")
    assert type(preview_id) is int and preview_id > 0
    assert a.load(path_id).version == 1
    with a.transaction(path_id) as tx:
        assert tx.module_preview(preview_id, session_id="s1") == {
            "modules": ["A"], "committed_revision": None,
        }
        with pytest.raises(ValueError, match="unavailable"):
            tx.module_preview(preview_id, session_id="s2")
        tx.emit("path.modules_revision_committed", {"preview_id": preview_id})
    with a.transaction(path_id) as tx:
        assert tx.module_preview(preview_id, session_id="s1")["committed_revision"] == 2
    assert b.list_events(path_id) == []
    assert any(event.id == preview_id for event in a.list_events(path_id))


@pytest.mark.asyncio
async def test_sync_mastery_rejects_two_active_interactions(two_owners, database_url):
    owner_a, _ = two_owners
    store = PostgresLearningStore(owner_a, url=database_url)
    path_id = f"path_{uuid.uuid4().hex}"
    store.save(LearningProgress(book_id=path_id))

    def question(index: int) -> MasteryInteraction:
        interaction_id = f"q_{index}_{uuid.uuid4().hex}"
        return MasteryInteraction(
            interaction_id=interaction_id, path_id=path_id,
            question=PendingQuestion(
                question_id=interaction_id, knowledge_point_id="kp-1",
                prompt="Question?", expected_answer="answer",
            ),
        )

    with pytest.raises(psycopg.errors.UniqueViolation):
        with store.transaction(path_id) as tx:
            tx.put_interaction(question(1))
            tx.put_interaction(question(2))
    assert store.list_interactions(path_id) == []
    assert store.load(path_id).version == 1


@pytest.mark.asyncio
async def test_sync_mastery_topic_sources_replace_atomically_and_are_private(two_owners, database_url, engine):
    owner_a, owner_b = two_owners
    a = PostgresLearningStore(owner_a, url=database_url)
    b = PostgresLearningStore(owner_b, url=database_url)
    path_id = f"path_{uuid.uuid4().hex}"
    a.save(LearningProgress(book_id=path_id))
    source = TopicSource(
        id=f"src_{uuid.uuid4().hex}", kind=TopicSourceKind.BOOK,
        source_id="book-1", label="教材", metadata={"chapter": 1},
    )
    topic = a.put_topic(TopicMetadata(path_id=path_id, goal="掌握导数"), [source])
    assert topic.metadata.goal == "掌握导数"
    assert topic.metadata.map_seed > 0
    assert topic.sources[0].source_id == "book-1"
    assert topic.sources[0].metadata == {"chapter": 1}
    assert a.has_active_topics()
    assert not b.has_active_topics()
    assert b.get_topic(path_id) is None
    assert a.load(path_id).version == 2
    session_id = await PostgresSessionStore(engine).create_session(owner_a)
    await PostgresMasteryRepository(engine).bind_session(owner_a, path_id, session_id)
    interaction_id = f"q_{uuid.uuid4().hex}"
    with a.transaction(path_id) as tx:
        tx.put_interaction(MasteryInteraction(
            interaction_id=interaction_id, path_id=path_id,
            question=PendingQuestion(
                question_id=interaction_id, knowledge_point_id="kp-1",
                prompt="Question?", expected_answer="answer",
            ),
        ))
    snapshots = a.list_topic_snapshots()
    assert len(snapshots) == 1
    assert snapshots[0][0].book_id == path_id
    assert snapshots[0][1].sources[0].id == source.id
    assert snapshots[0][2] == 1
    assert snapshots[0][3].interaction_id == interaction_id
    assert b.list_topic_snapshots() == []

    with pytest.raises(RuntimeError):
        with a.transaction(path_id) as tx:
            tx.put_topic(TopicMetadata(path_id=path_id, goal="应回滚"), [])
            assert tx.topic_sources() == []
            raise RuntimeError("abort")
    assert a.get_topic(path_id).metadata.goal == "掌握导数"
    assert len(a.get_topic(path_id).sources) == 1
    assert a.load(path_id).version == 3

    replaced = a.put_topic(TopicMetadata(path_id=path_id, goal="归档", status="archived"), [])
    assert replaced.sources == []
    assert replaced.metadata.status == "archived"
    assert not a.has_active_topics()


@pytest.mark.asyncio
async def test_sync_mastery_evidence_projection_tracks_aggregate_atomically(two_owners, database_url):
    owner_a, owner_b = two_owners
    a = PostgresLearningStore(owner_a, url=database_url)
    b = PostgresLearningStore(owner_b, url=database_url)
    path_id = f"path_{uuid.uuid4().hex}"
    a.save(LearningProgress(book_id=path_id))
    item = LearningEvidence(
        knowledge_point_id="kp-1", result="correct", source="mastery_path",
    )
    with a.transaction(path_id) as tx:
        tx.progress.learning_evidence.append(item)
        tx.touch()
    assert a.count_learning_evidence(path_id) == 1
    assert a.list_learning_evidence(path_id)[0].knowledge_point_id == "kp-1"
    loaded, evidence, count = a.load_with_learning_evidence(path_id, "kp-1")
    assert loaded.version == 2 and count == 1 and len(evidence) == 1
    assert b.count_learning_evidence(path_id) == 0
    assert b.list_learning_evidence(path_id) == []

    with pytest.raises(RuntimeError):
        with a.transaction(path_id) as tx:
            tx.progress.learning_evidence.clear()
            tx.touch()
            raise RuntimeError("abort")
    assert a.count_learning_evidence(path_id) == 1
    with a.transaction(path_id) as tx:
        tx.progress.learning_evidence.clear()
        tx.touch()
    assert a.count_learning_evidence(path_id) == 0
    a.rebuild_learning_evidence_projection(path_id)
    assert a.count_learning_evidence(path_id) == 0


@pytest.mark.asyncio
async def test_sync_mastery_session_membership_and_scratch_cleanup(two_owners, database_url, engine):
    owner_a, owner_b = two_owners
    a = PostgresLearningStore(owner_a, url=database_url)
    b = PostgresLearningStore(owner_b, url=database_url)
    sessions = PostgresSessionStore(engine)
    session_a = await sessions.create_session(owner_a)
    session_a2 = await sessions.create_session(owner_a)
    session_b = await sessions.create_session(owner_b)
    path_id = f"path_{uuid.uuid4().hex}"
    other_id = f"path_{uuid.uuid4().hex}"

    a.bind_session(path_id, session_a, owns_path=True)
    assert a.exists(path_id)
    assert a.path_id_for_session(session_a) == path_id
    assert a.list_session_ids(path_id) == [session_a]
    assert b.path_id_for_session(session_a) == ""
    with pytest.raises(KeyError):
        a.bind_session(path_id, session_b)
    a.bind_session(other_id, session_a)
    assert a.path_id_for_session(session_a) == other_id
    assert a.list_session_ids(path_id) == []

    a.bind_session(path_id, session_a2)
    assert a.detach_session(session_a) == []
    assert a.exists(path_id)
    assert a.detach_session(session_a2) == []
    assert a.exists(path_id)
    scratch_id = f"path_{uuid.uuid4().hex}"
    scratch_session = await sessions.create_session(owner_a)
    a.bind_session(scratch_id, scratch_session, owns_path=True)
    assert a.detach_session(scratch_session) == [scratch_id]
    assert not a.exists(scratch_id)
    assert b.detach_session(session_a2) == []


@pytest.mark.asyncio
async def test_sync_mastery_lease_excludes_other_turns(two_owners, database_url, engine):
    owner_a, owner_b = two_owners
    a = PostgresLearningStore(owner_a, url=database_url)
    b = PostgresLearningStore(owner_b, url=database_url)
    session_id = await PostgresSessionStore(engine).create_session(owner_a)
    path_id = f"path_{uuid.uuid4().hex}"
    first = a.acquire_path_lease(path_id, session_id, "turn-1")
    assert first.turn_id == "turn-1"
    assert a.get_path_lease(path_id).turn_id == "turn-1"
    assert b.get_path_lease(path_id) is None
    assert a.acquire_path_lease(path_id, session_id, "turn-1").turn_id == "turn-1"
    with pytest.raises(PathLeaseConflictError):
        a.acquire_path_lease(path_id, session_id, "turn-2")
    assert b.release_leases_for_turn("turn-1") == ""
    assert not a.release_path_lease(path_id, turn_id="turn-2")
    assert a.release_leases_for_turn("turn-1") == path_id
    assert a.get_path_lease(path_id) is None


@pytest.mark.asyncio
async def test_reading_records_survive_restart_and_are_private(two_owners, database_url):
    owner_a, owner_b = two_owners
    a = PostgresLearningStore(owner_a, url=database_url)
    b = PostgresLearningStore(owner_b, url=database_url)
    first = a.record_reading_position("book-1", locator=8, percentage=0.8)
    assert first.furthest_locator == 8
    back = a.record_reading_position("book-1", locator=3, percentage=0.3)
    assert back.latest_locator == 3
    assert back.furthest_locator == 8
    assert back.furthest_percentage == 0.8
    activity = a.record_reading_activity(
        "book-1", extension_id="summary", action="open",
        locator=3, result_type="card",
    )
    b.record_reading_position("book-1", locator=1, percentage=0.1)
    restarted = PostgresLearningStore(owner_a, url=database_url)
    records = restarted.list_reading_records()
    assert records.progress[0].latest_locator == 3
    assert records.progress[0].furthest_locator == 8
    assert [row.activity_id for row in records.activities] == [activity.activity_id]
    assert b.list_reading_records().progress[0].latest_locator == 1
    assert b.list_reading_records().activities == []
