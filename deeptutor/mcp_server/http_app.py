"""Streamable HTTP MCP application with multi-account Bearer authentication.

Endpoints:
  POST /mcp                 MCP streamable HTTP (Bearer access token)
  GET  /healthz             liveness
  GET  /readyz              readiness (DB connectivity)
  POST /v1/auth/register    email + password registration
  POST /v1/auth/login       issue access + refresh tokens
  POST /v1/auth/refresh     rotate refresh token
  POST /v1/auth/revoke      revoke a refresh token
  GET  /v1/billing/plans    public plan catalogue
"""

from __future__ import annotations

import contextlib
import json
import logging
from typing import Any

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from deeptutor.services.auth.config import AuthConfig
from deeptutor.services.auth.service import AuthService
from deeptutor.services.quota.plans import PLAN_LIMITS
from deeptutor.services.quota.service import QuotaService

from .context import RequestPrincipal
from .models import max_request_bytes, rate_limit_per_minute
from .rate_limit import SlidingWindowRateLimiter

logger = logging.getLogger("deeptutor.mcp.http")


def envelope_error(
    code: str, message: str, *, status: int, details: dict | None = None
) -> JSONResponse:
    return JSONResponse(
        {
            "ok": False,
            "data": None,
            "error": {"code": code, "message": message, "details": details or {}},
        },
        status_code=status,
    )


async def _json_body(request, max_bytes: int) -> dict[str, Any]:
    if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
        raise ValueError("content-type must be application/json")
    raw = await request.body()
    if len(raw) > max_bytes:
        raise ValueError("request body too large")
    if not raw:
        return {}
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("body must be a JSON object")
    return data


def _client_ip(request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "")[:64]


class MCPAuthMiddleware:
    """Raw ASGI middleware: request id, body cap, rate limit, Bearer auth."""

    def __init__(
        self,
        app,
        *,
        auth: AuthService,
        config: AuthConfig,
        limiter: SlidingWindowRateLimiter,
        body_limit: int,
    ):
        self.app = app
        self._auth = auth
        self._config = config
        self._limiter = limiter
        self._body_limit = body_limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        state = scope.setdefault("state", {})
        headers = dict(scope.get("headers", []))
        request_id = headers.get(b"x-request-id", b"").decode("latin1") or None
        if not request_id:
            from .context import new_request_id

            request_id = new_request_id()
        state["request_id"] = request_id
        state["client_ip"] = ""

        async def send_with_request_id(message):
            if message["type"] == "http.response.start":
                message.setdefault("headers", []).append(
                    (b"x-request-id", request_id.encode("latin1"))
                )
            await send(message)

        async def receive_capped():
            message = await receive()
            if message.get("type") == "http.request":
                cl = int(dict(scope.get("headers", [])).get(b"content-length", b"0") or 0)
                if cl > self._body_limit or len(message.get("body", b"")) > self._body_limit:
                    message["body"] = b""
                    message["more_body"] = False
                    state["body_too_large"] = True
            return message

        if path.startswith("/v1/auth/"):
            # Stricter bucket for credential endpoints.
            from starlette.requests import Request

            request = Request(scope)
            ip = _client_ip(request)
            state["client_ip"] = ip
            decision = self._limiter.check(f"auth:{ip}", limit=rate_limit_per_minute("auth"))
            if not decision.allowed:
                response = envelope_error(
                    "RATE_LIMITED",
                    "请求过于频繁，请稍后再试",
                    status=429,
                    details={"retry_after_seconds": decision.retry_after_seconds},
                )
                response.headers["Retry-After"] = str(int(decision.retry_after_seconds) + 1)
                await response(scope, receive_capped, send_with_request_id)
                return
            await self.app(scope, receive_capped, send_with_request_id)
            return

        if path == "/mcp":
            from starlette.requests import Request

            request = Request(scope)
            ip = _client_ip(request)
            state["client_ip"] = ip

            declared_length = int(request.headers.get("content-length", "0") or 0)
            if declared_length > self._body_limit:
                response = envelope_error(
                    "PAYLOAD_TOO_LARGE",
                    f"请求体超过 {self._body_limit} 字节上限",
                    status=413,
                )
                await response(scope, receive_capped, send_with_request_id)
                return

            decision = self._limiter.check(f"mcp:{ip}", limit=rate_limit_per_minute("mcp"))
            if not decision.allowed:
                response = envelope_error(
                    "RATE_LIMITED",
                    "请求过于频繁，请稍后再试",
                    status=429,
                    details={"retry_after_seconds": decision.retry_after_seconds},
                )
                response.headers["Retry-After"] = str(int(decision.retry_after_seconds) + 1)
                await response(scope, receive_capped, send_with_request_id)
                return

            header = request.headers.get("authorization", "")
            if not header.lower().startswith("bearer "):
                await self._unauthorized(
                    send_with_request_id, scope, receive_capped, "缺少访问令牌", "missing_token"
                )
                return
            token = header[7:].strip()
            try:
                principal = self._auth.decode_access_token(token)
            except Exception as exc:  # noqa: BLE001
                await self._unauthorized(
                    send_with_request_id, scope, receive_capped, str(exc), "invalid_token"
                )
                return
            state["principal"] = RequestPrincipal(
                owner_user_id=principal.owner_user_id,
                plan=principal.plan,
                email=principal.email,
                request_id=request_id,
                ip=ip,
            )

        await self.app(scope, receive_capped, send_with_request_id)

    async def _unauthorized(self, send, scope, receive, message: str, error: str) -> None:
        response = envelope_error(
            "UNAUTHENTICATED",
            message,
            status=401,
            details={
                "login_url": self._config.login_url,
                "register_url": self._config.register_url,
                "scheme": "Bearer",
            },
        )
        response.headers["WWW-Authenticate"] = f'Bearer realm="deeptutor-mcp", error="{error}"'
        await response(scope, receive, send)


