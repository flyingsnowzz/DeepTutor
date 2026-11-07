import asyncio
import json
import sqlite3
from types import SimpleNamespace

from fastapi import WebSocketDisconnect
import pytest

from deeptutor.app import DeepTutorApp
from deeptutor.app.container import (
    ApplicationContainer, close_application_container, set_application_container,
)
from deeptutor.core.stream import StreamEvent, StreamEventType
from deeptutor.multi_user.paths import scope_for_user
from deeptutor.multi_user.context import set_current_user
from deeptutor.multi_user.models import CurrentUser
from deeptutor.api.routers.unified_ws import unified_websocket
from deeptutor.services.session.postgres_store import PostgresSessionStore
from deeptutor_cli.app import create_cli_app


class _ContextBuilder:
    def __init__(self, *_args, **_kwargs):
        pass

    async def build(self, **_kwargs):
        return SimpleNamespace(
            conversation_history=[], conversation_summary="", context_text="",
            token_count=0, budget=0,
        )


class _Engine:
    async def execute(self, context):
        yield StreamEvent(type=StreamEventType.CONTENT, source="chat", content="PostgreSQL reply")
        yield StreamEvent(type=StreamEventType.DONE, source="chat")


@pytest.mark.asyncio
async def test_sdk_and_cli_turns_share_postgres_and_isolate_owners(
    two_owners, engine, database_url, monkeypatch
):
    owner_a, owner_b = two_owners
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_CLI_USER_ID", owner_b)
    sqlite_connect = sqlite3.connect

    def reject_file_sqlite(database, *args, **kwargs):
        if str(database) != ":memory:":
            raise AssertionError(f"PostgreSQL turn opened a file SQLite database: {database}")
        return sqlite_connect(database, *args, **kwargs)

    monkeypatch.setattr(sqlite3, "connect", reject_file_sqlite)
    monkeypatch.setattr("deeptutor.services.llm.config.get_llm_config", lambda: SimpleNamespace())
    monkeypatch.setattr("deeptutor.services.session.context_builder.ContextBuilder", _ContextBuilder)
    monkeypatch.setattr("deeptutor.multi_user.model_access.redacted_model_access", lambda _user: {
        "llm": [{"available": True, "profile_id": "test", "model_id": "test"}],
    })
    monkeypatch.setattr("deeptutor.services.model_selection.apply_llm_selection_to_catalog", lambda *_: None)
    monkeypatch.setattr("deeptutor.services.model_selection.runtime.activate_llm_selection", lambda _: (SimpleNamespace(), None))
    container = ApplicationContainer.build()
    container.turn_engine = _Engine()
    container.runtime_registry.turn_engine = container.turn_engine
    set_application_container(container)
    sdk = DeepTutorApp(user_id=owner_a)
    cli = create_cli_app()
    try:
        (sdk_session, sdk_turn), (cli_session, cli_turn) = await asyncio.gather(
            sdk.start_turn({"content": "SDK question", "capability": "chat"}),
            cli.start_turn({"content": "CLI question", "capability": "chat"}),
        )
        assert sdk_turn["id"]
        assert cli_turn["id"]

        async def collect(app, turn_id):
            return [event async for event in app.stream_turn(turn_id)]

        sdk_events, cli_events = await asyncio.gather(
            collect(sdk, sdk_turn["id"]), collect(cli, cli_turn["id"]),
        )
        assert any(event["type"] == "done" for event in sdk_events)
        assert any(event["type"] == "done" for event in cli_events)
        assert (await sdk.get_session(cli_session["id"])) is None
        assert (await cli.get_session(sdk_session["id"])) is None
        assert (await sdk.get_session(sdk_session["id"]))["id"] == sdk_session["id"]
        assert (await cli.get_session(cli_session["id"]))["id"] == cli_session["id"]
        store = PostgresSessionStore(engine)
        assert [row["content"] for row in await store.get_messages(owner_a, sdk_session["id"])] == [
            "SDK question", "PostgreSQL reply",
        ]
        assert [row["content"] for row in await store.get_messages(owner_b, cli_session["id"])] == [
            "CLI question", "PostgreSQL reply",
        ]
        assert await store.get_turn(owner_b, sdk_turn["id"]) is None
        assert await store.get_turn(owner_a, cli_turn["id"]) is None

        async def authenticate(ws):
            return set_current_user(CurrentUser(
                id=ws.owner, username=ws.owner, role="user",
                scope=scope_for_user(ws.owner, is_admin=False),
            ))

        class Socket:
            app = SimpleNamespace(state=SimpleNamespace(application_container=container))

            def __init__(self, owner, question):
                self.owner = owner
                self.question = question
                self.sent = []
                self.finished = asyncio.Event()
                self.started = False

            async def accept(self):
                pass

            async def receive_text(self):
                if not self.started:
                    self.started = True
                    return json.dumps({"protocol_version": "2.0", "type": "start_turn",
                                       "content": self.question, "capability": "chat"})
                await asyncio.wait_for(self.finished.wait(), timeout=5)
                raise WebSocketDisconnect()

            async def send_text(self, payload):
                event = json.loads(payload)
                self.sent.append(event)
                if event.get("type") == "done":
                    self.finished.set()

        monkeypatch.setattr("deeptutor.api.routers.auth.ws_require_auth", authenticate)
        socket_a = Socket(owner_a, "Web question A")
        socket_b = Socket(owner_b, "Web question B")
        await asyncio.gather(unified_websocket(socket_a), unified_websocket(socket_b))
        for socket in (socket_a, socket_b):
            assert any(event.get("type") == "content" for event in socket.sent)
            assert any(event.get("type") == "done" for event in socket.sent)
        web_session = next(event["session_id"] for event in socket_a.sent if event.get("session_id"))
        web_other_session = next(event["session_id"] for event in socket_b.sent if event.get("session_id"))
        assert [row["content"] for row in await store.get_messages(owner_a, web_session)] == [
            "Web question A", "PostgreSQL reply",
        ]
        assert [row["content"] for row in await store.get_messages(owner_b, web_other_session)] == [
            "Web question B", "PostgreSQL reply",
        ]
        assert await store.get_messages(owner_b, web_session) == []
        assert await store.get_messages(owner_a, web_other_session) == []
        for owner in (owner_a, owner_b):
            assert not (scope_for_user(owner, is_admin=False).root / "user/chat_history.db").exists()
    finally:
        await close_application_container()
    restarted_sdk = DeepTutorApp(user_id=owner_a)
    restarted_cli = DeepTutorApp(user_id=owner_b)
    try:
        assert (await restarted_sdk.get_session(sdk_session["id"]))["id"] == sdk_session["id"]
        assert (await restarted_cli.get_session(cli_session["id"]))["id"] == cli_session["id"]
        assert (await restarted_sdk.get_session(web_session))["id"] == web_session
        assert await restarted_cli.get_session(web_session) is None
        assert (await restarted_cli.get_session(web_other_session))["id"] == web_other_session
        assert await restarted_sdk.get_session(web_other_session) is None
    finally:
        await close_application_container()
