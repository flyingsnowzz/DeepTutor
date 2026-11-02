"""LLM-backed reading answerer with deterministic retrieval fallback.

Retrieval stays deterministic (CJK-aware ranking over segmented material);
only the final synthesis calls the configured LLM. Citation ordinals are
always attached server-side, so a model cannot invent page/section references.
Any LLM failure degrades to the deterministic grounded answer.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from .answerer import (
    CitedSegment,
    DeterministicReadingAnswerer,
    ReadingAnswer,
    _score,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "你是 DeepTutor 的精读助教。只依据提供的材料段落回答，并在引用处用 [n] 标注段落序号。"
    "不得编造材料之外的页码或事实；材料不足时直接说明。用中文、简洁分点。"
)


class LLMReadingAnswerer:
    def __init__(self, *, fallback: DeterministicReadingAnswerer | None = None, top_k: int = 4):
        self._fallback = fallback or DeterministicReadingAnswerer()
        self._top_k = top_k

    @staticmethod
    def is_configured() -> bool:
        try:
            from deeptutor.services.llm.config import get_llm_config

            config = get_llm_config()
            return bool(getattr(config, "api_key", None))
        except Exception:  # noqa: BLE001
            return False

    def _rank(
        self, question: str, mode: str, segments: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        if mode in {"summary", "quiz"}:
            ranked = sorted(segments, key=lambda s: _score(question, s["content"]), reverse=True)
            if any(_score(question, s["content"]) for s in segments):
                return ranked[: self._top_k]
            return segments[: self._top_k]
        ranked = sorted(segments, key=lambda s: _score(question, s["content"]), reverse=True)
        return [s for s in ranked if _score(question, s["content"]) > 0][: self._top_k]

    async def answer(
        self,
        *,
        question: str,
        mode: str,
        material_title: str,
        segments: list[dict[str, Any]],
        history: list[dict[str, Any]],
    ) -> ReadingAnswer:
        hits = self._rank(question, mode, segments)
        if not hits:
            return await self._fallback.answer(
                question=question,
                mode=mode,
                material_title=material_title,
                segments=segments,
                history=history,
            )
        context = "\n\n".join(
            f"[{s['ordinal']}] ({s['locator_label']})\n{s['content']}" for s in hits
        )
        instruction = {
            "summary": "请逐段总结要点，每点用 [n] 标注出处。",
            "quiz": "请基于材料出 1 道复习题，并用 [n] 标注题目依据的段落。",
        }.get(mode, "请回答问题，并用 [n] 标注依据段落。")
        prompt = f"材料：《{material_title}》\n\n{context}\n\n问题：{question}\n{instruction}"
        try:
            from deeptutor.services.llm.client import get_llm_client

            client = get_llm_client()
            llm_history = [
                {"role": str(m.get("role", "user")), "content": str(m.get("content", ""))[:1000]}
                for m in history[-6:]
            ] or None
            text = await client.complete(prompt, system_prompt=SYSTEM_PROMPT, history=llm_history)
        except Exception:  # noqa: BLE001
            logger.warning("LLM reading answer failed; using deterministic fallback", exc_info=True)
            return await self._fallback.answer(
                question=question,
                mode=mode,
                material_title=material_title,
                segments=segments,
                history=history,
            )

        citations = self._citations_from_markers(text, hits) or [
            CitedSegment(
                ordinal=s["ordinal"],
                locator_type=s["locator_type"],
                locator_label=s["locator_label"],
                snippet=s["content"][:200],
            )
            for s in hits[:2]
        ]
        return ReadingAnswer(
            content=text.strip(),
            citations=citations,
            followups=("逐段总结", "出复习题", "再深入讲讲这一段"),
        )

    @staticmethod
    def _citations_from_markers(text: str, hits: list[dict[str, Any]]) -> list[CitedSegment]:
        by_ordinal = {s["ordinal"]: s for s in hits}
        citations: list[CitedSegment] = []
        for number in re.findall(r"\[(\d+)\]", text):
            seg = by_ordinal.get(int(number))
            if seg and not any(c.ordinal == seg["ordinal"] for c in citations):
                citations.append(
                    CitedSegment(
                        ordinal=seg["ordinal"],
                        locator_type=seg["locator_type"],
                        locator_label=seg["locator_label"],
                        snippet=seg["content"][:200],
                    )
                )
        return citations
