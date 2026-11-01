from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.services.postgres.database import session_factory


class AccountService:
    def __init__(self, engine: AsyncEngine):
        self._engine = engine
        self._sessions = session_factory(engine)

    @staticmethod
    def new_user_id() -> str:
        return f"user_{uuid.uuid4().hex}"

    async def ensure_user(
        self,
        user_id: str,
        *,
        display_name: str = "",
        email: str | None = None,
        plan: str = "free",
    ) -> str:
        async with self._sessions() as db:
            await db.execute(
                text(
                    """INSERT INTO users (id, display_name, email)
                       VALUES (:id, :name, :email)
                       ON CONFLICT (id) DO UPDATE SET
                         display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), users.display_name),
                         email = COALESCE(EXCLUDED.email, users.email),
                         updated_at = now()
                    """
                ),
                {"id": user_id, "name": display_name, "email": email},
            )
            await db.execute(
                text(
                    """INSERT INTO subscriptions (owner_user_id, plan, status)
                       VALUES (:id, :plan, 'active')
                       ON CONFLICT (owner_user_id) DO NOTHING"""
                ),
                {"id": user_id, "plan": plan},
            )
            await db.commit()
        return user_id

    async def get_plan(self, user_id: str) -> str | None:
        async with self._sessions() as db:
            return (
                await db.execute(
                    text("SELECT plan FROM subscriptions WHERE owner_user_id=:id"),
                    {"id": user_id},
                )
            ).scalar_one_or_none()
