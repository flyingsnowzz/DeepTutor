from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from deeptutor.multi_user.context import reset_current_user, set_current_user
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.services.calendar.models import EventInput, EventPatch, EventPatchRequest
from deeptutor.services.calendar.recurrence import parse_instant
from deeptutor.services.calendar.store import get_calendar_store
from deeptutor.services.postgres.calendar_store import PostgresCalendarStore


def test_calendar_postgres_recurrence_undo_owner_and_restart(two_owners, database_url, monkeypatch, tmp_path):
    a, b = two_owners
    monkeypatch.setenv("DEEPTUTOR_ACCOUNT_BACKEND", "postgres")
    monkeypatch.setenv("DEEPTUTOR_STORAGE_BACKEND", "postgres")
    monkeypatch.setenv("DATABASE_URL", database_url)

    def bind(owner):
        return set_current_user(CurrentUser(
            id=owner, username=owner, role="user",
            scope=UserScope(kind="user", user_id=owner, root=Path(tmp_path) / owner),
        ))

    token = bind(a)
    try:
        store = get_calendar_store()
        event = store.create(EventInput(
            title="Study", start="2026-03-22T08:00:00Z", end="2026-03-22T09:00:00Z",
            tzid="Europe/Berlin", rrule="FREQ=WEEKLY;COUNT=3",
        ))["event"]
        key = "2026-03-29T07:00:00Z"
        store.update(event.id, EventPatchRequest(
            changes=EventPatch(title="Changed"), scope="this", occurrence=key,
        ))
        before_failed_edit = store.revision()
        with pytest.raises(ValueError):
            store.delete(event.id, "this", "2026-04-01T00:00:00Z")
        assert PostgresCalendarStore(a).revision() == before_failed_edit
        reloaded = get_calendar_store()
        bounds = (parse_instant("2026-03-01T00:00:00Z"), parse_instant("2026-05-01T00:00:00Z"))
        assert [r.title for r in reloaded.occurrences(*bounds, "Europe/Berlin")["occurrences"]] == [
            "Study", "Changed", "Study",
        ]
        result = reloaded.delete(event.id, "following", key)
        assert len(get_calendar_store().occurrences(*bounds, "Europe/Berlin")["occurrences"]) == 1
        get_calendar_store().restore(result["undo_token"])
        assert len(get_calendar_store().occurrences(*bounds, "Europe/Berlin")["occurrences"]) == 3
        assert not (Path(tmp_path) / a / ".runtime/calendar/calendar.sqlite").exists()
    finally:
        reset_current_user(token)

    token = bind(b)
    try:
        assert get_calendar_store().occurrences(*bounds, "Europe/Berlin")["occurrences"] == []
    finally:
        reset_current_user(token)


def test_calendar_postgres_concurrent_writes(two_owners, database_url, monkeypatch):
    owner, _ = two_owners
    monkeypatch.setenv("DATABASE_URL", database_url)
    store = PostgresCalendarStore(owner)
    def create(index):
        return store.create(EventInput(
            title=f"Study {index}", start="2026-03-22T08:00:00Z",
            end="2026-03-22T09:00:00Z", tzid="Europe/Berlin",
        ))
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(create, range(12)))
    assert PostgresCalendarStore(owner).revision() == 12
    assert len(store.search("Study")["events"]) == 12
