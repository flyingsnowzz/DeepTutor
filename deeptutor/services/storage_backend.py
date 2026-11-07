"""First-party storage selection and authenticated PostgreSQL owner scope."""

from __future__ import annotations

import os


def storage_backend() -> str:
    value = str(os.environ.get("DEEPTUTOR_STORAGE_BACKEND") or "local").strip().lower()
    if value not in {"local", "postgres"}:
        raise RuntimeError(f"Unsupported DEEPTUTOR_STORAGE_BACKEND: {value!r}")
    if value == "postgres" and str(
        os.environ.get("DEEPTUTOR_ACCOUNT_BACKEND") or "local"
    ).strip().lower() != "postgres":
        raise RuntimeError(
            "PostgreSQL storage requires DEEPTUTOR_ACCOUNT_BACKEND=postgres"
        )
    return value


def postgres_owner_user_id() -> str:
    """Resolve the already authenticated learner, failing closed on ambiguity."""
    if storage_backend() != "postgres":
        raise RuntimeError("PostgreSQL owner requested outside PostgreSQL storage mode")
    from deeptutor.multi_user.context import get_current_user_or_none

    user = get_current_user_or_none()
    if user is not None:
        if user.scope.kind != "user" or user.role == "admin":
            raise RuntimeError("PostgreSQL learning storage requires an ordinary user")
        return user.id
    raise RuntimeError("PostgreSQL storage requires an authenticated user context")
