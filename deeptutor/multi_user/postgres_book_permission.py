"""Owner-scoped PostgreSQL storage for shared-book permissions."""

from __future__ import annotations

import json

import psycopg

from deeptutor.multi_user.book_permission import BookPermission, normalize_book_permission, public_permission_dict
from deeptutor.multi_user.context import get_current_user_or_none
from deeptutor.services.postgres.database import database_url


def _connect(user_id: str):
    actor = get_current_user_or_none()
    if actor is None:
        raise RuntimeError("PostgreSQL book permission access requires an authenticated user")
    if not actor.is_admin and actor.id != user_id:
        raise PermissionError("Cannot access another user's book permissions")
    url = database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
    return psycopg.connect(url)


def load(user_id: str) -> BookPermission:
    with _connect(user_id) as db:
        db.execute("SELECT set_config('app.user_id', %s, true)", (user_id,))
        row = db.execute(
            "SELECT permission_json FROM user_book_permissions WHERE owner_user_id=%s", (user_id,)
        ).fetchone()
    return normalize_book_permission(row[0] if row else None)


def load_for_guardian(user_id: str, required_permission: str) -> BookPermission:
    from deeptutor.multi_user.guardians import guardian_can_access

    actor = get_current_user_or_none()
    if actor is None or not guardian_can_access(actor.id, user_id, required_permission):
        raise PermissionError("Guardian authorization required")
    url = database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(url) as db:
        db.execute("SELECT set_config('app.user_id', %s, true)", (user_id,))
        row = db.execute(
            "SELECT permission_json FROM user_book_permissions WHERE owner_user_id=%s", (user_id,)
        ).fetchone()
    return normalize_book_permission(row[0] if row else None)


def save(user_id: str, permission: BookPermission) -> None:
    with _connect(user_id) as db:
        db.execute("SELECT set_config('app.user_id', %s, true)", (user_id,))
        active = db.execute("SELECT id FROM users WHERE id=%s AND is_active=true", (user_id,)).fetchone()
        if not active:
            raise ValueError("User not found")
        db.execute(
            """INSERT INTO user_book_permissions(owner_user_id,permission_json)
               VALUES (%s,%s::jsonb)
               ON CONFLICT(owner_user_id) DO UPDATE SET permission_json=excluded.permission_json""",
            (user_id, json.dumps(public_permission_dict(permission), ensure_ascii=False)),
        )


def save_for_guardian(user_id: str, permission: BookPermission) -> None:
    from deeptutor.multi_user.guardians import guardian_can_access

    actor = get_current_user_or_none()
    if actor is None or not guardian_can_access(actor.id, user_id, "assign_materials"):
        raise PermissionError("Guardian authorization required")
    url = database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(url) as db:
        db.execute("SELECT set_config('app.user_id', %s, true)", (user_id,))
        existing = db.execute(
            "SELECT permission_json FROM user_book_permissions WHERE owner_user_id=%s FOR UPDATE", (user_id,)
        ).fetchone()
        current = normalize_book_permission(existing[0] if existing else None)
        if permission.create != current.create or permission.default != current.default:
            raise ValueError("Guardians cannot change book creation or default access")
        if any(level == "edit" for _, level in permission.books):
            raise ValueError("Guardians cannot grant edit access")
        db.execute(
            """INSERT INTO user_book_permissions(owner_user_id,permission_json)
               VALUES (%s,%s::jsonb)
               ON CONFLICT(owner_user_id) DO UPDATE SET permission_json=excluded.permission_json""",
            (user_id, json.dumps(public_permission_dict(permission), ensure_ascii=False)),
        )


def remove_book_override(book_id: str, user_ids: list[str]) -> list[str]:
    changed: list[str] = []
    for user_id in user_ids:
        permission = load(user_id)
        books = permission.books_dict()
        if book_id not in books:
            continue
        del books[book_id]
        save(user_id, BookPermission(create=permission.create, default=permission.default, books=tuple(books.items())))
        changed.append(user_id)
    return changed
