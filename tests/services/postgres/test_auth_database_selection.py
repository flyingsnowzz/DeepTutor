import pytest

from deeptutor.services.postgres.database import authentication_database_url


def test_restricted_data_role_requires_separate_auth_url(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://deeptutor_app:secret@localhost/deeptutor")
    monkeypatch.delenv("AUTH_DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="AUTH_DATABASE_URL"):
        authentication_database_url()
    monkeypatch.setenv("AUTH_DATABASE_URL", "postgresql+asyncpg://deeptutor_auth:secret@localhost/deeptutor")
    assert "deeptutor_auth" in authentication_database_url()
