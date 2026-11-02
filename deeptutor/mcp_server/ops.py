"""Internal operations reporting: capability success/latency/cost/channel stats."""

from __future__ import annotations

import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine


async def capability_stats(engine: AsyncEngine) -> dict:
    async with engine.connect() as db:
        by_capability = (
            await db.execute(
                text(
                    """SELECT capability, source_channel, status, count(*) AS n
                       FROM jobs GROUP BY capability, source_channel, status ORDER BY 1, 2, 3"""
                )
            )
        ).all()
        latencies = (
            await db.execute(
                text(
                    """SELECT capability,
                              count(*) FILTER (WHERE finished_at IS NOT NULL) AS finished,
                              avg(extract(epoch FROM (finished_at - started_at))) AS avg_seconds,
                              count(*) FILTER (WHERE status='canceled') AS canceled
                       FROM jobs GROUP BY capability ORDER BY capability"""
                )
            )
        ).all()
        costs = (
            await db.execute(
                text(
                    """SELECT j.capability,
                              count(*) AS jobs,
                              coalesce(sum(u.total_tokens),0) AS tokens,
                              coalesce(sum(u.cost_usd),0)::float AS cost_usd,
                              count(DISTINCT a.id) AS artifacts,
                              coalesce(sum(a.size_bytes),0) AS artifact_bytes
                       FROM jobs j
                       LEFT JOIN usage_events u ON u.job_id = j.id
                       LEFT JOIN artifacts a ON a.job_id = j.id
                       GROUP BY j.capability ORDER BY j.capability"""
                )
            )
        ).all()
        channels = (
            await db.execute(
                text(
                    "SELECT source_channel, count(*) FROM jobs GROUP BY source_channel ORDER BY 2 DESC"
                )
            )
        ).all()

    stats: dict = {}
    for capability, channel, status, n in by_capability:
        bucket = stats.setdefault(capability, {"by_status": {}, "by_channel": {}})
        bucket["by_status"][status] = bucket["by_status"].get(status, 0) + n
        bucket["by_channel"][channel] = bucket["by_channel"].get(channel, 0) + n
    for capability, finished, avg_seconds, canceled in latencies:
        stats.setdefault(capability, {"by_status": {}, "by_channel": {}})
        stats[capability]["finished"] = finished
        stats[capability]["avg_duration_sec"] = round(float(avg_seconds or 0), 3)
        stats[capability]["canceled"] = canceled
        total = sum(stats[capability]["by_status"].values()) or 1
        ok_n = stats[capability]["by_status"].get("succeeded", 0)
        stats[capability]["success_rate"] = round(ok_n / total, 4)
    for capability, jobs, tokens, cost_usd, artifacts, artifact_bytes in costs:
        bucket = stats.setdefault(capability, {"by_status": {}, "by_channel": {}})
        bucket["cost"] = {
            "jobs": jobs,
            "tokens": int(tokens),
            "cost_usd": round(float(cost_usd), 6),
            "artifacts": artifacts,
            "artifact_bytes": int(artifact_bytes),
        }
    return {
        "capabilities": stats,
        "channels": [{"channel": c, "jobs": n} for c, n in channels],
    }


def ops_token_valid(presented: str | None) -> bool:
    expected = os.environ.get("DEEPTUTOR_OPS_TOKEN", "")
    if not expected:
        return False
    return bool(presented) and presented == expected
