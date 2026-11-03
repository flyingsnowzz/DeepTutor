#!/usr/bin/env python3
"""Host-driven content generation E2E for T5.

WorkBuddy (host) creates the question content itself; DeepTutor only persists
it and runs answer checking / SRS / summary. No server-side model call is made.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import uuid

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

from .harness import RECORD_DIR


async def main() -> None:
    host_question = {
        "question": "二次函数 y=x²-4x+3 的顶点坐标是？",
        "question_type": "single_choice",
        "options": {"A": "(2,1)", "B": "(2,-1)", "C": "(-2,1)", "D": "(-2,-1)"},
        "correct_answer": "B",
        "explanation": "y=(x-2)²-1，所以顶点为 (2,-1)。",
        "knowledge_point_id": "kp-quadratic-vertex",
    }
    env = os.environ.copy()
    env["DEEPTUTOR_MCP_DETERMINISTIC"] = "1"
    params = StdioServerParameters(
        command=os.environ.get("PYTHON", sys.executable),
        args=["-m", "deeptutor_cli.main", "mcp", "serve", "--transport", "stdio"],
        env=env,
    )
    started = time.time()
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            async def call(name: str, args: dict) -> dict:
                result = await session.call_tool(name, args)
                return json.loads(result.content[0].text)

            created = await call("practice_entry_create", host_question)
            assert created["ok"], created
            entry_id = created["data"]["entry_id"]

            wrong = await call(
                "practice_answer_check",
                {"entry_id": entry_id, "answer": "A", "request_id": f"host:{uuid.uuid4().hex}"},
            )
            assert wrong["data"]["is_correct"] is False
            assert wrong["data"]["review"]["rating"] == "again"

            review = await call(
                "practice_review_submit",
                {"entry_id": entry_id, "rating": "good", "request_id": f"host:{uuid.uuid4().hex}"},
            )
            assert review["ok"]
            summary = await call("practice_summary_get", {})
            assert summary["data"]["total"] >= 1

    out = {
        "scenario": "06-host-driven-practice",
        "transport": "stdio",
        "model_call_by": "workbuddy_host",
        "server_model_call": False,
        "user_prompt": "WorkBuddy 生成二次函数顶点坐标选择题后，学生作答并安排复习",
        "host_generated_question": host_question,
        "tool_flow": [
            "practice_entry_create",
            "practice_answer_check",
            "practice_review_submit",
            "practice_summary_get",
        ],
        "result": {
            "entry_created": True,
            "wrong_answer_detected": True,
            "review_rating": review["data"]["review"]["rating"],
            "summary_total": summary["data"]["total"],
        },
        "elapsed_seconds": round(time.time() - started, 3),
        "evidence_note": "题目由宿主（WorkBuddy）提供，DeepTutor 只负责判题、复习调度与统计，不需要服务端再调模型生成。",
    }
    RECORD_DIR.mkdir(parents=True, exist_ok=True)
    path = RECORD_DIR / "06-host-driven-practice-stdio.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"host-driven practice passed -> {path}")


if __name__ == "__main__":
    asyncio.run(main())
