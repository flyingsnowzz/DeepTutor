"""PostgreSQL guardian relationships with participant-scoped reads."""

from __future__ import annotations

import json
from uuid import uuid4

import psycopg
from psycopg.errors import UniqueViolation

from deeptutor.multi_user.context import get_current_user_or_none
from deeptutor.services.postgres.database import authentication_database_url, database_url

_COLUMNS = "id,guardian_user_id,learner_user_id,permissions_json,granted_at,revoked_at,revoked_by,revocation_reason"


def _url(auth: bool) -> str:
    source = authentication_database_url() if auth else database_url()
    return source.replace("postgresql+asyncpg://", "postgresql://", 1)


def _actor():
    actor = get_current_user_or_none()
    if actor is None:
        raise RuntimeError("Guardian access requires an authenticated account")
    return actor


def _record(row) -> dict | None:
    if row is None:
        return None
    return {
        "id": row[0], "guardian_user_id": row[1], "learner_user_id": row[2],
        "permissions": row[3], "granted_at": row[4].isoformat(),
        "revoked_at": row[5].isoformat() if row[5] else None,
        "revoked_by": row[6], "revocation_reason": row[7],
    }


def _require_user(db, user_id: str, label: str) -> None:
    row = db.execute(
        """SELECT u.preset FROM users u JOIN first_party_credentials c
           ON c.owner_user_id=u.id WHERE u.id=%s AND u.is_active=true""", (user_id,),
    ).fetchone()
    if row is None:
        raise ValueError(f"Unknown {label} user id: {user_id}")
    if label == "learner" and row[0] != "learner":
        raise ValueError("Guardian authorization requires a learner account.")
    if label == "guardian" and row[0] == "learner":
        raise ValueError("Learner accounts cannot be guardians.")


def authorize(guardian_user_id: str, learner_user_id: str, permissions: list[str]) -> dict:
    if not _actor().is_admin:
        raise PermissionError("Administrator authorization required")
    if guardian_user_id == learner_user_id:
        raise ValueError("A user cannot guard their own account.")
    with psycopg.connect(_url(True)) as db:
        _require_user(db, guardian_user_id, "guardian")
        _require_user(db, learner_user_id, "learner")
        reverse = db.execute(
            """SELECT 1 FROM guardian_relationships WHERE guardian_user_id=%s
               AND learner_user_id=%s AND revoked_at IS NULL""",
            (learner_user_id, guardian_user_id),
        ).fetchone()
        if reverse:
            raise ValueError("A learner cannot guard their active guardian.")
        try:
            row = db.execute(
                f"""INSERT INTO guardian_relationships
                    (id,guardian_user_id,learner_user_id,permissions_json)
                    VALUES (%s,%s,%s,%s::jsonb) RETURNING {_COLUMNS}""",
                (f"ga_{uuid4().hex}", guardian_user_id, learner_user_id, json.dumps(permissions)),
            ).fetchone()
        except UniqueViolation as exc:
            raise ValueError("This guardian is already authorized for the learner.") from exc
    return _record(row)


def list_records(*, guardian_user_id: str | None = None, learner_user_id: str | None = None, include_revoked: bool = False) -> list[dict]:
    actor = _actor()
    if not actor.is_admin and guardian_user_id != actor.id:
        raise PermissionError("Cannot list another guardian's relationships")
    with psycopg.connect(_url(actor.is_admin)) as db:
        if not actor.is_admin:
            db.execute("SELECT set_config('app.user_id', %s, true)", (actor.id,))
        where = ["(%s OR revoked_at IS NULL)"]
        params: list = [include_revoked]
        if guardian_user_id:
            where.append("guardian_user_id=%s")
            params.append(guardian_user_id)
        if learner_user_id:
            where.append("learner_user_id=%s")
            params.append(learner_user_id)
        rows = db.execute(f"SELECT {_COLUMNS} FROM guardian_relationships WHERE {' AND '.join(where)} ORDER BY granted_at,id", params).fetchall()
    return [_record(row) for row in rows]


def by_id(relationship_id: str) -> dict | None:
    actor = _actor()
    with psycopg.connect(_url(actor.is_admin)) as db:
        if not actor.is_admin:
            db.execute("SELECT set_config('app.user_id', %s, true)", (actor.id,))
        row = db.execute(f"SELECT {_COLUMNS} FROM guardian_relationships WHERE id=%s", (relationship_id,)).fetchone()
    record = _record(row)
    if record and not actor.is_admin and record["guardian_user_id"] != actor.id:
        return None
    return record


def revoke(relationship_id: str, *, revoked_by: str, reason: str = "") -> dict | None:
    actor = _actor()
    if not actor.is_admin and actor.id != revoked_by:
        raise PermissionError("Cannot revoke another guardian's relationship")
    if actor.is_admin or actor.id == revoked_by:
        with psycopg.connect(_url(True)) as db:
            if not actor.is_admin:
                owner = db.execute("SELECT guardian_user_id FROM guardian_relationships WHERE id=%s", (relationship_id,)).fetchone()
                if owner is None or owner[0] != actor.id:
                    return None
            row = db.execute(
                f"""UPDATE guardian_relationships SET revoked_at=COALESCE(revoked_at,now()),
                    revoked_by=CASE WHEN revoked_at IS NULL THEN %s ELSE revoked_by END,
                    revocation_reason=CASE WHEN revoked_at IS NULL THEN %s ELSE revocation_reason END
                    WHERE id=%s RETURNING {_COLUMNS}""",
                (revoked_by, reason, relationship_id),
            ).fetchone()
        return _record(row)
    return None


def can_access(guardian_user_id: str, learner_user_id: str, permission: str) -> bool:
    actor = _actor()
    if not actor.is_admin and actor.id != guardian_user_id:
        return False
    with psycopg.connect(_url(True)) as auth_db:
        try:
            _require_user(auth_db, guardian_user_id, "guardian")
            _require_user(auth_db, learner_user_id, "learner")
        except ValueError:
            return False
    with psycopg.connect(_url(actor.is_admin)) as db:
        if not actor.is_admin:
            db.execute("SELECT set_config('app.user_id', %s, true)", (actor.id,))
        row = db.execute(
            """SELECT permissions_json FROM guardian_relationships
               WHERE guardian_user_id=%s AND learner_user_id=%s AND revoked_at IS NULL""",
            (guardian_user_id, learner_user_id),
        ).fetchone()
    return bool(row and permission in row[0])
