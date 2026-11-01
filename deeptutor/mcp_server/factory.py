from __future__ import annotations

import os

from deeptutor.services.jobs.runner import DeterministicCapabilityRunner, TurnCapabilityRunner
from deeptutor.services.jobs.service import InMemoryJobService
from deeptutor.services.storage.object_store import InMemoryObjectStore
from deeptutor.services.storage.s3 import S3ObjectStore


def _build_object_store():
    if os.environ.get("S3_ENDPOINT") and os.environ.get("S3_BUCKET"):
        store = S3ObjectStore(
            endpoint_url=os.environ["S3_ENDPOINT"],
            bucket=os.environ["S3_BUCKET"],
            access_key=os.environ.get("S3_ACCESS_KEY_ID", ""),
            secret_key=os.environ.get("S3_SECRET_ACCESS_KEY", ""),
            region=os.environ.get("S3_REGION", "us-east-1"),
        )
        if (
            os.environ.get(
                "S3_AUTO_CREATE_BUCKET",
                "1" if os.environ.get("S3_ENDPOINT", "").endswith(":4566") else "0",
            )
            == "1"
        ):
            store.ensure_bucket(create=True)
        else:
            store.ensure_bucket(create=False)
        return store
    return InMemoryObjectStore()


def build_runtime_services(*, deterministic: bool | None = None):
    store = _build_object_store()
    if deterministic is None:
        deterministic = os.environ.get("DEEPTUTOR_MCP_DETERMINISTIC", "").lower() in {
            "1",
            "true",
            "yes",
        }
    runner = DeterministicCapabilityRunner() if deterministic else TurnCapabilityRunner()

    if os.environ.get("DATABASE_URL"):
        # Same service/repository layer first-party App/Web/SDK use directly;
        # only the transport differs (MCP stdio here, HTTP arrives in T3).
        from deeptutor.services.platform import build_platform_services

        platform = build_platform_services(object_store=store, runner=runner)
        return platform.jobs, store
    jobs = InMemoryJobService(store, runner=runner)
    return jobs, store
