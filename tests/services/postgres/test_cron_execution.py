import asyncio
from dataclasses import asdict
import pytest
from pathlib import Path

from deeptutor.core.stream import StreamEvent, StreamEventType
from deeptutor.multi_user.context import get_current_user_or_none, reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.services.cron import executor
from deeptutor.services.cron.repository import PostgresCronRepository
from deeptutor.services.cron.service import CronJob, CronOwner, CronSchedule, CronService, _now_ms
from deeptutor.services.session.postgres_store import PostgresSessionStore
from deeptutor.services.workspace.context import current_workspace_id


@pytest.mark.asyncio
async def test_postgres_cron_delivers_to_owned_session(two_owners, engine, database_url, monkeypatch):
    a, b = two_owners
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)
    repo = PostgresSessionStore(engine)
    session_a = await repo.create_session(a, "A")
    session_b = await repo.create_session(b, "B")
    observed = []

    class Engine:
        async def execute(self, context):
            observed.append((get_current_user_or_none().id, context.session_id))
            yield StreamEvent(type=StreamEventType.RESULT, source="chat",
                              metadata={"response": "Time to review"})

    monkeypatch.setattr("deeptutor.runtime.turn_engine.get_turn_engine", lambda: Engine())
    monkeypatch.setattr(
        "deeptutor.services.workspace.get_content_workspace_service",
        lambda: (_ for _ in ()).throw(AssertionError("local catalog touched")),
    )

    async def no_notification(*_args):
        return None

    monkeypatch.setattr(executor, "_maybe_send_desktop_notification", no_notification)
    job = CronJob(
        id="cron-delivery", name="Review", message="Review algebra",
        schedule=CronSchedule(kind="every", every_seconds=60),
        owner=CronOwner(kind="chat", user_id=a, is_admin=False,
                        session_id=session_a, workspace_id=""),
    )
    assert await executor.execute_job(job) == ("ok", None)
    assert observed == [(a, session_a)]
    messages = await repo.get_messages(a, session_a)
    assert len(messages) == 2
    assert messages[1]["content"] == "Time to review"
    assert await repo.get_messages(b, session_b) == []


@pytest.mark.asyncio
async def test_postgres_cron_restores_named_workspace_scope(
    two_owners, engine, database_url, monkeypatch, tmp_path,
):
    from deeptutor.services.workspace import get_content_workspace_service
    from deeptutor.multi_user import paths

    a, b = two_owners
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)

    def scoped_user(owner):
        scope = UserScope(kind="user", user_id=owner, root=Path(tmp_path) / owner)
        return CurrentUser(id=owner, username=owner, role="user", scope=scope)

    monkeypatch.setattr(paths, "scope_for_user", lambda owner, *, is_admin: scoped_user(owner).scope)
    token = set_current_user(scoped_user(a))
    try:
        wid = get_content_workspace_service().create_workspace("Cron course")["workspace_id"]
    finally:
        reset_current_user(token)

    repo = PostgresSessionStore(engine)
    session = await repo.create_session(a, "Course reminder")
    await repo.update_session_preferences(a, session, {"workspace_id": wid})
    observed = []

    class Engine:
        async def execute(self, context):
            observed.append((get_current_user_or_none().id, current_workspace_id(), context.session_id))
            yield StreamEvent(type=StreamEventType.RESULT, source="chat",
                              metadata={"response": "Review in course"})

    monkeypatch.setattr("deeptutor.runtime.turn_engine.get_turn_engine", lambda: Engine())

    async def no_notification(*_args):
        return None

    monkeypatch.setattr(executor, "_maybe_send_desktop_notification", no_notification)
    initial = CronService(repository=PostgresCronRepository())
    job = initial.add_job(
        name="Review", message="Review algebra",
        schedule=CronSchedule(kind="every", every_seconds=60),
        owner=CronOwner(kind="chat", user_id=a, is_admin=False,
                        session_id=session, workspace_id=wid),
    )
    job.state.next_run_at_ms = _now_ms() - 1_000
    initial.repository.upsert(asdict(job))
    restarted = CronService(repository=PostgresCronRepository(), on_job=executor.execute_job)
    try:
        await restarted.start()
        for _ in range(100):
            if restarted.get_job(job.id).state.last_status == "ok":
                break
            await asyncio.sleep(0.02)
        assert restarted.get_job(job.id).state.last_status == "ok"
        assert observed == [(a, wid, session)]
        assert [m["content"] for m in await repo.get_messages(a, session)] == [
            executor._reminder_prompt(job), "Review in course",
        ]
        assert await repo.get_session(b, session) is None
        assert not (Path(tmp_path) / a / ".runtime/workspaces.sqlite3").exists()
        assert not (Path(tmp_path) / a / "workspace/.deeptutor/data/user/chat_history.db").exists()
    finally:
        await restarted.stop()
        restarted.cancel_job(job.id)
        await repo.delete_session(a, session)
