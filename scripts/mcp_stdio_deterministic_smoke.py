#!/usr/bin/env python3
"""Deterministic stdio MCP smoke for CI; exercises protocol, Postgres, and S3."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client


def parse(result):
    return json.loads(result.content[0].text)


async def main() -> int:
    env = os.environ.copy()
    env["DEEPTUTOR_MCP_DETERMINISTIC"] = "1"
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "deeptutor_cli.main", "mcp", "serve", "--transport", "stdio"],
        env=env,
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            names = {tool.name for tool in tools.tools}
            required = {
                "capabilities_list",
                "capability_run_submit",
                "capability_job_get",
                "capability_job_cancel",
                "capability_job_reply",
                "artifact_get",
                "quiz_generate_submit",
                "quiz_generate_job_get",
            }
            missing = required - names
            if missing:
                raise SystemExit(f"missing tools: {sorted(missing)}")

            key = f"ci-visualize-{uuid.uuid4().hex[:12]}"
            submitted = parse(await session.call_tool(
                "capability_run_submit",
                {"capability": "visualize", "input": {"prompt": "画学习闭环"}, "idempotency_key": key},
            ))
            job_id = submitted["data"]["job_id"]
            for _ in range(50):
                fetched = parse(await session.call_tool("capability_job_get", {"job_id": job_id}))
                status = fetched["data"]["status"]
                if status in {"succeeded", "failed", "canceled"}:
                    break
                await asyncio.sleep(0.02)
            else:
                raise SystemExit("job did not terminate")
            if status != "succeeded" or not fetched["data"]["artifacts"]:
                raise SystemExit(f"bad terminal job: {fetched}")
            artifact = parse(await session.call_tool(
                "artifact_get", {"artifact_ref": fetched["data"]["artifacts"][0]["artifact_ref"]}
            ))
            print(json.dumps({"job_id": job_id, "status": status, "artifact": artifact["data"]}, ensure_ascii=False))
            return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
