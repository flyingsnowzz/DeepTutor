from __future__ import annotations

import os

from deeptutor.services.jobs.runner import (
    CapabilityRunner,
    DeterministicCapabilityRunner,
)
from deeptutor.services.jobs.service import InMemoryJobService
from deeptutor.services.storage.object_store import InMemoryObjectStore
from deeptutor.services.storage.s3 import S3ObjectStore


def _build_object_store():
    if os.environ.get("S3_ENDPOINT") and os.environ.get("S3_BUCKET"):
        store = S3ObjectStore(
            endpoint_url=os.environ.get("S3_ENDPOINT"),
            bucket=os.environ.get("S3_BUCKET"),
            access_key=os.environ.get("S3_ACCESS_KEY_ID", ""),
            secret_key=os.environ.get("S3_SECRET_ACCESS_KEY", ""),
            region=os.environ.get("S3_REGION", "us-east-1"),
        )
        default_auto_create = "1" if os.environ.get("S3_ENDPOINT", "").endswith(":4566") else "0"
        if os.environ.get("S3_AUTO_CREATE_BUCKET", default_auto_create) == "1":
            store.ensure_bucket(create=True)
        else:
            store.ensure_bucket(create=False)
        return store
    return InMemoryObjectStore()


def build_runtime_services(
    *,
    deterministic: bool | None = None,
    runner: CapabilityRunner | None = None,
):
    store = _build_object_store()
    if deterministic is None:
        deterministic = os.environ.get("DEEPTUTOR_MCP_DETERMINISTIC", "").lower() in {
            "1",
            "true",
            "yes",
        }
    if runner is None:
        if not deterministic:
            # The real runner depends on the application facade and must be
            # injected by the transport entry point (see
            # deeptutor_cli.mcp_runner), because deeptutor.services cannot
            # import deeptutor.app.
            raise RuntimeError(
                "A capability runner is required unless DEEPTUTOR_MCP_DETERMINISTIC=1; "
                "inject TurnCapabilityRunner from the CLI entry point"
            )
        runner = DeterministicCapabilityRunner()

    if os.environ.get("DATABASE_URL"):
        # Same service/repository layer first-party App/Web/SDK use directly;
        # only the transport differs (MCP stdio here, HTTP arrives in T3).
        from deeptutor.services.platform import build_platform_services

        platform = build_platform_services(object_store=store, runner=runner)
        return platform.jobs, store
    jobs = InMemoryJobService(store, runner=runner)
    return jobs, store
