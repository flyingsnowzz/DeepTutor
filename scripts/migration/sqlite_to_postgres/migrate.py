#!/usr/bin/env python3
"""One-time SQLite -> PostgreSQL migration for legacy DeepTutor workspaces.

Sources (per DEEPTUTOR_HOME, default ``data/user``):

* ``chat_history.db``: sessions / turns / turn_events / notebook_entries
  (practice entries) + practice_review_state / practice_review_events
* ``workspace/learning/mastery/mastery.sqlite3``: mastery paths, interactions
  and events.
* ``usage.sqlite3``: per-call LLM accounting.
* ``runtime_state/task-board/tasks.sqlite``: account task board.
* ``.runtime/calendar/calendar.sqlite``: account calendars, events and undo state.
* optional ``--cron-db``: process-wide scheduled jobs.
* ``workspace/reading/_catalog.sqlite3``: default reading catalog metadata.
* ``.runtime/workspaces.sqlite3``: built-in workspace identities; custom
  workspaces require an explicit content-location migration before import.

Design:

* Idempotent: every row uses a deterministic legacy id and upserts, so the
  command can be rerun safely after fixing data or code.
* One Postgres owner per source path (``--owner`` or a stable
  ``legacy_<hash>`` derived from the source path).
* Every run records a row in ``migration_batches`` (source path, sha256,
  per-table counts) for audit and account-level reconciliation via
  ``--check``.
* Orphan child rows (turn without session, event without turn, mastery child
  without path) are skipped and reported instead of violating FKs.

Usage::

    DATABASE_URL=postgresql+asyncpg://... python migrate.py --dry-run
    DATABASE_URL=postgresql+asyncpg://... python migrate.py --execute --check
"""

from __future__ import annotations

import argparse
import asyncio
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from typing import Any
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

DEFAULT_HOME = Path(os.environ.get("DEEPTUTOR_HOME", "data/user"))

CHAT_TABLES = (
    "sessions", "messages", "turns", "turn_events", "turn_submissions",
    "practice_entries", "practice_reviews", "assessment_cards",
    "assessment_attempts", "notebook_categories", "notebook_entry_categories",
    "notebook_practice_state", "notebook_practice_events", "notebook_practice_imports",
    "reading_quiz_pending", "reading_quiz_rewards",
)
MASTERY_TABLES = (
    "mastery_paths", "mastery_interactions", "mastery_events", "mastery_path_sessions",
    "mastery_topic_meta", "mastery_topic_sources", "mastery_learning_evidence",
    "reading_learning_progress", "reading_learning_activities",
)
USAGE_TABLES = ("llm_call_ledger",)
BOARD_TABLES = ("task_boards",)
CALENDAR_TABLES = ("calendar_states",)
READING_CATALOG_TABLES = ("reading_catalog_states",)
WORKSPACE_CATALOG_TABLES = ("workspace_catalog_states",)
FILE_LIBRARY_TABLES = ("library_files_pg",)
ALL_TABLES = (CHAT_TABLES + MASTERY_TABLES + USAGE_TABLES + BOARD_TABLES
              + CALENDAR_TABLES + READING_CATALOG_TABLES + WORKSPACE_CATALOG_TABLES
              + FILE_LIBRARY_TABLES)


# --------------------------------------------------------------------------- #
# Helpers
# ---------------------------------------------------------------------------


def scalar_json(value: Any, default):
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


def epoch(value: Any) -> datetime | None:
    """Convert a legacy POSIX-second timestamp to an aware UTC datetime."""
    if value in (None, ""):
        return None
    return datetime.fromtimestamp(float(value), tz=timezone.utc)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class SqliteReader:
    def __init__(self, path: Path):
        self.path = path
        self.conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        self.conn.row_factory = sqlite3.Row
        self._tables = {
            r[0] for r in self.conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }

    def has(self, table: str) -> bool:
        return table in self._tables

    def rows(self, table: str) -> list[sqlite3.Row]:
        if not self.has(table):
            return []
        return list(self.conn.execute(f"SELECT * FROM {table}"))  # nosec - internal allowlist

    def count(self, table: str) -> int:
        if not self.has(table):
            return 0
        return self.conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]  # nosec

    def close(self):
        self.conn.close()


def owner_for(path: Path, owner: str | None) -> str:
    return owner or f"legacy_{hashlib.sha256(str(path).encode()).hexdigest()[:16]}"


def legacy_uuid(*parts: str) -> str:
    return f"legacy_{uuid.uuid5(uuid.NAMESPACE_URL, '|'.join(parts)).hex}"


def legacy_practice_entry_id(path: Path, source_entry_id: Any) -> str:
    return legacy_uuid(str(path), "notebook_entries", str(source_entry_id))


@contextmanager
def postgres_runtime_selection():
    """Use the PostgreSQL workspace repository during offline catalog import."""
    names = ("DEEPTUTOR_STORAGE_BACKEND", "DEEPTUTOR_ACCOUNT_BACKEND")
    previous = {name: os.environ.get(name) for name in names}
    try:
        for name in names:
            os.environ[name] = "postgres"
        yield
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


async def legacy_source_paths(db, owner: str, kind: str, current: Path) -> list[Path]:
    """Keep deterministic IDs stable when a later SQLite backup has a new path."""
    rows = (await db.execute(
        text("""SELECT source_path FROM migration_batches
                WHERE owner_user_id=:owner AND source_kind=:kind
                ORDER BY executed_at,source_path"""),
        {"owner": owner, "kind": kind},
    )).scalars().all()
    return list(dict.fromkeys([*(Path(value) for value in rows), current]))


async def existing_legacy_id(db, owner: str, table: str, candidates: list[str]) -> str | None:
    if table not in {"practice_entries", "mastery_events"}:
        raise ValueError(f"Unsupported legacy ID table: {table}")
    for candidate in candidates:
        found = (await db.execute(
            text(f"SELECT id FROM {table} WHERE id=:id AND owner_user_id=:owner"),
            {"id": candidate, "owner": owner},
        )).scalar_one_or_none()
        if found is not None:
            return str(found)
    return None


async def ensure_owner(db, owner: str, display_name: str) -> None:
    await db.execute(
        text(
            """INSERT INTO users (id, display_name) VALUES (:id, :name)
               ON CONFLICT (id) DO NOTHING"""
        ),
        {"id": owner, "name": display_name},
    )
    await db.execute(
        text(
            """INSERT INTO subscriptions (owner_user_id, plan, status)
               VALUES (:id, 'free', 'active') ON CONFLICT (owner_user_id) DO NOTHING"""
        ),
        {"id": owner},
    )


async def record_batch(db, owner: str, kind: str, path: Path, checksum: str, counts: dict) -> None:
    await db.execute(
        text(
            """INSERT INTO migration_batches
                 (owner_user_id, source_kind, source_path, checksum_sha256, counts_json, executed_at)
               VALUES (:owner, :kind, :path, :checksum, CAST(:counts AS JSONB), now())
               ON CONFLICT (owner_user_id, source_path) DO UPDATE SET
                 source_kind = EXCLUDED.source_kind,
                 checksum_sha256 = EXCLUDED.checksum_sha256,
                 counts_json = EXCLUDED.counts_json,
                 executed_at = now()"""
        ),
        {
            "owner": owner,
            "kind": kind,
            "path": str(path),
            "checksum": checksum,
            "counts": json.dumps(counts, ensure_ascii=False),
        },
    )


def empty_counts(keys: tuple[str, ...]) -> dict[str, int]:
    return {key: 0 for key in keys}


async def migrate_usage_db(path: Path, owner: str, execute: bool) -> dict[str, int]:
    """Import an owner's standalone call ledger without changing existing calls."""
    reader = SqliteReader(path)
    try:
        rows = reader.rows("llm_calls")
        counts = {"llm_call_ledger": len(rows)}
        if not execute:
            return counts
        engine = create_async_engine(os.environ["DATABASE_URL"])
        try:
            async with engine.begin() as db:
                await ensure_owner(db, owner, owner)
                for row in rows:
                    await db.execute(text("""
                        INSERT INTO llm_call_ledger
                            (owner_user_id,call_id,started_at,session_id,turn_id,source,usage_json)
                        VALUES (:owner,:id,:started,:session,:turn,:source,CAST(:usage AS JSONB))
                        ON CONFLICT (owner_user_id,call_id) DO NOTHING
                    """), {
                        "owner": owner, "id": row["call_id"],
                        "started": row["started_at"], "session": row["session_id"],
                        "turn": row["turn_id"], "source": row["source"],
                        "usage": row["usage_json"],
                    })
                await record_batch(db, owner, "usage", path, sha256_file(path), counts)
        finally:
            await engine.dispose()
        return counts
    finally:
        reader.close()


