#!/usr/bin/env python3
"""Run all WorkBuddy E2E scenarios.

python scripts/workbuddy/e2e/run.py            # stdio + HTTP
python scripts/workbuddy/e2e/run.py --transport stdio
python scripts/workbuddy/e2e/run.py --transport http
"""

from __future__ import annotations

import argparse
import asyncio
import os
import subprocess
import sys
import time

import httpx

if __package__ in (None, ""):
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
    from harness import ScenarioSession, free_port, register_login, scenario_env
    from scenarios import SCENARIOS
else:
    from .harness import ScenarioSession, free_port, register_login, scenario_env
    from .scenarios import SCENARIOS


def wait_ready(base: str) -> None:
    for _ in range(60):
        try:
            if httpx.get(f"{base}/healthz", timeout=2).status_code == 200:
                return
        except Exception:  # noqa: BLE001
            time.sleep(0.4)
    raise SystemExit("http server not ready")


async def run_transport(transport: str) -> None:
    if transport == "stdio":
        for scenario in SCENARIOS:
            async with ScenarioSession("stdio") as session:
                await scenario(session)
        return

    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = scenario_env()
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
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        wait_ready(base)
        tokens = register_login(base)
        for scenario in SCENARIOS:
            async with ScenarioSession("http", base=base, token=tokens["access_token"]) as session:
                await scenario(session)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--transport", choices=["stdio", "http", "both"], default="both")
    args = parser.parse_args()
    if not os.environ.get("DATABASE_URL"):
        raise SystemExit("DATABASE_URL is required for E2E scenarios")
    for transport in ("stdio", "http") if args.transport == "both" else (args.transport,):
        asyncio.run(run_transport(transport))
    print("all scenarios passed")


if __name__ == "__main__":
    main()
