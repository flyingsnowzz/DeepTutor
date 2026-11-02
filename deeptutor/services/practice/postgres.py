from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from typing import Any
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.services.postgres.database import session_factory


class PracticeOwnershipError(PermissionError):
    """Raised when an explicit entry id already belongs to another owner."""


class PracticeEntryNotFoundError(LookupError):
    pass


class DuplicateRequestError(ValueError):
    """A different write already used this idempotency request id."""


def _normalize_answer(value: str) -> str:
    return "".join((value or "").upper().split())


class PostgresPracticeRepository:
    def __init__(self, engine: AsyncEngine):
        self._sessions = session_factory(engine)

    @staticmethod
    def new_entry_id() -> str:
        return f"practice_{uuid.uuid4().hex}"

    # ------------------------------------------------------------------ writes
    async def add_entry(self, owner_user_id: str, payload: dict[str, Any]) -> str:
        entry_id = payload.get("id") or self.new_entry_id()
        async with self._sessions() as db:
            if payload.get("id"):
                existing_owner = (
                    await db.execute(
                        text("SELECT owner_user_id FROM practice_entries WHERE id=:id"),
                        {"id": entry_id},
                    )
                ).scalar_one_or_none()
                if existing_owner is not None and existing_owner != owner_user_id:
                    raise PracticeOwnershipError(
                        f"practice entry {entry_id} belongs to another user"
                    )
            await db.execute(
                text(
                    """INSERT INTO practice_entries (
                        id, owner_user_id, session_id, origin_type, origin_ref, question_id, question,
                        question_type, options_json, correct_answer, explanation, difficulty, user_answer,
                        source, mastery_path_id, knowledge_point_id, is_correct, resolved, bookmarked,
                        attempt_count, created_at, updated_at)
                    VALUES (
                        :id,:owner,:session_id,:origin_type,:origin_ref,:question_id,:question,
                        :question_type,CAST(:options AS JSONB),:correct_answer,:explanation,:difficulty,:user_answer,
                        :source,:path_id,:kp_id,:is_correct,:resolved,:bookmarked,:attempt_count,now(),now())
                    ON CONFLICT (id) DO NOTHING"""
                ),
                {
                    "id": entry_id,
                    "owner": owner_user_id,
                    "session_id": payload.get("session_id"),
                    "origin_type": payload.get("origin_type", "conversation"),
                    "origin_ref": payload.get("origin_ref", ""),
                    "question_id": payload.get("question_id", entry_id),
                    "question": payload.get("question", ""),
                    "question_type": payload.get("question_type", ""),
                    "options": json.dumps(payload.get("options") or {}, ensure_ascii=False),
                    "correct_answer": payload.get("correct_answer", ""),
                    "explanation": payload.get("explanation", ""),
                    "difficulty": payload.get("difficulty", ""),
                    "user_answer": payload.get("user_answer", ""),
                    "source": payload.get("source", "deep_question"),
                    "path_id": payload.get("mastery_path_id"),
                    "kp_id": payload.get("knowledge_point_id"),
                    "is_correct": bool(payload.get("is_correct", False)),
                    "resolved": bool(payload.get("resolved", False)),
                    "bookmarked": bool(payload.get("bookmarked", False)),
                    "attempt_count": int(payload.get("attempt_count", 1)),
                },
            )
            await db.commit()
        return entry_id

    async def set_bookmark(self, owner_user_id: str, entry_id: str, bookmarked: bool) -> bool:
        async with self._sessions() as db:
            result = await db.execute(
                text(
                    "UPDATE practice_entries SET bookmarked=:flag, updated_at=now() "
                    "WHERE id=:id AND owner_user_id=:owner"
                ),
                {"flag": bookmarked, "id": entry_id, "owner": owner_user_id},
            )
            await db.commit()
            return result.rowcount > 0

    # ------------------------------------------------------------------- reads
    async def get_entry(self, owner_user_id: str, entry_id: str) -> dict[str, Any] | None:
        async with self._sessions() as db:
            row = (
                (
                    await db.execute(
                        text(
                            """SELECT id, session_id, question_id, question, question_type, options_json,
                                  correct_answer, explanation, difficulty, user_answer, source,
                                  mastery_path_id, knowledge_point_id, is_correct, resolved, bookmarked,
                                  attempt_count, created_at, updated_at
                           FROM practice_entries WHERE id=:id AND owner_user_id=:owner"""
                        ),
                        {"id": entry_id, "owner": owner_user_id},
                    )
                )
                .mappings()
                .first()
            )
            if not row:
                return None
            data = dict(row)
            data["options"] = data.pop("options_json") or {}
            return data

    async def list_entries(
        self,
        owner_user_id: str,
        limit: int = 100,
        *,
        bookmarked: bool | None = None,
        resolved: bool | None = None,
    ) -> list[dict[str, Any]]:
        clauses = ["owner_user_id=:owner"]
        params: dict[str, Any] = {"owner": owner_user_id, "limit": limit}
        if bookmarked is not None:
            clauses.append("bookmarked=:bookmarked")
            params["bookmarked"] = bookmarked
        if resolved is not None:
            clauses.append("resolved=:resolved")
            params["resolved"] = resolved
        async with self._sessions() as db:
            rows = (
                (
                    await db.execute(
                        text(
                            f"""SELECT id, question, question_type, is_correct, resolved, bookmarked,
                                   mastery_path_id, knowledge_point_id, created_at, updated_at
                            FROM practice_entries WHERE {" AND ".join(clauses)}
                            ORDER BY created_at DESC LIMIT :limit"""  # nosec - static clauses
                        ),
                        params,
                    )
                )
                .mappings()
                .all()
            )
            return [dict(row) for row in rows]

    async def summary(self, owner_user_id: str) -> dict[str, Any]:
        async with self._sessions() as db:
            row = (
                (
                    await db.execute(
                        text(
                            """SELECT
                              count(*) AS total,
                              count(*) FILTER (WHERE resolved) AS resolved,
                              count(*) FILTER (WHERE NOT resolved) AS unresolved,
                              count(*) FILTER (WHERE bookmarked) AS bookmarked,
                              count(*) FILTER (WHERE NOT is_correct) AS mistakes
                           FROM practice_entries WHERE owner_user_id=:owner"""
                        ),
                        {"owner": owner_user_id},
                    )
                )
                .mappings()
                .one()
            )
            due = (
                await db.execute(
                    text(
                        """SELECT count(*) FROM practice_reviews r
                           JOIN practice_entries e ON e.id = r.entry_id
                           WHERE r.owner_user_id=:owner AND r.is_mistake AND r.due_at <= now()"""
                    ),
                    {"owner": owner_user_id},
                )
            ).scalar_one()
        data = dict(row)
        data["due"] = due
        return data

    async def list_due(self, owner_user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        async with self._sessions() as db:
            rows = (
                (
                    await db.execute(
                        text(
                            """SELECT e.id AS entry_id, e.question, e.question_type, e.options_json,
                                  e.correct_answer, e.explanation, e.knowledge_point_id,
                                  r.rating, r.due_at, r.review_count, r.interval_days, r.ease, r.streak
                           FROM practice_reviews r
                           JOIN practice_entries e ON e.id = r.entry_id
                           WHERE r.owner_user_id=:owner AND r.is_mistake AND r.due_at <= now()
                           ORDER BY r.due_at LIMIT :limit"""
                        ),
                        {"owner": owner_user_id, "limit": limit},
                    )
                )
                .mappings()
                .all()
            )
            result = []
            for row in rows:
                item = dict(row)
                item["options"] = item.pop("options_json") or {}
                result.append(item)
            return result

    # ------------------------------------------------------ answer + SRS review
    async def answer_check(
        self,
        owner_user_id: str,
        entry_id: str,
        answer: str,
        request_id: str,
    ) -> dict[str, Any]:
        """Check an answer once per request_id and record mastery evidence.

        Replaying the same request_id returns the stored result instead of
        scoring again (idempotent; never double-counts).
        """
        existing = await self.ledger_lookup(owner_user_id, request_id)
        if existing is not None:
            return existing

        async with self._sessions() as db:
            entry = (
                (
                    await db.execute(
                        text(
                            """SELECT question_type, correct_answer, mastery_path_id, knowledge_point_id,
                                  attempt_count FROM practice_entries
                           WHERE id=:id AND owner_user_id=:owner"""
                        ),
                        {"id": entry_id, "owner": owner_user_id},
                    )
                )
                .mappings()
                .first()
            )
            if not entry:
                raise PracticeEntryNotFoundError(entry_id)

            is_correct = self._is_correct(
                answer=answer,
                correct=entry["correct_answer"] or "",
                question_type=entry["question_type"] or "",
            )
            await db.execute(
                text(
                    """INSERT INTO practice_ledger
                       (owner_user_id, entry_id, request_id, kind, answer, is_correct, payload_json)
                       VALUES (:owner,:entry,:req,'check',:answer,:correct,CAST('{}' AS JSONB))"""
                ),
                {
                    "owner": owner_user_id,
                    "entry": entry_id,
                    "req": request_id,
                    "answer": answer[:4000],
                    "correct": is_correct,
                },
            )
            await db.execute(
                text(
                    """UPDATE practice_entries
                       SET user_answer=:answer, is_correct=:correct,
                           resolved = :correct OR resolved,
                           attempt_count = attempt_count + 1, updated_at=now()
                       WHERE id=:id AND owner_user_id=:owner"""
                ),
                {
                    "answer": answer[:4000],
                    "correct": is_correct,
                    "id": entry_id,
                    "owner": owner_user_id,
                },
            )

            review: dict[str, Any] | None = None
            if not is_correct:
                review = await self._upsert_review_row(
                    db,
                    owner=owner_user_id,
                    entry_id=entry_id,
                    rating="again",
                    answered_at=datetime.now(timezone.utc),
                )

            if entry["mastery_path_id"]:
                await self._record_mastery_evidence(
                    db,
                    owner=owner_user_id,
                    path_id=entry["mastery_path_id"],
                    entry_id=entry_id,
                    answer=answer,
                    is_correct=is_correct,
                    kp=entry["knowledge_point_id"],
                )
            await db.commit()

        result = {
            "entry_id": entry_id,
            "request_id": request_id,
            "is_correct": is_correct,
            "correct_answer": entry["correct_answer"],
            "review": review,
            "replayed": False,
        }
        return result

    async def submit_review(
        self,
        owner_user_id: str,
        entry_id: str,
        rating: str,
        request_id: str,
    ) -> dict[str, Any]:
        """Apply an SM-2-lite review rating, idempotent per request_id."""
        rating = rating.lower()
        if rating not in {"again", "hard", "good", "easy"}:
            raise ValueError("rating must be one of again/hard/good/easy")
        existing = await self.ledger_lookup(owner_user_id, request_id)
        if existing is not None:
            return existing

        async with self._sessions() as db:
            owned = (
                await db.execute(
                    text("SELECT 1 FROM practice_entries WHERE id=:id AND owner_user_id=:owner"),
                    {"id": entry_id, "owner": owner_user_id},
                )
            ).first()
            if not owned:
                raise PracticeEntryNotFoundError(entry_id)
            now = datetime.now(timezone.utc)
            review = await self._upsert_review_row(
                db, owner=owner_user_id, entry_id=entry_id, rating=rating, answered_at=now
            )
            await db.execute(
                text(
                    """INSERT INTO practice_ledger
                       (owner_user_id, entry_id, request_id, kind, rating, is_correct, payload_json)
                       VALUES (:owner,:entry,:req,'review',:rating,:correct,
                               CAST(:payload AS JSONB))"""
                ),
                {
                    "owner": owner_user_id,
                    "entry": entry_id,
                    "req": request_id,
                    "rating": rating,
                    "correct": rating != "again",
                    "payload": json.dumps(review, ensure_ascii=False, default=str),
                },
            )
            if rating != "again":
                await db.execute(
                    text(
                        "UPDATE practice_entries SET resolved=TRUE, updated_at=now() "
                        "WHERE id=:id AND owner_user_id=:owner"
                    ),
                    {"id": entry_id, "owner": owner_user_id},
                )
            await db.commit()
        return {
            "entry_id": entry_id,
            "request_id": request_id,
            "rating": rating,
            "review": review,
            "replayed": False,
        }

    # ----------------------------------------------------------------- helpers
    async def ledger_lookup(self, owner_user_id: str, request_id: str) -> dict[str, Any] | None:
        async with self._sessions() as db:
            row = (
                (
                    await db.execute(
                        text(
                            """SELECT entry_id, kind, answer, rating, is_correct
                           FROM practice_ledger WHERE owner_user_id=:owner AND request_id=:req"""
                        ),
                        {"owner": owner_user_id, "req": request_id},
                    )
                )
                .mappings()
                .first()
            )
            if not row:
                return None
            data = dict(row)
            data["replayed"] = True
            return {
                "entry_id": data["entry_id"],
                "request_id": request_id,
                **{k: v for k, v in data.items() if k != "entry_id"},
            }

    @staticmethod
    def _is_correct(*, answer: str, correct: str, question_type: str) -> bool:
        if not correct:
            return False
        if question_type in {"single_choice", "multiple_choice"}:
            return _normalize_answer(answer) == _normalize_answer(correct)
        return (
            " ".join((answer or "").split()).strip().lower()
            == " ".join(correct.split()).strip().lower()
        )

    async def _upsert_review_row(
        self, db, *, owner: str, entry_id: str, rating: str, answered_at: datetime
    ) -> dict:
        schedule_request_id = f"srs:{entry_id}"
        row = (
            (
                await db.execute(
                    text("SELECT * FROM practice_reviews WHERE owner_user_id=:o AND request_id=:r"),
                    {"o": owner, "r": schedule_request_id},
                )
            )
            .mappings()
            .first()
        )

        if row is None:
            interval = {"again": 0.0, "hard": 0.0, "good": 1.0, "easy": 4.0}[rating]
            ease = {"again": 2.3, "hard": 2.35, "good": 2.5, "easy": 2.65}[rating]
            streak = 0 if rating in {"again", "hard"} else 1
            lapse = 1 if rating == "again" else 0
        else:
            interval = float(row["interval_days"] or 0)
            ease = float(row["ease"] or 2.5)
            streak = int(row["streak"] or 0)
            lapse = int(row["lapses"] or 0)
            if rating == "again":
                interval, ease, streak, lapse = 0.0, max(1.3, ease - 0.2), 0, lapse + 1
            elif rating == "hard":
                interval = max(1 / 24, interval * 1.2)
                ease = max(1.3, ease - 0.15)
            elif rating == "good":
                interval = max(1.0, interval * ease) if interval else 1.0
                streak += 1
            else:  # easy
                interval = max(4.0, interval * ease * 1.3) if interval else 4.0
                ease += 0.15
                streak += 1

        # A failed recall ("again") is due immediately; other zero-interval
        # steps get a short 10-minute relearn window.
        if rating == "again":
            due_delta = timedelta(0)
        elif interval == 0:
            due_delta = timedelta(minutes=10)
        else:
            due_delta = timedelta(days=interval)
        due_at = answered_at + due_delta
        is_mistake = rating == "again"
        review_count = (int(row["review_count"]) + 1) if row else 1
        await db.execute(
            text(
                """INSERT INTO practice_reviews
                   (owner_user_id, entry_id, request_id, rating, answer, is_mistake, first_wrong_at,
                    due_at, interval_days, ease, streak, lapses, review_count, last_review_at,
                    created_at, updated_at)
                   VALUES (:o,:e,:r,:rating,'',:mistake,:first_wrong,:due,:interval,:ease,:streak,
                           :lapse,:count,:now,:now,:now)
                   ON CONFLICT (owner_user_id, request_id) DO UPDATE SET
                     rating=EXCLUDED.rating, is_mistake=EXCLUDED.is_mistake,
                     due_at=EXCLUDED.due_at, interval_days=EXCLUDED.interval_days,
                     ease=EXCLUDED.ease, streak=EXCLUDED.streak, lapses=EXCLUDED.lapses,
                     review_count=EXCLUDED.review_count, last_review_at=EXCLUDED.last_review_at,
                     updated_at=now()"""
            ),
            {
                "o": owner,
                "e": entry_id,
                "r": schedule_request_id,
                "rating": rating,
                "mistake": is_mistake,
                "first_wrong": answered_at,
                "due": due_at,
                "interval": interval,
                "ease": round(ease, 3),
                "streak": streak,
                "lapse": lapse,
                "count": review_count,
                "now": answered_at,
            },
        )
        return {
            "rating": rating,
            "due_at": due_at.isoformat(),
            "interval_days": round(interval, 3),
            "ease": round(ease, 3),
            "streak": streak,
            "lapses": lapse,
            "review_count": review_count,
        }

    async def _record_mastery_evidence(
        self,
        db,
        *,
        owner: str,
        path_id: str,
        entry_id: str,
        answer: str,
        is_correct: bool,
        kp: str | None,
    ) -> None:
        interaction_id = f"ix_practice_{uuid.uuid4().hex}"
        revision = (
            await db.execute(
                text(
                    """SELECT COALESCE(MAX(revision),0)+1 FROM mastery_events
                       WHERE owner_user_id=:o AND path_id=:p"""
                ),
                {"o": owner, "p": path_id},
            )
        ).scalar_one()
        question = {
            "entry_id": entry_id,
            "knowledge_point_id": kp,
            "source": "practice_answer_check",
        }
        result = {"correct": is_correct}
        await db.execute(
            text(
                """INSERT INTO mastery_interactions
                   (interaction_id, owner_user_id, path_id, status, question_json, user_answer, result_json)
                   VALUES (:id,:o,:p,:status,CAST(:q AS JSONB),:a,CAST(:r AS JSONB))
                   ON CONFLICT (interaction_id) DO NOTHING"""
            ),
            {
                "id": interaction_id,
                "o": owner,
                "p": path_id,
                "status": "correct" if is_correct else "wrong",
                "q": json.dumps(question, ensure_ascii=False),
                "a": answer[:4000],
                "r": json.dumps(result, ensure_ascii=False),
            },
        )
        await db.execute(
            text(
                """INSERT INTO mastery_events
                   (id, owner_user_id, path_id, revision, event_type, payload_json)
                   VALUES (:id,:o,:p,:rev,:etype,CAST(:payload AS JSONB))"""
            ),
            {
                "id": f"ev_practice_{uuid.uuid4().hex}",
                "o": owner,
                "p": path_id,
                "rev": revision,
                "etype": "question_answered",
                "payload": json.dumps(
                    {"entry_id": entry_id, "correct": is_correct, "knowledge_point_id": kp},
                    ensure_ascii=False,
                ),
            },
        )
