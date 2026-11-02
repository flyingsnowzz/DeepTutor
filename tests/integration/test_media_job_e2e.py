"""End-to-end media job evidence for T4.

Runs the authenticated streamable-HTTP MCP service exactly like an external
host: a media job submitted, polled to success, artifact fetched via a
short-lived authorized URL, and an owner cannot read another owner's media.
Skipped unless DATABASE_URL is configured.
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import threading
import time
import uuid

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
import pytest
import uvicorn

from deeptutor.mcp_server.cloud import build_cloud_app
from deeptutor.mcp_server.dependencies import media_dependencies
from deeptutor.services.auth.config import AuthConfig
from deeptutor.services.jobs.runner import DeterministicCapabilityRunner
from deeptutor.services.storage.object_store import InMemoryObjectStore
from tests.mcp_server.http.conftest import TEST_SECRET, register_login

pytestmark = pytest.mark.skipif(
    os.environ.get("DATABASE_URL") is None, reason="DATABASE_URL not set"
)

SECRET = TEST_SECRET


def _port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def base_url():
    port = _port()
    os.environ["DEEPTUTOR_OPS_TOKEN"] = "media-ops"
    config = AuthConfig(
        jwt_secret=SECRET,
        issuer="deeptutor-test",
        public_base_url=f"http://127.0.0.1:{port}",
    )
    app = build_cloud_app(
        object_store=InMemoryObjectStore(),
        runner=DeterministicCapabilityRunner(),
        auth_config=config,
    )
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(50):
        try:
            if httpx.get(f"http://127.0.0.1:{port}/healthz", timeout=1).status_code == 200:
                break
        except Exception:  # noqa: BLE001
            time.sleep(0.2)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=5)


async def _session(base_url, tokens):
    cm = streamablehttp_client(
        f"{base_url}/mcp", headers={"Authorization": f"Bearer {tokens['access_token']}"}
    )
    read, write, _ = await cm.__aenter__()
    session = ClientSession(read, write)
    await session.__aenter__()
    await session.initialize()
    return session, cm


async def _call(session, name, arguments):
    result = await session.call_tool(name, arguments)
    return json.loads(result.content[0].text)


@pytest.mark.asyncio
async def test_media_job_submit_to_artifact_url(base_url):
    tokens = register_login(httpx.Client(base_url=base_url, timeout=15))
    cm_ctx = streamablehttp_client(
        f"{base_url}/mcp", headers={"Authorization": f"Bearer {tokens['access_token']}"}
    )
    read, write, _ = await cm_ctx.__aenter__()
    async with ClientSession(read, write) as session:
        await session.initialize()

        submitted = await _call(
            session,
            "lesson_video_generate_submit",
            {
                "input": {"prompt": "高中物理：动量守恒", "source_channel": "workbuddy"},
                "idempotency_key": f"e2e-{uuid.uuid4().hex[:10]}",
            },
        )
        assert submitted["ok"], submitted
        job_id = submitted["data"]["job_id"]

        final = None
        for _ in range(100):
            fetched = await _call(session, "capability_job_get", {"job_id": job_id})
            if fetched["data"]["status"] in {"succeeded", "failed"}:
                final = fetched
                break
            await asyncio.sleep(0.02)
        assert final and final["data"]["status"] == "succeeded"
        assert final["data"]["artifacts"][0]["mime_type"] == "video/mp4"

        artifact = await _call(
            session, "artifact_get", {"artifact_ref": final["data"]["artifacts"][0]["artifact_ref"]}
        )
        assert artifact["ok"] and artifact["data"]["url"]
        assert artifact["data"]["expires_in_sec"] == 900

        # Long media work never blocked the MCP call: submit returned immediately.
        assert submitted["data"]["status"] in {"queued", "running"}

        # Channel attribution reaches ops reporting.
        r = httpx.get(
            f"{base_url}/v1/ops/capability_stats",
            headers={"x-ops-token": "media-ops"},
            timeout=10,
        )
        assert r.status_code == 200
        channels = {c["channel"]: c["jobs"] for c in r.json()["data"]["channels"]}
        assert channels.get("workbuddy", 0) >= 1
    await cm_ctx.__aexit__(None, None, None)


@pytest.mark.asyncio
async def test_media_job_owner_isolation(base_url):
    client = httpx.Client(base_url=base_url, timeout=15)
    a = register_login(client)
    b = register_login(client)
    cm_a = streamablehttp_client(
        f"{base_url}/mcp", headers={"Authorization": f"Bearer {a['access_token']}"}
    )
    read_a, write_a, _ = await cm_a.__aenter__()
    job_id = None
    async with ClientSession(read_a, write_a) as session:
        await session.initialize()
        submitted = await _call(
            session,
            "lesson_video_generate_submit",
            {
                "input": {"prompt": "研究生：贝叶斯推断直觉讲解"},
                "idempotency_key": f"e2e-{uuid.uuid4().hex[:10]}",
            },
        )
        job_id = submitted["data"]["job_id"]
        for _ in range(100):
            fetched = await _call(session, "capability_job_get", {"job_id": job_id})
            if fetched["data"]["status"] in {"succeeded", "failed"}:
                break
            await asyncio.sleep(0.02)
        artifact_ref = fetched["data"]["artifacts"][0]["artifact_ref"]
    await cm_a.__aexit__(None, None, None)

    cm_b = streamablehttp_client(
        f"{base_url}/mcp", headers={"Authorization": f"Bearer {b['access_token']}"}
    )
    read_b, write_b, _ = await cm_b.__aenter__()
    async with ClientSession(read_b, write_b) as session:
        await session.initialize()
        denied_job = await _call(session, "capability_job_get", {"job_id": job_id})
        denied_art = await _call(session, "artifact_get", {"artifact_ref": artifact_ref})
        assert denied_job["ok"] is False and denied_job["error"]["code"] == "NOT_FOUND"
        assert denied_art["ok"] is False and denied_art["error"]["code"] == "NOT_FOUND"
    await cm_b.__aexit__(None, None, None)
    client.close()


def test_dependency_gate_contract():
    # Documented in capabilities_list; must stay stable for T5 skill packaging.
    report = media_dependencies()
    assert set(report) == {
        "math_animator",
        "video_lesson",
        "immersive_reading",
        "audio_overview",
    }
