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
from deeptutor.services.accounts.service import AccountService
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
    accounts: AccountService
    sessions: PostgresSessionStore
    practice: PostgresPracticeRepository
    mastery: PostgresMasteryRepository
    jobs: PostgresJobService
    object_store: ObjectStore

    async def close(self) -> None:
        await self.jobs.close()  # cancels in-flight tasks, disposes shared engine last
        await self.engine.dispose()


def build_platform_services(
    *,
    object_store: ObjectStore,
    runner: CapabilityRunner,
    database_url: str | None = None,
) -> PlatformDataServices:
    url = database_url or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is required for platform data services")
    engine = create_engine(url)
    accounts = AccountService(engine)
    jobs = PostgresJobService(url, engine=engine, object_store=object_store, runner=runner)
    return PlatformDataServices(
        engine=engine,
        accounts=accounts,
        sessions=PostgresSessionStore(engine),
        practice=PostgresPracticeRepository(engine),
        mastery=PostgresMasteryRepository(engine),
        jobs=jobs,
        object_store=object_store,
    )
