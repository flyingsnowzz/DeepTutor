"""Opt-in PostgreSQL account gateway for the first-party Web API."""

from __future__ import annotations

from functools import lru_cache
import os

from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.services.auth import (
    AUTH_ENABLED,
    POCKETBASE_ENABLED,
    AUTH_PASSWORD_HASH,
    AUTH_SECRET,
    AUTH_USERNAME,
    TokenPayload,
    create_token,
)
from deeptutor.services.postgres.database import authentication_database_url, create_engine

from .admin import AdminAccountService
from .first_party import FirstPartyAccountService


def postgres_accounts_enabled() -> bool:
    return os.environ.get("DEEPTUTOR_ACCOUNT_BACKEND", "local").strip().lower() == "postgres"


class PostgresWebAccountGateway:
    def __init__(self, engine: AsyncEngine):
        self.engine = engine
        self.users = FirstPartyAccountService(engine)
        self.admins = AdminAccountService(engine)

    async def ensure_bootstrap_admin(self) -> None:
        if AUTH_USERNAME and AUTH_PASSWORD_HASH:
            await self.admins.bootstrap_superadmin(AUTH_USERNAME, AUTH_PASSWORD_HASH)

    async def decode_token(self, token: str | None) -> TokenPayload | None:
        if not token:
            return None
        try:
            claims = jwt.decode(token, AUTH_SECRET, algorithms=["HS256"])
        except (JWTError, ValueError):
            return None
        account_kind = str(claims.get("kind") or "")
        user_id = str(claims.get("uid") or "")
        username = str(claims.get("sub") or "")
        if not user_id or not username:
            return None
        if account_kind == "postgres_user":
            user = await self.users.get_user(user_id)
            if user is None or user["username"] != username:
                return None
            device_id = str(claims.get("dcid") or "")
            device_nonce = str(claims.get("dcs") or "")
            if device_id:
                from deeptutor.multi_user.device_credentials import validate_device_token

                if not validate_device_token(user_id, device_id, device_nonce):
                    return None
            return TokenPayload(
                username=username, role=user["role"], user_id=user_id,
                device_credential_id=device_id, device_session_nonce=device_nonce,
            )
        if account_kind == "postgres_admin":
            admin = await self.admins.get_admin(user_id)
            if admin is None or admin["username"] != username:
                return None
            return TokenPayload(
                username=username, role="admin", user_id=user_id,
                account_kind="admin", is_super_admin=bool(admin["is_superadmin"]),
            )
        return None

    def issue_user_token(
        self, user: dict, *, device_credential_id: str = "", device_session_nonce: str = ""
    ) -> str:
        return create_token(
            str(user["username"]), str(user.get("role") or "user"), str(user["id"]),
            account_kind="postgres_user",
            device_credential_id=device_credential_id,
            device_session_nonce=device_session_nonce,
        )

    def issue_admin_token(self, admin: dict) -> str:
        return create_token(
            str(admin["username"]), "admin", str(admin["id"]),
            account_kind="postgres_admin",
        )


@lru_cache(maxsize=1)
def get_postgres_web_account_gateway() -> PostgresWebAccountGateway:
    if not postgres_accounts_enabled():
        raise RuntimeError("PostgreSQL account backend is not selected")
    if not AUTH_ENABLED or POCKETBASE_ENABLED or not AUTH_SECRET:
        raise RuntimeError("PostgreSQL account backend requires enabled built-in authentication")
    return PostgresWebAccountGateway(create_engine(authentication_database_url()))


async def close_postgres_web_account_gateway() -> None:
    if get_postgres_web_account_gateway.cache_info().currsize:
        gateway = get_postgres_web_account_gateway()
        await gateway.engine.dispose()
        get_postgres_web_account_gateway.cache_clear()
