from __future__ import annotations

import time
import uuid

import pytest

from deeptutor.services.auth.config import AuthConfig
from deeptutor.services.auth.errors import EmailTakenError, RefreshReuseError, TokenError
from deeptutor.services.auth.service import AuthService
from deeptutor.services.postgres.database import create_engine

pytestmark = pytest.mark.skipif(
    __import__("os").environ.get("DATABASE_URL") is None,
    reason="DATABASE_URL not set",
)


import pytest_asyncio


@pytest_asyncio.fixture
async def auth(auth_config: AuthConfig):
    import os

    engine = create_engine(os.environ["DATABASE_URL"])
    service = AuthService(engine, auth_config)
    try:
        yield service
    finally:
        await engine.dispose()


async def _register(auth: AuthService) -> tuple[str, str]:
    email = f"t3_{uuid.uuid4().hex[:12]}@example.com"
    uid = await auth.register(email, "password123", display_name="T3")
    return uid, email


@pytest.mark.asyncio
async def test_register_login_and_decode(auth: AuthService):
    uid, email = await _register(auth)
    principal, pair = await auth.login(email, "password123")
    assert principal.owner_user_id == uid and principal.plan == "free"
    assert pair.access_token and pair.refresh_token.startswith("dt_refresh_")

    decoded = auth.decode_access_token(pair.access_token)
    assert decoded.owner_user_id == uid and decoded.workspace_id == uid


@pytest.mark.asyncio
async def test_duplicate_email_and_bad_password(auth: AuthService):
    _, email = await _register(auth)
    with pytest.raises(EmailTakenError):
        await auth.register(email, "password123")
    with pytest.raises(Exception):
        await auth.login(email, "wrong-password")
    with pytest.raises(Exception):
        await auth.register(f"short_{uuid.uuid4().hex[:6]}@example.com", "short")


@pytest.mark.asyncio
async def test_refresh_rotation_revokes_old_and_detects_reuse(auth: AuthService):
    _, email = await _register(auth)
    _, pair = await auth.login(email, "password123")

    _, rotated = await auth.rotate_refresh_token(pair.refresh_token)
    assert rotated.refresh_token != pair.refresh_token

    # A rotated token presented again is treated as token theft: the whole
    # session family is revoked, including the replacement.
    with pytest.raises(RefreshReuseError):
        await auth.rotate_refresh_token(pair.refresh_token)
    with pytest.raises(TokenError):
        await auth.rotate_refresh_token(rotated.refresh_token)


@pytest.mark.asyncio
async def test_revoke_refresh_token(auth: AuthService):
    _, email = await _register(auth)
    _, pair = await auth.login(email, "password123")
    assert await auth.revoke_refresh_token(pair.refresh_token) is True
    with pytest.raises(TokenError):
        await auth.rotate_refresh_token(pair.refresh_token)
    assert await auth.revoke_refresh_token(pair.refresh_token) is False


@pytest.mark.asyncio
async def test_invalid_access_token_rejected(auth: AuthService):
    with pytest.raises(TokenError):
        auth.decode_access_token("not-a-jwt")
    other = AuthConfig(
        jwt_secret="other-secret-0123456789-abcdef-0123456789-long",
        issuer="deeptutor-test",
    )
    engine = auth._engine
    foreign = AuthService(engine, other)
    _, email = await _register(auth)
    _, pair = await auth.login(email, "password123")
    with pytest.raises(TokenError):
        foreign.decode_access_token(pair.access_token)
