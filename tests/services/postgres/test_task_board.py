from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import pytest

from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.services.task_board import (
    CreateCard, LinkStatus, LinkTasks, UpdateCard, get_task_board_store,
    workspace_board,
)


def test_postgres_task_board_owner_workspace_and_revision(two_owners, database_url, monkeypatch, tmp_path):
    a, b = two_owners
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)

    def bind(owner):
        return set_current_user(CurrentUser(
            id=owner, username=owner, role="user",
            scope=UserScope(kind="user", user_id=owner, root=Path(tmp_path) / owner),
        ))

    token = bind(a)
    try:
        store = get_task_board_store()
        assert store.revision() == 0
        board = store.create(CreateCard(title="Read", due_date="2026-11-06"), "course-a")
        card = board.cards[0]
        assert board.revision == 1
        assert not (Path(tmp_path) / a / "task-board" / "tasks.sqlite").exists()
        with pytest.raises(KeyError):
            store.update(card.id, UpdateCard(status="doing"), workspace_id="course-b")
        board = store.update(card.id, UpdateCard(status="doing"), workspace_id="course-a")
        assert board.cards[0].status == "doing"
        board = store.link_tasks("s1", LinkTasks(workspace_id="course-a", task_ids=[card.id]))
        assert board.session_links[0].task_ids == [card.id]
        store.link_status("s1", LinkStatus(workspace_id="course-a", enabled=False))
        assert not get_task_board_store().read().session_links[0].status_link_enabled
        assert workspace_board(store.read(), "course-b").cards == []
    finally:
        reset_current_user(token)

    token = bind(b)
    try:
        other = get_task_board_store()
        assert other.read().cards == []
        with pytest.raises(KeyError):
            other.update(card.id, UpdateCard(status="done"), workspace_id="course-a")
    finally:
        reset_current_user(token)

    token = bind(a)
    try:
        assert get_task_board_store().read().cards[0].status == "doing"
    finally:
        reset_current_user(token)


def test_postgres_task_board_concurrent_updates_are_not_lost(two_owners, database_url, monkeypatch):
    from deeptutor.services.postgres.task_board import PostgresTaskBoardStore

    owner, _ = two_owners
    monkeypatch.setenv("DATABASE_URL", database_url)
    store = PostgresTaskBoardStore(owner)
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda index: store.create(CreateCard(title=f"Task {index}"), ""), range(12)))
    board = store.read()
    assert len(board.cards) == 12
    assert board.revision == 12
