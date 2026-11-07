from __future__ import annotations

import asyncio
import time

import pytest
from sqlalchemy import text

from deeptutor.services.session.postgres_store import PostgresSessionStore
from deeptutor.services.session.postgres_scoped import PostgresScopedSessionStore


@pytest.mark.asyncio
async def test_session_owner_isolation(two_owners, engine):
    owner_a, owner_b = two_owners
    store = PostgresSessionStore(engine)

    session_id = await store.create_session(owner_a, title="A 的会话")

    fetched = await store.get_session(owner_a, session_id)
    assert fetched is not None and fetched["title"] == "A 的会话"
    assert isinstance(fetched["created_at"], float)

    # Resource id alone never authorizes: owner B gets nothing.
    assert await store.get_session(owner_b, session_id) is None
    assert all(s["id"] != session_id for s in await store.list_sessions(owner_b))

    listed = await store.list_sessions(owner_a)
    assert any(s["id"] == session_id for s in listed)


@pytest.mark.asyncio
async def test_session_ids_are_unique(accounts, engine, owner_factory):
    owner = owner_factory("sessions")
    await accounts.ensure_user(owner)
    store = PostgresSessionStore(engine)
    ids = {await store.create_session(owner) for _ in range(3)}
    assert len(ids) == 3


@pytest.mark.asyncio
async def test_messages_are_read_only_with_matching_owner(two_owners, engine):
    owner_a, owner_b = two_owners
    store = PostgresSessionStore(engine)
    session_id = await store.create_session(owner_a)
    async with engine.begin() as db:
        await db.execute(text("SELECT set_config('app.user_id', :owner, true)"), {"owner": owner_a})
        await db.execute(
            text(
                """INSERT INTO messages
                   (owner_user_id,session_id,role,content,events_json,attachments_json,metadata_json)
                   VALUES (:owner,:session,'user','你好','[]'::jsonb,'[]'::jsonb,'{}'::jsonb)"""
            ),
            {"owner": owner_a, "session": session_id},
        )
    assert [m["content"] for m in await store.get_messages(owner_a, session_id)] == ["你好"]
    assert await store.get_messages(owner_b, session_id) == []


@pytest.mark.asyncio
async def test_message_branch_and_session_mutations_enforce_owner(two_owners, engine):
    owner_a, owner_b = two_owners
    store = PostgresSessionStore(engine)
    session_a = await store.create_session(owner_a)
    session_b = await store.create_session(owner_b)
    first = await store.add_message(owner_a, session_a, "user", "问题")
    second = await store.add_message(
        owner_a, session_a, "assistant", "回答", parent_message_id=first
    )
    assert [row["id"] for row in await store.get_messages(owner_a, session_a)] == [first, second]
    with pytest.raises(PermissionError):
        await store.add_message(owner_b, session_a, "user", "越权")
    with pytest.raises(PermissionError):
        await store.add_message(owner_a, session_a, "user", "跨会话", parent_message_id=(
            await store.add_message(owner_b, session_b, "user", "其他会话")
        ))
    assert not await store.update_session_title(owner_b, session_a, "越权标题")
    assert await store.update_session_title(owner_a, session_a, "新标题")
    assert not await store.soft_delete_session(owner_b, session_a)
    assert await store.soft_delete_session(owner_a, session_a)
    assert not await store.restore_session(owner_b, session_a)
    assert await store.restore_session(owner_a, session_a)


@pytest.mark.asyncio
async def test_branch_context_summary_and_preferences_are_owner_scoped(two_owners, engine):
    owner_a, owner_b = two_owners
    store = PostgresSessionStore(engine)
    session_id = await store.create_session(owner_a)
    root = await store.add_message(owner_a, session_id, "user", "question")
    first = await store.add_message(owner_a, session_id, "assistant", "first", parent_message_id=root)
    alternate = await store.add_message(
        owner_a, session_id, "assistant", "alternate", parent_message_id=root,
        metadata={"provider_response_state": {"secret": "internal"}, "public": True},
    )
    context = await store.get_messages_for_context(owner_a, session_id, alternate)
    assert [row["content"] for row in context] == ["question", "alternate"]
    assert await store.get_messages_for_context(owner_b, session_id, alternate) == []
    assert await store.update_summary(owner_a, session_id, "summary", alternate)
    assert not await store.update_summary(owner_b, session_id, "intrusion", first)
    assert await store.update_session_preferences(
        owner_a, session_id, {"capability": "mastery_path", "mastery_path_id": "path-1"}
    )
    assert not await store.update_session_preferences(owner_b, session_id, {"x": 1})
    session = await store.get_session_with_messages(owner_a, session_id)
    assert session["compressed_summary"] == "summary"
    assert session["preferences"]["workspace_mode"] == "mastery_path"
    assert len(session["messages"]) == 3
    assert session["messages"][-1]["metadata"] == {"public": True}
    assert await store.get_session_with_messages(owner_b, session_id) is None


