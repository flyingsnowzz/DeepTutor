from __future__ import annotations

import pytest

from deeptutor.services.accounts.service import AccountService


@pytest.mark.asyncio
async def test_ensure_user_is_idempotent_and_bootstraps_subscription(accounts, owner_factory):
    owner = owner_factory("account")
    await accounts.ensure_user(owner, display_name="Carol", email=f"carol-{owner}@example.com")
    # Second call must not duplicate and must preserve/refresh fields safely.
    await accounts.ensure_user(owner, display_name="", email=None)

    async with accounts._sessions() as db:
        from sqlalchemy import text

        user = (
            await db.execute(
                text("SELECT display_name, email FROM users WHERE id=:id"), {"id": owner}
            )
        ).one()
        sub = (
            await db.execute(
                text("SELECT plan, status FROM subscriptions WHERE owner_user_id=:id"),
                {"id": owner},
            )
        ).one()
    assert user.display_name == "Carol"  # empty display name must not overwrite
    assert user.email == f"carol-{owner}@example.com"
    assert sub.plan == "free" and sub.status == "active"
    assert await accounts.get_plan(owner) == "free"


@pytest.mark.asyncio
async def test_new_user_id_shape():
    assert AccountService.new_user_id().startswith("user_")
