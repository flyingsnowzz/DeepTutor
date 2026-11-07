"""PostgreSQL-authoritative reading catalog with transient SQL projection."""

from __future__ import annotations

from contextlib import contextmanager
import sqlite3
from typing import Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from deeptutor.services.postgres.database import database_url

_TABLES = (
    "reading_materials", "reading_workspaces", "reading_workspace_materials",
    "reading_workspace_sessions", "reading_session_links",
)


def snapshot(conn: sqlite3.Connection) -> dict[str, list[dict]]:
    return {table: [dict(row) for row in conn.execute(f"SELECT * FROM {table} ORDER BY rowid")]
            for table in _TABLES}


def _hydrate(conn: sqlite3.Connection, state: dict) -> None:
    from deeptutor.reading.catalog_store import _SCHEMA_SQL

    conn.executescript(_SCHEMA_SQL)
    for table in _TABLES:
        allowed = {item[1] for item in conn.execute(f"PRAGMA table_info({table})")}
        for row in state.get(table, []):
            columns = list(row)
            if not columns or any(column not in allowed for column in columns):
                raise ValueError("Invalid reading catalog column")
            marks = ",".join("?" for _ in columns)
            names = ",".join(f'"{column}"' for column in columns)
            conn.execute(f"INSERT INTO {table} ({names}) VALUES ({marks})", tuple(row.values()))
    conn.execute("UPDATE reading_schema SET version=3")
    conn.commit()


@contextmanager
def postgres_catalog_connection(owner: str, workspace: str) -> Iterator[sqlite3.Connection]:
    """Serialize one owner's catalog edits; no SQLite file is ever opened."""
    url = database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(url, row_factory=dict_row) as pg:
        pg.execute("SELECT set_config('app.user_id', %s, true)", (owner,))
        pg.execute("""INSERT INTO reading_catalog_states
            (owner_user_id,workspace_id,revision,state_json)
            VALUES (%s,%s,0,%s) ON CONFLICT DO NOTHING""",
            (owner, workspace, Jsonb({table: [] for table in _TABLES})))
        row = pg.execute("""SELECT revision,state_json FROM reading_catalog_states
            WHERE owner_user_id=%s AND workspace_id=%s FOR UPDATE""",
            (owner, workspace)).fetchone()
        db = sqlite3.connect(":memory:")
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            _hydrate(db, row["state_json"])
            before = db.total_changes
            with db:
                yield db
            if db.total_changes != before:
                pg.execute("""UPDATE reading_catalog_states SET
                    revision=%s,state_json=%s WHERE owner_user_id=%s AND workspace_id=%s""",
                    (row["revision"] + 1, Jsonb(snapshot(db)), owner, workspace))
        finally:
            db.close()
