"""Separate credential store for administrator accounts.

The deployment administrator is configured by ``auth.json``. Additional
administrators live in ``data/system/auth/admins.json`` and can only be
created by that deployment administrator.
"""

from __future__ import annotations

import json
from typing import Any

from deeptutor.services.file_io import atomic_write_text

from . import identity

def _path():
    return identity.AUTH_DIR / "admins.json"


def bootstrap_admin() -> tuple[str, dict[str, Any]] | None:
    username, password_hash = identity._env_bootstrap_admin()
    if not username or not password_hash:
        return None
    return username, {
        "id": "env-admin",
        "hash": password_hash,
        "role": "admin",
        "super_admin": True,
        "disabled": False,
    }


def load_admins() -> dict[str, dict[str, Any]]:
    path = _path()
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {
        username: record
        for username, record in raw.items()
        if isinstance(username, str) and isinstance(record, dict)
        and record.get("hash") and record.get("role") == "admin"
    }


def get_admin(username: str) -> dict[str, Any] | None:
    bootstrap = bootstrap_admin()
    if bootstrap and username == bootstrap[0]:
        return bootstrap[1]
    return load_admins().get(username)


def get_admin_by_id(admin_id: str) -> tuple[str, dict[str, Any]] | None:
    bootstrap = bootstrap_admin()
    if bootstrap and bootstrap[1]["id"] == admin_id:
        return bootstrap
    for username, record in load_admins().items():
        if record.get("id") == admin_id:
            return username, record
    return None


def create_admin(username: str, hashed_password: str) -> dict[str, Any] | None:
    """Create an administrator atomically, or return None for a taken name."""
    # Share the account creation lock with public registration so the same
    # username cannot land in both stores during a concurrent request burst.
    with identity._USERS_WRITE_LOCK:
        admins = load_admins()
        if username in admins or get_admin(username) is not None:
            return None
        # Names remain unique across the two account systems so legacy
        # username-based API paths cannot resolve the wrong principal.
        if username in identity.load_users():
            return None
        record = {
            "id": identity.new_user_id(),
            "hash": hashed_password,
            "role": "admin",
            "super_admin": False,
            "created_at": identity.utc_now(),
            "disabled": False,
        }
        admins[username] = record
        path = _path()
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_text(path, json.dumps(admins, indent=2, ensure_ascii=False))
        return record.copy()


def list_admins() -> list[dict[str, Any]]:
    records = load_admins()
    bootstrap = bootstrap_admin()
    if bootstrap:
        records = {bootstrap[0]: bootstrap[1], **records}
    return [
        {
            "id": str(record.get("id") or ""),
            "username": username,
            "role": "admin",
            "super_admin": bool(record.get("super_admin")),
            "created_at": str(record.get("created_at") or ""),
            "disabled": bool(record.get("disabled")),
        }
        for username, record in records.items()
    ]
