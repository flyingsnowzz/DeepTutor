"""PostgreSQL metadata for the existing disk-backed file library."""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import time
import uuid

import psycopg
from psycopg.rows import dict_row

from deeptutor.services.postgres.database import database_url
from deeptutor.services.storage.file_library import FileLibraryStore, _sha256
from deeptutor.services.storage_backend import postgres_owner_user_id


class PostgresFileLibraryStore(FileLibraryStore):
    def __init__(self, root: Path) -> None:
        self._root = root.resolve()

    @contextmanager
    def _connect_pg(self):
        owner = postgres_owner_user_id()
        url = database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
        with psycopg.connect(url, row_factory=dict_row) as conn:
            conn.execute("SELECT set_config('app.user_id', %s, true)", (owner,))
            yield conn, owner

    def _add_file_sync(self, data: bytes, filename: str, mime_type: str):
        sha = _sha256(data)
        now = time.time()
        with self._connect_pg() as (conn, owner):
            existing = conn.execute(
                "SELECT * FROM library_files_pg WHERE owner_user_id=%s AND sha256=%s AND NOT is_deleted",
                (owner, sha),
            ).fetchone()
            if existing:
                return self._row_to_entry(existing)
            file_id = str(uuid.uuid4())
            library_path = file_id + Path(filename).suffix
            self._write_file(library_path, data)
            try:
                row = conn.execute(
                    """INSERT INTO library_files_pg
                       (owner_user_id,id,sha256,filename,mime_type,size_bytes,library_path,
                        created_at,updated_at,is_deleted)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,false)
                       ON CONFLICT DO NOTHING RETURNING *""",
                    (owner, file_id, sha, filename, mime_type, len(data), library_path, now, now),
                ).fetchone()
                if row:
                    return self._row_to_entry(row)
                self._delete_file(library_path)
                winner = conn.execute(
                    "SELECT * FROM library_files_pg WHERE owner_user_id=%s AND sha256=%s AND NOT is_deleted",
                    (owner, sha),
                ).fetchone()
                if winner is None:
                    raise RuntimeError("Concurrent file library insertion could not be resolved")
                return self._row_to_entry(winner)
            except BaseException:
                self._delete_file(library_path)
                raise

    def _get_file_sync(self, file_id: str):
        with self._connect_pg() as (conn, owner):
            row = conn.execute(
                "SELECT * FROM library_files_pg WHERE owner_user_id=%s AND id=%s",
                (owner, file_id),
            ).fetchone()
            return self._row_to_entry(row) if row else None

    def _delete_file_sync(self, file_id: str) -> bool:
        now = time.time()
        with self._connect_pg() as (conn, owner):
            row = conn.execute(
                """UPDATE library_files_pg SET is_deleted=true, deleted_at=%s, updated_at=%s
                   WHERE owner_user_id=%s AND id=%s AND NOT is_deleted RETURNING id""",
                (now, now, owner, file_id),
            ).fetchone()
            return bool(row or conn.execute(
                "SELECT 1 FROM library_files_pg WHERE owner_user_id=%s AND id=%s",
                (owner, file_id),
            ).fetchone())

    def _hard_delete_file_sync(self, file_id: str) -> bool:
        with self._connect_pg() as (conn, owner):
            row = conn.execute(
                """DELETE FROM library_files_pg WHERE owner_user_id=%s AND id=%s AND is_deleted
                   RETURNING library_path""", (owner, file_id),
            ).fetchone()
        if row:
            self._delete_file(row["library_path"])
        return bool(row)

    def _restore_file_sync(self, file_id: str) -> bool:
        now = time.time()
        with self._connect_pg() as (conn, owner):
            row = conn.execute(
                """UPDATE library_files_pg SET is_deleted=false, deleted_at=NULL, updated_at=%s
                   WHERE owner_user_id=%s AND id=%s AND is_deleted RETURNING id""",
                (now, owner, file_id),
            ).fetchone()
            return bool(row or conn.execute(
                "SELECT 1 FROM library_files_pg WHERE owner_user_id=%s AND id=%s",
                (owner, file_id),
            ).fetchone())

    def _list_files_sync(self, limit: int, offset: int):
        with self._connect_pg() as (conn, owner):
            rows = conn.execute(
                """SELECT * FROM library_files_pg WHERE owner_user_id=%s AND NOT is_deleted
                   ORDER BY created_at DESC,id DESC LIMIT %s OFFSET %s""",
                (owner, limit, offset),
            ).fetchall()
            return [self._row_to_entry(row) for row in rows]

    def _search_files_sync(self, query: str):
        if not query:
            return []
        with self._connect_pg() as (conn, owner):
            rows = conn.execute(
                """SELECT * FROM library_files_pg WHERE owner_user_id=%s AND NOT is_deleted
                   AND filename ILIKE %s ORDER BY created_at DESC,id DESC""",
                (owner, f"%{query}%"),
            ).fetchall()
            return [self._row_to_entry(row) for row in rows]

    def resolve_path(self, file_id: str):
        entry = self._get_file_sync(file_id)
        if not entry or entry["is_deleted"]:
            return None
        path = self._file_path(entry["library_path"])
        return path if path.is_file() else None
