from __future__ import annotations

import asyncio
import json

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
import pytest

from tests.mcp_server.http.conftest import auth_headers, register_login

pytestmark = pytest.mark.asyncio


async def _session(base_url: str, tokens: dict):
    cm = streamablehttp_client(f"{base_url}/mcp", headers=auth_headers(tokens))
    read, write, _ = await cm.__aenter__()
    session = ClientSession(read, write)
    await session.__aenter__()
    await session.initialize()
    return session, cm


async def _close(session, cm):
    await session.__aexit__(None, None, None)
    await cm.__aexit__(None, None, None)


async def _call(session, name: str, arguments: dict) -> dict:
    result = await session.call_tool(name, arguments)
    return json.loads(result.content[0].text)


async def _wait_job(session, job_id: str) -> dict:
    for _ in range(100):
        fetched = await _call(session, "capability_job_get", {"job_id": job_id})
        status = fetched["data"]["status"]
        if status in {"succeeded", "failed", "canceled"}:
            return fetched
        await asyncio.sleep(0.02)
    raise AssertionError("job never terminated")


async def test_authenticated_capabilities_and_quota_metering(http_client, base_url):
    tokens = register_login(http_client)
    session, cm = await _session(base_url, tokens)
    try:
        listed = await _call(session, "capabilities_list", {})
        assert listed["ok"] and listed["data"]["plan"] == "free"
        names = {c["name"] for c in listed["data"]["capabilities"]}
        assert {"problem_solve", "quiz_judge", "audio_overview"} <= names

        # Idempotent submit: same key returns one job and must meter once.
        key = "idempotent-key-1"
        s1 = await _call(
            session,
            "capability_run_submit",
            {"capability": "visualize", "input": {"prompt": "图"}, "idempotency_key": key},
        )
        s2 = await _call(
            session,
            "capability_run_submit",
            {"capability": "visualize", "input": {"prompt": "别的图"}, "idempotency_key": key},
        )
        assert s1["data"]["job_id"] == s2["data"]["job_id"]
        job = await _wait_job(session, s1["data"]["job_id"])
        assert job["data"]["status"] == "succeeded"

        summary = await _call(session, "practice_summary_get", {})
        # visualize metered once
        assert summary["data"]["quota"]["day"]["visualization"]["consumed"] == 1
    finally:
        await _close(session, cm)


async def test_cross_account_job_and_artifact_isolation(http_client, base_url):
    a = register_login(http_client)
    b = register_login(http_client)
    sa, cma = await _session(base_url, a)
    try:
        submitted = await _call(
            sa,
            "capability_run_submit",
            {"capability": "visualize", "input": {"prompt": "A 的图"}, "idempotency_key": "iso-a"},
        )
        job = await _wait_job(sa, submitted["data"]["job_id"])
        artifact_ref = job["data"]["artifacts"][0]["artifact_ref"]
    finally:
        await _close(sa, cma)

    sb, cmb = await _session(base_url, b)
    try:
        other_job = await _call(sb, "capability_job_get", {"job_id": job["data"]["job_id"]})
        assert other_job["ok"] is False and other_job["error"]["code"] == "NOT_FOUND"
        other_art = await _call(sb, "artifact_get", {"artifact_ref": artifact_ref})
        assert other_art["ok"] is False and other_art["error"]["code"] == "NOT_FOUND"
    finally:
        await _close(sb, cmb)


async def test_quota_exceeded_rejects_with_upgrade_hint(http_client, base_url):
    tokens = register_login(http_client)
    session, cm = await _session(base_url, tokens)
    try:
        job_ids = []
        for i in range(3):  # free plan media day limit = 3
            submitted = await _call(
                session,
                "capability_run_submit",
                {
                    "capability": "audio_overview",
                    "input": {"prompt": f"音频{i}"},
                    "idempotency_key": f"media-{i}",
                },
            )
            assert submitted["ok"], submitted
            job_ids.append(submitted["data"]["job_id"])
        for jid in job_ids:
            await _wait_job(session, jid)
        blocked = await _call(
            session,
            "capability_run_submit",
            {
                "capability": "audio_overview",
                "input": {"prompt": "第4个"},
                "idempotency_key": "media-4",
            },
        )
        assert blocked["ok"] is False
        assert blocked["error"]["code"] == "QUOTA_EXCEEDED"
        assert blocked["error"]["details"]["upgrade_url"]
    finally:
        await _close(session, cm)
