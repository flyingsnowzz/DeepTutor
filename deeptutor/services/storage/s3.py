from __future__ import annotations

import asyncio

from .object_store import ObjectStore, StoredObject


class S3ObjectStore(ObjectStore):
    """Blocking boto3 client wrapped for asyncio; T1 MinIO/S3 adapter."""

    def __init__(
        self,
        endpoint_url: str,
        bucket: str,
        access_key: str,
        secret_key: str,
        region: str = "us-east-1",
    ):
        try:
            import boto3
        except ImportError as exc:  # pragma: no cover - dependency guard
            raise RuntimeError("boto3 is required for S3ObjectStore") from exc
        self.bucket = bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
        )

    async def _call(self, func, *args, **kwargs):
        return await asyncio.to_thread(func, *args, **kwargs)

    async def put(self, key: str, data: bytes, content_type: str) -> StoredObject:
        await self._call(
            self._client.put_object,
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
        return StoredObject(key=key, bucket=self.bucket, size=len(data), content_type=content_type)

    async def get(self, key: str) -> bytes:
        response = await self._call(self._client.get_object, Bucket=self.bucket, Key=key)
        return await self._call(response["Body"].read)

    async def presign_get(self, key: str, expires_in_sec: int = 900) -> str:
        return await self._call(
            self._client.generate_presigned_url,
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_in_sec,
        )

    def ensure_bucket(self, *, create: bool = False) -> None:
        try:
            self._client.head_bucket(Bucket=self.bucket)
        except Exception:
            if not create:
                raise
            self._client.create_bucket(Bucket=self.bucket)
