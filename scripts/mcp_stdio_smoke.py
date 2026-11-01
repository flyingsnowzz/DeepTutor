#!/usr/bin/env python3
"""Smoke test DeepTutor MCP stdio server through the real MCP client protocol."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client


def parse(result):
    text = result.content[0].text if result.content else "{}"
    return json.loads(text)


async def main() -> int:
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "deeptutor_cli.main", "mcp", "serve", "--transport", "stdio"],
        env=os.environ.copy(),
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            print("server", init.serverInfo.name, init.serverInfo.version)
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

            submitted = parse(
                await session.call_tool(
                    "capability_run_submit",
                    {
                        "capability": "visualize",
                        "input": {"prompt": "画学习闭环"},
                        "idempotency_key": f"smoke-visualize-{uuid.uuid4().hex[:12]}",
                    },
                )
            )
            job_id = submitted["data"]["job_id"]
            print("submitted", job_id, submitted["data"]["status"])

            final = None
            for _ in range(2400):
                fetched = parse(await session.call_tool("capability_job_get", {"job_id": job_id}))
                if fetched["data"]["status"] in {"succeeded", "failed", "canceled"}:
                    final = fetched["data"]
                    break
                await asyncio.sleep(0.05)
            if final is None:
                raise SystemExit("job did not terminate")
            print("job", final["status"], "artifacts", len(final["artifacts"]))
            if final["status"] != "succeeded" or not final["artifacts"]:
                raise SystemExit("visualize job did not succeed with artifact")

            artifact = parse(
                await session.call_tool(
                    "artifact_get", {"artifact_ref": final["artifacts"][0]["artifact_ref"]}
                )
            )
            print("artifact", artifact["data"]["mime_type"], artifact["data"]["url"])
            return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