async def migrate_task_board_db(path: Path, owner: str, execute: bool) -> dict[str, int]:
    """Copy a board snapshot, refusing to overwrite newer PostgreSQL edits."""
    from deeptutor.services.task_board import TaskBoardStore

    reader = SqliteReader(path)
    try:
        if not reader.has("board_state"):
            return {"task_boards": 0, "task_cards": 0, "task_session_links": 0}
        board = TaskBoardStore._snapshot(reader.conn)
        counts = {"task_boards": 1, "task_cards": len(board.cards),
                  "task_session_links": len(board.session_links)}
        if not execute:
            return counts
        engine = create_async_engine(os.environ["DATABASE_URL"])
        try:
            async with engine.begin() as db:
                await ensure_owner(db, owner, owner)
                existing = (await db.execute(text("""
                    SELECT board_json,revision FROM task_boards
                    WHERE owner_user_id=:owner FOR UPDATE
                """), {"owner": owner})).first()
                payload = board.model_dump(mode="json")
                if existing is None:
                    await db.execute(text("""
                        INSERT INTO task_boards(owner_user_id,revision,board_json)
                        VALUES (:owner,:revision,CAST(:board AS JSONB))
                    """), {"owner": owner, "revision": board.revision,
                           "board": json.dumps(payload, ensure_ascii=False)})
                elif existing.revision != board.revision or existing.board_json != payload:
                    raise RuntimeError(
                        "Task board changed since import; reconcile PostgreSQL and SQLite "
                        "before replacing either copy"
                    )
                await record_batch(db, owner, "task_board", path, sha256_file(path), counts)
        finally:
            await engine.dispose()
        return counts
    finally:
        reader.close()


async def migrate_calendar_db(path: Path, owner: str, execute: bool) -> dict[str, int]:
    """Copy a calendar snapshot without overwriting a different target state."""
    from deeptutor.services.postgres.calendar_store import PostgresCalendarStore

    reader = SqliteReader(path)
    try:
        if not reader.has("state"):
            return {"calendar_states": 0, "calendars": 0,
                    "calendar_events": 0, "calendar_undo": 0}
        revision, state = PostgresCalendarStore._snapshot(reader.conn)
        counts = {"calendar_states": 1, "calendars": len(state["calendars"]),
                  "calendar_events": len(state["events"]), "calendar_undo": len(state["undo"])}
        if not execute:
            return counts
        engine = create_async_engine(os.environ["DATABASE_URL"])
        try:
            async with engine.begin() as db:
                await ensure_owner(db, owner, owner)
                existing = (await db.execute(text("""
                    SELECT revision,state_json FROM calendar_states
                    WHERE owner_user_id=:owner FOR UPDATE
                """), {"owner": owner})).first()
                if existing is None:
                    await db.execute(text("""
                        INSERT INTO calendar_states(owner_user_id,revision,state_json)
                        VALUES (:owner,:revision,CAST(:state AS JSONB))
                    """), {"owner": owner, "revision": revision,
                           "state": json.dumps(state, ensure_ascii=False)})
                elif existing.revision != revision or existing.state_json != state:
                    raise RuntimeError(
                        "Calendar changed since import; reconcile PostgreSQL and SQLite "
                        "before replacing either copy"
                    )
                await record_batch(db, owner, "calendar", path, sha256_file(path), counts)
        finally:
            await engine.dispose()
        return counts
    finally:
        reader.close()


async def migrate_cron_db(path: Path, execute: bool) -> dict[str, int]:
    """Copy global scheduled jobs, requiring an untouched PostgreSQL target."""
    reader = SqliteReader(path)
    try:
        if not reader.has("cron_jobs"):
            return {"scheduled_jobs": 0, "revision": 0}
        rows = reader.rows("cron_jobs")
        revision = reader.conn.execute(
            "SELECT revision FROM cron_meta WHERE singleton=1"
        ).fetchone()[0]
        counts = {"scheduled_jobs": len(rows), "revision": revision}
        if not execute:
            return counts
        engine = create_async_engine(os.environ["DATABASE_URL"])
        try:
            async with engine.begin() as db:
                current = (await db.execute(text(
                    "SELECT revision FROM scheduled_jobs_meta WHERE id=1 FOR UPDATE"
                ))).scalar_one()
                existing = (await db.execute(text(
                    "SELECT id,owner_key,next_run_at_ms,payload_json FROM scheduled_jobs"
                ))).all()
                source = {r["id"]: (r["owner_key"], r["next_run_at_ms"],
                                    scalar_json(r["payload"], {})) for r in rows}
                target = {r.id: (r.owner_key, r.next_run_at_ms, r.payload_json)
                          for r in existing}
                if target:
                    if target != source or current != revision:
                        raise RuntimeError(
                            "Cron jobs changed since import; reconcile PostgreSQL and SQLite"
                        )
                elif current != 0:
                    raise RuntimeError("Cron revision changed before import")
                else:
                    for row in rows:
                        await db.execute(text("""INSERT INTO scheduled_jobs
                            (id,owner_key,next_run_at_ms,payload_json,updated_at_ms)
                            VALUES (:id,:owner,:next,CAST(:payload AS JSONB),:updated)
                        """), {"id": row["id"], "owner": row["owner_key"],
                               "next": row["next_run_at_ms"],
                               "payload": row["payload"], "updated": row["updated_at_ms"]})
                    await db.execute(text(
                        "UPDATE scheduled_jobs_meta SET revision=:revision WHERE id=1"
                    ), {"revision": revision})
        finally:
            await engine.dispose()
        return counts
    finally:
        reader.close()


async def migrate_reading_catalog_db(
    path: Path, owner: str, execute: bool, *, workspace_id: str = "",
) -> dict[str, int]:
    """Copy one owner's catalog without overwriting divergent PostgreSQL edits."""
    from deeptutor.reading.postgres_catalog import snapshot

    reader = SqliteReader(path)
    try:
        if not reader.has("reading_materials"):
            return {"reading_catalog_states": 0}
        state = snapshot(reader.conn)
        counts = {"reading_catalog_states": 1}
        counts.update({table: len(rows) for table, rows in state.items()})
        if not execute:
            return counts
        engine = create_async_engine(os.environ["DATABASE_URL"])
        try:
            async with engine.begin() as db:
                await ensure_owner(db, owner, owner)
                existing = (await db.execute(text("""SELECT state_json FROM reading_catalog_states
                    WHERE owner_user_id=:owner AND workspace_id=:workspace FOR UPDATE"""),
                    {"owner": owner, "workspace": workspace_id})).first()
                if existing is None:
                    await db.execute(text("""INSERT INTO reading_catalog_states
                        (owner_user_id,workspace_id,revision,state_json)
                        VALUES (:owner,:workspace,0,CAST(:state AS JSONB))"""), {
                            "owner": owner, "workspace": workspace_id,
                            "state": json.dumps(state, ensure_ascii=False),
                        })
                elif existing.state_json != state:
                    raise RuntimeError(
                        "Reading catalog changed since import; reconcile PostgreSQL and SQLite"
                    )
                await record_batch(db, owner, "reading_catalog", path, sha256_file(path), counts)
        finally:
            await engine.dispose()
        return counts
    finally:
        reader.close()


async def migrate_workspace_catalog_db(
    path: Path, owner: str, execute: bool, *, target_root: Path | None = None,
) -> dict[str, int]:
    """Regenerate built-ins for the new owner; never inherit another owner's paths."""
    reader = SqliteReader(path)
    try:
        rows = [scalar_json(row["payload"], {}) for row in reader.rows("workspaces")]
        custom = [row for row in rows if row.get("kind") not in {"system", "general"}]
        counts = {"workspace_catalog_states": 1 if rows else 0,
                  "source_builtin_workspaces": len(rows) - len(custom),
                  "source_custom_workspaces": len(custom)}
        if custom and execute:
            raise RuntimeError(
                "Custom workspace folders need an explicit owner/path migration before import"
            )
        if not execute or not rows:
            return counts
        from deeptutor.multi_user.models import CurrentUser, UserScope
        from deeptutor.multi_user.paths import scope_for_user, user_context
        from deeptutor.services.workspace import get_content_workspace_service

        engine = create_async_engine(os.environ["DATABASE_URL"])
        try:
            async with engine.begin() as db:
                await ensure_owner(db, owner, owner)
            scope = (UserScope(kind="user", user_id=owner, root=target_root)
                     if target_root is not None else scope_for_user(owner, is_admin=False))
            user = CurrentUser(id=owner, username=owner, role="user", scope=scope)
            with postgres_runtime_selection(), user_context(user):
                service = get_content_workspace_service()
                imported = service.list_workspaces()
                old_general_ids = [
                    str(row.get("workspace_id") or "") for row in rows
                    if row.get("kind") == "general"
                ]
                new_general_ids = [
                    str(row["workspace_id"]) for row in imported
                    if row["kind"] == "general"
                ]
                if len(old_general_ids) == 1 and len(new_general_ids) == 1:
                    old_id, new_id = old_general_ids[0], new_general_ids[0]
                    if old_id != new_id:
                        if not (old_id.startswith("ws_") and len(old_id) == 35):
                            raise RuntimeError("Invalid legacy presentation workspace ID")
                        with service._catalog_connection() as conn:
                            existing = conn.execute(
                                "SELECT value FROM metadata WHERE key=?",
                                ("legacy_presentation_aliases",),
                            ).fetchone()
                            aliases = json.loads(existing[0]) if existing else {}
                            if aliases.get(old_id) not in {None, new_id}:
                                raise RuntimeError("Legacy presentation alias conflicts with existing owner")
                            aliases[old_id] = new_id
                            conn.execute(
                                "INSERT INTO metadata(key,value) VALUES (?,?) "
                                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                                ("legacy_presentation_aliases", json.dumps(aliases)),
                            )
            builtin = [row for row in imported if row["kind"] in {"system", "general"}]
            if len(builtin) != 2:
                raise RuntimeError("New owner built-in workspaces were not created")
            async with engine.begin() as db:
                await record_batch(db, owner, "workspace_catalog", path, sha256_file(path), counts)
        finally:
            await engine.dispose()
        return counts
    finally:
        reader.close()


