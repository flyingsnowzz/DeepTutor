"""Shared platform data services for first-party entry points and the MCP server.

DeepTutor first-party App/Web/SDK call these application services directly;
the external MCP server calls the exact same objects (see
``deeptutor.mcp_server.factory``). Only external hosts go through MCP.

All relational state lives in PostgreSQL; binaries live in S3-compatible
object storage; Redis is only coordination/queue/cache. Repositories assume
the caller has already authenticated ``owner_user_id`` and always scope every
query by that owner — resource ids alone never authorize access.
"""

from __future__ import annotations

from dataclasses import dataclass
import os

from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.learning.storage_postgres import PostgresMasteryRepository
from deeptutor.learning.assessment_postgres import PostgresAssessmentRepository
from deeptutor.services.accounts.service import AccountService
from deeptutor.services.accounts.admin import AdminAccountService
from deeptutor.services.accounts.first_party import FirstPartyAccountService
from deeptutor.services.jobs.postgres import PostgresJobService
from deeptutor.services.jobs.runner import CapabilityRunner
from deeptutor.services.postgres.database import create_engine
from deeptutor.services.practice.postgres import PostgresPracticeRepository
from deeptutor.services.session.postgres_store import PostgresSessionStore
from deeptutor.services.storage.object_store import ObjectStore


@dataclass
class PlatformDataServices:
    """One shared engine + repositories, usable by MCP and first-party code."""

    engine: AsyncEngine
    auth_engine: AsyncEngine
    accounts: AccountService
    admins: AdminAccountService
    first_party_accounts: FirstPartyAccountService
    sessions: PostgresSessionStore
    practice: PostgresPracticeRepository
    mastery: PostgresMasteryRepository
    assessments: PostgresAssessmentRepository
    jobs: PostgresJobService
    object_store: ObjectStore

    async def close(self) -> None:
        await self.jobs.close()  # cancels in-flight tasks, disposes shared engine last
        if self.auth_engine is not self.engine:
            await self.auth_engine.dispose()
        await self.engine.dispose()


def build_platform_services(
    *,
    object_store: ObjectStore,
    runner: CapabilityRunner,
    database_url: str | None = None,
    auth_database_url: str | None = None,
) -> PlatformDataServices:
    url = database_url or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is required for platform data services")
    engine = create_engine(url)
    # Credential lookup happens before an owner id is known. A production
    # deployment can provide a separate narrowly privileged auth connection;
    # local development continues to use the table-owning role.
    auth_url = auth_database_url or os.environ.get("AUTH_DATABASE_URL") or url
    auth_engine = engine if auth_url == url else create_engine(auth_url)
    accounts = AccountService(engine)
    jobs = PostgresJobService(url, engine=engine, object_store=object_store, runner=runner)
    return PlatformDataServices(
        engine=engine,
        auth_engine=auth_engine,
        accounts=accounts,
        admins=AdminAccountService(auth_engine),
        first_party_accounts=FirstPartyAccountService(auth_engine),
        sessions=PostgresSessionStore(engine),
        practice=PostgresPracticeRepository(engine),
        mastery=PostgresMasteryRepository(engine),
        assessments=PostgresAssessmentRepository(engine),
        jobs=jobs,
        object_store=object_store,
    )
