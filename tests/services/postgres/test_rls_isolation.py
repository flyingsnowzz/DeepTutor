"""Row-level security defense-in-depth through the restricted app role."""

from __future__ import annotations

import asyncio
import os
import re
import uuid

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("DATABASE_URL") is None, reason="DATABASE_URL not set"
)

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


def _app_database_url() -> str | None:
    url = os.environ["DATABASE_URL"]
    if "deeptutor_app:" in url:
        return url
    return url.replace("deeptutor:deeptutor@", "deeptutor_app:appdev@", 1)


async def _app_engine_works() -> bool:
    url = _app_database_url()
    if "deeptutor_app:appdev@" not in url:
        return False
    engine = create_async_engine(url)
    try:
        async with engine.connect() as c:
            await c.execute(text("SELECT 1"))
        return True
    except Exception:  # noqa: BLE001
        return False
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_rls_blocks_cross_owner_rows():
    if not await _app_engine_works():
        pytest.skip("restricted deeptutor_app role is not configured")

    admin = create_async_engine(os.environ["DATABASE_URL"])
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

        app_engine = create_async_engine(_app_database_url())
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
                assert re.fullmatch(r"[A-Za-z0-9_\-]{1,64}", owner_a)
                await c.execute(text(f"SET LOCAL app.user_id = '{owner_a}'"))
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
