from __future__ import annotations

import uuid

import pytest

from deeptutor.services.accounts.admin import AdminAccountService, AdminPermissionError
from deeptutor.services.auth.security import hash_password


@pytest.mark.asyncio
async def test_deployment_superadmin_controls_separate_admin_accounts(auth_engine):
    service = AdminAccountService(auth_engine)
    name = "super-" + uuid.uuid4().hex
    password = "deployment-password-123"
    existing = next((row for row in await service.list_admins() if row["is_superadmin"]), None)
    if existing is None:
        super_id = await service.bootstrap_superadmin(name, hash_password(password))
        assert await service.bootstrap_superadmin(name, hash_password(password)) == super_id
        assert (await service.authenticate(name, password))["is_superadmin"] is True
    else:
        super_id = existing["id"]
        name = existing["username"]
    with pytest.raises(AdminPermissionError):
        await service.bootstrap_superadmin("other-" + uuid.uuid4().hex, hash_password(password))
    assert (await service.get_admin(super_id))["username"] == name

    with pytest.raises(AdminPermissionError):
        await service.create_admin("missing-admin", "delegated", hash_password("password-123"))
    delegated_name = "delegated-" + uuid.uuid4().hex
    delegated_id = await service.create_admin(
        super_id, delegated_name, hash_password("delegated-password-123")
    )
    assert (await service.authenticate(delegated_name, "delegated-password-123"))["id"] == delegated_id
    assert {super_id, delegated_id} <= {row["id"] for row in await service.list_admins()}
    assert await service.authenticate(delegated_name, "wrong-password") is None
    with pytest.raises(AdminPermissionError):
        await service.create_admin(delegated_id, "another-admin", hash_password("password-123"))
