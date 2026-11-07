from pathlib import Path

import pytest

from scripts.migration.sqlite_to_postgres.copy_content import copy_content


def test_copy_content_preserves_files_and_rejects_conflicts(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    document = source / "workspace/library/files/document.txt"
    document.parent.mkdir(parents=True)
    document.write_bytes(b"document bytes")
    database = source / "workspace/library/library.db"
    database.write_bytes(b"SQLite placeholder")
    presentation = source / ".runtime/workspace_presentations/ws_old/items/item.json"
    presentation.parent.mkdir(parents=True)
    presentation.write_text('{"item":true}')

    planned = copy_content(source, target, execute=False)
    assert len(planned) == 2
    assert not target.exists()
    assert copy_content(source, target, execute=True) == planned
    assert copy_content(source, target, execute=True) == planned
    assert (target / document.relative_to(source)).read_bytes() == b"document bytes"
    assert not (target / database.relative_to(source)).exists()

    (target / document.relative_to(source)).write_bytes(b"different")
    with pytest.raises(ValueError, match="conflicts"):
        copy_content(source, target, execute=True)


def test_copy_content_rejects_target_symlink(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    outside = tmp_path / "outside"
    (source / "workspace/library/files").mkdir(parents=True)
    (source / "workspace/library/files/document.txt").write_text("private")
    outside.mkdir()
    (target / "workspace/library").mkdir(parents=True)
    (target / "workspace/library/files").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="symlink"):
        copy_content(source, target, execute=True)
