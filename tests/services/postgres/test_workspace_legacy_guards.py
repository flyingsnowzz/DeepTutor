import pytest

from deeptutor.services.workspace import data_migration, session_move
from deeptutor.services.workspace.models import WorkspaceError


def test_postgres_mode_rejects_legacy_sqlite_workspace_transfers(monkeypatch):
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    with pytest.raises(WorkspaceError, match="PostgreSQL transfer"):
        data_migration.preview("", "course", ["chat"])
    with pytest.raises(WorkspaceError, match="PostgreSQL transfer"):
        data_migration.export_data("", ["chat"])
    with pytest.raises(WorkspaceError, match="PostgreSQL transfer"):
        data_migration.migrate_data("", "course", ["chat"])
    with pytest.raises(WorkspaceError, match="PostgreSQL transfer"):
        data_migration.recover_operation("0" * 32)
    with pytest.raises(WorkspaceError, match="owner-bound PostgreSQL"):
        session_move.move_chat("session", "course")
    assert session_move.migrate_legacy_bindings() == 0
