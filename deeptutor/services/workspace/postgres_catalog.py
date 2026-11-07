"""PostgreSQL-authoritative workspace catalog with transient SQL transactions."""

from __future__ import annotations

from contextlib import contextmanager
import sqlite3
from typing import Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from deeptutor.services.postgres.database import database_url


def snapshot(db: sqlite3.Connection) -> dict[str, list[dict[str, str]]]:
    return {
        "workspaces": [{"id": row[0], "payload": row[1]}
                       for row in db.execute("SELECT id,payload FROM workspaces ORDER BY rowid")],
        "metadata": [{"key": row[0], "value": row[1]}
                     for row in db.execute("SELECT key,value FROM metadata ORDER BY rowid")],
    }


@contextmanager
def postgres_workspace_catalog_connection(owner: str) -> Iterator[sqlite3.Connection]:
    url = database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(url, row_factory=dict_row) as pg:
        pg.execute("SELECT set_config('app.user_id', %s, true)", (owner,))
        pg.execute("""INSERT INTO workspace_catalog_states(owner_user_id,revision,state_json)
            VALUES (%s,0,%s) ON CONFLICT DO NOTHING""",
            (owner, Jsonb({"workspaces": [], "metadata": []})))
        row = pg.execute("""SELECT revision,state_json FROM workspace_catalog_states
            WHERE owner_user_id=%s FOR UPDATE""", (owner,)).fetchone()
        db = sqlite3.connect(":memory:", isolation_level=None)
        try:
            db.execute("CREATE TABLE workspaces (id TEXT PRIMARY KEY,payload TEXT NOT NULL)")
            db.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL)")
            state = row["state_json"]
            db.executemany("INSERT INTO workspaces VALUES (?,?)", [
                (item["id"], item["payload"]) for item in state["workspaces"]
            ])
            db.executemany("INSERT INTO metadata VALUES (?,?)", [
                (item["key"], item["value"]) for item in state["metadata"]
            ])
            baseline = db.total_changes
            with db:
                yield db
            if db.total_changes != baseline:
                pg.execute("""UPDATE workspace_catalog_states SET revision=%s,state_json=%s
                    WHERE owner_user_id=%s""", (
                        row["revision"] + 1, Jsonb(snapshot(db)), owner,
                    ))
        finally:
            db.close()
