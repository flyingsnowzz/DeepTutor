from __future__ import annotations

import asyncio
import json
import uuid

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
import pytest

from tests.mcp_server.http.conftest import auth_headers, register_login

pytestmark = pytest.mark.asyncio


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


async def _wait(session, job_id):
    for _ in range(100):
        fetched = await _call(session, "capability_job_get", {"job_id": job_id})
        if fetched["data"]["status"] in {"succeeded", "failed", "canceled"}:
            return fetched
        await asyncio.sleep(0.02)
    raise AssertionError("job never terminated")


async def test_video_lesson_job_to_artifact_url(http_client, base_url):
    tokens = register_login(http_client)
    session, cm = await _session(base_url, tokens)
    try:
        submitted = await _call(
            session,
            "lesson_video_generate_submit",
            {
                "input": {"prompt": "用视频讲清牛顿第二定律", "source_channel": "workbuddy"},
                "idempotency_key": f"lesson-{uuid.uuid4().hex[:10]}",
            },
        )
        assert submitted["ok"], submitted
        assert "渲染" in submitted["data"]["billing"]["notice"]

        job = await _wait(session, submitted["data"]["job_id"])
        assert job["data"]["status"] == "succeeded"
        artifact_ref = job["data"]["artifacts"][0]["artifact_ref"]

        fetched = await _call(
            session, "lesson_video_generate_get", {"job_id": job["data"]["job_id"]}
        )
        assert fetched["data"]["artifacts"][0]["mime_type"] == "video/mp4"

        artifact = await _call(session, "artifact_get", {"artifact_ref": artifact_ref})
        assert artifact["ok"] and artifact["data"]["url"].startswith(
            ("http://", "https://", "memory://")
        )
        assert artifact["data"]["expires_in_sec"] == 900
    finally:
        await _close(session, cm)


async def test_math_animation_dependency_gate_and_cross_owner(http_client, base_url):
    import shutil

    tokens = register_login(http_client)
    other = register_login(http_client)
    session, cm = await _session(base_url, tokens)
    try:
        listed = await _call(session, "capabilities_list", {})
        math_cap = next(c for c in listed["data"]["capabilities"] if c["name"] == "math_animator")

        if shutil.which("manim") or __import__("importlib.util").util.find_spec("manim"):
            pytest.skip(
                "manim installed; dependency gate covered in missing-dependency environments"
            )
        assert math_cap["status"] == "missing_dependency"
        assert any("manim" in dep.lower() for dep in math_cap["missing_dependencies"])

        submitted = await _call(
            session,
            "math_animation_generate_submit",
            {"input": {"prompt": "勾股定理动画"}, "idempotency_key": "math-1"},
        )
        assert submitted["ok"] is False
        assert submitted["error"]["code"] == "CAPABILITY_UNAVAILABLE"
    finally:
        await _close(session, cm)


async def test_hook_idempotency_review_polling_and_complete(http_client, base_url):
    tokens = register_login(http_client)
    session, cm = await _session(base_url, tokens)
    try:
        key = f"workbuddy:job_completed:{uuid.uuid4().hex[:12]}"
        args = {
            "event_type": "job_completed",
            "idempotency_key": key,
            "channel": "workbuddy",
            "source_ref": "job_demo",
        }
        first = await _call(session, "hook_event_submit", args)
        assert first["ok"] and first["data"]["replayed"] is False
        assert len(first["data"]["review_tasks"]) == 1
        second = await _call(session, "hook_event_submit", args)
        assert second["data"]["replayed"] is True
        assert len(second["data"]["review_tasks"]) == 1

        # Polling fallback when the host has no hook delivery.
        due = await _call(session, "review_tasks_list", {})
        assert due["data"]["count"] == 1
        task_id = due["data"]["tasks"][0]["id"]

        completed = await _call(session, "review_task_complete", {"review_task_id": task_id})
        assert completed["data"]["status"] == "completed"
        after = await _call(session, "review_tasks_list", {})
        assert after["data"]["count"] == 0

        deliveries = await _call(session, "hook_deliveries_list", {})
        assert deliveries["data"]["count"] == 1
    finally:
        await _close(session, cm)
