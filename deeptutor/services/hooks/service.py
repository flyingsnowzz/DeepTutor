from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from typing import Any
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.services.postgres.database import session_factory

#: Events that create a follow-up review task.
REVIEW_TRIGGER_EVENTS = {"job_completed", "lesson_completed", "material_finished"}
REVIEW_TASK_KIND_BY_EVENT = {
    "job_completed": "quiz",
    "lesson_completed": "quiz",
    "material_finished": "summary",
}


class HookError(Exception):
    def __init__(self, code: str, message: str, *, http_status: int = 400):
        super().__init__(message)
        self.code = code
        self.http_status = http_status


class HookService:
    """Ingest host callbacks (e.g. WorkBuddy) exactly once.

    Idempotency: the host supplies an idempotency_key (``<channel>:<event>:<ref>``
    recommended). Duplicate deliveries return the stored record without
    re-running fan-out, so review tasks are never duplicated.
    """

    def __init__(self, engine: AsyncEngine, *, review_tasks: "ReviewTaskService | None" = None):
        self._sessions = session_factory(engine)
        self._review_tasks = review_tasks or ReviewTaskService(engine)

    @staticmethod
    def _id() -> str:
        return f"hook_{uuid.uuid4().hex[:20]}"

    async def deliver(
        self,
        owner_user_id: str,
        *,
        event_type: str,
        idempotency_key: str,
        channel: str = "unknown",
        source_ref: str = "",
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not idempotency_key or len(idempotency_key) > 160:
            raise HookError("INVALID_ARGUMENT", "idempotency_key 必填（≤160 字符）")
        if not event_type:
            raise HookError("INVALID_ARGUMENT", "event_type 必填")

        async with self._sessions() as db:
            existing = (
                (
                    await db.execute(
                        text("SELECT id, status FROM hook_deliveries WHERE idempotency_key=:key"),
                        {"key": idempotency_key},
                    )
                )
                .mappings()
                .first()
            )
            if existing:
                return {
                    "delivery_id": existing["id"],
                    "replayed": True,
                    "status": existing["status"],
                    "review_tasks": await self._review_tasks.list_for_source(
                        owner_user_id, "hook", existing["id"]
                    ),
                }

            delivery_id = self._id()
            await db.execute(
                text(
                    """INSERT INTO hook_deliveries
                       (id, owner_user_id, channel, event_type, source_ref, idempotency_key,
                        payload_json, status, attempts, next_retry_at, created_at, updated_at)
                       VALUES (:id,:owner,:channel,:event,:ref,:key,CAST(:payload AS JSONB),
                                'received',0,NULL,now(),now())"""
                ),
                {
                    "id": delivery_id,
                    "owner": owner_user_id,
                    "channel": channel[:48],
                    "event": event_type[:64],
                    "ref": source_ref[:128],
                    "key": idempotency_key,
                    "payload": json.dumps(payload or {}, ensure_ascii=False),
                },
            )
            try:
                review_tasks = []
                if event_type in REVIEW_TRIGGER_EVENTS:
                    kind = REVIEW_TASK_KIND_BY_EVENT[event_type]
                    task = await self._review_tasks.create(
                        owner_user_id,
                        kind=kind,
                        source_type="hook",
                        source_ref=delivery_id,
                        payload={
                            "origin_event": event_type,
                            "origin_ref": source_ref,
                            "channel": channel,
                            **(payload or {}),
                        },
                        db=db,
                    )
                    if task is not None:
                        review_tasks.append(task)
                await db.execute(
                    text(
                        "UPDATE hook_deliveries SET status='processed', updated_at=now() WHERE id=:id"
                    ),
                    {"id": delivery_id},
                )
                await db.commit()
            except Exception as exc:  # noqa: BLE001
                await db.rollback()
                await self._mark_failure(delivery_id, str(exc))
                raise HookError("HOOK_PROCESSING_FAILED", str(exc), http_status=500) from exc

        return {
            "delivery_id": delivery_id,
            "replayed": False,
            "status": "processed",
            "review_tasks": review_tasks,
        }

    async def _mark_failure(self, delivery_id: str, error: str) -> None:
        async with self._sessions() as db:
            await db.execute(
                text(
                    """UPDATE hook_deliveries
                       SET status='failed', attempts=attempts+1, last_error=:err,
                           next_retry_at=now() + interval '1 minute', updated_at=now()
                       WHERE id=:id"""
                ),
                {"id": delivery_id, "err": error[:2000]},
            )
            await db.commit()

    async def list_deliveries(self, owner_user_id: str, limit: int = 50) -> list[dict]:
        async with self._sessions() as db:
            rows = (
                (
                    await db.execute(
                        text(
                            """SELECT id, channel, event_type, source_ref, status, attempts, created_at
                           FROM hook_deliveries WHERE owner_user_id=:owner
                           ORDER BY created_at DESC LIMIT :limit"""
                        ),
                        {"owner": owner_user_id, "limit": limit},
                    )
                )
                .mappings()
                .all()
            )
            return [dict(r) for r in rows]


class ReviewTaskService:
    """Follow-up review tasks created after jobs/materials/hooks."""

    def __init__(self, engine: AsyncEngine):
        self._sessions = session_factory(engine)

    @staticmethod
    def _id() -> str:
        return f"rt_{uuid.uuid4().hex[:20]}"

    async def create(
        self,
        owner_user_id: str,
        *,
        kind: str,
        source_type: str,
        source_ref: str,
        payload: dict[str, Any] | None = None,
        due_in_seconds: int = 0,
        db=None,
    ) -> dict[str, Any] | None:
        own_session = db is None
        if own_session:
            db = self._sessions()
            await db.__aenter__()
        try:
            existing = (
                await db.execute(
                    text(
                        """SELECT id FROM review_tasks
                           WHERE owner_user_id=:owner AND source_type=:st
                             AND source_ref=:ref AND kind=:kind"""
                    ),
                    {"owner": owner_user_id, "st": source_type, "ref": source_ref, "kind": kind},
                )
            ).scalar_one_or_none()
            if existing:
                return None
            task_id = self._id()
            due = datetime.now(timezone.utc) + timedelta(seconds=due_in_seconds)
            await db.execute(
                text(
                    """INSERT INTO review_tasks
                       (id, owner_user_id, kind, source_type, source_ref, status, payload_json,
                        due_at, created_at, updated_at)
                       VALUES (:id,:owner,:kind,:st,:ref,'pending',CAST(:payload AS JSONB),:due,now(),now())"""
                ),
                {
                    "id": task_id,
                    "owner": owner_user_id,
                    "kind": kind,
                    "st": source_type,
                    "ref": source_ref,
                    "payload": json.dumps(payload or {}, ensure_ascii=False),
                    "due": due,
                },
            )
            if own_session:
                await db.commit()
            return {
                "review_task_id": task_id,
                "kind": kind,
                "status": "pending",
                "due_at": due.isoformat(),
            }
        finally:
            if own_session:
                await db.__aexit__(None, None, None)

    async def list_due(self, owner_user_id: str, limit: int = 50) -> list[dict]:
        async with self._sessions() as db:
            rows = (
                (
                    await db.execute(
                        text(
                            """SELECT id, kind, source_type, source_ref, payload_json, due_at, created_at
                           FROM review_tasks
                           WHERE owner_user_id=:owner AND status='pending' AND due_at <= now()
                           ORDER BY due_at LIMIT :limit"""
                        ),
                        {"owner": owner_user_id, "limit": limit},
                    )
                )
                .mappings()
                .all()
            )
            return [dict(r) for r in rows]

    async def list_for_source(
        self, owner_user_id: str, source_type: str, source_ref: str
    ) -> list[dict]:
        async with self._sessions() as db:
            rows = (
                (
                    await db.execute(
                        text(
                            """SELECT id, kind, status, due_at FROM review_tasks
                           WHERE owner_user_id=:owner AND source_type=:st AND source_ref=:ref"""
                        ),
                        {"owner": owner_user_id, "st": source_type, "ref": source_ref},
                    )
                )
                .mappings()
                .all()
            )
            return [
                {
                    "review_task_id": r["id"],
                    "kind": r["kind"],
                    "status": r["status"],
                    "due_at": r["due_at"].isoformat() if r["due_at"] else None,
                }
                for r in rows
            ]

    async def complete(
        self, owner_user_id: str, review_task_id: str, *, result: dict | None = None
    ) -> dict | None:
        async with self._sessions() as db:
            outcome = await db.execute(
                text(
                    """UPDATE review_tasks SET status='completed', result_json=CAST(:result AS JSONB),
                          completed_at=now(), updated_at=now()
                       WHERE id=:id AND owner_user_id=:owner AND status='pending'
                       RETURNING id"""
                ),
                {
                    "id": review_task_id,
                    "owner": owner_user_id,
                    "result": json.dumps(result or {}, ensure_ascii=False),
                },
            )
            await db.commit()
            row = outcome.first()
        return {"review_task_id": review_task_id, "status": "completed"} if row else None
