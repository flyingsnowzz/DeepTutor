"""Capability runners backing platform jobs.

Only the protocol and the LLM-free deterministic runner live here, keeping the
domain/services layer free of any application-facade dependency. The real
adapter that executes a capability through `DeepTutorApp` lives in
`deeptutor_cli.mcp_runner` (CLI/transport adapter layer) and is injected by the
entry point that starts the MCP server.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass
class CapabilityRunResult:
    result: dict[str, Any]
    artifacts: list[dict[str, Any]]
    usage: dict[str, Any]


class CapabilityRunner(Protocol):
    async def run(self, *, capability: str, payload: dict[str, Any]) -> CapabilityRunResult: ...


class DeterministicCapabilityRunner:
    """Small runner used by stdio unit tests.

    It deliberately returns deterministic payloads and never calls an LLM. This
    keeps MCP protocol, persistence, idempotency and owner isolation tests fast.
    """

    async def run(self, *, capability: str, payload: dict[str, Any]) -> CapabilityRunResult:
        prompt = str(payload.get("prompt", ""))
        if capability == "visualize":
            mermaid = "flowchart LR\n    A[学习] --> B[练习] --> C[复习]"
            return CapabilityRunResult(
                result={"response": "```mermaid\n" + mermaid + "\n```", "render_type": "mermaid"},
                artifacts=[
                    {
                        "key_suffix": "learning-loop.mmd",
                        "data": mermaid.encode(),
                        "kind": "visualization_source",
                        "mime_type": "text/vnd.mermaid",
                        "filename": "learning-loop.mmd",
                    }
                ],
                usage={},
            )
        if capability == "deep_research":
            return CapabilityRunResult(
                result={
                    "mode": payload.get("config", {}).get("mode", "notes"),
                    "status": "queued",
                    "topic": prompt[:500],
                },
                artifacts=[],
                usage={},
            )
        if capability == "deep_question":
            return CapabilityRunResult(
                result={"questions": [], "note": "Quiz generation executor placeholder."},
                artifacts=[],
                usage={},
            )
        raise ValueError(f"Unsupported capability: {capability}")
