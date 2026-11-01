from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.services.postgres.database import session_factory


class PostgresSessionStore:
    def __init__(self, engine: AsyncEngine):
        self._sessions = session_factory(engine)

    @staticmethod
    def new_session_id() -> str:
        return f"unified_{uuid.uuid4().hex[:24]}"

    async def create_session(self, owner_user_id: str, title: str = "New conversation") -> str:
        session_id = self.new_session_id()
        async with self._sessions() as db:
            await db.execute(
                text(
                    """INSERT INTO sessions (id, owner_user_id, title)
                       VALUES (:id,:owner,:title)"""
                ),
                {"id": session_id, "owner": owner_user_id, "title": title},
            )
            await db.commit()
        return session_id

    async def get_session(self, owner_user_id: str, session_id: str) -> dict | None:
        async with self._sessions() as db:
            row = (
                (
                    await db.execute(
                        text(
                            "SELECT id,title,created_at,updated_at FROM sessions WHERE id=:id AND owner_user_id=:owner"
                        ),
                        {"id": session_id, "owner": owner_user_id},
                    )
                )
                .mappings()
                .first()
            )
            return dict(row) if row else None

    async def list_sessions(self, owner_user_id: str, limit: int = 50) -> list[dict]:
        async with self._sessions() as db:
            rows = (
                (
                    await db.execute(
                        text(
                            """SELECT id,title,created_at,updated_at FROM sessions
                           WHERE owner_user_id=:owner AND deleted_at IS NULL
                           ORDER BY updated_at DESC LIMIT :limit"""
                        ),
                        {"owner": owner_user_id, "limit": limit},
                    )
                )
                .mappings()
                .all()
            )
            return [dict(r) for r in rows]
