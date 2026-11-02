"""Shared E2E harness for WorkBuddy scenarios.

Starts the real MCP server (stdio or HTTP), calls it through the official MCP
client, and writes a structured record per scenario. Deterministic runners are
used by default so no model credentials are needed.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from typing import Any
import uuid

import httpx
from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.client.streamable_http import streamablehttp_client

RECORD_DIR = Path("docs-for-dev/workbuddy/e2e")


def scenario_env() -> dict:
    env = os.environ.copy()
    env.setdefault("DEEPTUTOR_MCP_DETERMINISTIC", "1")
    env.setdefault("DEEPTUTOR_ALLOW_DEV_SECRET", "1")
    return env


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def register_login(base: str) -> dict:
    email = f"e2e_{uuid.uuid4().hex[:10]}@example.com"
    httpx.post(f"{base}/v1/auth/register", json={"email": email, "password": "password123"})
    response = httpx.post(f"{base}/v1/auth/login", json={"email": email, "password": "password123"})
    response.raise_for_status()
    return response.json()["data"]


class ScenarioSession:
    """Drives either stdio or HTTP transport and records tool calls."""

    def __init__(
        self, transport: str = "stdio", *, base: str | None = None, token: str | None = None
    ):
        self.transport = transport
        self.base = base
        self.token = token
        self.proc: subprocess.Popen | None = None
        self.session: ClientSession | None = None
        self._cm = None
        self.calls: list[dict[str, Any]] = []
        self.started = time.time()

    async def __aenter__(self) -> "ScenarioSession":
        if self.transport == "stdio":
            params = StdioServerParameters(
                command=sys.executable,
                args=["-m", "deeptutor_cli.main", "mcp", "serve", "--transport", "stdio"],
                env=scenario_env(),
            )
            self._cm = stdio_client(params)
            read, write = await self._cm.__aenter__()
        else:
            assert self.base and self.token
            self._cm = streamablehttp_client(
                f"{self.base}/mcp", headers={"Authorization": f"Bearer {self.token}"}
            )
            read, write, _ = await self._cm.__aenter__()
        self.session = ClientSession(read, write)
        await self.session.__aenter__()
        await self.session.initialize()
        return self

    async def __aexit__(self, *exc) -> None:
        # stdio teardown in the mcp client can raise anyio cancel-scope
        # errors when the server has already exited; cleanup must not mask a
        # passing scenario or leak the subprocess.
        for closer in (
            self.session.__aexit__ if self.session is not None else None,
            self._cm.__aexit__ if self._cm is not None else None,
        ):
            if closer is None:
                continue
            try:
                await closer(*exc)
            except BaseException:  # noqa: BLE001
                pass
        if self.proc is not None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self.proc.kill()

    async def call(self, name: str, arguments: dict[str, Any]) -> dict:
        assert self.session is not None
        result = await self.session.call_tool(name, arguments)
        payload = json.loads(result.content[0].text)
        self.calls.append({"tool": name, "arguments": arguments, "response": payload})
        return payload

    async def wait_job(
        self, job_id: str, *, getter: str = "capability_job_get", timeout_s: float = 30
    ) -> dict:
        for _ in range(int(timeout_s * 10)):
            payload = await self.call(getter, {"job_id": job_id})
            if payload["ok"] and payload["data"]["status"] in {"succeeded", "failed", "canceled"}:
                return payload
            await asyncio.sleep(0.1)
        raise AssertionError(f"job {job_id} did not terminate")


def write_record(
    scenario: str,
    transport: str,
    *,
    user_prompt: str,
    calls: list[dict],
    final_reply: str,
    elapsed_s: float,
    extra: dict | None = None,
) -> Path:
    RECORD_DIR.mkdir(parents=True, exist_ok=True)
    path = RECORD_DIR / f"{scenario}-{transport}.json"
    data = {
        "scenario": scenario,
        "transport": transport,
        "user_prompt": user_prompt,
        "skill": "deeptutor-learning",
        "tool_calls": calls,
        "final_reply": final_reply,
        "elapsed_seconds": round(elapsed_s, 3),
        "cost": {"model": "deterministic (offline)", "llm_cost_usd": 0.0},
        "recorded_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        **(extra or {}),
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
