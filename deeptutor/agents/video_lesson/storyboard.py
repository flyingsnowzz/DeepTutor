"""Structured storyboard to safe Remotion TSX generation."""

from __future__ import annotations

import json
from typing import Any

from .narration import NarrationLine


def _text(value: Any) -> str:
    return str(value or "").strip()


def storyboard_tsx(storyboard: dict[str, Any]) -> tuple[str, list[NarrationLine]]:
    """Compile a bounded storyboard into the shipped kit, never freeform model code."""
    scenes = list(storyboard.get("scenes") or [])
    if not scenes:
        raise ValueError("storyboard requires at least one scene")
    chunks: list[str] = []
    narration: list[NarrationLine] = []
    for index, scene in enumerate(scenes[:8], start=1):
        if not isinstance(scene, dict):
            continue
        heading = _text(scene.get("heading") or scene.get("title")) or f"第 {index} 节"
        bullets = [
            _text(item)
            for item in list(scene.get("bullets") or scene.get("points") or [])
            if _text(item)
        ][:6]
        formula = _text(scene.get("formula") or scene.get("equation"))
        voice = f"scene-{index}"
        spoken = _text(scene.get("narration")) or " ".join([heading, *bullets, formula])
        narration.append(NarrationLine(voice, spoken[:500]))
        body = "".join(f"<p>{json.dumps(item, ensure_ascii=False)}</p>" for item in bullets)
        formula_block = (
            f"<Card x={{120}} y={{560}} w={{900}} title={{\"核心公式\"}}>"
            f"<Formula>{{{json.dumps(formula, ensure_ascii=False)}}}</Formula></Card>"
            if formula
            else ""
        )
        chunks.append(
            "{voice: "
            + json.dumps(voice)
            + ", frames: 150, content: (<Stage eyebrow={"
            + json.dumps(storyboard.get("title") or "DeepTutor 视频课", ensure_ascii=False)
            + "}><Title x={120} y={150} w={1500} size={72}>{"
            + json.dumps(heading, ensure_ascii=False)
            + "}</Title><Body x={120} y={300} w={1200} size={38}>"
            + body
            + "</Body>"
            + formula_block
            + "</Stage>)},"
        )
    if not chunks:
        raise ValueError("storyboard contains no usable scenes")
    code = (
        "import React from 'react';\n"
        "import {Stage, Title, Body, Card, Formula, Scenes, lessonLength} from './kit';\n\n"
        "const scenes = [\n"
        + "\n".join(chunks)
        + "\n];\n\n"
        "export const LESSON = {durationInFrames: lessonLength(scenes), fps: 30, width: 1920, height: 1080};\n\n"
        "export function Lesson() {\n"
        "  return <Scenes scenes={scenes} />;\n"
        "}\n"
    )
    return code, narration
