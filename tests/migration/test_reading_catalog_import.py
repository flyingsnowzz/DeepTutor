import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from deeptutor.reading.catalog_models import IngestionStatus, SourceKind
from deeptutor.reading.catalog_store import ReadingCatalogStore
from scripts.migration.sqlite_to_postgres.migrate import migrate_reading_catalog_db


@pytest.mark.asyncio
async def test_reading_catalog_import_is_owned_and_idempotent(tmp_path):
    import os

    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL required")
    local = ReadingCatalogStore(tmp_path / "reading")
    material = local.upsert_material(
        content_id="b" * 16, filename="book.pdf", title="Book",
        source_kind=SourceKind.FILE, status=IngestionStatus.READY,
    )
    owner = "reading_" + uuid.uuid4().hex[:12]
    engine = create_async_engine(url)
    try:
        counts = await migrate_reading_catalog_db(local.db_path, owner, False)
        assert counts["reading_materials"] == 1
        await migrate_reading_catalog_db(local.db_path, owner, True)
        await migrate_reading_catalog_db(local.db_path, owner, True)
        async with engine.connect() as db:
            state = (await db.execute(text("""SELECT state_json FROM reading_catalog_states
                WHERE owner_user_id=:owner AND workspace_id=''"""),
                {"owner": owner})).scalar_one()
            assert state["reading_materials"][0]["material_id"] == material.material_id
        local.update_material_status(material.material_id, IngestionStatus.FAILED)
        with pytest.raises(RuntimeError, match="reconcile"):
            await migrate_reading_catalog_db(local.db_path, owner, True)
    finally:
        async with engine.begin() as db:
            await db.execute(text("DELETE FROM migration_batches WHERE owner_user_id=:owner"), {"owner": owner})
            await db.execute(text("DELETE FROM reading_catalog_states WHERE owner_user_id=:owner"), {"owner": owner})
            await db.execute(text("DELETE FROM subscriptions WHERE owner_user_id=:owner"), {"owner": owner})
            await db.execute(text("DELETE FROM users WHERE id=:owner"), {"owner": owner})
        await engine.dispose()