@pytest.mark.asyncio
async def test_search_sessions_uses_literal_query_and_owner_scope(two_owners, engine):
    owner_a, owner_b = two_owners
    store = PostgresSessionStore(engine)
    matched = await store.create_session(owner_a, "Ordinary")
    await store.add_message(owner_a, matched, "user", "What does 100% mean?")
    hidden = await store.create_session(owner_b, "100% private")
    await store.add_message(owner_b, hidden, "user", "100% private")
    assert (await store.search_sessions(owner_a, "%"))["sessions"][0]["id"] == matched
    assert (await store.search_sessions(owner_a, "%"))["total"] == 1
    assert (await store.search_sessions(owner_a, "private"))["total"] == 0
    assert (await store.search_sessions(owner_a, "")) == {"sessions": [], "total": 0}


@pytest.mark.asyncio
async def test_scoped_store_keeps_authenticated_owner(two_owners, engine):
    owner_a, owner_b = two_owners
    repository = PostgresSessionStore(engine)
    session_id = await repository.create_session(owner_a, "Only A")
    scoped_a = PostgresScopedSessionStore(repository, owner_a, "test")
    scoped_b = PostgresScopedSessionStore(repository, owner_b, "test")
    assert scoped_a.store_scope.cache_key != scoped_b.store_scope.cache_key
    assert (await scoped_a.get_session(session_id))["title"] == "Only A"
    assert await scoped_b.get_session(session_id) is None
    assert [row["id"] for row in await scoped_a.list_sessions()] == [session_id]
    assert await scoped_b.list_sessions() == []
    assert await scoped_b.search_sessions("Only A") == {"sessions": [], "total": 0}
    created = await scoped_a.create_session("New")
    assert created["title"] == "New"
    message_id = await scoped_a.add_message(created["id"], "user", "Hello")
    assert [row["id"] for row in await scoped_a.get_messages(created["id"])] == [message_id]
    assert (await scoped_a.get_last_message(created["id"], "user"))["id"] == message_id
    assert await scoped_b.get_last_message(created["id"]) is None
    turn = await scoped_a.create_turn(created["id"], "chat")
    assert isinstance(turn["created_at"], float)
    assert (await scoped_a.get_active_turn(created["id"]))["id"] == turn["id"]
    event = await scoped_a.append_turn_event(turn["id"], {"type": "stage_start"})
    assert event["seq"] == 1
    assert await scoped_b.get_turn(turn["id"]) is None
    assert await scoped_a.update_turn_status(turn["id"], "completed")


@pytest.mark.asyncio
async def test_scoped_delete_and_recycle_bin_are_owner_scoped(two_owners, engine):
    owner_a, owner_b = two_owners
    repository = PostgresSessionStore(engine)
    a = PostgresScopedSessionStore(repository, owner_a, "test")
    b = PostgresScopedSessionStore(repository, owner_b, "test")
    session = await a.create_session("Recycle me")
    message_id = await a.add_message(session["id"], "user", "private")
    assert not await b.delete_message(message_id)
    assert not await b.soft_delete_session(session["id"])
    assert await a.soft_delete_session(session["id"])
    assert [row["id"] for row in await a.list_deleted_sessions()] == [session["id"]]
    assert await b.list_deleted_sessions() == []
    assert not await b.hard_delete_session(session["id"])
    assert await a.restore_session(session["id"])
    assert await a.delete_message(message_id)
    assert await a.get_messages(session["id"]) == []
    assert await a.soft_delete_session(session["id"])
    assert await a.hard_delete_session(session["id"])
    assert await a.get_session(session["id"]) is None


@pytest.mark.asyncio
async def test_scoped_summaries_and_failed_turns_exclude_other_owner(two_owners, engine):
    owner_a, owner_b = two_owners
    repository = PostgresSessionStore(engine)
    a = PostgresScopedSessionStore(repository, owner_a, "test")
    b = PostgresScopedSessionStore(repository, owner_b, "test")
    first = await a.create_session("First")
    second = await b.create_session("Second")
    await a.add_message(first["id"], "user", "Last content")
    summaries = await a.get_session_summaries([second["id"], first["id"], first["id"]])
    assert [row["id"] for row in summaries] == [first["id"]]
    assert summaries[0]["message_count"] == 1
    assert summaries[0]["last_message"] == "Last content"
    turn = await a.create_turn(first["id"], "chat")
    assert await a.update_turn_status(turn["id"], "failed")
    assert [row["id"] for row in await a.list_orphaned_failed_turns(first["id"])] == [turn["id"]]
    assert await b.list_orphaned_failed_turns(first["id"]) == []


