#!/usr/bin/env python3
"""T4 external-host smoke: reading citations, media jobs, hook fan-out.

Drives the official MCP streamable-HTTP client through the T4 learning-media
contract with three learner stages (K12 / university / postgraduate):

  register material -> start reading session -> cited replies/quiz,
  video lesson job -> artifact URL, math animation dependency gate,
  hook idempotency -> one review task -> polling list -> complete.

Env: same as scripts/mcp_http_smoke.py plus DEEPTUTOR_MCP_DETERMINISTIC=1.
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


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_ready(base: str) -> None:
    for _ in range(60):
        try:
            if httpx.get(f"{base}/healthz", timeout=2).status_code == 200:
                return
        except Exception:  # noqa: BLE001
            time.sleep(0.4)
    raise SystemExit("server not ready")


def login(base: str) -> dict:
    email = f"t4_{uuid.uuid4().hex[:10]}@example.com"
    httpx.post(base + "/v1/auth/register", json={"email": email, "password": "password123"})
    r = httpx.post(base + "/v1/auth/login", json={"email": email, "password": "password123"})
    r.raise_for_status()
    return r.json()["data"]


async def call(session, name, args):
    result = await session.call_tool(name, args)
    return json.loads(result.content[0].text)


async def wait_job(session, job_id):
    for _ in range(100):
        got = await call(session, "capability_job_get", {"job_id": job_id})
        if got["data"]["status"] in {"succeeded", "failed", "canceled"}:
            return got
        await asyncio.sleep(0.1)
    raise SystemExit("job timed out")


MATERIAL = (
    "# 牛顿第二定律\n"
    "物体加速度的大小跟所受合外力成正比，跟物体质量成反比，公式 F=ma。\n"
    "# 应用\n"
    "已知合外力与质量时，用 a=F/m 求加速度；动量守恒是研究生阶段分析碰撞问题的基础。"
)

SCENARIOS = [
    ("K12 高中物理", "F=ma 是什么意思？合外力呢？"),
    ("大学普通物理", "如何由 F=ma 推出 a=F/m 求加速度？"),
    ("研究生", "请引用章节综述合外力与加速度的比例关系。"),
]


async def main() -> None:
    port = free_port()
    base = f"http://127.0.0.1:{port}"
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
        tokens = login(base)
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        async with streamablehttp_client(base + "/mcp", headers=headers) as (r, w, _):
            async with ClientSession(r, w) as session:
                await session.initialize()

                caps = (await call(session, "capabilities_list", {}))["data"]["capabilities"]
                by_name = {c["name"]: c for c in caps}
                assert by_name["immersive_reading"]["status"] == "ready"
                print(
                    "dependencies: video=",
                    by_name["video_lesson"]["status"],
                    "math=",
                    by_name["math_animator"]["status"],
                )

                mat = await call(
                    session,
                    "reading_material_register",
                    {"kind": "text", "title": "力学讲义", "content": MATERIAL},
                )
                assert mat["ok"], mat
                sid = (
                    await call(
                        session,
                        "reading_session_start",
                        {"material_id": mat["data"]["material_id"]},
                    )
                )["data"]["session_id"]

                for label, question in SCENARIOS:
                    answer = await call(
                        session,
                        "reading_session_reply",
                        {"session_id": sid, "message": question},
                    )
                    assert answer["data"]["citations"], label
                    locator = answer["data"]["citations"][0]["locator"]
                    print(f"reading [{label}] cite -> {locator}")

                quiz = await call(
                    session,
                    "reading_session_reply",
                    {"session_id": sid, "message": "出复习题", "mode": "quiz"},
                )
                assert quiz["data"]["citations"]
                print("reading quiz: OK")

                video = await call(
                    session,
                    "lesson_video_generate_submit",
                    {
                        "input": {"prompt": "视频讲解牛顿第二定律"},
                        "idempotency_key": f"video-{uuid.uuid4().hex[:10]}",
                    },
                )
                assert video["ok"], video
                final = await wait_job(session, video["data"]["job_id"])
                assert final["data"]["status"] == "succeeded"
                ref = final["data"]["artifacts"][0]["artifact_ref"]
                art = await call(session, "artifact_get", {"artifact_ref": ref})
                assert art["data"]["url"]
                print("video lesson -> artifact URL: OK")

                math = await call(
                    session,
                    "math_animation_generate_submit",
                    {"input": {"prompt": "勾股定理动画"}, "idempotency_key": "math-smoke"},
                )
                if not math["ok"]:
                    assert math["error"]["code"] == "CAPABILITY_UNAVAILABLE"
                    print("math animation dependency gate: OK", math["error"]["details"])
                else:
                    print("math animation accepted: OK")

                key = f"workbuddy:job_completed:{uuid.uuid4().hex[:12]}"
                args = {
                    "event_type": "job_completed",
                    "idempotency_key": key,
                    "channel": "workbuddy",
                    "source_ref": video["data"]["job_id"],
                }
                h1 = await call(session, "hook_event_submit", args)
                h2 = await call(session, "hook_event_submit", args)
                assert h1["data"]["replayed"] is False and h2["data"]["replayed"] is True
                assert len(h1["data"]["review_tasks"]) == len(h2["data"]["review_tasks"]) == 1
                print("hook idempotency -> single review task: OK")

                due = await call(session, "review_tasks_list", {})
                assert due["data"]["count"] == 1
                done = await call(
                    session,
                    "review_task_complete",
                    {"review_task_id": due["data"]["tasks"][0]["id"]},
                )
                assert done["data"]["status"] == "completed"
                print("review task poll + complete: OK")

        print(json.dumps({"status": "passed", "account": tokens["user_id"]}, ensure_ascii=False))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    asyncio.run(main())
