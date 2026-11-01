from __future__ import annotations

from dataclasses import dataclass, field
import time
from typing import Any, Literal
import uuid

JobStatus = Literal["queued", "running", "needs_input", "succeeded", "failed", "canceled"]
TERMINAL_STATUSES = {"succeeded", "failed", "canceled"}


@dataclass
class ArtifactRecord:
    id: str
    owner_user_id: str
    job_id: str | None
    key: str
    bucket: str
    kind: str
    mime_type: str
    filename: str
    size: int
    created_at: float = field(default_factory=time.time)


@dataclass
class JobRecord:
    id: str
    owner_user_id: str
    session_id: str
    capability: str
    input: dict[str, Any]
    status: JobStatus
    idempotency_key: str | None = None
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    artifacts: list[ArtifactRecord] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None

    def to_dict(self, include_events: bool = False) -> dict[str, Any]:
        return {
            "job_id": self.id,
            "session_id": self.session_id,
            "status": self.status,
            "progress": None,
            "result": self.result,
            "artifacts": [
                {
                    "artifact_ref": artifact.id,
                    "kind": artifact.kind,
                    "mime_type": artifact.mime_type,
                    "title": artifact.filename,
                }
                for artifact in self.artifacts
            ],
            "needs_input": None,
            "error": self.error,
        }


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"
