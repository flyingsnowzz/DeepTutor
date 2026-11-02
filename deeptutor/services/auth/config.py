"""Server-side auth configuration loaded from process environment."""

from __future__ import annotations

from dataclasses import dataclass
import os

MIN_PASSWORD_LENGTH = 8


class AuthConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class AuthConfig:
    jwt_secret: str
    issuer: str
    access_ttl_seconds: int = 3600
    refresh_ttl_days: int = 30
    public_base_url: str = "http://127.0.0.1:8001"

    @property
    def login_url(self) -> str:
        return f"{self.public_base_url.rstrip('/')}/v1/auth/login"

    @property
    def register_url(self) -> str:
        return f"{self.public_base_url.rstrip('/')}/v1/auth/register"


def load_auth_config(*, require_secret: bool = True) -> AuthConfig:
    secret = os.environ.get("DEEPTUTOR_JWT_SECRET", "")
    if require_secret and not secret:
        if os.environ.get("DEEPTUTOR_ALLOW_DEV_SECRET") == "1":
            secret = "dev-insecure-secret-do-not-use-in-production-0123456789"
        else:
            raise AuthConfigError(
                "DEEPTUTOR_JWT_SECRET is required for the HTTP service "
                "(set DEEPTUTOR_ALLOW_DEV_SECRET=1 only for local development)"
            )
    if len(secret) < 32 and require_secret:
        raise AuthConfigError("DEEPTUTOR_JWT_SECRET must be at least 32 characters")
    return AuthConfig(
        jwt_secret=secret,
        issuer=os.environ.get("DEEPTUTOR_TOKEN_ISSUER", "deeptutor"),
        access_ttl_seconds=int(os.environ.get("DEEPTUTOR_ACCESS_TTL_SECONDS", "3600")),
        refresh_ttl_days=int(os.environ.get("DEEPTUTOR_REFRESH_TTL_DAYS", "30")),
        public_base_url=os.environ.get("DEEPTUTOR_PUBLIC_BASE_URL", "http://127.0.0.1:8001"),
    )
