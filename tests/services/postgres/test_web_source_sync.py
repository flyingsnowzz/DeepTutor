import concurrent.futures
import time
import uuid

from deeptutor.services.web_source.repository import PostgresWebSourceSyncRepository
from deeptutor.services.web_source.scheduler import default_repository


def test_postgres_web_source_claim_restart_pairings_and_selection(database_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    assert isinstance(default_repository(), PostgresWebSourceSyncRepository)
    key = ("owner_" + uuid.uuid4().hex, "kb", "source")
    first = PostgresWebSourceSyncRepository()
    second = PostgresWebSourceSyncRepository()
    first.ensure_source(key)
    try:
        job = second.get(key)
        assert job is not None
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(
                lambda i: (first if i == 0 else second).claim(
                    job, runner_id=f"runner-{i}",
                    lease_until_ms=int(time.time() * 1000) + 60_000,
                ), range(2),
            ))
        assert sum(result is not None for result in results) == 1
        claimed = next(result for result in results if result is not None)
        assert second.get(key).state == "running"
        assert second.renew_lease(claimed, int(time.time() * 1000) + 70_000)
        first.record_pairings(key[0], key[1], key[2], [{
            "pairing_id": "pair", "source_url": "https://a.example",
            "target_url": "https://b.example",
        }])
        assert second.list_pairings(key[0], key[1])[0].pairing_id == "pair"
        first.mark_success(claimed, int(time.time() * 1000) + 80_000)
        assert second.get(key).state == "pending"
    finally:
        first.delete(key)
    assert second.get(key) is None
