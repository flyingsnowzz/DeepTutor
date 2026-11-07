"""Compare imported first-party records with a frozen SQLite source.

Run with the table-owner migration connection against the target database.
The source is opened read-only; this command never changes either store.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sqlite3
from typing import Any

import psycopg


def _json(value: Any, default: Any) -> Any:
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)


def _compare(label: str, source: dict, target: dict) -> None:
    missing = set(source) - set(target)
    extra = set(target) - set(source)
    changed = {key for key in set(source) & set(target) if source[key] != target[key]}
    print(
        f"{label}: source={len(source)} postgres={len(target)} "
        f"missing={len(missing)} extra={len(extra)} changed={len(changed)}"
    )
    if missing or extra or changed:
        raise ValueError(f"{label} reconciliation failed")


def verify(home: Path, owner: str, database_url: str) -> None:
    chat = home / "chat_history.db"
    if not chat.is_file():
        raise FileNotFoundError(chat)
    pg_url = database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    with (
        sqlite3.connect(f"file:{chat.resolve()}?mode=ro", uri=True) as source,
        psycopg.connect(pg_url) as target,
    ):
        source.row_factory = sqlite3.Row
        _compare(
            "sessions",
            {r["id"]: r["title"] for r in source.execute("SELECT id,title FROM sessions")},
            {r[0]: r[1] for r in target.execute(
                "SELECT id,title FROM sessions WHERE owner_user_id=%s", (owner,)
            )},
        )
        _compare(
            "messages",
            {r["id"]: (r["session_id"], r["role"], r["content"] or "")
             for r in source.execute("SELECT id,session_id,role,content FROM messages")},
            {r[0]: (r[1], r[2], r[3]) for r in target.execute(
                "SELECT legacy_message_id,session_id,role,content FROM messages "
                "WHERE owner_user_id=%s", (owner,)
            )},
        )
        _compare(
            "turns",
            {r["id"]: (r["session_id"],
                       "succeeded" if r["status"] == "completed" else r["status"])
             for r in source.execute("SELECT id,session_id,status FROM turns")},
            {r[0]: (r[1], r[2]) for r in target.execute(
                "SELECT id,session_id,status FROM turns WHERE owner_user_id=%s", (owner,)
            )},
        )
        _compare(
            "turn_events",
            {(r["turn_id"], r["seq"]): (
                r["type"], r["source"] or "", r["stage"] or "",
                r["content"] or "", _json(r["metadata_json"], {}),
            ) for r in source.execute(
                "SELECT turn_id,seq,type,source,stage,content,metadata_json FROM turn_events"
            )},
            {(r[0], r[1]): (r[2], r[3], r[4], r[5], r[6]) for r in target.execute(
                "SELECT turn_id,seq,type,source,stage,content,metadata_json "
                "FROM turn_events WHERE owner_user_id=%s", (owner,)
            )},
        )

        mastery = home / "workspace/learning/mastery/mastery.sqlite3"
        if mastery.is_file():
            with sqlite3.connect(f"file:{mastery.resolve()}?mode=ro", uri=True) as learning:
                learning.row_factory = sqlite3.Row
                _compare(
                    "mastery_paths",
                    {r["path_id"]: (r["revision"], _json(r["state_json"], {}))
                     for r in learning.execute(
                         "SELECT path_id,revision,state_json FROM mastery_paths"
                     )},
                    {r[0]: (r[1], r[2]) for r in target.execute(
                        "SELECT path_id,revision,state_json FROM mastery_paths "
                        "WHERE owner_user_id=%s", (owner,)
                    )},
                )
                _compare(
                    "mastery_events",
                    {(r["path_id"], r["revision"], r["event_type"]): (
                        _json(r["payload_json"], {}), r["session_id"] or "", r["turn_id"] or "",
                    ) for r in learning.execute(
                        "SELECT path_id,revision,event_type,payload_json,session_id,turn_id "
                        "FROM mastery_events"
                    )},
                    {(r[0], r[1], r[2]): (r[3], r[4] or "", r[5] or "")
                     for r in target.execute(
                         "SELECT path_id,revision,event_type,payload_json,session_id,turn_id "
                         "FROM mastery_events WHERE owner_user_id=%s", (owner,)
                     )},
                )
        else:
            for table in ("mastery_paths", "mastery_events"):
                rows = target.execute(
                    f"SELECT 1 FROM {table} WHERE owner_user_id=%s LIMIT 1", (owner,)
                ).fetchall()
                _compare(table, {}, {0: True} if rows else {})

        usage = home / "usage.sqlite3"
        if usage.is_file():
            with sqlite3.connect(f"file:{usage.resolve()}?mode=ro", uri=True) as ledger:
                ledger.row_factory = sqlite3.Row
                _compare(
                    "llm_calls",
                    {r["call_id"]: (
                        r["session_id"] or "", r["turn_id"] or "", r["source"] or "",
                        _json(r["usage_json"], {}),
                    ) for r in ledger.execute(
                        "SELECT call_id,session_id,turn_id,source,usage_json FROM llm_calls"
                    )},
                    {r[0]: (r[1] or "", r[2] or "", r[3] or "", r[4])
                     for r in target.execute(
                         "SELECT call_id,session_id,turn_id,source,usage_json "
                         "FROM llm_call_ledger WHERE owner_user_id=%s", (owner,)
                     )},
                )
        else:
            rows = target.execute(
                "SELECT 1 FROM llm_call_ledger WHERE owner_user_id=%s LIMIT 1", (owner,)
            ).fetchall()
            _compare("llm_calls", {}, {0: True} if rows else {})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, required=True, help="Frozen SQLite user home")
    parser.add_argument("--owner", required=True, help="PostgreSQL owner user ID")
    args = parser.parse_args()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        parser.error("DATABASE_URL is required")
    verify(args.home, args.owner, database_url)


if __name__ == "__main__":
    main()
