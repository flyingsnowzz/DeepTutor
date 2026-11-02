from __future__ import annotations

import os
import uuid

import pytest

from deeptutor.services.accounts.service import AccountService
from deeptutor.services.postgres.database import create_engine
from deeptutor.services.quota.service import QuotaExceededError, QuotaService

pytestmark = pytest.mark.skipif(
    os.environ.get("DATABASE_URL") is None, reason="DATABASE_URL not set"
)


import pytest_asyncio


@pytest_asyncio.fixture
async def owner():
    engine = create_engine(os.environ["DATABASE_URL"])
    accounts = AccountService(engine)
    uid = f"quota_{uuid.uuid4().hex[:12]}"
    await accounts.ensure_user(uid, plan="free")
    try:
        yield uid
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_quota_blocks_after_limit_and_idempotent(owner: str):
    engine = create_engine(os.environ["DATABASE_URL"])
    quota = QuotaService(engine)
    try:
        # free plan media day limit is 3
        for _ in range(3):
            await quota.assert_allowed(owner, "media")
            r = await quota.charge_once(
                idempotency_key=f"k:{uuid.uuid4().hex}",
                owner_user_id=owner,
                metric="media",
            )
            assert r.charged
        with pytest.raises(QuotaExceededError) as exc:
            await quota.assert_allowed(owner, "media")
        assert exc.value.limit == 3
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_same_key_charges_once(owner: str):
    engine = create_engine(os.environ["DATABASE_URL"])
    quota = QuotaService(engine)
    try:
        key = f"job:job_{uuid.uuid4().hex}"
        first = await quota.charge_once(
            idempotency_key=key, owner_user_id=owner, metric="research", job_id=key[4:]
        )
        second = await quota.charge_once(
            idempotency_key=key, owner_user_id=owner, metric="research", job_id=key[4:]
        )
        assert first.charged and not second.charged
        summary = await quota.usage_summary(owner)
        assert summary["day"]["research"]["consumed"] == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_pro_plan_unlimited():
    engine = create_engine(os.environ["DATABASE_URL"])
    accounts = AccountService(engine)
    quota = QuotaService(engine)
    uid = f"quota_pro_{uuid.uuid4().hex[:10]}"
    await accounts.ensure_user(uid, plan="pro")
    try:
        for _ in range(5):
            await quota.assert_allowed(uid, "media")
    finally:
        await engine.dispose()