async def migrate_file_library_db(path: Path, owner: str, execute: bool) -> dict[str, int]:
    """Copy file metadata; file bytes must be copied separately to the owner's root."""
    reader = SqliteReader(path)
    try:
        rows = reader.rows("library_files")
        counts = {"library_files_pg": len(rows)}
        if not execute:
            return counts
        engine = create_async_engine(os.environ["DATABASE_URL"])
        try:
            async with engine.begin() as db:
                await ensure_owner(db, owner, owner)
                for row in rows:
                    await db.execute(text("""INSERT INTO library_files_pg
                        (owner_user_id,id,sha256,filename,mime_type,size_bytes,library_path,
                         created_at,updated_at,is_deleted,deleted_at)
                        VALUES (:owner,:id,:sha,:name,:mime,:size,:path,:created,:updated,:deleted,:deleted_at)
                        ON CONFLICT(owner_user_id,id) DO UPDATE SET
                            sha256=excluded.sha256,filename=excluded.filename,
                            mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,
                            library_path=excluded.library_path,created_at=excluded.created_at,
                            updated_at=excluded.updated_at,is_deleted=excluded.is_deleted,
                            deleted_at=excluded.deleted_at"""), {
                        "owner": owner, "id": row["id"], "sha": row["sha256"],
                        "name": row["filename"], "mime": row["mime_type"],
                        "size": row["size_bytes"], "path": row["library_path"],
                        "created": row["created_at"], "updated": row["updated_at"],
                        "deleted": bool(row["is_deleted"]), "deleted_at": row["deleted_at"],
                    })
                await record_batch(db, owner, "file_library", path, sha256_file(path), counts)
        finally:
            await engine.dispose()
        return counts
    finally:
        reader.close()


async def migrate_web_source_sync_db(path: Path, owner: str, execute: bool) -> dict[str, int]:
    """Import the global scheduler image only when it cannot overwrite newer work."""
    source = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True)
    image_db = sqlite3.connect(":memory:")
    try:
        source.backup(image_db)
        names = ("web_source_sync_jobs", "web_source_bilingual_pairings")
        counts = {name: image_db.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
                  for name in names}
        image = bytearray(image_db.serialize())
        # sqlite3.deserialize() cannot reopen a WAL-mode header in memory.
        # The backup has already checkpointed pages into this standalone image.
        image[18:20] = b"\x01\x01"
        image = bytes(image)
        if not execute:
            return counts
        engine = create_async_engine(os.environ["DATABASE_URL"])
        try:
            async with engine.begin() as db:
                await ensure_owner(db, owner, owner)
                existing = (await db.execute(text(
                    "SELECT sqlite_image FROM web_source_sync_state WHERE id=1 FOR UPDATE"
                ))).scalar_one_or_none()
                if existing:
                    target_db = sqlite3.connect(":memory:")
                    try:
                        old_image = bytearray(existing)
                        old_image[18:20] = b"\x01\x01"
                        target_db.deserialize(bytes(old_image))
                        for name in names:
                            old_rows = target_db.execute(f"SELECT * FROM {name} ORDER BY 1,2,3").fetchall()
                            new_rows = image_db.execute(f"SELECT * FROM {name} ORDER BY 1,2,3").fetchall()
                            if old_rows and old_rows != new_rows:
                                raise RuntimeError("PostgreSQL web source state has diverged from SQLite snapshot")
                    finally:
                        target_db.close()
                await db.execute(text("""INSERT INTO web_source_sync_state(id,sqlite_image,revision)
                    VALUES (1,:image,0) ON CONFLICT(id) DO UPDATE SET
                    sqlite_image=excluded.sqlite_image,revision=web_source_sync_state.revision+1"""),
                    {"image": image})
                await record_batch(db, owner, "web_source_sync", path, sha256_file(path), counts)
        finally:
            await engine.dispose()
        return counts
    finally:
        image_db.close()
        source.close()


# --------------------------------------------------------------------------- #
# chat_history.db
# ---------------------------------------------------------------------------


