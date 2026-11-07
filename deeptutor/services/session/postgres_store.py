from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.services.postgres.database import session_factory
from deeptutor.services.session.protocol import ActiveTurnConflict
from deeptutor.services.session.ask_user_trace import select_ask_user_events
from deeptutor.services.session.provider_response_state import redact_private_message_metadata
from deeptutor.services.session.search import bounded_search_excerpt, normalize_search_query

_ACTIVE = frozenset({"queued", "running", "waiting_input"})
_TERMINAL = frozenset({"completed", "failed", "cancelled"})
_STATUSES = _ACTIVE | _TERMINAL


def _epoch(value):
    return value.timestamp() if isinstance(value, datetime) else value


class PostgresSessionStore:
    def __init__(self, engine: AsyncEngine):
        from deeptutor.learning.assessment_postgres import PostgresAssessmentRepository
        from deeptutor.services.session.postgres_notebook import PostgresNotebookRepository
        from deeptutor.services.session.postgres_notebook_practice import PostgresNotebookPractice
        from deeptutor.services.session.postgres_reading_quiz import PostgresReadingQuizRepository

        self._sessions = session_factory(engine)
        self.assessments = PostgresAssessmentRepository(engine)
        self.notebook = PostgresNotebookRepository(engine)
        self.notebook_practice = PostgresNotebookPractice(engine)
        self.reading_quiz = PostgresReadingQuizRepository(engine)

    @staticmethod
    def new_session_id() -> str:
        return f"unified_{uuid.uuid4().hex[:24]}"

    async def migrate_workspace_preferences(self, owner_user_id: str) -> int:
        """Upgrade legacy workspace markers within one user's sessions."""
        from deeptutor.services.session.workspace_preferences import upgrade_workspace_preferences

        changed = 0
        async with self._sessions() as db:
            rows = (
                await db.execute(
                    text("""SELECT id,preferences_json,deleted_at FROM sessions
                            WHERE owner_user_id=:owner FOR UPDATE"""),
                    {"owner": owner_user_id},
                )
            ).mappings().all()
            for row in rows:
                current = row["preferences_json"]
                if not isinstance(current, dict):
                    continue
                upgraded = upgrade_workspace_preferences(current)
                was_deleted = row["deleted_at"] is not None
                if was_deleted:
                    upgraded = {**upgraded, "archived": True}
                if upgraded == current and not was_deleted:
                    continue
                await db.execute(
                    text("""UPDATE sessions SET preferences_json=CAST(:prefs AS JSONB),
                            deleted_at=NULL WHERE id=:session AND owner_user_id=:owner"""),
                    {
                        "prefs": json.dumps(upgraded, ensure_ascii=False),
                        "session": row["id"], "owner": owner_user_id,
                    },
                )
                changed += 1
            await db.commit()
        return changed

    async def usage_records(
        self, owner_user_id: str, start_at: float, end_at: float
    ) -> list[dict]:
        from deeptutor.services.session.usage_statistics import summaries_from_events

        async with self._sessions() as db:
            rows = (
                await db.execute(
                    text("""SELECT m.id,m.session_id,m.created_at,m.events_json,
                                  m.metadata_json AS message_metadata,t.id AS turn_id,
                                  e.type,e.metadata_json
                           FROM messages m
                           LEFT JOIN turns t ON t.assistant_message_id=m.id
                             AND t.owner_user_id=m.owner_user_id
                           LEFT JOIN turn_events e ON e.turn_id=t.id
                             AND e.owner_user_id=m.owner_user_id
                             AND (e.type IN ('result','done')
                               OR e.metadata_json->>'model' IS NOT NULL)
                           WHERE m.owner_user_id=:owner AND m.role='assistant'
                             AND m.created_at>=:start AND m.created_at<:end
                             AND m.session_id NOT LIKE 'imported\\_%' ESCAPE '\\'
                           ORDER BY m.created_at,m.id,e.seq"""),
                    {
                        "owner": owner_user_id,
                        "start": datetime.fromtimestamp(start_at, timezone.utc),
                        "end": datetime.fromtimestamp(end_at, timezone.utc),
                    },
                )
            ).mappings().all()
        records: dict[int, dict] = {}
        canonical_events: dict[int, list[dict]] = {}
        metadata: dict[int, dict] = {}
        for row in rows:
            mid = row["id"]
            if mid not in records:
                message_meta = row["message_metadata"] or {}
                records[mid] = {
                    "session_id": row["session_id"],
                    "turn_id": row["turn_id"],
                    "created_at": row["created_at"].timestamp(),
                    "summaries": summaries_from_events(
                        row["events_json"], message_meta
                    ),
                }
                canonical_events[mid] = []
                metadata[mid] = message_meta
            if row["type"]:
                canonical_events[mid].append(
                    {"type": row["type"], "metadata": row["metadata_json"] or {}}
                )
        for mid, record in records.items():
            canonical = summaries_from_events(canonical_events[mid], metadata[mid])
            if canonical:
                record["summaries"] = canonical
        return list(records.values())

    async def create_session(
        self, owner_user_id: str, title: str = "New conversation", *,
        session_id: str | None = None,
    ) -> str:
        session_id = session_id or self.new_session_id()
        async with self._sessions() as db:
            await db.execute(
                text(
                    """INSERT INTO sessions (id, owner_user_id, title)
                       VALUES (:id,:owner,:title)"""
                ),
                {"id": session_id, "owner": owner_user_id, "title": title},
            )
            await db.commit()
        return session_id

    async def import_legacy_session(
        self, owner_user_id: str, session_id: str, title: str,
        created_at: float, updated_at: float, preferences: dict,
        messages: list[dict],
    ) -> dict:
        """Import one external conversation without overwriting later edits."""
        created = datetime.fromtimestamp(float(created_at), timezone.utc)
        updated = datetime.fromtimestamp(float(updated_at), timezone.utc)
        async with self._sessions() as db:
            existing = (
                await db.execute(
                    text("""SELECT owner_user_id,preferences_json FROM sessions
                            WHERE id=:session AND owner_user_id=:owner FOR UPDATE"""),
                    {"session": session_id, "owner": owner_user_id},
                )
            ).mappings().first()
            if existing is not None:
                if existing["owner_user_id"] != owner_user_id:
                    raise PermissionError("session belongs to another user")
                current = existing["preferences_json"] or {}
                incoming = (preferences or {}).get("import") or {}
                meta = dict(current.get("import") or {})
                changed = False
                for key in ("agent_id", "agent_name", "source_cwd"):
                    value = incoming.get(key)
                    if value and meta.get(key) != value:
                        meta[key] = value
                        changed = True
                if changed:
                    await db.execute(
                        text("""UPDATE sessions SET preferences_json=CAST(:prefs AS JSONB)
                                WHERE id=:session AND owner_user_id=:owner"""),
                        {
                            "prefs": json.dumps({**current, "import": meta}, ensure_ascii=False),
                            "session": session_id, "owner": owner_user_id,
                        },
                    )
                    await db.commit()
                return {
                    "session_id": session_id, "imported": False,
                    "updated": changed, "message_count": 0,
                }
            inserted = await db.execute(
                text("""INSERT INTO sessions
                        (id,owner_user_id,title,created_at,updated_at,preferences_json)
                        VALUES (:session,:owner,:title,:created,:updated,CAST(:prefs AS JSONB))
                        ON CONFLICT (id) DO NOTHING RETURNING id"""),
                {
                    "session": session_id, "owner": owner_user_id,
                    "title": (title or "").strip()[:100] or "Imported conversation",
                    "created": created, "updated": updated,
                    "prefs": json.dumps(preferences or {}, ensure_ascii=False),
                },
            )
            if inserted.scalar_one_or_none() is None:
                raise PermissionError("session id belongs to another user")
            parent_id = None
            for message in messages:
                parent_id = (
                    await db.execute(
                        text("""INSERT INTO messages
                                (owner_user_id,session_id,role,content,capability,
                                 metadata_json,parent_message_id,created_at)
                                VALUES (:owner,:session,:role,:content,'',CAST(:meta AS JSONB),
                                        :parent,:created) RETURNING id"""),
                        {
                            "owner": owner_user_id, "session": session_id,
                            "role": message.get("role") or "user",
                            "content": message.get("content") or "",
                            "meta": json.dumps(message.get("metadata") or {}, ensure_ascii=False),
                            "parent": parent_id,
                            "created": datetime.fromtimestamp(
                                float(message.get("created_at") or created_at), timezone.utc
                            ),
                        },
                    )
                ).scalar_one()
            await db.commit()
            return {
                "session_id": session_id, "imported": True,
                "message_count": len(messages),
            }

    async def get_session(self, owner_user_id: str, session_id: str) -> dict | None:
        async with self._sessions() as db:
            row = (
                (
                    await db.execute(
                        text(
                            """SELECT s.id,s.title,s.compressed_summary,
                                      s.summary_up_to_message_id,s.preferences_json,
                                      s.created_at,s.updated_at,s.deleted_at,
                                      COALESCE(latest.status,'idle') AS status,
                                      COALESCE(active.id,'') AS active_turn_id,
                                      COALESCE(latest.capability,'') AS capability
                               FROM sessions s
                               LEFT JOIN LATERAL (
                                 SELECT status,capability FROM turns t
                                 WHERE t.session_id=s.id AND t.owner_user_id=:owner
                                 ORDER BY t.updated_at DESC,t.id DESC LIMIT 1
                               ) latest ON true
                               LEFT JOIN LATERAL (
                                 SELECT id FROM turns t WHERE t.session_id=s.id
                                   AND t.owner_user_id=:owner
                                   AND t.status IN ('queued','running','waiting_input')
                                 ORDER BY t.updated_at DESC,t.id DESC LIMIT 1
                               ) active ON true
                               WHERE s.id=:id AND s.owner_user_id=:owner"""
                        ),
                        {"id": session_id, "owner": owner_user_id},
                    )
                )
                .mappings()
                .first()
            )
            if row is None:
                return None
            payload = dict(row)
            for key in ("created_at", "updated_at", "deleted_at"):
                payload[key] = _epoch(payload[key])
            payload["session_id"] = row["id"]
            payload["summary_up_to_msg_id"] = payload.pop("summary_up_to_message_id")
            payload["preferences"] = payload.pop("preferences_json")
            return payload

    async def list_sessions(
        self, owner_user_id: str, limit: int = 50, offset: int = 0,
        *, workspace_id: str | None = None,
    ) -> list[dict]:
        workspace_filter = "" if workspace_id is None else """
            AND COALESCE(preferences_json->>'workspace_id','')=:workspace
            AND COALESCE(preferences_json->>'archived','false')!='true'
            AND COALESCE(preferences_json->>'parent_session_id','')=''"""
        async with self._sessions() as db:
            ids = (
                await db.execute(
                    text(f"""SELECT id FROM sessions
                            WHERE owner_user_id=:owner AND deleted_at IS NULL
                              AND id NOT LIKE 'imported\\_%' ESCAPE '\\'
                              {workspace_filter}
                            ORDER BY updated_at DESC,id ASC LIMIT :limit OFFSET :offset"""),
                    {
                        "owner": owner_user_id, "workspace": workspace_id,
                        "limit": max(1, min(int(limit), 100)),
                        "offset": max(0, int(offset)),
                    },
                )
            ).scalars().all()
        return await self.get_session_summaries(owner_user_id, list(ids))

    async def list_imported_sessions(
        self, owner_user_id: str, limit: int = 50, offset: int = 0
    ) -> list[dict]:
        async with self._sessions() as db:
            ids = (await db.execute(
                text("""SELECT id FROM sessions WHERE owner_user_id=:owner
                        AND deleted_at IS NULL AND id LIKE 'imported\\_%' ESCAPE '\\'
                        ORDER BY updated_at DESC,id ASC LIMIT :limit OFFSET :offset"""),
                {"owner": owner_user_id, "limit": max(1, min(int(limit), 200)),
                 "offset": max(0, int(offset))},
            )).scalars().all()
        return await self.get_session_summaries(owner_user_id, list(ids))

    async def search_sessions(
        self, owner_user_id: str, query: str, limit: int = 50, offset: int = 0
    ) -> dict:
        """Search literal title and message text within one owner's live sessions."""
        query = normalize_search_query(query)
        if not query:
            return {"sessions": [], "total": 0}
        params = {
            "owner": owner_user_id, "query": query,
            "limit": max(1, min(int(limit), 100)), "offset": max(0, int(offset)),
        }
        match = """s.owner_user_id=:owner AND s.deleted_at IS NULL
                   AND (strpos(lower(s.title),lower(:query))>0 OR EXISTS (
                     SELECT 1 FROM messages m WHERE m.session_id=s.id
                     AND m.owner_user_id=:owner AND m.role IN ('user','assistant')
                     AND strpos(lower(m.content),lower(:query))>0))"""
        async with self._sessions() as db:
            total = (await db.execute(
                text(f"SELECT count(*) FROM sessions s WHERE {match}"), params
            )).scalar_one()
            rows = (await db.execute(text(f"""
                SELECT s.id,s.title,s.created_at,s.updated_at,s.compressed_summary,
                       s.summary_up_to_message_id,s.preferences_json,
                       (SELECT count(*) FROM messages all_m WHERE all_m.session_id=s.id
                        AND all_m.owner_user_id=:owner AND all_m.role!='system') AS message_count,
                       COALESCE(last_turn.status,'idle') AS status,
                       COALESCE(active_turn.id,'') AS active_turn_id,
                       COALESCE(last_turn.capability,'') AS capability,
                       COALESCE(last_message.content,'') AS last_message,
                       matched.id AS match_message_id, matched.role AS match_role,
                       matched.created_at AS match_created_at,
                       COALESCE(matched.content,s.title,'') AS match_content
                FROM sessions s
                LEFT JOIN LATERAL (
                  SELECT status,capability FROM turns t WHERE t.session_id=s.id
                    AND t.owner_user_id=:owner ORDER BY t.updated_at DESC LIMIT 1
                ) last_turn ON true
                LEFT JOIN LATERAL (
                  SELECT id FROM turns t WHERE t.session_id=s.id AND t.owner_user_id=:owner
                    AND t.status IN ('queued','running','waiting_input')
                    ORDER BY t.updated_at DESC LIMIT 1
                ) active_turn ON true
                LEFT JOIN LATERAL (
                  SELECT content FROM messages m WHERE m.session_id=s.id
                    AND m.owner_user_id=:owner AND m.role!='system'
                    AND btrim(m.content)!='' ORDER BY m.id DESC LIMIT 1
                ) last_message ON true
                LEFT JOIN LATERAL (
                  SELECT id,role,created_at,content FROM messages m
                    WHERE m.session_id=s.id AND m.owner_user_id=:owner
                      AND m.role IN ('user','assistant')
                      AND strpos(lower(m.content),lower(:query))>0
                    ORDER BY m.created_at DESC,m.id DESC LIMIT 1
                ) matched ON true
                WHERE {match}
                ORDER BY s.updated_at DESC,s.id ASC LIMIT :limit OFFSET :offset
            """), params)).mappings().all()
        sessions = []
        for row in rows:
            item = dict(row)
            for key in ("created_at", "updated_at", "match_created_at"):
                item[key] = _epoch(item[key])
            item["session_id"] = item["id"]
            item["summary_up_to_msg_id"] = item.pop("summary_up_to_message_id")
            item["preferences"] = item.pop("preferences_json")
            item["match_excerpt"] = bounded_search_excerpt(item.pop("match_content"), query)
            sessions.append(item)
        return {"sessions": sessions, "total": int(total)}

    async def get_session_summaries(
        self, owner_user_id: str, session_ids: list[str]
    ) -> list[dict]:
        """Return owned summaries in the caller's order, omitting missing IDs."""
        ids = list(dict.fromkeys(str(value or "").strip() for value in session_ids))
        ids = [value for value in ids if value]
        if not ids:
            return []
        async with self._sessions() as db:
            rows = (
                await db.execute(
                    text("""SELECT s.id,
                              (SELECT count(*) FROM messages m WHERE m.session_id=s.id
                               AND m.owner_user_id=:owner AND m.role!='system') AS message_count,
                              COALESCE((SELECT m.content FROM messages m
                               WHERE m.session_id=s.id AND m.owner_user_id=:owner
                               AND m.role!='system' AND btrim(m.content)!=''
                               ORDER BY m.id DESC LIMIT 1),'') AS last_message
                            FROM sessions s WHERE s.owner_user_id=:owner
                              AND s.id=ANY(:ids)"""),
                    {"owner": owner_user_id, "ids": ids},
                )
            ).mappings().all()
        extra = {row["id"]: dict(row) for row in rows}
        result = []
        for session_id in ids:
            if session_id not in extra:
                continue
            session = await self.get_session(owner_user_id, session_id)
            if session is not None:
                session.update(extra[session_id])
                result.append(session)
        return result

    async def reserve_submission(
        self, owner_user_id: str, submission_id: str, digest: str,
        session_id: str | None = None, *, workspace_id: str = "",
    ) -> str:
        """Atomically reserve a client request and its conversation."""
        if not submission_id or not digest:
            raise ValueError("A submission ID and request digest are required")
        async with self._sessions() as db:
            # Serialize first use of one owner/submission pair before checking
            # the row; row locks alone cannot protect a missing reservation.
            await db.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
                {"key": f"{owner_user_id}:{submission_id}"},
            )
            prior = (
                await db.execute(
                    text("""SELECT workspace_id,request_digest,session_id,superseded_by
                            FROM turn_submissions WHERE owner_user_id=:owner
                              AND client_submission_id=:submission FOR UPDATE"""),
                    {"owner": owner_user_id, "submission": submission_id},
                )
            ).mappings().first()
            if prior is not None:
                if prior["superseded_by"]:
                    raise RuntimeError("This submission was superseded by an edited message.")
                if prior["request_digest"] != digest or prior["workspace_id"] != workspace_id:
                    raise RuntimeError("This submission ID belongs to a different request or workspace.")
                if session_id and session_id != prior["session_id"]:
                    raise RuntimeError("This submission ID belongs to another conversation.")
                existing_id = prior["session_id"]
                session = (
                    await db.execute(
                        text("""SELECT deleted_at FROM sessions
                                WHERE id=:session AND owner_user_id=:owner"""),
                        {"session": existing_id, "owner": owner_user_id},
                    )
                ).mappings().first()
                if session is None or session["deleted_at"] is not None:
                    raise RuntimeError("Restore the original conversation before resending this message.")
                return existing_id
            if session_id:
                session = (
                    await db.execute(
                        text("""SELECT preferences_json FROM sessions
                                WHERE id=:session AND owner_user_id=:owner
                                  AND deleted_at IS NULL FOR UPDATE"""),
                        {"session": session_id, "owner": owner_user_id},
                    )
                ).mappings().first()
                if session is None:
                    raise RuntimeError("Conversation not found in this workspace.")
                if str(session["preferences_json"].get("workspace_id") or "") != workspace_id:
                    raise RuntimeError("The conversation belongs to another workspace.")
            else:
                session_id = self.new_session_id()
                await db.execute(
                    text("""INSERT INTO sessions (id,owner_user_id,title,preferences_json)
                            VALUES (:session,:owner,'New conversation',CAST(:prefs AS JSONB))"""),
                    {
                        "session": session_id, "owner": owner_user_id,
                        "prefs": json.dumps({"workspace_id": workspace_id}),
                    },
                )
            await db.execute(
                text("""INSERT INTO turn_submissions
                       (owner_user_id,client_submission_id,workspace_id,request_digest,session_id)
                       VALUES (:owner,:submission,:workspace,:digest,:session)"""),
                {
                    "owner": owner_user_id, "submission": submission_id,
                    "workspace": workspace_id, "digest": digest, "session": session_id,
                },
            )
            await db.commit()
            return session_id

    async def submission_turn(
        self, owner_user_id: str, submission_id: str
    ) -> dict | None:
        async with self._sessions() as db:
            turn_id = (
                await db.execute(
                    text("""SELECT turn_id FROM turn_submissions
                            WHERE owner_user_id=:owner AND client_submission_id=:submission"""),
                    {"owner": owner_user_id, "submission": submission_id},
                )
            ).scalar_one_or_none()
        return await self.get_turn(owner_user_id, turn_id) if turn_id else None

    async def replace_submission(
        self, owner_user_id: str, original_id: str, replacement_id: str,
        digest: str, session_id: str | None = None, *, workspace_id: str = "",
    ) -> dict:
        """Fence an unadmitted submission and reserve its edit atomically."""
        if not original_id or not replacement_id or not digest:
            raise ValueError("Submission IDs and request digest are required")
        if original_id == replacement_id:
            raise RuntimeError("An edit requires a new submission ID.")
        async with self._sessions() as db:
            for key in sorted({original_id, replacement_id}):
                await db.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
                    {"key": f"{owner_user_id}:{key}"},
                )
            old = (
                await db.execute(
                    text("""SELECT session_id,workspace_id,turn_id,superseded_by
                            FROM turn_submissions WHERE owner_user_id=:owner
                              AND client_submission_id=:submission FOR UPDATE"""),
                    {"owner": owner_user_id, "submission": original_id},
                )
            ).mappings().first()
            if old is not None:
                if old["workspace_id"] != workspace_id or (
                    session_id and old["session_id"] != session_id
                ):
                    raise RuntimeError("The submission belongs to another conversation or workspace.")
                session_id = old["session_id"]
            if session_id:
                session = (
                    await db.execute(
                        text("""SELECT preferences_json FROM sessions WHERE id=:session
                                AND owner_user_id=:owner AND deleted_at IS NULL FOR UPDATE"""),
                        {"session": session_id, "owner": owner_user_id},
                    )
                ).mappings().first()
                if session is None:
                    raise RuntimeError("Restore the original conversation before editing this message.")
                if str(session["preferences_json"].get("workspace_id") or "") != workspace_id:
                    raise RuntimeError("The conversation belongs to another workspace.")
            else:
                session_id = self.new_session_id()
                await db.execute(
                    text("""INSERT INTO sessions (id,owner_user_id,title,preferences_json)
                            VALUES (:session,:owner,'New conversation',CAST(:prefs AS JSONB))"""),
                    {
                        "session": session_id, "owner": owner_user_id,
                        "prefs": json.dumps({"workspace_id": workspace_id}),
                    },
                )
            if old is not None and old["turn_id"]:
                turn = await self.get_turn(owner_user_id, old["turn_id"])
                user_id = (
                    await db.execute(
                        text("""SELECT id FROM messages WHERE owner_user_id=:owner
                                AND session_id=:session AND role='user'
                                AND metadata_json->>'client_submission_id'=:submission
                                ORDER BY id LIMIT 1"""),
                        {
                            "owner": owner_user_id, "session": session_id,
                            "submission": original_id,
                        },
                    )
                ).scalar_one_or_none()
                return {
                    "status": "admitted", "session_id": session_id,
                    "turn": turn, "user_message_id": user_id,
                }
            replacement = (
                await db.execute(
                    text("""SELECT request_digest,superseded_by FROM turn_submissions
                            WHERE owner_user_id=:owner AND client_submission_id=:submission
                            FOR UPDATE"""),
                    {"owner": owner_user_id, "submission": replacement_id},
                )
            ).mappings().first()
            if old is not None and old["superseded_by"]:
                if old["superseded_by"] != replacement_id:
                    raise RuntimeError("This submission was already superseded by another edit.")
                if replacement is None or replacement["request_digest"] != digest or replacement["superseded_by"]:
                    raise RuntimeError("This replacement ID belongs to a different request.")
            else:
                if replacement is not None:
                    raise RuntimeError("This replacement ID is already in use.")
                await db.execute(
                    text("""INSERT INTO turn_submissions
                            (owner_user_id,client_submission_id,workspace_id,
                             request_digest,session_id)
                            VALUES (:owner,:submission,:workspace,:digest,:session)"""),
                    {
                        "owner": owner_user_id, "submission": replacement_id,
                        "workspace": workspace_id, "digest": digest,
                        "session": session_id,
                    },
                )
                if old is None:
                    await db.execute(
                        text("""INSERT INTO turn_submissions
                                (owner_user_id,client_submission_id,workspace_id,
                                 request_digest,session_id,superseded_by)
                                VALUES (:owner,:submission,:workspace,'',:session,:replacement)"""),
                        {
                            "owner": owner_user_id, "submission": original_id,
                            "workspace": workspace_id, "session": session_id,
                            "replacement": replacement_id,
                        },
                    )
                else:
                    await db.execute(
                        text("""UPDATE turn_submissions SET superseded_by=:replacement
                                WHERE owner_user_id=:owner AND client_submission_id=:submission"""),
                        {
                            "replacement": replacement_id, "owner": owner_user_id,
                            "submission": original_id,
                        },
                    )
            await db.commit()
            return {
                "status": "reserved", "session_id": session_id,
                "submission_id": replacement_id,
            }

    async def get_messages(self, owner_user_id: str, session_id: str) -> list[dict]:
        """Read the full message timeline for one authenticated owner."""
        async with self._sessions() as db:
            rows = (
                await db.execute(
                    text(
                        """SELECT m.id,m.session_id,m.role,m.content,m.capability,
                                  m.events_json,m.attachments_json,m.metadata_json,
                                  m.created_at,m.parent_message_id,t.id AS trace_turn_id
                           FROM messages m
                           LEFT JOIN turns t ON t.assistant_message_id=m.id
                                            AND t.owner_user_id=m.owner_user_id
                           WHERE m.owner_user_id=:owner AND m.session_id=:session
                           ORDER BY m.created_at,m.id"""
                    ),
                    {"owner": owner_user_id, "session": session_id},
                )
            ).mappings().all()
            return [
                {
                    "id": row["id"], "session_id": row["session_id"],
                    "role": row["role"], "content": row["content"],
                    "capability": row["capability"], "events": row["events_json"],
                    "attachments": row["attachments_json"],
                    "metadata": row["metadata_json"],
                    "created_at": _epoch(row["created_at"]),
                    "parent_message_id": row["parent_message_id"],
                }
                for row in rows
            ]

    async def get_last_message(
        self, owner_user_id: str, session_id: str, role: str | None = None
    ) -> dict | None:
        rows = await self.get_messages(owner_user_id, session_id)
        return next(
            (row for row in reversed(rows) if role is None or row["role"] == role),
            None,
        )

    async def get_messages_for_context(
        self, owner_user_id: str, session_id: str, leaf_message_id: int | None = None
    ) -> list[dict]:
        """Return visible messages, or only the selected edit branch's ancestors."""
        rows = await self.get_messages(owner_user_id, session_id)
        by_id = {row["id"]: row for row in rows}
        if leaf_message_id is None:
            selected = rows
        else:
            selected = []
            current = leaf_message_id
            seen: set[int] = set()
            while current is not None and current not in seen and len(seen) < 10_000:
                row = by_id.get(current)
                if row is None:
                    break
                selected.append(row)
                seen.add(current)
                current = row["parent_message_id"]
            selected.reverse()
        return [
            {
                "id": row["id"], "role": row["role"], "content": row["content"],
                "events": select_ask_user_events(json.dumps(row["events"])),
                "metadata": row["metadata"],
            }
            for row in selected if row["role"] in {"user", "assistant", "system"}
        ]

    async def get_session_with_messages(
        self, owner_user_id: str, session_id: str
    ) -> dict | None:
        session = await self.get_session(owner_user_id, session_id)
        if session is None:
            return None
        session["messages"] = await self.get_messages(owner_user_id, session_id)
        redact_private_message_metadata(session["messages"])
        session["active_turns"] = await self.list_active_turns(owner_user_id, session_id)
        return session

    async def add_message(
        self,
        owner_user_id: str,
        session_id: str,
        role: str,
        content: str,
        *,
        capability: str = "",
        events: list[dict] | None = None,
        attachments: list[dict] | None = None,
        metadata: dict | None = None,
        parent_message_id: int | None = None,
    ) -> int:
        """Append a message after checking session and branch ownership."""
        async with self._sessions() as db:
            session_owner = (
                await db.execute(
                    text("""SELECT owner_user_id FROM sessions
                            WHERE id=:session AND owner_user_id=:owner"""),
                    {"session": session_id, "owner": owner_user_id},
                )
            ).scalar_one_or_none()
            if session_owner is None:
                raise PermissionError("session was not found for this user")
            if session_owner != owner_user_id:
                raise PermissionError("session belongs to another user")
            if parent_message_id is not None:
                parent = (
                    await db.execute(
                        text(
                            """SELECT 1 FROM messages WHERE id=:parent
                               AND owner_user_id=:owner AND session_id=:session"""
                        ),
                        {
                            "parent": parent_message_id,
                            "owner": owner_user_id,
                            "session": session_id,
                        },
                    )
                ).scalar_one_or_none()
                if parent is None:
                    raise PermissionError("parent message is outside this session")
            message_id = (
                await db.execute(
                    text(
                        """INSERT INTO messages
                           (owner_user_id,session_id,role,content,capability,events_json,
                            attachments_json,metadata_json,parent_message_id)
                           VALUES (:owner,:session,:role,:content,:capability,
                            CAST(:events AS JSONB),CAST(:attachments AS JSONB),
                            CAST(:metadata AS JSONB),:parent) RETURNING id"""
                    ),
                    {
                        "owner": owner_user_id, "session": session_id,
                        "role": role, "content": content, "capability": capability,
                        "events": json.dumps(events or [], ensure_ascii=False),
                        "attachments": json.dumps(attachments or [], ensure_ascii=False),
                        "metadata": json.dumps(metadata or {}, ensure_ascii=False),
                        "parent": parent_message_id,
                    },
                )
            ).scalar_one()
            await db.commit()
            return int(message_id)

    async def update_session_title(
        self, owner_user_id: str, session_id: str, title: str
    ) -> bool:
        async with self._sessions() as db:
            changed = (
                await db.execute(
                    text(
                        """UPDATE sessions SET title=:title,updated_at=now()
                           WHERE id=:session AND owner_user_id=:owner AND deleted_at IS NULL
                           RETURNING id"""
                    ),
                    {"title": title, "session": session_id, "owner": owner_user_id},
                )
            ).scalar_one_or_none()
            await db.commit()
            return changed is not None

    async def soft_delete_session(self, owner_user_id: str, session_id: str) -> bool:
        async with self._sessions() as db:
            changed = (
                await db.execute(
                    text(
                        """UPDATE sessions SET deleted_at=now(),updated_at=now()
                           WHERE id=:session AND owner_user_id=:owner AND deleted_at IS NULL
                           RETURNING id"""
                    ),
                    {"session": session_id, "owner": owner_user_id},
                )
            ).scalar_one_or_none()
            await db.commit()
            return changed is not None

    async def restore_session(self, owner_user_id: str, session_id: str) -> bool:
        async with self._sessions() as db:
            changed = (
                await db.execute(
                    text(
                        """UPDATE sessions SET deleted_at=NULL,updated_at=now()
                           WHERE id=:session AND owner_user_id=:owner AND deleted_at IS NOT NULL
                           RETURNING id"""
                    ),
                    {"session": session_id, "owner": owner_user_id},
                )
            ).scalar_one_or_none()
            await db.commit()
            return changed is not None

    async def delete_session(self, owner_user_id: str, session_id: str) -> bool:
        """Permanently delete one owned session; child rows cascade in PostgreSQL."""
        async with self._sessions() as db:
            deleted = (
                await db.execute(
                    text("""DELETE FROM sessions WHERE id=:session AND owner_user_id=:owner
                            RETURNING id"""),
                    {"session": session_id, "owner": owner_user_id},
                )
            ).scalar_one_or_none()
            await db.commit()
            return deleted is not None

    async def hard_delete_session(self, owner_user_id: str, session_id: str) -> bool:
        async with self._sessions() as db:
            deleted = (
                await db.execute(
                    text("""DELETE FROM sessions WHERE id=:session AND owner_user_id=:owner
                            AND deleted_at IS NOT NULL RETURNING id"""),
                    {"session": session_id, "owner": owner_user_id},
                )
            ).scalar_one_or_none()
            await db.commit()
            return deleted is not None

    async def list_deleted_sessions(
        self, owner_user_id: str, limit: int = 50, offset: int = 0
    ) -> list[dict]:
        async with self._sessions() as db:
            ids = (
                await db.execute(
                    text("""SELECT id FROM sessions WHERE owner_user_id=:owner
                            AND deleted_at IS NOT NULL
                            ORDER BY deleted_at DESC,id ASC LIMIT :limit OFFSET :offset"""),
                    {
                        "owner": owner_user_id,
                        "limit": max(1, min(int(limit), 100)),
                        "offset": max(0, int(offset)),
                    },
                )
            ).scalars().all()
        return [
            item for session_id in ids
            if (item := await self.get_session(owner_user_id, session_id)) is not None
        ]

    async def delete_message(self, owner_user_id: str, message_id: int) -> bool:
        async with self._sessions() as db:
            await db.execute(
                text("""UPDATE turns SET assistant_message_id=NULL
                        WHERE owner_user_id=:owner AND assistant_message_id=:message"""),
                {"owner": owner_user_id, "message": message_id},
            )
            deleted = (
                await db.execute(
                    text("""DELETE FROM messages WHERE id=:message AND owner_user_id=:owner
                            RETURNING id"""),
                    {"message": message_id, "owner": owner_user_id},
                )
            ).scalar_one_or_none()
            await db.commit()
            return deleted is not None

    async def delete_turn_by_message(
        self, owner_user_id: str, session_id: str, message_id: int
    ) -> dict[str, Any]:
        """Remove a settled message pair and its turn without crossing owners."""
        missing = {
            "deleted": False, "attachment_ids": [],
            "turn_id": None, "was_active": False,
        }
        async with self._sessions() as db:
            session = (
                await db.execute(
                    text("""SELECT summary_up_to_message_id FROM sessions
                            WHERE id=:session AND owner_user_id=:owner FOR UPDATE"""),
                    {"session": session_id, "owner": owner_user_id},
                )
            ).mappings().first()
            if session is None:
                return missing
            msg = (
                await db.execute(
                    text("""SELECT id,role,attachments_json,metadata_json,created_at,
                                   parent_message_id FROM messages
                            WHERE id=:message AND session_id=:session
                              AND owner_user_id=:owner FOR UPDATE"""),
                    {"message": int(message_id), "session": session_id, "owner": owner_user_id},
                )
            ).mappings().first()
            if msg is None:
                return missing
            role = msg["role"]
            paired = None
            if role == "user":
                paired = (
                    await db.execute(
                        text("""SELECT id,role,attachments_json,metadata_json,
                                       created_at,parent_message_id FROM messages
                                WHERE session_id=:session AND owner_user_id=:owner
                                  AND role='assistant' AND parent_message_id=:message
                                ORDER BY id LIMIT 1 FOR UPDATE"""),
                        {"session": session_id, "owner": owner_user_id, "message": int(message_id)},
                    )
                ).mappings().first()
            elif role == "assistant" and msg["parent_message_id"] is not None:
                paired = (
                    await db.execute(
                        text("""SELECT id,role,attachments_json,metadata_json,
                                       created_at,parent_message_id FROM messages
                                WHERE session_id=:session AND owner_user_id=:owner
                                  AND role='user' AND id=:parent FOR UPDATE"""),
                        {
                            "session": session_id, "owner": owner_user_id,
                            "parent": msg["parent_message_id"],
                        },
                    )
                ).mappings().first()
            user_msg = msg if role == "user" else paired
            turn = None
            if role == "assistant":
                turn = (
                    await db.execute(
                        text("""SELECT id,status FROM turns
                                WHERE session_id=:session AND owner_user_id=:owner
                                  AND assistant_message_id=:message LIMIT 1 FOR UPDATE"""),
                        {"session": session_id, "owner": owner_user_id, "message": int(message_id)},
                    )
                ).mappings().first()
            if turn is None and user_msg is not None:
                metadata = user_msg["metadata_json"] or {}
                stamped = str(metadata.get("turn_id") or "").strip() if isinstance(metadata, dict) else ""
                if stamped:
                    turn = (
                        await db.execute(
                            text("""SELECT id,status FROM turns
                                    WHERE session_id=:session AND owner_user_id=:owner
                                      AND id=:turn FOR UPDATE"""),
                            {"session": session_id, "owner": owner_user_id, "turn": stamped},
                        )
                    ).mappings().first()
            if turn is None and user_msg is not None:
                turn = (
                    await db.execute(
                        text("""SELECT id,status FROM turns
                                WHERE session_id=:session AND owner_user_id=:owner
                                  AND created_at<=:created
                                ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE"""),
                        {
                            "session": session_id, "owner": owner_user_id,
                            "created": user_msg["created_at"],
                        },
                    )
                ).mappings().first()
            turn_id = turn["id"] if turn else None
            if turn is not None and turn["status"] in {"queued", "running", "waiting_input"}:
                return {
                    "deleted": False, "attachment_ids": [],
                    "turn_id": turn_id, "was_active": True,
                }
            if role == "assistant" and paired is not None:
                sibling = (
                    await db.execute(
                        text("""SELECT 1 FROM messages
                                WHERE owner_user_id=:owner AND session_id=:session
                                  AND role='assistant' AND parent_message_id=:parent
                                  AND id<>:message LIMIT 1"""),
                        {
                            "owner": owner_user_id, "session": session_id,
                            "parent": paired["id"], "message": int(message_id),
                        },
                    )
                ).first()
                if sibling is not None:
                    paired = None
            attachment_ids: list[str] = []
            for item in (msg, paired):
                if item is None:
                    continue
                for attachment in item["attachments_json"] or []:
                    if isinstance(attachment, dict):
                        aid = attachment.get("id") or attachment.get("attachment_id")
                        if aid:
                            attachment_ids.append(str(aid))
            if turn_id is not None:
                await db.execute(
                    text("DELETE FROM turns WHERE id=:turn AND owner_user_id=:owner"),
                    {"turn": turn_id, "owner": owner_user_id},
                )
            ids = [int(message_id)]
            if paired is not None:
                ids.append(int(paired["id"]))
            for mid in sorted(ids, reverse=True):
                await db.execute(
                    text("""UPDATE messages AS child
                            SET parent_message_id=parent.parent_message_id
                            FROM messages AS parent
                            WHERE child.owner_user_id=:owner
                              AND child.session_id=:session
                              AND child.parent_message_id=:message
                              AND parent.id=:message"""),
                    {"owner": owner_user_id, "session": session_id, "message": mid},
                )
            for mid in ids:
                await db.execute(
                    text("""DELETE FROM messages
                            WHERE id=:message AND session_id=:session
                              AND owner_user_id=:owner"""),
                    {"message": mid, "session": session_id, "owner": owner_user_id},
                )
            if session["summary_up_to_message_id"] is not None and any(
                mid <= int(session["summary_up_to_message_id"]) for mid in ids
            ):
                await db.execute(
                    text("""UPDATE sessions SET summary_up_to_message_id=0
                            WHERE id=:session AND owner_user_id=:owner"""),
                    {"session": session_id, "owner": owner_user_id},
                )
            await db.execute(
                text("""UPDATE sessions SET updated_at=now()
                        WHERE id=:session AND owner_user_id=:owner"""),
                {"session": session_id, "owner": owner_user_id},
            )
            await db.commit()
            return {
                "deleted": True, "attachment_ids": attachment_ids,
                "turn_id": turn_id, "was_active": False,
            }

    async def update_summary(
        self, owner_user_id: str, session_id: str, summary: str, up_to_msg_id: int
    ) -> bool:
        async with self._sessions() as db:
            updated = (
                await db.execute(
                    text(
                        """UPDATE sessions SET compressed_summary=:summary,
                           summary_up_to_message_id=:message
                           WHERE id=:session AND owner_user_id=:owner
                           RETURNING id"""
                    ),
                    {
                        "summary": summary, "message": max(0, int(up_to_msg_id)),
                        "session": session_id, "owner": owner_user_id,
                    },
                )
            ).scalar_one_or_none()
            await db.commit()
            return updated is not None

    async def update_session_preferences(
        self, owner_user_id: str, session_id: str, preferences: dict, *, touch: bool = True
    ) -> bool:
        async with self._sessions() as db:
            row = (
                await db.execute(
                    text(
                        """SELECT preferences_json FROM sessions
                           WHERE id=:session AND owner_user_id=:owner FOR UPDATE"""
                    ),
                    {"session": session_id, "owner": owner_user_id},
                )
            ).scalar_one_or_none()
            if row is None:
                return False
            from deeptutor.services.session.workspace_preferences import upgrade_workspace_preferences

            merged = upgrade_workspace_preferences({**row, **(preferences or {})})
            await db.execute(
                text(
                    """UPDATE sessions SET preferences_json=CAST(:prefs AS JSONB),
                       updated_at=CASE WHEN :touch THEN now() ELSE updated_at END
                       WHERE id=:session AND owner_user_id=:owner"""
                ),
                {
                    "prefs": json.dumps(merged, ensure_ascii=False),
                    "touch": touch, "session": session_id, "owner": owner_user_id,
                },
            )
            await db.commit()
            return True

    async def move_session_workspace(
        self, owner_user_id: str, session_id: str, target_workspace_id: str,
        *, source_workspace_id: str | None = None,
    ) -> dict:
        """Move a text-only conversation within one owner's PostgreSQL store."""
        async with self._sessions() as db:
            row = (await db.execute(text("""
                SELECT preferences_json FROM sessions
                WHERE id=:session AND owner_user_id=:owner AND deleted_at IS NULL
                FOR UPDATE
            """), {"session": session_id, "owner": owner_user_id})).scalar_one_or_none()
            if row is None:
                raise ValueError("Conversation not found.")
            if (source_workspace_id is not None
                and str((row or {}).get("workspace_id") or "") != source_workspace_id):
                raise ValueError("Conversation not found in this workspace.")
            active = (await db.execute(text("""
                SELECT 1 FROM turns WHERE session_id=:session AND owner_user_id=:owner
                  AND status IN ('queued','running','waiting_input') LIMIT 1
            """), {"session": session_id, "owner": owner_user_id})).scalar_one_or_none()
            if active:
                raise ValueError("Wait for active conversations before moving data.")
            linked = (await db.execute(text("""
                SELECT 1 FROM mastery_path_sessions
                WHERE session_id=:session AND owner_user_id=:owner LIMIT 1
            """), {"session": session_id, "owner": owner_user_id})).scalar_one_or_none()
            if linked:
                raise ValueError("This conversation is linked to learning data and cannot be moved between workspaces in PostgreSQL mode.")
            attachments = (await db.execute(text("""
                SELECT 1 FROM messages WHERE session_id=:session AND owner_user_id=:owner
                  AND json_typeof(attachments_json)='array'
                  AND json_array_length(attachments_json)>0 LIMIT 1
            """), {"session": session_id, "owner": owner_user_id})).scalar_one_or_none()
            if attachments:
                raise ValueError("This conversation has attachments and cannot be moved between workspaces in PostgreSQL mode.")
            answer_images = (await db.execute(text("""
                SELECT 1 FROM assessment_cards WHERE session_id=:session
                  AND owner_user_id=:owner
                  AND json_typeof(card_json->'user_answer_images')='array'
                  AND json_array_length(card_json->'user_answer_images')>0 LIMIT 1
            """), {"session": session_id, "owner": owner_user_id})).scalar_one_or_none()
            if answer_images:
                raise ValueError("This conversation has answer images and cannot be moved between workspaces in PostgreSQL mode.")
            preferences = dict(row or {})
            if preferences.get("parent_session_id"):
                raise ValueError("Move the parent conversation instead.")
            preferences["workspace_id"] = target_workspace_id
            await db.execute(text("""
                UPDATE sessions SET preferences_json=CAST(:preferences AS JSONB),updated_at=now()
                WHERE id=:session AND owner_user_id=:owner
            """), {"preferences": json.dumps(preferences, ensure_ascii=False),
                   "session": session_id, "owner": owner_user_id})
            await db.commit()
        result = await self.get_session(owner_user_id, session_id)
        assert result is not None
        return result

    async def begin_turn(
        self,
        owner_user_id: str,
        session_id: str,
        capability: str = "",
        *,
        turn_id: str | None = None,
        runtime_owner_id: str = "",
        fencing_token: int = 0,
        submission_id: str | None = None,
    ) -> dict:
        """Admit one active turn per session, including concurrent workers."""
        turn_id = turn_id or f"turn_{uuid.uuid4().hex}"
        replay_fields: dict[str, object] = {}
        try:
            async with self._sessions() as db:
                session = (
                    await db.execute(
                        text("""SELECT owner_user_id FROM sessions
                                WHERE id=:session AND owner_user_id=:owner FOR UPDATE"""),
                        {"session": session_id, "owner": owner_user_id},
                    )
                ).scalar_one_or_none()
                if session is None:
                    raise PermissionError("session was not found for this user")
                if session != owner_user_id:
                    raise PermissionError("session belongs to another user")
                if submission_id:
                    reservation = (
                        await db.execute(
                            text("""SELECT session_id,turn_id,superseded_by
                                    FROM turn_submissions WHERE owner_user_id=:owner
                                      AND client_submission_id=:submission FOR UPDATE"""),
                            {"owner": owner_user_id, "submission": submission_id},
                        )
                    ).mappings().first()
                    if reservation is None or reservation["session_id"] != session_id:
                        raise RuntimeError("Submission reservation is missing from this conversation.")
                    if reservation["superseded_by"]:
                        raise RuntimeError("This submission was superseded by an edited message.")
                    if reservation["turn_id"]:
                        prior_turn = await self.get_turn(owner_user_id, reservation["turn_id"])
                        if prior_turn and prior_turn["status"] not in {"failed", "cancelled"}:
                            return {**prior_turn, "_submission_replay": True}
                        if prior_turn:
                            previous_user = (
                                await db.execute(
                                    text("""SELECT id FROM messages
                                            WHERE owner_user_id=:owner AND session_id=:session
                                              AND role='user'
                                              AND metadata_json->>'client_submission_id'=:submission
                                            ORDER BY id LIMIT 1"""),
                                    {
                                        "owner": owner_user_id, "session": session_id,
                                        "submission": submission_id,
                                    },
                                )
                            ).scalar_one_or_none()
                            if previous_user is not None:
                                replay_fields = {
                                    "_submission_user_message_id": previous_user,
                                    "_submission_assistant_message_id": prior_turn["assistant_message_id"],
                                    "_submission_previous_turn_id": prior_turn["id"],
                                }
                active = (
                    await db.execute(
                        text(
                            """SELECT id FROM turns WHERE session_id=:session
                               AND status IN ('queued','running','waiting_input') LIMIT 1"""
                        ),
                        {"session": session_id},
                    )
                ).scalar_one_or_none()
                if active is not None:
                    raise ActiveTurnConflict(
                        f"Session already has an active turn: {active}", turn_id=str(active)
                    )
                row = (
                    await db.execute(
                        text(
                            """INSERT INTO turns
                               (id,owner_user_id,session_id,capability,status,
                                runtime_owner_id,fencing_token)
                               VALUES (:id,:owner,:session,:capability,'running',:runtime,:fence)
                               RETURNING id,session_id,capability,status,error,created_at,updated_at,
                                         finished_at,runtime_owner_id,fencing_token,state_version,
                                         failure_code,retryable,assistant_message_id"""
                        ),
                        {
                            "id": turn_id, "owner": owner_user_id,
                            "session": session_id, "capability": capability,
                            "runtime": runtime_owner_id,
                            "fence": max(0, int(fencing_token)),
                        },
                    )
                ).mappings().one()
                if submission_id:
                    await db.execute(
                        text("""UPDATE turn_submissions SET turn_id=:turn
                                WHERE owner_user_id=:owner
                                  AND client_submission_id=:submission"""),
                        {
                            "turn": turn_id, "owner": owner_user_id,
                            "submission": submission_id,
                        },
                    )
                await db.commit()
                return {
                    **replay_fields, **dict(row), "turn_id": turn_id, "last_seq": 0,
                    "owner_id": row["runtime_owner_id"],
                    "created_at": _epoch(row["created_at"]),
                    "updated_at": _epoch(row["updated_at"]),
                    "finished_at": _epoch(row["finished_at"]),
                }
        except IntegrityError as exc:
            raise ActiveTurnConflict(
                f"Session already has an active turn: {session_id}"
            ) from exc

    async def get_turn(self, owner_user_id: str, turn_id: str) -> dict | None:
        async with self._sessions() as db:
            row = (
                await db.execute(
                    text(
                        """SELECT t.id,t.session_id,t.capability,t.status,t.error,t.created_at,
                                  t.updated_at,t.finished_at,t.runtime_owner_id,t.fencing_token,
                                  t.state_version,t.failure_code,t.retryable,t.assistant_message_id,
                                  (SELECT COALESCE(MAX(seq),0) FROM turn_events e
                                   WHERE e.turn_id=t.id) AS last_seq
                           FROM turns t WHERE t.id=:turn AND t.owner_user_id=:owner"""
                    ),
                    {"turn": turn_id, "owner": owner_user_id},
                )
            ).mappings().first()
            if row is None:
                return None
            return {
                **dict(row), "turn_id": row["id"],
                "owner_id": row["runtime_owner_id"],
                "created_at": _epoch(row["created_at"]),
                "updated_at": _epoch(row["updated_at"]),
                "finished_at": _epoch(row["finished_at"]),
            }

    async def get_active_turn(self, owner_user_id: str, session_id: str) -> dict | None:
        async with self._sessions() as db:
            turn_id = (
                await db.execute(
                    text(
                        """SELECT id FROM turns WHERE owner_user_id=:owner
                           AND session_id=:session
                           AND status IN ('queued','running','waiting_input') LIMIT 1"""
                    ),
                    {"owner": owner_user_id, "session": session_id},
                )
            ).scalar_one_or_none()
        return await self.get_turn(owner_user_id, turn_id) if turn_id else None

    async def list_active_turns(self, owner_user_id: str, session_id: str) -> list[dict]:
        active = await self.get_active_turn(owner_user_id, session_id)
        return [active] if active else []

    async def list_nonterminal_turns(self, owner_user_id: str) -> list[dict]:
        async with self._sessions() as db:
            ids = (
                await db.execute(
                    text(
                        """SELECT id FROM turns WHERE owner_user_id=:owner
                           AND status IN ('queued','running','waiting_input')
                           ORDER BY updated_at,id"""
                    ),
                    {"owner": owner_user_id},
                )
            ).scalars().all()
        return [row for turn_id in ids if (row := await self.get_turn(owner_user_id, turn_id))]

    async def list_orphaned_failed_turns(
        self, owner_user_id: str, session_id: str
    ) -> list[dict]:
        async with self._sessions() as db:
            ids = (
                await db.execute(
                    text("""SELECT id FROM turns WHERE owner_user_id=:owner
                            AND session_id=:session AND status='failed'
                            AND assistant_message_id IS NULL
                            ORDER BY created_at,id"""),
                    {"owner": owner_user_id, "session": session_id},
                )
            ).scalars().all()
        return [
            row for turn_id in ids
            if (row := await self.get_turn(owner_user_id, turn_id)) is not None
        ]

    async def transition_turn(
        self,
        owner_user_id: str,
        turn_id: str,
        status: str,
        *,
        expected_status: str | None = None,
        fencing_token: int | None = None,
        error: str = "",
        failure_code: str = "",
        retryable: bool = False,
    ) -> bool:
        if status not in _STATUSES:
            raise ValueError(f"Unsupported turn status: {status}")
        async with self._sessions() as db:
            row = (
                await db.execute(
                    text(
                        """SELECT status,fencing_token FROM turns
                           WHERE id=:turn AND owner_user_id=:owner FOR UPDATE"""
                    ),
                    {"turn": turn_id, "owner": owner_user_id},
                )
            ).mappings().first()
            if row is None or (expected_status is not None and row["status"] != expected_status):
                return False
            if fencing_token is not None and row["fencing_token"] != fencing_token:
                return False
            if row["status"] in _TERMINAL and row["status"] != status:
                return False
            await db.execute(
                text(
                    """UPDATE turns SET status=:status,error=:error,failure_code=:failure,
                       retryable=:retryable,updated_at=now(),
                       finished_at=CASE WHEN :terminal THEN now() ELSE NULL END,
                       state_version=state_version+1 WHERE id=:turn AND owner_user_id=:owner"""
                ),
                {
                    "status": status, "error": error, "failure": failure_code,
                    "retryable": retryable, "terminal": status in _TERMINAL,
                    "turn": turn_id, "owner": owner_user_id,
                },
            )
            await db.commit()
            return True

    async def append_events(
        self,
        owner_user_id: str,
        turn_id: str,
        events: list[dict],
        *,
        fencing_token: int | None = None,
    ) -> list[dict]:
        """Append or replay an event batch under a turn row lock."""
        async with self._sessions() as db:
            turn = (
                await db.execute(
                    text(
                        """SELECT session_id,fencing_token FROM turns
                           WHERE id=:turn AND owner_user_id=:owner FOR UPDATE"""
                    ),
                    {"turn": turn_id, "owner": owner_user_id},
                )
            ).mappings().first()
            if turn is None:
                raise KeyError(turn_id)
            if fencing_token is not None and turn["fencing_token"] != fencing_token:
                raise RuntimeError(f"Turn lease lost: {turn_id}")
            last_seq = (
                await db.execute(
                    text("SELECT COALESCE(MAX(seq),0) FROM turn_events WHERE turn_id=:turn"),
                    {"turn": turn_id},
                )
            ).scalar_one()
            next_seq = int(last_seq) + 1
            payloads: list[dict] = []
            for event in events:
                seq = int(event.get("seq") or 0) or next_seq
                next_seq = max(next_seq, seq + 1)
                normalized = {
                    **event, "seq": seq, "turn_id": turn_id,
                    "session_id": turn["session_id"],
                    "type": str(event.get("type") or ""),
                    "source": str(event.get("source") or ""),
                    "stage": str(event.get("stage") or ""),
                    "content": str(event.get("content") or ""),
                    "metadata": event.get("metadata") or {},
                }
                existing = (
                    await db.execute(
                        text(
                            """SELECT type,source,stage,content,metadata_json,created_at
                               FROM turn_events WHERE turn_id=:turn AND seq=:seq"""
                        ),
                        {"turn": turn_id, "seq": seq},
                    )
                ).mappings().first()
                if existing is not None:
                    if any(normalized[key] != existing[column] for key, column in (
                        ("type", "type"), ("source", "source"), ("stage", "stage"),
                        ("content", "content"), ("metadata", "metadata_json"),
                    )):
                        raise ValueError(f"Turn event conflict: {turn_id} seq={seq}")
                    normalized["timestamp"] = existing["created_at"].timestamp()
                    payloads.append(normalized)
                    continue
                timestamp = float(event.get("timestamp") or datetime.now(timezone.utc).timestamp())
                normalized["timestamp"] = timestamp
                await db.execute(
                    text(
                        """INSERT INTO turn_events
                           (owner_user_id,turn_id,seq,type,source,stage,content,
                            metadata_json,created_at)
                           VALUES (:owner,:turn,:seq,:type,:source,:stage,:content,
                            CAST(:metadata AS JSONB),:created)"""
                    ),
                    {
                        "owner": owner_user_id, "turn": turn_id, "seq": seq,
                        "type": normalized["type"], "source": normalized["source"],
                        "stage": normalized["stage"], "content": normalized["content"],
                        "metadata": json.dumps(normalized["metadata"], ensure_ascii=False),
                        "created": datetime.fromtimestamp(timestamp, timezone.utc),
                    },
                )
                payloads.append(normalized)
            if events:
                await db.execute(
                    text("UPDATE turns SET updated_at=now() WHERE id=:turn"),
                    {"turn": turn_id},
                )
            await db.commit()
            return payloads

    async def get_events(self, owner_user_id: str, turn_id: str, after_seq: int = 0) -> list[dict]:
        async with self._sessions() as db:
            rows = (
                await db.execute(
                    text(
                        """SELECT e.seq,e.type,e.source,e.stage,e.content,e.metadata_json,
                                  e.created_at,t.session_id
                           FROM turn_events e JOIN turns t ON t.id=e.turn_id
                           WHERE t.id=:turn AND t.owner_user_id=:owner AND e.seq>:after
                           ORDER BY e.seq"""
                    ),
                    {"turn": turn_id, "owner": owner_user_id, "after": max(0, after_seq)},
                )
            ).mappings().all()
            return [
                {
                    "turn_id": turn_id, "session_id": row["session_id"],
                    "seq": row["seq"], "type": row["type"],
                    "source": row["source"], "stage": row["stage"],
                    "content": row["content"], "metadata": row["metadata_json"],
                    "timestamp": row["created_at"].timestamp(),
                }
                for row in rows
            ]

    async def get_message_trace(
        self, owner_user_id: str, session_id: str, message_id: int | str,
        after_seq: int = 0, limit: int | None = None,
    ) -> dict | None:
        try:
            resolved_id = int(message_id)
        except (TypeError, ValueError):
            return None
        after = max(0, int(after_seq))
        row_limit = 500 if limit is None else min(1000, max(1, int(limit)))
        async with self._sessions() as db:
            row = (
                await db.execute(
                    text("""SELECT m.id,t.id AS turn_id FROM messages m
                            LEFT JOIN turns t ON t.assistant_message_id=m.id
                              AND t.owner_user_id=m.owner_user_id
                            WHERE m.id=:message AND m.session_id=:session
                              AND m.owner_user_id=:owner"""),
                    {
                        "message": resolved_id, "session": session_id,
                        "owner": owner_user_id,
                    },
                )
            ).mappings().first()
            if row is None:
                return None
            turn_id = row["turn_id"]
            if turn_id is None:
                return {
                    "session_id": session_id, "message_id": resolved_id,
                    "turn_id": None, "events": [], "total": 0, "last_seq": 0,
                    "next_seq": None, "complete": True,
                }
            stats = (
                await db.execute(
                    text("""SELECT count(*) AS total,COALESCE(max(seq),0) AS last_seq
                            FROM turn_events WHERE owner_user_id=:owner AND turn_id=:turn"""),
                    {"owner": owner_user_id, "turn": turn_id},
                )
            ).mappings().one()
            rows = (
                await db.execute(
                    text("""SELECT seq,type,source,stage,content,metadata_json,created_at
                            FROM turn_events WHERE owner_user_id=:owner AND turn_id=:turn
                              AND seq>:after ORDER BY seq LIMIT :limit"""),
                    {
                        "owner": owner_user_id, "turn": turn_id,
                        "after": after, "limit": row_limit,
                    },
                )
            ).mappings().all()
        events = [
            {
                "turn_id": turn_id, "session_id": session_id,
                "seq": item["seq"], "type": item["type"],
                "source": item["source"], "stage": item["stage"],
                "content": item["content"], "metadata": item["metadata_json"],
                "timestamp": item["created_at"].timestamp(),
            }
            for item in rows
        ]
        last_loaded = events[-1]["seq"] if events else after
        complete = last_loaded >= int(stats["last_seq"])
        return {
            "session_id": session_id, "message_id": resolved_id,
            "turn_id": turn_id, "events": events,
            "total": int(stats["total"]), "last_seq": int(stats["last_seq"]),
            "next_seq": None if complete else last_loaded, "complete": complete,
        }

    async def link_turn_message(
        self, owner_user_id: str, turn_id: str, assistant_message_id: int
    ) -> bool:
        """Link a turn only to an assistant message in the same owned session."""
        async with self._sessions() as db:
            updated = (
                await db.execute(
                    text(
                        """UPDATE turns t SET assistant_message_id=:message,updated_at=now()
                           WHERE t.id=:turn AND t.owner_user_id=:owner
                             AND EXISTS (
                               SELECT 1 FROM messages m WHERE m.id=:message
                                 AND m.owner_user_id=t.owner_user_id
                                 AND m.session_id=t.session_id AND m.role='assistant'
                             ) RETURNING t.id"""
                    ),
                    {"owner": owner_user_id, "turn": turn_id, "message": assistant_message_id},
                )
            ).scalar_one_or_none()
            await db.commit()
            return updated is not None
