from __future__ import annotations

import os
import socket
import threading
import time
import uuid

import pytest

try:
    import importlib.util

    import httpx
    import uvicorn

    assert importlib.util.find_spec("mcp.client.streamable_http")
    from deeptutor.services.auth.config import AuthConfig
except ImportError:  # pragma: no cover
    collect_ignore_glob = ["*.py"]
    pytest.skip("http MCP dependencies are unavailable", allow_module_level=True)

from deeptutor.mcp_server.cloud import build_cloud_app
from deeptutor.services.jobs.runner import DeterministicCapabilityRunner
from deeptutor.services.storage.object_store import InMemoryObjectStore

TEST_SECRET = "http-test-secret-0123456789-abcdef-0123456789"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def base_url():
    if not os.environ.get("DATABASE_URL"):
        pytest.skip("DATABASE_URL not set")
    port = _free_port()
    config = AuthConfig(
        jwt_secret=TEST_SECRET,
        issuer="deeptutor-test",
        access_ttl_seconds=3600,
        refresh_ttl_days=30,
        public_base_url=f"http://127.0.0.1:{port}",
    )
    app = build_cloud_app(
        object_store=InMemoryObjectStore(),
        runner=DeterministicCapabilityRunner(),
        auth_config=config,
    )
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            r = __import__("httpx").get(f"http://127.0.0.1:{port}/healthz", timeout=1)
            if r.status_code == 200:
                break
        except Exception:  # noqa: BLE001
            time.sleep(0.2)
    else:
        raise RuntimeError("http server failed to start")
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture
def http_client(base_url):
    with httpx.Client(base_url=base_url, timeout=15) as client:
        yield client


def register_login(client, *, password: str = "password123") -> dict:
    email = f"http_{uuid.uuid4().hex[:12]}@example.com"
    r = client.post("/v1/auth/register", json={"email": email, "password": password})
    assert r.status_code == 201, r.text
    r = client.post("/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def auth_headers(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}
