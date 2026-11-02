from deeptutor.services.reading.segments import (
    segment_pdf_bytes,
    segment_text,
    segment_transcript,
)


def test_segment_text_by_sections():
    content = "# 第一章 函数\n函数的定义……\n## 二次函数\n一般形式 y=ax²+bx+c。"
    segments = segment_text("教材", content)
    assert segments
    assert {s.locator_type for s in segments} == {"section"}
    assert any("第一章 函数" in s.locator_value for s in segments)
    assert all(s.content.strip() for s in segments)
    assert [s.ordinal for s in segments] == list(range(1, len(segments) + 1))


def test_segment_text_plain_fallback():
    segments = segment_text("", "一整段没有标题的文本，介绍学习方法。")
    assert len(segments) == 1 and segments[0].locator_type == "section"


def test_segment_transcript_timestamps():
    vtt = "[00:00] 开场\n[00:03:12] 这一页讲抛物线顶点\n[00:05:00] 结尾"
    segments = segment_transcript(vtt)
    assert [s.locator_type for s in segments] == ["timestamp"] * 3
    assert segments[1].locator_value == "00:03:12"
    assert "顶点" in segments[1].content


def test_segment_pdf_pages():
    import fitz

    doc = fitz.open()
    for page_no in range(2):
        page = doc.new_page()
        page.insert_text((72, 72), f"Page {page_no + 1}: quadratic formula content.", fontsize=12)
    data = doc.tobytes()
    doc.close()
    segments = segment_pdf_bytes(data)
    assert {s.locator_type for s in segments} == {"page"}
    assert segments[0].locator_value == "1" and segments[-1].locator_value == "2"
