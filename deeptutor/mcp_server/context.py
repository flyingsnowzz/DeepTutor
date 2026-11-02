"""Per-request MCP context resolved from transport authentication."""

from __future__ import annotations

from dataclasses import dataclass
import uuid


@dataclass(frozen=True)
class RequestPrincipal:
    owner_user_id: str
    plan: str = "free"
    email: str | None = None
    request_id: str = ""
    ip: str = ""


def new_request_id() -> str:
    return "req_" + uuid.uuid4().hex[:16]
