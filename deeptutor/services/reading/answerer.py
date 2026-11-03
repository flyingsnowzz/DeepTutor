"""Answerer protocol for reading sessions.

Deterministic retriever keeps tests and trial environments offline; the
production LLM answerer is injected by the CLI adapter (kept outside services
so the domain layer never imports the application facade).
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Protocol


@dataclass(frozen=True)
class CitedSegment:
    ordinal: int
    locator_type: str
    locator_label: str
    snippet: str


@dataclass(frozen=True)
class ReadingAnswer:
    content: str
    citations: list[CitedSegment]
    followups: tuple[str, ...] = ()
    engine: str = "deterministic"
    degraded: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "content": self.content,
            "citations": [
                {
                    "ordinal": c.ordinal,
                    "locator_type": c.locator_type,
                    "locator": c.locator_label,
                    "snippet": c.snippet,
                }
                for c in self.citations
            ],
            "followups": list(self.followups),
            "engine": self.engine,
            "degraded": self.degraded,
        }


class ReadingAnswerer(Protocol):
    async def answer(
        self,
        *,
        question: str,
        mode: str,
        material_title: str,
        segments: list[dict[str, Any]],
        history: list[dict[str, Any]],
    ) -> ReadingAnswer: ...


def _terms(text: str) -> set[str]:
    """CJK-aware query terms: latin words plus overlapping CJK bigrams."""
    lowered = text.lower()
    terms = {t for t in re.findall(r"[a-z0-9]{2,}", lowered)}
    cjk = "".join(re.findall(r"[\u4e00-\u9fff]+", lowered))
    terms.update(cjk[i : i + 2] for i in range(max(0, len(cjk) - 1)))
    return {t for t in terms if t}


def _score(question: str, content: str) -> int:
    terms = _terms(question)
    haystack = content.lower()
    return sum(haystack.count(term) for term in terms)


class DeterministicReadingAnswerer:
    """Offline answerer: keyword retrieval over segmented material.

    Every answer is grounded in segments and carries their locators. Used by
    MCP tests/smokes; production injects an LLM-backed answerer with the same
    citation contract.
    """

    async def answer(
        self,
        *,
        question: str,
        mode: str,
        material_title: str,
        segments: list[dict[str, Any]],
        history: list[dict[str, Any]],
    ) -> ReadingAnswer:
        if mode in {"summary", "quiz"}:
            # Summary/quiz operate over the material itself rather than query
            # term overlap; rank segments by relevance when terms match, else
            # walk in document order.
            ranked = sorted(
                segments,
                key=lambda seg: _score(question, seg["content"]),
                reverse=True,
            )
            hits = (
                ranked[:3]
                if any(_score(question, seg["content"]) for seg in segments)
                else segments[:3]
            )
        else:
            ranked = sorted(
                segments,
                key=lambda seg: _score(question, seg["content"]),
                reverse=True,
            )
            hits = [seg for seg in ranked if _score(question, seg["content"]) > 0][:3]
        if not hits:
            return ReadingAnswer(
                content=(
                    f"在《{material_title}》中没有找到与该问题直接相关的段落；"
                    "可以换个说法，或指定章节/页码/时间戳。"
                ),
                citations=[],
                followups=("请逐段总结第 1 页", "基于材料出 3 道复习题"),
            )

        citations = [
            CitedSegment(
                ordinal=s["ordinal"],
                locator_type=s["locator_type"],
                locator_label=s["locator_label"],
                snippet=s["content"][:200],
            )
            for s in hits
        ]
        if mode == "summary":
            body = "\n".join(f"- {s['locator_label']}：{s['content'][:160]}" for s in hits)
            content = f"《{material_title}》要点：\n{body}"
        elif mode == "quiz":
            item = hits[0]
            content = (
                f"复习题（依据 {item['locator_label']}）：请用自己的话解释下面这段内容的核心含义——\n"
                f"“{item['content'][:180]}”"
            )
        else:
            item = hits[0]
            content = f"根据{item['locator_label']}：{item['content'][:400]}"
        return ReadingAnswer(
            content=content,
            citations=citations,
            followups=("逐段总结", "出复习题", "再深入讲讲这一段"),
        )
