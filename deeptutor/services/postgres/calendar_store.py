"""PostgreSQL-authoritative calendar with transient recurrence transactions."""

from __future__ import annotations

from contextlib import contextmanager
import sqlite3

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from deeptutor.services.calendar.models import CalendarEntry
from deeptutor.services.calendar.store import CalendarStore, now
from deeptutor.services.postgres.database import database_url
from deeptutor.services.storage_backend import postgres_owner_user_id


def empty_calendar_state() -> dict:
    stamp = now()
    entry = CalendarEntry(
        id="default", name="", color="#2f6fde", visible=True,
        position=0, is_default=True, created_at=stamp, updated_at=stamp,
    )
    return {"calendars": [{"id": entry.id, "payload": entry.model_dump_json()}],
            "events": [], "undo": []}


class PostgresCalendarStore(CalendarStore):
    """Persist the entire account calendar atomically; SQLite is memory-only logic.

    CalendarStore's recurrence and undo operations run against a fresh :memory:
    transaction. Only the PostgreSQL row survives the request. A row lock
    serializes all mutations for one account, including across API workers.
    """

    def __init__(self, owner_user_id: str | None = None):
        self.owner_user_id = owner_user_id or postgres_owner_user_id()

    @staticmethod
    def _hydrate(db: sqlite3.Connection, state: dict, revision: int) -> None:
        db.executescript("""
            CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
            CREATE TABLE calendars(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
            CREATE TABLE events(id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL REFERENCES calendars(id),
                series_id TEXT, payload TEXT NOT NULL);
            CREATE INDEX events_calendar ON events(calendar_id);
            CREATE INDEX events_series ON events(series_id);
            CREATE TABLE undo(token TEXT PRIMARY KEY, created_at TEXT NOT NULL,
                before_json TEXT NOT NULL, after_json TEXT NOT NULL);
        """)
        db.execute("INSERT INTO state VALUES(1,?)", (revision,))
        db.executemany("INSERT INTO calendars VALUES(?,?)",
                       [(r["id"], r["payload"]) for r in state["calendars"]])
        db.executemany("INSERT INTO events VALUES(?,?,?,?)", [
            (r["id"], r["calendar_id"], r["series_id"], r["payload"])
            for r in state["events"]
        ])
        db.executemany("INSERT INTO undo VALUES(?,?,?,?)", [
            (r["token"], r["created_at"], r["before_json"], r["after_json"])
            for r in state["undo"]
        ])
        db.commit()

    @staticmethod
    def _snapshot(db: sqlite3.Connection) -> tuple[int, dict]:
        revision = db.execute("SELECT revision FROM state WHERE id=1").fetchone()[0]
        state = {
            "calendars": [dict(zip(("id", "payload"), r)) for r in db.execute(
                "SELECT id,payload FROM calendars ORDER BY rowid")],
            "events": [dict(zip(("id", "calendar_id", "series_id", "payload"), r))
                       for r in db.execute("SELECT id,calendar_id,series_id,payload FROM events ORDER BY rowid")],
            "undo": [dict(zip(("token", "created_at", "before_json", "after_json"), r))
                     for r in db.execute("SELECT token,created_at,before_json,after_json FROM undo ORDER BY rowid")],
        }
        return revision, state

    @contextmanager
    def connect(self, *, write=False):
        url = database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
        with psycopg.connect(url, row_factory=dict_row) as pg:
            pg.execute("SELECT set_config('app.user_id', %s, true)", (self.owner_user_id,))
            if write:
                pg.execute("""INSERT INTO calendar_states(owner_user_id,revision,state_json)
                    VALUES (%s,0,%s) ON CONFLICT DO NOTHING""",
                    (self.owner_user_id, Jsonb(empty_calendar_state())))
            row = pg.execute(
                "SELECT revision,state_json FROM calendar_states WHERE owner_user_id=%s" +
                (" FOR UPDATE" if write else ""), (self.owner_user_id,),
            ).fetchone()
            state = row["state_json"] if row else empty_calendar_state()
            revision = row["revision"] if row else 0
            db = sqlite3.connect(":memory:", isolation_level=None)
            db.execute("PRAGMA foreign_keys=ON")
            try:
                self._hydrate(db, state, revision)
                if write:
                    db.execute("BEGIN IMMEDIATE")
                yield db
                if write:
                    new_revision, new_state = self._snapshot(db)
                    pg.execute("""UPDATE calendar_states SET revision=%s,state_json=%s
                        WHERE owner_user_id=%s""",
                        (new_revision, Jsonb(new_state), self.owner_user_id))
            finally:
                db.close()