async def migrate_chat_db(path: Path, owner: str, execute: bool) -> dict[str, int]:
    counts = empty_counts(CHAT_TABLES)
    counts["skipped_orphan_turns"] = 0
    counts["skipped_orphan_events"] = 0
    counts["skipped_orphan_messages"] = 0
    reader = SqliteReader(path)
    try:
        practice_table = (
            "notebook_entries" if reader.has("notebook_entries") else "practice_entries"
        )

        counts["sessions"] = reader.count("sessions")
        turns = [r for r in reader.rows("turns")]
        session_ids = {r["id"] for r in reader.rows("sessions")}
        messages = reader.rows("messages")
        kept_messages = [r for r in messages if r["session_id"] in session_ids]
        counts["messages"] = len(kept_messages)
        counts["skipped_orphan_messages"] = len(messages) - len(kept_messages)
        kept_turns = []
        for row in turns:
            if row["session_id"] not in session_ids:
                counts["skipped_orphan_turns"] += 1
                continue
            kept_turns.append(row)
        counts["turns"] = len(kept_turns)

        turn_ids = {r["id"] for r in kept_turns}
        submissions = reader.rows("turn_submissions")
        kept_submissions = [r for r in submissions if r["session_id"] in session_ids]
        counts["turn_submissions"] = len(kept_submissions)
        counts["skipped_orphan_submissions"] = len(submissions) - len(kept_submissions)
        events = reader.rows("turn_events")
        kept_events = [r for r in events if r["turn_id"] in turn_ids]
        counts["turn_events"] = len(kept_events)
        counts["skipped_orphan_events"] = len(events) - len(kept_events)

        entries = reader.rows(practice_table)
        counts["practice_entries"] = len(entries)
        counts["assessment_cards"] = len(entries) if practice_table == "notebook_entries" else 0
        categories = reader.rows("notebook_categories")
        links = reader.rows("notebook_entry_categories")
        counts["notebook_categories"] = len(categories)
        counts["notebook_entry_categories"] = len(links)
        review_rows = reader.rows("practice_review_state")
        review_events = reader.rows("practice_review_events")
        import_rows = reader.rows("practice_imports")
        counts["notebook_practice_state"] = len(review_rows)
        counts["notebook_practice_events"] = len(review_events)
        counts["notebook_practice_imports"] = len(import_rows)
        pending_quizzes = reader.rows("reading_quiz_pending")
        quiz_rewards = reader.rows("reading_quiz_rewards")
        counts["reading_quiz_pending"] = len(pending_quizzes)
        counts["reading_quiz_rewards"] = len(quiz_rewards)
        attempts = reader.rows("assessment_attempts")
        counts["assessment_attempts"] = len(attempts)

        # Review schedule: authoritative SRS state from practice_review_state,
        # enriched with the newest review event (rating/answer/reviewed_at).
        review_state = reader.rows("practice_review_state")
        latest_event: dict[Any, sqlite3.Row] = {}
        for row in reader.rows("practice_review_events"):
            prev = latest_event.get(row["entry_id"])
            if prev is None or (row["reviewed_at"] or 0) > (prev["reviewed_at"] or 0):
                latest_event[row["entry_id"]] = row
        entry_ids = {str(r["id"]) for r in entries}
        kept_reviews = []
        for row in review_state:
            event = latest_event.get(row["entry_id"])
            if str(row["entry_id"]) not in entry_ids:
                # Review without a surviving practice entry cannot satisfy the FK.
                continue
            kept_reviews.append((row, event))
        counts["practice_reviews"] = len(kept_reviews)

        if not execute:
            return counts

        engine = create_async_engine(os.environ["DATABASE_URL"])
        try:
            async with engine.begin() as db:
                await ensure_owner(db, owner, str(path))

                source_paths = await legacy_source_paths(db, owner, "chat_history", path)
                entry_ids: dict[int, str] = {}
                for entry in entries:
                    candidates = [legacy_practice_entry_id(source, entry["id"])
                                  for source in source_paths]
                    entry_ids[int(entry["id"])] = (
                        await existing_legacy_id(db, owner, "practice_entries", candidates)
                        or candidates[0]
                    )

                for row in reader.rows("sessions"):
                    await db.execute(
                        text(
                            """INSERT INTO sessions (id, owner_user_id, title, compressed_summary,
                                 summary_up_to_message_id, preferences_json, created_at, updated_at, deleted_at)
                               VALUES (:id,:owner,:title,:summary,:summary_up_to,
                                 CAST(:prefs AS JSONB),:created,:updated,:deleted)
                               ON CONFLICT (id) DO UPDATE SET
                                 title=EXCLUDED.title,
                                 compressed_summary=EXCLUDED.compressed_summary,
                                 summary_up_to_message_id=EXCLUDED.summary_up_to_message_id,
                                 preferences_json=EXCLUDED.preferences_json,
                                 updated_at=EXCLUDED.updated_at,
                                 deleted_at=EXCLUDED.deleted_at
                               WHERE sessions.owner_user_id=EXCLUDED.owner_user_id
                                 AND sessions.updated_at<=EXCLUDED.updated_at"""
                        ),
                        {
                            "id": row["id"],
                            "owner": owner,
                            "title": row["title"],
                            "summary": row["compressed_summary"] or "",
                            "summary_up_to": row["summary_up_to_msg_id"],
                            "prefs": json.dumps(
                                scalar_json(row["preferences_json"], {}), ensure_ascii=False
                            ),
                            "created": epoch(row["created_at"]),
                            "updated": epoch(row["updated_at"]),
                            "deleted": epoch(row["deleted_at"]),
                        },
                    )

                message_ids: dict[int, int] = {}
                for row in kept_messages:
                    new_id = (
                        await db.execute(
                            text(
                                """INSERT INTO messages
                                   (owner_user_id,legacy_message_id,session_id,role,content,
                                    capability,events_json,attachments_json,metadata_json,created_at)
                                   VALUES (:owner,:legacy,:session,:role,:content,:capability,
                                    CAST(:events AS JSONB),CAST(:attachments AS JSONB),
                                    CAST(:metadata AS JSONB),:created)
                                   ON CONFLICT (owner_user_id,legacy_message_id)
                                   DO UPDATE SET legacy_message_id=EXCLUDED.legacy_message_id
                                   RETURNING id"""
                            ),
                            {
                                "owner": owner, "legacy": row["id"],
                                "session": row["session_id"], "role": row["role"],
                                "content": row["content"] or "",
                                "capability": row["capability"] or "",
                                "events": json.dumps(scalar_json(row["events_json"], []), ensure_ascii=False),
                                "attachments": json.dumps(scalar_json(row["attachments_json"], []), ensure_ascii=False),
                                "metadata": json.dumps(scalar_json(row["metadata_json"], {}), ensure_ascii=False),
                                "created": epoch(row["created_at"]),
                            },
                        )
                    ).scalar_one()
                    message_ids[int(row["id"])] = int(new_id)

                for row in kept_messages:
                    parent = row["parent_message_id"]
                    if parent is not None:
                        await db.execute(
                            text(
                                """UPDATE messages SET parent_message_id=:parent
                                   WHERE id=:id AND owner_user_id=:owner"""
                            ),
                            {
                                "id": message_ids[int(row["id"])],
                                "parent": message_ids.get(int(parent)), "owner": owner,
                            },
                        )

                for row in kept_turns:
                    legacy_status = row["status"]
                    status = "succeeded" if legacy_status == "completed" else legacy_status
                    await db.execute(
                        text(
                            """INSERT INTO turns (id,owner_user_id,session_id,capability,status,error,
                                 failure_code,retryable,state_version,assistant_message_id,
                                 runtime_owner_id,fencing_token,
                                 created_at,updated_at,finished_at)
                               VALUES (:id,:owner,:session,:capability,:status,:error,:failure_code,:retryable,
                                 :version,:assistant_message_id,:runtime_owner,:fencing_token,
                                 :created,:updated,:finished)
                               ON CONFLICT (id) DO UPDATE SET
                                 status=EXCLUDED.status, error=EXCLUDED.error,
                                 failure_code=EXCLUDED.failure_code, retryable=EXCLUDED.retryable,
                                 assistant_message_id=EXCLUDED.assistant_message_id,
                                 runtime_owner_id=EXCLUDED.runtime_owner_id,
                                 fencing_token=EXCLUDED.fencing_token,
                                 updated_at=EXCLUDED.updated_at, finished_at=EXCLUDED.finished_at
                               WHERE turns.owner_user_id=EXCLUDED.owner_user_id
                                 AND turns.updated_at<=EXCLUDED.updated_at"""
                        ),
                        {
                            "id": row["id"],
                            "owner": owner,
                            "session": row["session_id"],
                            "capability": row["capability"] or "chat",
                            "status": status,
                            "error": row["error"] or "",
                            "failure_code": row["failure_code"] or "",
                            "retryable": bool(row["retryable"]),
                            "version": row["state_version"],
                            "runtime_owner": row["owner_id"] or "",
                            "fencing_token": int(row["fencing_token"] or 0),
                            "assistant_message_id": message_ids.get(
                                int(row["assistant_message_id"])
                            ) if row["assistant_message_id"] is not None else None,
                            "created": epoch(row["created_at"]),
                            "updated": epoch(row["updated_at"]),
                            "finished": epoch(row["finished_at"]),
                        },
                    )

                for row in kept_submissions:
                    await db.execute(
                        text(
                            """INSERT INTO turn_submissions
                                 (owner_user_id,client_submission_id,workspace_id,
                                  request_digest,session_id,turn_id,superseded_by)
                               VALUES (:owner,:submission,:workspace,:digest,:session,:turn,:superseded)
                               ON CONFLICT (owner_user_id,client_submission_id) DO NOTHING"""
                        ),
                        {
                            "owner": owner,
                            "submission": row["client_submission_id"],
                            "workspace": row["workspace_id"] or "",
                            "digest": row["request_digest"] or "",
                            "session": row["session_id"],
                            "turn": row["turn_id"] if row["turn_id"] in turn_ids else None,
                            "superseded": row["superseded_by"] if "superseded_by" in row.keys() else None,
                        },
                    )

                for row in reader.rows("sessions"):
                    legacy_summary = row["summary_up_to_msg_id"]
                    if legacy_summary is None or int(legacy_summary) not in message_ids:
                        continue
                    await db.execute(
                        text(
                            """UPDATE sessions SET summary_up_to_message_id=:message
                               WHERE id=:session AND owner_user_id=:owner
                                 AND updated_at<=:source_updated"""
                        ),
                        {
                            "message": message_ids[int(legacy_summary)],
                            "session": row["id"], "owner": owner,
                            "source_updated": epoch(row["updated_at"]),
                        },
                    )

                for row in kept_events:
                    await db.execute(
                        text(
                            """INSERT INTO turn_events (owner_user_id,turn_id,seq,type,source,stage,
                                 content,metadata_json,created_at)
                               VALUES (:owner,:turn,:seq,:type,:source,:stage,:content,
                                 CAST(:metadata AS JSONB),:created)
                               ON CONFLICT (turn_id,seq) DO NOTHING"""
                        ),
                        {
                            "owner": owner,
                            "turn": row["turn_id"],
                            "seq": row["seq"],
                            "type": row["type"],
                            "source": row["source"] or "",
                            "stage": row["stage"] or "",
                            "content": row["content"] or "",
                            "metadata": json.dumps(
                                scalar_json(row["metadata_json"], {}), ensure_ascii=False
                            ),
                            "created": epoch(row["timestamp"]),
                        },
                    )

                for row in entries:
                    entry_id = entry_ids[int(row["id"])]
                    await db.execute(
                        text(
                            """INSERT INTO practice_entries (id,owner_user_id,session_id,origin_type,origin_ref,
                                 question_id,question,question_type,options_json,correct_answer,explanation,
                                 difficulty,user_answer,source,mastery_path_id,knowledge_point_id,is_correct,
                                 resolved,bookmarked,attempt_count,created_at,updated_at)
                               VALUES (:id,:owner,:session,:origin_type,:origin_ref,:question_id,:question,
                                 :question_type,CAST(:options AS JSONB),:correct_answer,:explanation,:difficulty,
                                 :user_answer,:source,:path_id,:kp,:correct,:resolved,:bookmarked,:attempts,
                                 :created,:updated)
                               ON CONFLICT (id) DO UPDATE SET
                                 question=EXCLUDED.question, user_answer=EXCLUDED.user_answer,
                                 is_correct=EXCLUDED.is_correct, resolved=EXCLUDED.resolved,
                                 bookmarked=EXCLUDED.bookmarked, attempt_count=EXCLUDED.attempt_count,
                                 updated_at=EXCLUDED.updated_at"""
                        ),
                        {
                            "id": entry_id,
                            "owner": owner,
                            "session": row["session_id"],
                            "origin_type": row["origin_type"],
                            "origin_ref": row["origin_ref"],
                            "question_id": row["question_id"],
                            "question": row["question"],
                            "question_type": row["question_type"] or "",
                            "options": json.dumps(
                                scalar_json(row["options_json"], {}), ensure_ascii=False
                            ),
                            "correct_answer": row["correct_answer"] or "",
                            "explanation": row["explanation"] or "",
                            "difficulty": row["difficulty"] or "",
                            "user_answer": row["user_answer"] or "",
                            "source": row["source"],
                            "path_id": row["mastery_path_id"] or None,
                            "kp": row["knowledge_point_id"] or None,
                            "correct": bool(row["is_correct"]),
                            "resolved": bool(row["resolved"]),
                            "bookmarked": bool(row["bookmarked"]),
                            "attempts": int(row["attempt_count"] or 1),
                            "created": epoch(row["created_at"]),
                            "updated": epoch(row["updated_at"]),
                        },
                    )

                card_ids: dict[int, int] = {}
                if practice_table == "notebook_entries":
                    for row in entries:
                        card = {
                            **dict(row),
                            "options": scalar_json(row["options_json"], {}),
                            "user_answer_images": scalar_json(row["user_answer_images_json"], []),
                            "is_correct": bool(row["is_correct"]),
                            "resolved": bool(row["resolved"]),
                            "bookmarked": bool(row["bookmarked"]),
                        }
                        card_id = (
                            await db.execute(
                                text(
                                    """INSERT INTO assessment_cards
                                         (owner_user_id,session_id,origin_type,origin_ref,
                                          turn_id,question_id,card_json,created_at,updated_at)
                                       VALUES (:owner,:session,:kind,:ref,:turn,:question,
                                               CAST(:card AS JSONB),:created,:updated)
                                       ON CONFLICT (owner_user_id,origin_type,origin_ref,turn_id,question_id)
                                       DO UPDATE SET card_json=EXCLUDED.card_json,
                                         session_id=EXCLUDED.session_id,
                                         updated_at=EXCLUDED.updated_at
                                       WHERE assessment_cards.updated_at<=EXCLUDED.updated_at
                                       RETURNING id"""
                                ),
                                {
                                    "owner": owner,
                                    "session": row["session_id"] if row["session_id"] in session_ids else None,
                                    "kind": row["origin_type"], "ref": row["origin_ref"],
                                    "turn": row["turn_id"] or "",
                                    "question": row["question_id"],
                                    "card": json.dumps(card, ensure_ascii=False),
                                    "created": epoch(row["created_at"]),
                                    "updated": epoch(row["updated_at"]),
                                },
                            )
                        ).scalar_one_or_none()
                        if card_id is None:
                            card_id = (
                                await db.execute(
                                    text("""SELECT id FROM assessment_cards
                                            WHERE owner_user_id=:owner AND origin_type=:kind
                                              AND origin_ref=:ref AND turn_id=:turn
                                              AND question_id=:question"""),
                                    {
                                        "owner": owner, "kind": row["origin_type"],
                                        "ref": row["origin_ref"],
                                        "turn": row["turn_id"] or "",
                                        "question": row["question_id"],
                                    },
                                )
                            ).scalar_one()
                        card_ids[int(row["id"])] = int(card_id)

                category_ids: dict[int, int] = {}
                for row in categories:
                    category_id = (await db.execute(text("""
                        INSERT INTO notebook_categories (owner_user_id,name,created_at)
                        VALUES (:owner,:name,:created)
                        ON CONFLICT (owner_user_id,lower(name)) DO UPDATE
                        SET name=EXCLUDED.name RETURNING id
                    """), {"owner": owner, "name": row["name"],
                           "created": epoch(row["created_at"])})).scalar_one()
                    category_ids[int(row["id"])] = int(category_id)
                for row in links:
                    card_id = card_ids.get(int(row["entry_id"]))
                    category_id = category_ids.get(int(row["category_id"]))
                    if card_id is not None and category_id is not None:
                        await db.execute(text("""
                            INSERT INTO notebook_entry_categories
                              (owner_user_id,entry_id,category_id)
                            VALUES (:owner,:entry,:category) ON CONFLICT DO NOTHING
                        """), {"owner": owner, "entry": card_id,
                               "category": category_id})

                for row in review_rows:
                    card_id = card_ids.get(int(row["entry_id"]))
                    if card_id is None:
                        continue
                    await db.execute(text("""
                        INSERT INTO notebook_practice_state
                          (owner_user_id,entry_id,is_mistake,first_wrong_at,due_at,
                           interval_days,ease,streak,lapses,review_count,last_review_at,version)
                        VALUES (:owner,:entry,:mistake,:first_wrong,:due,:interval,:ease,
                           :streak,:lapses,:reviews,:last_review,:version)
                        ON CONFLICT (owner_user_id,entry_id) DO UPDATE SET
                          is_mistake=EXCLUDED.is_mistake,
                          first_wrong_at=EXCLUDED.first_wrong_at,due_at=EXCLUDED.due_at,
                          interval_days=EXCLUDED.interval_days,ease=EXCLUDED.ease,
                          streak=EXCLUDED.streak,lapses=EXCLUDED.lapses,
                          review_count=EXCLUDED.review_count,
                          last_review_at=EXCLUDED.last_review_at,
                          version=EXCLUDED.version
                    """), {"owner": owner, "entry": card_id,
                           "mistake": bool(row["is_mistake"]),
                           "first_wrong": epoch(row["first_wrong_at"]),
                           "due": epoch(row["due_at"]),
                           "interval": row["interval_days"], "ease": row["ease"],
                           "streak": row["streak"], "lapses": row["lapses"],
                           "reviews": row["review_count"],
                           "last_review": epoch(row["last_review_at"]),
                           "version": row["version"]})
                for row in review_events:
                    card_id = card_ids.get(int(row["entry_id"]))
                    if card_id is None:
                        continue
                    outcome = scalar_json(row["outcome_json"], {})
                    if isinstance(outcome, dict) and "entry_id" in outcome:
                        outcome = {**outcome, "entry_id": card_id}
                    await db.execute(text("""
                        INSERT INTO notebook_practice_events
                          (request_id,owner_user_id,entry_id,rating,answer,reviewed_at,outcome_json)
                        VALUES (:request,:owner,:entry,:rating,:answer,:reviewed,CAST(:outcome AS JSONB))
                        ON CONFLICT (request_id) DO NOTHING
                    """), {"request": row["request_id"], "owner": owner,
                           "entry": card_id, "rating": row["rating"],
                           "answer": row["answer"],
                           "reviewed": epoch(row["reviewed_at"]),
                           "outcome": json.dumps(outcome, ensure_ascii=False)})
                for row in import_rows:
                    await db.execute(text("""
                        INSERT INTO notebook_practice_imports
                          (token,owner_user_id,filename,target,payload_json,created_at,result_json)
                        VALUES (:token,:owner,:filename,:target,CAST(:payload AS JSONB),
                          :created,CAST(:result AS JSONB)) ON CONFLICT (token) DO NOTHING
                    """), {"token": row["token"], "owner": owner,
                           "filename": row["filename"], "target": row["target"],
                           "payload": json.dumps(scalar_json(row["payload_json"], {}), ensure_ascii=False),
                           "created": epoch(row["created_at"]),
                           "result": json.dumps(scalar_json(row["result_json"], None), ensure_ascii=False)})
                for row in pending_quizzes:
                    await db.execute(text("""
                        INSERT INTO reading_quiz_pending
                          (owner_user_id,material_id,locator,question_id,question_json,created_at)
                        VALUES (:owner,:material,:locator,:question,CAST(:payload AS JSONB),:created)
                        ON CONFLICT (owner_user_id,material_id,locator,question_id)
                        DO UPDATE SET question_json=EXCLUDED.question_json,
                          created_at=EXCLUDED.created_at
                        WHERE reading_quiz_pending.created_at<=EXCLUDED.created_at
                    """), {"owner": owner, "material": row["material_id"],
                           "locator": row["locator"], "question": row["question_id"],
                           "payload": json.dumps(scalar_json(row["question_json"], {}), ensure_ascii=False),
                           "created": epoch(row["created_at"])})
                for row in quiz_rewards:
                    await db.execute(text("""
                        INSERT INTO reading_quiz_rewards
                          (owner_user_id,material_id,locator,stars,updated_at)
                        VALUES (:owner,:material,:locator,:stars,:updated)
                        ON CONFLICT (owner_user_id,material_id,locator)
                        DO UPDATE SET stars=GREATEST(reading_quiz_rewards.stars,EXCLUDED.stars),
                          updated_at=CASE WHEN EXCLUDED.stars>reading_quiz_rewards.stars
                            THEN EXCLUDED.updated_at ELSE reading_quiz_rewards.updated_at END
                    """), {"owner": owner, "material": row["material_id"],
                           "locator": row["locator"], "stars": row["stars"],
                           "updated": epoch(row["updated_at"])})

                for state_row, event_row in kept_reviews:
                    entry_id = entry_ids[int(state_row["entry_id"])]
                    reviewed_at = epoch(
                        (event_row["reviewed_at"] if event_row else None)
                        or state_row["last_review_at"]
                    )
                    due_at = epoch(state_row["due_at"]) or (
                        reviewed_at or datetime.now(timezone.utc)
                    )
                    await db.execute(
                        text(
                            """INSERT INTO practice_reviews (owner_user_id,entry_id,request_id,rating,answer,
                                 is_mistake,first_wrong_at,due_at,interval_days,ease,streak,lapses,review_count,
                                 last_review_at,created_at,updated_at)
                               VALUES (:owner,:entry,:request,:rating,:answer,:mistake,:first_wrong,:due,
                                 :interval,:ease,:streak,:lapses,:review_count,:last_review,:now,:now)
                               ON CONFLICT (owner_user_id,request_id) DO UPDATE SET
                                 entry_id=EXCLUDED.entry_id, rating=EXCLUDED.rating, answer=EXCLUDED.answer,
                                 is_mistake=EXCLUDED.is_mistake, due_at=EXCLUDED.due_at,
                                 interval_days=EXCLUDED.interval_days, ease=EXCLUDED.ease,
                                 streak=EXCLUDED.streak, lapses=EXCLUDED.lapses,
                                 review_count=EXCLUDED.review_count, last_review_at=EXCLUDED.last_review_at,
                                 updated_at=now()"""
                        ),
                        {
                            "owner": owner,
                            "entry": entry_id,
                            "request": f"legacy:{entry_id}",
                            "rating": (event_row["rating"] if event_row else "") or "",
                            "answer": (event_row["answer"] if event_row else "") or "",
                            "mistake": bool(state_row["is_mistake"]),
                            "first_wrong": epoch(state_row["first_wrong_at"]),
                            "due": due_at,
                            "interval": float(state_row["interval_days"] or 1),
                            "ease": float(state_row["ease"] or 2.5),
                            "streak": int(state_row["streak"] or 0),
                            "lapses": int(state_row["lapses"] or 0),
                            "review_count": int(state_row["review_count"] or 0),
                            "last_review": reviewed_at,
                            "now": reviewed_at or datetime.now(timezone.utc),
                        },
                    )

                for row in attempts:
                    source_attempt = scalar_json(row["assessment_json"], {})
                    if not isinstance(source_attempt, dict):
                        source_attempt = {}
                    attempt_payload = {
                        **source_attempt,
                        "attempt_id": row["attempt_id"],
                        "session_id": row["session_id"] or "",
                        "origin_type": row["origin_type"] if "origin_type" in row.keys() else source_attempt.get("origin_type", "conversation"),
                        "origin_ref": row["origin_ref"] if "origin_ref" in row.keys() else source_attempt.get("origin_ref", row["session_id"] or ""),
                        "turn_id": row["turn_id"] if "turn_id" in row.keys() else source_attempt.get("turn_id", ""),
                        "question_id": row["question_id"] if "question_id" in row.keys() else source_attempt.get("question_id", ""),
                        "source": row["source"] if "source" in row.keys() else source_attempt.get("source", ""),
                        "assessment_type": row["assessment_type"] if "assessment_type" in row.keys() else source_attempt.get("assessment_type", ""),
                        "result": row["result"] if "result" in row.keys() else source_attempt.get("result", ""),
                        "mastery_path_id": row["mastery_path_id"] or "",
                        "knowledge_point_id": row["knowledge_point_id"] or "",
                        "occurred_at": row["occurred_at"],
                    }
                    legacy_card_id = row["notebook_entry_id"] if "notebook_entry_id" in row.keys() else None
                    await db.execute(
                        text(
                            """INSERT INTO assessment_attempts
                                 (id,owner_user_id,session_id,path_id,knowledge_point_id,
                                  attempt_json,linked_applied,created_at,card_id)
                               VALUES (:id,:owner,:session,:path,:kp,CAST(:record AS JSONB),:linked,:created,:card_id)
                               ON CONFLICT (id) DO NOTHING"""
                        ),
                        {
                            "id": row["attempt_id"], "owner": owner,
                            "session": row["session_id"] or "",
                            "path": row["mastery_path_id"] or "",
                            "kp": row["knowledge_point_id"] or "",
                            "record": json.dumps(attempt_payload, ensure_ascii=False),
                            "linked": bool(row["linked_applied"]),
                            "created": epoch(row["occurred_at"]),
                            "card_id": card_ids.get(int(legacy_card_id)) if legacy_card_id is not None else None,
                        },
                    )

                await record_batch(db, owner, "chat_history", path, sha256_file(path), counts)
        finally:
            await engine.dispose()
    finally:
        reader.close()
    return counts


