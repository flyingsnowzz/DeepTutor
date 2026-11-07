from __future__ import annotations

import asyncio
import sqlite3
import uuid

import pytest

import deeptutor.learning.assessment as assessment_module
from deeptutor.learning.assessment_postgres import PostgresAssessmentRepository
from deeptutor.learning.assessment import (
    AssessmentRecord, RecordAssessmentError, reconcile_linked_assessments,
    record_assessment,
)
from deeptutor.learning.models import KnowledgePoint, KnowledgeType, LearningModule, LearningProgress
from deeptutor.learning.storage_postgres_sync import PostgresLearningStore
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.multi_user.paths import user_context
from deeptutor.services.session.postgres_scoped import PostgresScopedSessionStore
from deeptutor.services.session.postgres_store import PostgresSessionStore


def _attempt(session_id: str, attempt_id: str, answer: str, occurred_at: float) -> dict:
    return {
        "attempt_id": attempt_id, "session_id": session_id,
        "origin_type": "conversation", "origin_ref": session_id,
        "turn_id": "turn-1", "question_id": "q-1",
        "source": "deep_question", "assessment_type": "quiz",
        "question": "1+1?", "user_answer": answer,
        "result": "correct" if answer == "2" else "incorrect",
        "mastery_path_id": "", "knowledge_point_id": "",
        "occurred_at": occurred_at,
    }


@pytest.mark.asyncio
async def test_attempt_and_latest_card_are_atomic_and_owner_scoped(two_owners, engine):
    owner_a, owner_b = two_owners
    sessions = PostgresSessionStore(engine)
    repo = PostgresAssessmentRepository(engine)
    session_id = await sessions.create_session(owner_a)
    first_id = f"attempt_{uuid.uuid4().hex}"
    second_id = f"attempt_{uuid.uuid4().hex}"
    first = _attempt(session_id, first_id, "1", 1_700_000_000)
    second = _attempt(session_id, second_id, "2", 1_700_000_010)
    card_id, upserted, recorded = await repo.record_assessment(
        owner_a, session_id, {"question": "1+1?", "result": "incorrect"}, first
    )
    assert card_id > 0 and upserted and recorded
    practice = await sessions.notebook_practice.state(owner_a, card_id)
    assert practice["is_mistake"] is True
    assert practice["due_at"] == pytest.approx(1_700_000_000 + 86400)
    assert (await sessions.notebook_practice.state(owner_b, card_id))["due_at"] is None
    assert await repo.record_assessment(owner_a, session_id, {}, first) == (card_id, False, False)
    with pytest.raises(ValueError, match="Conflicting assessment"):
        await repo.record_assessment(owner_a, session_id, {}, {**first, "user_answer": "3"})
    _, upserted, recorded = await repo.record_assessment(
        owner_a, session_id, {"question": "1+1?", "result": "correct", "is_correct": True}, second
    )
    assert upserted and recorded
    card = await repo.get_card(owner_a, "conversation", session_id, "turn-1", "q-1")
    assert card["id"] == card_id and card["latest_attempt_id"] == second_id
    assert card["resolved"] is True
    assert await repo.get_card(owner_b, "conversation", session_id, "turn-1", "q-1") is None
    assert await repo.get_assessment_attempt(owner_b, first_id) is None
    assert len(await repo.list_assessment_attempts(owner_a, session_id)) == 2
    assert await repo.list_assessment_attempts(owner_b, session_id) == []
    older = _attempt(session_id, f"attempt_{uuid.uuid4().hex}", "3", 1_699_999_999)
    _, upserted, recorded = await repo.record_assessment(owner_a, session_id, {}, older)
    assert not upserted and recorded
    assert (await repo.get_card(owner_a, "conversation", session_id, "turn-1", "q-1"))["latest_attempt_id"] == second_id
    with pytest.raises(ValueError, match="Session not found"):
        await repo.record_assessment(owner_b, session_id, {}, _attempt(session_id, f"attempt_{uuid.uuid4().hex}", "2", 1_700_000_020))


@pytest.mark.asyncio
async def test_concurrent_attempt_replay_and_linkage_queue(two_owners, engine):
    owner_a, owner_b = two_owners
    sessions = PostgresSessionStore(engine)
    repo = PostgresAssessmentRepository(engine)
    session_id = await sessions.create_session(owner_a)
    attempt = _attempt(session_id, f"attempt_{uuid.uuid4().hex}", "2", 1_700_000_000)
    attempt.update(source="book_focus_check", mastery_path_id="path-x", knowledge_point_id="kp-x")
    item = {"question": "1+1?", "result": "correct", "is_correct": True}
    first, second = await asyncio.gather(
        repo.record_assessment(owner_a, session_id, item, attempt),
        repo.record_assessment(owner_a, session_id, item, attempt),
    )
    assert sorted([first[2], second[2]]) == [False, True]
    assert len(await repo.pending_linked_assessments(owner_a)) == 1
    assert await repo.pending_linked_assessments(owner_b) == []
    assert not await repo.mark_assessment_link_applied(owner_b, attempt["attempt_id"])
    assert await repo.mark_assessment_link_applied(owner_a, attempt["attempt_id"])
    assert await repo.pending_linked_assessments(owner_a) == []


