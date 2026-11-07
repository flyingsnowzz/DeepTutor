"""Administrator credentials kept apart from ordinary user accounts."""

from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.services.postgres.database import session_factory
from deeptutor.services.auth.security import verify_password


class AdminPermissionError(PermissionError):
    """The actor is not an active super administrator."""


class AdminAccountService:
    def __init__(self, engine: AsyncEngine):
        self._sessions = session_factory(engine)

    async def bootstrap_superadmin(self, username: str, password_hash: str) -> str:
        """Provision exactly one deployment-selected super administrator.

        The caller must obtain the username and bcrypt hash from deployment
        configuration. Public registration never calls this method.
        """
        username = username.strip()
        if not username or not password_hash:
            raise ValueError("super administrator credentials are required")
        async with self._sessions() as db:
            existing = (
                await db.execute(
                    text(
                        """SELECT id,username FROM admin_accounts
                           WHERE is_superadmin=true FOR UPDATE"""
                    )
                )
            ).mappings().first()
            if existing is not None:
                if existing["username"] != username:
                    raise AdminPermissionError("a different super administrator is provisioned")
                await db.execute(
                    text(
                        """UPDATE admin_accounts SET password_hash=:hash,
                           is_active=true,updated_at=now() WHERE id=:id"""
                    ),
                    {"hash": password_hash, "id": existing["id"]},
                )
                await db.commit()
                return str(existing["id"])
            admin_id = f"admin_{uuid.uuid4().hex}"
            await db.execute(
                text(
                    """INSERT INTO admin_accounts
                       (id,username,password_hash,is_superadmin)
                       VALUES (:id,:username,:hash,true)"""
                ),
                {"id": admin_id, "username": username, "hash": password_hash},
            )
            await db.commit()
            return admin_id

    async def create_admin(
        self, actor_admin_id: str, username: str, password_hash: str
    ) -> str:
        username = username.strip()
        if not username or not password_hash:
            raise ValueError("administrator credentials are required")
        async with self._sessions() as db:
            authorized = (
                await db.execute(
                    text(
                        """SELECT 1 FROM admin_accounts WHERE id=:actor
                           AND is_superadmin=true AND is_active=true"""
                    ),
                    {"actor": actor_admin_id},
                )
            ).scalar_one_or_none()
            if authorized is None:
                raise AdminPermissionError("only the super administrator can create admins")
            admin_id = f"admin_{uuid.uuid4().hex}"
            await db.execute(
                text(
                    """INSERT INTO admin_accounts
                       (id,username,password_hash,is_superadmin,created_by_admin_id)
                       VALUES (:id,:username,:hash,false,:actor)"""
                ),
                {
                    "id": admin_id, "username": username,
                    "hash": password_hash, "actor": actor_admin_id,
                },
            )
            await db.commit()
            return admin_id

    async def authenticate(self, username: str, password: str) -> dict | None:
        async with self._sessions() as db:
            row = (
                await db.execute(
                    text(
                        """SELECT id,username,password_hash,is_superadmin
                           FROM admin_accounts WHERE username=:username AND is_active=true"""
                    ),
                    {"username": username.strip()},
                )
            ).mappings().first()
        if row is None or not verify_password(password, row["password_hash"]):
            return None
        return {
            "id": row["id"], "username": row["username"],
            "is_superadmin": bool(row["is_superadmin"]),
        }

    async def get_admin(self, admin_id: str) -> dict | None:
        async with self._sessions() as db:
            row = (
                await db.execute(
                    text(
                        """SELECT id,username,is_superadmin,is_active,created_at
                           FROM admin_accounts WHERE id=:id"""
                    ),
                    {"id": admin_id},
                )
            ).mappings().first()
            return dict(row) if row and row["is_active"] else None

    async def list_admins(self) -> list[dict]:
        async with self._sessions() as db:
            rows = (
                await db.execute(
                    text(
                        """SELECT id,username,is_superadmin,is_active,created_at
                           FROM admin_accounts ORDER BY is_superadmin DESC,created_at,id"""
                    )
                )
            ).mappings().all()
            return [dict(row) for row in rows]