@pytest.mark.asyncio
async def test_submission_reservation_and_turn_replay_are_owner_scoped(two_owners, engine):
    owner_a, owner_b = two_owners
    repository = PostgresSessionStore(engine)
    a = PostgresScopedSessionStore(repository, owner_a, "test")
    b = PostgresScopedSessionStore(repository, owner_b, "test")
    session_id = await a.reserve_submission("submission-1", "digest-1")
    assert await a.reserve_submission("submission-1", "digest-1") == session_id
    with pytest.raises(RuntimeError):
        await a.reserve_submission("submission-1", "other-digest")
    other_session = await b.reserve_submission("submission-1", "digest-1")
    assert other_session != session_id
    turn = await a.create_turn(session_id, submission_id="submission-1")
    replay = await a.create_turn(session_id, submission_id="submission-1")
    assert replay["id"] == turn["id"] and replay["_submission_replay"]
    assert (await a.submission_turn("submission-1"))["id"] == turn["id"]
    assert await b.submission_turn("submission-1") is None


@pytest.mark.asyncio
async def test_failed_submission_retry_reuses_user_message(two_owners, engine):
    owner_a, _ = two_owners
    repository = PostgresSessionStore(engine)
    a = PostgresScopedSessionStore(repository, owner_a, "test")
    session_id = await a.reserve_submission("failed-retry", "digest")
    user_message = await a.add_message(
        session_id, "user", "Question",
        metadata={"client_submission_id": "failed-retry"},
    )
    original = await a.create_turn(session_id, submission_id="failed-retry")
    assistant = await a.add_message(session_id, "assistant", "Partial")
    assert await a.link_turn_message(original["id"], assistant)
    assert await a.update_turn_status(original["id"], "failed")
    retry = await a.create_turn(session_id, submission_id="failed-retry")
    assert retry["id"] != original["id"]
    assert retry["_submission_user_message_id"] == user_message
    assert retry["_submission_assistant_message_id"] == assistant
    assert retry["_submission_previous_turn_id"] == original["id"]
    assert (await a.submission_turn("failed-retry"))["id"] == retry["id"]


@pytest.mark.asyncio
async def test_concurrent_submission_retry_reuses_one_session(two_owners, engine):
    owner_a, _ = two_owners
    repository = PostgresSessionStore(engine)
    a = PostgresScopedSessionStore(repository, owner_a, "test")
    session_ids = await asyncio.gather(
        a.reserve_submission("concurrent-retry", "same-digest"),
        a.reserve_submission("concurrent-retry", "same-digest"),
    )
    assert session_ids[0] == session_ids[1]


@pytest.mark.asyncio
async def test_message_trace_pages_and_rejects_other_owner(two_owners, engine):
    owner_a, owner_b = two_owners
    repository = PostgresSessionStore(engine)
    a = PostgresScopedSessionStore(repository, owner_a, "test")
    b = PostgresScopedSessionStore(repository, owner_b, "test")
    session = await a.create_session()
    assistant = await a.add_message(session["id"], "assistant", "Answer")
    turn = await a.create_turn(session["id"])
    assert await a.link_turn_message(turn["id"], assistant)
    await a.append_events(turn["id"], [{"type": "token", "content": "A"}, {"type": "done"}])
    first = await a.get_message_trace(session["id"], assistant, limit=1)
    assert first["total"] == 2 and first["next_seq"] == 1 and not first["complete"]
    second = await a.get_message_trace(session["id"], assistant, after_seq=1)
    assert second["events"][0]["seq"] == 2 and second["complete"]
    assert await b.get_message_trace(session["id"], assistant) is None


@pytest.mark.asyncio
async def test_replace_submission_fences_old_request_and_replays_edit(two_owners, engine):
    owner_a, owner_b = two_owners
    repository = PostgresSessionStore(engine)
    a = PostgresScopedSessionStore(repository, owner_a, "test")
    b = PostgresScopedSessionStore(repository, owner_b, "test")
    session_id = await a.reserve_submission("original", "old-digest")
    receipt = await a.replace_submission("original", "edited", "new-digest", session_id)
    assert receipt == {
        "status": "reserved", "session_id": session_id, "submission_id": "edited"
    }
    assert await a.replace_submission("original", "edited", "new-digest", session_id) == receipt
    with pytest.raises(RuntimeError, match="superseded"):
        await a.reserve_submission("original", "old-digest", session_id)
    with pytest.raises(RuntimeError, match="superseded"):
        await a.create_turn(session_id, submission_id="original")
    assert await a.reserve_submission("edited", "new-digest", session_id) == session_id
    with pytest.raises(RuntimeError):
        await b.replace_submission("original", "foreign-edit", "digest", session_id)


