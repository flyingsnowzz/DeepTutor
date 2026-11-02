from __future__ import annotations

import json
import logging
from typing import Any, Awaitable, Callable

from mcp.server.fastmcp import Context, FastMCP

from deeptutor.services.jobs.runner import DeterministicCapabilityRunner
from deeptutor.services.jobs.service import InMemoryJobService, JobConflictError, JobNotFoundError
from deeptutor.services.quota.plans import metric_for_capability
from deeptutor.services.storage.object_store import InMemoryObjectStore, ObjectStore

from .context import RequestPrincipal, new_request_id
from .dependencies import media_dependencies
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


PrincipalResolver = Callable[[Context], Awaitable[RequestPrincipal]]


def _fixed_owner_resolver(owner_user_id: str) -> PrincipalResolver:
    async def resolve(_ctx: Context) -> RequestPrincipal:
        return RequestPrincipal(
            owner_user_id=owner_user_id, plan="free", request_id=new_request_id()
        )

    return resolve


def create_mcp_server(
    *,
    owner_user_id: str = "local-dev-user",
    principal_resolver: PrincipalResolver | None = None,
    job_service: InMemoryJobService | None = None,
    object_store: ObjectStore | None = None,
    runner: DeterministicCapabilityRunner | None = None,
    practice_repo=None,
    mastery_repo=None,
    quota=None,
    audit=None,
    reading_service=None,
    hook_service=None,
) -> FastMCP:
    store = object_store or InMemoryObjectStore()
    jobs = job_service or InMemoryJobService(store, runner=runner)
    resolve = principal_resolver or _fixed_owner_resolver(owner_user_id)

    mcp = FastMCP(
        name="deeptutor-mcp",
        instructions=(
            "DeepTutor external MCP boundary. Use capabilities_list to discover "
            "ready capabilities; use capability_run_submit/get for long-running jobs; "
            "never expose shell, arbitrary paths, provider settings, or a raw chat loop."
        ),
        log_level="WARNING",
    )

    async def _principal(ctx: Context) -> RequestPrincipal:
        try:
            return await resolve(ctx)
        except McpError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise McpError("UNAUTHENTICATED", str(exc), http_status=401) from exc

    async def _audit(ctx: Context, principal: RequestPrincipal, tool: str, **fields) -> None:
        if audit is None:
            return
        await audit.log(
            request_id=principal.request_id,
            owner_user_id=principal.owner_user_id,
            tool=tool,
            ip=principal.ip,
            **fields,
        )

    # ------------------------------------------------------------------ catalog
    @mcp.tool(name="capabilities_list")
    async def capabilities_list(
        ctx: Context, include_dependencies: bool = True, locale: str = "zh"
    ) -> dict:
        principal = await _principal(ctx)
        deps = media_dependencies()
        data = []
        for name, meta in CAPABILITIES.items():
            dep = deps.get(name)
            missing = list(meta.get("missing_dependencies", []))
            if dep is not None:
                missing = dep.missing
            status = "ready" if not missing else "missing_dependency"
            data.append(
                {
                    "name": name,
                    "display_name": meta["display_name"],
                    "status": status,
                    "supports_jobs": meta["supports_jobs"],
                    "missing_dependencies": missing,
                    "estimated_duration_sec": meta.get("estimated_duration_sec"),
                    "cost_hint": meta.get("cost_hint"),
                }
            )
        await _audit(ctx, principal, "capabilities_list", status="ok")
        return ok({"capabilities": data, "plan": principal.plan})

    # ---------------------------------------------------------------- job tools
    async def _submit(
        ctx: Context, capability: str, raw_input: dict, idempotency_key: str | None, tool: str
    ) -> dict:
        principal = await _principal(ctx)
        _validate_submit(capability, raw_input, idempotency_key)

        # Dependency gate: media renderers must report missing dependencies as a
        # contract error instead of starting a job that cannot finish.
        deps = media_dependencies().get(capability)
        if deps is not None and not deps.ready:
            await _audit(
                ctx,
                principal,
                tool,
                status="unavailable",
                error_code="CAPABILITY_UNAVAILABLE",
            )
            raise McpError(
                "CAPABILITY_UNAVAILABLE",
                f"能力 {capability} 缺少运行依赖",
                details={"capability": capability, "missing_dependencies": deps.missing},
                http_status=503,
            )

        channel = str(raw_input.get("source_channel") or "mcp")[:48]
        if quota is not None:
            try:
                await quota.assert_allowed(
                    principal.owner_user_id, metric_for_capability(capability).value
                )
            except Exception as exc:  # noqa: BLE001
                await _audit(
                    ctx,
                    principal,
                    tool,
                    status="rejected",
                    error_code=getattr(exc, "code", "QUOTA"),
                )
                raise McpError(
                    "QUOTA_EXCEEDED",
                    str(exc),
                    retryable=False,
                    details={
                        "metric": metric_for_capability(capability).value,
                        "upgrade_url": getattr(exc, "upgrade_url", "/v1/billing/upgrade"),
                    },
                    http_status=429,
                ) from exc
        job = await jobs.submit(
            owner_user_id=principal.owner_user_id,
            capability=capability,
            payload=raw_input,
            idempotency_key=idempotency_key,
            source_channel=channel,
        )
        await _audit(ctx, principal, tool, job_id=job.id, status=job.status)
        return ok(
            {
                "job_id": job.id,
                "session_id": job.session_id,
                "status": job.status,
                "poll_after_ms": 1000,
                "billing": {
                    "meter": metric_for_capability(capability).value,
                    "charged_on": "job_succeeded",
                    "idempotency": "same idempotency_key never charges twice",
                },
            }
        )

    @mcp.tool(name="capability_run_submit")
    async def capability_run_submit(
        ctx: Context,
        capability: str,
        input: dict,
        idempotency_key: str | None = None,
        locale: str = "zh",
    ) -> dict:
        return await _submit(ctx, capability, input, idempotency_key, "capability_run_submit")

    @mcp.tool(name="capability_job_get")
    async def capability_job_get(ctx: Context, job_id: str, include_events: bool = False) -> dict:
        principal = await _principal(ctx)
        try:
            job = await jobs.get(
                job_id=job_id, owner_user_id=principal.owner_user_id, include_events=include_events
            )
        except JobNotFoundError:
            raise McpError("NOT_FOUND", "Job not found.", retryable=False, http_status=404)
        await _audit(ctx, principal, "capability_job_get", job_id=job_id, status=job.status)
        payload = job.to_dict(include_events=include_events)
        return ok(_truncate(payload))

    @mcp.tool(name="capability_job_cancel")
    async def capability_job_cancel(ctx: Context, job_id: str, reason: str | None = None) -> dict:
        principal = await _principal(ctx)
        try:
            job = await jobs.cancel(
                job_id=job_id, owner_user_id=principal.owner_user_id, reason=reason
            )
        except JobNotFoundError:
            raise McpError("NOT_FOUND", "Job not found.", retryable=False, http_status=404)
        await _audit(ctx, principal, "capability_job_cancel", job_id=job_id, status=job.status)
        return ok({"job_id": job.id, "status": job.status})

    @mcp.tool(name="capability_job_reply")
    async def capability_job_reply(ctx: Context, job_id: str, reply: dict) -> dict:
        principal = await _principal(ctx)
        try:
            job = await jobs.reply(
                job_id=job_id, owner_user_id=principal.owner_user_id, reply=reply
            )
        except JobNotFoundError:
            raise McpError("NOT_FOUND", "Job not found.", retryable=False, http_status=404)
        except JobConflictError as exc:
            raise McpError("JOB_CONFLICT", str(exc), retryable=False)
        await _audit(ctx, principal, "capability_job_reply", job_id=job_id, status=job.status)
        return ok({"job_id": job.id, "status": job.status})

    @mcp.tool(name="artifact_get")
    async def artifact_get(ctx: Context, artifact_ref: str, disposition: str = "url") -> dict:
        principal = await _principal(ctx)
        try:
            artifact = await jobs.get_artifact(
                artifact_ref=artifact_ref, owner_user_id=principal.owner_user_id
            )
            url = await jobs.artifact_url(
                artifact_ref=artifact_ref, owner_user_id=principal.owner_user_id
            )
        except JobNotFoundError:
            raise McpError("NOT_FOUND", "Artifact not found.", retryable=False, http_status=404)
        await _audit(
            ctx, principal, "artifact_get", resource_id=artifact_ref, job_id=artifact.job_id
        )
        return ok(
            {
                "url": url,
                "expires_in_sec": 900,
                "mime_type": artifact.mime_type,
                "filename": artifact.filename,
            }
        )

    # ------------------------------------------------------------ job aliases
    @mcp.tool(name="quiz_generate_submit")
    async def quiz_generate_submit(
        ctx: Context, input: dict, idempotency_key: str | None = None, locale: str = "zh"
    ) -> dict:
        return await _submit(ctx, "deep_question", input, idempotency_key, "quiz_generate_submit")

    @mcp.tool(name="quiz_generate_job_get")
    async def quiz_generate_job_get(
        ctx: Context, job_id: str, include_events: bool = False
    ) -> dict:
        return await capability_job_get(ctx, job_id, include_events)

    @mcp.tool(name="problem_solve_submit")
    async def problem_solve_submit(
        ctx: Context, input: dict, idempotency_key: str | None = None, locale: str = "zh"
    ) -> dict:
        return await _submit(ctx, "problem_solve", input, idempotency_key, "problem_solve_submit")

    @mcp.tool(name="problem_solve_get")
    async def problem_solve_get(ctx: Context, job_id: str) -> dict:
        return await capability_job_get(ctx, job_id)

    @mcp.tool(name="quiz_judge_submit")
    async def quiz_judge_submit(
        ctx: Context, input: dict, idempotency_key: str | None = None, locale: str = "zh"
    ) -> dict:
        return await _submit(ctx, "quiz_judge", input, idempotency_key, "quiz_judge_submit")

    @mcp.tool(name="quiz_judge_get")
    async def quiz_judge_get(ctx: Context, job_id: str) -> dict:
        return await capability_job_get(ctx, job_id)

    @mcp.tool(name="audio_overview_generate_submit")
    async def audio_overview_generate_submit(
        ctx: Context, input: dict, idempotency_key: str | None = None, locale: str = "zh"
    ) -> dict:
        return await _submit(
            ctx, "audio_overview", input, idempotency_key, "audio_overview_generate_submit"
        )

    @mcp.tool(name="audio_overview_generate_get")
    async def audio_overview_generate_get(ctx: Context, job_id: str) -> dict:
        return await capability_job_get(ctx, job_id)

    @mcp.tool(name="mastery_path_generate_submit")
    async def mastery_path_generate_submit(
        ctx: Context, input: dict, idempotency_key: str | None = None, locale: str = "zh"
    ) -> dict:
        return await _submit(
            ctx, "mastery_path", input, idempotency_key, "mastery_path_generate_submit"
        )

    @mcp.tool(name="mastery_path_generate_get")
    async def mastery_path_generate_get(ctx: Context, job_id: str) -> dict:
        return await capability_job_get(ctx, job_id)

    # ------------------------------------------------------- learning-state tools
    def _require_practice():
        if practice_repo is None:
            raise McpError("SERVICE_UNAVAILABLE", "Practice service is not configured.")
        return practice_repo

    def _require_mastery():
        if mastery_repo is None:
            raise McpError("SERVICE_UNAVAILABLE", "Mastery service is not configured.")
        return mastery_repo

    async def _charge_practice(ctx: Context, principal: RequestPrincipal, request_id: str) -> None:
        if quota is None:
            return
        try:
            await quota.assert_allowed(principal.owner_user_id, "practice")
        except Exception as exc:  # noqa: BLE001
            raise McpError(
                "QUOTA_EXCEEDED",
                str(exc),
                details={"metric": "practice", "upgrade_url": getattr(exc, "upgrade_url", "")},
                http_status=429,
            ) from exc
        result = await quota.charge_once(
            idempotency_key=f"practice:{principal.owner_user_id}:{request_id}",
            owner_user_id=principal.owner_user_id,
            metric="practice",
            request_id=request_id,
        )
        if not result.charged:
            # Same request_id again: serve the stored replay if the ledger has
            # it, otherwise the key collided with an unrelated operation.
            replayed = await practice_repo.ledger_lookup(principal.owner_user_id, request_id)
            if replayed is None:
                raise McpError(
                    "IDEMPOTENCY_CONFLICT",
                    "request_id was already used for a different operation",
                    http_status=409,
                )
            await _audit(ctx, principal, tool, status="replayed")
            return ok({"replayed": True, **replayed})

    @mcp.tool(name="practice_summary_get")
    async def practice_summary_get(ctx: Context) -> dict:
        principal = await _principal(ctx)
        repo = _require_practice()
        summary = await repo.summary(principal.owner_user_id)
        if quota is not None:
            summary["quota"] = await quota.usage_summary(principal.owner_user_id)
        await _audit(ctx, principal, "practice_summary_get")
        return ok(summary)

    @mcp.tool(name="practice_queue_list")
    async def practice_queue_list(ctx: Context, limit: int = 50) -> dict:
        principal = await _principal(ctx)
        repo = _require_practice()
        items = await repo.list_due(principal.owner_user_id, min(max(limit, 1), 200))
        await _audit(ctx, principal, "practice_queue_list")
        return ok({"items": items, "count": len(items)})

    @mcp.tool(name="practice_question_get")
    async def practice_question_get(ctx: Context, entry_id: str) -> dict:
        principal = await _principal(ctx)
        repo = _require_practice()
        entry = await repo.get_entry(principal.owner_user_id, entry_id)
        if entry is None:
            raise McpError("NOT_FOUND", "Practice question not found.", http_status=404)
        await _audit(ctx, principal, "practice_question_get", resource_id=entry_id)
        return ok({"entry": _truncate(entry)})

    @mcp.tool(name="practice_entries_list")
    async def practice_entries_list(
        ctx: Context, limit: int = 100, bookmarked: bool | None = None, resolved: bool | None = None
    ) -> dict:
        principal = await _principal(ctx)
        repo = _require_practice()
        items = await repo.list_entries(
            principal.owner_user_id,
            min(max(limit, 1), 200),
            bookmarked=bookmarked,
            resolved=resolved,
        )
        await _audit(ctx, principal, "practice_entries_list")
        return ok({"items": items, "count": len(items)})

    @mcp.tool(name="practice_entry_bookmark")
    async def practice_entry_bookmark(ctx: Context, entry_id: str, bookmarked: bool = True) -> dict:
        principal = await _principal(ctx)
        repo = _require_practice()
        changed = await repo.set_bookmark(principal.owner_user_id, entry_id, bookmarked)
        if not changed:
            raise McpError("NOT_FOUND", "Practice question not found.", http_status=404)
        await _audit(ctx, principal, "practice_entry_bookmark", resource_id=entry_id)
        return ok({"entry_id": entry_id, "bookmarked": bookmarked})

    @mcp.tool(name="practice_answer_check")
    async def practice_answer_check(
        ctx: Context, entry_id: str, answer: str, request_id: str
    ) -> dict:
        principal = await _principal(ctx)
        repo = _require_practice()
        if not request_id or len(request_id) > 128:
            raise McpError("INVALID_ARGUMENT", "request_id is required (max 128 chars)")
        await _charge_practice(ctx, principal, request_id)
        try:
            result = await repo.answer_check(principal.owner_user_id, entry_id, answer, request_id)
        except LookupError:
            raise McpError("NOT_FOUND", "Practice question not found.", http_status=404)
        await _audit(
            ctx,
            principal,
            "practice_answer_check",
            resource_id=entry_id,
            status="ok" if result.get("is_correct") else "wrong",
            usage={"correct": bool(result.get("is_correct"))},
        )
        return ok(result)

    @mcp.tool(name="practice_review_submit")
    async def practice_review_submit(
        ctx: Context, entry_id: str, rating: str, request_id: str
    ) -> dict:
        principal = await _principal(ctx)
        repo = _require_practice()
        if not request_id or len(request_id) > 128:
            raise McpError("INVALID_ARGUMENT", "request_id is required (max 128 chars)")
        await _charge_practice(ctx, principal, request_id)
        try:
            result = await repo.submit_review(principal.owner_user_id, entry_id, rating, request_id)
        except LookupError:
            raise McpError("NOT_FOUND", "Practice question not found.", http_status=404)
        except ValueError as exc:
            raise McpError("INVALID_ARGUMENT", str(exc))
        await _audit(ctx, principal, "practice_review_submit", resource_id=entry_id)
        return ok(result)

    @mcp.tool(name="mastery_paths_list")
    async def mastery_paths_list(ctx: Context, limit: int = 100) -> dict:
        principal = await _principal(ctx)
        repo = _require_mastery()
        paths = await repo.list_paths(principal.owner_user_id, min(max(limit, 1), 200))
        await _audit(ctx, principal, "mastery_paths_list")
        return ok({"paths": paths, "count": len(paths)})

    @mcp.tool(name="mastery_map_get")
    async def mastery_map_get(ctx: Context, path_id: str) -> dict:
        principal = await _principal(ctx)
        repo = _require_mastery()
        data = await repo.get_map(principal.owner_user_id, path_id)
        if data is None:
            raise McpError("NOT_FOUND", "Mastery path not found.", http_status=404)
        await _audit(ctx, principal, "mastery_map_get", resource_id=path_id)
        return ok(_truncate(data))

    @mcp.tool(name="mastery_objective_get")
    async def mastery_objective_get(ctx: Context, path_id: str) -> dict:
        principal = await _principal(ctx)
        repo = _require_mastery()
        data = await repo.get_objective(principal.owner_user_id, path_id)
        if data is None:
            raise McpError("NOT_FOUND", "Mastery path not found.", http_status=404)
        await _audit(ctx, principal, "mastery_objective_get", resource_id=path_id)
        return ok(data)

    # ------------------------------------------------------- reading sessions
    def _require_reading():
        if reading_service is None:
            raise McpError("SERVICE_UNAVAILABLE", "Reading service is not configured.")
        return reading_service

    @mcp.tool(name="reading_material_register")
    async def reading_material_register(
        ctx: Context,
        kind: str,
        title: str,
        content: str | None = None,
        artifact_ref: str | None = None,
    ) -> dict:
        principal = await _principal(ctx)
        service = _require_reading()
        artifact_row = None
        if artifact_ref:
            try:
                artifact_row = await jobs.get_artifact(
                    artifact_ref=artifact_ref, owner_user_id=principal.owner_user_id
                )
            except JobNotFoundError:
                raise McpError("NOT_FOUND", "Artifact not found.", http_status=404)
        try:
            result = await service.register_material(
                principal.owner_user_id,
                kind=kind,
                title=title or "",
                content=content,
                artifact_ref=artifact_ref,
                artifact_row=artifact_row,
            )
        except Exception as exc:  # noqa: BLE001
            code = getattr(exc, "code", "MATERIAL_ERROR")
            raise McpError(code, str(exc), http_status=getattr(exc, "http_status", 400))
        await _audit(ctx, principal, "reading_material_register", resource_id=result["material_id"])
        return ok(result)

    @mcp.tool(name="reading_session_start")
    async def reading_session_start(
        ctx: Context, material_id: str, mode: str = "study", title: str = ""
    ) -> dict:
        principal = await _principal(ctx)
        service = _require_reading()
        try:
            result = await service.start_session(
                principal.owner_user_id, material_id=material_id, title=title, mode=mode
            )
        except Exception as exc:  # noqa: BLE001
            raise McpError(
                getattr(exc, "code", "READING_ERROR"),
                str(exc),
                http_status=getattr(exc, "http_status", 400),
            )
        await _audit(ctx, principal, "reading_session_start", resource_id=result["session_id"])
        return ok(result)

    @mcp.tool(name="reading_session_reply")
    async def reading_session_reply(
        ctx: Context, session_id: str, message: str, mode: str | None = None
    ) -> dict:
        principal = await _principal(ctx)
        service = _require_reading()
        try:
            result = await service.reply(
                principal.owner_user_id,
                session_id=session_id,
                message=message,
                mode=mode,
            )
        except Exception as exc:  # noqa: BLE001
            raise McpError(
                getattr(exc, "code", "READING_ERROR"),
                str(exc),
                http_status=getattr(exc, "http_status", 400),
            )
        await _audit(ctx, principal, "reading_session_reply", resource_id=session_id)
        return ok(result)

    @mcp.tool(name="reading_sessions_list")
    async def reading_sessions_list(ctx: Context, limit: int = 50) -> dict:
        principal = await _principal(ctx)
        service = _require_reading()
        items = await service.list_sessions(principal.owner_user_id, min(max(limit, 1), 100))
        return ok({"sessions": items, "count": len(items)})

    # ------------------------------------------------------------- media jobs
    @mcp.tool(name="lesson_video_generate_submit")
    async def lesson_video_generate_submit(
        ctx: Context, input: dict, idempotency_key: str | None = None, locale: str = "zh"
    ) -> dict:
        result = await _submit(
            ctx, "video_lesson", input, idempotency_key, "lesson_video_generate_submit"
        )
        result["data"]["billing"]["notice"] = "渲染约 2–8 分钟，按 TTS/模型用量计费；可取消。"
        return result

    @mcp.tool(name="lesson_video_generate_get")
    async def lesson_video_generate_get(ctx: Context, job_id: str) -> dict:
        return await capability_job_get(ctx, job_id)

    @mcp.tool(name="math_animation_generate_submit")
    async def math_animation_generate_submit(
        ctx: Context, input: dict, idempotency_key: str | None = None, locale: str = "zh"
    ) -> dict:
        result = await _submit(
            ctx, "math_animator", input, idempotency_key, "math_animation_generate_submit"
        )
        result["data"]["billing"]["notice"] = (
            "Manim/LaTeX/ffmpeg 渲染约 1–5 分钟；缺依赖时返回 CAPABILITY_UNAVAILABLE。"
        )
        return result

    @mcp.tool(name="math_animation_generate_get")
    async def math_animation_generate_get(ctx: Context, job_id: str) -> dict:
        return await capability_job_get(ctx, job_id)

    # -------------------------------------------------------- hooks & reviews
    def _require_hook():
        if hook_service is None:
            raise McpError("SERVICE_UNAVAILABLE", "Hook service is not configured.")
        return hook_service

    @mcp.tool(name="hook_event_submit")
    async def hook_event_submit(
        ctx: Context,
        event_type: str,
        idempotency_key: str,
        source_ref: str = "",
        channel: str = "unknown",
        payload: dict | None = None,
    ) -> dict:
        principal = await _principal(ctx)
        service = _require_hook()
        try:
            result = await service.deliver(
                principal.owner_user_id,
                event_type=event_type,
                idempotency_key=idempotency_key,
                source_ref=source_ref,
                channel=channel or "unknown",
                payload=payload,
            )
        except Exception as exc:  # noqa: BLE001
            raise McpError(
                getattr(exc, "code", "HOOK_ERROR"),
                str(exc),
                http_status=getattr(exc, "http_status", 400),
            )
        await _audit(
            ctx,
            principal,
            "hook_event_submit",
            resource_id=result["delivery_id"],
            usage={"event": event_type, "replayed": result["replayed"]},
        )
        return ok(result)

    @mcp.tool(name="hook_deliveries_list")
    async def hook_deliveries_list(ctx: Context, limit: int = 50) -> dict:
        principal = await _principal(ctx)
        service = _require_hook()
        items = await service.list_deliveries(principal.owner_user_id, min(max(limit, 1), 100))
        return ok({"deliveries": items, "count": len(items)})

    @mcp.tool(name="review_tasks_list")
    async def review_tasks_list(ctx: Context, limit: int = 50) -> dict:
        """Follow-up review tasks (polling fallback when host hooks are absent)."""
        principal = await _principal(ctx)
        service = _require_hook()
        items = await service._review_tasks.list_due(
            principal.owner_user_id, min(max(limit, 1), 100)
        )
        return ok({"tasks": items, "count": len(items)})

    @mcp.tool(name="review_task_complete")
    async def review_task_complete(
        ctx: Context, review_task_id: str, result: dict | None = None
    ) -> dict:
        principal = await _principal(ctx)
        service = _require_hook()
        outcome = await service._review_tasks.complete(
            principal.owner_user_id, review_task_id, result=result
        )
        if outcome is None:
            raise McpError(
                "NOT_FOUND", "Review task not found or already completed.", http_status=404
            )
        await _audit(ctx, principal, "review_task_complete", resource_id=review_task_id)
        return ok(outcome)

    # T0 error contract: tool failures return the JSON envelope
    # {"ok": false, "data": null, "error": {...}} instead of MCP-native
    # "Error executing tool" text, so hosts get stable, translatable codes.
    for tool in mcp._tool_manager._tools.values():
        original_fn = tool.fn

        async def envelope_fn(*args, _fn=original_fn, **kwargs):
            try:
                return await _fn(*args, **kwargs)
            except McpError as exc:
                return exc.to_dict()
            except Exception:  # noqa: BLE001
                logging.getLogger("deeptutor.mcp").exception(
                    "tool %s failed", getattr(_fn, "__name__", "tool")
                )
                return McpError(
                    "INTERNAL_ERROR",
                    "服务内部错误，请稍后重试",
                    retryable=True,
                    http_status=500,
                ).to_dict()

        envelope_fn.__wrapped__ = original_fn  # keep introspection metadata
        envelope_fn.__name__ = getattr(original_fn, "__name__", "tool")
        tool.fn = envelope_fn

    # Attach internals for tests without making them MCP tools.
    mcp._deeptutor_owner_user_id = owner_user_id
    mcp._deeptutor_job_service = jobs
    mcp._deeptutor_object_store = store
    return mcp


async def run_stdio() -> None:
    server = create_mcp_server()
    await server.run_stdio_async()
