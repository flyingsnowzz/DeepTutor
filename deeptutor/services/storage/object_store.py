"""Object store port used by MCP artifacts."""

from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Protocol


@dataclass(frozen=True)
class StoredObject:
    key: str
    bucket: str
    size: int
    content_type: str


class ObjectStore(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> StoredObject: ...

    async def get(self, key: str) -> bytes: ...

    async def presign_get(self, key: str, expires_in_sec: int = 900) -> str: ...


class InMemoryObjectStore:
    """Small in-memory store used by stdio unit tests.

    Production/T2 uses S3/MinIO. The interface intentionally mirrors object
    storage semantics so callers never depend on local filesystem paths.
    """

    def __init__(self, bucket: str = "deeptutor-dev"):
        self.bucket = bucket
        self._objects: dict[str, tuple[bytes, str]] = {}

    async def put(self, key: str, data: bytes, content_type: str) -> StoredObject:
        self._objects[key] = (data, content_type)
        return StoredObject(key=key, bucket=self.bucket, size=len(data), content_type=content_type)

    async def get(self, key: str) -> bytes:
        try:
            return self._objects[key][0]
        except KeyError as exc:
            raise KeyError(key) from exc

    async def presign_get(self, key: str, expires_in_sec: int = 900) -> str:
        # stdio tests should not pretend this is a network URL. T2/S3 replaces it.
        if key not in self._objects:
            raise KeyError(key)
        expires_at = int(time.time()) + expires_in_sec
        return f"memory://{self.bucket}/{key}?expires_at={expires_at}"
