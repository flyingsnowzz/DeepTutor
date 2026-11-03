"""Transport-adapter capability runner for the external MCP server.

The adapter deliberately lives outside the domain layer: it wires MCP jobs to
``DeepTutorApp`` and translates interactive/multi-stage capabilities into a
headless job contract. Deterministic runners remain available for protocol
tests; this adapter always represents real capability execution.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from deeptutor.services.jobs.runner import CapabilityRunResult

_CAPABILITY_ALIASES = {"problem_solve": "deep_solve"}
_CAPABILITY_TIMEOUTS = {
    "deep_research": 1200,
    "video_lesson": 900,
    "math_animator": 900,
    "audio_overview": 600,
    "deep_question": 600,
    "problem_solve": 300,
    "visualize": 300,
    "mastery_path": 300,
    "quiz_judge": 180,
}

_PLACEHOLDER_MARKERS = (
    "placeholder",
    "占位",
    "learning-loop.mmd",
    '"video_ready": false',
    '"audio_ready": false',
)


def _usage(result: dict[str, Any]) -> dict[str, Any]:
    metadata = result.get("metadata") or {}
    return metadata.get("usage_summary") or metadata.get("cost_summary") or {}


def _merge_usage(first: dict[str, Any], second: dict[str, Any]) -> dict[str, Any]:
    """Keep the detailed second-stage usage and add both stages' totals."""
    if not first:
        return second
    if not second:
        return first
    merged = dict(second)
    for key in ("total_calls", "prompt_tokens", "completion_tokens", "total_tokens"):
        if key in first or key in second:
            merged[key] = int(first.get(key, 0) or 0) + int(second.get(key, 0) or 0)
    if "total_cost_usd" in first or "total_cost_usd" in second:
        merged["total_cost_usd"] = float(first.get("total_cost_usd", 0) or 0) + float(
            second.get("total_cost_usd", 0) or 0
        )
    merged["call_details"] = [
        *(first.get("call_details") or []),
        *(second.get("call_details") or []),
    ]
    return merged


