from __future__ import annotations

import os

import pytest

try:
    import bcrypt  # noqa: F401
    import jwt  # noqa: F401
    import sqlalchemy  # noqa: F401

    from deeptutor.services.auth.config import AuthConfig
except ImportError:  # pragma: no cover
    collect_ignore_glob = ["*.py"]
else:

    @pytest.fixture
    def auth_config() -> AuthConfig:
        return AuthConfig(
            jwt_secret="test-secret-0123456789-abcdef-0123456789-long",
            issuer="deeptutor-test",
            access_ttl_seconds=3600,
            refresh_ttl_days=30,
            public_base_url="http://testserver",
        )

    @pytest.fixture
    def database_url_required() -> None:
        if not os.environ.get("DATABASE_URL"):
            pytest.skip("DATABASE_URL not set")
