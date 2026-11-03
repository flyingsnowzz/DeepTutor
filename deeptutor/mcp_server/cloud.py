"""Wiring for the authenticated multi-account cloud HTTP service.

First-party App/Web/SDK keep calling application services directly; this stack
only serves external hosts (WorkBuddy, Qianwen Office, Doubao) over MCP.
"""

from __future__ import annotations

import os

from mcp.server.fastmcp import Context
from sqlalchemy import text

from deeptutor.learning.storage_postgres import PostgresMasteryRepository
from deeptutor.services.accounts.service import AccountService
from deeptutor.services.audit import AuditService
from deeptutor.services.auth.config import AuthConfig, load_auth_config
from deeptutor.services.auth.service import AuthService
from deeptutor.services.hooks import HookService
from deeptutor.services.jobs.postgres import PostgresJobService
from deeptutor.services.jobs.runner import DeterministicCapabilityRunner
from deeptutor.services.postgres.database import create_engine
from deeptutor.services.practice.postgres import PostgresPracticeRepository
from deeptutor.services.quota.plans import metric_for_capability
from deeptutor.services.quota.service import QuotaService
from deeptutor.services.reading.service import ReadingService
from deeptutor.services.session.postgres_store import PostgresSessionStore
from deeptutor.services.storage.object_store import ObjectStore

from .context import RequestPrincipal
from .errors import McpError
from .http_app import build_http_app
from .server import create_mcp_server


class JobQuotaRecorder:
    """Idempotently meters successful jobs and audits terminal transitions."""

    def __init__(self, quota: QuotaService, audit: AuditService | None = None):
        self._quota = quota
        self._audit = audit

    async def __call__(self, job, outcome, error) -> None:
        if outcome is None:
            if self._audit is not None:
                await self._audit.log(
                    request_id="",
                    owner_user_id=job.owner_user_id,
                    tool="job_terminal",
                    job_id=job.id,
                    status=job.status,
                    error_code=(error or {}).get("code", job.status),
                )
            return
        metric = metric_for_capability(job.capability)
        await self._quota.charge_once(
            idempotency_key=f"job:{job.id}",
            owner_user_id=job.owner_user_id,
            metric=metric.value,
            job_id=job.id,
        )
        if self._audit is not None:
            await self._audit.log(
                request_id="",
                owner_user_id=job.owner_user_id,
                tool="job_terminal",
                job_id=job.id,
                status="succeeded",
                usage={
                    "metric": metric.value,
                    "artifacts": len(job.artifacts or []),
                    "usage": outcome.usage or {},
                },
            )


async def http_principal_resolver(ctx: Context) -> RequestPrincipal:
    request = getattr(ctx.request_context, "request", None)
    principal = getattr(request.state, "principal", None) if request is not None else None
    if principal is None:  # pragma: no cover - middleware always runs for /mcp
        raise McpError(
            "UNAUTHENTICATED",
            "缺少或无效的访问令牌",
            http_status=401,
            details={"scheme": "Bearer"},
        )
    return principal


def build_cloud_app(
    *,
    object_store: ObjectStore,
    runner,
    auth_config: AuthConfig | None = None,
):
    """Construct the production HTTP ASGI app and its service handles."""
    config = auth_config or load_auth_config()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for the cloud HTTP service")

    engine = create_engine(database_url)
    accounts = AccountService(engine)
    auth = AuthService(engine, config, accounts=accounts)
    quota = QuotaService(
        engine, upgrade_url=f"{config.public_base_url.rstrip('/')}/v1/billing/plans"
    )
    audit = AuditService(engine)
    sessions = PostgresSessionStore(engine)
    practice = PostgresPracticeRepository(engine)
    mastery = PostgresMasteryRepository(engine)
    reading_answerer = None
    if not isinstance(runner, DeterministicCapabilityRunner) or os.environ.get(
        "DEEPTUTOR_READING_LLM"
    ) == "1":
        from deeptutor.services.reading.llm_answerer import LLMReadingAnswerer

        reading_answerer = LLMReadingAnswerer()
    reading = ReadingService(engine, object_store=object_store, answerer=reading_answerer)
    hooks = HookService(engine)

    recorder = JobQuotaRecorder(quota, audit)
    jobs = PostgresJobService(
        database_url,
        engine=engine,
        object_store=object_store,
        runner=runner,
        terminal_listener=recorder,
    )

    mcp = create_mcp_server(
        principal_resolver=http_principal_resolver,
        job_service=jobs,
        object_store=object_store,
        practice_repo=practice,
        mastery_repo=mastery,
        quota=quota,
        audit=audit,
        reading_service=reading,
        hook_service=hooks,
    )

    async def readiness_check() -> None:
        from deeptutor.services.postgres.database import session_factory

        factory = session_factory(engine)
        async with factory() as db:
            await db.execute(text("SELECT 1"))

    app = build_http_app(
        auth=auth,
        quota=quota,
        config=config,
        mcp=mcp,
        readiness_check=readiness_check,
        engine=engine,
    )
    app.state.engine = engine
    app.state.auth = auth
    app.state.accounts = accounts
    app.state.quota = quota
    app.state.audit = audit
    app.state.sessions = sessions
    app.state.practice = practice
    app.state.mastery = mastery
    app.state.reading = reading
    app.state.hooks = hooks
    app.state.jobs = jobs
    return app
