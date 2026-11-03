#!/usr/bin/env python3
"""Audit real DeepTutor capability output through the external MCP boundary.

Unlike the deterministic protocol E2E suite, this always uses the real
TurnCapabilityRunner and records whether each capability produced meaningful
output instead of merely returning a successful job status.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
import sys
import time
import uuid

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

OUT_DIR = Path("docs-for-dev/workbuddy/capability-audit")

CASES = {
    "deep_research": {
        "prompt": "用快速研究模式，简要说明立方体体积公式 V=a³ 的含义，给出两点教学要点。",
        "config": {"mode": "notes", "depth": "quick"},
        "timeout": 900,
    },
    "visualize": {
        "prompt": "用 Mermaid 可视化讲解立方体体积 V=a³，必须包含棱长 a、单位小立方体堆叠和棱长 3 时体积 27。",
        "timeout": 300,
    },
    "deep_question": {
        "prompt": "围绕立方体体积 V=a³ 出 1 道四选一选择题，给出答案和解析。",
        "timeout": 300,
    },
    "problem_solve": {
        "prompt": "分步解方程 x²-4x+3=0，并核对两个根。",
        "timeout": 300,
    },
    "quiz_judge": {
        "prompt": "请作为形成性评价助教判分：题目『立方体棱长为 3，体积是多少？』；参考答案『27，因为 3³=27』；学生答案『9，因为 3×3=9』。指出正误、错因和下一步建议。",
        "timeout": 300,
    },
    "audio_overview": {
        "prompt": "生成约 30 秒的立方体体积音频导学，解释 V=a³，并给出棱长 3 时体积 27 的例子。",
        "knowledge_bases": ["capability-audit-cube-v2"],
        "config": {"target_minutes": 1, "host_voice": "Tingting", "expert_voice": "Reed"},
        "timeout": 600,
    },
    "mastery_path": {
        "prompt": "为初中生生成『立方体体积』掌握路径，包含理解棱长、掌握 V=a³、简单应用三个阶段。",
        "timeout": 600,
    },
    "video_lesson": {
        "prompt": "生成约 8 秒、只有 2 个简洁场景的立方体体积视频课，展示 V=a³ 和 3³=27。",
        "timeout": 900,
    },
    "math_animator": {
        "prompt": "生成约 5 秒、只有一个简洁场景的数学动画，显示 V=a³ 和 3³=27，不要复杂几何体。",
        "timeout": 900,
    },
}


def _is_placeholder(value) -> bool:
    text = json.dumps(value, ensure_ascii=False, default=str).lower()
    markers = (
        "placeholder",
        "占位",
        "learning-loop.mmd",
        '"video_ready": false',
        '"audio_ready": false',
        '"render_type": "placeholder"',
    )
    return any(marker in text for marker in markers)


async def call(session: ClientSession, name: str, arguments: dict) -> dict:
    result = await session.call_tool(name, arguments)
    return json.loads(result.content[0].text)


async def wait_job(session: ClientSession, job_id: str, timeout: int) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        payload = await call(session, "capability_job_get", {"job_id": job_id})
        if payload.get("ok") and payload["data"].get("status") in {
            "succeeded",
            "failed",
            "canceled",
        }:
            return payload
        await asyncio.sleep(1)
    raise TimeoutError(f"job {job_id} did not terminate within {timeout}s")


async def run_reading(session: ClientSession) -> dict:
    started = time.time()
    material = await call(
        session,
        "reading_material_register",
        {
            "kind": "text",
            "title": "立方体体积讲义",
            "content": "第一节 棱长\n立方体的长、宽、高都等于 a。\n\n第二节 体积\n立方体体积 V=a×a×a=a³。棱长为 3 时，V=27。",
        },
    )
    material_id = material["data"]["material_id"]
    session_data = await call(
        session, "reading_session_start", {"material_id": material_id, "mode": "study"}
    )
    session_id = session_data["data"]["session_id"]
    reply = await call(
        session,
        "reading_session_reply",
        {"session_id": session_id, "message": "根据材料说明体积公式和棱长为 3 时的结果", "mode": "study"},
    )
    return {
        "capability": "immersive_reading",
        "status": "succeeded" if reply.get("ok") else "failed",
        "elapsed_seconds": round(time.time() - started, 3),
        "placeholder_detected": _is_placeholder(reply),
        "material": material,
        "session": session_data,
        "reply": reply,
    }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("capabilities", nargs="*", default=["visualize"])
    args = parser.parse_args()
    selected = list(CASES) + ["immersive_reading"] if args.capabilities == ["all"] else args.capabilities
    unknown = set(selected) - set(CASES) - {"immersive_reading"}
    if unknown:
        raise SystemExit(f"unknown capabilities: {sorted(unknown)}")

    env = os.environ.copy()
    env["DEEPTUTOR_MCP_DETERMINISTIC"] = "0"
    env["DEEPTUTOR_READING_LLM"] = "1"
    env["DEEPTUTOR_ALLOW_DEV_SECRET"] = "1"
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "deeptutor_cli.main", "mcp", "serve", "--transport", "stdio"],
        env=env,
    )
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            catalog = await call(session, "capabilities_list", {})
            (OUT_DIR / "catalog.json").write_text(
                json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            for capability in selected:
                print(f"\n=== {capability} ===", flush=True)
                if capability == "immersive_reading":
                    record = await run_reading(session)
                else:
                    case = CASES[capability]
                    started = time.time()
                    try:
                        submit = await call(
                            session,
                            "capability_run_submit",
                            {
                                "capability": capability,
                                "input": {k: v for k, v in case.items() if k != "timeout"},
                                "idempotency_key": f"real-audit:{capability}:{uuid.uuid4().hex}",
                            },
                        )
                    except Exception as exc:  # dependency gate / contract failure
                        record = {
                            "capability": capability,
                            "status": "failed",
                            "elapsed_seconds": 0,
                            "placeholder_detected": False,
                            "submit_error": f"{type(exc).__name__}: {exc}",
                        }
                        path = OUT_DIR / f"{capability}.json"
                        path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                        print(json.dumps({"status": "failed", "error": str(exc)}, ensure_ascii=False), flush=True)
                        continue
                    job_id = (submit.get("data") or {}).get("job_id")
                    try:
                        final = await wait_job(session, job_id, case["timeout"]) if job_id else submit
                    except Exception as exc:  # timeout or unexpected capability failure
                        record = {
                            "capability": capability,
                            "status": "failed",
                            "elapsed_seconds": round(time.time() - started, 3),
                            "placeholder_detected": False,
                            "error": f"{type(exc).__name__}: {exc}",
                        }
                    else:
                        record = {
                            "capability": capability,
                            "status": final.get("data", {}).get("status", "error"),
                            "elapsed_seconds": round(time.time() - started, 3),
                            "placeholder_detected": _is_placeholder(final),
                            "submit": submit,
                            "final": final,
                        }
                path = OUT_DIR / f"{capability}.json"
                path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                print(
                    json.dumps(
                        {
                            k: record[k]
                            for k in (
                                "status",
                                "elapsed_seconds",
                                "placeholder_detected",
                                "error",
                            )
                            if k in record
                        },
                        ensure_ascii=False,
                    ),
                    flush=True,
                )


if __name__ == "__main__":
    asyncio.run(main())
