"""PostgreSQL persistence for ordinary-user grants."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import json
from typing import Any

import psycopg

from deeptutor.multi_user.context import get_current_user_or_none
from deeptutor.services.postgres.database import authentication_database_url, database_url


@dataclass(frozen=True)
class PostgresGrantWriteReceipt:
    previous: dict[str, Any] | None
    written: dict[str, Any]
    revision: int


@contextmanager
def _connect(user_id: str):
    actor = get_current_user_or_none()
    if actor is None:
        raise RuntimeError("PostgreSQL grant access requires an authenticated user")
    if not actor.is_admin and actor.id != user_id:
        raise PermissionError("Cannot access another user's grant")
    url = database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(url) as db:
        db.execute("SELECT set_config('app.user_id', %s, true)", (user_id,))
        yield db


def load(user_id: str) -> dict[str, Any] | None:
    with _connect(user_id) as db:
        row = db.execute(
            "SELECT grant_json FROM user_grants WHERE owner_user_id=%s", (user_id,)
        ).fetchone()
    return row[0] if row else None


def load_for_guardian(user_id: str, required_permission: str) -> dict[str, Any] | None:
    from deeptutor.multi_user.guardians import guardian_can_access

    actor = get_current_user_or_none()
    if actor is None or not guardian_can_access(actor.id, user_id, required_permission):
        raise PermissionError("Guardian authorization required")
    url = database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(url) as db:
        db.execute("SELECT set_config('app.user_id', %s, true)", (user_id,))
        row = db.execute("SELECT grant_json FROM user_grants WHERE owner_user_id=%s", (user_id,)).fetchone()
    return row[0] if row else None


def save(user_id: str, grant: dict[str, Any]) -> PostgresGrantWriteReceipt:
    auth_url = authentication_database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(auth_url) as auth_db:
        account = auth_db.execute(
            """SELECT u.id FROM users u JOIN first_party_credentials c
               ON c.owner_user_id=u.id WHERE u.id=%s AND u.is_active=true""",
            (user_id,),
        ).fetchone()
    if not account:
        raise ValueError(f"Unknown user id: {user_id}")
    with _connect(user_id) as db:
        locked = db.execute(
            "SELECT id FROM users WHERE id=%s AND is_active=true FOR UPDATE",
            (user_id,),
        ).fetchone()
        if not locked:
            raise ValueError(f"Unknown user id: {user_id}")
        previous = db.execute(
            "SELECT revision,grant_json FROM user_grants WHERE owner_user_id=%s FOR UPDATE",
            (user_id,),
        ).fetchone()
        revision = int(previous[0]) + 1 if previous else 1
        db.execute(
            """INSERT INTO user_grants(owner_user_id,revision,grant_json)
               VALUES (%s,%s,%s::jsonb)
               ON CONFLICT(owner_user_id) DO UPDATE SET
                   revision=excluded.revision,grant_json=excluded.grant_json""",
            (user_id, revision, json.dumps(grant, ensure_ascii=False)),
        )
    return PostgresGrantWriteReceipt(previous[1] if previous else None, grant, revision)


def restore_if_unchanged(user_id: str, receipt: PostgresGrantWriteReceipt) -> bool:
    with _connect(user_id) as db:
        current = db.execute(
            "SELECT revision,grant_json FROM user_grants WHERE owner_user_id=%s FOR UPDATE",
            (user_id,),
        ).fetchone()
        if not current or int(current[0]) != receipt.revision or current[1] != receipt.written:
            return False
        if receipt.previous is None:
            db.execute("DELETE FROM user_grants WHERE owner_user_id=%s", (user_id,))
        else:
            db.execute(
                "UPDATE user_grants SET revision=revision+1,grant_json=%s::jsonb WHERE owner_user_id=%s",
                (json.dumps(receipt.previous, ensure_ascii=False), user_id),
            )
        return True
