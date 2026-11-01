from __future__ import annotations

import json
from typing import Any

from mcp.server.fastmcp import FastMCP

from deeptutor.modules.catalog import module_statuses
from deeptutor.services.jobs.runner import DeterministicCapabilityRunner
from deeptutor.services.jobs.service import InMemoryJobService, JobConflictError, JobNotFoundError
from deeptutor.services.storage.object_store import InMemoryObjectStore, ObjectStore

from .errors import McpError, ok
from .models import CAPABILITIES, MAX_INPUT_CHARS, MAX_OUTPUT_CHARS

CAPABILITY_WHITELIST = set(CAPABILITIES)


def _truncate(value: Any, limit: int = MAX_OUTPUT_CHARS) -> Any:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    if len(text) <= limit:
        return value
    return text[: limit - 80] + "\n…[truncated]"


def _validate_submit(
    capability: str, raw_input: dict[str, Any], idempotency_key: str | None
) -> None:
    if capability not in CAPABILITY_WHITELIST:
        raise McpError(
            "UNSUPPORTED_CAPABILITY", f"Capability `{capability}` is not exposed by MCP."
        )
    if not isinstance(raw_input, dict):
        raise McpError("INVALID_ARGUMENT", "`input` must be an object.")
    prompt = str(raw_input.get("prompt", ""))
    if not prompt.strip():
        raise McpError("INVALID_ARGUMENT", "`input.prompt` is required.")
    if len(prompt) > MAX_INPUT_CHARS:
        raise McpError("INVALID_ARGUMENT", f"`input.prompt` exceeds {MAX_INPUT_CHARS} characters.")
    if idempotency_key is not None and not (1 <= len(idempotency_key) <= 128):
        raise McpError("INVALID_ARGUMENT", "`idempotency_key` must be 1-128 characters.")


def create_mcp_server(
    *,
    owner_user_id: str = "local-dev-user",
    job_service: InMemoryJobService | None = None,
    object_store: ObjectStore | None = None,
    runner: DeterministicCapabilityRunner | None = None,
) -> FastMCP:
    store = object_store or InMemoryObjectStore()
    jobs = job_service or InMemoryJobService(store, runner=runner)
    mcp = FastMCP(
        name="deeptutor-mcp",
        instructions=(
            "DeepTutor external MCP boundary. Use capabilities_list to discover "
            "ready capabilities; use capability_run_submit/get for long-running jobs; "
            "never expose shell, arbitrary paths, provider settings, or a raw chat loop."
        ),
        log_level="WARNING",
    )

    @mcp.tool(name="capabilities_list")
    async def capabilities_list(include_dependencies: bool = True, locale: str = "zh") -> dict:
        module_ready = {item["id"]: item for item in module_statuses()}
        data = []
        for name, meta in CAPABILITIES.items():
            # T1 exposes research/visualization/question through job boundary; module
            # readiness is informational until all capability executors are wired.
            status = (
                "ready"
                if name in {"visualize", "deep_research", "deep_question"}
                else "missing_dependency"
            )
            data.append(
                {
                    "name": name,
                    "display_name": meta["display_name"],
                    "status": status,
                    "supports_jobs": meta["supports_jobs"],
                    "missing_dependencies": []
                    if status == "ready"
                    else meta["missing_dependencies"],
                    "estimated_duration_sec": meta["estimated_duration_sec"],
                    "cost_hint": None,
                }
            )
        return ok({"capabilities": data})

    @mcp.tool(name="capability_run_submit")
    async def capability_run_submit(
        capability: str, input: dict, idempotency_key: str | None = None, locale: str = "zh"
    ) -> dict:
        _validate_submit(capability, input, idempotency_key)
        job = await jobs.submit(
            owner_user_id=owner_user_id,
            capability=capability,
            payload=input,
            idempotency_key=idempotency_key,
        )
        return ok(
            {
                "job_id": job.id,
                "session_id": job.session_id,
                "status": job.status,
                "poll_after_ms": 1000,
            }
        )

    @mcp.tool(name="capability_job_get")
    async def capability_job_get(job_id: str, include_events: bool = False) -> dict:
        try:
            job = await jobs.get(
                job_id=job_id, owner_user_id=owner_user_id, include_events=include_events
            )
        except JobNotFoundError:
            raise McpError("NOT_FOUND", "Job not found.", retryable=False)
        payload = job.to_dict(include_events=include_events)
        return ok(_truncate(payload))

    @mcp.tool(name="capability_job_cancel")
    async def capability_job_cancel(job_id: str, reason: str | None = None) -> dict:
        try:
            job = await jobs.cancel(job_id=job_id, owner_user_id=owner_user_id, reason=reason)
        except JobNotFoundError:
            raise McpError("NOT_FOUND", "Job not found.", retryable=False)
        return ok({"job_id": job.id, "status": job.status})

    @mcp.tool(name="capability_job_reply")
    async def capability_job_reply(job_id: str, reply: dict) -> dict:
        try:
            job = await jobs.reply(job_id=job_id, owner_user_id=owner_user_id, reply=reply)
        except JobNotFoundError:
            raise McpError("NOT_FOUND", "Job not found.", retryable=False)
        except JobConflictError as exc:
            raise McpError("JOB_CONFLICT", str(exc), retryable=False)
        return ok({"job_id": job.id, "status": job.status})

    @mcp.tool(name="artifact_get")
    async def artifact_get(artifact_ref: str, disposition: str = "url") -> dict:
        try:
            artifact = await jobs.get_artifact(
                artifact_ref=artifact_ref, owner_user_id=owner_user_id
            )
            url = await jobs.artifact_url(artifact_ref=artifact_ref, owner_user_id=owner_user_id)
        except JobNotFoundError:
            raise McpError("NOT_FOUND", "Artifact not found.", retryable=False)
        return ok(
            {
                "url": url,
                "expires_in_sec": 900,
                "mime_type": artifact.mime_type,
                "filename": artifact.filename,
            }
        )

    @mcp.tool(name="quiz_generate_submit")
    async def quiz_generate_submit(
        input: dict, idempotency_key: str | None = None, locale: str = "zh"
    ) -> dict:
        return await capability_run_submit("deep_question", input, idempotency_key, locale)

    @mcp.tool(name="quiz_generate_job_get")
    async def quiz_generate_job_get(job_id: str, include_events: bool = False) -> dict:
        return await capability_job_get(job_id, include_events)

    # Attach internals for tests without making them MCP tools.
    mcp._deeptutor_owner_user_id = owner_user_id
    mcp._deeptutor_job_service = jobs
    mcp._deeptutor_object_store = store
    return mcp


async def run_stdio() -> None:
    server = create_mcp_server()
    await server.run_stdio_async()
