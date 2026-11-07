"""Unified repository-backed session management."""

from .protocol import SessionStoreProtocol
from .sqlite_store import (
    SQLiteSessionStore,
    get_sqlite_session_store,
    get_sqlite_session_store_for,
    make_imported_session_id,
)
from .turn_runtime import TurnRuntimeManager, get_turn_runtime_manager

_pocketbase_store_instances: dict[str, SessionStoreProtocol] = {}
_postgres_engines: dict[tuple[str, object], object] = {}


def _postgres_session_store() -> SessionStoreProtocol:
    import asyncio
    import hashlib

    from deeptutor.services.postgres.database import create_engine, database_url
    from deeptutor.services.storage_backend import postgres_owner_user_id

    from .postgres_scoped import PostgresScopedSessionStore
    from .postgres_store import PostgresSessionStore

    owner = postgres_owner_user_id()
    url = database_url()
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    key = (url, loop)
    engine = _postgres_engines.get(key)
    if engine is None:
        engine = create_engine(url)
        _postgres_engines[key] = engine
    resource = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    return PostgresScopedSessionStore(PostgresSessionStore(engine), owner, resource)


async def close_postgres_session_stores() -> None:
    import asyncio

    current_loop = asyncio.get_running_loop()
    engines = list(_postgres_engines.items())
    _postgres_engines.clear()
    for (_, loop), engine in engines:
        await engine.dispose(close=loop is current_loop)


def get_session_store() -> SessionStoreProtocol:
    """
    Return the active session store backend.

    When integrations.pocketbase_url is configured, returns a
    PocketBaseSessionStore. Otherwise falls back to the local
    SQLiteSessionStore (default, zero-config behaviour).
    """
    from deeptutor.services.storage_backend import storage_backend

    if storage_backend() == "postgres":
        return _postgres_session_store()

    from deeptutor.services.pocketbase_client import is_pocketbase_enabled

    if is_pocketbase_enabled():
        from deeptutor.services.config import load_integrations_settings

        from .pocketbase_store import PocketBaseSessionStore
        from .scope import pocketbase_scope

        url = str(load_integrations_settings().get("pocketbase_url") or "").rstrip("/")
        scope = pocketbase_scope(url)
        if scope.cache_key not in _pocketbase_store_instances:
            store = PocketBaseSessionStore()
            store.store_scope = scope
            _pocketbase_store_instances[scope.cache_key] = store
        return _pocketbase_store_instances[scope.cache_key]
    return get_sqlite_session_store()


__all__ = [
    "SessionStoreProtocol",
    "SQLiteSessionStore",
    "TurnRuntimeManager",
    "get_session_store",
    "close_postgres_session_stores",
    "get_sqlite_session_store",
    "get_sqlite_session_store_for",
    "get_turn_runtime_manager",
    "make_imported_session_id",
]
