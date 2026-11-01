"""Capability runners backing MCP jobs."""

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


class TurnCapabilityRunner:
    """Execute a capability through DeepTutor's normal application service."""

    def __init__(self, *, language: str = "zh"):
        self.language = language

    async def run(self, *, capability: str, payload: dict[str, Any]) -> CapabilityRunResult:
        # Import lazily so MCP unit tests do not start the full application container.
        from deeptutor.app import DeepTutorApp
        from deeptutor.core.turn_request import TurnRequest

        app = DeepTutorApp()
        config = payload.get("config") if isinstance(payload.get("config"), dict) else {}
        if capability == "deep_research":
            config = {"mode": "notes", "depth": "quick", **config}
        request = TurnRequest(
            content=str(payload.get("prompt", "")),
            capability=capability,
            knowledge_bases=list(payload.get("knowledge_bases") or []),
            language=str(payload.get("language") or self.language),
            config=config,
            tools=list(payload.get("tools") or []),
        )
        _, turn = await app.start_turn(request)
        final_result: dict[str, Any] | None = None
        terminal: dict[str, Any] | None = None
        async for event in app.stream_turn(turn["id"]):
            if event.get("type") == "result":
                final_result = event
            if event.get("type") == "done":
                terminal = event
        if terminal is None:
            raise RuntimeError("Capability turn ended without a done event")
        status = terminal.get("metadata", {}).get("status")
        if status not in {"completed", "succeeded"}:
            message = terminal.get("metadata", {}).get("error") or "Capability run failed"
            raise RuntimeError(str(message))
        metadata = (final_result or {}).get("metadata") or {}
        result = {
            "response": metadata.get("response") or (final_result or {}).get("content") or "",
            **({k: v for k, v in metadata.items() if k not in {"cost_summary", "usage_summary"}}),
        }
        return CapabilityRunResult(
            result=result,
            artifacts=list(self._artifacts_from_result(capability, result)),
            usage=metadata.get("usage_summary") or metadata.get("cost_summary") or {},
        )

    def _artifacts_from_result(self, capability: str, result: dict[str, Any]):
        if capability != "visualize":
            return []
        payload = result.get("payload") or {}
        data = payload.get("data")
        if not data:
            return []
        mime_type = (
            "text/vnd.mermaid" if payload.get("format") == "text/vnd.mermaid" else "text/plain"
        )
        suffix = "visualization.mmd" if "mermaid" in mime_type else "visualization.txt"
        yield {
            "key_suffix": suffix,
            "data": str(data).encode(),
            "kind": "visualization_source",
            "mime_type": mime_type,
            "filename": suffix,
        }
