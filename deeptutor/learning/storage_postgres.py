from __future__ import annotations

import json
from typing import Any
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.services.postgres.database import session_factory


class OwnershipError(PermissionError):
    """Raised when an owner tries to read or mutate another owner's resource."""


class RevisionConflictError(RuntimeError):
    """Raised when a Mastery aggregate has changed since it was loaded."""


class PathLeaseConflictError(RuntimeError):
    """Raised when a path is already held by another turn."""


class PostgresMasteryRepository:
    def __init__(self, engine: AsyncEngine):
        self._sessions = session_factory(engine)

    @staticmethod
    def new_path_id() -> str:
        return f"path_{uuid.uuid4().hex[:16]}"

    async def _path_owner(self, db, owner_user_id: str, path_id: str) -> str | None:
        return (
            await db.execute(
                text("""SELECT owner_user_id FROM mastery_paths
                        WHERE path_id=:path AND owner_user_id=:owner"""),
                {"path": path_id, "owner": owner_user_id},
            )
        ).scalar_one_or_none()

    async def _require_path_owner(self, db, owner_user_id: str, path_id: str) -> None:
        if await self._path_owner(db, owner_user_id, path_id) is None:
            raise OwnershipError(f"mastery path {path_id} is not owned by this user")

    async def create_path(self, owner_user_id: str, state: dict[str, Any]) -> str:
        path_id = state.get("book_id") or state.get("path_id") or self.new_path_id()
        state = {**state, "book_id": path_id, "path_id": path_id}
        async with self._sessions() as db:
            created = (await db.execute(
                text(
                    """INSERT INTO mastery_paths (path_id, owner_user_id, revision, state_json)
                       VALUES (:path_id,:owner,1,CAST(:state AS JSONB))
                       ON CONFLICT (path_id) DO UPDATE
                       SET revision = mastery_paths.revision + 1,
                           state_json = EXCLUDED.state_json,
                           updated_at = now()
                       WHERE mastery_paths.owner_user_id = :owner
                       RETURNING path_id"""
                ),
                {
                    "path_id": path_id,
                    "owner": owner_user_id,
                    "state": json.dumps(state, ensure_ascii=False),
                },
            )).scalar_one_or_none()
            if created is None:
                raise OwnershipError(f"mastery path {path_id} is not owned by this user")
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

    async def save_path_if_revision(
        self,
        owner_user_id: str,
        path_id: str,
        state: dict[str, Any],
        *,
        expected_revision: int,
        events: list[tuple[str, dict[str, Any], str, str]] | None = None,
    ) -> int:
        """Atomically replace one aggregate only if its revision is current.

        A missing path and a stale revision are deliberately distinct from an
        ownership violation. Callers must never retry by overwriting blindly.
        """
        if expected_revision < 1:
            raise ValueError("expected_revision must be positive")
        payload = json.dumps(state, ensure_ascii=False, allow_nan=False)
        async with self._sessions() as db:
            row = (
                await db.execute(
                    text(
                        """UPDATE mastery_paths
                           SET state_json=CAST(:state AS JSONB), revision=revision+1,
                               updated_at=now()
                           WHERE path_id=:path AND owner_user_id=:owner
                             AND revision=:expected
                           RETURNING revision"""
                    ),
                    {
                        "path": path_id,
                        "owner": owner_user_id,
                        "expected": expected_revision,
                        "state": payload,
                    },
                )
            ).scalar_one_or_none()
            if row is None:
                await self._require_path_owner(db, owner_user_id, path_id)
                raise RevisionConflictError(
                    f"mastery path {path_id} revision is no longer {expected_revision}"
                )
            for event_type, event_payload, session_id, turn_id in events or ():
                if not str(event_type).strip():
                    raise ValueError("event_type must not be empty")
                await db.execute(
                    text(
                        """INSERT INTO mastery_events
                           (id,owner_user_id,path_id,revision,event_type,payload_json,session_id,turn_id)
                           VALUES (:id,:owner,:path,:revision,:event,CAST(:payload AS JSONB),:session,:turn)"""
                    ),
                    {
                        "id": f"ev_{uuid.uuid4().hex}",
                        "owner": owner_user_id,
                        "path": path_id,
                        "revision": int(row),
                        "event": event_type,
                        "payload": json.dumps(event_payload, ensure_ascii=False, allow_nan=False),
                        "session": session_id,
                        "turn": turn_id,
                    },
                )
            await db.commit()
            return int(row)

    async def bind_session(
        self, owner_user_id: str, path_id: str, session_id: str
    ) -> None:
        """Associate one owner-scoped session with one Mastery path."""
        async with self._sessions() as db:
            await self._require_path_owner(db, owner_user_id, path_id)
            path = await self._path_owner(db, owner_user_id, path_id)
            if path is None:
                raise KeyError(path_id)
            session_owner = (
                await db.execute(
                    text("""SELECT owner_user_id FROM sessions
                            WHERE id=:session AND owner_user_id=:owner"""),
                    {"session": session_id, "owner": owner_user_id},
                )
            ).scalar_one_or_none()
            if session_owner is None:
                raise OwnershipError(f"session {session_id} is not available to this user")
            if session_owner != owner_user_id:
                raise OwnershipError(f"session {session_id} belongs to another user")
            await db.execute(
                text(
                    """INSERT INTO mastery_path_sessions
                       (owner_user_id,path_id,session_id)
                       VALUES (:owner,:path,:session)
                       ON CONFLICT (owner_user_id,path_id,session_id)
                       DO UPDATE SET last_seen_at=now()"""
                ),
                {"owner": owner_user_id, "path": path_id, "session": session_id},
            )
            await db.commit()

    async def list_session_ids(self, owner_user_id: str, path_id: str) -> list[str]:
        async with self._sessions() as db:
            rows = (
                await db.execute(
                    text(
                        """SELECT session_id FROM mastery_path_sessions
                           WHERE owner_user_id=:owner AND path_id=:path
                           ORDER BY last_seen_at DESC, session_id"""
                    ),
                    {"owner": owner_user_id, "path": path_id},
                )
            ).scalars().all()
            return list(rows)

    async def acquire_path_lease(
        self, owner_user_id: str, path_id: str, session_id: str, turn_id: str
    ) -> None:
        """Acquire a path lease without replacing another turn's lease."""
        async with self._sessions() as db:
            await self._require_path_owner(db, owner_user_id, path_id)
            if await self._path_owner(db, owner_user_id, path_id) is None:
                raise KeyError(path_id)
            acquired = (
                await db.execute(
                    text(
                        """INSERT INTO mastery_path_leases
                           (owner_user_id,path_id,session_id,turn_id)
                           VALUES (:owner,:path,:session,:turn)
                           ON CONFLICT (path_id) DO NOTHING
                           RETURNING path_id"""
                    ),
                    {
                        "owner": owner_user_id,
                        "path": path_id,
                        "session": session_id,
                        "turn": turn_id,
                    },
                )
            ).scalar_one_or_none()
            if acquired is None:
                raise PathLeaseConflictError(f"mastery path {path_id} is already leased")
            await db.commit()

    async def release_path_lease(
        self, owner_user_id: str, path_id: str, turn_id: str
    ) -> bool:
        """Release only the lease owned by the given turn."""
        async with self._sessions() as db:
            released = (
                await db.execute(
                    text(
                        """DELETE FROM mastery_path_leases
                           WHERE owner_user_id=:owner AND path_id=:path AND turn_id=:turn
                           RETURNING path_id"""
                    ),
                    {"owner": owner_user_id, "path": path_id, "turn": turn_id},
                )
            ).scalar_one_or_none()
            await db.commit()
            return released is not None

    async def get_path_lease(
        self, owner_user_id: str, path_id: str
    ) -> dict[str, Any] | None:
        async with self._sessions() as db:
            row = (
                await db.execute(
                    text("""SELECT path_id,session_id,turn_id,acquired_at
                            FROM mastery_path_leases
                            WHERE owner_user_id=:owner AND path_id=:path"""),
                    {"owner": owner_user_id, "path": path_id},
                )
            ).mappings().first()
        return {
            **dict(row), "acquired_at": row["acquired_at"].timestamp()
        } if row is not None else None

    async def release_leases_for_turn(
        self, owner_user_id: str, turn_id: str
    ) -> str:
        async with self._sessions() as db:
            path_id = (
                await db.execute(
                    text("""DELETE FROM mastery_path_leases
                            WHERE owner_user_id=:owner AND turn_id=:turn
                            RETURNING path_id"""),
                    {"owner": owner_user_id, "turn": turn_id},
                )
            ).scalar_one_or_none()
            await db.commit()
            return str(path_id or "")

    async def get_interaction(
        self, owner_user_id: str, path_id: str, interaction_id: str
    ) -> dict[str, Any] | None:
        async with self._sessions() as db:
            row = (
                await db.execute(
                    text("""SELECT interaction_id,path_id,status,question_json,
                                   session_id,turn_id,user_answer,result_json,
                                   created_at,updated_at FROM mastery_interactions
                            WHERE owner_user_id=:owner AND path_id=:path
                              AND interaction_id=:interaction"""),
                    {
                        "owner": owner_user_id, "path": path_id,
                        "interaction": interaction_id,
                    },
                )
            ).mappings().first()
        return self._interaction_payload(row) if row else None

    async def get_active_interaction(
        self, owner_user_id: str, path_id: str
    ) -> dict[str, Any] | None:
        async with self._sessions() as db:
            row = (
                await db.execute(
                    text("""SELECT interaction_id,path_id,status,question_json,
                                   session_id,turn_id,user_answer,result_json,
                                   created_at,updated_at FROM mastery_interactions
                            WHERE owner_user_id=:owner AND path_id=:path
                              AND status IN ('registered','awaiting_input','answered')
                            ORDER BY created_at DESC,interaction_id DESC LIMIT 1"""),
                    {"owner": owner_user_id, "path": path_id},
                )
            ).mappings().first()
        return self._interaction_payload(row) if row else None

    async def list_interactions(
        self, owner_user_id: str, path_id: str, *, limit: int = 200
    ) -> list[dict[str, Any]]:
        async with self._sessions() as db:
            rows = (
                await db.execute(
                    text("""SELECT interaction_id,path_id,status,question_json,
                                   session_id,turn_id,user_answer,result_json,
                                   created_at,updated_at FROM mastery_interactions
                            WHERE owner_user_id=:owner AND path_id=:path
                            ORDER BY created_at DESC,interaction_id DESC LIMIT :limit"""),
                    {
                        "owner": owner_user_id, "path": path_id,
                        "limit": max(1, int(limit)),
                    },
                )
            ).mappings().all()
        return [self._interaction_payload(row) for row in rows]

    @staticmethod
    def _interaction_payload(row) -> dict[str, Any]:
        question = row["question_json"] or {}
        grouped = question.get("question_type") == "group"
        answer = row["user_answer"] or ""
        try:
            answers = json.loads(answer) if grouped else {}
        except (TypeError, ValueError):
            answers = {}
        return {
            "interaction_id": row["interaction_id"], "path_id": row["path_id"],
            "status": row["status"], "question": question,
            "session_id": row["session_id"] or "", "turn_id": row["turn_id"] or "",
            "user_answer": "" if grouped else answer, "answers": answers,
            "result": row["result_json"] or {},
            "created_at": row["created_at"].timestamp(),
            "updated_at": row["updated_at"].timestamp(),
        }

    async def put_topic(
        self,
        owner_user_id: str,
        path_id: str,
        *,
        goal: str,
        description: str = "",
        emoji: str = "🧭",
        map_seed: int = 0,
        status: str = "active",
        sources: list[dict[str, Any]] | None = None,
    ) -> None:
        """Replace topic presentation and ordered source references atomically."""
        sources = sources or []
        async with self._sessions() as db:
            await self._require_path_owner(db, owner_user_id, path_id)
            if await self._path_owner(db, owner_user_id, path_id) is None:
                raise KeyError(path_id)
            await db.execute(
                text(
                    """INSERT INTO mastery_topic_meta
                       (path_id,owner_user_id,goal,description,emoji,map_seed,status)
                       VALUES (:path,:owner,:goal,:description,:emoji,:seed,:status)
                       ON CONFLICT (path_id) DO UPDATE SET
                         goal=EXCLUDED.goal, description=EXCLUDED.description,
                         emoji=EXCLUDED.emoji, map_seed=EXCLUDED.map_seed,
                         status=EXCLUDED.status, updated_at=now()
                       WHERE mastery_topic_meta.owner_user_id=:owner"""
                ),
                {
                    "path": path_id, "owner": owner_user_id, "goal": goal,
                    "description": description, "emoji": emoji, "seed": map_seed,
                    "status": status,
                },
            )
            await db.execute(
                text(
                    """DELETE FROM mastery_topic_sources
                       WHERE owner_user_id=:owner AND path_id=:path"""
                ),
                {"owner": owner_user_id, "path": path_id},
            )
            for position, source in enumerate(sources):
                await db.execute(
                    text(
                        """INSERT INTO mastery_topic_sources
                           (source_id,path_id,owner_user_id,kind,external_id,label,excerpt,
                            position,available,metadata_json)
                           VALUES (:id,:path,:owner,:kind,:external,:label,:excerpt,
                            :position,:available,CAST(:metadata AS JSONB))"""
                    ),
                    {
                        "id": str(source.get("source_id") or f"src_{uuid.uuid4().hex}"),
                        "path": path_id, "owner": owner_user_id,
                        "kind": str(source.get("kind") or ""),
                        "external": str(source.get("external_id") or ""),
                        "label": str(source.get("label") or ""),
                        "excerpt": str(source.get("excerpt") or ""),
                        "position": position,
                        "available": bool(source.get("available", True)),
                        "metadata": json.dumps(source.get("metadata") or {}, ensure_ascii=False),
                    },
                )
            await db.commit()

    async def get_topic(self, owner_user_id: str, path_id: str) -> dict[str, Any] | None:
        """Return a topic and its sources only to the owning user."""
        async with self._sessions() as db:
            meta = (
                await db.execute(
                    text(
                        """SELECT goal,description,emoji,map_seed,status,created_at,updated_at
                           FROM mastery_topic_meta
                           WHERE owner_user_id=:owner AND path_id=:path"""
                    ),
                    {"owner": owner_user_id, "path": path_id},
                )
            ).mappings().first()
            if meta is None:
                return None
            rows = (
                await db.execute(
                    text(
                        """SELECT source_id,kind,external_id,label,excerpt,position,
                                  available,metadata_json,created_at
                           FROM mastery_topic_sources
                           WHERE owner_user_id=:owner AND path_id=:path
                           ORDER BY position,source_id"""
                    ),
                    {"owner": owner_user_id, "path": path_id},
                )
            ).mappings().all()
            return {"path_id": path_id, **dict(meta), "sources": [dict(row) for row in rows]}

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
                            """SELECT id,revision,event_type,payload_json,session_id,turn_id,created_at FROM mastery_events
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

    async def delete_path(self, owner_user_id: str, path_id: str) -> bool:
        """Delete an owned path and its dependent rows in one transaction."""
        async with self._sessions() as db:
            deleted = (
                await db.execute(
                    text(
                        """DELETE FROM mastery_paths
                           WHERE path_id=:path AND owner_user_id=:owner
                           RETURNING path_id"""
                    ),
                    {"path": path_id, "owner": owner_user_id},
                )
            ).scalar_one_or_none()
            await db.commit()
            return deleted is not None

    # ----------------------------------------------------------------- T3 reads
    async def get_map(self, owner_user_id: str, path_id: str) -> dict[str, Any] | None:
        """Map view: aggregate state plus interaction/evidence counts."""
        async with self._sessions() as db:
            row = (
                (
                    await db.execute(
                        text(
                            """SELECT p.revision, p.state_json,
                                  (SELECT count(*) FROM mastery_interactions i
                                     WHERE i.owner_user_id=p.owner_user_id AND i.path_id=p.path_id) AS interactions,
                                  (SELECT count(*) FROM mastery_interactions i
                                     WHERE i.owner_user_id=p.owner_user_id AND i.path_id=p.path_id
                                       AND i.status='correct') AS correct,
                                  (SELECT count(*) FROM mastery_events e
                                     WHERE e.owner_user_id=p.owner_user_id AND e.path_id=p.path_id) AS events
                           FROM mastery_paths p
                           WHERE p.path_id=:path AND p.owner_user_id=:owner"""
                        ),
                        {"path": path_id, "owner": owner_user_id},
                    )
                )
                .mappings()
                .first()
            )
            if not row:
                return None
            state = dict(row["state_json"])
            return {
                "path_id": path_id,
                "revision": row["revision"],
                "state": state,
                "objective": self._objective_from_state(state),
                "stats": {
                    "interactions": row["interactions"],
                    "correct": row["correct"],
                    "events": row["events"],
                },
            }

    async def get_objective(self, owner_user_id: str, path_id: str) -> dict[str, Any] | None:
        state = await self.load_path(owner_user_id, path_id)
        if state is None:
            return None
        return {"path_id": path_id, **self._objective_from_state(state)}

    @staticmethod
    def _objective_from_state(state: dict[str, Any]) -> dict[str, Any]:
        return {
            "goal": state.get("goal") or state.get("objective") or state.get("topic") or "",
            "description": state.get("description", ""),
            "emoji": state.get("emoji", ""),
            "status": state.get("status", ""),
        }
