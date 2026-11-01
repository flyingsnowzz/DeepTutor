"""Stable MCP-facing error codes for T1."""

from __future__ import annotations


class McpError(Exception):
    """Expected error that can be shown to an MCP caller."""

    def __init__(
        self, code: str, message: str, *, retryable: bool = False, details: dict | None = None
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details or {}

    def to_dict(self) -> dict:
        return {
            "ok": False,
            "data": None,
            "error": {
                "code": self.code,
                "message": self.message,
                "retryable": self.retryable,
                "details": self.details,
            },
        }


def ok(data: dict) -> dict:
    return {"ok": True, "data": data, "error": None}
