from __future__ import annotations

import os

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy import text


# Keep this in step with the latest first-party Alembic migration. Source and
# wheel installs both need a revision check without relying on a source-tree
# alembic.ini at runtime.
REQUIRED_POSTGRES_REVISION = "0034_marginnote4_state"


async def validate_postgres_schema() -> None:
    """Fail startup before a writer can use a missing or stale PostgreSQL schema."""
    engine = create_engine()
    try:
        async with engine.connect() as connection:
            revision = (await connection.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
    except Exception as exc:
        raise RuntimeError("PostgreSQL schema check failed; verify DATABASE_URL and run migrations") from exc
    finally:
        await engine.dispose()
    if revision != REQUIRED_POSTGRES_REVISION:
        raise RuntimeError(
            f"PostgreSQL schema revision {revision!r} is not supported; "
            f"run migrations to {REQUIRED_POSTGRES_REVISION!r} before starting DeepTutor"
        )


class OwnerScopedAsyncSession(AsyncSession):
    """Set the RLS GUC from an explicit repository owner or request identity."""

    async def execute(self, statement, params=None, **kwargs):
        owner = None
        if isinstance(params, dict):
            owner = params.get("owner") or params.get("owner_user_id")
        from deeptutor.multi_user.context import get_current_user_or_none

        current = get_current_user_or_none()
        if current is not None and not current.is_admin:
            if owner is not None and str(owner) != current.id:
                raise PermissionError("PostgreSQL query owner differs from authenticated user")
            owner = current.id
        transaction = self.get_transaction()
        if self.info.get("rls_transaction") is not transaction:
            self.info.pop("rls_owner", None)
        if owner is not None:
            bound = self.info.get("rls_owner")
            if bound is not None and bound != str(owner):
                raise PermissionError("A PostgreSQL transaction cannot switch owners")
            if bound is None:
                await super().execute(
                    text("SELECT set_config('app.user_id', :owner, true)"),
                    {"owner": str(owner)},
                )
                self.info["rls_owner"] = str(owner)
                self.info["rls_transaction"] = self.get_transaction()
        return await super().execute(statement, params, **kwargs)


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is required for the PostgreSQL platform data layer")
    return url


def authentication_database_url() -> str:
    """Credential lookup needs its own narrowly granted BYPASSRLS role."""
    auth_url = os.environ.get("AUTH_DATABASE_URL")
    if auth_url:
        return auth_url
    url = database_url()
    from sqlalchemy.engine import make_url

    if make_url(url).username == "deeptutor_app":
        raise RuntimeError("AUTH_DATABASE_URL is required with the restricted deeptutor_app role")
    return url


def create_engine(url: str | None = None) -> AsyncEngine:
    return create_async_engine(url or database_url(), future=True, pool_pre_ping=True)


def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False, class_=OwnerScopedAsyncSession)
