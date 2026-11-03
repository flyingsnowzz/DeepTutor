"""Compile bounded teaching content into a simple, reliable Manim scene.

The structured path is used by headless MCP jobs and as a fallback when a
reasoning model cannot finish freeform code. It intentionally uses ``Text``
instead of TeX so short formula lessons do not depend on a LaTeX toolchain.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .models import GeneratedCode

_MATH_LINE = re.compile(
    r"(?:[A-Za-z][A-Za-z0-9_]*|[0-9]+)\s*[=^³²]\s*[^\n。；]+",
)


def _clean(value: Any, *, limit: int = 90) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip(" \t\r\n-—:：")
    return text[:limit].strip()


def _teaching_lines(user_input: str, analysis: Any, design: Any) -> tuple[str, list[str]]:
    formulas = []
    for match in _MATH_LINE.finditer(user_input):
        line = _clean(match.group(0))
        if line and line not in formulas:
            formulas.append(line)
    candidates = formulas or [
        *list(getattr(design, "scene_outline", []) or []),
        *list(getattr(analysis, "narrative_steps", []) or []),
        *list(getattr(analysis, "visual_targets", []) or []),
    ]
    lines = []
    for item in candidates:
        line = _clean(item)
        if line and line not in lines:
            lines.append(line)
    if not lines:
        lines = [_clean(user_input, limit=80) or "数学概念讲解"]
    title = _clean(getattr(design, "title", ""), limit=60) or "DeepTutor 数学动画"
    return title, lines[:3]


def structured_manim_code(*, user_input: str, analysis: Any, design: Any) -> GeneratedCode:
    title, lines = _teaching_lines(user_input, analysis, design)
    body = [
        "from manim import Scene, Text, Write, FadeIn, UP, DOWN",
        "",
        "class StructuredMathScene(Scene):",
        "    def construct(self):",
        f"        title = Text({json.dumps(title, ensure_ascii=False)}, font_size=40)",
        "        title.to_edge(UP, buff=0.65)",
        "        self.play(Write(title), run_time=0.6)",
        "        previous = title",
    ]
    for line in lines:
        body.extend(
            [
                f"        line = Text({json.dumps(line, ensure_ascii=False)}, font_size=34)",
                "        line.next_to(previous, DOWN, buff=0.65)",
                "        self.play(FadeIn(line, shift=DOWN * 0.2), run_time=0.65)",
                "        previous = line",
            ]
        )
    body.extend(["        self.wait(1.5)", ""])
    return GeneratedCode(
        code="\n".join(body),
        rationale="DeepTutor structured Manim scene compiled from the teaching plan.",
    )
