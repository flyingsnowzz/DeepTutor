from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from deeptutor.services.accounts.service import AccountService
from deeptutor.services.postgres.database import create_engine
from deeptutor.services.reading.service import ReadingError, ReadingService
from deeptutor.services.storage.object_store import InMemoryObjectStore

pytestmark = pytest.mark.skipif(
    __import__("os").environ.get("DATABASE_URL") is None,
    reason="DATABASE_URL not set",
)

TEXTBOOK = (
    "# 牛顿第二定律\n"
    "物体加速度的大小跟所受合外力成正比，跟物体质量成反比，公式 F=ma。\n"
    "# 应用\n"
    "已知质量和力求加速度时，用 a=F/m。"
)


@pytest_asyncio.fixture
async def context():
    import os

    engine = create_engine(os.environ["DATABASE_URL"])
    owner = f"reading_{uuid.uuid4().hex[:10]}"
    await AccountService(engine).ensure_user(owner)
    service = ReadingService(engine, object_store=InMemoryObjectStore())
    try:
        yield owner, service
    finally:
        from sqlalchemy import text

        async with engine.begin() as db:
            for table in (
                "reading_messages",
                "reading_sessions",
                "reading_segments",
                "reading_materials",
            ):
                await db.execute(text(f"DELETE FROM {table} WHERE owner_user_id=:o"), {"o": owner})
            await db.execute(text("DELETE FROM subscriptions WHERE owner_user_id=:o"), {"o": owner})
            await db.execute(text("DELETE FROM users WHERE id=:o"), {"o": owner})
        await engine.dispose()


@pytest.mark.asyncio
async def test_register_text_material_and_cited_reply(context):
    owner, service = context
    material = await service.register_material(
        owner, kind="text", title="力学讲义", content=TEXTBOOK
    )
    assert material["segment_count"] >= 2
    assert material["locator_types"] == ["section"]

    session = await service.start_session(owner, material_id=material["material_id"])
    assert session["is_interactive"] is True

    answer = await service.reply(
        owner, session_id=session["session_id"], message="F=ma 公式是什么？合外力怎么影响加速度？"
    )
    assert answer["citations"], "answer must cite a section"
    assert answer["citations"][0]["locator_type"] == "section"
    assert "F=ma" in answer["content"] and "合外力" in answer["content"]


@pytest.mark.asyncio
async def test_summary_and_quiz_modes(context):
    owner, service = context
    material = await service.register_material(owner, kind="text", title="力学", content=TEXTBOOK)
    session = await service.start_session(owner, material_id=material["material_id"])
    summary = await service.reply(
        owner, session_id=session["session_id"], message="总结一下", mode="summary"
    )
    assert summary["mode"] == "summary" and summary["citations"]
    quiz = await service.reply(owner, session_id=session["session_id"], message="出题", mode="quiz")
    assert quiz["mode"] == "quiz" and quiz["citations"]


@pytest.mark.asyncio
async def test_owner_isolation_and_validation(context):
    import os

    owner, service = context
    other = f"reading_other_{uuid.uuid4().hex[:8]}"
    other_engine = create_engine(os.environ["DATABASE_URL"])
    await AccountService(other_engine).ensure_user(other)

    material = await service.register_material(owner, kind="text", title="力学", content=TEXTBOOK)
    with pytest.raises(ReadingError) as exc:
        await service.start_session(other, material_id=material["material_id"])
    assert exc.value.http_status == 404
    with pytest.raises(ReadingError):
        await service.register_material(owner, kind="unknown", title="x", content="y")
    with pytest.raises(ReadingError):
        await service.register_material(owner, kind="text", title="空", content="")
    await other_engine.dispose()


@pytest.mark.asyncio
async def test_pdf_material_from_object_store(context):
    import fitz

    from deeptutor.services.storage.object_store import StoredObject

    owner, service = context

    doc = fitz.open()
    for page_no in range(2):
        page = doc.new_page()
        page.insert_text((72, 72), f"Page {page_no + 1}: energy conservation law.", fontsize=11)
    pdf_bytes = doc.tobytes()
    doc.close()

    stored = await service._store.put(f"{owner}/notes.pdf", pdf_bytes, "application/pdf")

    class FakeArtifact:
        key = stored.key

    material = await service.register_material(
        owner,
        kind="pdf",
        title="notes.pdf",
        artifact_ref="art_test",
        artifact_row=FakeArtifact(),
    )
    assert "page" in material["locator_types"]
    session = await service.start_session(owner, material_id=material["material_id"])
    answer = await service.reply(
        owner, session_id=session["session_id"], message="energy conservation 在哪一页？"
    )
    assert answer["citations"][0]["locator_type"] == "page"
