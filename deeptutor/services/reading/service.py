"""Postgres-backed immersive reading sessions.

Distinct from one-shot jobs: a reading session is an interactive, stateful
conversation over one registered material, and every assistant reply carries
page/section/timestamp citations. Materials come from inline text, uploaded
artifacts (object storage) or transcripts.
"""

from __future__ import annotations

import hashlib
from typing import Any
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.services.postgres.database import session_factory
from deeptutor.services.storage.object_store import ObjectStore

from .answerer import DeterministicReadingAnswerer, ReadingAnswerer
from .segments import ReadingSegment, segment_pdf_bytes, segment_text, segment_transcript

MAX_HISTORY_MESSAGES = 20
PDF_KINDS = {"pdf", "slides"}
TRANSCRIPT_KINDS = {"transcript"}


class ReadingError(Exception):
    def __init__(self, code: str, message: str, *, http_status: int = 400):
        super().__init__(message)
        self.code = code
        self.http_status = http_status


class ReadingService:
    def __init__(
        self,
        engine: AsyncEngine,
        *,
        object_store: ObjectStore | None = None,
        answerer: ReadingAnswerer | None = None,
    ):
        self._sessions = session_factory(engine)
        self._store = object_store
        self._answerer = answerer or DeterministicReadingAnswerer()

    @staticmethod
    def _new_id(prefix: str) -> str:
        return f"{prefix}_{uuid.uuid4().hex[:20]}"

    # ------------------------------------------------------------- ingestion
    async def register_material(
        self,
        owner_user_id: str,
        *,
        kind: str,
        title: str,
        content: str | None = None,
        artifact_ref: str | None = None,
        artifact_row: Any = None,
        source_uri: str = "",
    ) -> dict[str, Any]:
        kind = kind.lower().strip()
        if kind not in {"pdf", "text", "transcript", "slides", "url"}:
            raise ReadingError("INVALID_ARGUMENT", f"unsupported material kind: {kind}")

        segments: list[ReadingSegment]
        raw_bytes: bytes | None = None
        source_hash = ""

        if artifact_row is not None:
            object_key = getattr(artifact_row, "key", None)
            if self._store is None or not object_key:
                raise ReadingError("ARTIFACT_UNAVAILABLE", "artifact storage is not configured")
            raw_bytes = await self._store.get(object_key)
            source_hash = hashlib.sha256(raw_bytes).hexdigest()

        if kind in PDF_KINDS:
            if raw_bytes is None:
                raise ReadingError(
                    "INVALID_ARGUMENT", f"{kind} material requires an uploaded artifact"
                )
            try:
                segments = segment_pdf_bytes(raw_bytes)
            except Exception as exc:  # noqa: BLE001
                raise ReadingError("MATERIAL_PARSE_FAILED", f"无法解析材料：{exc}") from exc
        elif kind in TRANSCRIPT_KINDS:
            text_content = content or (raw_bytes.decode("utf-8", "ignore") if raw_bytes else "")
            segments = segment_transcript(text_content)
        else:
            text_content = content or (raw_bytes.decode("utf-8", "ignore") if raw_bytes else "")
            segments = segment_text(title, text_content)
            source_hash = source_hash or hashlib.sha256(text_content.encode()).hexdigest()

        if not segments:
            raise ReadingError("EMPTY_MATERIAL", "材料中没有可引用的文本内容")

        material_id = self._new_id("mat")
        async with self._sessions() as db:
            await db.execute(
                text(
                    """INSERT INTO reading_materials
                       (id, owner_user_id, kind, title, source_artifact_ref, source_uri,
                        source_hash, status, meta_json, segment_count, created_at, updated_at)
                       VALUES (:id,:owner,:kind,:title,:art,:uri,:hash,'ready',
                                CAST('{}' AS JSONB),:count,now(),now())"""
                ),
                {
                    "id": material_id,
                    "owner": owner_user_id,
                    "kind": kind,
                    "title": title or "未命名材料",
                    "art": artifact_ref,
                    "uri": source_uri[:2000],
                    "hash": source_hash,
                    "count": len(segments),
                },
            )
            for seg in segments:
                await db.execute(
                    text(
                        """INSERT INTO reading_segments
                           (id, owner_user_id, material_id, ordinal, locator_type,
                            locator_value, locator_label, content)
                           VALUES (:id,:owner,:material,:ordinal,:ltype,:lvalue,:llabel,:content)"""
                    ),
                    {
                        "id": f"{material_id}_s{seg.ordinal:05d}",
                        "owner": owner_user_id,
                        "material": material_id,
                        "ordinal": seg.ordinal,
                        "ltype": seg.locator_type,
                        "lvalue": seg.locator_value,
                        "llabel": seg.locator_label,
                        "content": seg.content,
                    },
                )
            await db.commit()
        return {
            "material_id": material_id,
            "kind": kind,
            "title": title or "未命名材料",
            "segment_count": len(segments),
            "locator_types": sorted({s.locator_type for s in segments}),
        }

    # --------------------------------------------------------------- sessions
    async def start_session(
        self, owner_user_id: str, *, material_id: str, title: str = "", mode: str = "study"
    ) -> dict[str, Any]:
        async with self._sessions() as db:
            material = (
                (
                    await db.execute(
                        text(
                            """SELECT title, kind, segment_count FROM reading_materials
                           WHERE id=:id AND owner_user_id=:owner"""
                        ),
                        {"id": material_id, "owner": owner_user_id},
                    )
                )
                .mappings()
                .first()
            )
            if not material:
                raise ReadingError("NOT_FOUND", "材料不存在或不属于当前账户", http_status=404)
            session_id = self._new_id("rsess")
            await db.execute(
                text(
                    """INSERT INTO reading_sessions (id, owner_user_id, material_id, title, mode,
                                                     created_at, updated_at)
                       VALUES (:id,:owner,:material,:title,:mode,now(),now())"""
                ),
                {
                    "id": session_id,
                    "owner": owner_user_id,
                    "material": material_id,
                    "title": title or material["title"],
                    "mode": mode,
                },
            )
            await db.commit()
        return {
            "session_id": session_id,
            "material_id": material_id,
            "title": title or material["title"],
            "kind": material["kind"],
            "mode": mode,
            "segment_count": material["segment_count"],
            "is_interactive": True,
            "note": "精读为实时会话，不是一次性作业；逐段总结/提问/复习题均带页码、章节或时间戳引用。",
        }

    async def reply(
        self,
        owner_user_id: str,
        *,
        session_id: str,
        message: str,
        mode: str | None = None,
    ) -> dict[str, Any]:
        message = (message or "").strip()
        if not message:
            raise ReadingError("INVALID_ARGUMENT", "message 不能为空")
        if len(message) > 8000:
            raise ReadingError("INVALID_ARGUMENT", "message 超过 8000 字符")

        async with self._sessions() as db:
            session = (
                (
                    await db.execute(
                        text(
                            """SELECT s.id, s.material_id, s.title, s.mode
                           FROM reading_sessions s
                           WHERE s.id=:id AND s.owner_user_id=:owner"""
                        ),
                        {"id": session_id, "owner": owner_user_id},
                    )
                )
                .mappings()
                .first()
            )
            if not session:
                raise ReadingError("NOT_FOUND", "精读会话不存在或不属于当前账户", http_status=404)

            segments = [
                dict(r)
                for r in (
                    await db.execute(
                        text(
                            """SELECT ordinal, locator_type, locator_value, locator_label, content
                               FROM reading_segments
                               WHERE material_id=:m AND owner_user_id=:owner
                               ORDER BY ordinal"""
                        ),
                        {"m": session["material_id"], "owner": owner_user_id},
                    )
                )
                .mappings()
                .all()
            ]
            history = [
                dict(r)
                for r in (
                    await db.execute(
                        text(
                            """SELECT role, kind, content FROM reading_messages
                               WHERE session_id=:s AND owner_user_id=:owner
                               ORDER BY created_at DESC LIMIT :limit"""
                        ),
                        {"s": session_id, "owner": owner_user_id, "limit": MAX_HISTORY_MESSAGES},
                    )
                )
                .mappings()
                .all()
            ][::-1]

            reply_mode = mode or self._infer_mode(message) or session["mode"]
            answer = await self._answerer.answer(
                question=message,
                mode=reply_mode,
                material_title=session["title"],
                segments=segments,
                history=history,
            )

            user_id = f"{session_id}_m_{uuid.uuid4().hex[:12]}"
            assistant_id = f"{session_id}_m_{uuid.uuid4().hex[:12]}"
            import json

            await db.execute(
                text(
                    """INSERT INTO reading_messages
                       (id, owner_user_id, session_id, role, kind, content, citations_json, created_at)
                       VALUES (:id,:owner,:s,'user','question',:content,CAST('[]' AS JSONB),now())"""
                ),
                {"id": user_id, "owner": owner_user_id, "s": session_id, "content": message},
            )
            await db.execute(
                text(
                    """INSERT INTO reading_messages
                       (id, owner_user_id, session_id, role, kind, content, citations_json, created_at)
                       VALUES (:id,:owner,:s,'assistant',:kind,:content,CAST(:citations AS JSONB),now())"""
                ),
                {
                    "id": assistant_id,
                    "owner": owner_user_id,
                    "s": session_id,
                    "kind": reply_mode,
                    "content": answer.content,
                    "citations": json.dumps(answer.to_dict()["citations"], ensure_ascii=False),
                },
            )
            await db.execute(
                text("UPDATE reading_sessions SET updated_at=now() WHERE id=:id"),
                {"id": session_id},
            )
            await db.commit()

        return {
            "session_id": session_id,
            "mode": reply_mode,
            **answer.to_dict(),
        }

    @staticmethod
    def _infer_mode(message: str) -> str | None:
        if any(k in message for k in ("总结", "摘要", "概括", "summar")):
            return "summary"
        if any(k in message for k in ("题", "测验", "quiz", "考一考")):
            return "quiz"
        return None

    async def list_sessions(self, owner_user_id: str, limit: int = 50) -> list[dict]:
        async with self._sessions() as db:
            rows = (
                (
                    await db.execute(
                        text(
                            """SELECT id, material_id, title, mode, created_at, updated_at
                           FROM reading_sessions WHERE owner_user_id=:owner
                           ORDER BY updated_at DESC LIMIT :limit"""
                        ),
                        {"owner": owner_user_id, "limit": limit},
                    )
                )
                .mappings()
                .all()
            )
            return [dict(r) for r in rows]
