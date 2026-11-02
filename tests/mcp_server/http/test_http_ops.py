from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("DATABASE_URL") is None, reason="DATABASE_URL not set"
)


def test_ops_stats_requires_token(http_client, base_url):
    missing = http_client.get("/v1/ops/capability_stats")
    assert missing.status_code == 403
    wrong = http_client.get("/v1/ops/capability_stats", headers={"x-ops-token": "nope"})
    assert wrong.status_code == 403


def test_ops_stats_payload(http_client, base_url):
    from tests.mcp_server.http.conftest import OPS_TOKEN

    r = http_client.get("/v1/ops/capability_stats", headers={"x-ops-token": OPS_TOKEN})
    assert r.status_code == 200
    body = r.json()["data"]
    assert "capabilities" in body and "channels" in body
