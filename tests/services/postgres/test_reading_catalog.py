from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.reading.catalog_models import IngestionStatus, SourceKind
from deeptutor.reading.catalog_store import ReadingCatalogStore
from deeptutor.reading.store import ReadingStore


def test_postgres_reading_catalog_owner_and_material_links(two_owners, database_url, monkeypatch, tmp_path):
    a, b = two_owners
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)

    def bind(owner):
        return set_current_user(CurrentUser(
            id=owner, username=owner, role="user",
            scope=UserScope(kind="user", user_id=owner, root=Path(tmp_path) / owner),
        ))

    token = bind(a)
    try:
        catalog = ReadingCatalogStore()
        material = catalog.upsert_material(
            content_id="a" * 16, filename="paper.pdf", title="Paper",
            source_kind=SourceKind.FILE, status=IngestionStatus.READY,
        )
        workspace = catalog.create_workspace("Study", [material.material_id])
        catalog.attach_session(workspace.workspace_id, "reading-session")
        reloaded = ReadingCatalogStore()
        assert reloaded.get_material(material.material_id).title == "Paper"
        assert len(reloaded.get_workspace(workspace.workspace_id).tabs) == 1
        assert reloaded.list_sessions(workspace.workspace_id)[0].session_id == "reading-session"
        assert ReadingStore(catalog.root)._content_id(material.material_id) == "a" * 16
        assert not catalog.db_path.exists()
    finally:
        reset_current_user(token)

    token = bind(b)
    try:
        other = ReadingCatalogStore()
        assert other.get_material(material.material_id) is None
        assert other.get_workspace(workspace.workspace_id) is None
    finally:
        reset_current_user(token)


def test_postgres_reading_catalog_concurrent_writes(two_owners, database_url, monkeypatch, tmp_path):
    owner, _ = two_owners
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)

    def create(index):
        token = set_current_user(CurrentUser(
            id=owner, username=owner, role="user",
            scope=UserScope(kind="user", user_id=owner, root=Path(tmp_path) / owner),
        ))
        try:
            ReadingCatalogStore().upsert_material(
                content_id=f"{index:016x}", filename=f"{index}.pdf", title=f"Book {index}",
                source_kind=SourceKind.FILE, status=IngestionStatus.READY,
            )
        finally:
            reset_current_user(token)

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(create, range(12)))
    token = set_current_user(CurrentUser(
        id=owner, username=owner, role="user",
        scope=UserScope(kind="user", user_id=owner, root=Path(tmp_path) / owner),
    ))
    try:
        assert len(ReadingCatalogStore().list_materials()) == 12
    finally:
        reset_current_user(token)
