"""T1 MCP request/response helpers and capability metadata."""

from __future__ import annotations

from typing import Any, Literal

JobStatus = Literal["queued", "running", "needs_input", "succeeded", "failed", "canceled"]
CapabilityName = Literal["deep_research", "visualize", "deep_question"]

CAPABILITIES: dict[str, dict[str, Any]] = {
    "deep_research": {
        "display_name": "深度研究",
        "supports_jobs": True,
        "estimated_duration_sec": 60,
        "missing_dependencies": [],
        "t1_status": "job",
    },
    "visualize": {
        "display_name": "可视化讲解",
        "supports_jobs": True,
        "estimated_duration_sec": 20,
        "missing_dependencies": [],
        "t1_status": "ready",
    },
    "deep_question": {
        "display_name": "出题练习",
        "supports_jobs": True,
        "estimated_duration_sec": 30,
        "missing_dependencies": [],
        "t1_status": "job",
    },
}

MAX_INPUT_CHARS = 16_000
MAX_OUTPUT_CHARS = 8_000
