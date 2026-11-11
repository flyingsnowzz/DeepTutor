"""Ordinary accounts can define and use private model profiles."""

from __future__ import annotations

import pytest

import json

from deeptutor.api.routers import settings as settings_router
from deeptutor.multi_user import model_access, personal_models
from deeptutor.services.config.provider_runtime import resolve_embedding_runtime_config, resolve_llm_runtime_config


@pytest.fixture
def no_grants(monkeypatch):
    monkeypatch.setattr(model_access, "load_grant", lambda _uid=None: {"models": {"llm": []}})


def _profile() -> dict:
    return {
        "id": "personal-openai",
        "name": "My OpenAI-compatible server",
        "binding": "openai",
        "provider": "custom",
        "base_url": "https://models.alice.example/v1",
        "api_key": "sk-alice-private",
        "models": [{"id": "personal-model", "name": "Personal model", "model": "gpt-personal"}],
    }


def _write_profile(as_user, uid: str) -> None:
    with as_user(uid):
        service = personal_models.owner_catalog_service()
        service.path.parent.mkdir(parents=True, exist_ok=True)
        service.path.write_text(
            json.dumps({
                "version": 1,
                "services": {
                    "llm": {
                        "active_profile_id": "personal-openai",
                        "active_model_id": "personal-model",
                        "profiles": [_profile()],
                    },
                    "embedding": {
                        "active_profile_id": "personal-openai",
                        "active_model_id": "personal-model",
                        "profiles": [{
                            **_profile(),
                            "models": [{"id": "personal-model", "name": "Personal embedding", "model": "embedding-personal"}],
                        }],
                    },
                },
            }),
            encoding="utf-8",
        )


def test_custom_profile_reaches_only_its_owner_and_resolves_with_its_secret(
    as_user, mu_isolated_root, no_grants
):
    _write_profile(as_user, "u_alice")

    with as_user("u_alice"):
        options = model_access.allowed_llm_options()
        assert options["active"] == {"profile_id": "personal-openai", "model_id": "personal-model"}
        assert options["options"][0]["source"] == "personal"
        assert model_access.apply_allowed_llm_selection(options["active"]) == options["active"]
        resolved = resolve_llm_runtime_config()
        assert resolved.model == "gpt-personal"
        assert resolved.api_key == "sk-alice-private"
        assert resolved.base_url == "https://models.alice.example/v1"
        embedding = resolve_embedding_runtime_config()
        assert embedding.model == "embedding-personal"
        assert embedding.api_key == "sk-alice-private"

    with as_user("u_bob"):
        assert model_access.allowed_llm_options()["options"] == []


@pytest.mark.asyncio
async def test_personal_catalog_apply_is_private_and_redacted(as_user, mu_isolated_root, no_grants):
    _write_profile(as_user, "u_alice")
    with as_user("u_alice"):
        result = await settings_router.get_settings()
        profile = result["catalog"]["services"]["llm"]["profiles"][0]
        assert profile["api_key"] == settings_router.CATALOG_SECRET_MASK
        assert "sk-alice-private" not in json.dumps(result)

        config = {
            "active_profile_id": "personal-openai",
            "active_model_id": "personal-model",
            "profiles": [_profile()],
        }
        applied = await settings_router.apply_catalog_service(
            settings_router.CatalogServicePayload(service="llm", config=config)
        )
        assert applied["catalog"]["services"]["llm"]["profiles"][0]["api_key"] == settings_router.CATALOG_SECRET_MASK
        stored = json.loads(personal_models.owner_catalog_service().path.read_text())
        assert stored["services"]["llm"]["profiles"][0]["api_key"] == "sk-alice-private"

    with as_user("u_bob"):
        assert not personal_models.owner_catalog_service().path.exists()
