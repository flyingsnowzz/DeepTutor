import asyncio
import os
import socket

import pytest

pytestmark = pytest.mark.skipif(os.environ.get("S3_ENDPOINT") is None, reason="S3_ENDPOINT not set")


def _port_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


@pytest.mark.asyncio
async def test_s3_put_get_presign():
    from urllib.parse import urlparse

    from deeptutor.services.storage.s3 import S3ObjectStore

    endpoint = os.environ["S3_ENDPOINT"]
    parsed = urlparse(endpoint)
    if not _port_open(parsed.hostname or "127.0.0.1", parsed.port or 80):
        pytest.skip("object storage endpoint is not reachable")

    store = S3ObjectStore(
        endpoint_url=endpoint,
        bucket=os.environ.get("S3_BUCKET", "deeptutor-dev"),
        access_key=os.environ.get("S3_ACCESS_KEY_ID", "test"),
        secret_key=os.environ.get("S3_SECRET_ACCESS_KEY", "test"),
        region=os.environ.get("S3_REGION", "us-east-1"),
    )
    store._client.create_bucket(Bucket=os.environ.get("S3_BUCKET", "deeptutor-dev"))
    stored = await store.put("pytest/learning-loop.mmd", b"flowchart LR\nA-->B", "text/vnd.mermaid")
    fetched = await store.get(stored.key)
    url = await store.presign_get(stored.key, 60)
    assert fetched == b"flowchart LR\nA-->B"
    assert url.startswith(endpoint)