# --------------------------------------------------------------------------- #
# mastery.sqlite3
# ---------------------------------------------------------------------------


async def migrate_mastery(path: Path, owner: str, execute: bool) -> dict[str, int]:
    counts = empty_counts(MASTERY_TABLES)
    counts["skipped_orphan_interactions"] = 0
    counts["skipped_orphan_events"] = 0
    reader = SqliteReader(path)
    try:
        paths = reader.rows("mastery_paths")
        path_ids = {r["path_id"] for r in paths}
        interactions = reader.rows("mastery_interactions")
        events = reader.rows("mastery_events")
        sessions = reader.rows("mastery_path_sessions")
        topic_meta = reader.rows("mastery_topic_meta")
        topic_sources = reader.rows("mastery_topic_sources")
        evidence = reader.rows("mastery_learning_evidence")
        reading_progress = reader.rows("reading_progress")
        reading_activities = reader.rows("reading_activities")
        kept_interactions = [r for r in interactions if r["path_id"] in path_ids]
        kept_events = [r for r in events if r["path_id"] in path_ids]
        kept_sessions = [r for r in sessions if r["path_id"] in path_ids]
        kept_meta = [r for r in topic_meta if r["path_id"] in path_ids]
        kept_sources = [r for r in topic_sources if r["path_id"] in path_ids]
        kept_evidence = [r for r in evidence if r["path_id"] in path_ids]
        counts["mastery_paths"] = len(paths)
        counts["mastery_interactions"] = len(kept_interactions)
        counts["mastery_events"] = len(kept_events)
        counts["mastery_path_sessions"] = len(kept_sessions)
        counts["mastery_topic_meta"] = len(kept_meta)
        counts["mastery_topic_sources"] = len(kept_sources)
        counts["mastery_learning_evidence"] = len(kept_evidence)
        counts["reading_learning_progress"] = len(reading_progress)
        counts["reading_learning_activities"] = len(reading_activities)
        counts["skipped_orphan_interactions"] = len(interactions) - len(kept_interactions)
        counts["skipped_orphan_events"] = len(events) - len(kept_events)

        if not execute:
            return counts

        engine = create_async_engine(os.environ["DATABASE_URL"])
        try:
            async with engine.begin() as db:
                await ensure_owner(db, owner, str(path))

                source_paths = await legacy_source_paths(db, owner, "mastery", path)
                event_ids: dict[int, str] = {}
                for event in kept_events:
                    candidates = [legacy_uuid(str(source), "mastery_events",
                                              event["path_id"], str(event["id"]))
                                  for source in source_paths]
                    canonical = (await existing_legacy_id(db, owner, "mastery_events", candidates)
                                 or candidates[0])
                    event_ids[int(event["id"])] = canonical
                    for duplicate in candidates:
                        if duplicate != canonical:
                            await db.execute(text("""DELETE FROM mastery_events
                                WHERE id=:duplicate AND owner_user_id=:owner
                                  AND path_id=:path"""),
                                {"duplicate": duplicate, "owner": owner,
                                 "path": event["path_id"]})

                for row in paths:
                    await db.execute(
                        text(
                            """INSERT INTO mastery_paths (path_id,owner_user_id,revision,state_json,
                                 created_at,updated_at,owner_session_id)
                               VALUES (:path,:owner,:revision,CAST(:state AS JSONB),:created,:updated,:creator)
                               ON CONFLICT (path_id) DO UPDATE SET
                                 revision=GREATEST(mastery_paths.revision, EXCLUDED.revision),
                                 state_json=EXCLUDED.state_json,
                                 updated_at=EXCLUDED.updated_at,
                                 owner_session_id=CASE
                                   WHEN mastery_paths.owner_session_id='' THEN EXCLUDED.owner_session_id
                                   ELSE mastery_paths.owner_session_id END
                               WHERE mastery_paths.owner_user_id=EXCLUDED.owner_user_id
                                 AND mastery_paths.revision<=EXCLUDED.revision"""
                        ),
                        {
                            "path": row["path_id"],
                            "owner": owner,
                            "revision": row["revision"] or 1,
                            "state": json.dumps(
                                scalar_json(row["state_json"], {}), ensure_ascii=False
                            ),
                            "created": epoch(row["created_at"]),
                            "updated": epoch(row["updated_at"]),
                            "creator": row["owner_session_id"] if "owner_session_id" in row.keys() else "",
                        },
                    )

                for row in kept_interactions:
                    await db.execute(
                        text(
                            """INSERT INTO mastery_interactions (interaction_id,owner_user_id,path_id,status,
                                 question_json,session_id,turn_id,user_answer,result_json,created_at,updated_at)
                               VALUES (:id,:owner,:path,:status,CAST(:question AS JSONB),:session,:turn,
                                 :answer,CAST(:result AS JSONB),:created,:updated)
                               ON CONFLICT (interaction_id) DO UPDATE SET
                                 path_id=EXCLUDED.path_id, status=EXCLUDED.status,
                                 question_json=EXCLUDED.question_json, user_answer=EXCLUDED.user_answer,
                                 result_json=EXCLUDED.result_json, updated_at=EXCLUDED.updated_at
                               WHERE mastery_interactions.owner_user_id=EXCLUDED.owner_user_id
                                 AND mastery_interactions.updated_at<=EXCLUDED.updated_at"""
                        ),
                        {
                            "id": row["interaction_id"],
                            "owner": owner,
                            "path": row["path_id"],
                            "status": row["status"],
                            "question": row["question_json"],
                            "session": row["session_id"] or "",
                            "turn": row["turn_id"] or "",
                            "answer": row["user_answer"] or "",
                            "result": row["result_json"] or "{}",
                            "created": epoch(row["created_at"]),
                            "updated": epoch(row["updated_at"]),
                        },
                    )

                for row in kept_sessions:
                    await db.execute(
                        text(
                            """INSERT INTO mastery_path_sessions
                                 (owner_user_id,path_id,session_id,created_at,last_seen_at)
                               VALUES (:owner,:path,:session,:created,:seen)
                               ON CONFLICT (owner_user_id,path_id,session_id) DO UPDATE SET
                                 last_seen_at=EXCLUDED.last_seen_at
                               WHERE mastery_path_sessions.last_seen_at<=EXCLUDED.last_seen_at"""
                        ),
                        {
                            "owner": owner,
                            "path": row["path_id"],
                            "session": row["session_id"],
                            "created": epoch(row["created_at"]),
                            "seen": epoch(row["last_seen_at"]),
                        },
                    )

                for row in kept_meta:
                    await db.execute(
                        text(
                            """INSERT INTO mastery_topic_meta
                                 (path_id,owner_user_id,goal,description,emoji,map_seed,status,created_at,updated_at)
                               VALUES (:path,:owner,:goal,:description,:emoji,:seed,:status,:created,:updated)
                               ON CONFLICT (path_id) DO UPDATE SET
                                 goal=EXCLUDED.goal, description=EXCLUDED.description,
                                 emoji=EXCLUDED.emoji, map_seed=EXCLUDED.map_seed,
                                 status=EXCLUDED.status, updated_at=EXCLUDED.updated_at
                               WHERE mastery_topic_meta.owner_user_id=EXCLUDED.owner_user_id
                                 AND mastery_topic_meta.updated_at<=EXCLUDED.updated_at"""
                        ),
                        {
                            "path": row["path_id"], "owner": owner,
                            "goal": row["goal"], "description": row["description"],
                            "emoji": row["emoji"], "seed": row["map_seed"],
                            "status": row["status"],
                            "created": epoch(row["created_at"]),
                            "updated": epoch(row["updated_at"]),
                        },
                    )

                for row in kept_sources:
                    await db.execute(
                        text(
                            """INSERT INTO mastery_topic_sources
                                 (source_id,path_id,owner_user_id,kind,external_id,label,excerpt,
                                  position,available,metadata_json,created_at)
                               VALUES (:id,:path,:owner,:kind,:external,:label,:excerpt,
                                  :position,:available,CAST(:metadata AS JSONB),:created)
                               ON CONFLICT (source_id) DO NOTHING"""
                        ),
                        {
                            "id": row["source_id"], "path": row["path_id"], "owner": owner,
                            "kind": row["kind"], "external": row["external_id"],
                            "label": row["label"], "excerpt": row["excerpt"],
                            "position": row["position"], "available": bool(row["available"]),
                            "metadata": row["metadata_json"] or "{}",
                            "created": epoch(row["created_at"]),
                        },
                    )

                for row in kept_evidence:
                    await db.execute(
                        text(
                            """INSERT INTO mastery_learning_evidence
                                 (owner_user_id,path_id,ordinal,knowledge_point_id,timestamp,
                                  source,assessment_type,result,quality,session_id,turn_id,evidence_json)
                               VALUES (:owner,:path,:ordinal,:kp,:timestamp,:source,:type,:result,
                                  :quality,:session,:turn,CAST(:evidence AS JSONB))
                               ON CONFLICT (path_id,ordinal) DO NOTHING"""
                        ),
                        {
                            "owner": owner, "path": row["path_id"], "ordinal": row["ordinal"],
                            "kp": row["knowledge_point_id"], "timestamp": epoch(row["timestamp"]),
                            "source": row["source"], "type": row["assessment_type"],
                            "result": row["result"], "quality": row["quality"],
                            "session": row["session_id"] or "", "turn": row["turn_id"] or "",
                            "evidence": row["evidence_json"],
                        },
                    )

                for row in kept_events:
                    await db.execute(
                        text(
                            """INSERT INTO mastery_events (id,owner_user_id,path_id,revision,event_type,
                                 payload_json,session_id,turn_id,created_at)
                               VALUES (:id,:owner,:path,:revision,:event,CAST(:payload AS JSONB),
                                 :session,:turn,:created)
                               ON CONFLICT (id) DO UPDATE SET
                                 revision=GREATEST(mastery_events.revision, EXCLUDED.revision),
                                 event_type=EXCLUDED.event_type, payload_json=EXCLUDED.payload_json
                               WHERE mastery_events.owner_user_id=EXCLUDED.owner_user_id
                                 AND mastery_events.revision<=EXCLUDED.revision"""
                        ),
                        {
                            "id": event_ids[int(row["id"])],
                            "owner": owner,
                            "path": row["path_id"],
                            "revision": row["revision"],
                            "event": row["event_type"],
                            "payload": row["payload_json"] or "{}",
                            "session": row["session_id"] or "",
                            "turn": row["turn_id"] or "",
                            "created": epoch(row["created_at"]),
                        },
                    )

                for row in reading_progress:
                    await db.execute(
                        text(
                            """INSERT INTO reading_learning_progress
                                 (owner_user_id,material_id,latest_locator,latest_percentage,
                                  furthest_locator,furthest_percentage,updated_at)
                               VALUES (:owner,:material,:latest_locator,:latest_percentage,
                                  :furthest_locator,:furthest_percentage,:updated)
                               ON CONFLICT (owner_user_id,material_id) DO UPDATE SET
                                 latest_locator=EXCLUDED.latest_locator,
                                 latest_percentage=EXCLUDED.latest_percentage,
                                 furthest_locator=GREATEST(
                                   reading_learning_progress.furthest_locator,EXCLUDED.furthest_locator),
                                 furthest_percentage=GREATEST(
                                   reading_learning_progress.furthest_percentage,EXCLUDED.furthest_percentage),
                                 updated_at=EXCLUDED.updated_at
                               WHERE reading_learning_progress.updated_at<=EXCLUDED.updated_at"""
                        ),
                        {
                            "owner": owner, "material": row["material_id"],
                            "latest_locator": row["latest_locator"],
                            "latest_percentage": row["latest_percentage"],
                            "furthest_locator": row["furthest_locator"],
                            "furthest_percentage": row["furthest_percentage"],
                            "updated": epoch(row["updated_at"]),
                        },
                    )

                for row in reading_activities:
                    await db.execute(
                        text(
                            """INSERT INTO reading_learning_activities
                                 (activity_id,owner_user_id,material_id,extension_id,action,
                                  locator,result_type,created_at)
                               VALUES (:id,:owner,:material,:extension,:action,:locator,:result,:created)
                               ON CONFLICT (activity_id) DO NOTHING"""
                        ),
                        {
                            "id": row["activity_id"], "owner": owner,
                            "material": row["material_id"],
                            "extension": row["extension_id"], "action": row["action"],
                            "locator": row["locator"], "result": row["result_type"],
                            "created": epoch(row["created_at"]),
                        },
                    )

                await record_batch(db, owner, "mastery", path, sha256_file(path), counts)
        finally:
            await engine.dispose()
    finally:
        reader.close()
    return counts


