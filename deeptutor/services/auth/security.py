"""Password hashing and opaque/JWT token primitives for the HTTP service."""

from __future__ import annotations

import hashlib
import hmac
import secrets

import bcrypt

_BCRYPT_MAX_BYTES = 72  # bcrypt hard limit; pre-hashing longer inputs keeps behavior stable


def hash_password(password: str) -> str:
    raw = password.encode("utf-8")
    if len(raw) > _BCRYPT_MAX_BYTES:
        raw = hashlib.sha256(raw).digest()
    return bcrypt.hashpw(raw, bcrypt.gensalt(rounds=12)).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    raw = password.encode("utf-8")
    if len(raw) > _BCRYPT_MAX_BYTES:
        raw = hashlib.sha256(raw).digest()
    try:
        return bcrypt.checkpw(raw, password_hash.encode("ascii"))
    except ValueError:
        return False


def new_refresh_token() -> str:
    """Opaque high-entropy refresh token (only its hash is stored)."""
    return "dt_refresh_" + secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)
