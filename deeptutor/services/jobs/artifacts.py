"""Artifact safety validation for cloud jobs."""

from __future__ import annotations

import os

#: Only learner-safe learning artifact types are persisted.
ALLOWED_MIME_PREFIXES = ("text/", "image/", "audio/", "video/")
ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/json",
    "application/octet-stream",
    "application/zip",
}
#: Active content that can execute when opened in a browser.
BLOCKED_MIME_TYPES = {
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml",
}

DEFAULT_MAX_ARTIFACT_BYTES = 50 * 1024 * 1024  # 50 MiB


class ArtifactRejected(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def max_artifact_bytes() -> int:
    return int(os.environ.get("MCP_ARTIFACT_MAX_BYTES", str(DEFAULT_MAX_ARTIFACT_BYTES)))


def validate_artifact(*, mime_type: str, size_bytes: int) -> None:
    mime = (mime_type or "").split(";")[0].strip().lower()
    if not mime:
        raise ArtifactRejected("ARTIFACT_MIME_REJECTED", "artifact mime type is missing")
    if mime in BLOCKED_MIME_TYPES:
        raise ArtifactRejected("ARTIFACT_MIME_REJECTED", f"mime type {mime} is not allowed")
    allowed = mime.startswith(ALLOWED_MIME_PREFIXES) or mime in ALLOWED_MIME_TYPES
    if not allowed:
        raise ArtifactRejected("ARTIFACT_MIME_REJECTED", f"mime type {mime} is not allowed")
    if size_bytes > max_artifact_bytes():
        raise ArtifactRejected(
            "ARTIFACT_TOO_LARGE",
            f"artifact exceeds {max_artifact_bytes()} bytes",
        )
