"""Owner-scoped, transactional assessment attempts and current question cards."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import time
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.core.assessment import QUESTION_ORIGIN_TYPES
from deeptutor.services.postgres.database import session_factory


_IDENTITY_FIELDS = (
    "origin_type", "origin_ref", "turn_id", "question_id", "source",
    "assessment_type", "user_answer", "result", "mastery_path_id",
    "knowledge_point_id",
)


def _origin(session_id: str | None, payload: dict[str, Any]) -> tuple[str | None, str, str]:
    navigation = str(session_id or payload.get("session_id") or "").strip() or None
    kind = str(payload.get("origin_type") or "conversation").strip()
    if kind not in QUESTION_ORIGIN_TYPES:
        raise ValueError(f"Unsupported question origin: {kind}")
    ref = str(payload.get("origin_ref") or "").strip()
    if kind == "conversation":
        if navigation is None:
            raise ValueError("Conversation question origins require session_id")
        if ref and ref != navigation:
            raise ValueError("Conversation origin_ref must match session_id")
        ref = navigation
    elif not ref:
        raise ValueError(f"{kind} question origins require origin_ref")
    return navigation, kind, ref


class PostgresAssessmentRepository:
    def __init__(self, engine: AsyncEngine):
        self._sessions = session_factory(engine)

    async def record_assessment(
        self, owner_user_id: str, session_id: str | None,
        item: dict[str, Any], attempt: dict[str, Any],
    ) -> tuple[int, bool, bool]:
        attempt_id = str(attempt.get("attempt_id") or "").strip()
        question_id = str(attempt.get("question_id") or "").strip()
        if not attempt_id or not question_id:
            raise ValueError("attempt_id and question_id are required")
        navigation, kind, ref = _origin(session_id, attempt)
        turn_id = str(attempt.get("turn_id") or "").strip()
        occurred_at = datetime.fromtimestamp(
            float(attempt.get("occurred_at") or time.time()), timezone.utc
        )
        item = {
            **item,
            "resolved": bool(item.get("resolved", False))
            if item.get("result") == "ungraded"
            else bool(item.get("result") == "voided" or item.get("is_correct")),
            "bookmarked": bool(item.get("bookmarked", False)),
        }
        key = f"{owner_user_id}:{kind}:{ref}:{turn_id}:{question_id}"
        async with self._sessions() as db:
            await db.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
                {"key": key},
            )
            existing = (
                await db.execute(
                    text("""SELECT owner_user_id,attempt_json,card_id
                            FROM assessment_attempts
                            WHERE id=:attempt AND owner_user_id=:owner FOR UPDATE"""),
                    {"attempt": attempt_id, "owner": owner_user_id},
                )
            ).mappings().first()
            if existing is not None:
                if existing["owner_user_id"] != owner_user_id:
                    raise PermissionError("assessment attempt belongs to another user")
                original = existing["attempt_json"] or {}
                if any(original.get(field) != attempt.get(field) for field in _IDENTITY_FIELDS):
                    raise ValueError(f"Conflicting assessment submission id: {attempt_id}")
                return int(existing["card_id"] or 0), False, False
            if navigation is not None:
                owns_session = (
                    await db.execute(
                        text("""SELECT 1 FROM sessions
                                WHERE id=:session AND owner_user_id=:owner"""),
                        {"session": navigation, "owner": owner_user_id},
                    )
                ).scalar_one_or_none()
                if owns_session is None:
                    raise ValueError(f"Session not found: {navigation}")
            if str(attempt.get("source") or "") == "immersive_reading":
                count = (
                    await db.execute(
                        text("""SELECT count(*) FROM assessment_attempts
                                WHERE owner_user_id=:owner
                                  AND attempt_json->>'origin_type'=:kind
                                  AND attempt_json->>'origin_ref'=:ref
                                  AND attempt_json->>'turn_id'=:turn
                                  AND attempt_json->>'question_id'=:question"""),
                        {
                            "owner": owner_user_id, "kind": kind, "ref": ref,
                            "turn": turn_id, "question": question_id,
                        },
                    )
                ).scalar_one()
                attempt = {**attempt, "attempt_count": int(count) + 1}
                item = {**item, "attempt_count": int(count) + 1}
            card = (
                await db.execute(
                    text("""SELECT id,latest_attempt_id,latest_attempt_at,card_json
                            FROM assessment_cards WHERE owner_user_id=:owner
                              AND origin_type=:kind AND origin_ref=:ref
                              AND turn_id=:turn AND question_id=:question FOR UPDATE"""),
                    {
                        "owner": owner_user_id, "kind": kind, "ref": ref,
                        "turn": turn_id, "question": question_id,
                    },
                )
            ).mappings().first()
            is_latest = card is None or card["latest_attempt_at"] is None or (
                occurred_at, attempt_id
            ) >= (card["latest_attempt_at"], card["latest_attempt_id"] or "")
            if card is None:
                card_id = (
                    await db.execute(
                        text("""INSERT INTO assessment_cards
                                (owner_user_id,session_id,origin_type,origin_ref,turn_id,
                                 question_id,card_json,latest_attempt_id,latest_attempt_at)
                                VALUES (:owner,:session,:kind,:ref,:turn,:question,
                                        CAST(:card AS JSONB),:attempt,:occurred) RETURNING id"""),
                        {
                            "owner": owner_user_id, "session": navigation,
                            "kind": kind, "ref": ref, "turn": turn_id,
                            "question": question_id,
                            "card": json.dumps(item, ensure_ascii=False),
                            "attempt": attempt_id, "occurred": occurred_at,
                        },
                    )
                ).scalar_one()
            else:
                card_id = card["id"]
                if is_latest:
                    prior = card["card_json"] or {}
                    updated = {**prior, **item}
                    if item.get("result") == "ungraded":
                        updated["resolved"] = prior.get("resolved", False)
                    elif item.get("result") == "voided" or item.get("is_correct"):
                        updated["resolved"] = True
                    elif prior.get("is_correct"):
                        updated["resolved"] = False
                    await db.execute(
                        text("""UPDATE assessment_cards
                                SET card_json=CAST(:card AS JSONB),session_id=:session,
                                    latest_attempt_id=:attempt,latest_attempt_at=:occurred,
                                    updated_at=now() WHERE id=:card_id AND owner_user_id=:owner"""),
                        {
                            "card": json.dumps(updated, ensure_ascii=False),
                            "session": navigation, "attempt": attempt_id,
                            "occurred": occurred_at, "card_id": card_id,
                            "owner": owner_user_id,
                        },
                    )
            if is_latest:
                prior = dict(card["card_json"] or {}) if card is not None else {}
                current = dict(item) if card is None else {**prior, **item}
                changed_key = card is not None and any(
                    prior.get(field) != current.get(field)
                    for field in ("question", "options", "correct_answer")
                )
                if changed_key:
                    await db.execute(text("""
                        UPDATE notebook_practice_state SET version=version+1
                        WHERE owner_user_id=:owner AND entry_id=:card
                    """), {"owner": owner_user_id, "card": card_id})
                if (not bool(current.get("is_correct"))
                    and current.get("result") != "ungraded"):
                    reset = bool(prior.get("is_correct")) or prior.get("result") == "ungraded"
                    await db.execute(text("""
                        INSERT INTO notebook_practice_state
                          (owner_user_id,entry_id,is_mistake,first_wrong_at,due_at)
                        VALUES (:owner,:card,true,:occurred,:due)
                        ON CONFLICT (owner_user_id,entry_id) DO UPDATE SET
                          is_mistake=true,
                          first_wrong_at=CASE WHEN :reset AND NOT notebook_practice_state.is_mistake
                            THEN :occurred ELSE notebook_practice_state.first_wrong_at END,
                          due_at=CASE WHEN :reset THEN :due ELSE notebook_practice_state.due_at END,
                          interval_days=CASE WHEN :reset THEN 1 ELSE notebook_practice_state.interval_days END,
                          streak=CASE WHEN :reset THEN 0 ELSE notebook_practice_state.streak END,
                          version=CASE WHEN :reset THEN notebook_practice_state.version+1
                            ELSE notebook_practice_state.version END
                    """), {"owner": owner_user_id, "card": card_id,
                           "occurred": occurred_at,
                           "due": occurred_at + timedelta(days=1),
                           "reset": reset})
            inserted = await db.execute(
                text("""INSERT INTO assessment_attempts
                        (id,owner_user_id,session_id,path_id,knowledge_point_id,
                         attempt_json,linked_applied,created_at,card_id)
                        VALUES (:attempt,:owner,:session,:path,:kp,CAST(:payload AS JSONB),
                                false,:occurred,:card_id)
                        ON CONFLICT (id) DO NOTHING RETURNING id"""),
                {
                    "attempt": attempt_id, "owner": owner_user_id,
                    "session": navigation or "",
                    "path": str(attempt.get("mastery_path_id") or ""),
                    "kp": str(attempt.get("knowledge_point_id") or ""),
                    "payload": json.dumps(attempt, ensure_ascii=False),
                    "occurred": occurred_at, "card_id": card_id,
                },
            )
            if inserted.scalar_one_or_none() is None:
                raise ValueError(f"Conflicting assessment submission id: {attempt_id}")
            await db.commit()
            return int(card_id), bool(is_latest), True

    async def get_card(
        self, owner_user_id: str, origin_type: str, origin_ref: str,
        turn_id: str, question_id: str,
    ) -> dict[str, Any] | None:
        async with self._sessions() as db:
            row = (
                await db.execute(
                    text("""SELECT id,card_json,latest_attempt_id FROM assessment_cards
                            WHERE owner_user_id=:owner AND origin_type=:kind
                              AND origin_ref=:ref AND turn_id=:turn
                              AND question_id=:question"""),
                    {
                        "owner": owner_user_id, "kind": origin_type,
                        "ref": origin_ref, "turn": turn_id,
                        "question": question_id,
                    },
                )
            ).mappings().first()
        return {
            "id": int(row["id"]), **(row["card_json"] or {}),
            "latest_attempt_id": row["latest_attempt_id"],
        } if row is not None else None

    async def get_assessment_attempt(
        self, owner_user_id: str, attempt_id: str
    ) -> dict[str, Any] | None:
        async with self._sessions() as db:
            value = (
                await db.execute(
                    text("""SELECT attempt_json FROM assessment_attempts
                            WHERE id=:attempt AND owner_user_id=:owner"""),
                    {"attempt": attempt_id, "owner": owner_user_id},
                )
            ).scalar_one_or_none()
        return dict(value) if isinstance(value, dict) else None

    async def list_assessment_attempts(
        self, owner_user_id: str, session_id: str, *, question_id: str = ""
    ) -> list[dict[str, Any]]:
        async with self._sessions() as db:
            rows = (
                await db.execute(
                    text("""SELECT attempt_json FROM assessment_attempts
                            WHERE owner_user_id=:owner AND session_id=:session
                              AND (:question='' OR attempt_json->>'question_id'=:question)
                            ORDER BY created_at,id"""),
                    {
                        "owner": owner_user_id, "session": session_id,
                        "question": question_id,
                    },
                )
            ).scalars().all()
        return [dict(value) for value in rows if isinstance(value, dict)]

    async def pending_linked_assessments(
        self, owner_user_id: str
    ) -> list[dict[str, Any]]:
        async with self._sessions() as db:
            rows = (
                await db.execute(
                    text("""SELECT attempt_json FROM assessment_attempts
                            WHERE owner_user_id=:owner AND NOT linked_applied
                              AND path_id!='' AND knowledge_point_id!=''
                              AND attempt_json->>'source'!='mastery_path'
                              AND attempt_json->>'result' NOT IN ('ungraded','voided')
                            ORDER BY created_at,id"""),
                    {"owner": owner_user_id},
                )
            ).scalars().all()
        return [dict(value) for value in rows if isinstance(value, dict)]

    async def mark_assessment_link_applied(
        self, owner_user_id: str, attempt_id: str
    ) -> bool:
        async with self._sessions() as db:
            updated = (
                await db.execute(
                    text("""UPDATE assessment_attempts SET linked_applied=true
                            WHERE id=:attempt AND owner_user_id=:owner RETURNING id"""),
                    {"attempt": attempt_id, "owner": owner_user_id},
                )
            ).scalar_one_or_none()
            await db.commit()
        return updated is not None