@pytest.mark.asyncio
async def test_replace_admitted_submission_returns_original_turn(two_owners, engine):
    owner_a, _ = two_owners
    repository = PostgresSessionStore(engine)
    a = PostgresScopedSessionStore(repository, owner_a, "test")
    session_id = await a.reserve_submission("admitted", "digest")
    user_message_id = await a.add_message(
        session_id, "user", "Old", metadata={"client_submission_id": "admitted"}
    )
    turn = await a.create_turn(session_id, submission_id="admitted")
    receipt = await a.replace_submission("admitted", "edited", "new-digest", session_id)
    assert receipt["status"] == "admitted"
    assert receipt["turn"]["id"] == turn["id"]
    assert receipt["user_message_id"] == user_message_id


@pytest.mark.asyncio
async def test_workspace_preference_migration_is_owner_scoped_and_idempotent(two_owners, engine):
    owner_a, owner_b = two_owners
    repository = PostgresSessionStore(engine)
    a = PostgresScopedSessionStore(repository, owner_a, "test")
    b = PostgresScopedSessionStore(repository, owner_b, "test")
    first = await a.create_session("Old mastery")
    second = await b.create_session("Other owner")
    await a.update_session_preferences(
        first["id"], {"capability": "mastery_path", "mastery_path_id": "path-a"}
    )
    await b.soft_delete_session(second["id"])
    # The writer already upgrades new preferences; only the archived legacy
    # row should be changed by this migration.
    assert await a.migrate_workspace_preferences() == 0
    assert await b.migrate_workspace_preferences() == 1
    assert await b.migrate_workspace_preferences() == 0
    assert (await b.get_session(second["id"]))["preferences"]["archived"]


@pytest.mark.asyncio
async def test_usage_records_are_owner_scoped(two_owners, engine):
    owner_a, owner_b = two_owners
    repository = PostgresSessionStore(engine)
    a = PostgresScopedSessionStore(repository, owner_a, "test")
    b = PostgresScopedSessionStore(repository, owner_b, "test")
    session = await a.create_session()
    await a.add_message(session["id"], "assistant", "Answer")
    now = time.time()
    records = await a.usage_records(now - 60, now + 60)
    assert len(records) == 1 and records[0]["session_id"] == session["id"]
    assert await b.usage_records(now - 60, now + 60) == []


@pytest.mark.asyncio
async def test_legacy_import_is_idempotent_and_owner_scoped(two_owners, engine):
    owner_a, owner_b = two_owners
    repository = PostgresSessionStore(engine)
    a = PostgresScopedSessionStore(repository, owner_a, "test")
    b = PostgresScopedSessionStore(repository, owner_b, "test")
    import_id = f"imported_{owner_a}"
    args = (
        import_id, "Imported", 1_700_000_000, 1_700_000_010,
        {"import": {"source": "test", "agent_name": "First"}},
        [{"role": "user", "content": "Question"},
         {"role": "assistant", "content": "Answer"}],
    )
    assert (await a.import_legacy_session(*args))["message_count"] == 2
    assert (await a.import_legacy_session(*args))["imported"] is False
    assert len(await a.get_messages(import_id)) == 2
    assert await b.get_session(import_id) is None
    with pytest.raises(PermissionError):
        await b.import_legacy_session(*args)
    assert all(row["id"] != import_id for row in await a.list_sessions())


@pytest.mark.asyncio
async def test_session_listing_filters_workspace_and_archived(two_owners, engine):
    owner_a, _ = two_owners
    repository = PostgresSessionStore(engine)
    a = PostgresScopedSessionStore(repository, owner_a, "test")
    visible = await a.create_session("Visible")
    other = await a.create_session("Other workspace")
    archived = await a.create_session("Archived")
    await a.update_session_preferences(visible["id"], {"workspace_id": "one"})
    await a.update_session_preferences(other["id"], {"workspace_id": "two"})
    await a.update_session_preferences(archived["id"], {"workspace_id": "one", "archived": True})
    rows = await a.list_sessions(workspace_id="one")
    assert [row["id"] for row in rows] == [visible["id"]]
    assert rows[0]["message_count"] == 0
