#!/usr/bin/env python3
"""One-time SQLite -> PostgreSQL migration for legacy DeepTutor workspaces.

Sources (per DEEPTUTOR_HOME, default ``data/user``):

* ``chat_history.db``: sessions / turns / turn_events / notebook_entries
  (practice entries) + practice_review_state / practice_review_events
* ``workspace/learning/mastery/mastery.sqlite3``: mastery paths, interactions
  and events.

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

CHAT_TABLES = ("sessions", "turns", "turn_events", "practice_entries", "practice_reviews")
MASTERY_TABLES = ("mastery_paths", "mastery_interactions", "mastery_events")
ALL_TABLES = CHAT_TABLES + MASTERY_TABLES


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


# --------------------------------------------------------------------------- #
# chat_history.db
# ---------------------------------------------------------------------------


async def migrate_chat_db(path: Path, owner: str, execute: bool) -> dict[str, int]:
    counts = empty_counts(CHAT_TABLES)
    counts["skipped_orphan_turns"] = 0
    counts["skipped_orphan_events"] = 0
    reader = SqliteReader(path)
    try:
        practice_table = (
            "notebook_entries" if reader.has("notebook_entries") else "practice_entries"
        )

        counts["sessions"] = reader.count("sessions")
        turns = [r for r in reader.rows("turns")]
        session_ids = {r["id"] for r in reader.rows("sessions")}
        kept_turns = []
        for row in turns:
            if row["session_id"] not in session_ids:
                counts["skipped_orphan_turns"] += 1
                continue
            kept_turns.append(row)
        counts["turns"] = len(kept_turns)

        turn_ids = {r["id"] for r in kept_turns}
        events = reader.rows("turn_events")
        kept_events = [r for r in events if r["turn_id"] in turn_ids]
        counts["turn_events"] = len(kept_events)
        counts["skipped_orphan_events"] = len(events) - len(kept_events)

        entries = reader.rows(practice_table)
        counts["practice_entries"] = len(entries)

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
                                 deleted_at=EXCLUDED.deleted_at"""
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

                for row in kept_turns:
                    legacy_status = row["status"]
                    status = "succeeded" if legacy_status == "completed" else legacy_status
                    await db.execute(
                        text(
                            """INSERT INTO turns (id,owner_user_id,session_id,capability,status,error,
                                 failure_code,retryable,state_version,assistant_message_id,
                                 created_at,updated_at,finished_at)
                               VALUES (:id,:owner,:session,:capability,:status,:error,:failure_code,:retryable,
                                 :version,:assistant_message_id,:created,:updated,:finished)
                               ON CONFLICT (id) DO UPDATE SET
                                 status=EXCLUDED.status, error=EXCLUDED.error,
                                 failure_code=EXCLUDED.failure_code, retryable=EXCLUDED.retryable,
                                 updated_at=EXCLUDED.updated_at, finished_at=EXCLUDED.finished_at"""
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
                            "assistant_message_id": row["assistant_message_id"],
                            "created": epoch(row["created_at"]),
                            "updated": epoch(row["updated_at"]),
                            "finished": epoch(row["finished_at"]),
                        },
                    )

                for row in kept_events:
                    await db.execute(
                        text(
                            """INSERT INTO turn_events (owner_user_id,turn_id,seq,type,source,stage,
                                 content,metadata_json,created_at)
                               VALUES (:owner,:turn,:seq,:type,:source,:stage,:content,
                                 CAST(:metadata AS JSONB),:created)
                               ON CONFLICT (turn_id,seq) DO UPDATE SET
                                 type=EXCLUDED.type, source=EXCLUDED.source, stage=EXCLUDED.stage,
                                 content=EXCLUDED.content, metadata_json=EXCLUDED.metadata_json,
                                 created_at=EXCLUDED.created_at"""
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
                    entry_id = legacy_practice_entry_id(path, row["id"])
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

                for state_row, event_row in kept_reviews:
                    entry_id = legacy_practice_entry_id(path, state_row["entry_id"])
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
        kept_interactions = [r for r in interactions if r["path_id"] in path_ids]
        kept_events = [r for r in events if r["path_id"] in path_ids]
        counts["mastery_paths"] = len(paths)
        counts["mastery_interactions"] = len(kept_interactions)
        counts["mastery_events"] = len(kept_events)
        counts["skipped_orphan_interactions"] = len(interactions) - len(kept_interactions)
        counts["skipped_orphan_events"] = len(events) - len(kept_events)

        if not execute:
            return counts

        engine = create_async_engine(os.environ["DATABASE_URL"])
        try:
            async with engine.begin() as db:
                await ensure_owner(db, owner, str(path))

                for row in paths:
                    await db.execute(
                        text(
                            """INSERT INTO mastery_paths (path_id,owner_user_id,revision,state_json,
                                 created_at,updated_at)
                               VALUES (:path,:owner,:revision,CAST(:state AS JSONB),:created,:updated)
                               ON CONFLICT (path_id) DO UPDATE SET
                                 revision=GREATEST(mastery_paths.revision, EXCLUDED.revision),
                                 state_json=EXCLUDED.state_json,
                                 updated_at=EXCLUDED.updated_at"""
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
                                 result_json=EXCLUDED.result_json, updated_at=EXCLUDED.updated_at"""
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

                for row in kept_events:
                    await db.execute(
                        text(
                            """INSERT INTO mastery_events (id,owner_user_id,path_id,revision,event_type,
                                 payload_json,session_id,turn_id,created_at)
                               VALUES (:id,:owner,:path,:revision,:event,CAST(:payload AS JSONB),
                                 :session,:turn,:created)
                               ON CONFLICT (id) DO UPDATE SET
                                 revision=GREATEST(mastery_events.revision, EXCLUDED.revision),
                                 event_type=EXCLUDED.event_type, payload_json=EXCLUDED.payload_json"""
                        ),
                        {
                            "id": legacy_uuid(
                                str(path), "mastery_events", row["path_id"], str(row["id"])
                            ),
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
    owner = args.owner
    summary: dict[str, dict[str, int]] = {}
    if chat_db.exists():
        summary[str(chat_db)] = await migrate_chat_db(
            chat_db, owner_for(chat_db, owner), not args.dry_run
        )
    if mastery_db.exists():
        summary[str(mastery_db)] = await migrate_mastery(
            mastery_db, owner_for(mastery_db, owner), not args.dry_run
        )

    report = {
        "mode": "dry-run" if args.dry_run else "execute",
        "owner": owner,
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
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
