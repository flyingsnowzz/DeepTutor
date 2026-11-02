from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.services.postgres.database import session_factory


class AuditService:
    """Writes one row per authenticated tool/API call.

    Records who called what, with which request/job/resource ids, result
    status, error code and coarse usage. Never stores secrets, provider
    credentials, or full free-text answers.
    """

    def __init__(self, engine: AsyncEngine):
        self._sessions = session_factory(engine)

    async def log(
        self,
        *,
        request_id: str,
        owner_user_id: str | None,
        tool: str,
        status: str = "ok",
        job_id: str | None = None,
        resource_id: str | None = None,
        error_code: str = "",
        usage: dict[str, Any] | None = None,
        ip: str = "",
    ) -> None:
        import json

        try:
            async with self._sessions() as db:
                await db.execute(
                    text(
                        """INSERT INTO audit_events
                           (request_id, owner_user_id, tool, job_id, resource_id, status,
                            error_code, usage_json, ip, created_at)
                           VALUES (:rid, :uid, :tool, :job, :res, :status, :code,
                                   CAST(:usage AS JSONB), :ip, now())"""
                    ),
                    {
                        "rid": request_id,
                        "uid": owner_user_id,
                        "tool": tool[:64],
                        "job": job_id,
                        "res": resource_id,
                        "status": status,
                        "code": error_code,
                        "usage": json.dumps(usage or {}, ensure_ascii=False)[:2000],
                        "ip": ip[:64],
                    },
                )
                await db.commit()
        except Exception:  # noqa: BLE001 - audit must never break the request path
            pass
