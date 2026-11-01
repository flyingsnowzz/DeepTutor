from __future__ import annotations

import json
from typing import Any
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.services.postgres.database import session_factory


class PracticeOwnershipError(PermissionError):
    """Raised when an explicit entry id already belongs to another owner."""


class PostgresPracticeRepository:
    def __init__(self, engine: AsyncEngine):
        self._sessions = session_factory(engine)

    @staticmethod
    def new_entry_id() -> str:
        return f"practice_{uuid.uuid4().hex}"

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

    async def list_entries(self, owner_user_id: str, limit: int = 100) -> list[dict[str, Any]]:
        async with self._sessions() as db:
            rows = (
                (
                    await db.execute(
                        text(
                            """SELECT id, question, question_type, is_correct, resolved, bookmarked, created_at
                           FROM practice_entries WHERE owner_user_id=:owner
                           ORDER BY created_at DESC LIMIT :limit"""
                        ),
                        {"owner": owner_user_id, "limit": limit},
                    )
                )
                .mappings()
                .all()
            )
            return [dict(row) for row in rows]

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
