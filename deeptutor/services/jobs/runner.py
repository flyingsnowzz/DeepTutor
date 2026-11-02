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
                usage={
                    "provider": "deterministic",
                    "model": "fake",
                    "prompt_tokens": 4,
                    "completion_tokens": 8,
                    "total_tokens": 12,
                },
            )
        if capability == "problem_solve":
            return CapabilityRunResult(
                result={
                    "steps": [{"index": 1, "title": "审题", "body": prompt[:200]}],
                    "final_answer": "",
                    "similar_practice": [],
                    "note": "Step-by-step solve executor placeholder.",
                },
                artifacts=[],
                usage={
                    "provider": "deterministic",
                    "model": "fake",
                    "prompt_tokens": 6,
                    "completion_tokens": 12,
                    "total_tokens": 18,
                },
            )
        if capability == "quiz_judge":
            return CapabilityRunResult(
                result={
                    "score": None,
                    "verdict": "formative_feedback_only",
                    "feedback": "主观题判分执行器占位；结果仅作形成性反馈，不代表官方评分。",
                },
                artifacts=[],
                usage={
                    "provider": "deterministic",
                    "model": "fake",
                    "prompt_tokens": 6,
                    "completion_tokens": 10,
                    "total_tokens": 16,
                },
            )
        if capability == "audio_overview":
            transcript = f"音频导学（占位）：{prompt[:300]}"
            return CapabilityRunResult(
                result={
                    "audio_ready": False,
                    "transcript": transcript,
                    "note": "Audio overview executor placeholder (media pipeline lands in T4).",
                },
                artifacts=[
                    {
                        "key_suffix": "overview.txt",
                        "data": transcript.encode(),
                        "kind": "audio_transcript",
                        "mime_type": "text/plain",
                        "filename": "overview.txt",
                    }
                ],
                usage={
                    "provider": "deterministic",
                    "model": "fake",
                    "prompt_tokens": 8,
                    "completion_tokens": 16,
                    "total_tokens": 24,
                },
            )
        if capability == "mastery_path":
            return CapabilityRunResult(
                result={"path": None, "note": "Mastery path generation executor placeholder."},
                artifacts=[],
                usage={
                    "provider": "deterministic",
                    "model": "fake",
                    "prompt_tokens": 5,
                    "completion_tokens": 9,
                    "total_tokens": 14,
                },
            )
        if capability == "video_lesson":
            data = b"RIFF" + b"\x00" * 60
            return CapabilityRunResult(
                result={
                    "video_ready": False,
                    "render_type": "placeholder",
                    "note": "视频课渲染占位；真实环境经 Remotion/TTS 渲染为 mp4（约 2-8 分钟）。",
                },
                artifacts=[
                    {
                        "key_suffix": "lesson.mp4",
                        "data": data,
                        "kind": "video_lesson",
                        "mime_type": "video/mp4",
                        "filename": "lesson.mp4",
                    }
                ],
                usage={
                    "provider": "deterministic",
                    "model": "fake",
                    "prompt_tokens": 10,
                    "completion_tokens": 20,
                    "total_tokens": 30,
                },
            )
        if capability == "math_animator":
            scene = "# Manim placeholder scene; real render needs manim/LaTeX/ffmpeg"
            return CapabilityRunResult(
                result={
                    "video_ready": False,
                    "render_type": "placeholder",
                    "note": "数学动画渲染占位；真实环境经 Manim 渲染为 mp4（约 1-5 分钟）。",
                },
                artifacts=[
                    {
                        "key_suffix": "scene.py",
                        "data": scene.encode(),
                        "kind": "math_animation_source",
                        "mime_type": "text/x-python",
                        "filename": "scene.py",
                    }
                ],
                usage={
                    "provider": "deterministic",
                    "model": "fake",
                    "prompt_tokens": 8,
                    "completion_tokens": 16,
                    "total_tokens": 24,
                },
            )
        raise ValueError(f"Unsupported capability: {capability}")
