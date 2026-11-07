from pathlib import Path

from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.reading.catalog_models import IngestionStatus, SourceKind
from deeptutor.reading.catalog_store import ReadingCatalogStore
from deeptutor.services.workspace import get_content_workspace_service
from deeptutor.services.workspace.context import workspace_context


def test_postgres_workspace_catalog_and_named_reading_scope(
    two_owners, database_url, monkeypatch, tmp_path,
):
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
        service = get_content_workspace_service()
        created = service.create_workspace("Course")
        wid = created["workspace_id"]
        assert service.validate_chat_binding(wid).workspace_id == wid
        with workspace_context(wid):
            catalog = ReadingCatalogStore()
            catalog.upsert_material(
                content_id="d" * 16, filename="paper.pdf", title="Course paper",
                source_kind=SourceKind.FILE, status=IngestionStatus.READY,
            )
            assert len(ReadingCatalogStore().list_materials()) == 1
            assert not catalog.db_path.exists()
        assert ReadingCatalogStore().list_materials() == []
        assert not (Path(tmp_path) / a / ".runtime/workspaces.sqlite3").exists()
    finally:
        reset_current_user(token)

    token = bind(b)
    try:
        assert wid not in {r["workspace_id"] for r in get_content_workspace_service().list_workspaces()}
    finally:
        reset_current_user(token)
