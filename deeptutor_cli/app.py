"""CLI-only authenticated owner selection for the application facade."""

from __future__ import annotations

import os

from deeptutor.app import DeepTutorApp
from deeptutor.services.storage_backend import storage_backend


def create_cli_app(*, workspace_id: str | None = None) -> DeepTutorApp:
    user_id = None
    if storage_backend() == "postgres":
        user_id = str(os.environ.get("DEEPTUTOR_CLI_USER_ID") or "").strip()
        if not user_id:
            raise RuntimeError(
                "PostgreSQL CLI requires DEEPTUTOR_CLI_USER_ID to select a user"
            )
    return DeepTutorApp(workspace_id=workspace_id, user_id=user_id)
