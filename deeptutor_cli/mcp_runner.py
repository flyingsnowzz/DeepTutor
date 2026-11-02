"""Transport-adapter capability runner for the external MCP server.

This module intentionally lives outside the ``deeptutor`` domain layer: it
wires MCP job execution to the application facade (``DeepTutorApp``), and the
architecture boundary checker forbids ``deeptutor.services`` from importing
``deeptutor.app``. Entry points (``deeptutor mcp serve``) inject this runner
into :func:`deeptutor.mcp_server.factory.build_runtime_services`.
"""

from __future__ import annotations

from typing import Any

from deeptutor.services.jobs.runner import CapabilityRunResult


class TurnCapabilityRunner:
    """Execute a capability through DeepTutor's normal application service."""

    def __init__(self, *, language: str = "zh"):
        self.language = language

    async def run(self, *, capability: str, payload: dict[str, Any]) -> CapabilityRunResult:
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
        if capability in {"video_lesson", "math_animator"}:
            yield from self._media_artifacts(capability)
            return
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

    def _media_artifacts(self, capability: str):
        """Best-effort collection of rendered media from the agent workdir.

        Real video/animation turns write mp4 files under the capability agent
        directory; the object-store boundary must never see server paths, so
        only file bytes cross it. Returns nothing when no render exists
        (failures stay in the job result/error).
        """

        from deeptutor.services.path_service import get_path_service

        kind = "video_lesson" if capability == "video_lesson" else "math_animator"
        workdir = get_path_service().get_agent_dir(kind)
        if not workdir.exists():
            return
        candidates = sorted(
            (p for p in workdir.rglob("*.mp4") if p.is_file()),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for path in candidates[:2]:
            if path.stat().st_size == 0:
                continue
            yield {
                "key_suffix": path.name,
                "data": path.read_bytes(),
                "kind": kind,
                "mime_type": "video/mp4",
                "filename": path.name,
            }
