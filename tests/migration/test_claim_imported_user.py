from __future__ import annotations

import os
import uuid

import psycopg
import pytest

from scripts.migration.sqlite_to_postgres.claim import claim
from deeptutor.services.accounts.first_party import FirstPartyAccountService
from deeptutor.services.postgres.database import authentication_database_url, create_engine


@pytest.mark.asyncio
async def test_claim_preserves_import_owner_and_enables_login(monkeypatch) -> None:
    admin_url = os.environ.get("TEST_DATABASE_ADMIN_URL")
    if not admin_url:
        pytest.skip("requires PostgreSQL admin URL for disposable owner cleanup")
    monkeypatch.setenv("DATABASE_URL", admin_url)
    owner = "legacy_" + uuid.uuid4().hex[:16]
    username = "imported_" + uuid.uuid4().hex[:12]
    password = "staging-" + uuid.uuid4().hex
    sync_url = admin_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(sync_url) as db:
        db.execute("INSERT INTO users(id,role) VALUES (%s,'user')", (owner,))
        db.execute(
            "INSERT INTO migration_batches(owner_user_id,source_kind,source_path,checksum_sha256) "
            "VALUES (%s,'chat_history',%s,%s)",
            (owner, "/tmp/claim-test-" + owner, "test-checksum"),
        )
    try:
        assert await claim(owner, username) == "ready"
        with psycopg.connect(sync_url) as db:
            assert db.execute(
                "SELECT username FROM users WHERE id=%s", (owner,)
            ).fetchone() == (None,)
        assert await claim(owner, username, password) == "claimed"
        auth_engine = create_engine(authentication_database_url())
        try:
            authenticated = await FirstPartyAccountService(auth_engine).authenticate(
                username, password
            )
        finally:
            await auth_engine.dispose()
        assert authenticated is not None
        assert authenticated["id"] == owner
        with pytest.raises(ValueError, match="already claimed"):
            await claim(owner, username, password)
        with psycopg.connect(sync_url) as db:
            assert db.execute(
                "SELECT count(*) FROM migration_batches WHERE owner_user_id=%s", (owner,)
            ).fetchone()[0] == 1
    finally:
        with psycopg.connect(sync_url) as db:
            for table in (
                "auth_identities", "first_party_credentials", "subscriptions",
                "migration_batches",
            ):
                db.execute(f"DELETE FROM {table} WHERE owner_user_id=%s", (owner,))
            db.execute("DELETE FROM users WHERE id=%s", (owner,))
