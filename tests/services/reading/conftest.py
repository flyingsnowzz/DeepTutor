from __future__ import annotations

import os

import pytest

try:
    import sqlalchemy  # noqa: F401
except ImportError:  # pragma: no cover
    collect_ignore_glob = ["*.py"]
else:

    @pytest.fixture
    def require_db() -> None:
        if not os.environ.get("DATABASE_URL"):
            pytest.skip("DATABASE_URL not set")
