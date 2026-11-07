"""Atomic PostgreSQL pairing-code exchange across API workers."""

from __future__ import annotations

from contextlib import contextmanager
import secrets
import time

import psycopg
from psycopg.rows import dict_row

from deeptutor.services.postgres.database import database_url

from .session_handoff import (
    CODE_LIFETIME_SECONDS, CREATE_RATE_LIMIT, MAX_CODE_ATTEMPTS,
    STATE_RETENTION_SECONDS, TICKET_LIFETIME_SECONDS, HandoffRecord,
    HandoffRejected, HandoffRateLimited, decrypt_ticket_payload,
    encrypt_ticket_payload, hash_secret,
)


class PostgresSessionHandoffStore:
    @staticmethod
    @contextmanager
    def _connect():
        url = database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
        with psycopg.connect(url, row_factory=dict_row) as conn:
            yield conn

    @staticmethod
    def _cleanup(conn, current: int) -> None:
        conn.execute("DELETE FROM session_handoff_records WHERE expires_at + %s < %s",
                     (STATE_RETENTION_SECONDS, current))
        conn.execute("DELETE FROM session_handoff_rate_limits WHERE window_start + 3600 < %s",
                     (current,))

    def _rate_limit(self, bucket: str, limit: tuple[int, int], *, now: int | None) -> None:
        current = int(time.time() if now is None else now)
        max_count, window_seconds = limit
        start = current - current % window_seconds
        with self._connect() as conn:
            row = conn.execute("""INSERT INTO session_handoff_rate_limits
                (bucket,window_start,count) VALUES (%s,%s,1)
                ON CONFLICT(bucket) DO UPDATE SET
                    window_start=excluded.window_start,
                    count=CASE WHEN session_handoff_rate_limits.window_start=excluded.window_start
                        THEN session_handoff_rate_limits.count+1 ELSE 1 END
                RETURNING count""", (bucket, start)).fetchone()
        if row["count"] > max_count:
            raise HandoffRateLimited("Too many handoff requests")

    def create(
        self, *, encrypted_ticket: str, ticket_hash: str, public_host: str,
        now: int | None = None, code_lifetime: int = CODE_LIFETIME_SECONDS,
        rate_key: str = "unknown",
    ) -> HandoffRecord:
        current = int(time.time() if now is None else now)
        self._rate_limit(f"create:{rate_key}", CREATE_RATE_LIMIT, now=now)
        code = secrets.token_urlsafe(32)
        expires_at = current + code_lifetime
        with self._connect() as conn:
            self._cleanup(conn, current)
            conn.execute("""INSERT INTO session_handoff_records
                (code_hash,ticket_hash,encrypted_ticket,public_host,expires_at,created_at)
                VALUES (%s,%s,%s,%s,%s,%s)""", (
                    hash_secret(code), ticket_hash, encrypted_ticket, public_host,
                    expires_at, current,
                ))
        return HandoffRecord(code, encrypted_ticket, public_host, expires_at)

    def exchange(self, *, code: str, public_host: str, now: int | None = None) -> str:
        current = int(time.time() if now is None else now)
        code_hash = hash_secret(code)
        rejection = "Invalid pairing code"
        fresh_ticket = ""
        with self._connect() as conn:
            self._cleanup(conn, current)
            row = conn.execute("""SELECT encrypted_ticket,public_host,expires_at,
                code_consumed_at,failed_attempts FROM session_handoff_records
                WHERE code_hash=%s FOR UPDATE""", (code_hash,)).fetchone()
            if row is None or row["code_consumed_at"] is not None:
                pass
            elif row["expires_at"] <= current:
                conn.execute("DELETE FROM session_handoff_records WHERE code_hash=%s", (code_hash,))
            elif row["public_host"] != public_host:
                rejection = "Pairing code is not valid for this site"
                attempts = int(row["failed_attempts"]) + 1
                if attempts >= MAX_CODE_ATTEMPTS:
                    conn.execute("DELETE FROM session_handoff_records WHERE code_hash=%s", (code_hash,))
                else:
                    conn.execute("""UPDATE session_handoff_records SET failed_attempts=%s
                        WHERE code_hash=%s""", (attempts, code_hash))
            else:
                claims = decrypt_ticket_payload(row["encrypted_ticket"])
                claims["exp"] = current + TICKET_LIFETIME_SECONDS
                fresh_ticket = encrypt_ticket_payload(claims)
                conn.execute("""UPDATE session_handoff_records SET code_consumed_at=%s,
                    failed_attempts=0,encrypted_ticket=%s,ticket_hash=%s
                    WHERE code_hash=%s""", (
                        current, fresh_ticket, hash_secret(fresh_ticket), code_hash,
                    ))
        if not fresh_ticket:
            raise HandoffRejected(rejection)
        return fresh_ticket

    def consume_ticket(
        self, *, ticket: str, public_host: str, now: int | None = None,
    ) -> str:
        current = int(time.time() if now is None else now)
        ticket_hash = hash_secret(ticket)
        rejection = "Invalid handoff ticket"
        accepted = False
        with self._connect() as conn:
            self._cleanup(conn, current)
            row = conn.execute("""SELECT encrypted_ticket,public_host,expires_at,
                ticket_consumed_at,code_consumed_at FROM session_handoff_records
                WHERE ticket_hash=%s FOR UPDATE""", (ticket_hash,)).fetchone()
            invalid = (row is None or row["ticket_consumed_at"] is not None
                       or row["code_consumed_at"] is None
                       or row["code_consumed_at"] + TICKET_LIFETIME_SECONDS <= current)
            if invalid:
                if row is not None:
                    conn.execute("DELETE FROM session_handoff_records WHERE ticket_hash=%s",
                                 (ticket_hash,))
            elif row["public_host"] != public_host:
                rejection = "Handoff ticket is not valid for this site"
            elif row["encrypted_ticket"] != ticket:
                pass
            else:
                conn.execute("""UPDATE session_handoff_records SET ticket_consumed_at=%s
                    WHERE ticket_hash=%s""", (current, ticket_hash))
                accepted = True
        if not accepted:
            raise HandoffRejected(rejection)
        return ticket
