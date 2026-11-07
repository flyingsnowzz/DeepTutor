from concurrent.futures import ThreadPoolExecutor
import uuid

import pytest

from deeptutor.multi_user import session_handoff
from deeptutor.multi_user.postgres_session_handoff import PostgresSessionHandoffStore


def test_postgres_handoff_is_one_time_across_workers(database_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setattr(session_handoff, "load_or_create_auth_secret", lambda: "test-secret")
    store = session_handoff.get_session_handoff_store()
    assert isinstance(store, PostgresSessionHandoffStore)
    ticket = session_handoff.encrypt_ticket_payload({"host": "app.example", "exp": 1300})
    record = store.create(
        encrypted_ticket=ticket, ticket_hash=session_handoff.hash_secret(ticket),
        public_host="app.example", now=1000, rate_key=uuid.uuid4().hex,
    )
    second = PostgresSessionHandoffStore()
    with pytest.raises(session_handoff.HandoffRejected, match="site"):
        second.exchange(code=record.code, public_host="other.example", now=1001)

    def exchange(_):
        try:
            return second.exchange(code=record.code, public_host="app.example", now=1002)
        except session_handoff.HandoffRejected:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(exchange, range(2)))
    assert len([item for item in results if item]) == 1
    fresh = next(item for item in results if item)
    assert session_handoff.decrypt_ticket_payload(fresh)["exp"] == 1122
    assert store.consume_ticket(ticket=fresh, public_host="app.example", now=1003) == fresh
    with pytest.raises(session_handoff.HandoffRejected):
        second.consume_ticket(ticket=fresh, public_host="app.example", now=1004)
