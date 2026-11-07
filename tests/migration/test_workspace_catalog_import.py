from __future__ import annotations

import json
import hashlib
import os
from pathlib import Path
import sqlite3
import uuid

import psycopg
import pytest

from scripts.migration.sqlite_to_postgres.migrate import migrate_workspace_catalog_db
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.multi_user.paths import user_context
from deeptutor.services.workspace import get_content_workspace_service
from deeptutor.services.workspace.models import WorkspaceItem


@pytest.mark.asyncio
async def test_workspace_import_uses_postgres_without_creating_local_sqlite(
    tmp_path: Path, monkeypatch,
) -> None:
    admin_url = os.environ.get("TEST_DATABASE_ADMIN_URL")
    if not admin_url:
        pytest.skip("requires PostgreSQL admin URL for disposable owner cleanup")
    monkeypatch.setenv("DATABASE_URL", admin_url)
    monkeypatch.delenv("DEEPTUTOR_STORAGE_BACKEND", raising=False)
    monkeypatch.delenv("DEEPTUTOR_ACCOUNT_BACKEND", raising=False)
    owner = "legacy_" + uuid.uuid4().hex[:16]
    old_ids = {kind: "ws_" + uuid.uuid4().hex for kind in ("system", "general")}
    source = tmp_path / "source.sqlite3"
    with sqlite3.connect(source) as db:
        db.execute("CREATE TABLE workspaces(id TEXT PRIMARY KEY,payload TEXT NOT NULL)")
        for kind in ("system", "general"):
            db.execute(
                "INSERT INTO workspaces VALUES (?,?)",
                (old_ids[kind], json.dumps({
                    "workspace_id": old_ids[kind],
                    "owner_id": "local-admin",
                    "kind": kind,
                    "path": "/old/local/path",
                })),
            )
    target = tmp_path / "target"
    try:
        counts = await migrate_workspace_catalog_db(source, owner, True, target_root=target)
        assert counts["source_builtin_workspaces"] == 2
        assert not list(target.rglob("*.sqlite3"))
        assert os.environ.get("DEEPTUTOR_STORAGE_BACKEND") is None
        with psycopg.connect(admin_url.replace("postgresql+asyncpg://", "postgresql://", 1)) as db:
            row = db.execute(
                "SELECT state_json FROM workspace_catalog_states WHERE owner_user_id=%s", (owner,)
            ).fetchone()
            assert row is not None
            new_ids = {item["id"] for item in row[0]["workspaces"]}
            assert not new_ids.intersection(old_ids.values())
            aliases = {
                item["key"]: json.loads(item["value"])
                for item in row[0]["metadata"]
            }["legacy_presentation_aliases"]
            assert aliases[old_ids["general"]] in new_ids
        monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
        monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
        item_id = "wsi_" + uuid.uuid4().hex
        blob_bytes = b"legacy-presentation-content"
        digest = hashlib.sha256(blob_bytes).hexdigest()
        private = target / "user/.runtime/workspace_presentations" / old_ids["general"]
        (private / "items").mkdir(parents=True)
        (private / "blobs").mkdir()
        (private / "blobs" / digest).write_bytes(blob_bytes)
        item = WorkspaceItem(
            workspace_id=old_ids["general"], workspace_item_id=item_id,
            relative_path="outputs/legacy.txt", filename="legacy.txt",
            mime_type="text/plain", size_bytes=len(blob_bytes), sha256=digest,
            url=f"/files/workspace-items/{old_ids['general']}/{item_id}",
        )
        (private / "items" / f"{item_id}.json").write_text(json.dumps(item.to_dict()))
        user = CurrentUser(
            id=owner, username=owner, role="user",
            scope=UserScope(kind="user", user_id=owner, root=target),
        )
        with user_context(user):
            resolved, record = get_content_workspace_service().resolve_published_item(
                old_ids["general"], item_id
            )
            assert resolved.read_bytes() == blob_bytes
            assert record.workspace_item_id == item_id
    finally:
        with psycopg.connect(admin_url.replace("postgresql+asyncpg://", "postgresql://", 1)) as db:
            db.execute("DELETE FROM migration_batches WHERE owner_user_id=%s", (owner,))
            db.execute("DELETE FROM workspace_catalog_states WHERE owner_user_id=%s", (owner,))
            db.execute("DELETE FROM subscriptions WHERE owner_user_id=%s", (owner,))
            db.execute("DELETE FROM users WHERE id=%s", (owner,))
