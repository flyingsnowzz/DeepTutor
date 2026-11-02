from __future__ import annotations

import json
import os
import uuid

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
import pytest

from deeptutor.services.postgres.database import create_engine
from deeptutor.services.practice.postgres import PostgresPracticeRepository
from tests.mcp_server.http.conftest import auth_headers, register_login

pytestmark = [
    pytest.mark.skipif(os.environ.get("DATABASE_URL") is None, reason="DATABASE_URL not set"),
    pytest.mark.asyncio,
]


async def _session(base_url, tokens):
    cm = streamablehttp_client(f"{base_url}/mcp", headers=auth_headers(tokens))
    read, write, _ = await cm.__aenter__()
    session = ClientSession(read, write)
    await session.__aenter__()
    await session.initialize()
    return session, cm


async def _close(session, cm):
    await session.__aexit__(None, None, None)
    await cm.__aexit__(None, None, None)


async def _call(session, name, arguments):
    result = await session.call_tool(name, arguments)
    return json.loads(result.content[0].text)


async def test_answer_check_replay_and_review_flow(http_client, base_url):
    tokens = register_login(http_client)
    owner = tokens["user_id"]

    engine = create_engine(os.environ["DATABASE_URL"])
    practice = PostgresPracticeRepository(engine)
    entry_id = await practice.add_entry(
        owner,
        {
            "id": f"pe_{uuid.uuid4().hex[:16]}",
            "question": "1+1=?",
            "question_type": "single_choice",
            "options": {"A": "1", "B": "2"},
            "correct_answer": "B",
            "question_id": "q1",
        },
    )

    session, cm = await _session(base_url, tokens)
    try:
        req1 = f"req_{uuid.uuid4().hex[:12]}"
        wrong = await _call(
            session,
            "practice_answer_check",
            {"entry_id": entry_id, "answer": "A", "request_id": req1},
        )
        assert wrong["ok"] and wrong["data"]["is_correct"] is False
        assert wrong["data"]["review"] is not None

        # Replaying the same request_id never scores or charges twice.
        replay = await _call(
            session,
            "practice_answer_check",
            {"entry_id": entry_id, "answer": "B", "request_id": req1},
        )
        assert replay["ok"] and replay["data"]["replayed"] is True

        queue = await _call(session, "practice_queue_list", {})
        assert queue["data"]["count"] == 1
        due = queue["data"]["items"][0]
        assert due["entry_id"] == entry_id

        # Correct answer with a new request id resolves the question.
        req2 = f"req_{uuid.uuid4().hex[:12]}"
        right = await _call(
            session,
            "practice_answer_check",
            {"entry_id": entry_id, "answer": "b", "request_id": req2},
        )
        assert right["data"]["is_correct"] is True

        # SRS review with a third id; invalid rating is a contract error.
        bad_rating = await _call(
            session,
            "practice_review_submit",
            {
                "entry_id": entry_id,
                "rating": "perfect",
                "request_id": f"req_{uuid.uuid4().hex[:10]}",
            },
        )
        assert bad_rating["ok"] is False and bad_rating["error"]["code"] == "INVALID_ARGUMENT"

        good = await _call(
            session,
            "practice_review_submit",
            {"entry_id": entry_id, "rating": "good", "request_id": f"req_{uuid.uuid4().hex[:10]}"},
        )
        assert good["ok"] and good["data"]["review"]["rating"] == "good"

        bookmark = await _call(
            session, "practice_entry_bookmark", {"entry_id": entry_id, "bookmarked": True}
        )
        assert bookmark["ok"] and bookmark["data"]["bookmarked"] is True
    finally:
        await _close(session, cm)
        await engine.dispose()


async def test_practice_owner_isolation(http_client, base_url):
    a = register_login(http_client)
    b = register_login(http_client)
    engine = create_engine(os.environ["DATABASE_URL"])
    practice = PostgresPracticeRepository(engine)
    entry_id = await practice.add_entry(
        a["user_id"],
        {"id": f"pe_{uuid.uuid4().hex[:16]}", "question": "私密题", "correct_answer": "X"},
    )

    sb, cmb = await _session(base_url, b)
    try:
        get = await _call(sb, "practice_question_get", {"entry_id": entry_id})
        assert get["ok"] is False and get["error"]["code"] == "NOT_FOUND"
        answer = await _call(
            sb,
            "practice_answer_check",
            {"entry_id": entry_id, "answer": "X", "request_id": f"req_{uuid.uuid4().hex[:10]}"},
        )
        assert answer["ok"] is False and answer["error"]["code"] == "NOT_FOUND"
        bookmark = await _call(
            sb, "practice_entry_bookmark", {"entry_id": entry_id, "bookmarked": True}
        )
        assert bookmark["ok"] is False and bookmark["error"]["code"] == "NOT_FOUND"
    finally:
        await _close(sb, cmb)
        await engine.dispose()


async def test_mastery_tools_return_not_found_for_other_owner(http_client, base_url):
    tokens = register_login(http_client)
    other = register_login(http_client)

    from deeptutor.learning.storage_postgres import PostgresMasteryRepository

    engine = create_engine(os.environ["DATABASE_URL"])
    mastery = PostgresMasteryRepository(engine)
    path_id = await mastery.create_path(
        tokens["user_id"], {"path_id": f"mp_{uuid.uuid4().hex[:10]}"}
    )
    await mastery.append_event(tokens["user_id"], path_id, "path_started", {})

    session, cm = await _session(base_url, tokens)
    try:
        mp = await _call(session, "mastery_map_get", {"path_id": path_id})
        assert mp["ok"] and mp["data"]["stats"]["events"] == 1
        obj = await _call(session, "mastery_objective_get", {"path_id": path_id})
        assert obj["ok"]
    finally:
        await _close(session, cm)

    so, cmo = await _session(base_url, other)
    try:
        denied = await _call(so, "mastery_map_get", {"path_id": path_id})
        assert denied["ok"] is False and denied["error"]["code"] == "NOT_FOUND"
    finally:
        await _close(so, cmo)
        await engine.dispose()
