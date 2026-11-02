#!/usr/bin/env python3
"""End-to-end smoke for the cloud HTTP MCP service.

Starts `deeptutor mcp serve --transport http` as a subprocess, registers two
accounts over HTTP, then drives the official MCP streamable-HTTP client with
Bearer tokens to verify: initialization, capability submission/polling,
artifact presign, and cross-account isolation. This is the external-host
integration evidence for T3.

Requires DATABASE_URL + object storage env and DEEPTUTOR_ALLOW_DEV_SECRET=1
(local development secret); set DEEPTUTOR_MCP_DETERMINISTIC=1 for no-LLM runs.
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import sys
import time
import uuid

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

BASE = os.environ.get("DEEPTUTOR_HTTP_BASE", "http://127.0.0.1:8021")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_ready(url: str, timeout: float = 25.0) -> None:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            r = httpx.get(f"{url}/healthz", timeout=2)
            if r.status_code == 200:
                return
        except Exception as exc:  # noqa: BLE001
            last = exc
        time.sleep(0.4)
    raise SystemExit(f"server not ready: {last}")


def register_and_login(base: str, email: str, password: str = "password123") -> dict:
    httpx.post(
        f"{base}/v1/auth/register",
        json={"email": email, "password": password},
        timeout=10,
    )
    r = httpx.post(
        f"{base}/v1/auth/login",
        json={"email": email, "password": password},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()["data"]


async def mcp_call(session: ClientSession, name: str, arguments: dict) -> dict:
    result = await session.call_tool(name, arguments)
    text = result.content[0].text
    return json.loads(text)


async def run_for(token: str, base_mcp: str, *, isolate: bool = False) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    async with streamablehttp_client(base_mcp, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = {t.name for t in (await session.list_tools()).tools}
            assert "capability_run_submit" in tools

            listed = await mcp_call(session, "capabilities_list", {})
            names = {c["name"] for c in listed["data"]["capabilities"]}
            assert {"deep_research", "problem_solve", "quiz_judge", "audio_overview"} <= names

            submitted = await mcp_call(
                session,
                "capability_run_submit",
                {
                    "capability": "visualize",
                    "input": {"prompt": "画学习闭环"},
                    "idempotency_key": f"smoke-{uuid.uuid4().hex}",
                },
            )
            job_id = submitted["data"]["job_id"]
            for _ in range(100):
                fetched = await mcp_call(session, "capability_job_get", {"job_id": job_id})
                if fetched["data"]["status"] in {"succeeded", "failed", "canceled"}:
                    break
                await asyncio.sleep(0.1)
            assert fetched["data"]["status"] == "succeeded", fetched
            artifact_ref = fetched["data"]["artifacts"][0]["artifact_ref"]
            artifact = await mcp_call(session, "artifact_get", {"artifact_ref": artifact_ref})
            assert artifact["data"]["url"].startswith(("http://", "https://", "memory://"))
            return {"job_id": job_id, "artifact_ref": artifact_ref}


async def main() -> None:
    port = int(os.environ.get("DEEPTUTOR_HTTP_PORT", "0")) or free_port()
    base = BASE.rsplit(":", 1)[0] + f":{port}"
    env = os.environ.copy()
    env["DEEPTUTOR_PUBLIC_BASE_URL"] = base
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "deeptutor_cli.main",
            "mcp",
            "serve",
            "--transport",
            "http",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env,
    )
    try:
        wait_ready(base)

        # 1. Unauthenticated /mcp must be a clean 401.
        r = httpx.post(
            f"{base}/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
            headers={"accept": "application/json, text/event-stream"},
            timeout=10,
        )
        assert r.status_code == 401, r.status_code
        assert r.json()["error"]["details"]["login_url"], r.text
        print("401 flow: OK")

        suffix = uuid.uuid4().hex[:10]
        a = register_and_login(base, f"smoke_a_{suffix}@example.com")
        b = register_and_login(base, f"smoke_b_{suffix}@example.com")
        print("register/login: OK")

        # 2. Refresh rotation works and the old refresh token is revoked.
        rr = httpx.post(
            f"{base}/v1/auth/refresh",
            json={"refresh_token": a["refresh_token"]},
            timeout=10,
        )
        assert rr.status_code == 200, rr.text
        rotated = rr.json()["data"]
        replay = httpx.post(
            f"{base}/v1/auth/refresh",
            json={"refresh_token": a["refresh_token"]},
            timeout=10,
        )
        assert replay.status_code == 401, replay.text
        token_a = rotated["access_token"]
        print("refresh rotation + reuse revoke: OK")

        result_a = await run_for(token_a, f"{base}/mcp")
        print("authenticated MCP job + artifact: OK", result_a["job_id"])

        # 3. Account B cannot read A's job through MCP.
        headers_b = {"Authorization": f"Bearer {b['access_token']}"}
        async with streamablehttp_client(f"{base}/mcp", headers=headers_b) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                fetched = await mcp_call(
                    session, "capability_job_get", {"job_id": result_a["job_id"]}
                )
                # T0 error contract: failures are JSON envelopes, not exceptions.
                assert fetched["ok"] is False and fetched["error"]["code"] == "NOT_FOUND", fetched
        print("cross-account isolation: OK")

        # 4. Practice learning-state tools are reachable and owner-scoped.
        async with streamablehttp_client(
            f"{base}/mcp", headers={"Authorization": f"Bearer {token_a}"}
        ) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                summary = await mcp_call(session, "practice_summary_get", {})
                assert summary["ok"] is True and "quota" in summary["data"], summary
                paths = await mcp_call(session, "mastery_paths_list", {})
                assert paths["ok"] is True
        print("learning-state tools: OK")

        print(
            json.dumps(
                {"status": "passed", "base": base, "account_a": a["user_id"]}, ensure_ascii=False
            )
        )
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    asyncio.run(main())
