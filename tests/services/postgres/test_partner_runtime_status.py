import uuid

from deeptutor.services.partners import runtime_status


def test_postgres_partner_status_shared_restart_and_factory(database_url, monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setattr(runtime_status, "_repository", None)
    partner_id = "status_" + uuid.uuid4().hex
    local_path = tmp_path / "status.sqlite3"
    writer = runtime_status.get_partner_runtime_status_repository()
    assert isinstance(writer, runtime_status.PostgresPartnerRuntimeStatusRepository)
    try:
        writer.set(partner_id, owner_id="worker-a", running=True, state="running",
                   payload={"name": "Ada", "channels": {"telegram": {"token": "secret"}}})
        reader = runtime_status.PostgresPartnerRuntimeStatusRepository()
        assert reader.get(partner_id)["running"] is True
        assert reader.list()[partner_id]["runtime_owner_id"] == "worker-a"
        assert "channels" not in reader.get(partner_id)
        reader.set(partner_id, owner_id="worker-b", running=False, state="stopped")
        assert writer.get(partner_id)["runtime_owner_id"] == "worker-b"
        assert not local_path.exists()
    finally:
        writer.delete(partner_id)
        monkeypatch.setattr(runtime_status, "_repository", None)
    assert runtime_status.PostgresPartnerRuntimeStatusRepository().get(partner_id) is None
