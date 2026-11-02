from __future__ import annotations


class AuthError(Exception):
    """Base class for authentication failures."""

    code = "AUTH_ERROR"
    http_status = 401


class InvalidCredentialsError(AuthError):
    code = "INVALID_CREDENTIALS"
    http_status = 401


class EmailTakenError(AuthError):
    code = "EMAIL_TAKEN"
    http_status = 409


class TokenError(AuthError):
    code = "INVALID_TOKEN"
    http_status = 401


class RefreshReuseError(TokenError):
    """A rotated or revoked refresh token was presented again (possible theft)."""

    code = "REFRESH_REUSED"
