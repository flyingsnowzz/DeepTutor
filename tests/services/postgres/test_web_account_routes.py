"""HTTP account flow against a disposable PostgreSQL database only."""

from __future__ import annotations

import os
import sqlite3

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("DEEPTUTOR_POSTGRES_ISOLATED_TEST_DB") != "1",
    reason="requires an isolated disposable PostgreSQL database",
)


@pytest.mark.asyncio
async def test_postgres_web_account_profile_and_admin_flow(monkeypatch, database_url):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    import deeptutor.api.routers.auth as auth_router
    import deeptutor.services.auth as auth_service
    import deeptutor.services.accounts.web_gateway as gateway_module
    from deeptutor.services.auth.security import hash_password

    secret = "isolated-test-secret-0123456789-abcdef"
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    sqlite_connect = sqlite3.connect

    def reject_file_sqlite(database, *args, **kwargs):
        if str(database) != ":memory:":
            raise AssertionError(f"PostgreSQL account flow opened file SQLite: {database}")
        return sqlite_connect(database, *args, **kwargs)

    monkeypatch.setattr(sqlite3, "connect", reject_file_sqlite)
    monkeypatch.setattr(auth_router, "AUTH_ENABLED", True)
    monkeypatch.setattr(auth_service, "AUTH_SECRET", secret)
    monkeypatch.setattr(gateway_module, "AUTH_ENABLED", True)
    monkeypatch.setattr(gateway_module, "AUTH_SECRET", secret)
    gateway_module.get_postgres_web_account_gateway.cache_clear()
    gateway = gateway_module.get_postgres_web_account_gateway()
    await gateway.admins.bootstrap_superadmin("super_test", hash_password("super-password-123"))

    app = FastAPI()
    app.include_router(auth_router.router, prefix="/api/auth")
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            assert (await client.post("/api/auth/register", json={
                "username": "learner_test", "password": "learner-password-123"
            })).status_code == 201
            assert (await client.post("/api/auth/login", json={
                "username": "learner_test", "password": "learner-password-123"
            })).status_code == 200
            assert (await client.get("/api/auth/status")).json()["authenticated"]
            assert (await client.put("/api/auth/profile", json={
                "avatar": "icon:book:blue"
            })).status_code == 200
            assert (await client.get("/api/auth/profile")).json()["avatar"] == "icon:book:blue"
            assert (await client.get("/api/auth/admin/accounts")).status_code == 403

            assert (await client.post("/api/auth/admin/login", json={
                "username": "super_test", "password": "super-password-123"
            })).status_code == 200
            assert (await client.post("/api/auth/users", json={
                "username": "student_test", "password": "student-password-123",
                "preset": "learner",
            })).status_code == 201
            assert (await client.post("/api/auth/login", json={
                "username": "student_test", "password": "student-password-123"
            })).status_code == 200
            student_token = client.cookies.get("dt_token")
            assert (await client.post("/api/auth/admin/login", json={
                "username": "super_test", "password": "super-password-123"
            })).status_code == 200
            assert (await client.put("/api/auth/users/student_test/learner-profile", json={
                "grade_level": "7"
            })).status_code == 200
            assert (await client.get("/api/auth/users/student_test/learner-profile")).json()[
                "learner_profile"
            ]["grade_level"] == "7"
            assert (await client.put("/api/auth/users/student_test/role", json={
                "role": "admin"
            })).status_code == 400
            assert (await client.delete("/api/auth/users/student_test")).status_code == 200
            assert "student_test" not in {
                row["username"] for row in (await client.get("/api/auth/users")).json()
            }
            assert (await client.post("/api/auth/login", json={
                "username": "student_test", "password": "student-password-123"
            })).status_code == 401
            assert (await client.get(
                "/api/auth/status", headers={"Authorization": f"Bearer {student_token}"}
            )).json()["authenticated"] is False
    finally:
        await gateway_module.close_postgres_web_account_gateway()
