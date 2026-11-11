"""Personal LLM profiles owned by one ordinary account.

An ordinary user's profiles live in that user's OWN catalog
(``data/users/<uid>/settings/model_catalog.json``), never in the shared admin
catalog. They may be API-key, local, or owner-bound OAuth profiles. Every
profile is merged into the runtime only inside the owner's request scope, so
it cannot appear in the administrator's list, another user's options, or the
grant editor. Administrator-granted models remain available alongside these
personal profiles.

Ownership resolution is shared with the credential store via
:func:`~deeptutor.multi_user.paths.get_owner_path_service`, so a profile and
its secret can never resolve to different accounts. A partner turn inherits
the catalog of the human who owns it.
"""

from __future__ import annotations

from typing import Any

from deeptutor.services.config.model_catalog import ModelCatalogService

from .paths import get_owner_path_service

_CODEX_MANAGED_BY = "openai_codex_oauth"


def _codex_profile_is_current(profile: dict[str, Any]) -> bool:
    try:
        from deeptutor.services.codex_auth import get_codex_oauth_service

        return get_codex_oauth_service().profile_matches_current_account(profile)
    except Exception:
        return False


def owner_catalog_service() -> ModelCatalogService:
    """Model catalog of the account that owns the current scope.

    For an administrator — and for any scope with no request context, i.e.
    CLI runs and background jobs — this is the shared deployment catalog, so
    administrator behaviour is exactly what it was. For an ordinary user it
    is their own file; for a partner, its owner's.
    """
    return ModelCatalogService.get_instance(
        get_owner_path_service().get_settings_file("model_catalog")
    )


def _personal_catalog_profiles() -> list[dict[str, Any]]:
    """Personal LLM profiles from the owner's own catalog.

    Empty for an administrator: their profiles already live in the shared
    catalog they manage, and overlaying them would duplicate every model in
    their own option list. Ordinary users may add API-key, local, and OAuth
    profiles here; all stay private to this owner.
    """
    from .context import get_current_user_or_none
    user = get_current_user_or_none()
    if user is None or user.is_admin:
        return []
    service = owner_catalog_service()
    # Checked rather than loaded blind: ``load()`` writes a default catalog
    # when the file is absent, and a user who never touched Codex should not
    # get a settings file created on every options request.
    if not service.path.exists():
        return []
    profiles = service.load().get("services", {}).get("llm", {}).get("profiles", []) or []
    return [
        profile
        for profile in profiles
        if isinstance(profile, dict)
        and (profile.get("managed_by") != _CODEX_MANAGED_BY or _codex_profile_is_current(profile))
    ]


def personal_llm_rows() -> list[dict[str, Any]]:
    """Personal models in the row shape ``redacted_model_access`` returns.

    ``source="personal"`` tells the frontend these came from the user's own
    catalog rather than an administrator's grant, so the same option list,
    capability gate, and selection validator all accept user-defined models.
    """
    rows: list[dict[str, Any]] = []
    for profile in _personal_catalog_profiles():
        profile_id = str(profile.get("id") or "")
        for model in profile.get("models", []) or []:
            if not isinstance(model, dict):
                continue
            model_id = str(model.get("id") or "")
            if not model_id:
                continue
            rows.append(
                {
                    "profile_id": profile_id,
                    "model_id": model_id,
                    "name": model.get("name") or model_id,
                    "model": model.get("model") or "",
                    "provider": profile.get("binding") or profile.get("provider") or (profile.get("provider_ref") or {}).get("binding") or "",
                    "reasoning_effort": model.get("reasoning_effort"),
                    "supported_reasoning_efforts": model.get("codex_supported_reasoning_levels"),
                    **{
                        f"declared_{key}": value
                        for key, value in (model.get("capabilities") or {}).items()
                        if key in {"reasoning", "vision"} and type(value) is bool
                    },
                    "source": "personal",
                    "available": True,
                }
            )
    return rows


def merge_personal_catalog(
    catalog: dict[str, Any], *, service_names: tuple[str, ...] | None = None,
    include_active: bool = True,
) -> dict[str, Any]:
    """Merge every personal service profile into the shared runtime view.

    The overlay is scoped to the current owner and never persisted back into
    the shared catalog. Personal profiles replace matching shared IDs and
    their active selections take precedence, including embedding, search,
    speech, and generation services. Personal provider connections are merged
    too: a profile's ``provider_ref`` names a connection stored in the owner's
    own catalog, and resolving it against the shared connection list alone
    raises "provider no longer configured".
    """
    owner_catalog = owner_catalog_service().load()
    owner_services = owner_catalog.get("services", {})
    if not any((service.get("profiles") or []) for service in owner_services.values() if isinstance(service, dict)):
        return catalog
    merged = dict(catalog)
    # Bring the owner's private connections into the in-memory view so the
    # provider_ref links attached to personal profiles can resolve. Keep
    # shared connections first and let same-id personal entries replace them;
    # the merged catalog is request-scoped and never written or sent to the UI.
    owner_connections = [
        connection
        for connection in owner_catalog.get("connections", []) or []
        if isinstance(connection, dict) and connection.get("id")
    ]
    if owner_connections:
        merged_connections = [
            connection
            for connection in (merged.get("connections") or [])
            if isinstance(connection, dict)
            and str(connection.get("id") or "")
            not in {str(item.get("id")) for item in owner_connections}
        ]
        merged["connections"] = merged_connections + owner_connections
    merged_services = dict(merged.get("services") or {})
    for service_name, personal_service in owner_services.items():
        if service_names is not None and service_name not in service_names:
            continue
        if not isinstance(personal_service, dict):
            continue
        profiles = [
            profile
            for profile in personal_service.get("profiles") or []
            if isinstance(profile, dict)
            and (profile.get("managed_by") != _CODEX_MANAGED_BY or _codex_profile_is_current(profile))
        ]
        if not profiles:
            continue
        personal_ids = {str(profile.get("id") or "") for profile in profiles}
        service = dict(merged_services.get(service_name) or {})
        shared = [
            profile
            for profile in service.get("profiles") or []
            if not (isinstance(profile, dict) and str(profile.get("id") or "") in personal_ids)
        ]
        service["profiles"] = shared + profiles
        if include_active and personal_service.get("active_profile_id"):
            service["active_profile_id"] = personal_service["active_profile_id"]
        if include_active and personal_service.get("active_model_id"):
            service["active_model_id"] = personal_service["active_model_id"]
        for key in ("mode", "selection", "overrides"):
            if key in personal_service:
                service[key] = personal_service[key]
        merged_services[service_name] = service
    merged["services"] = merged_services
    return merged


def merge_personal_llm_profiles(
    catalog: dict[str, Any], *, include_active: bool = True,
) -> dict[str, Any]:
    """Backward-compatible LLM-only view of :func:`merge_personal_catalog`."""
    return merge_personal_catalog(catalog, service_names=("llm",), include_active=include_active)


__all__ = [
    "merge_personal_catalog",
    "merge_personal_llm_profiles",
    "owner_catalog_service",
    "personal_llm_rows",
]
