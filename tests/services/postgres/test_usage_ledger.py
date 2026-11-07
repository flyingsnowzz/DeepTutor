from pathlib import Path

from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.services.llm import usage_ledger


def test_postgres_usage_ledger_owner_and_dedup(two_owners, database_url, monkeypatch, tmp_path):
    owner_a, owner_b = two_owners
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)

    def bind(owner):
        return set_current_user(CurrentUser(
            id=owner, username=owner, role="user",
            scope=UserScope(kind="user", user_id=owner, root=Path(tmp_path) / owner),
        ))

    token = bind(owner_a)
    try:
        call = {
            "call_id": "call-ledger-test", "model": "test", "provider": "test",
            "status": "ok", "estimated": False, "prompt_tokens": 5,
            "completion_tokens": 2, "total_tokens": 7,
            "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0,
            "reasoning_tokens": 0, "duration_seconds": 1.0,
        }
        usage_ledger.record_call(Path("unused.sqlite"), call, started_at=100, turn_id="t")
        usage_ledger.record_call(Path("unused.sqlite"), call, started_at=100, turn_id="t")
        rows = usage_ledger.usage_records(0, 200)
        assert len(rows) == 1
        assert rows[0]["turn_id"] == "t"
        assert usage_ledger.combined_usage_records(rows, 0, 200)[-1] == rows[0]
        assert not (Path(tmp_path) / owner_a / "usage.sqlite3").exists()
    finally:
        reset_current_user(token)

    token = bind(owner_b)
    try:
        assert usage_ledger.usage_records(0, 200) == []
    finally:
        reset_current_user(token)
