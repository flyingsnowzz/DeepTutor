from __future__ import annotations

import asyncio
import json
import os
import socket
import threading
import time

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
import pytest
from sqlalchemy import text

from deeptutor.mcp_server.cloud import build_cloud_app
from deeptutor.services.auth.config import AuthConfig
from deeptutor.services.jobs.runner import DeterministicCapabilityRunner
from deeptutor.services.postgres.database import create_engine
from deeptutor.services.storage.object_store import InMemoryObjectStore
from tests.mcp_server.http.conftest import TEST_SECRET, auth_headers, register_login

pytestmark = pytest.mark.asyncio


async def test_audit_events_recorded_for_authenticated_tools(http_client, base_url):
    tokens = register_login(http_client)
    cm = streamablehttp_client(f"{base_url}/mcp", headers=auth_headers(tokens))
    read, write, _ = await cm.__aenter__()
    session = ClientSession(read, write)
    await session.__aenter__()
    try:
        await session.initialize()
        result = await session.call_tool(
            "capability_run_submit",
            {"capability": "visualize", "input": {"prompt": "审计"}, "idempotency_key": "audit-1"},
        )
        submitted = json.loads(result.content[0].text)
        job_id = submitted["data"]["job_id"]
        for _ in range(50):
            got = json.loads(
                (await session.call_tool("capability_job_get", {"job_id": job_id})).content[0].text
            )
            if got["data"]["status"] in {"succeeded", "failed"}:
                break
            await asyncio.sleep(0.02)
    finally:
        await session.__aexit__(None, None, None)
        await cm.__aexit__(None, None, None)

    engine = create_engine(os.environ["DATABASE_URL"])
    try:
        async with engine.connect() as db:
            rows = (
                await db.execute(
                    text(
                        """SELECT tool, status, job_id, error_code FROM audit_events
                           WHERE owner_user_id=:uid ORDER BY id"""
                    ),
                    {"uid": tokens["user_id"]},
                )
            ).all()
        tools = {r[0] for r in rows}
        assert "capability_run_submit" in tools
        assert "capability_job_get" in tools
        # job terminal metering/audit
        assert "job_terminal" in tools
        submit = next(r for r in rows if r[0] == "capability_run_submit")
        assert submit[1] == "running" and submit[2] == job_id
    finally:
        await engine.dispose()


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_auth_rate_limit_returns_429(monkeypatch):
    if not os.environ.get("DATABASE_URL"):
        pytest.skip("DATABASE_URL not set")
    monkeypatch.setenv("MCP_RATE_LIMIT_AUTH_PER_MINUTE", "3")
    port = _free_port()
    import uvicorn

    config = AuthConfig(
        jwt_secret=TEST_SECRET, issuer="deeptutor-test", public_base_url=f"http://127.0.0.1:{port}"
    )
    app = build_cloud_app(
        object_store=InMemoryObjectStore(),
        runner=DeterministicCapabilityRunner(),
        auth_config=config,
    )
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        for _ in range(40):
            try:
                if httpx.get(f"http://127.0.0.1:{port}/healthz", timeout=1).status_code == 200:
                    break
            except Exception:  # noqa: BLE001
                time.sleep(0.2)
        statuses = [
            httpx.post(
                f"http://127.0.0.1:{port}/v1/auth/login",
                json={"email": "x@example.com", "password": "wrong"},
                timeout=5,
            ).status_code
            for _ in range(4)
        ]
        assert 429 in statuses, statuses
    finally:
        server.should_exit = True
        thread.join(timeout=5)
