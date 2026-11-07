"""Synchronous, owner-bound Mastery aggregate operations for PostgreSQL.

This is the transaction boundary used by synchronous learning services.  It
does not select the application backend; callers must supply an authenticated
owner, and the remaining interaction/topic methods still need porting before
the application can switch to this store.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
import hashlib
import json
import time
from typing import Any, TypeVar
import uuid

import psycopg
from psycopg.types.json import Jsonb
from psycopg.rows import dict_row

from deeptutor.learning.models import (
    InteractionStatus, LearningEvidence, LearningProgress, MasteryEvent, MasteryInteraction,
    MasteryPathLease, MasteryTopic, TopicMetadata, TopicSource,
    ReadingActivityRecord, ReadingLearningRecords, ReadingProgressRecord,
)
from deeptutor.learning.storage import (
    LearningConflictError,
    LearningStoreError,
    PathLeaseConflictError,
    _ALLOWED_INTERACTION_TRANSITIONS,
)
from deeptutor.services.postgres.database import database_url

_T = TypeVar("_T")


class PostgresLearningTransaction:
    def __init__(
        self, conn: psycopg.Connection, owner_user_id: str,
        progress: LearningProgress, *, created: bool,
    ) -> None:
        self._conn = conn
        self._owner_user_id = owner_user_id
        self.progress = progress
        self.base_revision = int(progress.version)
        self.changed = created
        self._events: list[tuple[str, dict[str, Any], str, str]] = []
        if created:
            self.emit("path.created", {})

    def touch(self) -> None:
        self.changed = True

    def emit(
        self,
        event_type: str,
        payload: dict[str, Any] | None = None,
        *,
        session_id: str = "",
        turn_id: str = "",
    ) -> None:
        name = str(event_type or "").strip()
        if not name:
            raise ValueError("event_type must not be empty")
        self.changed = True
        self._events.append((name, dict(payload or {}), str(session_id or ""), str(turn_id or "")))

    @property
    def events(self) -> list[tuple[str, dict[str, Any], str, str]]:
        return list(self._events)

    @staticmethod
    def _interaction(row: dict[str, Any] | None) -> MasteryInteraction | None:
        if row is None:
            return None
        question = row["question_json"] or {}
        grouped = question.get("question_type") == "group"
        answer = row["user_answer"] or ""
        return MasteryInteraction(
            interaction_id=row["interaction_id"],
            path_id=row["path_id"],
            question=question,
            status=InteractionStatus(row["status"]),
            session_id=row["session_id"] or "",
            turn_id=row["turn_id"] or "",
            user_answer="" if grouped else answer,
            answers=json.loads(answer or "{}") if grouped else {},
            result=row["result_json"] or {},
            created_at=row["created_at"].timestamp(),
            updated_at=row["updated_at"].timestamp(),
        )

    def get_interaction(self, interaction_id: str) -> MasteryInteraction | None:
        row = self._conn.execute(
            """SELECT * FROM mastery_interactions
               WHERE interaction_id=%s AND path_id=%s AND owner_user_id=%s""",
            (str(interaction_id), self.progress.book_id, self._owner_user_id),
        ).fetchone()
        return self._interaction(row)

    def active_interaction(self) -> MasteryInteraction | None:
        row = self._conn.execute(
            """SELECT * FROM mastery_interactions
               WHERE path_id=%s AND owner_user_id=%s
                 AND status IN ('registered','awaiting_input','answered')
               ORDER BY created_at DESC,interaction_id DESC LIMIT 1""",
            (self.progress.book_id, self._owner_user_id),
        ).fetchone()
        return self._interaction(row)

    def put_interaction(self, interaction: MasteryInteraction) -> None:
        if interaction.path_id != self.progress.book_id:
            raise ValueError("interaction path_id does not match transaction path")
        existing = self._conn.execute(
            "SELECT path_id,status FROM mastery_interactions WHERE interaction_id=%s",
            (interaction.interaction_id,),
        ).fetchone()
        if existing is not None and existing["path_id"] != self.progress.book_id:
            raise ValueError("interaction_id already belongs to another path")
        if existing is not None:
            status = InteractionStatus(existing["status"])
            if interaction.status not in _ALLOWED_INTERACTION_TRANSITIONS[status]:
                raise LearningStoreError(
                    f"Invalid mastery interaction transition: {status.value} -> {interaction.status.value}"
                )
        now = time.time()
        question = interaction.question.model_dump(mode="json")
        answer = (
            json.dumps(interaction.answers, ensure_ascii=False)
            if interaction.question.questions else interaction.user_answer
        )
        result = self._conn.execute(
            """INSERT INTO mastery_interactions
               (interaction_id,owner_user_id,path_id,status,question_json,session_id,
                turn_id,user_answer,result_json,created_at,updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,to_timestamp(%s),to_timestamp(%s))
               ON CONFLICT (interaction_id) DO UPDATE SET
                 status=EXCLUDED.status, question_json=EXCLUDED.question_json,
                 session_id=EXCLUDED.session_id, turn_id=EXCLUDED.turn_id,
                 user_answer=EXCLUDED.user_answer, result_json=EXCLUDED.result_json,
                 updated_at=EXCLUDED.updated_at
               WHERE mastery_interactions.owner_user_id=EXCLUDED.owner_user_id
                 AND mastery_interactions.path_id=EXCLUDED.path_id
               RETURNING interaction_id""",
            (
                interaction.interaction_id, self._owner_user_id, self.progress.book_id,
                interaction.status.value, Jsonb(question), interaction.session_id,
                interaction.turn_id, answer, Jsonb(interaction.result),
                interaction.created_at, now,
            ),
        ).fetchone()
        if result is None:
            raise ValueError("interaction_id already belongs to another owner or path")
        interaction.updated_at = now
        self.touch()

    def abandon_active_interactions(self) -> int:
        result = self._conn.execute(
            """UPDATE mastery_interactions SET status='abandoned',updated_at=now()
               WHERE path_id=%s AND owner_user_id=%s
                 AND status IN ('registered','awaiting_input','answered')""",
            (self.progress.book_id, self._owner_user_id),
        )
        if result.rowcount:
            self.touch()
        return int(result.rowcount)

    def record_module_preview(self, payload: dict[str, Any], *, session_id: str) -> int:
        """Save a draft event without advancing the aggregate revision."""
        row = self._conn.execute(
            """INSERT INTO mastery_events
               (id,owner_user_id,path_id,revision,event_type,payload_json,session_id)
               VALUES (%s,%s,%s,%s,'path.modules_previewed',%s,%s)
               RETURNING event_seq""",
            (
                f"ev_{uuid.uuid4().hex}", self._owner_user_id, self.progress.book_id,
                self.base_revision, Jsonb(payload), session_id,
            ),
        ).fetchone()
        return int(row["event_seq"])

    def module_preview(self, preview_id: int, *, session_id: str) -> dict[str, Any]:
        if type(preview_id) is not int or preview_id < 1:
            raise ValueError("Use the integer preview_id returned by a successful preview.")
        row = self._conn.execute(
            """SELECT payload_json,created_at FROM mastery_events
               WHERE event_seq=%s AND owner_user_id=%s AND path_id=%s
                 AND session_id=%s AND event_type='path.modules_previewed'""",
            (preview_id, self._owner_user_id, self.progress.book_id, session_id),
        ).fetchone()
        if row is None:
            raise ValueError("Preview is unavailable in this path/session. Create a fresh preview.")
        applied = self._conn.execute(
            """SELECT revision FROM mastery_events
               WHERE owner_user_id=%s AND path_id=%s
                 AND event_type='path.modules_revision_committed'
                 AND payload_json->>'preview_id'=%s LIMIT 1""",
            (self._owner_user_id, self.progress.book_id, str(preview_id)),
        ).fetchone()
        if applied is None and time.time() - row["created_at"].timestamp() > 3600:
            raise ValueError("Preview expired. Create and review a fresh preview before committing.")
        return {
            **row["payload_json"],
            "committed_revision": int(applied["revision"]) if applied else None,
        }

    @staticmethod
    def _source(row: dict[str, Any]) -> TopicSource:
        return TopicSource(
            id=row["source_id"], kind=row["kind"],
            source_id=row["external_id"] or "", label=row["label"],
            excerpt=row["excerpt"] or "", position=int(row["position"]),
            available=bool(row["available"]), metadata=row["metadata_json"] or {},
            created_at=row["created_at"].timestamp(),
        )

    def put_topic(self, metadata: TopicMetadata, sources: list[TopicSource]) -> None:
        if metadata.path_id != self.progress.book_id:
            raise ValueError("topic metadata path_id does not match transaction path")
        now = time.time()
        self._conn.execute(
            """INSERT INTO mastery_topic_meta
               (path_id,owner_user_id,goal,description,emoji,map_seed,status,created_at,updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,to_timestamp(%s),to_timestamp(%s))
               ON CONFLICT (path_id) DO UPDATE SET
                 goal=EXCLUDED.goal,description=EXCLUDED.description,
                 emoji=EXCLUDED.emoji,map_seed=EXCLUDED.map_seed,
                 status=EXCLUDED.status,updated_at=EXCLUDED.updated_at
               WHERE mastery_topic_meta.owner_user_id=EXCLUDED.owner_user_id""",
            (
                metadata.path_id, self._owner_user_id, metadata.goal,
                metadata.description, metadata.emoji, int(metadata.map_seed),
                metadata.status, metadata.created_at, now,
            ),
        )
        self._conn.execute(
            "DELETE FROM mastery_topic_sources WHERE path_id=%s AND owner_user_id=%s",
            (metadata.path_id, self._owner_user_id),
        )
        for position, source in enumerate(sorted(sources, key=lambda item: item.position)):
            self._conn.execute(
                """INSERT INTO mastery_topic_sources
                   (source_id,path_id,owner_user_id,kind,external_id,label,excerpt,
                    position,available,metadata_json,created_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,to_timestamp(%s))""",
                (
                    source.id, metadata.path_id, self._owner_user_id,
                    source.kind.value, source.source_id, source.label, source.excerpt,
                    position, source.available, Jsonb(source.metadata), source.created_at,
                ),
            )
        metadata.updated_at = now
        self.touch()
        self.emit("topic.updated", {"source_count": len(sources), "status": metadata.status})

    def topic_sources(self) -> list[TopicSource]:
        rows = self._conn.execute(
            """SELECT * FROM mastery_topic_sources
               WHERE path_id=%s AND owner_user_id=%s
               ORDER BY position,created_at""",
            (self.progress.book_id, self._owner_user_id),
        ).fetchall()
        return [self._source(row) for row in rows]


class PostgresLearningStore:
    def __init__(self, owner_user_id: str, *, url: str | None = None) -> None:
        if not owner_user_id:
            raise ValueError("PostgreSQL Mastery store requires an authenticated owner")
        self.owner_user_id = owner_user_id
        raw_url = url or database_url()
        self._url = raw_url.replace("postgresql+asyncpg://", "postgresql://", 1)
        self.event_scope = f"postgres:{owner_user_id}"

    @contextmanager
    def _connection(self) -> Iterator[psycopg.Connection]:
        with psycopg.connect(self._url, row_factory=dict_row) as conn:
            conn.execute("SELECT set_config('app.user_id', %s, true)", (self.owner_user_id,))
            yield conn

    @staticmethod
    def _validate_id(path_id: str) -> str:
        from deeptutor.learning.storage import LearningStore

        return LearningStore._validate_id(path_id)

    @staticmethod
    def _progress(row: dict[str, Any]) -> LearningProgress:
        state = row["state_json"]
        progress = LearningProgress.model_validate(state)
        progress.version = int(row["revision"])
        progress.updated_at = row["updated_at"].timestamp()
        return progress

    @staticmethod
    def _payload(progress: LearningProgress, revision: int, updated_at: float) -> dict[str, Any]:
        persisted = progress.model_copy(deep=True)
        persisted.version = revision
        persisted.updated_at = updated_at
        return persisted.model_dump(mode="json")

    @staticmethod
    def _insert_events(
        conn: psycopg.Connection,
        owner: str,
        path_id: str,
        revision: int,
        events: list[tuple[str, dict[str, Any], str, str]],
    ) -> None:
        for event_type, payload, session_id, turn_id in events:
            conn.execute(
                """INSERT INTO mastery_events
                   (id,owner_user_id,path_id,revision,event_type,payload_json,session_id,turn_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    f"ev_{uuid.uuid4().hex}", owner, path_id, revision,
                    event_type, Jsonb(payload), session_id, turn_id,
                ),
            )

    @staticmethod
    def _sync_evidence_projection(
        conn: psycopg.Connection,
        owner: str,
        path_id: str,
        progress: LearningProgress,
        previous: list[dict[str, Any]],
    ) -> None:
        for ordinal, evidence in enumerate(progress.learning_evidence):
            payload = evidence.model_dump(mode="json")
            if ordinal < len(previous) and previous[ordinal] == payload:
                continue
            conn.execute(
                """INSERT INTO mastery_learning_evidence
                   (owner_user_id,path_id,ordinal,knowledge_point_id,timestamp,
                    source,assessment_type,result,quality,session_id,turn_id,evidence_json)
                   VALUES (%s,%s,%s,%s,to_timestamp(%s),%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (path_id,ordinal) DO UPDATE SET
                     knowledge_point_id=EXCLUDED.knowledge_point_id,
                     timestamp=EXCLUDED.timestamp,source=EXCLUDED.source,
                     assessment_type=EXCLUDED.assessment_type,result=EXCLUDED.result,
                     quality=EXCLUDED.quality,session_id=EXCLUDED.session_id,
                     turn_id=EXCLUDED.turn_id,evidence_json=EXCLUDED.evidence_json
                   WHERE mastery_learning_evidence.owner_user_id=EXCLUDED.owner_user_id""",
                (
                    owner, path_id, ordinal, evidence.knowledge_point_id,
                    evidence.timestamp, evidence.source, evidence.assessment_type,
                    evidence.result, evidence.quality, evidence.session_id,
                    evidence.turn_id, Jsonb(payload),
                ),
            )
        if len(previous) > len(progress.learning_evidence):
            conn.execute(
                """DELETE FROM mastery_learning_evidence
                   WHERE path_id=%s AND owner_user_id=%s AND ordinal>=%s""",
                (path_id, owner, len(progress.learning_evidence)),
            )

    def load(self, book_id: str) -> LearningProgress | None:
        path_id = self._validate_id(book_id)
        with self._connection() as conn:
            row = conn.execute(
                """SELECT revision,state_json,updated_at FROM mastery_paths
                   WHERE path_id=%s AND owner_user_id=%s""",
                (path_id, self.owner_user_id),
            ).fetchone()
        return self._progress(row) if row else None

    def exists(self, book_id: str) -> bool:
        return self.load(book_id) is not None

    def list_all(self) -> list[str]:
        with self._connection() as conn:
            rows = conn.execute(
                "SELECT path_id FROM mastery_paths WHERE owner_user_id=%s ORDER BY updated_at DESC",
                (self.owner_user_id,),
            ).fetchall()
        return [row["path_id"] for row in rows]

    @contextmanager
    def transaction(self, book_id: str, *, create: bool = False) -> Iterator[PostgresLearningTransaction]:
        path_id = self._validate_id(book_id)
        committed: tuple[int, str] | None = None
        with self._connection() as conn:
            created = False
            if create:
                initial = LearningProgress(book_id=path_id)
                inserted = conn.execute(
                    """INSERT INTO mastery_paths (path_id,owner_user_id,revision,state_json)
                       VALUES (%s,%s,0,%s) ON CONFLICT (path_id) DO NOTHING
                       RETURNING path_id""",
                    (path_id, self.owner_user_id, Jsonb(self._payload(initial, 0, initial.updated_at))),
                ).fetchone()
                created = inserted is not None
            row = conn.execute(
                """SELECT revision,state_json,updated_at FROM mastery_paths
                   WHERE path_id=%s AND owner_user_id=%s FOR UPDATE""",
                (path_id, self.owner_user_id),
            ).fetchone()
            if row is None:
                raise KeyError(path_id)
            tx = PostgresLearningTransaction(
                conn, self.owner_user_id, self._progress(row), created=created
            )
            yield tx
            if tx.changed:
                now = time.time()
                revision = tx.base_revision + 1
                updated = conn.execute(
                    """UPDATE mastery_paths SET revision=%s,state_json=%s,updated_at=to_timestamp(%s)
                       WHERE path_id=%s AND owner_user_id=%s AND revision=%s
                       RETURNING revision""",
                    (
                        revision, Jsonb(self._payload(tx.progress, revision, now)), now,
                        path_id, self.owner_user_id, tx.base_revision,
                    ),
                ).fetchone()
                if updated is None:
                    raise LearningConflictError(path_id, tx.base_revision, -1)
                self._sync_evidence_projection(
                    conn, self.owner_user_id, path_id, tx.progress,
                    row["state_json"].get("learning_evidence", []),
                )
                self._insert_events(conn, self.owner_user_id, path_id, revision, tx.events)
                tx.progress.version = revision
                tx.progress.updated_at = now
                committed = (revision, tx.events[-1][0] if tx.events else "topic.changed")
        if committed is not None:
            from deeptutor.learning.event_hub import publish_topic_signal

            publish_topic_signal(path_id, committed[0], committed[1], scope=self.event_scope)

    def mutate(
        self, book_id: str, mutation: Callable[[PostgresLearningTransaction], _T], *, create: bool = False
    ) -> tuple[LearningProgress, _T]:
        with self.transaction(book_id, create=create) as tx:
            result = mutation(tx)
        return tx.progress, result

    def save(self, progress: LearningProgress) -> None:
        path_id = self._validate_id(progress.book_id)
        expected = int(progress.version)
        with self.transaction(path_id, create=expected == 0) as tx:
            if tx.base_revision != expected:
                raise LearningConflictError(path_id, expected, tx.base_revision)
            tx.progress = progress
            if tx.base_revision != 0:
                tx.emit("path.saved", {})

    def delete(self, book_id: str) -> None:
        path_id = self._validate_id(book_id)
        with self._connection() as conn:
            conn.execute(
                "DELETE FROM mastery_paths WHERE path_id=%s AND owner_user_id=%s",
                (path_id, self.owner_user_id),
            )

    def get_interaction(self, path_id: str, interaction_id: str) -> MasteryInteraction | None:
        path_id = self._validate_id(path_id)
        with self._connection() as conn:
            row = conn.execute(
                """SELECT * FROM mastery_interactions
                   WHERE path_id=%s AND owner_user_id=%s AND interaction_id=%s""",
                (path_id, self.owner_user_id, str(interaction_id)),
            ).fetchone()
        return PostgresLearningTransaction._interaction(row)

    def get_active_interaction(self, path_id: str) -> MasteryInteraction | None:
        path_id = self._validate_id(path_id)
        with self._connection() as conn:
            row = conn.execute(
                """SELECT * FROM mastery_interactions
                   WHERE path_id=%s AND owner_user_id=%s
                     AND status IN ('registered','awaiting_input','answered')
                   ORDER BY created_at DESC,interaction_id DESC LIMIT 1""",
                (path_id, self.owner_user_id),
            ).fetchone()
        return PostgresLearningTransaction._interaction(row)

    def list_interactions(self, path_id: str, *, limit: int = 200) -> list[MasteryInteraction]:
        path_id = self._validate_id(path_id)
        with self._connection() as conn:
            rows = conn.execute(
                """SELECT * FROM mastery_interactions
                   WHERE path_id=%s AND owner_user_id=%s
                   ORDER BY created_at DESC,interaction_id DESC LIMIT %s""",
                (path_id, self.owner_user_id, max(1, int(limit))),
            ).fetchall()
        return [PostgresLearningTransaction._interaction(row) for row in rows]

    def list_events(self, path_id: str, *, after_revision: int = 0) -> list[MasteryEvent]:
        path_id = self._validate_id(path_id)
        with self._connection() as conn:
            rows = conn.execute(
                """SELECT event_seq,path_id,revision,event_type,payload_json,
                          session_id,turn_id,created_at FROM mastery_events
                   WHERE path_id=%s AND owner_user_id=%s AND revision>%s
                   ORDER BY revision,event_seq""",
                (path_id, self.owner_user_id, max(0, int(after_revision))),
            ).fetchall()
        return [
            MasteryEvent(
                id=row["event_seq"], path_id=row["path_id"], revision=row["revision"],
                event_type=row["event_type"], payload=row["payload_json"] or {},
                session_id=row["session_id"] or "", turn_id=row["turn_id"] or "",
                created_at=row["created_at"].timestamp(),
            )
            for row in rows
        ]

    @staticmethod
    def _default_map_seed(path_id: str) -> int:
        return int.from_bytes(hashlib.sha256(path_id.encode("utf-8")).digest()[:4], "big")

    def put_topic(self, metadata: TopicMetadata, sources: list[TopicSource]) -> MasteryTopic:
        path_id = self._validate_id(metadata.path_id)
        normalized = metadata.model_copy(deep=True)
        normalized.path_id = path_id
        if normalized.map_seed == 0:
            normalized.map_seed = self._default_map_seed(path_id)
        ordered = [source.model_copy(deep=True) for source in sources]
        for index, source in enumerate(ordered):
            source.position = index
        with self.transaction(path_id) as tx:
            tx.put_topic(normalized, ordered)
        topic = self.get_topic(path_id)
        if topic is None:
            raise LearningStoreError(f"Failed to persist topic {path_id!r}")
        return topic

    def get_topic(
        self, path_id: str, *, progress: LearningProgress | None = None
    ) -> MasteryTopic | None:
        path_id = self._validate_id(path_id)
        if progress is None:
            progress = self.load(path_id)
        elif progress.book_id != path_id:
            raise ValueError("progress does not belong to the requested topic")
        if progress is None:
            return None
        with self._connection() as conn:
            meta = conn.execute(
                """SELECT * FROM mastery_topic_meta
                   WHERE path_id=%s AND owner_user_id=%s""",
                (path_id, self.owner_user_id),
            ).fetchone()
            rows = conn.execute(
                """SELECT * FROM mastery_topic_sources
                   WHERE path_id=%s AND owner_user_id=%s ORDER BY position,created_at""",
                (path_id, self.owner_user_id),
            ).fetchall()
        return self._topic_from_rows(path_id, progress, meta, rows)

    def _topic_from_rows(
        self,
        path_id: str,
        progress: LearningProgress,
        meta: dict[str, Any] | None,
        rows: list[dict[str, Any]],
    ) -> MasteryTopic:
        if meta is None:
            metadata = TopicMetadata(
                path_id=path_id, map_seed=self._default_map_seed(path_id),
                created_at=progress.created_at, updated_at=progress.updated_at,
            )
        else:
            metadata = TopicMetadata(
                path_id=path_id, goal=meta["goal"] or "",
                description=meta["description"] or "", emoji=meta["emoji"] or "🧭",
                map_seed=int(meta["map_seed"] or self._default_map_seed(path_id)),
                status=meta["status"] or "active",
                created_at=meta["created_at"].timestamp(),
                updated_at=meta["updated_at"].timestamp(),
            )
        return MasteryTopic(
            metadata=metadata,
            sources=[PostgresLearningTransaction._source(row) for row in rows],
        )

    def list_topic_snapshots(
        self, *, status: str = "active"
    ) -> list[tuple[LearningProgress, MasteryTopic, int, MasteryInteraction | None]]:
        with self._connection() as conn:
            paths = conn.execute(
                """SELECT p.path_id,p.revision,p.state_json,p.updated_at,
                          m.goal,m.description,m.emoji,m.map_seed,m.status,
                          m.created_at AS meta_created_at,m.updated_at AS meta_updated_at
                   FROM mastery_paths p JOIN mastery_topic_meta m ON m.path_id=p.path_id
                   WHERE p.owner_user_id=%s AND m.owner_user_id=%s AND m.status=%s
                   ORDER BY p.updated_at DESC,p.path_id""",
                (self.owner_user_id, self.owner_user_id, status),
            ).fetchall()
            if not paths:
                return []
            source_rows = conn.execute(
                """SELECT s.* FROM mastery_topic_sources s
                   JOIN mastery_topic_meta m ON m.path_id=s.path_id
                   WHERE s.owner_user_id=%s AND m.owner_user_id=%s AND m.status=%s
                   ORDER BY s.path_id,s.position,s.created_at""",
                (self.owner_user_id, self.owner_user_id, status),
            ).fetchall()
            counts = conn.execute(
                """SELECT b.path_id,count(*) AS session_count
                   FROM mastery_path_sessions b JOIN mastery_topic_meta m ON m.path_id=b.path_id
                   WHERE b.owner_user_id=%s AND m.owner_user_id=%s AND m.status=%s
                   GROUP BY b.path_id""",
                (self.owner_user_id, self.owner_user_id, status),
            ).fetchall()
            active_rows = conn.execute(
                """SELECT i.* FROM mastery_interactions i
                   JOIN mastery_topic_meta m ON m.path_id=i.path_id
                   WHERE i.owner_user_id=%s AND m.owner_user_id=%s AND m.status=%s
                     AND i.status IN ('registered','awaiting_input','answered')""",
                (self.owner_user_id, self.owner_user_id, status),
            ).fetchall()
        sources: dict[str, list[dict[str, Any]]] = {}
        for row in source_rows:
            sources.setdefault(row["path_id"], []).append(row)
        session_counts = {row["path_id"]: int(row["session_count"]) for row in counts}
        active = {row["path_id"]: row for row in active_rows}
        result = []
        for row in paths:
            path_id = row["path_id"]
            progress = self._progress(row)
            meta = {
                **row,
                "created_at": row["meta_created_at"],
                "updated_at": row["meta_updated_at"],
            }
            result.append((
                progress,
                self._topic_from_rows(path_id, progress, meta, sources.get(path_id, [])),
                session_counts.get(path_id, 0),
                PostgresLearningTransaction._interaction(active.get(path_id)),
            ))
        return result

    def has_active_topics(self) -> bool:
        with self._connection() as conn:
            return conn.execute(
                """SELECT EXISTS (
                     SELECT 1 FROM mastery_topic_meta
                     WHERE owner_user_id=%s AND status='active'
                   ) AS active""",
                (self.owner_user_id,),
            ).fetchone()["active"]

    def list_learning_evidence(
        self,
        book_id: str,
        knowledge_point_id: str | None = None,
        *,
        limit: int | None = None,
    ) -> list[LearningEvidence]:
        path_id = self._validate_id(book_id)
        query = (
            "SELECT evidence_json FROM mastery_learning_evidence "
            "WHERE owner_user_id=%s AND path_id=%s"
        )
        params: list[Any] = [self.owner_user_id, path_id]
        if knowledge_point_id:
            query += " AND knowledge_point_id=%s"
            params.append(str(knowledge_point_id))
        query += " ORDER BY ordinal DESC"
        if limit is not None:
            query += " LIMIT %s"
            params.append(max(1, min(int(limit), 1000)))
        with self._connection() as conn:
            rows = conn.execute(query, params).fetchall()
        return [LearningEvidence.model_validate(row["evidence_json"]) for row in rows]

    def count_learning_evidence(
        self, book_id: str, knowledge_point_id: str | None = None
    ) -> int:
        path_id = self._validate_id(book_id)
        query = (
            "SELECT count(*) AS n FROM mastery_learning_evidence "
            "WHERE owner_user_id=%s AND path_id=%s"
        )
        params: list[Any] = [self.owner_user_id, path_id]
        if knowledge_point_id:
            query += " AND knowledge_point_id=%s"
            params.append(str(knowledge_point_id))
        with self._connection() as conn:
            return int(conn.execute(query, params).fetchone()["n"])

    def load_with_learning_evidence(
        self, book_id: str, knowledge_point_id: str, *, limit: int = 20
    ) -> tuple[LearningProgress | None, list[LearningEvidence], int]:
        path_id = self._validate_id(book_id)
        bounded = max(1, min(int(limit), 1000))
        with self._connection() as conn:
            row = conn.execute(
                """SELECT revision,state_json,updated_at FROM mastery_paths
                   WHERE path_id=%s AND owner_user_id=%s""",
                (path_id, self.owner_user_id),
            ).fetchone()
            if row is None:
                return None, [], 0
            evidence = conn.execute(
                """SELECT evidence_json FROM mastery_learning_evidence
                   WHERE owner_user_id=%s AND path_id=%s AND knowledge_point_id=%s
                   ORDER BY ordinal DESC LIMIT %s""",
                (self.owner_user_id, path_id, str(knowledge_point_id), bounded),
            ).fetchall()
            count = conn.execute(
                """SELECT count(*) AS n FROM mastery_learning_evidence
                   WHERE owner_user_id=%s AND path_id=%s AND knowledge_point_id=%s""",
                (self.owner_user_id, path_id, str(knowledge_point_id)),
            ).fetchone()["n"]
        return (
            self._progress(row),
            [LearningEvidence.model_validate(item["evidence_json"]) for item in evidence],
            int(count),
        )

    def rebuild_learning_evidence_projection(self, book_id: str) -> None:
        path_id = self._validate_id(book_id)
        with self._connection() as conn:
            row = conn.execute(
                """SELECT revision,state_json,updated_at FROM mastery_paths
                   WHERE path_id=%s AND owner_user_id=%s FOR UPDATE""",
                (path_id, self.owner_user_id),
            ).fetchone()
            if row is None:
                raise KeyError(path_id)
            progress = self._progress(row)
            conn.execute(
                """DELETE FROM mastery_learning_evidence
                   WHERE path_id=%s AND owner_user_id=%s""",
                (path_id, self.owner_user_id),
            )
            self._sync_evidence_projection(
                conn, self.owner_user_id, path_id, progress, []
            )

    def bind_session(self, path_id: str, session_id: str, *, owns_path: bool = False) -> None:
        path_id = self._validate_id(path_id)
        session_id = str(session_id or "").strip()
        if not session_id:
            raise ValueError("session_id must not be empty")
        released_path = ""
        released_revision = 0
        with self._connection() as conn:
            session = conn.execute(
                "SELECT id FROM sessions WHERE id=%s AND owner_user_id=%s FOR UPDATE",
                (session_id, self.owner_user_id),
            ).fetchone()
            if session is None:
                raise KeyError(session_id)
            previous = conn.execute(
                """SELECT path_id FROM mastery_path_sessions
                   WHERE owner_user_id=%s AND session_id=%s""",
                (self.owner_user_id, session_id),
            ).fetchone()
            if previous is not None and previous["path_id"] != path_id:
                released_path = previous["path_id"]
                conn.execute(
                    """DELETE FROM mastery_path_sessions
                       WHERE owner_user_id=%s AND session_id=%s""",
                    (self.owner_user_id, session_id),
                )
                old = conn.execute(
                    """SELECT revision FROM mastery_paths
                       WHERE owner_user_id=%s AND path_id=%s""",
                    (self.owner_user_id, released_path),
                ).fetchone()
                released_revision = int(old["revision"]) if old else 0
            initial = LearningProgress(book_id=path_id)
            initial.version = 1
            created = conn.execute(
                """INSERT INTO mastery_paths
                   (path_id,owner_user_id,revision,state_json,owner_session_id)
                   VALUES (%s,%s,1,%s,%s) ON CONFLICT (path_id) DO NOTHING
                   RETURNING path_id""",
                (
                    path_id, self.owner_user_id,
                    Jsonb(self._payload(initial, 1, time.time())),
                    session_id if owns_path else "",
                ),
            ).fetchone()
            if created is not None:
                self._insert_events(
                    conn, self.owner_user_id, path_id, 1,
                    [("path.created", {}, "", "")],
                )
            if owns_path:
                conn.execute(
                    """UPDATE mastery_paths SET owner_session_id=%s
                       WHERE path_id=%s AND owner_user_id=%s AND owner_session_id=''""",
                    (session_id, path_id, self.owner_user_id),
                )
            current = conn.execute(
                """SELECT revision FROM mastery_paths
                   WHERE path_id=%s AND owner_user_id=%s""",
                (path_id, self.owner_user_id),
            ).fetchone()
            if current is None:
                raise KeyError(path_id)
            conn.execute(
                """INSERT INTO mastery_path_sessions (owner_user_id,path_id,session_id)
                   VALUES (%s,%s,%s)
                   ON CONFLICT (owner_user_id,path_id,session_id)
                   DO UPDATE SET last_seen_at=now()""",
                (self.owner_user_id, path_id, session_id),
            )
            revision = int(current["revision"])
        from deeptutor.learning.event_hub import publish_topic_signal

        publish_topic_signal(path_id, revision, "session.bound", scope=self.event_scope)
        if released_path:
            publish_topic_signal(
                released_path, released_revision, "session.released", scope=self.event_scope
            )

    def list_session_ids(self, path_id: str) -> list[str]:
        path_id = self._validate_id(path_id)
        with self._connection() as conn:
            rows = conn.execute(
                """SELECT session_id FROM mastery_path_sessions
                   WHERE owner_user_id=%s AND path_id=%s
                   ORDER BY last_seen_at DESC,session_id""",
                (self.owner_user_id, path_id),
            ).fetchall()
        return [row["session_id"] for row in rows]

    def path_id_for_session(self, session_id: str) -> str:
        session_id = str(session_id or "").strip()
        if not session_id:
            return ""
        with self._connection() as conn:
            row = conn.execute(
                """SELECT path_id FROM mastery_path_sessions
                   WHERE owner_user_id=%s AND session_id=%s""",
                (self.owner_user_id, session_id),
            ).fetchone()
        return row["path_id"] if row else ""

    @staticmethod
    def _is_scratch_state(state: dict[str, Any]) -> bool:
        modules = state.get("modules") if isinstance(state, dict) else None
        if not isinstance(modules, list):
            return True
        return not any(
            isinstance(module, dict) and module.get("knowledge_points") for module in modules
        )

    def detach_session(
        self, session_id: str, *, delete_owned_orphans: bool = True
    ) -> list[str]:
        session_id = str(session_id or "").strip()
        if not session_id:
            return []
        deleted: list[str] = []
        with self._connection() as conn:
            owned = conn.execute(
                """SELECT path_id,state_json FROM mastery_paths
                   WHERE owner_user_id=%s AND
                     (owner_session_id=%s OR (owner_session_id='' AND path_id=%s))
                   FOR UPDATE""",
                (self.owner_user_id, session_id, session_id),
            ).fetchall()
            conn.execute(
                """DELETE FROM mastery_path_leases
                   WHERE owner_user_id=%s AND session_id=%s""",
                (self.owner_user_id, session_id),
            )
            conn.execute(
                """DELETE FROM mastery_path_sessions
                   WHERE owner_user_id=%s AND session_id=%s""",
                (self.owner_user_id, session_id),
            )
            if delete_owned_orphans:
                for row in owned:
                    if not self._is_scratch_state(row["state_json"]):
                        continue
                    remaining = conn.execute(
                        """SELECT 1 FROM mastery_path_sessions
                           WHERE owner_user_id=%s AND path_id=%s LIMIT 1""",
                        (self.owner_user_id, row["path_id"]),
                    ).fetchone()
                    if remaining is None:
                        conn.execute(
                            """DELETE FROM mastery_paths
                               WHERE owner_user_id=%s AND path_id=%s""",
                            (self.owner_user_id, row["path_id"]),
                        )
                        deleted.append(row["path_id"])
        return deleted

    @staticmethod
    def _lease(row: dict[str, Any] | None) -> MasteryPathLease | None:
        if row is None:
            return None
        return MasteryPathLease(
            path_id=row["path_id"], session_id=row["session_id"],
            turn_id=row["turn_id"], acquired_at=row["acquired_at"].timestamp(),
        )

    def get_path_lease(self, path_id: str) -> MasteryPathLease | None:
        path_id = self._validate_id(path_id)
        with self._connection() as conn:
            row = conn.execute(
                """SELECT path_id,session_id,turn_id,acquired_at
                   FROM mastery_path_leases WHERE owner_user_id=%s AND path_id=%s""",
                (self.owner_user_id, path_id),
            ).fetchone()
        return self._lease(row)

    def acquire_path_lease(
        self, path_id: str, session_id: str, turn_id: str, *, bind_session: bool = True
    ) -> MasteryPathLease:
        path_id = self._validate_id(path_id)
        session_id = str(session_id or "").strip()
        turn_id = str(turn_id or "").strip()
        if not session_id or not turn_id:
            raise ValueError("session_id and turn_id are required for a path lease")
        if bind_session:
            self.bind_session(path_id, session_id)
        else:
            with self.transaction(path_id, create=True):
                pass
        with self._connection() as conn:
            acquired = conn.execute(
                """INSERT INTO mastery_path_leases
                   (owner_user_id,path_id,session_id,turn_id)
                   VALUES (%s,%s,%s,%s)
                   ON CONFLICT (path_id) DO UPDATE SET
                     session_id=EXCLUDED.session_id,
                     acquired_at=now()
                   WHERE mastery_path_leases.owner_user_id=EXCLUDED.owner_user_id
                     AND mastery_path_leases.turn_id=EXCLUDED.turn_id
                   RETURNING path_id,session_id,turn_id,acquired_at""",
                (self.owner_user_id, path_id, session_id, turn_id),
            ).fetchone()
            if acquired is None:
                existing = conn.execute(
                    """SELECT path_id,session_id,turn_id,acquired_at
                       FROM mastery_path_leases WHERE owner_user_id=%s AND path_id=%s""",
                    (self.owner_user_id, path_id),
                ).fetchone()
                if existing is None:
                    raise KeyError(path_id)
                raise PathLeaseConflictError(self._lease(existing))
        return self._lease(acquired)

    def release_leases_for_turn(self, turn_id: str) -> str:
        turn_id = str(turn_id or "").strip()
        if not turn_id:
            return ""
        with self._connection() as conn:
            row = conn.execute(
                """DELETE FROM mastery_path_leases
                   WHERE owner_user_id=%s AND turn_id=%s RETURNING path_id""",
                (self.owner_user_id, turn_id),
            ).fetchone()
        return row["path_id"] if row else ""

    def release_path_lease(self, path_id: str, *, turn_id: str | None = None) -> bool:
        path_id = self._validate_id(path_id)
        query = (
            "DELETE FROM mastery_path_leases "
            "WHERE owner_user_id=%s AND path_id=%s"
        )
        params: list[str] = [self.owner_user_id, path_id]
        if turn_id:
            query += " AND turn_id=%s"
            params.append(str(turn_id))
        with self._connection() as conn:
            result = conn.execute(query, params)
            return bool(result.rowcount)

    @staticmethod
    def _reading_progress(row: dict[str, Any]) -> ReadingProgressRecord:
        return ReadingProgressRecord(
            material_id=row["material_id"], latest_locator=row["latest_locator"],
            latest_percentage=row["latest_percentage"],
            furthest_locator=row["furthest_locator"],
            furthest_percentage=row["furthest_percentage"],
            updated_at=row["updated_at"].timestamp(),
        )

    @staticmethod
    def _reading_activity(row: dict[str, Any]) -> ReadingActivityRecord:
        return ReadingActivityRecord(
            activity_id=row["activity_id"], material_id=row["material_id"],
            extension_id=row["extension_id"], action=row["action"],
            locator=row["locator"], result_type=row["result_type"],
            created_at=row["created_at"].timestamp(),
        )

    def record_reading_position(
        self, material_id: str, *, locator: int, percentage: float
    ) -> ReadingProgressRecord:
        material_id = self._validate_id(material_id)
        candidate = ReadingProgressRecord(
            material_id=material_id, latest_locator=int(locator),
            latest_percentage=float(percentage), furthest_locator=int(locator),
            furthest_percentage=float(percentage),
        )
        with self._connection() as conn:
            row = conn.execute(
                """INSERT INTO reading_learning_progress
                   (owner_user_id,material_id,latest_locator,latest_percentage,
                    furthest_locator,furthest_percentage,updated_at)
                   VALUES (%s,%s,%s,%s,%s,%s,now())
                   ON CONFLICT (owner_user_id,material_id) DO UPDATE SET
                     latest_locator=EXCLUDED.latest_locator,
                     latest_percentage=EXCLUDED.latest_percentage,
                     furthest_locator=GREATEST(
                       reading_learning_progress.furthest_locator,EXCLUDED.furthest_locator),
                     furthest_percentage=GREATEST(
                       reading_learning_progress.furthest_percentage,EXCLUDED.furthest_percentage),
                     updated_at=now()
                   RETURNING *""",
                (
                    self.owner_user_id, material_id, candidate.latest_locator,
                    candidate.latest_percentage, candidate.furthest_locator,
                    candidate.furthest_percentage,
                ),
            ).fetchone()
        return self._reading_progress(row)

    def record_reading_activity(
        self,
        material_id: str,
        *,
        extension_id: str,
        action: str,
        locator: int,
        result_type: str,
    ) -> ReadingActivityRecord:
        material_id = self._validate_id(material_id)
        extension_id = str(extension_id or "").strip()
        action = str(action or "").strip()
        if not extension_id or len(extension_id) > 64:
            raise ValueError("extension_id must contain 1 to 64 characters")
        if not action or len(action) > 64:
            raise ValueError("action must contain 1 to 64 characters")
        candidate = ReadingActivityRecord(
            activity_id=f"racc_{uuid.uuid4().hex}", material_id=material_id,
            extension_id=extension_id, action=action, locator=int(locator),
            result_type=result_type,
        )
        with self._connection() as conn:
            row = conn.execute(
                """INSERT INTO reading_learning_activities
                   (activity_id,owner_user_id,material_id,extension_id,action,
                    locator,result_type,created_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,now()) RETURNING *""",
                (
                    candidate.activity_id, self.owner_user_id, material_id,
                    extension_id, action, candidate.locator, candidate.result_type,
                ),
            ).fetchone()
        return self._reading_activity(row)

    def list_reading_records(self, *, activity_limit: int = 200) -> ReadingLearningRecords:
        bounded = max(1, min(int(activity_limit), 500))
        with self._connection() as conn:
            progress = conn.execute(
                """SELECT * FROM reading_learning_progress WHERE owner_user_id=%s
                   ORDER BY updated_at DESC,material_id""",
                (self.owner_user_id,),
            ).fetchall()
            activities = conn.execute(
                """SELECT * FROM reading_learning_activities WHERE owner_user_id=%s
                   ORDER BY created_at DESC,activity_id DESC LIMIT %s""",
                (self.owner_user_id, bounded),
            ).fetchall()
        return ReadingLearningRecords(
            progress=[self._reading_progress(row) for row in progress],
            activities=[self._reading_activity(row) for row in activities],
        )
