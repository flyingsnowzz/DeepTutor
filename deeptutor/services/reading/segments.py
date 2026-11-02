"""Material segmentation with citable locators (page / section / timestamp)."""

from __future__ import annotations

from dataclasses import dataclass
import re

SEGMENT_CHARS = 900
SEGMENT_OVERLAP = 120


@dataclass(frozen=True)
class ReadingSegment:
    ordinal: int
    locator_type: str  # page | section | timestamp
    locator_value: str
    locator_label: str
    content: str


def _split_long(text: str, max_chars: int = SEGMENT_CHARS) -> list[str]:
    text = text.strip()
    if len(text) <= max_chars:
        return [text] if text else []
    parts: list[str] = []
    sentences = re.split(r"(?<=[。！？!?\n])", text)
    buf = ""
    for sentence in sentences:
        if len(buf) + len(sentence) <= max_chars:
            buf += sentence
        else:
            if buf.strip():
                parts.append(buf.strip())
            if len(sentence) <= max_chars:
                buf = sentence
            else:
                for i in range(0, len(sentence), max_chars - SEGMENT_OVERLAP):
                    chunk = sentence[i : i + max_chars].strip()
                    if chunk and (not parts or parts[-1] != chunk):
                        parts.append(chunk)
                buf = ""
    if buf.strip():
        parts.append(buf.strip())
    return parts


def segment_text(title: str, content: str) -> list[ReadingSegment]:
    """Plain text / slides markdown: split on section headings then length."""
    segments: list[ReadingSegment] = []
    ordinal = 0
    sections = re.split(r"(?m)^(#{1,3})\s+(.+)$", content)
    # re.split with groups yields [pre, hashes, title, body, hashes, title, ...]
    if len(sections) == 1:
        for chunk in _split_long(content):
            ordinal += 1
            segments.append(
                ReadingSegment(ordinal, "section", title or "全文", title or "全文", chunk)
            )
        return segments

    current_title = title or "开头"
    blocks: list[tuple[str, str]] = []
    preamble = sections[0]
    if preamble.strip():
        blocks.append((title or "开头", preamble))
    for i in range(1, len(sections) - 2, 3):
        heading = sections[i + 1].strip()
        body = sections[i + 2]
        blocks.append((heading, body))

    for section_title, body in blocks:
        for chunk in _split_long(body):
            ordinal += 1
            segments.append(
                ReadingSegment(
                    ordinal,
                    "section",
                    section_title[:128],
                    f"章节：{section_title[:80]}",
                    chunk,
                )
            )
    return segments


_TIMESTAMP_RE = re.compile(r"(?:\[)?(?P<t>(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?)(?:\])?")


def segment_transcript(content: str) -> list[ReadingSegment]:
    """Video transcript: keep timestamp anchors (e.g. [00:03:12] or 03:12)."""
    segments: list[ReadingSegment] = []
    ordinal = 0
    buf: list[str] = []
    current_ts = "00:00"

    def flush(ts: str, lines: list[str]) -> None:
        nonlocal ordinal
        text = "\n".join(lines).strip()
        for chunk in _split_long(text):
            ordinal += 1
            segments.append(ReadingSegment(ordinal, "timestamp", ts, f"时间戳 {ts}", chunk))

    for line in content.splitlines():
        match = _TIMESTAMP_RE.search(line)
        if match:
            if buf:
                flush(current_ts, buf)
                buf = []
            current_ts = match.group("t").replace(",", ".")
        buf.append(line)
    if buf:
        flush(current_ts, buf)
    return segments


def segment_pdf_bytes(data: bytes, *, max_pages: int = 400) -> list[ReadingSegment]:
    """PDF/e-book -> per-page segments via PyMuPDF (no model download needed)."""
    import fitz  # PyMuPDF

    doc = fitz.open(stream=data, filetype="pdf")
    segments: list[ReadingSegment] = []
    ordinal = 0
    try:
        for page_index, page in enumerate(doc):
            if page_index >= max_pages:
                break
            text = page.get_text("text") or ""
            for chunk in _split_long(text):
                ordinal += 1
                page_no = page_index + 1
                segments.append(
                    ReadingSegment(
                        ordinal,
                        "page",
                        str(page_no),
                        f"第 {page_no} 页",
                        chunk,
                    )
                )
    finally:
        doc.close()
    return segments
