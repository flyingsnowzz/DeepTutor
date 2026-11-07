"""Public registration and administrator credentials stay separate."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_public_registration_never_promotes_and_rejects_duplicate(mu_isolated_root, monkeypatch):
    from deeptutor.api.routers import auth as router
    from deeptutor.services import auth as service

    monkeypatch.setattr(router, "AUTH_ENABLED", True)
    monkeypatch.setattr(router, "POCKETBASE_ENABLED", False)
    monkeypatch.setattr(service, "AUTH_ENABLED", True)
    monkeypatch.setattr(service, "AUTH_SECRET", "test-signing-secret")
    app = FastAPI()
    app.include_router(router.router, prefix="/api/auth")
    client = TestClient(app)

    first = client.post(
        "/api/auth/register", json={"username": "alice", "password": "password1234"}
    )
    assert first.status_code == 201
    assert first.json()["role"] == "user"
    assert first.json()["is_admin"] is False
    assert client.post(
        "/api/auth/register", json={"username": "alice", "password": "different1234"}
    ).status_code == 409

    login = client.post(
        "/api/auth/login", json={"username": "alice", "password": "password1234"}
    )
    assert login.status_code == 200
    assert login.json()["role"] == "user"
    assert client.post(
        "/api/auth/admin/login", json={"username": "alice", "password": "password1234"}
    ).status_code == 401


def test_super_admin_creates_admin_in_separate_store(mu_isolated_root, monkeypatch):
    from deeptutor.api.routers import auth as router
    from deeptutor.multi_user import identity
    from deeptutor.multi_user.admin_identity import load_admins
    from deeptutor.services import auth as service

    monkeypatch.setattr(router, "AUTH_ENABLED", True)
    monkeypatch.setattr(router, "POCKETBASE_ENABLED", False)
    monkeypatch.setattr(service, "AUTH_ENABLED", True)
    monkeypatch.setattr(service, "AUTH_SECRET", "test-signing-secret")
    monkeypatch.setattr(service, "AUTH_USERNAME", "operator")
    monkeypatch.setattr(service, "AUTH_PASSWORD_HASH", service.hash_password("operator-password"))
    app = FastAPI()
    app.include_router(router.router, prefix="/api/auth")
    client = TestClient(app)

    assert client.post(
        "/api/auth/register", json={"username": "operator", "password": "hijacked-password"}
    ).status_code == 409
    assert client.post(
        "/api/auth/login", json={"username": "operator", "password": "operator-password"}
    ).status_code == 401
    signed_in = client.post(
        "/api/auth/admin/login", json={"username": "operator", "password": "operator-password"}
    )
    assert signed_in.status_code == 200
    assert signed_in.json()["is_super_admin"] is True
    status = client.get("/api/auth/status")
    assert status.json()["is_super_admin"] is True
    created = client.post(
        "/api/auth/admin/accounts", json={"username": "deputy", "password": "deputy-password"}
    )
    assert created.status_code == 201
    assert "deputy" in load_admins()
    assert "deputy" not in identity.load_users()
    administrators = client.get("/api/auth/admin/accounts").json()["administrators"]
    assert {item["username"] for item in administrators} == {"operator", "deputy"}

    deputy_login = client.post(
        "/api/auth/admin/login", json={"username": "deputy", "password": "deputy-password"}
    )
    assert deputy_login.status_code == 200
    assert deputy_login.json()["is_super_admin"] is False
    assert client.post(
        "/api/auth/admin/accounts", json={"username": "third", "password": "third-password"}
    ).status_code == 403

    learner = client.post(
        "/api/auth/register", json={"username": "learner", "password": "learner-password"}
    )
    assert learner.status_code == 201
    assert client.put(
        "/api/auth/users/learner/role", json={"role": "admin"}
    ).status_code == 400
    assert {item["username"] for item in client.get("/api/auth/users").json()} == {"learner"}


def test_concurrent_public_registration_has_no_admin(mu_isolated_root):
    from deeptutor.multi_user.identity import load_users, register_public_user

    def register(index: int):
        return register_public_user(f"learner{index}", "hash")

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(register, range(8)))
    assert all(result is not None for result in results)
    assert {record["role"] for record in load_users().values()} == {"user"}


def test_admin_and_user_creations_cannot_claim_same_name(mu_isolated_root):
    from deeptutor.multi_user.admin_identity import create_admin, load_admins
    from deeptutor.multi_user.identity import load_users, register_public_user

    with ThreadPoolExecutor(max_workers=2) as pool:
        admin = pool.submit(create_admin, "shared", "admin-hash")
        user = pool.submit(register_public_user, "shared", "user-hash")
        outcomes = [admin.result(), user.result()]
    assert sum(result is not None for result in outcomes) == 1
    assert ("shared" in load_admins()) != ("shared" in load_users())
