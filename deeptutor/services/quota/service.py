from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.services.postgres.database import session_factory

from .plans import QUOTA_PERIODS, plan_limit


class QuotaError(Exception):
    code = "QUOTA_ERROR"


class QuotaExceededError(QuotaError):
    def __init__(self, *, metric: str, period: str, limit: int, upgrade_url: str):
        self.metric = metric
        self.period = period
        self.limit = limit
        self.upgrade_url = upgrade_url
        super().__init__(
            f"额度已用完：{metric} 本{'月' if period == 'month' else '日'}上限 {limit}"
        )


@dataclass(frozen=True)
class ChargeResult:
    charged: bool
    metric: str
    amount: int


def _period_starts(now: datetime | None = None) -> dict[str, date]:
    now = now or datetime.now(timezone.utc)
    today = now.date()
    return {"day": today, "month": today.replace(day=1)}


class QuotaService:
    """Per-account quota enforcement and idempotent metering."""

    def __init__(self, engine: AsyncEngine, *, upgrade_url: str = "/v1/billing/upgrade"):
        self._sessions = session_factory(engine)
        self._upgrade_url = upgrade_url

    async def _plan_for(self, db, owner_user_id: str) -> str:
        plan = (
            await db.execute(
                text("SELECT plan FROM subscriptions WHERE owner_user_id = :uid"),
                {"uid": owner_user_id},
            )
        ).scalar_one_or_none()
        return plan or "free"

    async def assert_allowed(self, owner_user_id: str, metric: str) -> None:
        """Raise QuotaExceededError when any period limit is already reached."""
        async with self._sessions() as db:
            plan = await self._plan_for(db, owner_user_id)
            starts = _period_starts()
            for period in QUOTA_PERIODS:
                limit = plan_limit(plan, period, metric)
                if limit is None:
                    continue
                consumed = (
                    await db.execute(
                        text(
                            """SELECT COALESCE(consumed, 0) FROM quota_counters
                               WHERE owner_user_id = :uid AND period = :p
                                 AND period_start = :start AND metric = :metric"""
                        ),
                        {
                            "uid": owner_user_id,
                            "p": period,
                            "start": starts[period],
                            "metric": metric,
                        },
                    )
                ).scalar_one_or_none()
                if (consumed or 0) >= limit:
                    raise QuotaExceededError(
                        metric=metric,
                        period=period,
                        limit=limit,
                        upgrade_url=self._upgrade_url,
                    )

    async def charge_once(
        self,
        *,
        idempotency_key: str,
        owner_user_id: str,
        metric: str,
        amount: int = 1,
        job_id: str | None = None,
        request_id: str | None = None,
    ) -> ChargeResult:
        """Record consumption exactly once per idempotency key.

        Replays (same key, e.g. retried job completion or duplicate review
        submit) return charged=False and never double-count.
        """
        starts = _period_starts()
        async with self._sessions() as db:
            insert = await db.execute(
                text(
                    """INSERT INTO quota_ledger
                       (owner_user_id, idempotency_key, metric, amount, job_id, request_id)
                       VALUES (:uid, :key, :metric, :amount, :job, :req)
                       ON CONFLICT (idempotency_key) DO NOTHING"""
                ),
                {
                    "uid": owner_user_id,
                    "key": idempotency_key,
                    "metric": metric,
                    "amount": amount,
                    "job": job_id,
                    "req": request_id,
                },
            )
            if insert.rowcount == 0:
                await db.rollback()
                return ChargeResult(False, metric, 0)
            for period in QUOTA_PERIODS:
                await db.execute(
                    text(
                        """INSERT INTO quota_counters
                           (owner_user_id, period, period_start, metric, consumed, updated_at)
                           VALUES (:uid, :p, :start, :metric, :amount, now())
                           ON CONFLICT (owner_user_id, period, period_start, metric)
                           DO UPDATE SET consumed = quota_counters.consumed + :amount,
                                         updated_at = now()"""
                    ),
                    {
                        "uid": owner_user_id,
                        "p": period,
                        "start": starts[period],
                        "metric": metric,
                        "amount": amount,
                    },
                )
            await db.commit()
        return ChargeResult(True, metric, amount)

    async def usage_summary(self, owner_user_id: str) -> dict:
        """Current-period consumption with the active plan limits."""
        async with self._sessions() as db:
            plan = await self._plan_for(db, owner_user_id)
            starts = _period_starts()
            rows = (
                await db.execute(
                    text(
                        """SELECT period, metric, consumed FROM quota_counters
                           WHERE owner_user_id = :uid AND period_start IN (:day, :month)"""
                    ),
                    {"uid": owner_user_id, "day": starts["day"], "month": starts["month"]},
                )
            ).all()
        summary: dict = {"plan": plan, "day": {}, "month": {}}
        for period, metric, consumed in rows:
            limit = plan_limit(plan, period, metric)
            summary[period][metric] = {
                "consumed": consumed,
                "limit": limit,
                "remaining": None if limit is None else max(0, limit - consumed),
            }
        return summary
