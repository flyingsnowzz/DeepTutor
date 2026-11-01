from __future__ import annotations

import json
from typing import Any
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.services.postgres.database import session_factory


class OwnershipError(PermissionError):
    """Raised when an owner tries to read or mutate another owner's resource."""


class PostgresMasteryRepository:
    def __init__(self, engine: AsyncEngine):
        self._sessions = session_factory(engine)

    @staticmethod
    def new_path_id() -> str:
        return f"path_{uuid.uuid4().hex[:16]}"

    async def _path_owner(self, db, path_id: str) -> str | None:
        return (
            await db.execute(
                text("SELECT owner_user_id FROM mastery_paths WHERE path_id=:path"),
                {"path": path_id},
            )
        ).scalar_one_or_none()

    async def _require_path_owner(self, db, owner_user_id: str, path_id: str) -> None:
        existing_owner = await self._path_owner(db, path_id)
        if existing_owner is not None and existing_owner != owner_user_id:
            raise OwnershipError(f"mastery path {path_id} belongs to another user")

    async def create_path(self, owner_user_id: str, state: dict[str, Any]) -> str:
        path_id = state.get("book_id") or state.get("path_id") or self.new_path_id()
        state = {**state, "book_id": path_id, "path_id": path_id}
        async with self._sessions() as db:
            await self._require_path_owner(db, owner_user_id, path_id)
            await db.execute(
                text(
                    """INSERT INTO mastery_paths (path_id, owner_user_id, revision, state_json)
                       VALUES (:path_id,:owner,1,CAST(:state AS JSONB))
                       ON CONFLICT (path_id) DO UPDATE
                       SET revision = mastery_paths.revision + 1,
                           state_json = EXCLUDED.state_json,
                           updated_at = now()
                       WHERE mastery_paths.owner_user_id = :owner"""
                ),
                {
                    "path_id": path_id,
                    "owner": owner_user_id,
                    "state": json.dumps(state, ensure_ascii=False),
                },
            )
            await db.commit()
        return path_id

    async def load_path(self, owner_user_id: str, path_id: str) -> dict[str, Any] | None:
        async with self._sessions() as db:
            row = (
                (
                    await db.execute(
                        text(
                            "SELECT state_json FROM mastery_paths WHERE path_id=:path AND owner_user_id=:owner"
                        ),
                        {"path": path_id, "owner": owner_user_id},
                    )
                )
                .mappings()
                .first()
            )
            return dict(row["state_json"]) if row else None

    async def append_event(
        self, owner_user_id: str, path_id: str, event_type: str, payload: dict[str, Any]
    ) -> str:
        async with self._sessions() as db:
            await self._require_path_owner(db, owner_user_id, path_id)
            revision = (
                await db.execute(
                    text(
                        """SELECT COALESCE(MAX(revision),0)+1 AS revision
                           FROM mastery_events WHERE path_id=:path AND owner_user_id=:owner"""
                    ),
                    {"path": path_id, "owner": owner_user_id},
                )
            ).scalar_one()
            event_id = f"ev_{uuid.uuid4().hex}"
            await db.execute(
                text(
                    """INSERT INTO mastery_events
                       (id, owner_user_id, path_id, revision, event_type, payload_json)
                       VALUES (:id,:owner,:path,:revision,:event,CAST(:payload AS JSONB))"""
                ),
                {
                    "id": event_id,
                    "owner": owner_user_id,
                    "path": path_id,
                    "revision": revision,
                    "event": event_type,
                    "payload": json.dumps(payload, ensure_ascii=False),
                },
            )
            await db.commit()
        return event_id

    async def add_interaction(
        self,
        owner_user_id: str,
        path_id: str,
        *,
        status: str,
        question: dict[str, Any],
        user_answer: str = "",
        result: dict[str, Any] | None = None,
        session_id: str = "",
        turn_id: str = "",
        interaction_id: str | None = None,
    ) -> str:
        interaction_id = interaction_id or f"ix_{uuid.uuid4().hex}"
        async with self._sessions() as db:
            await self._require_path_owner(db, owner_user_id, path_id)
            await db.execute(
                text(
                    """INSERT INTO mastery_interactions
                       (interaction_id,owner_user_id,path_id,status,question_json,session_id,turn_id,
                        user_answer,result_json,created_at,updated_at)
                       VALUES (:id,:owner,:path,:status,CAST(:question AS JSONB),:session,:turn,
                        :answer,CAST(:result AS JSONB),now(),now())
                       ON CONFLICT (interaction_id) DO NOTHING"""
                ),
                {
                    "id": interaction_id,
                    "owner": owner_user_id,
                    "path": path_id,
                    "status": status,
                    "question": json.dumps(question, ensure_ascii=False),
                    "session": session_id,
                    "turn": turn_id,
                    "answer": user_answer,
                    "result": json.dumps(result or {}, ensure_ascii=False),
                },
            )
            await db.commit()
        return interaction_id

    async def list_events(self, owner_user_id: str, path_id: str) -> list[dict[str, Any]]:
        async with self._sessions() as db:
            rows = (
                (
                    await db.execute(
                        text(
                            """SELECT id,revision,event_type,payload_json,created_at FROM mastery_events
                           WHERE owner_user_id=:owner AND path_id=:path ORDER BY revision"""
                        ),
                        {"owner": owner_user_id, "path": path_id},
                    )
                )
                .mappings()
                .all()
            )
            return [dict(r) for r in rows]

    async def list_paths(self, owner_user_id: str, limit: int = 100) -> list[dict[str, Any]]:
        async with self._sessions() as db:
            rows = (
                (
                    await db.execute(
                        text(
                            """SELECT path_id, revision, state_json, created_at, updated_at
                           FROM mastery_paths WHERE owner_user_id=:owner
                           ORDER BY updated_at DESC LIMIT :limit"""
                        ),
                        {"owner": owner_user_id, "limit": limit},
                    )
                )
                .mappings()
                .all()
            )
            return [
                {"path_id": r["path_id"], "revision": r["revision"], "state": dict(r["state_json"])}
                for r in rows
            ]
