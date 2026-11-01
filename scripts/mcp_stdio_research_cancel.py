#!/usr/bin/env python3
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


async def main():
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "deeptutor_cli.main", "mcp", "serve", "--transport", "stdio"],
        env=os.environ.copy(),
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            submitted = parse(await session.call_tool(
                "capability_run_submit",
                {"capability": "deep_research", "input": {"prompt": "研究间隔重复的学习机制"}, "idempotency_key": f"cancel-research-{uuid.uuid4().hex[:12]}"},
            ))
            job_id = submitted["data"]["job_id"]
            print("submitted", job_id, submitted["data"]["status"])
            await asyncio.sleep(0.5)
            canceled = parse(await session.call_tool("capability_job_cancel", {"job_id": job_id}))
            print("cancel", canceled["data"]["status"])
            fetched = parse(await session.call_tool("capability_job_get", {"job_id": job_id}))
            status = fetched["data"]["status"]
            print("final", status)
            if status != "canceled":
                raise SystemExit(f"expected canceled, got {status}")

asyncio.run(main())
