from __future__ import annotations

import uuid

import pytest

from deeptutor.services.accounts.first_party import AccountExistsError, FirstPartyAccountService


@pytest.mark.asyncio
async def test_first_party_registration_and_login_are_case_insensitive(auth_engine):
    service = FirstPartyAccountService(auth_engine)
    name = "Learner_" + uuid.uuid4().hex[:12]
    user_id = await service.register(name, "password-123")
    assert (await service.authenticate(name.lower(), "password-123"))["id"] == user_id
    assert (await service.get_user(user_id))["username"] == name
    assert any(row["id"] == user_id for row in await service.list_users())
    assert await service.authenticate(name, "wrong-password") is None
    with pytest.raises(AccountExistsError):
        await service.register(name.lower(), "another-password-123")
