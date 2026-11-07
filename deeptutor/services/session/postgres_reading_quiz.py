"""Owner-bound reading quiz answer keys, assessment projection and rewards."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import time
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.services.postgres.database import session_factory


class PostgresReadingQuizRepository:
    def __init__(self, engine: AsyncEngine):
        self._sessions = session_factory(engine)

    async def put_pending(self, owner: str, material_id: str, locator: int,
                          questions: list[Any]) -> int:
        material = str(material_id or "").strip()
        if not material:
            return 0
        now = datetime.now(timezone.utc)
        count = 0
        async with self._sessions() as db:
            await db.execute(text("""
                DELETE FROM reading_quiz_pending
                WHERE owner_user_id=:owner AND material_id=:material AND locator=:locator
            """), {"owner": owner, "material": material, "locator": int(locator)})
            for index, question in enumerate(questions, start=1):
                if not isinstance(question, dict):
                    continue
                question_id = str(question.get("id") or f"q_{index}").strip()
                if not question_id:
                    continue
                await db.execute(text("""
                    INSERT INTO reading_quiz_pending
                      (owner_user_id,material_id,locator,question_id,question_json,created_at)
                    VALUES (:owner,:material,:locator,:question,CAST(:payload AS JSONB),:now)
                """), {"owner": owner, "material": material, "locator": int(locator),
                       "question": question_id,
                       "payload": json.dumps(question, ensure_ascii=False), "now": now})
                count += 1
            await db.commit()
        return count

    async def get_pending(self, owner: str, material_id: str, locator: int,
                          question_ids: list[str] | None = None) -> dict[str, dict[str, Any]]:
        wanted = None if question_ids is None else [str(qid).strip() for qid in question_ids
                                                     if str(qid).strip()]
        if wanted == []:
            return {}
        async with self._sessions() as db:
            rows = (await db.execute(text("""
                SELECT question_id,question_json FROM reading_quiz_pending
                WHERE owner_user_id=:owner AND material_id=:material AND locator=:locator
                  AND (:all_questions OR question_id=ANY(:wanted))
            """), {"owner": owner, "material": str(material_id or "").strip(),
                   "locator": int(locator), "all_questions": wanted is None,
                   "wanted": wanted or []})).mappings().all()
        return {row["question_id"]: dict(row["question_json"])
                for row in rows if isinstance(row["question_json"], dict)}

    async def best_results(self, owner: str, material_id: str, locator: int,
                           question_ids: list[str]) -> dict[str, dict[str, bool]]:
        wanted = list(dict.fromkeys(str(qid).strip() for qid in question_ids if str(qid).strip()))
        if not material_id or not wanted:
            return {}
        async with self._sessions() as db:
            rows = (await db.execute(text("""
                SELECT attempt_json->>'question_id' AS question_id,
                  bool_or(attempt_json->>'result'='correct') AS correct
                FROM assessment_attempts
                WHERE owner_user_id=:owner AND attempt_json->>'source'='immersive_reading'
                  AND attempt_json->>'material_id'=:material
                  AND attempt_json->>'section_id'=:section
                  AND attempt_json->>'question_id'=ANY(:wanted)
                GROUP BY attempt_json->>'question_id'
            """), {"owner": owner, "material": str(material_id).strip(),
                   "section": str(int(locator)), "wanted": wanted})).mappings().all()
        return {row["question_id"]: {"attempted": True, "correct": bool(row["correct"])}
                for row in rows}

    async def upsert_reward(self, owner: str, material_id: str, locator: int,
                            stars: int) -> dict[str, Any]:
        material = str(material_id or "").strip()
        if not material:
            raise ValueError("material_id is required")
        normalized = max(1, int(stars))
        now = datetime.now(timezone.utc)
        async with self._sessions() as db:
            await db.execute(text("""
                SELECT pg_advisory_xact_lock(hashtextextended(:key,0))
            """), {"key": f"reading-reward:{owner}:{material}:{int(locator)}"})
            previous = (await db.execute(text("""
                SELECT stars FROM reading_quiz_rewards
                WHERE owner_user_id=:owner AND material_id=:material AND locator=:locator
                FOR UPDATE
            """), {"owner": owner, "material": material,
                   "locator": int(locator)})).scalar_one_or_none()
            awarded = normalized > (previous or 0)
            if awarded:
                await db.execute(text("""
                    INSERT INTO reading_quiz_rewards
                      (owner_user_id,material_id,locator,stars,updated_at)
                    VALUES (:owner,:material,:locator,:stars,:now)
                    ON CONFLICT (owner_user_id,material_id,locator)
                    DO UPDATE SET stars=GREATEST(reading_quiz_rewards.stars,EXCLUDED.stars),
                      updated_at=CASE WHEN EXCLUDED.stars>reading_quiz_rewards.stars
                        THEN EXCLUDED.updated_at ELSE reading_quiz_rewards.updated_at END
                """), {"owner": owner, "material": material,
                       "locator": int(locator), "stars": normalized, "now": now})
            await db.commit()
        return {"locator": int(locator), "stars": max(normalized, previous or 0),
                "updated_at": time.time(), "awarded": awarded}

    async def list_rewards(self, owner: str, material_id: str) -> list[dict[str, Any]]:
        material = str(material_id or "").strip()
        if not material:
            return []
        async with self._sessions() as db:
            rows = (await db.execute(text("""
                SELECT locator,stars,updated_at FROM reading_quiz_rewards
                WHERE owner_user_id=:owner AND material_id=:material ORDER BY locator
            """), {"owner": owner, "material": material})).mappings().all()
        return [{"locator": int(row["locator"]), "stars": int(row["stars"]),
                 "updated_at": row["updated_at"].timestamp()} for row in rows]

    async def reward_totals(self, owner: str, material_ids: list[str]) -> dict[str, int]:
        wanted = list(dict.fromkeys(str(item).strip() for item in material_ids if str(item).strip()))
        if not wanted:
            return {}
        async with self._sessions() as db:
            rows = (await db.execute(text("""
                SELECT material_id,sum(stars) AS stars FROM reading_quiz_rewards
                WHERE owner_user_id=:owner AND material_id=ANY(:wanted)
                GROUP BY material_id
            """), {"owner": owner, "wanted": wanted})).mappings().all()
        return {row["material_id"]: int(row["stars"]) for row in rows}