@pytest.mark.asyncio
async def test_assessment_adapter_routes_to_scoped_postgres_store(
    two_owners, engine, monkeypatch
):
    owner_a, _ = two_owners
    sessions = PostgresSessionStore(engine)
    scoped = PostgresScopedSessionStore(sessions, owner_a, "test")
    session_id = await sessions.create_session(owner_a)
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setattr("deeptutor.services.session.get_session_store", lambda: scoped)
    record = AssessmentRecord(
        session_id=session_id, turn_id="turn-1", question_id="q-1",
        question="1+1?", result="correct", is_correct=True,
        source="mastery_path", mastery_path_id="path-x", knowledge_point_id="kp-x",
        attempt_id=f"attempt_{uuid.uuid4().hex}",
    )
    outcome = await record_assessment(record)
    assert outcome.attempt_recorded and outcome.entry_id is not None
    assert (await scoped.get_assessment_attempt(outcome.attempt_id))["question"] == "1+1?"
    assert not (await record_assessment(record)).attempt_recorded
    linked = record.model_copy(update={
        "source": "book_focus_check", "attempt_id": f"attempt_{uuid.uuid4().hex}"
    })
    with pytest.raises(RecordAssessmentError):
        await record_assessment(linked)
    assert await scoped.get_assessment_attempt(linked.attempt_id) is None


@pytest.mark.asyncio
async def test_linked_assessment_updates_postgres_mastery_once_and_recovers(
    two_owners, engine, database_url, monkeypatch, tmp_path
):
    owner_a, owner_b = two_owners
    sessions = PostgresSessionStore(engine)
    scoped = PostgresScopedSessionStore(sessions, owner_a, "test")
    session_id = await sessions.create_session(owner_a)
    path_id = f"path_{uuid.uuid4().hex}"
    learning = PostgresLearningStore(owner_a, url=database_url)
    other_learning = PostgresLearningStore(owner_b, url=database_url)
    learning.save(LearningProgress(
        book_id=path_id,
        modules=[LearningModule(
            id="module-1", name="Module", order=0,
            knowledge_points=[KnowledgePoint(
                id="kp-1", name="Concept", type=KnowledgeType.CONCEPT,
                module_id="module-1",
            )],
        )],
        knowledge_types={"kp-1": KnowledgeType.CONCEPT},
    ))
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setattr("deeptutor.services.session.get_session_store", lambda: scoped)
    sqlite_connect = sqlite3.connect

    def reject_file_sqlite(database, *args, **kwargs):
        if str(database) != ":memory:":
            raise AssertionError(f"PostgreSQL assessment opened file SQLite: {database}")
        return sqlite_connect(database, *args, **kwargs)

    monkeypatch.setattr(sqlite3, "connect", reject_file_sqlite)
    record = AssessmentRecord(
        session_id=session_id, turn_id="book-turn", question_id="book-q",
        question="Explain the concept", user_answer="Answer",
        result="correct", is_correct=True, source="book",
        assessment_type="focus_check", mastery_path_id=path_id,
        knowledge_point_id="kp-1", attempt_id=f"attempt_{uuid.uuid4().hex}",
    )
    user = CurrentUser(
        id=owner_a, username=owner_a, role="user",
        scope=UserScope(kind="user", user_id=owner_a, root=tmp_path / owner_a),
    )
    with user_context(user):
        first = await record_assessment(record)
        second = await record_assessment(record)
        assert "linked_retention_updated" in first.diagnostics
        assert not second.attempt_recorded
        assert len(learning.load(path_id).learning_evidence) == 1
        assert other_learning.load(path_id) is None
        assert await scoped.pending_linked_assessments() == []

        interrupted = record.model_copy(update={
            "attempt_id": f"attempt_{uuid.uuid4().hex}", "turn_id": "next-turn",
        })
        apply_retention = assessment_module._apply_linked_retention

        def interrupt(*args, **kwargs):
            raise RuntimeError("interrupted")

        monkeypatch.setattr(assessment_module, "_apply_linked_retention", interrupt)
        with pytest.raises(RecordAssessmentError):
            await record_assessment(interrupted)
        assert len(await scoped.pending_linked_assessments()) == 1
        monkeypatch.setattr(assessment_module, "_apply_linked_retention", apply_retention)
        assert await reconcile_linked_assessments() == (1, 0)
        assert len(learning.load(path_id).learning_evidence) == 2
        assert await scoped.pending_linked_assessments() == []
