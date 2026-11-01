from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio

from deeptutor.services.accounts.service import AccountService
from deeptutor.services.postgres.database import create_engine


@pytest.fixture(scope="session")
def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not set; Postgres integration tests require a real PostgreSQL")
    return url


@pytest_asyncio.fixture
async def engine(database_url):
    engine = create_engine(database_url)
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def accounts(engine) -> AccountService:
    return AccountService(engine)


@pytest.fixture
def owner_factory():
    def _make(prefix: str = "user") -> str:
        return f"{prefix}_{uuid.uuid4().hex[:12]}"

    return _make


@pytest_asyncio.fixture
async def two_owners(accounts, owner_factory):
    """Create two fully bootstrapped accounts for A/B isolation tests."""
    owner_a = owner_factory("owner-a")
    owner_b = owner_factory("owner-b")
    await accounts.ensure_user(owner_a, display_name="Alice", plan="free")
    await accounts.ensure_user(owner_b, display_name="Bob", plan="free")
    return owner_a, owner_b
