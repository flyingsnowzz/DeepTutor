"""MCP-facing capability metadata, limits and cost hints."""

from __future__ import annotations

import os
from typing import Any, Literal

JobStatus = Literal["queued", "running", "needs_input", "succeeded", "failed", "canceled"]
CapabilityName = Literal[
    "deep_research",
    "visualize",
    "deep_question",
    "problem_solve",
    "quiz_judge",
    "audio_overview",
    "mastery_path",
]

MAX_INPUT_CHARS = 16_000
MAX_OUTPUT_CHARS = 8_000

#: Capabilities exposed through the asynchronous job boundary.
CAPABILITIES: dict[str, dict[str, Any]] = {
    "deep_research": {
        "display_name": "深度研究",
        "supports_jobs": True,
        "estimated_duration_sec": 60,
        "missing_dependencies": [],
        "cost_hint": {"meter": "research", "billed_event": "job_succeeded"},
    },
    "visualize": {
        "display_name": "可视化讲解",
        "supports_jobs": True,
        "estimated_duration_sec": 20,
        "missing_dependencies": [],
        "cost_hint": {"meter": "visualization", "billed_event": "job_succeeded"},
    },
    "deep_question": {
        "display_name": "出题练习",
        "supports_jobs": True,
        "estimated_duration_sec": 30,
        "missing_dependencies": [],
        "cost_hint": {"meter": "question", "billed_event": "job_succeeded"},
    },
    "problem_solve": {
        "display_name": "分步解题",
        "supports_jobs": True,
        "estimated_duration_sec": 45,
        "missing_dependencies": [],
        "cost_hint": {"meter": "solve", "billed_event": "job_succeeded"},
    },
    "quiz_judge": {
        "display_name": "主观题判分",
        "supports_jobs": True,
        "estimated_duration_sec": 30,
        "missing_dependencies": [],
        # Formative feedback only — never an official score.
        "cost_hint": {"meter": "judge", "billed_event": "job_succeeded", "formative_only": True},
    },
    "audio_overview": {
        "display_name": "音频导学",
        "supports_jobs": True,
        "estimated_duration_sec": 120,
        "missing_dependencies": [],
        "cost_hint": {"meter": "media", "billed_event": "job_succeeded", "media": True},
    },
    "mastery_path": {
        "display_name": "掌握路径生成",
        "supports_jobs": True,
        "estimated_duration_sec": 60,
        "missing_dependencies": [],
        "cost_hint": {"meter": "mastery", "billed_event": "job_succeeded"},
    },
}

#: Aliases accepted by convenience submit tools.
CAPABILITY_ALIASES = {
    "quiz_generate": "deep_question",
    "quiz_judge": "quiz_judge",
    "problem_solve": "problem_solve",
    "audio_overview_generate": "audio_overview",
    "mastery_path_generate": "mastery_path",
}


def max_request_bytes() -> int:
    return int(os.environ.get("MCP_REQUEST_MAX_BYTES", str(1024 * 1024)))


def rate_limit_per_minute(scope: str) -> int:
    defaults = {"mcp": 120, "auth": 20}
    return int(os.environ.get(f"MCP_RATE_LIMIT_{scope.upper()}_PER_MINUTE", str(defaults[scope])))
