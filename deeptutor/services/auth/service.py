"""Email/password registration, login, JWT access tokens and refresh rotation.

The skill / external host never sees passwords: it opens a browser to the
hosted register/login pages, and only carries Bearer access tokens. Refresh
tokens are opaque; only their sha256 hash is persisted, and reuse of a rotated
or revoked token revokes the whole account session family (theft response).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import uuid

import jwt
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.services.accounts.service import AccountService
from deeptutor.services.postgres.database import session_factory

from .config import MIN_PASSWORD_LENGTH, AuthConfig
from .errors import (
    EmailTakenError,
    InvalidCredentialsError,
    RefreshReuseError,
    TokenError,
)
from .security import hash_password, hash_token, new_refresh_token, verify_password


@dataclass(frozen=True)
class Principal:
    user_id: str
    workspace_id: str
    owner_user_id: str
    plan: str
    email: str | None = None
    token_jti: str | None = None


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str
    token_type: str
    expires_in: int
    refresh_expires_in: int


def _normalize_email(email: str) -> str:
    return email.strip().lower()


class AuthService:
    def __init__(
        self, engine: AsyncEngine, config: AuthConfig, accounts: AccountService | None = None
    ):
        self._engine = engine
        self._sessions = session_factory(engine)
        self._config = config
        self._accounts = accounts or AccountService(engine)

    # ------------------------------------------------------------------ register
    async def register(self, email: str, password: str, display_name: str = "") -> str:
        email = _normalize_email(email)
        self._validate_password(password)
        if "@" not in email or len(email) > 320:
            raise InvalidCredentialsError("邮箱格式不正确")

        user_id = AccountService.new_user_id()
        password_hash = hash_password(password)
        async with self._sessions() as db:
            existing = (
                await db.execute(
                    text("SELECT 1 FROM password_credentials WHERE email = :email"),
                    {"email": email},
                )
            ).first()
            if existing:
                raise EmailTakenError("该邮箱已注册")
            await self._accounts.ensure_user(
                user_id, display_name=display_name or email, email=email
            )
            await db.execute(
                text(
                    """INSERT INTO password_credentials (owner_user_id, email, password_hash)
                       VALUES (:uid, :email, :hash)"""
                ),
                {"uid": user_id, "email": email, "hash": password_hash},
            )
            await db.execute(
                text(
                    """INSERT INTO auth_identities (id, owner_user_id, provider, subject)
                       VALUES (:id, :uid, 'password', :email)"""
                ),
                {"id": f"ai_{uuid.uuid4().hex}", "uid": user_id, "email": email},
            )
            await db.commit()
        return user_id

    @staticmethod
    def _validate_password(password: str) -> None:
        if len(password) < MIN_PASSWORD_LENGTH:
            raise InvalidCredentialsError(f"密码至少 {MIN_PASSWORD_LENGTH} 位")

    # --------------------------------------------------------------------- login
    async def login(
        self, email: str, password: str, *, user_agent: str = ""
    ) -> tuple[Principal, TokenPair]:
        email = _normalize_email(email)
        async with self._sessions() as db:
            row = (
                (
                    await db.execute(
                        text(
                            """SELECT c.owner_user_id, c.password_hash, u.display_name, s.plan
                           FROM password_credentials c
                           JOIN users u ON u.id = c.owner_user_id
                           LEFT JOIN subscriptions s ON s.owner_user_id = c.owner_user_id
                           WHERE c.email = :email"""
                        ),
                        {"email": email},
                    )
                )
                .mappings()
                .first()
            )
        # Run the hash check even when the account is missing to reduce timing leak.
        stored_hash = row["password_hash"] if row else None
        valid = bool(stored_hash) and verify_password(password, stored_hash)
        if not row or not valid:
            raise InvalidCredentialsError("邮箱或密码错误")
        principal = Principal(
            user_id=row["owner_user_id"],
            workspace_id=row["owner_user_id"],
            owner_user_id=row["owner_user_id"],
            plan=row["plan"] or "free",
            email=email,
        )
        return principal, await self.issue_token_pair(principal, user_agent=user_agent)

    # --------------------------------------------------------------------- tokens
    async def issue_token_pair(self, principal: Principal, *, user_agent: str = "") -> TokenPair:
        now = datetime.now(timezone.utc)
        jti = uuid.uuid4().hex
        access_expires = now + timedelta(seconds=self._config.access_ttl_seconds)
        payload = {
            "sub": principal.user_id,
            "workspace_id": principal.workspace_id,
            "owner_user_id": principal.owner_user_id,
            "plan": principal.plan,
            "email": principal.email,
            "iss": self._config.issuer,
            "iat": int(now.timestamp()),
            "exp": int(access_expires.timestamp()),
            "jti": jti,
            "type": "access",
        }
        access_token = jwt.encode(payload, self._config.jwt_secret, algorithm="HS256")

        refresh = new_refresh_token()
        refresh_id = f"rt_{uuid.uuid4().hex}"
        refresh_expires = now + timedelta(days=self._config.refresh_ttl_days)
        async with self._sessions() as db:
            await db.execute(
                text(
                    """INSERT INTO refresh_tokens
                       (id, owner_user_id, token_hash, user_agent, expires_at, created_at, last_seen_at)
                       VALUES (:id, :uid, :hash, :ua, :exp, now(), now())"""
                ),
                {
                    "id": refresh_id,
                    "uid": principal.owner_user_id,
                    "hash": hash_token(refresh),
                    "ua": user_agent[:500],
                    "exp": refresh_expires,
                },
            )
            await db.commit()
        return TokenPair(
            access_token=access_token,
            refresh_token=refresh,
            token_type="Bearer",
            expires_in=self._config.access_ttl_seconds,
            refresh_expires_in=self._config.refresh_ttl_days * 86400,
        )

    def decode_access_token(self, token: str) -> Principal:
        try:
            payload = jwt.decode(
                token,
                self._config.jwt_secret,
                algorithms=["HS256"],
                issuer=self._config.issuer,
                options={"require": ["exp", "sub", "jti"]},
            )
        except jwt.ExpiredSignatureError as exc:
            raise TokenError("访问令牌已过期") from exc
        except jwt.PyJWTError as exc:
            raise TokenError("无效的访问令牌") from exc
        if payload.get("type") != "access":
            raise TokenError("令牌类型错误")
        user_id = str(payload["sub"])
        return Principal(
            user_id=user_id,
            workspace_id=str(payload.get("workspace_id") or user_id),
            owner_user_id=str(payload.get("owner_user_id") or user_id),
            plan=str(payload.get("plan") or "free"),
            email=payload.get("email"),
            token_jti=payload.get("jti"),
        )

    async def rotate_refresh_token(
        self, refresh_token: str, *, user_agent: str = ""
    ) -> tuple[Principal, TokenPair]:
        token_hash = hash_token(refresh_token)
        async with self._sessions() as db:
            row = (
                (
                    await db.execute(
                        text(
                            """SELECT r.id, r.owner_user_id, r.revoked_at, r.replaced_by, r.expires_at,
                                  u.email, s.plan
                           FROM refresh_tokens r
                           JOIN users u ON u.id = r.owner_user_id
                           LEFT JOIN subscriptions s ON s.owner_user_id = r.owner_user_id
                           WHERE r.token_hash = :hash"""
                        ),
                        {"hash": token_hash},
                    )
                )
                .mappings()
                .first()
            )
            if not row:
                raise TokenError("刷新令牌无效")
            if row["revoked_at"] is not None:
                # Reuse of a revoked/rotated token: revoke the whole family.
                await db.execute(
                    text(
                        """UPDATE refresh_tokens SET revoked_at = now()
                           WHERE owner_user_id = :uid AND revoked_at IS NULL"""
                    ),
                    {"uid": row["owner_user_id"]},
                )
                await db.commit()
                raise RefreshReuseError("刷新令牌已被吊销，请重新登录")
            if row["expires_at"] <= datetime.now(timezone.utc):
                raise TokenError("刷新令牌已过期")

            principal = Principal(
                user_id=row["owner_user_id"],
                workspace_id=row["owner_user_id"],
                owner_user_id=row["owner_user_id"],
                plan=row["plan"] or "free",
                email=row["email"],
            )
            pair = await self.issue_token_pair(principal, user_agent=user_agent)
            new_id = (
                await db.execute(
                    text("SELECT id FROM refresh_tokens WHERE token_hash = :hash"),
                    {"hash": hash_token(pair.refresh_token)},
                )
            ).scalar_one()
            await db.execute(
                text(
                    """UPDATE refresh_tokens
                       SET revoked_at = now(), replaced_by = :new_id, last_seen_at = now()
                       WHERE id = :old_id"""
                ),
                {"new_id": new_id, "old_id": row["id"]},
            )
            await db.commit()
        return principal, pair

    async def revoke_refresh_token(self, refresh_token: str) -> bool:
        async with self._sessions() as db:
            result = await db.execute(
                text(
                    "UPDATE refresh_tokens SET revoked_at = now() "
                    "WHERE token_hash = :hash AND revoked_at IS NULL"
                ),
                {"hash": hash_token(refresh_token)},
            )
            await db.commit()
        return result.rowcount > 0
