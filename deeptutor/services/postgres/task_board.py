"""Transactional PostgreSQL task board for an authenticated learner."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Callable, Iterator
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from deeptutor.services.postgres.database import database_url
from deeptutor.services.storage_backend import postgres_owner_user_id
from deeptutor.services.task_board import (
    CreateCard, LinkStatus, LinkTasks, SessionTaskLinks, StatusColors,
    TaskBoard, TaskBoardStore, TaskCard, UpdateCard,
)


class PostgresTaskBoardStore(TaskBoardStore):
    def __init__(self, owner_user_id: str | None = None):
        self.owner_user_id = owner_user_id or postgres_owner_user_id()

    @contextmanager
    def _connection(self) -> Iterator[psycopg.Connection]:
        url = database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
        with psycopg.connect(url, row_factory=dict_row) as conn:
            conn.execute("SELECT set_config('app.user_id', %s, true)", (self.owner_user_id,))
            yield conn

    @staticmethod
    def _empty() -> TaskBoard:
        return TaskBoard(cards=[])

    def _load(self, conn, *, lock: bool = False) -> TaskBoard:
        if lock:
            conn.execute("""INSERT INTO task_boards(owner_user_id,revision,board_json)
                VALUES (%s,0,%s) ON CONFLICT DO NOTHING""",
                (self.owner_user_id, Jsonb(self._empty().model_dump(mode="json"))))
        row = conn.execute(
            "SELECT board_json,revision FROM task_boards WHERE owner_user_id=%s" +
            (" FOR UPDATE" if lock else ""), (self.owner_user_id,),
        ).fetchone()
        if row is None:
            return self._empty()
        board = TaskBoard.model_validate(row["board_json"])
        board.revision = row["revision"]
        return board

    def _mutate(self, change: Callable[[TaskBoard], None]) -> TaskBoard:
        with self._connection() as conn:
            board = self._load(conn, lock=True)
            change(board)
            board.revision += 1
            conn.execute("""UPDATE task_boards SET revision=%s,board_json=%s
                WHERE owner_user_id=%s""", (
                    board.revision, Jsonb(board.model_dump(mode="json")), self.owner_user_id,
                ))
            return board

    def read(self) -> TaskBoard:
        with self._connection() as conn:
            return self._load(conn)

    def revision(self) -> int:
        with self._connection() as conn:
            row = conn.execute("SELECT revision FROM task_boards WHERE owner_user_id=%s",
                               (self.owner_user_id,)).fetchone()
            return row["revision"] if row else 0

    def create(self, payload: CreateCard, workspace_id: str | None = None) -> TaskBoard:
        def change(board):
            now = datetime.now(timezone.utc).isoformat()
            board.cards.append(TaskCard(
                id=uuid4().hex, title=payload.title, note=payload.note,
                due_date=payload.due_date, status="todo", archived=False,
                created_at=now, updated_at=now, workspace_id=workspace_id,
            ))
        return self._mutate(change)

    def update(self, card_id: str, payload: UpdateCard, *, workspace_id: str = "") -> TaskBoard:
        def change(board):
            for index, card in enumerate(board.cards):
                if card.id == card_id and (card.workspace_id or "") == workspace_id:
                    updated = TaskCard.model_validate({
                        **card.model_dump(), **payload.model_dump(exclude_unset=True),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })
                    board.cards[index] = updated
                    for link in board.session_links:
                        if link.workspace_id != (updated.workspace_id or ""):
                            link.task_ids = [item for item in link.task_ids if item != card_id]
                    return
            raise KeyError(card_id)
        return self._mutate(change)

    def set_colors(self, colors: StatusColors) -> TaskBoard:
        return self._mutate(lambda board: setattr(board, "colors", colors))

    def link_tasks(self, session_id: str, payload: LinkTasks) -> TaskBoard:
        def change(board):
            key = (payload.workspace_id, session_id)
            link = next((row for row in board.session_links
                         if (row.workspace_id, row.session_id) == key), None)
            existing = set(link.task_ids) if link else set()
            cards = {card.id: card for card in board.cards}
            for task_id in payload.task_ids:
                card = cards.get(task_id)
                if card is None or (card.workspace_id or "") != payload.workspace_id or (
                    card.archived and task_id not in existing
                ):
                    raise KeyError(task_id)
            if link is None:
                link = SessionTaskLinks(workspace_id=payload.workspace_id, session_id=session_id)
                board.session_links.append(link)
            # SQLite preserves prior association order and appends new links.
            link.task_ids = [item for item in link.task_ids if item in payload.task_ids]
            link.task_ids.extend(item for item in payload.task_ids if item not in existing)
            if set(payload.task_ids) - existing:
                link.status_link_enabled = True
        return self._mutate(change)

    def link_status(self, session_id: str, payload: LinkStatus) -> TaskBoard:
        def change(board):
            link = next((row for row in board.session_links if
                         row.workspace_id == payload.workspace_id and row.session_id == session_id), None)
            if link is None:
                link = SessionTaskLinks(workspace_id=payload.workspace_id, session_id=session_id)
                board.session_links.append(link)
            link.status_link_enabled = payload.enabled
        return self._mutate(change)

    def move_session_links(self, session_ids: list[str], source: str, target: str) -> None:
        if not session_ids or source == target:
            return
        def change(board):
            allowed = {card.id for card in board.cards if (card.workspace_id or "") == target}
            for link in board.session_links:
                if link.workspace_id == source and link.session_id in session_ids:
                    link.workspace_id = target
                    link.task_ids = [item for item in link.task_ids if item in allowed]
            merged = {}
            for link in board.session_links:
                key = (link.workspace_id, link.session_id)
                if key in merged:
                    merged[key].task_ids = list(dict.fromkeys(merged[key].task_ids + link.task_ids))
                    merged[key].status_link_enabled = link.status_link_enabled
                else:
                    merged[key] = link
            board.session_links = list(merged.values())
        self._mutate(change)

    def remove_session(self, workspace_id: str, session_id: str) -> None:
        def change(board):
            board.session_links = [link for link in board.session_links if
                (link.workspace_id, link.session_id) != (workspace_id, session_id)]
        self._mutate(change)

    def import_legacy(self, source, workspace_id: str) -> None:
        raise RuntimeError("Use the audited SQLite-to-PostgreSQL migration before switching storage")
