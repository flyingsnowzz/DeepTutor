"""Compile bounded teaching content into a simple, reliable Manim scene.

The structured path is used by headless MCP jobs and as a fallback when a
reasoning model cannot finish freeform code. It intentionally uses ``Text``
instead of TeX so short formula lessons do not depend on a LaTeX toolchain.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .duration_utils import parse_target_duration_seconds
from .models import GeneratedCode

_MATH_LINE = re.compile(
    r"(?:[A-Za-z][A-Za-z0-9_]*|[0-9]+)\s*[=^³²]\s*[^\n。；]+",
)


def _clean(value: Any, *, limit: int = 90) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip(" \t\r\n-—:：")
    text = re.split(
        r"不要|无需|纯公式|即可|\bno geometry\b|\bplain formula text\b|\bonly\b",
        text,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0].strip(" ,，。；;")
    text = re.sub(r"\^2", "²", text)
    text = re.sub(r"\^3", "³", text)
    return text[:limit].strip()


def _teaching_lines(user_input: str, analysis: Any, design: Any) -> tuple[str, list[str]]:
    formulas = []
    clauses = re.split(r"(?:，|,|。|；|;|\band\b|和|以及)", user_input, flags=re.IGNORECASE)
    for clause in clauses:
        for match in _MATH_LINE.finditer(clause):
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
    duration = parse_target_duration_seconds(user_input) or 5.0
    intro_seconds = 0.6
    line_seconds = 0.65
    final_wait = max(0.8, duration - intro_seconds - len(lines) * line_seconds)
    show_title = not re.search(r"不显示标题|不要标题|无标题|no title", user_input, re.IGNORECASE)
    body = [
        "from manim import Scene, Text, Write, FadeIn, UP, DOWN",
        "",
        "class StructuredMathScene(Scene):",
        "    def construct(self):",
    ]
    if show_title:
        body.extend(
            [
                f"        title = Text({json.dumps(title, ensure_ascii=False)}, font_size=40)",
                "        title.to_edge(UP, buff=0.65)",
                f"        self.play(Write(title), run_time={intro_seconds})",
                "        previous = title",
            ]
        )
    else:
        body.append("        previous = None")
    for index, line in enumerate(lines):
        body.extend(
            [
                f"        line = Text({json.dumps(line, ensure_ascii=False)}, font_size=34)",
                (
                    "        line.next_to(previous, DOWN, buff=0.65)"
                    if index or show_title
                    else "        line.to_edge(UP, buff=0.65)"
                ),
                f"        self.play(FadeIn(line, shift=DOWN * 0.2), run_time={line_seconds})",
                "        previous = line",
            ]
        )
    body.extend([f"        self.wait({final_wait:.3f})", ""])
    return GeneratedCode(
        code="\n".join(body),
        rationale="DeepTutor structured Manim scene compiled from the teaching plan.",
    )
