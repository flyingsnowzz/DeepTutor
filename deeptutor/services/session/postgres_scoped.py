"""Owner-bound view of the PostgreSQL session repository.

The turn application service uses session IDs without an owner argument. Bind
the authenticated owner once, before handing a store to that service, so a
background turn keeps the same owner even after the request context ends.
"""

from __future__ import annotations

from typing import Any

from deeptutor.services.session.postgres_store import PostgresSessionStore
from deeptutor.services.session.scope import StoreScope


class PostgresScopedSessionStore:
    def __init__(
        self, repository: PostgresSessionStore, owner_user_id: str, resource: str
    ) -> None:
        if not owner_user_id:
            raise ValueError("An authenticated PostgreSQL owner is required")
        self.repository = repository
        self.owner_user_id = owner_user_id
        self.store_scope = StoreScope("postgres", resource, owner_user_id)

    async def migrate_workspace_preferences(self) -> int:
        return await self.repository.migrate_workspace_preferences(self.owner_user_id)

    async def usage_records(self, start_at: float, end_at: float) -> list[dict]:
        return await self.repository.usage_records(
            self.owner_user_id, start_at, end_at
        )

    async def create_session(
        self, title: str | None = None, session_id: str | None = None
    ) -> dict[str, Any]:
        created_id = await self.repository.create_session(
            self.owner_user_id, title or "New conversation", session_id=session_id
        )
        session = await self.get_session(created_id)
        assert session is not None
        return session

    async def import_legacy_session(
        self, session_id: str, title: str, created_at: float, updated_at: float,
        preferences: dict, messages: list[dict],
    ) -> dict:
        return await self.repository.import_legacy_session(
            self.owner_user_id, session_id, title, created_at, updated_at,
            preferences, messages,
        )

    async def import_session(
        self, session_id: str, title: str, created_at: float, updated_at: float,
        preferences: dict, messages: list[dict],
    ) -> dict:
        return await self.import_legacy_session(
            session_id, title, created_at, updated_at, preferences, messages)

    async def list_imported_sessions(self, limit: int = 50,
                                     offset: int = 0) -> list[dict]:
        return await self.repository.list_imported_sessions(
            self.owner_user_id, limit, offset)

    async def ensure_session(self, session_id: str | None = None) -> dict[str, Any]:
        if session_id:
            found = await self.get_session(session_id)
            if found is not None:
                return found
        return await self.create_session()

    async def reserve_submission(
        self, submission_id: str, digest: str, session_id: str | None = None
    ) -> str:
        from deeptutor.services.workspace.context import get_workspace_scope

        scope = get_workspace_scope()
        return await self.repository.reserve_submission(
            self.owner_user_id, submission_id, digest, session_id,
            workspace_id=scope.workspace_id if scope is not None else "",
        )

    async def submission_turn(self, submission_id: str) -> dict | None:
        return await self.repository.submission_turn(self.owner_user_id, submission_id)

    async def replace_submission(
        self, original_id: str, replacement_id: str, digest: str,
        session_id: str | None = None,
    ) -> dict:
        from deeptutor.services.workspace.context import get_workspace_scope

        scope = get_workspace_scope()
        return await self.repository.replace_submission(
            self.owner_user_id, original_id, replacement_id, digest, session_id,
            workspace_id=scope.workspace_id if scope is not None else "",
        )

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        return await self.repository.get_session(self.owner_user_id, session_id)

    async def get_session_with_messages(self, session_id: str) -> dict[str, Any] | None:
        return await self.repository.get_session_with_messages(self.owner_user_id, session_id)

    async def list_sessions(
        self, limit: int = 50, offset: int = 0, *, workspace_id: str | None = None
    ) -> list[dict]:
        return await self.repository.list_sessions(
            self.owner_user_id, limit, offset, workspace_id=workspace_id
        )

    async def search_sessions(
        self, query: str, limit: int = 50, offset: int = 0
    ) -> dict:
        return await self.repository.search_sessions(self.owner_user_id, query, limit, offset)

    async def get_session_summaries(self, session_ids: list[str]) -> list[dict]:
        return await self.repository.get_session_summaries(
            self.owner_user_id, session_ids
        )

    async def get_messages(self, session_id: str) -> list[dict]:
        return await self.repository.get_messages(self.owner_user_id, session_id)

    async def get_last_message(
        self, session_id: str, role: str | None = None
    ) -> dict | None:
        return await self.repository.get_last_message(self.owner_user_id, session_id, role)

    async def add_message(
        self, session_id: str, role: str, content: str, capability: str = "",
        events: list[dict] | None = None, attachments: list[dict] | None = None,
        metadata: dict | None = None, parent_message_id: int | None = None,
    ) -> int:
        return await self.repository.add_message(
            self.owner_user_id, session_id, role, content, capability=capability,
            events=events, attachments=attachments, metadata=metadata,
            parent_message_id=parent_message_id,
        )

    async def get_messages_for_context(
        self, session_id: str, leaf_message_id: int | None = None
    ) -> list[dict]:
        return await self.repository.get_messages_for_context(
            self.owner_user_id, session_id, leaf_message_id
        )

    async def update_session_title(self, session_id: str, title: str) -> bool:
        return await self.repository.update_session_title(self.owner_user_id, session_id, title)

    async def update_summary(
        self, session_id: str, summary: str, up_to_msg_id: int
    ) -> bool:
        return await self.repository.update_summary(
            self.owner_user_id, session_id, summary, up_to_msg_id
        )

    async def update_session_preferences(
        self, session_id: str, preferences: dict, *, touch: bool = True
    ) -> bool:
        return await self.repository.update_session_preferences(
            self.owner_user_id, session_id, preferences, touch=touch
        )

    async def move_session_workspace(self, session_id: str,
                                     target_workspace_id: str,
                                     *, source_workspace_id: str | None = None) -> dict:
        return await self.repository.move_session_workspace(
            self.owner_user_id, session_id, target_workspace_id,
            source_workspace_id=source_workspace_id)

    async def soft_delete_session(self, session_id: str) -> bool:
        return await self.repository.soft_delete_session(self.owner_user_id, session_id)

    async def restore_session(self, session_id: str) -> bool:
        return await self.repository.restore_session(self.owner_user_id, session_id)

    async def delete_session(self, session_id: str) -> bool:
        return await self.repository.delete_session(self.owner_user_id, session_id)

    async def hard_delete_session(self, session_id: str) -> bool:
        return await self.repository.hard_delete_session(self.owner_user_id, session_id)

    async def list_deleted_sessions(
        self, limit: int = 50, offset: int = 0
    ) -> list[dict]:
        return await self.repository.list_deleted_sessions(
            self.owner_user_id, limit, offset
        )

    async def delete_message(self, message_id: int) -> bool:
        return await self.repository.delete_message(self.owner_user_id, message_id)

    async def delete_turn_by_message(self, session_id: str, message_id: int) -> dict:
        return await self.repository.delete_turn_by_message(
            self.owner_user_id, session_id, message_id
        )

    async def upsert_notebook_entries(
        self, session_id: str | None, items: list[dict[str, Any]]
    ) -> int:
        return await self.repository.notebook.upsert_entries(
            self.owner_user_id, session_id, items
        )

    async def get_notebook_entry(self, entry_id: int) -> dict[str, Any] | None:
        return await self.repository.notebook.get_entry(self.owner_user_id, entry_id)

    async def find_notebook_entry_by_origin(
        self, origin_type: str, origin_ref: str, question_id: str,
        turn_id: str | None = None,
    ) -> dict[str, Any] | None:
        return await self.repository.notebook.find_by_origin(
            self.owner_user_id, origin_type, origin_ref, question_id, turn_id
        )

    async def update_notebook_entry(self, entry_id: int, updates: dict[str, Any]) -> bool:
        return await self.repository.notebook.update_entry(
            self.owner_user_id, entry_id, updates
        )

    async def delete_notebook_entry(self, entry_id: int) -> bool:
        return await self.repository.notebook.delete_entry(self.owner_user_id, entry_id)

    async def list_notebook_entries(self, **filters) -> dict[str, Any]:
        return await self.repository.notebook.list_entries(self.owner_user_id, **filters)

    async def list_notebook_navigation(self) -> list[dict[str, Any]]:
        return await self.repository.notebook.navigation(self.owner_user_id)

    def has_question_bank_entries(self) -> bool:
        from deeptutor.learning.storage_postgres_sync import PostgresLearningStore

        with PostgresLearningStore(self.owner_user_id)._connection() as db:
            row = db.execute(
                "SELECT 1 FROM assessment_cards WHERE owner_user_id=%s LIMIT 1",
                (self.owner_user_id,),
            ).fetchone()
        return row is not None

    async def question_bank_stats(self) -> dict[str, int]:
        return await self.repository.notebook.stats(self.owner_user_id)

    async def list_question_bank_materials(self) -> list[dict[str, Any]]:
        return await self.repository.notebook.materials(self.owner_user_id)

    async def create_category(self, name: str) -> dict[str, Any]:
        return await self.repository.notebook.create_category(self.owner_user_id, name)

    async def list_categories(self) -> list[dict[str, Any]]:
        return await self.repository.notebook.list_categories(self.owner_user_id)

    async def find_category_by_name(self, name: str) -> dict[str, Any] | None:
        return await self.repository.notebook.find_category_by_name(self.owner_user_id, name)

    async def rename_category(self, category_id: int, name: str) -> bool:
        return await self.repository.notebook.rename_category(self.owner_user_id, category_id, name)

    async def delete_category(self, category_id: int) -> bool:
        return await self.repository.notebook.delete_category(self.owner_user_id, category_id)

    async def link_entries_to_category(self, entry_ids: list[int], category_id: int,
                                       *, link: bool = True) -> int:
        return await self.repository.notebook.link_entries(
            self.owner_user_id, entry_ids, category_id, link=link)

    async def add_entry_to_category(self, entry_id: int, category_id: int) -> bool:
        return bool(await self.link_entries_to_category([entry_id], category_id))

    async def remove_entry_from_category(self, entry_id: int, category_id: int) -> bool:
        return bool(await self.link_entries_to_category([entry_id], category_id, link=False))

    async def practice_state(self, entry_id: int) -> dict[str, Any]:
        return await self.repository.notebook_practice.state(self.owner_user_id, entry_id)

    async def practice_visible(self, entry_id: int) -> bool:
        return await self.repository.notebook_practice.visible(self.owner_user_id, entry_id)

    async def practice_overview(self, timezone: str) -> dict[str, Any]:
        return await self.repository.notebook_practice.overview(self.owner_user_id, timezone)

    async def practice_queue(self, timezone: str, category_id: int | None,
                             limit: int) -> list[int]:
        return await self.repository.notebook_practice.queue(
            self.owner_user_id, timezone, category_id, limit)

    async def practice_analytics(self, timezone: str, days: int) -> dict[str, Any]:
        return await self.repository.notebook_practice.analytics(
            self.owner_user_id, timezone, days)

    async def stage_practice_import(self, filename: str, target: str,
                                    questions: list[dict[str, Any]]) -> str:
        return await self.repository.notebook_practice.stage_import(
            self.owner_user_id, filename, target, questions)

    async def commit_practice_import(self, token: str) -> dict[str, int]:
        return await self.repository.notebook_practice.commit_import(
            self.owner_user_id, token)

    async def put_reading_quiz_pending(self, material_id: str, locator: int,
                                       questions: list[Any]) -> int:
        return await self.repository.reading_quiz.put_pending(
            self.owner_user_id, material_id, locator, questions)

    async def get_reading_quiz_pending(self, material_id: str, locator: int,
                                       question_ids: list[str] | None = None
                                       ) -> dict[str, dict[str, Any]]:
        return await self.repository.reading_quiz.get_pending(
            self.owner_user_id, material_id, locator, question_ids)

    async def best_reading_quiz_results(self, material_id: str, locator: int,
                                        question_ids: list[str]) -> dict[str, dict[str, bool]]:
        return await self.repository.reading_quiz.best_results(
            self.owner_user_id, material_id, locator, question_ids)

    async def upsert_reading_quiz_reward(self, material_id: str, locator: int,
                                         stars: int) -> dict[str, Any]:
        return await self.repository.reading_quiz.upsert_reward(
            self.owner_user_id, material_id, locator, stars)

    async def list_reading_quiz_rewards(self, material_id: str) -> list[dict[str, Any]]:
        return await self.repository.reading_quiz.list_rewards(
            self.owner_user_id, material_id)

    async def reading_quiz_reward_totals(self, material_ids: list[str]) -> dict[str, int]:
        return await self.repository.reading_quiz.reward_totals(
            self.owner_user_id, material_ids)

    async def practice_review(self, entry_id: int, request_id: str, version: int,
                              rating: str, answer: str, *, self_report: bool = False
                              ) -> dict[str, Any]:
        return await self.repository.notebook_practice.review(
            self.owner_user_id, entry_id, request_id, version, rating, answer,
            self_report=self_report)

    async def record_assessment(
        self, session_id: str | None, item: dict, attempt: dict
    ) -> tuple[int, bool, bool]:
        return await self.repository.assessments.record_assessment(
            self.owner_user_id, session_id, item, attempt
        )

    async def get_assessment_attempt(self, attempt_id: str) -> dict | None:
        return await self.repository.assessments.get_assessment_attempt(
            self.owner_user_id, attempt_id
        )

    async def list_assessment_attempts(
        self, session_id: str, *, question_id: str = ""
    ) -> list[dict]:
        return await self.repository.assessments.list_assessment_attempts(
            self.owner_user_id, session_id, question_id=question_id
        )

    async def pending_linked_assessments(self) -> list[dict]:
        return await self.repository.assessments.pending_linked_assessments(
            self.owner_user_id
        )

    async def mark_assessment_link_applied(self, attempt_id: str) -> bool:
        return await self.repository.assessments.mark_assessment_link_applied(
            self.owner_user_id, attempt_id
        )

    async def get_turn(self, turn_id: str) -> dict | None:
        return await self.repository.get_turn(self.owner_user_id, turn_id)

    async def create_turn(
        self, session_id: str, capability: str = "", *, submission_id: str | None = None
    ) -> dict:
        return await self.repository.begin_turn(
            self.owner_user_id, session_id, capability, submission_id=submission_id
        )

    async def begin_turn(
        self, session_id: str, capability: str = "", *, turn_id: str | None = None,
        owner_id: str = "", fencing_token: int = 0,
        submission_id: str | None = None,
    ) -> dict:
        return await self.repository.begin_turn(
            self.owner_user_id, session_id, capability, turn_id=turn_id,
            runtime_owner_id=owner_id, fencing_token=fencing_token,
            submission_id=submission_id,
        )

    async def get_active_turn(self, session_id: str) -> dict | None:
        return await self.repository.get_active_turn(self.owner_user_id, session_id)

    async def list_active_turns(self, session_id: str) -> list[dict]:
        return await self.repository.list_active_turns(self.owner_user_id, session_id)

    async def list_nonterminal_turns(self) -> list[dict]:
        return await self.repository.list_nonterminal_turns(self.owner_user_id)

    async def list_orphaned_failed_turns(self, session_id: str) -> list[dict]:
        return await self.repository.list_orphaned_failed_turns(
            self.owner_user_id, session_id
        )

    async def transition_turn(
        self, turn_id: str, status: str, *, expected_status: str | None = None,
        fencing_token: int | None = None, error: str = "", failure_code: str = "",
        retryable: bool = False,
    ) -> bool:
        return await self.repository.transition_turn(
            self.owner_user_id, turn_id, status, expected_status=expected_status,
            fencing_token=fencing_token, error=error, failure_code=failure_code,
            retryable=retryable,
        )

    async def update_turn_status(
        self, turn_id: str, status: str, error: str = ""
    ) -> bool:
        return await self.transition_turn(turn_id, status, error=error)

    async def append_turn_event(self, turn_id: str, event: dict) -> dict:
        return (await self.append_events(turn_id, [event]))[0]

    async def get_turn_events(self, turn_id: str, after_seq: int = 0) -> list[dict]:
        return await self.get_events(turn_id, after_seq)

    async def get_message_trace(
        self, session_id: str, message_id: int | str,
        after_seq: int = 0, limit: int | None = None,
    ) -> dict | None:
        return await self.repository.get_message_trace(
            self.owner_user_id, session_id, message_id, after_seq, limit
        )

    async def get_events(self, turn_id: str, after_seq: int = 0) -> list[dict]:
        return await self.repository.get_events(self.owner_user_id, turn_id, after_seq)

    async def append_events(
        self, turn_id: str, events: list[dict], *, fencing_token: int | None = None
    ) -> list[dict]:
        return await self.repository.append_events(
            self.owner_user_id, turn_id, events, fencing_token=fencing_token
        )

    async def link_turn_message(self, turn_id: str, assistant_message_id: int) -> bool:
        return await self.repository.link_turn_message(
            self.owner_user_id, turn_id, assistant_message_id
        )
