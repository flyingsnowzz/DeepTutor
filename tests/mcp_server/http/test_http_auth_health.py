from __future__ import annotations


def test_health_ready_and_plans(http_client):
    assert http_client.get("/healthz").json()["data"]["status"] == "ok"
    ready = http_client.get("/readyz")
    assert ready.status_code == 200
    plans = http_client.get("/v1/billing/plans").json()["data"]["plans"]
    assert {"free", "trial", "pro"} <= set(plans)


def test_mcp_requires_bearer(http_client, base_url):
    r = http_client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        headers={"accept": "application/json, text/event-stream"},
    )
    assert r.status_code == 401
    body = r.json()
    assert body["error"]["code"] == "UNAUTHENTICATED"
    assert body["error"]["details"]["login_url"].endswith("/v1/auth/login")
    assert r.headers["www-authenticate"].lower().startswith("bearer")

    bad = http_client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        headers={
            "Authorization": "Bearer garbage",
            "accept": "application/json, text/event-stream",
        },
    )
    assert bad.status_code == 401
    assert bad.json()["error"]["code"] == "UNAUTHENTICATED"


def test_register_validation_and_duplicate(http_client):
    import uuid

    email = f"dup_{uuid.uuid4().hex[:10]}@example.com"
    short = http_client.post("/v1/auth/register", json={"email": email, "password": "short"})
    assert short.status_code == 401 and short.json()["error"]["code"] == "INVALID_CREDENTIALS"

    ok = http_client.post("/v1/auth/register", json={"email": email, "password": "password123"})
    assert ok.status_code == 201
    dup = http_client.post("/v1/auth/register", json={"email": email, "password": "password123"})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "EMAIL_TAKEN"


def test_request_id_header(http_client):
    r = http_client.get("/healthz", headers={"X-Request-ID": "req_tracing_1"})
    assert r.headers["x-request-id"] == "req_tracing_1"


def test_body_size_limit(http_client):
    # The module-scoped server uses the default 1 MiB request body cap.
    r = http_client.post(
        "/mcp",
        content=b"x" * (1024 * 1024 + 10),
        headers={
            "content-type": "application/json",
            "Authorization": "Bearer x",
        },
    )
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"