# --------------------------------------------------------------------------- #
# Reconciliation
# ---------------------------------------------------------------------------


async def postgres_counts(owner: str | None) -> dict[str, int]:
    engine = create_async_engine(os.environ["DATABASE_URL"])
    try:
        async with engine.connect() as db:
            where = "WHERE owner_user_id=:owner" if owner else ""
            result = {}
            for table in ALL_TABLES:
                result[table] = (
                    await db.execute(
                        text(f"SELECT count(*) FROM {table} {where}"), {"owner": owner}
                    )  # nosec
                ).scalar_one()
            result["migration_batches"] = (
                await db.execute(
                    text(f"SELECT count(*) FROM migration_batches {where}"), {"owner": owner}
                )
            ).scalar_one()
        return result
    finally:
        await engine.dispose()


async def main_async(args) -> None:
    home = Path(args.home)
    chat_db = home / "chat_history.db"
    mastery_db = home / "workspace/learning/mastery/mastery.sqlite3"
    usage_db = home / "usage.sqlite3"
    board_db = home / "runtime_state/task-board/tasks.sqlite"
    calendar_db = home / ".runtime/calendar/calendar.sqlite"
    cron_db = Path(args.cron_db) if args.cron_db else None
    reading_catalog_db = home / "workspace/reading/_catalog.sqlite3"
    workspace_catalog_db = home / ".runtime/workspaces.sqlite3"
    file_library_db = home / "workspace/library/library.db"
    web_source_db = Path(args.web_source_db) if args.web_source_db else None
    owner = args.owner
    chat_owner = args.chat_owner or owner
    mastery_owner = args.mastery_owner or owner
    usage_owner = args.usage_owner or owner
    board_owner = args.board_owner or owner
    calendar_owner = args.calendar_owner or owner
    reading_owner = args.reading_owner or owner
    workspace_owner = args.workspace_owner or owner
    file_library_owner = args.file_library_owner or owner
    summary: dict[str, dict[str, int]] = {}
    if chat_db.exists():
        summary[str(chat_db)] = await migrate_chat_db(
            chat_db, owner_for(chat_db, chat_owner), not args.dry_run
        )
    if mastery_db.exists():
        summary[str(mastery_db)] = await migrate_mastery(
            mastery_db, owner_for(mastery_db, mastery_owner), not args.dry_run
        )
    if usage_db.exists():
        summary[str(usage_db)] = await migrate_usage_db(
            usage_db, owner_for(usage_db, usage_owner), not args.dry_run
        )
    if board_db.exists():
        summary[str(board_db)] = await migrate_task_board_db(
            board_db, owner_for(board_db, board_owner), not args.dry_run
        )
    if calendar_db.exists():
        summary[str(calendar_db)] = await migrate_calendar_db(
            calendar_db, owner_for(calendar_db, calendar_owner), not args.dry_run
        )
    if cron_db is not None and cron_db.exists():
        summary[str(cron_db)] = await migrate_cron_db(cron_db, not args.dry_run)
    if reading_catalog_db.exists():
        summary[str(reading_catalog_db)] = await migrate_reading_catalog_db(
            reading_catalog_db, owner_for(reading_catalog_db, reading_owner),
            not args.dry_run,
        )
    if workspace_catalog_db.exists():
        summary[str(workspace_catalog_db)] = await migrate_workspace_catalog_db(
            workspace_catalog_db, owner_for(workspace_catalog_db, workspace_owner),
            not args.dry_run,
        )
    if file_library_db.exists():
        summary[str(file_library_db)] = await migrate_file_library_db(
            file_library_db, owner_for(file_library_db, file_library_owner), not args.dry_run,
        )
    if web_source_db is not None and web_source_db.exists():
        summary[str(web_source_db)] = await migrate_web_source_sync_db(
            web_source_db, owner_for(web_source_db, owner), not args.dry_run,
        )

    report = {
        "mode": "dry-run" if args.dry_run else "execute",
        "owner": owner,
        "chat_owner": owner_for(chat_db, chat_owner) if chat_db.exists() else None,
        "mastery_owner": owner_for(mastery_db, mastery_owner) if mastery_db.exists() else None,
        "usage_owner": owner_for(usage_db, usage_owner) if usage_db.exists() else None,
        "board_owner": owner_for(board_db, board_owner) if board_db.exists() else None,
        "calendar_owner": owner_for(calendar_db, calendar_owner) if calendar_db.exists() else None,
        "reading_owner": owner_for(reading_catalog_db, reading_owner) if reading_catalog_db.exists() else None,
        "workspace_owner": owner_for(workspace_catalog_db, workspace_owner) if workspace_catalog_db.exists() else None,
        "file_library_owner": owner_for(file_library_db, file_library_owner) if file_library_db.exists() else None,
        "sources": summary,
    }
    if args.check and not args.dry_run:
        # With --owner, reconcile that single account; without it, report totals.
        report["postgres_counts"] = await postgres_counts(owner)
    print(json.dumps(report, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", default=str(DEFAULT_HOME))
    parser.add_argument("--owner", help="Postgres user id to own all imported rows")
    parser.add_argument("--chat-owner", help="Existing Postgres owner id for chat data")
    parser.add_argument("--mastery-owner", help="Existing Postgres owner id for Mastery data")
    parser.add_argument("--usage-owner", help="Existing Postgres owner id for usage data")
    parser.add_argument("--board-owner", help="Existing Postgres owner id for task board data")
    parser.add_argument("--calendar-owner", help="Existing Postgres owner id for calendar data")
    parser.add_argument("--cron-db", help="Snapshot of the shared cron jobs.sqlite3")
    parser.add_argument("--reading-owner", help="Existing Postgres owner id for reading catalog data")
    parser.add_argument("--workspace-owner", help="Existing Postgres owner id for workspace catalog data")
    parser.add_argument("--file-library-owner", help="Existing Postgres owner id for file library metadata")
    parser.add_argument("--web-source-db", help="Snapshot of global web-source-sync.sqlite")
    parser.add_argument("--dry-run", action="store_true", help="Read SQLite and report counts only")
    parser.add_argument("--execute", action="store_true", help="Upsert rows into PostgreSQL")
    parser.add_argument(
        "--check", action="store_true", help="Print Postgres counts after execution"
    )
    args = parser.parse_args()
    if args.dry_run == args.execute:
        parser.error("choose exactly one of --dry-run / --execute")
    if not os.environ.get("DATABASE_URL"):
        parser.error("DATABASE_URL is required")
    home = Path(args.home)
    if (
        (home / "chat_history.db").exists()
        and (home / "workspace/learning/mastery/mastery.sqlite3").exists()
        and not args.owner
        and not (args.chat_owner and args.mastery_owner)
    ):
        parser.error(
            "both stores exist: pass --owner for one shared identity, or both "
            "--chat-owner and --mastery-owner for an existing mapping"
        )
    if (home / "usage.sqlite3").exists() and not (args.owner or args.usage_owner):
        parser.error("usage ledger exists: pass --owner or --usage-owner for its account")
    if (home / "runtime_state/task-board/tasks.sqlite").exists() and not (args.owner or args.board_owner):
        parser.error("task board exists: pass --owner or --board-owner for its account")
    if (home / ".runtime/calendar/calendar.sqlite").exists() and not (args.owner or args.calendar_owner):
        parser.error("calendar exists: pass --owner or --calendar-owner for its account")
    if (home / "workspace/reading/_catalog.sqlite3").exists() and not (args.owner or args.reading_owner):
        parser.error("reading catalog exists: pass --owner or --reading-owner for its account")
    if (home / ".runtime/workspaces.sqlite3").exists() and not (args.owner or args.workspace_owner):
        parser.error("workspace catalog exists: pass --owner or --workspace-owner for its account")
    if (home / "workspace/library/library.db").exists() and not (args.owner or args.file_library_owner):
        parser.error("file library exists: pass --owner or --file-library-owner for its account")
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
