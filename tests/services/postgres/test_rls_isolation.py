"""Row-level security defense-in-depth through the restricted app role."""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("DATABASE_URL") is None, reason="DATABASE_URL not set"
)

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


@pytest.mark.asyncio
async def test_rls_blocks_cross_owner_rows():
    from sqlalchemy.engine import make_url

    if make_url(os.environ["DATABASE_URL"]).username != "deeptutor_app":
        pytest.skip("requires DATABASE_URL using the restricted deeptutor_app role")
    admin_url = os.environ.get("TEST_DATABASE_ADMIN_URL")
    if not admin_url:
        pytest.skip("requires TEST_DATABASE_ADMIN_URL for isolated setup and cleanup")

    admin = create_async_engine(admin_url.replace("postgresql://", "postgresql+asyncpg://", 1))
    owner_a = f"rls_a_{uuid.uuid4().hex[:8]}"
    owner_b = f"rls_b_{uuid.uuid4().hex[:8]}"
    try:
        async with admin.begin() as c:
            for owner in (owner_a, owner_b):
                await c.execute(text("INSERT INTO users (id) VALUES (:id)"), {"id": owner})
                await c.execute(
                    text("INSERT INTO subscriptions (owner_user_id) VALUES (:id)"), {"id": owner}
                )
            await c.execute(
                text("INSERT INTO sessions (id, owner_user_id, title) VALUES (:id, :o, 'A')"),
                {"id": f"sess_{uuid.uuid4().hex}", "o": owner_a},
            )

        app_engine = create_async_engine(os.environ["DATABASE_URL"])
        try:
            # No app.user_id GUC: RLS hides everything from the restricted role.
            async with app_engine.connect() as c:
                await c.commit()
                visible = (
                    await c.execute(
                        text("SELECT count(*) FROM sessions WHERE owner_user_id = :o"),
                        {"o": owner_a},
                    )
                ).scalar_one()
                assert visible == 0

            # Impersonating A shows A's row; writing another owner's row is rejected.
            async with app_engine.begin() as c:
                await c.execute(text("SELECT set_config('app.user_id', :owner, true)"), {"owner": owner_a})
                visible = (
                    await c.execute(
                        text("SELECT count(*) FROM sessions WHERE owner_user_id = :o"),
                        {"o": owner_a},
                    )
                ).scalar_one()
                assert visible == 1
                with pytest.raises(Exception):
                    await c.execute(
                        text(
                            "INSERT INTO sessions (id, owner_user_id, title) VALUES (:id, :o, 'B')"
                        ),
                        {"id": f"sess_{uuid.uuid4().hex}", "o": owner_b},
                    )
        finally:
            await app_engine.dispose()
    finally:
        async with admin.begin() as c:
            await c.execute(
                text("DELETE FROM sessions WHERE owner_user_id = ANY(:ids)"),
                {"ids": [owner_a, owner_b]},
            )
            await c.execute(
                text("DELETE FROM subscriptions WHERE owner_user_id = ANY(:ids)"),
                {"ids": [owner_a, owner_b]},
            )
            await c.execute(
                text("DELETE FROM users WHERE id = ANY(:ids)"), {"ids": [owner_a, owner_b]}
            )
        await admin.dispose()
