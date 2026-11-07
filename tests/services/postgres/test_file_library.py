import asyncio
from pathlib import Path

from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.services.storage.postgres_file_library import PostgresFileLibraryStore
from deeptutor.services.storage import file_library


def test_postgres_file_library_owner_isolation_restart_and_lifecycle(two_owners, database_url, monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    a, b = two_owners

    def bind(owner):
        return set_current_user(CurrentUser(
            id=owner, username=owner, role="user",
            scope=UserScope(kind="user", user_id=owner, root=tmp_path / owner),
        ))

    token = bind(a)
    try:
        file_library.reset_file_library_store()
        assert isinstance(file_library.get_file_library_store(), PostgresFileLibraryStore)
        assert not (tmp_path / a / "workspace/library/library.db").exists()
        store = PostgresFileLibraryStore(tmp_path / a / "files")
        first = asyncio.run(store.add_file(data=b"hello", filename="first.txt"))
        assert asyncio.run(store.add_file(data=b"hello", filename="second.txt"))["id"] == first["id"]
        restarted = PostgresFileLibraryStore(tmp_path / a / "files")
        assert restarted.resolve_path(first["id"]).read_bytes() == b"hello"
        assert len(asyncio.run(restarted.search_files("FIRST"))) == 1
    finally:
        file_library.reset_file_library_store()
        reset_current_user(token)

    token = bind(b)
    try:
        other = PostgresFileLibraryStore(tmp_path / b / "files")
        assert asyncio.run(other.get_file(first["id"])) is None
        assert asyncio.run(other.delete_file(first["id"])) is False
        own = asyncio.run(other.add_file(data=b"hello", filename="own.txt"))
        assert own["id"] != first["id"]
    finally:
        reset_current_user(token)

    token = bind(a)
    try:
        assert asyncio.run(restarted.delete_file(first["id"]))
        assert asyncio.run(restarted.list_files()) == []
        assert asyncio.run(restarted.restore_file(first["id"]))
        assert asyncio.run(restarted.hard_delete_file(first["id"])) is False
        assert asyncio.run(restarted.delete_file(first["id"]))
        assert asyncio.run(restarted.hard_delete_file(first["id"]))
        assert restarted.resolve_path(first["id"]) is None
    finally:
        reset_current_user(token)

    token = bind(b)
    try:
        asyncio.run(other.delete_file(own["id"]))
        asyncio.run(other.hard_delete_file(own["id"]))
    finally:
        reset_current_user(token)