def build_http_app(
    *,
    auth: AuthService,
    quota: QuotaService,
    config: AuthConfig,
    mcp,
    readiness_check=None,
) -> Starlette:
    limiter = SlidingWindowRateLimiter()
    body_limit = max_request_bytes()

    async def healthz(request):
        return JSONResponse({"ok": True, "data": {"status": "ok"}, "error": None})

    async def readyz(request):
        if readiness_check is None:
            return JSONResponse({"ok": True, "data": {"ready": True}, "error": None})
        try:
            await readiness_check()
        except Exception as exc:  # noqa: BLE001
            return envelope_error("NOT_READY", str(exc), status=503)
        return JSONResponse({"ok": True, "data": {"ready": True}, "error": None})

    async def register(request):
        try:
            data = await _json_body(request, body_limit)
            user_id = await auth.register(
                email=str(data.get("email", "")),
                password=str(data.get("password", "")),
                display_name=str(data.get("display_name", "")),
            )
        except ValueError as exc:
            return envelope_error("INVALID_ARGUMENT", str(exc), status=400)
        except Exception as exc:  # noqa: BLE001
            code = getattr(exc, "code", "AUTH_ERROR")
            status = getattr(exc, "http_status", 400)
            return envelope_error(code, str(exc), status=status)
        return JSONResponse(
            {"ok": True, "data": {"user_id": user_id}, "error": None}, status_code=201
        )

    async def _issue_tokens(request, *, rotate: bool):
        try:
            data = await _json_body(request, body_limit)
            user_agent = request.headers.get("user-agent", "")
            if rotate:
                principal, pair = await auth.rotate_refresh_token(
                    str(data.get("refresh_token", "")), user_agent=user_agent
                )
            else:
                principal, pair = await auth.login(
                    email=str(data.get("email", "")),
                    password=str(data.get("password", "")),
                    user_agent=user_agent,
                )
        except ValueError as exc:
            return envelope_error("INVALID_ARGUMENT", str(exc), status=400)
        except json.JSONDecodeError:
            return envelope_error("INVALID_ARGUMENT", "请求体不是合法 JSON", status=400)
        except Exception as exc:  # noqa: BLE001
            code = getattr(exc, "code", "AUTH_ERROR")
            status = getattr(exc, "http_status", 401)
            return envelope_error(code, str(exc), status=status)
        return JSONResponse(
            {
                "ok": True,
                "data": {
                    "access_token": pair.access_token,
                    "refresh_token": pair.refresh_token,
                    "token_type": pair.token_type,
                    "expires_in": pair.expires_in,
                    "refresh_expires_in": pair.refresh_expires_in,
                    "user_id": principal.user_id,
                    "plan": principal.plan,
                },
                "error": None,
            }
        )

    async def login(request):
        return await _issue_tokens(request, rotate=False)

    async def refresh(request):
        return await _issue_tokens(request, rotate=True)

    async def revoke(request):
        try:
            data = await _json_body(request, body_limit)
            revoked = await auth.revoke_refresh_token(str(data.get("refresh_token", "")))
        except ValueError as exc:
            return envelope_error("INVALID_ARGUMENT", str(exc), status=400)
        except json.JSONDecodeError:
            return envelope_error("INVALID_ARGUMENT", "请求体不是合法 JSON", status=400)
        return JSONResponse({"ok": True, "data": {"revoked": revoked}, "error": None})

    async def plans(request):
        public = {}
        for plan, periods in PLAN_LIMITS.items():
            public[plan] = {
                period: {str(k): v for k, v in metrics.items()}
                for period, metrics in periods.items()
            }
        return JSONResponse({"ok": True, "data": {"plans": public}, "error": None})

    mcp_http_app = mcp.streamable_http_app()

    # Mounting the MCP Starlette sub-app does not forward lifespan events, so
    # its streamable-HTTP session manager must be started by the outer app.
    @contextlib.asynccontextmanager
    async def lifespan(app):
        async with mcp._session_manager.run():
            yield

    middleware = [
        Middleware(
            MCPAuthMiddleware,
            auth=auth,
            config=config,
            limiter=limiter,
            body_limit=body_limit,
        )
    ]

    return Starlette(
        routes=[
            Route("/healthz", healthz, methods=["GET"]),
            Route("/readyz", readyz, methods=["GET"]),
            Route("/v1/auth/register", register, methods=["POST"]),
            Route("/v1/auth/login", login, methods=["POST"]),
            Route("/v1/auth/refresh", refresh, methods=["POST"]),
            Route("/v1/auth/revoke", revoke, methods=["POST"]),
            Route("/v1/billing/plans", plans, methods=["GET"]),
            # The MCP streamable app owns /mcp internally; mount it last so the
            # explicit routes above take precedence.
            Mount("/", app=mcp_http_app),
        ],
        middleware=middleware,
        lifespan=lifespan,
    )
