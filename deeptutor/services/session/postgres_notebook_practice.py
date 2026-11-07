"""Owner-bound question-bank review state on PostgreSQL."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import time
from typing import Any
import uuid
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.services.postgres.database import session_factory
from deeptutor.services.practice.answers import check_answer
from deeptutor.services.practice.scheduler import DAY, day_bounds, schedule
from deeptutor.services.practice.storage import ReviewConflict


def _stamp(value: float) -> datetime:
    return datetime.fromtimestamp(value, timezone.utc)


class PostgresNotebookPractice:
    _due_sql = """CASE WHEN
        (COALESCE((c.card_json->>'resolved')::boolean,false)
         OR COALESCE((c.card_json->>'is_correct')::boolean,false))
        AND COALESCE(r.review_count,0)=0
      THEN extract(epoch from c.updated_at)+259200
      ELSE COALESCE(extract(epoch from r.due_at),extract(epoch from c.created_at))
      END"""

    def __init__(self, engine: AsyncEngine):
        self._sessions = session_factory(engine)

    @staticmethod
    def _state(row: Any, entry_id: int) -> dict[str, Any]:
        if row is None:
            return {"entry_id": entry_id, "is_mistake": 0, "version": 0,
                    "review_count": 0, "interval_days": 1, "due_at": None}
        result = dict(row)
        for key in ("first_wrong_at", "due_at", "last_review_at"):
            if result.get(key) is not None:
                result[key] = result[key].timestamp()
        return result

    async def state(self, owner: str, entry_id: int) -> dict[str, Any]:
        async with self._sessions() as db:
            row = (await db.execute(text("""
                SELECT r.* FROM notebook_practice_state r
                JOIN assessment_cards c ON c.id=r.entry_id AND c.owner_user_id=r.owner_user_id
                LEFT JOIN sessions s ON s.id=c.session_id AND s.owner_user_id=c.owner_user_id
                WHERE r.owner_user_id=:owner AND r.entry_id=:entry
                  AND s.deleted_at IS NULL
            """), {"owner": owner, "entry": entry_id})).mappings().first()
        return self._state(row, entry_id)

    async def visible(self, owner: str, entry_id: int) -> bool:
        async with self._sessions() as db:
            found = (await db.execute(text("""
                SELECT 1 FROM assessment_cards c LEFT JOIN sessions s
                  ON s.id=c.session_id AND s.owner_user_id=c.owner_user_id
                WHERE c.id=:entry AND c.owner_user_id=:owner AND s.deleted_at IS NULL
            """), {"entry": entry_id, "owner": owner})).scalar_one_or_none()
        return found is not None

    async def overview(self, owner: str, timezone_name: str) -> dict[str, Any]:
        now = time.time()
        start, end = day_bounds(timezone_name, now)
        async with self._sessions() as db:
            row = (await db.execute(text(f"""
                SELECT count(*) AS total,
                  count(*) FILTER (WHERE r.is_mistake) AS mistakes,
                  count(*) FILTER (WHERE {self._due_sql}<=:now) AS due,
                  count(*) FILTER (WHERE {self._due_sql}<=:start) AS overdue,
                  min({self._due_sql}) AS next_due_at
                FROM assessment_cards c
                LEFT JOIN sessions s ON s.id=c.session_id AND s.owner_user_id=c.owner_user_id
                LEFT JOIN notebook_practice_state r
                  ON r.entry_id=c.id AND r.owner_user_id=c.owner_user_id
                WHERE c.owner_user_id=:owner AND s.deleted_at IS NULL
            """), {"owner": owner, "now": now, "start": start})).mappings().one()
            completed = (await db.execute(text("""
                SELECT count(DISTINCT e.entry_id) FROM notebook_practice_events e
                JOIN assessment_cards c ON c.id=e.entry_id AND c.owner_user_id=e.owner_user_id
                LEFT JOIN sessions s ON s.id=c.session_id AND s.owner_user_id=c.owner_user_id
                WHERE e.owner_user_id=:owner AND s.deleted_at IS NULL
                  AND e.reviewed_at>=:start AND e.reviewed_at<:end
            """), {"owner": owner, "start": _stamp(start),
                   "end": _stamp(end)})).scalar_one()
        return {"total": int(row["total"]), "mistakes": int(row["mistakes"]),
                "due": int(row["due"]), "overdue": int(row["overdue"]),
                "next_due_at": float(row["next_due_at"]) if row["next_due_at"] is not None else None,
                "reviewed_today": int(completed), "day_end": end,
                "timezone": timezone_name}

    async def queue(self, owner: str, timezone_name: str,
                    category_id: int | None, limit: int) -> list[int]:
        day_bounds(timezone_name, time.time())
        category_clause = "" if category_id is None else """AND EXISTS (
            SELECT 1 FROM notebook_entry_categories ec
            WHERE ec.entry_id=c.id AND ec.owner_user_id=c.owner_user_id
              AND ec.category_id=:category)"""
        async with self._sessions() as db:
            rows = (await db.execute(text(f"""
                SELECT c.id FROM assessment_cards c
                LEFT JOIN sessions s ON s.id=c.session_id AND s.owner_user_id=c.owner_user_id
                LEFT JOIN notebook_practice_state r
                  ON r.entry_id=c.id AND r.owner_user_id=c.owner_user_id
                WHERE c.owner_user_id=:owner AND s.deleted_at IS NULL
                  AND {self._due_sql}<=:now {category_clause}
                ORDER BY {self._due_sql},c.id LIMIT :limit
            """), {"owner": owner, "now": time.time(),
                   "category": category_id, "limit": limit})).scalars().all()
        return [int(value) for value in rows]

    async def analytics(self, owner: str, timezone_name: str, days: int) -> dict[str, Any]:
        if days not in {7, 30, 90}:
            raise ValueError("Choose 7, 30 or 90 days")
        now = time.time()
        day_bounds(timezone_name, now)
        zone = ZoneInfo(timezone_name)
        today = datetime.fromtimestamp(now, zone).date()
        first = today - timedelta(days=days - 1)
        start = datetime.combine(first, datetime.min.time(), zone).timestamp()
        daily = {(first + timedelta(days=i)).isoformat():
                 {"questions": 0, "mistakes": 0, "reviews": 0} for i in range(days)}
        sources: dict[str, dict[str, Any]] = {}
        queries = {
            "questions": ("", "c.created_at", ""),
            "mistakes": ("JOIN notebook_practice_state r ON r.entry_id=c.id AND r.owner_user_id=c.owner_user_id",
                         "r.first_wrong_at", "AND r.is_mistake"),
            "reviews": ("JOIN notebook_practice_events e ON e.entry_id=c.id AND e.owner_user_id=c.owner_user_id",
                        "e.reviewed_at", ""),
        }
        async with self._sessions() as db:
            for metric, (join, timestamp, extra) in queries.items():
                rows = (await db.execute(text(f"""
                    SELECT {timestamp} AS occurred,
                      COALESCE(NULLIF(c.card_json->>'source',''),'deep_question') AS source
                    FROM assessment_cards c
                    LEFT JOIN sessions s ON s.id=c.session_id AND s.owner_user_id=c.owner_user_id
                    {join}
                    WHERE c.owner_user_id=:owner AND s.deleted_at IS NULL {extra}
                      AND {timestamp}>=:start AND {timestamp}<=:now
                """), {"owner": owner, "start": _stamp(start),
                       "now": _stamp(now)})).mappings().all()
                for row in rows:
                    date = row["occurred"].astimezone(zone).date().isoformat()
                    if date not in daily:
                        continue
                    daily[date][metric] += 1
                    source = sources.setdefault(row["source"],
                        {"source": row["source"], "questions": 0,
                         "mistakes": 0, "reviews": 0})
                    source[metric] += 1
        return {"timezone": timezone_name, "days": days,
                "start_date": first.isoformat(), "end_date": today.isoformat(),
                "updated_at": now,
                "daily": [{"date": date, **counts} for date, counts in daily.items()],
                "sources": sorted(sources.values(), key=lambda item: item["source"]),
                "totals": {metric: sum(item[metric] for item in daily.values())
                           for metric in queries}}

    async def stage_import(self, owner: str, filename: str, target: str,
                           questions: list[dict[str, Any]]) -> str:
        token = uuid.uuid4().hex
        async with self._sessions() as db:
            await db.execute(text("""
                DELETE FROM notebook_practice_imports
                WHERE owner_user_id=:owner AND created_at<:expiry AND result_json IS NULL
            """), {"owner": owner, "expiry": _stamp(time.time() - DAY)})
            await db.execute(text("""
                INSERT INTO notebook_practice_imports
                  (token,owner_user_id,filename,target,payload_json,created_at)
                VALUES (:token,:owner,:filename,:target,CAST(:payload AS JSONB),now())
            """), {"token": token, "owner": owner, "filename": filename[:200],
                   "target": target,
                   "payload": json.dumps({"questions": questions}, ensure_ascii=False)})
            await db.commit()
        return token

    async def commit_import(self, owner: str, token: str) -> dict[str, int]:
        now = time.time()
        async with self._sessions() as db:
            staged = (await db.execute(text("""
                SELECT * FROM notebook_practice_imports
                WHERE token=:token AND owner_user_id=:owner FOR UPDATE
            """), {"token": token, "owner": owner})).mappings().first()
            if staged is None:
                raise LookupError("Import preview not found. Select the file again.")
            if staged["result_json"] is not None:
                return dict(staged["result_json"])
            if now - staged["created_at"].timestamp() > DAY:
                raise ValueError("Import preview expired. Select the file again.")
            payload = staged["payload_json"]
            questions = payload if isinstance(payload, list) else payload["questions"]
            created = skipped = 0
            for question in questions:
                question_id = question["question_id"]
                await db.execute(text("""
                    SELECT pg_advisory_xact_lock(hashtextextended(:key,0))
                """), {"key": f"{owner}:external_import:practice-import::{question_id}"})
                card = {
                    **question, "session_id": "", "origin_type": "external_import",
                    "origin_ref": "practice-import", "turn_id": "",
                    "source": "import", "assessment_type": "quiz",
                    "result": "incorrect" if staged["target"] == "mistakes" else "ungraded",
                    "is_correct": False, "resolved": False, "bookmarked": False,
                    "options": question.get("options") or {},
                    "user_answer_images": [], "score_trend": "new",
                    "attempt_count": 1, "hints_used": 0,
                    "material_title": staged["filename"],
                    "material_id": "import:" + token,
                    "created_at": now, "updated_at": now,
                }
                inserted = (await db.execute(text("""
                    INSERT INTO assessment_cards
                      (owner_user_id,session_id,origin_type,origin_ref,turn_id,
                       question_id,card_json,created_at,updated_at)
                    VALUES (:owner,NULL,'external_import','practice-import','',
                      :question,CAST(:card AS JSONB),:created,:created)
                    ON CONFLICT (owner_user_id,origin_type,origin_ref,turn_id,question_id)
                    DO NOTHING RETURNING id
                """), {"owner": owner, "question": question_id,
                       "card": json.dumps(card, ensure_ascii=False),
                       "created": _stamp(now)})).scalar_one_or_none()
                if inserted is None:
                    skipped += 1
                    card_id = (await db.execute(text("""
                        SELECT id FROM assessment_cards WHERE owner_user_id=:owner
                          AND origin_type='external_import' AND origin_ref='practice-import'
                          AND turn_id='' AND question_id=:question
                    """), {"owner": owner, "question": question_id})).scalar_one()
                else:
                    created += 1
                    card_id = inserted
                if staged["target"] == "mistakes":
                    await db.execute(text("""
                        INSERT INTO notebook_practice_state
                          (owner_user_id,entry_id,is_mistake,first_wrong_at,due_at)
                        VALUES (:owner,:entry,true,:now,:due)
                        ON CONFLICT (owner_user_id,entry_id) DO UPDATE SET
                          is_mistake=true,
                          first_wrong_at=CASE WHEN NOT notebook_practice_state.is_mistake
                            THEN :now ELSE notebook_practice_state.first_wrong_at END,
                          due_at=CASE WHEN NOT notebook_practice_state.is_mistake
                            THEN :due ELSE notebook_practice_state.due_at END,
                          interval_days=CASE WHEN NOT notebook_practice_state.is_mistake
                            THEN 1 ELSE notebook_practice_state.interval_days END,
                          version=CASE WHEN NOT notebook_practice_state.is_mistake
                            THEN notebook_practice_state.version+1
                            ELSE notebook_practice_state.version END
                    """), {"owner": owner, "entry": card_id,
                           "now": _stamp(now), "due": _stamp(now + DAY)})
                for tag in question.get("tags") or []:
                    cleaned = str(tag).strip()
                    if not cleaned:
                        continue
                    category_id = (await db.execute(text("""
                        INSERT INTO notebook_categories (owner_user_id,name)
                        VALUES (:owner,:name)
                        ON CONFLICT (owner_user_id,lower(name)) DO UPDATE
                          SET name=notebook_categories.name RETURNING id
                    """), {"owner": owner, "name": cleaned})).scalar_one()
                    await db.execute(text("""
                        INSERT INTO notebook_entry_categories
                          (owner_user_id,entry_id,category_id)
                        VALUES (:owner,:entry,:category) ON CONFLICT DO NOTHING
                    """), {"owner": owner, "entry": card_id,
                           "category": category_id})
            result = {"created": created, "duplicates": skipped,
                      "total": created + skipped}
            await db.execute(text("""
                UPDATE notebook_practice_imports
                SET result_json=CAST(:result AS JSONB),payload_json=CAST('[]' AS JSONB)
                WHERE token=:token AND owner_user_id=:owner
            """), {"result": json.dumps(result), "token": token, "owner": owner})
            await db.commit()
            return result

    async def review(self, owner: str, entry_id: int, request_id: str, version: int,
                     rating: str, answer: str, *, self_report: bool = False) -> dict[str, Any]:
        now = time.time()
        async with self._sessions() as db:
            await db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:request,0))"),
                             {"request": request_id})
            prior = (await db.execute(text("""
                SELECT entry_id,rating,answer,outcome_json FROM notebook_practice_events
                WHERE request_id=:request FOR UPDATE
            """), {"request": request_id})).mappings().first()
            if prior:
                outcome = prior["outcome_json"] or {}
                if (prior["entry_id"] != entry_id or prior["rating"] != rating
                    or prior["answer"] != answer
                    or bool(outcome.get("self_report")) != self_report):
                    raise ReviewConflict("This submission ID was already used for a different answer")
                if prior["entry_id"] != entry_id:
                    raise ReviewConflict("This submission ID belongs to another question")
                # A request ID is global. The original owner is checked by the card query below.
                owned = (await db.execute(text("""
                    SELECT 1 FROM assessment_cards WHERE id=:entry AND owner_user_id=:owner
                """), {"entry": entry_id, "owner": owner})).scalar_one_or_none()
                if owned is None:
                    raise LookupError("Question not found")
                return dict(outcome)
            card = (await db.execute(text("""
                SELECT c.card_json FROM assessment_cards c
                LEFT JOIN sessions s ON s.id=c.session_id AND s.owner_user_id=c.owner_user_id
                WHERE c.id=:entry AND c.owner_user_id=:owner AND s.deleted_at IS NULL
                FOR UPDATE OF c
            """), {"entry": entry_id, "owner": owner})).mappings().first()
            if card is None:
                raise LookupError("Question not found")
            row = (await db.execute(text("""
                SELECT * FROM notebook_practice_state
                WHERE entry_id=:entry AND owner_user_id=:owner FOR UPDATE
            """), {"entry": entry_id, "owner": owner})).mappings().first()
            state = self._state(row, entry_id)
            if state["version"] != version:
                raise ReviewConflict("This question changed in another tab. Reload it before reviewing again.")
            question = dict(card["card_json"] or {})
            correct = None if self_report else check_answer(question, answer)
            if correct is False and rating != "again":
                raise ValueError("An incorrect answer must be reviewed again")
            next_state = schedule(state, rating, now)
            mistake = bool(state.get("is_mistake")) or rating == "again"
            await db.execute(text("""
                INSERT INTO notebook_practice_state
                  (owner_user_id,entry_id,is_mistake,first_wrong_at,due_at,
                   interval_days,ease,streak,lapses,review_count,last_review_at,version)
                VALUES (:owner,:entry,:mistake,:first_wrong,:due,:interval,:ease,
                  :streak,:lapses,:reviews,:last_review,:version)
                ON CONFLICT (owner_user_id,entry_id) DO UPDATE SET
                  is_mistake=EXCLUDED.is_mistake,
                  first_wrong_at=CASE WHEN NOT notebook_practice_state.is_mistake
                    AND EXCLUDED.is_mistake THEN EXCLUDED.first_wrong_at
                    ELSE notebook_practice_state.first_wrong_at END,
                  due_at=EXCLUDED.due_at,interval_days=EXCLUDED.interval_days,
                  ease=EXCLUDED.ease,streak=EXCLUDED.streak,lapses=EXCLUDED.lapses,
                  review_count=EXCLUDED.review_count,
                  last_review_at=EXCLUDED.last_review_at,version=EXCLUDED.version
            """), {"owner": owner, "entry": entry_id, "mistake": mistake,
                   "first_wrong": _stamp(now), "due": _stamp(next_state["due_at"]),
                   "interval": next_state["interval_days"], "ease": next_state["ease"],
                   "streak": next_state["streak"], "lapses": next_state["lapses"],
                   "reviews": next_state["review_count"],
                   "last_review": _stamp(now), "version": next_state["version"]})
            if rating == "again":
                question["resolved"] = False
                await db.execute(text("""
                    UPDATE assessment_cards SET card_json=CAST(:card AS JSONB),updated_at=now()
                    WHERE id=:entry AND owner_user_id=:owner
                """), {"card": json.dumps(question, ensure_ascii=False),
                       "entry": entry_id, "owner": owner})
            outcome = {**next_state, "entry_id": entry_id, "is_mistake": mistake,
                       "correct": correct, "rating": rating,
                       "self_report": self_report, "mastered": rating in {"good", "easy"}}
            await db.execute(text("""
                INSERT INTO notebook_practice_events
                  (request_id,owner_user_id,entry_id,rating,answer,reviewed_at,outcome_json)
                VALUES (:request,:owner,:entry,:rating,:answer,:reviewed,CAST(:outcome AS JSONB))
            """), {"request": request_id, "owner": owner, "entry": entry_id,
                   "rating": rating, "answer": answer, "reviewed": _stamp(now),
                   "outcome": json.dumps(outcome, ensure_ascii=False)})
            await db.commit()
            return outcome
