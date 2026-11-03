"""The agent that writes a Remotion lesson (Lesson.tsx) against the shipped kit."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import re
from typing import Any

from deeptutor.agents.base_agent import BaseAgent
from deeptutor.core.trace import build_trace_metadata, new_call_id

from .narration import NarrationLine
from .runtime import ASSETS_DIR

_JSON_BLOCK = re.compile(r"```json[ \t]*\n(.*?)\n```", re.S)
_TSX_BLOCK = re.compile(r"```(?:tsx|typescript|ts|jsx)[ \t]*\n(.*?)\n```", re.S)


@dataclass
class LessonDraft:
    title: str
    summary: str
    code: str
    raw: str
    narration: list[NarrationLine] = field(default_factory=list)


def parse_draft(reply: str) -> LessonDraft:
    """Pull the meta block and the longest code block out of a reply; empty code means unusable."""
    blocks = _TSX_BLOCK.findall(reply)
    code = max(blocks, key=len).strip() if blocks else ""
    meta: dict[str, Any] = {}
    match = _JSON_BLOCK.search(reply)
    if match:
        try:
            loaded = json.loads(match.group(1))
            meta = loaded if isinstance(loaded, dict) else {}
        except json.JSONDecodeError:
            meta = {}
    narration = [
        NarrationLine(str(item["id"]).strip(), str(item["text"]).strip())
        for item in meta.get("narration") or []
        if isinstance(item, dict)
        and str(item.get("id") or "").strip()
        and str(item.get("text") or "").strip()
    ]
    return LessonDraft(
        title=str(meta.get("title") or "").strip(),
        summary=str(meta.get("summary") or "").strip(),
        code=code,
        raw=reply,
        narration=narration,
    )


class LessonWriterAgent(BaseAgent):
    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        api_version: str | None = None,
        language: str = "zh",
    ) -> None:
        super().__init__(
            module_name="video_lesson",
            agent_name="lesson_writer",
            api_key=api_key,
            base_url=base_url,
            api_version=api_version,
            language=language,
        )
        self._messages: list[dict[str, str]] = []

    def start(self, *, user_input: str, history: str) -> None:
        system = self.get_prompt("system")
        template = self.get_prompt("user_template")
        if not system or not template:
            raise ValueError("LessonWriterAgent prompts are not configured.")
        # The kit source holds braces, so it is spliced in rather than str.format-ed.
        system = system.replace(
            "{kit_source}", (ASSETS_DIR / "kit.tsx").read_text(encoding="utf-8")
        )
        user = template.format(user_input=user_input.strip(), history=history.strip() or "-")
        self._messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]

    def add_feedback(self, *, previous: str, stage: str, errors: list[str]) -> None:
        """Keep the failed reply in the conversation and ask for a fix."""
        template = self.get_prompt("retry_template") or "{stage}\n{errors}"
        listed = "\n".join(f"- {e}" for e in errors[:20]) or "- (no detail)"
        self._messages += [
            {"role": "assistant", "content": previous},
            {"role": "user", "content": template.format(stage=stage, errors=listed)},
        ]

    async def write(self, *, attempt: int) -> LessonDraft:
        chunks: list[str] = []
        async for chunk in self.stream_llm(
            user_prompt="",
            system_prompt="",
            messages=self._messages,
            stage="code_generation",
            reasoning_effort="low",
            max_tokens=8000,
            trace_meta=build_trace_metadata(
                call_id=new_call_id("video-lesson"),
                phase="code_generation",
                label="Write lesson" if attempt == 1 else f"Fix lesson (attempt {attempt})",
                call_kind="video_lesson_code",
                trace_role="generate" if attempt == 1 else "repair",
                trace_kind="llm_output",
                attempt=attempt,
            ),
        ):
            chunks.append(chunk)
        return parse_draft("".join(chunks))

    async def write_storyboard(self, *, user_input: str, history: str) -> LessonDraft:
        """Generate content JSON instead of relying on a full freeform TSX response."""
        from deeptutor.agents._shared.json_output import extract_json_object

        from .storyboard import storyboard_tsx

        user = (
            "请为以下教学视频生成结构化分镜 JSON。只输出一个 JSON 对象，不要解释或输出代码。\n"
            "格式：{\"title\":\"...\",\"summary\":\"...\","
            "\"scenes\":[{\"heading\":\"...\",\"bullets\":[\"...\"],"
            "\"formula\":\"...\",\"narration\":\"...\"}]}。\n"
            "场景 2-4 个，每个场景聚焦一个概念；bullets 不超过 4 条，旁白简洁自然。\n\n"
            f"用户需求：{user_input.strip()}\n\n历史上下文：{history.strip() or '-'}"
        )
        chunks: list[str] = []
        async for chunk in self.stream_llm(
            user_prompt=user,
            system_prompt="你是 DeepTutor 的教学分镜设计器，严格输出合法 JSON。",
            reasoning_effort="low",
            max_tokens=4000,
            stage="code_generation",
        ):
            chunks.append(chunk)
        # Some OpenAI-compatible reasoning endpoints return no content when
        # response_format=json_object is set. Plain JSON plus the shared robust
        # parser also handles an inline <think> preamble and fenced output.
        storyboard = extract_json_object("".join(chunks))
        code, narration = storyboard_tsx(storyboard)
        return LessonDraft(
            title=str(storyboard.get("title") or "教学视频"),
            summary=str(storyboard.get("summary") or ""),
            code=code,
            raw=json.dumps(storyboard, ensure_ascii=False),
            narration=narration,
        )

    async def process(self, *, attempt: int = 1) -> LessonDraft:
        return await self.write(attempt=attempt)


__all__ = ["LessonDraft", "LessonWriterAgent", "parse_draft"]
