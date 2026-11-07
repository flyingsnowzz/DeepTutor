from pathlib import Path

import pytest

from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.services.workspace.activity import acquire_activity
from deeptutor.services.workspace.models import WorkspaceError


def test_postgres_workspace_activity_lock_is_owner_scoped(two_owners, database_url, monkeypatch, tmp_path):
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
        shared = acquire_activity()
        try:
            another_shared = acquire_activity()
            another_shared.close()
            with pytest.raises(WorkspaceError, match="busy"):
                acquire_activity(exclusive=True)
            assert not (Path(tmp_path) / a / ".runtime/workspace-activity.sqlite3").exists()
        finally:
            shared.close()
        exclusive = acquire_activity(exclusive=True)
        try:
            with pytest.raises(WorkspaceError, match="busy"):
                acquire_activity()
        finally:
            exclusive.close()
    finally:
        reset_current_user(token)

    token = bind(b)
    try:
        other = acquire_activity(exclusive=True)
        other.close()
    finally:
        reset_current_user(token)
