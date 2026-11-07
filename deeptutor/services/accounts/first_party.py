"""Username registration and login for first-party PostgreSQL users."""

from __future__ import annotations

import re
import uuid
import json

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.services.auth.security import hash_password, verify_password
from deeptutor.services.postgres.database import session_factory

_PLAIN_USERNAME = re.compile(r"^[A-Za-z0-9_.-]{3,64}$")
_EMAIL_USERNAME = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AccountExistsError(ValueError):
    """The username is already registered."""


class FirstPartyAccountService:
    def __init__(self, engine: AsyncEngine):
        self._sessions = session_factory(engine)

    @staticmethod
    def _username(value: str) -> str:
        username = value.strip()
        if not (_PLAIN_USERNAME.fullmatch(username) or _EMAIL_USERNAME.fullmatch(username)):
            raise ValueError("invalid username")
        return username

    async def register(self, username: str, password: str, *, preset: str = "standard") -> str:
        username = self._username(username)
        if len(password) < 8:
            raise ValueError("password must be at least 8 characters")
        if preset not in {"standard", "learner", "custom"}:
            raise ValueError("invalid account preset")
        user_id = f"u_{uuid.uuid4().hex}"
        password_hash = hash_password(password)
        try:
            async with self._sessions() as db:
                await db.execute(
                    text(
                        """INSERT INTO users (id,username,display_name,preset)
                           VALUES (:id,:username,:username,:preset)"""
                    ),
                    {"id": user_id, "username": username, "preset": preset},
                )
                await db.execute(
                    text(
                        """INSERT INTO first_party_credentials (owner_user_id,password_hash)
                           VALUES (:id,:hash)"""
                    ),
                    {"id": user_id, "hash": password_hash},
                )
                if preset == "learner":
                    from deeptutor.multi_user.grants import learner_grant

                    await db.execute(
                        text("""INSERT INTO user_grants(owner_user_id,revision,grant_json)
                                VALUES (:id,1,CAST(:grant AS JSONB))"""),
                        {"id": user_id, "grant": json.dumps(learner_grant(user_id), ensure_ascii=False)},
                    )
                await db.execute(
                    text(
                        """INSERT INTO auth_identities (id,owner_user_id,provider,subject)
                           VALUES (:identity,:id,'first_party_username',:subject)"""
                    ),
                    {
                        "identity": f"ai_{uuid.uuid4().hex}",
                        "id": user_id,
                        "subject": username.lower(),
                    },
                )
                await db.execute(
                    text("INSERT INTO subscriptions (owner_user_id) VALUES (:id)"),
                    {"id": user_id},
                )
                await db.commit()
        except IntegrityError as exc:
            raise AccountExistsError("username already registered") from exc
        return user_id

    async def authenticate(self, username: str, password: str) -> dict | None:
        try:
            username = self._username(username)
        except ValueError:
            return None
        async with self._sessions() as db:
            row = (
                await db.execute(
                    text(
                    """SELECT u.id,u.username,u.role,c.password_hash,u.is_active
                           FROM users u JOIN first_party_credentials c
                             ON c.owner_user_id=u.id
                           WHERE lower(u.username)=lower(:username)"""
                    ),
                    {"username": username},
                )
            ).mappings().first()
        if row is None or not row["is_active"]:
            return None
        if not verify_password(password, row["password_hash"]):
            return None
        return {"id": row["id"], "username": row["username"], "role": row["role"]}

    async def get_user(self, user_id: str) -> dict | None:
        """Resolve an active first-party account for token validation."""
        async with self._sessions() as db:
            row = (
                await db.execute(
                    text(
                        """SELECT u.id,u.username,u.display_name,u.role,u.preset,u.avatar,
                                  u.learner_profile_json,u.is_active,u.created_at
                           FROM users u JOIN first_party_credentials c
                             ON c.owner_user_id=u.id
                           WHERE u.id=:id"""
                    ),
                    {"id": user_id},
                )
            ).mappings().first()
            return dict(row) if row and row["is_active"] else None

    async def list_users(self, limit: int = 100, offset: int = 0) -> list[dict]:
        async with self._sessions() as db:
            rows = (
                await db.execute(
                    text(
                        """SELECT u.id,u.username,u.display_name,u.role,u.preset,u.avatar,
                                  u.learner_profile_json,u.is_active,u.created_at
                           FROM users u JOIN first_party_credentials c
                             ON c.owner_user_id=u.id
                           ORDER BY u.created_at,u.id LIMIT :limit OFFSET :offset"""
                    ),
                    {"limit": max(1, min(limit, 500)), "offset": max(0, offset)},
                )
            ).mappings().all()
            return [dict(row) for row in rows]

    async def get_user_by_username(self, username: str) -> dict | None:
        async with self._sessions() as db:
            row = (
                await db.execute(
                    text(
                        """SELECT u.id,u.username,u.display_name,u.role,u.preset,u.avatar,
                                  u.learner_profile_json,u.is_active,u.created_at
                           FROM users u JOIN first_party_credentials c
                             ON c.owner_user_id=u.id
                           WHERE lower(u.username)=lower(:username)"""
                    ),
                    {"username": username.strip()},
                )
            ).mappings().first()
            return dict(row) if row else None

    async def set_avatar(self, user_id: str, avatar: str) -> bool:
        async with self._sessions() as db:
            updated = (
                await db.execute(
                    text(
                        """UPDATE users SET avatar=:avatar,updated_at=now()
                           WHERE id=:id AND is_active=true
                           AND EXISTS (SELECT 1 FROM first_party_credentials
                                       WHERE owner_user_id=:id)
                           RETURNING id"""
                    ),
                    {"id": user_id, "avatar": avatar},
                )
            ).scalar_one_or_none()
            await db.commit()
            return updated is not None

    async def set_learner_profile(self, user_id: str, profile: dict) -> bool:
        async with self._sessions() as db:
            updated = (
                await db.execute(
                    text(
                        """UPDATE users SET learner_profile_json=CAST(:profile AS JSONB),
                           updated_at=now() WHERE id=:id AND is_active=true AND preset='learner'
                           AND EXISTS (SELECT 1 FROM first_party_credentials
                                       WHERE owner_user_id=:id)
                           RETURNING id"""
                    ),
                    {"id": user_id, "profile": json.dumps(profile, ensure_ascii=False)},
                )
            ).scalar_one_or_none()
            await db.commit()
            return updated is not None

    async def set_role(self, user_id: str, role: str) -> bool:
        if role not in {"user", "student", "teacher"}:
            raise ValueError("administrator role belongs to the separate admin store")
        async with self._sessions() as db:
            updated = (
                await db.execute(
                    text(
                        """UPDATE users SET role=:role,updated_at=now()
                           WHERE id=:id AND is_active=true
                           AND EXISTS (SELECT 1 FROM first_party_credentials
                                       WHERE owner_user_id=:id)
                           RETURNING id"""
                    ),
                    {"id": user_id, "role": role},
                )
            ).scalar_one_or_none()
            await db.commit()
            return updated is not None

    async def deactivate(self, user_id: str) -> bool:
        async with self._sessions() as db:
            updated = (
                await db.execute(
                    text(
                        """UPDATE users SET is_active=false,updated_at=now()
                           WHERE id=:id AND is_active=true
                           AND EXISTS (SELECT 1 FROM first_party_credentials
                                       WHERE owner_user_id=:id)
                           RETURNING id"""
                    ),
                    {"id": user_id},
                )
            ).scalar_one_or_none()
            await db.commit()
            return updated is not None