class TurnCapabilityRunner:
    """Execute capabilities through DeepTutor's normal application service."""

    def __init__(self, *, language: str = "zh", max_auto_replies: int = 4):
        self.language = language
        self.max_auto_replies = max_auto_replies

    async def run(self, *, capability: str, payload: dict[str, Any]) -> CapabilityRunResult:
        default_timeout = _CAPABILITY_TIMEOUTS.get(capability, 600)
        timeout = max(1, min(int(payload.get("timeout_seconds") or default_timeout), 3600))
        async with asyncio.timeout(timeout):
            return await self._run(capability=capability, payload=payload)

    async def _run(self, *, capability: str, payload: dict[str, Any]) -> CapabilityRunResult:
        if capability == "quiz_judge":
            return await self._run_quiz_judge(payload)
        if capability == "mastery_path":
            return await self._run_mastery_path(payload)

        internal_name = _CAPABILITY_ALIASES.get(capability, capability)
        from deeptutor.app import DeepTutorApp

        app = DeepTutorApp()
        session, turn, result, usage = await self._run_turn(app, internal_name, payload)
        if internal_name == "deep_research" and result.get("outline_preview"):
            # The first-party UI asks the learner to confirm this outline. An
            # MCP job is headless: auto-confirm it (or use a caller-supplied
            # confirmed_outline) so the job cannot finish with only a preview.
            config = payload.get("config") if isinstance(payload.get("config"), dict) else {}
            next_payload = {
                **payload,
                "prompt": str(result.get("topic") or payload.get("prompt", "")),
                "config": {**config, "confirmed_outline": list(result.get("sub_topics") or [])},
            }
            session, turn, result, second_usage = await self._run_turn(
                app, internal_name, next_payload
            )
            usage = _merge_usage(usage, second_usage)

        artifacts = list(self._artifacts_from_result(internal_name, result, session, turn))
        self._assert_meaningful_result(internal_name, result, artifacts)
        return CapabilityRunResult(result=result, artifacts=artifacts, usage=usage)

    async def _run_turn(
        self, app, capability: str, payload: dict[str, Any]
    ) -> tuple[dict, dict, dict[str, Any], dict[str, Any]]:
        from deeptutor.core.turn_request import TurnRequest

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
        session, turn = await app.start_turn(request)
        final_result: dict[str, Any] | None = None
        terminal: dict[str, Any] | None = None
        answered: set[str] = set()
        replies = list(payload.get("replies") or [])
        async for event in app.stream_turn(turn["id"]):
            event_type = event.get("type")
            if event_type == "result":
                final_result = event
            elif event_type == "done":
                terminal = event
            elif event_type == "tool_result" and str(event.get("content", "")).startswith(
                "[awaiting user reply"
            ):
                metadata = event.get("metadata") or {}
                call_id = str(metadata.get("call_id") or metadata.get("tool_call_id") or "ask")
                if call_id in answered:
                    continue
                answered.add(call_id)
                if len(answered) > self.max_auto_replies:
                    raise RuntimeError("Capability requested too many rounds of user input")
                reply = replies.pop(0) if replies else (
                    "请按合理默认假设继续完成当前任务，不要再次追问；如需个性化，按零基础学习者处理。"
                )
                if isinstance(reply, dict):
                    reply = reply.get("text") or reply.get("reply") or json.dumps(
                        reply, ensure_ascii=False
                    )
                await app.submit_user_reply(turn["id"], text=str(reply))
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
        return session, turn, result, _usage(final_result or {})

    async def _run_mastery_path(self, payload: dict[str, Any]) -> CapabilityRunResult:
        import os

        from deeptutor.services.mastery.path_generator import MasteryPathGenerator
        from deeptutor.services.postgres.database import create_engine

        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            raise RuntimeError("mastery_path generation requires DATABASE_URL")
        engine = create_engine(database_url)
        try:
            result = await MasteryPathGenerator(engine).generate(
                owner_user_id=str(payload.get("owner_user_id") or "local-dev-user"),
                prompt=str(payload.get("prompt", "")),
                language=str(payload.get("language") or self.language),
            )
        finally:
            await engine.dispose()
        self._assert_meaningful_result("mastery_path", result, [])
        return CapabilityRunResult(result=result, artifacts=[], usage={})

    async def _run_quiz_judge(self, payload: dict[str, Any]) -> CapabilityRunResult:
        """Reuse the first-party AI judge instead of routing to a fake capability."""
        from deeptutor.api.routers.quiz_judge import (
            _JUDGE_SYSTEM_PROMPTS,
            _build_judge_user_prompt,
        )
        from deeptutor.services.llm import stream as llm_stream

        language = str(payload.get("language") or self.language)
        if language not in _JUDGE_SYSTEM_PROMPTS:
            language = "zh"
        prompt = str(payload.get("prompt", ""))
        question = str(payload.get("question") or prompt)
        if not question.strip():
            raise ValueError("quiz_judge requires a question or prompt")
        user_prompt = _build_judge_user_prompt(
            language=language,
            question=question,
            question_type=str(payload.get("question_type") or "short_answer"),
            options=payload.get("options") if isinstance(payload.get("options"), dict) else None,
            correct_answer=str(payload.get("correct_answer") or ""),
            explanation=str(payload.get("explanation") or ""),
            user_answer=str(payload.get("user_answer") or prompt),
            has_image=False,
        )
        chunks: list[str] = []
        async with asyncio.timeout(180):
            async for chunk in llm_stream(
                prompt=user_prompt,
                system_prompt=_JUDGE_SYSTEM_PROMPTS[language],
            ):
                chunks.append(str(chunk))
        response = "".join(chunks).strip()
        result = {
            "response": response,
            "feedback": response,
            "verdict": "formative_feedback_only",
            "official_score": False,
        }
        self._assert_meaningful_result("quiz_judge", result, [])
        return CapabilityRunResult(result=result, artifacts=[], usage={})

    def _artifacts_from_result(
        self,
        capability: str,
        result: dict[str, Any],
        session: dict,
        turn: dict,
    ):
        if capability == "visualize":
            payload = result.get("payload") or {}
            data = payload.get("data")
            if data:
                yield {
                    "key_suffix": "visualization.mmd",
                    "data": str(data).encode(),
                    "kind": "visualization_source",
                    "mime_type": "text/vnd.mermaid",
                    "filename": "visualization.mmd",
                }
            return

        if capability == "audio_overview":
            workspace_items = list(result.get("workspace_items") or [])
            if workspace_items:
                for item in workspace_items:
                    yield from self._workspace_item_artifact(item)
                return
            root = self._workspace_output_dir(capability, session, turn)
            for key, kind, mime in (
                ("audio_path", "audio_overview", "audio/mpeg"),
                ("transcript_path", "audio_transcript", "text/markdown"),
            ):
                name = result.get(key)
                if name:
                    yield from self._file_artifact(root / str(name), kind, mime)
            return

        if capability == "video_lesson":
            from deeptutor.services.path_service import get_path_service

            root = get_path_service().get_agent_dir("video_lesson") / turn["id"] / "artifacts"
            for item in result.get("artifacts") or []:
                yield from self._file_artifact(
                    root / str(item.get("filename") or "lesson.html"),
                    "video_lesson",
                    item.get("content_type") or "text/html",
                )
            return

        if capability == "math_animator":
            workspace_items = list(result.get("workspace_items") or [])
            if workspace_items:
                for item in workspace_items:
                    yield from self._workspace_item_artifact(item)
                return
            root = self._workspace_output_dir(capability, session, turn) / "artifacts"
            for item in result.get("artifacts") or []:
                yield from self._file_artifact(
                    root / str(item.get("filename") or ""),
                    "math_animator",
                    item.get("content_type") or "application/octet-stream",
                )

    @staticmethod
    def _workspace_item_artifact(item: dict[str, Any]):
        from deeptutor.services.workspace import get_content_workspace_service

        relative_path = str(item.get("relative_path") or "")
        workspace_id = str(item.get("workspace_id") or "")
        if not relative_path or not workspace_id:
            return
        service = get_content_workspace_service()
        binding = service.binding_by_id(workspace_id)
        path = binding.root / Path(*relative_path.split("/"))
        kind = "audio_overview" if str(item.get("mime_type", "")).startswith("audio/") else "workspace_artifact"
        yield from TurnCapabilityRunner._file_artifact(
            path,
            kind,
            item.get("mime_type") or "application/octet-stream",
        )

    @staticmethod
    def _workspace_output_dir(capability: str, session: dict, turn: dict) -> Path:
        from deeptutor.services.workspace import get_content_workspace_service

        runtime = get_content_workspace_service().create_runtime_context(
            capability=capability,
            session_id=session["id"],
            turn_id=turn["id"],
        )
        return Path(runtime.output_dir)

    @staticmethod
    def _file_artifact(path: Path, kind: str, mime_type: str):
        if not path.is_file() or path.stat().st_size == 0:
            return
        yield {
            "key_suffix": path.name,
            "data": path.read_bytes(),
            "kind": kind,
            "mime_type": mime_type,
            "filename": path.name,
        }

    @staticmethod
    def _assert_meaningful_result(
        capability: str, result: dict[str, Any], artifacts: list[dict[str, Any]]
    ) -> None:
        serialized = json.dumps(result, ensure_ascii=False, default=str).lower()
        if any(marker in serialized for marker in _PLACEHOLDER_MARKERS):
            raise RuntimeError(f"Capability {capability} returned a placeholder result")
        if result.get("outline_preview"):
            raise RuntimeError("Deep research stopped at outline preview instead of a report")
        if capability == "deep_question":
            summary = result.get("summary") or {}
            if summary and (
                not summary.get("success")
                or int(summary.get("completed", 0) or 0) < 1
                or not summary.get("results")
            ):
                raise RuntimeError("Deep question did not generate a usable question")
        if capability == "visualize" and not (result.get("payload") or {}).get("data"):
            raise RuntimeError("Visualization returned no canvas payload")
        if capability in {"audio_overview", "video_lesson", "math_animator"} and not artifacts:
            raise RuntimeError(f"Capability {capability} returned no downloadable artifacts")
        meaningful = any(
            result.get(key)
            for key in (
                "response",
                "summary",
                "feedback",
                "path",
                "path_id",
                "segments",
                "artifacts",
            )
        )
        if not meaningful:
            raise RuntimeError(f"Capability {capability} returned no meaningful output")
