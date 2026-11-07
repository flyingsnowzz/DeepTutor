from datetime import datetime, timedelta, timezone
import json
import os
import uuid

import psycopg
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from deeptutor.multi_user import device_credentials as devices
from deeptutor.services.accounts.web_gateway import PostgresWebAccountGateway
from deeptutor.services.auth import TokenPayload


@pytest.mark.asyncio
async def test_postgres_device_pairing_token_heartbeat_and_revoke(auth_engine, database_url, monkeypatch, tmp_path):
    import deeptutor.services.auth as auth_service
    import deeptutor.services.accounts.web_gateway as gateway_module

    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setattr(devices, "DEVICE_CREDENTIALS_FILE", tmp_path / "device_credentials.json")
    secret = "device-test-secret-0123456789-abcdef"
    monkeypatch.setattr(auth_service, "AUTH_SECRET", secret)
    monkeypatch.setattr(auth_service, "AUTH_ENABLED", True)
    monkeypatch.setattr(gateway_module, "AUTH_SECRET", secret)

    gateway = PostgresWebAccountGateway(auth_engine)
    username = "device_" + uuid.uuid4().hex[:12]
    user_id = await gateway.users.register(username, "secure-test-password", preset="learner")
    device_id = None
    try:
        view, code, pin = devices.issue_device_credential(
            user_id=user_id, device_name="Tablet",
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
            daily_limit_minutes=30,
        )
        device_id = view["id"]
        assert not (tmp_path / "device_credentials.json").exists()
        assert len(devices.list_device_credentials(user_id=user_id)) == 1
        session = devices.begin_device_session(code, pin)
        assert session is not None
        nonce = session[4]
        account = await gateway.users.get_user(user_id)
        token = gateway.issue_user_token(
            account, device_credential_id=device_id, device_session_nonce=nonce,
        )
        decoded = await gateway.decode_token(token)
        assert decoded is not None and decoded.device_credential_id == device_id
        assert devices.heartbeat_device_credential(
            device_id, user_id=user_id, session_nonce=nonce,
        )["remaining_seconds"] > 0
        devices.revoke_device_credential(device_id, revoked_by="admin-test")
        assert await gateway.decode_token(token) is None
    finally:
        cleanup_url = os.environ.get("TEST_DATABASE_ADMIN_URL")
        if cleanup_url:
            with psycopg.connect(cleanup_url.replace("postgresql+asyncpg://", "postgresql://", 1)) as db:
                row = db.execute("SELECT records_json FROM device_credential_state WHERE id=1 FOR UPDATE").fetchone()
                if row and device_id:
                    records = [item for item in row[0] if item.get("id") != device_id]
                    db.execute("UPDATE device_credential_state SET records_json=%s::jsonb WHERE id=1",
                               (json.dumps(records),))
                db.execute("DELETE FROM auth_identities WHERE owner_user_id=%s", (user_id,))
                db.execute("DELETE FROM subscriptions WHERE owner_user_id=%s", (user_id,))
                db.execute("DELETE FROM users WHERE id=%s", (user_id,))


@pytest.mark.asyncio
async def test_postgres_device_http_login_heartbeat_and_revoke(engine, database_url, monkeypatch):
    import deeptutor.api.routers.auth as auth_router
    import deeptutor.services.auth as auth_service
    import deeptutor.services.accounts.web_gateway as gateway_module

    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    secret = "device-http-test-secret-0123456789-abcdef"
    monkeypatch.setattr(auth_service, "AUTH_SECRET", secret)
    monkeypatch.setattr(auth_service, "AUTH_ENABLED", True)
    monkeypatch.setattr(gateway_module, "AUTH_SECRET", secret)
    monkeypatch.setattr(auth_router, "AUTH_ENABLED", True)
    monkeypatch.setattr(auth_router, "log_admin_action", lambda *args, **kwargs: None)
    monkeypatch.setattr(gateway_module, "AUTH_ENABLED", True)
    gateway_module.get_postgres_web_account_gateway.cache_clear()
    gateway = gateway_module.get_postgres_web_account_gateway()
    username = "devicehttp_" + uuid.uuid4().hex[:12]
    user_id = await gateway.users.register(username, "secure-test-password", preset="learner")
    app = FastAPI()
    app.include_router(auth_router.router, prefix="/api/auth")
    app.dependency_overrides[auth_router.require_admin] = lambda: TokenPayload(
        username="root", role="admin", user_id="admin-test",
    )
    device_id = None
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            issued = await client.post("/api/auth/devices", json={
                "user_id": user_id, "device_name": "Tablet", "expires_in_days": 7,
                "daily_limit_minutes": 30,
            })
            assert issued.status_code == 201, issued.text
            info = issued.json()
            device_id = info["device"]["id"]
            logged = await client.post("/api/auth/device-login", json={
                "pairing_code": info["pairing_code"], "pin": info["pin"],
            })
            assert logged.status_code == 200, logged.text
            assert (await client.post("/api/auth/device/heartbeat")).status_code == 200
            assert (await client.delete(f"/api/auth/devices/{device_id}")).status_code == 200
            assert (await client.get("/api/auth/status")).json()["authenticated"] is False
    finally:
        await gateway_module.close_postgres_web_account_gateway()
        cleanup_url = os.environ.get("TEST_DATABASE_ADMIN_URL")
        if cleanup_url:
            with psycopg.connect(cleanup_url.replace("postgresql+asyncpg://", "postgresql://", 1)) as db:
                row = db.execute("SELECT records_json FROM device_credential_state WHERE id=1 FOR UPDATE").fetchone()
                if row and device_id:
                    db.execute("UPDATE device_credential_state SET records_json=%s::jsonb WHERE id=1",
                               (json.dumps([item for item in row[0] if item.get("id") != device_id]),))
                db.execute("DELETE FROM auth_identities WHERE owner_user_id=%s", (user_id,))
                db.execute("DELETE FROM subscriptions WHERE owner_user_id=%s", (user_id,))
                db.execute("DELETE FROM users WHERE id=%s", (user_id,))
