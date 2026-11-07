"""End-to-end SQLite -> PostgreSQL ETL test against a real PostgreSQL."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import shutil
import sqlite3
import time
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set")

MIGRATE_PATH = (
    Path(__file__).resolve().parents[2] / "scripts/migration/sqlite_to_postgres/migrate.py"
)


def _load_migrate():
    spec = importlib.util.spec_from_file_location("sqlite_to_postgres_migrate", MIGRATE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _build_chat_db(path: Path, *, session_id: str, orphan: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.executescript(
        """
        CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, created_at REAL, updated_at REAL,
          compressed_summary TEXT, summary_up_to_msg_id INTEGER, preferences_json TEXT, deleted_at REAL);
        CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
          capability TEXT, events_json TEXT, attachments_json TEXT, metadata_json TEXT,
          created_at REAL, parent_message_id INTEGER);
        CREATE TABLE turns (id TEXT PRIMARY KEY, session_id TEXT, capability TEXT, status TEXT, error TEXT,
          created_at REAL, updated_at REAL, finished_at REAL, owner_id TEXT, fencing_token TEXT,
          state_version INTEGER, failure_code TEXT, retryable INTEGER, assistant_message_id INTEGER);
        CREATE TABLE turn_events (id INTEGER PRIMARY KEY, turn_id TEXT, seq INTEGER, type TEXT, source TEXT,
          stage TEXT, content TEXT, metadata_json TEXT, timestamp REAL, created_at REAL);
        CREATE TABLE notebook_entries (id INTEGER PRIMARY KEY, session_id TEXT, origin_type TEXT, origin_ref TEXT,
          turn_id TEXT, question_id TEXT, question TEXT, question_type TEXT, options_json TEXT, correct_answer TEXT,
          explanation TEXT, difficulty TEXT, user_answer TEXT, user_answer_images_json TEXT, source TEXT,
          material_id TEXT, material_title TEXT, section_id TEXT, section_title TEXT, score_trend TEXT,
          assessment_type TEXT, result TEXT, mastery_path_id TEXT, knowledge_point_id TEXT, attempt_count INTEGER,
          hints_used INTEGER, confidence REAL, response_time REAL, quality TEXT, is_correct INTEGER, resolved INTEGER,
          bookmarked INTEGER, followup_session_id TEXT, ai_judgment TEXT, created_at REAL, updated_at REAL);
        CREATE TABLE notebook_categories (id INTEGER PRIMARY KEY, name TEXT, created_at REAL);
        CREATE TABLE notebook_entry_categories (entry_id INTEGER, category_id INTEGER);
        CREATE TABLE reading_quiz_pending (material_id TEXT, locator INTEGER,
          question_id TEXT, question_json TEXT, created_at REAL);
        CREATE TABLE reading_quiz_rewards (material_id TEXT, locator INTEGER,
          stars INTEGER, updated_at REAL);
        CREATE TABLE practice_review_state (entry_id TEXT PRIMARY KEY, is_mistake INTEGER, first_wrong_at REAL,
          due_at REAL, interval_days REAL, ease REAL, streak INTEGER, lapses INTEGER, review_count INTEGER,
          last_review_at REAL, version INTEGER);
        CREATE TABLE practice_review_events (request_id TEXT, entry_id TEXT, rating TEXT, answer TEXT,
          reviewed_at REAL, outcome_json TEXT);
        CREATE TABLE assessment_attempts (attempt_id TEXT PRIMARY KEY, session_id TEXT,
          mastery_path_id TEXT, knowledge_point_id TEXT, assessment_json TEXT,
          linked_applied INTEGER, occurred_at REAL);
        """
    )
    now = time.time()
    con.execute(
        "INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)",
        (session_id, "迁移会话", now - 100, now - 10, "摘要", None, "{}", None),
    )
    con.execute(
        "INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?)",
        (1, session_id, "user", "你好", "chat", "[]", "[]", "{}", now - 95, None),
    )
    con.execute(
        "INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?)",
        (2, session_id, "assistant", "你好！", "chat", "[]", "[]", "{}", now - 85, 1),
    )
    turn_id = f"turn-{uuid.uuid4().hex[:8]}"
    con.execute(
        "INSERT INTO turns VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            turn_id,
            session_id,
            "chat",
            "completed",
            "",
            now - 90,
            now - 80,
            now - 80,
            None,
            None,
            1,
            "",
            0,
            2,
        ),
    )
    con.execute(
        "INSERT INTO turn_events (turn_id,seq,type,source,stage,content,metadata_json,timestamp,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (turn_id, 1, "token", "assistant", "responding", "你好", "{}", now - 85, now - 85),
    )
    if orphan:
        con.execute(
            "INSERT INTO turns VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "turn-orphan",
                "session-missing",
                "chat",
                "completed",
                "",
                now,
                now,
                now,
                None,
                None,
                1,
                "",
                0,
                None,
            ),
        )
        con.execute(
            "INSERT INTO turn_events (turn_id,seq,type,source,stage,content,metadata_json,timestamp,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            ("turn-orphan", 1, "token", "assistant", "responding", "x", "{}", now, now),
        )
    con.execute(
        """INSERT INTO notebook_entries (id, session_id, origin_type, origin_ref, question_id, question,
           question_type, options_json, correct_answer, explanation, difficulty, user_answer, source,
           mastery_path_id, knowledge_point_id, attempt_count, is_correct, resolved, bookmarked, created_at, updated_at)
           VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            session_id,
            "deep_question",
            turn_id,
            "q1",
            "1+1=?",
            "single_choice",
            '{"A":"1","B":"2"}',
            "B",
            "1+1=2",
            "easy",
            "A",
            "deep_question",
            None,
            "kp-add",
            1,
            1,
            1,
            0,
            now - 70,
            now - 70,
        ),
    )
    con.execute(
        "INSERT INTO practice_review_state VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        ("1", 1, now - 70, now + 86400, 1.0, 2.5, 0, 0, 1, now - 60, 1),
    )
    con.execute("INSERT INTO notebook_categories VALUES (?,?,?)", (1, "Algebra", now - 65))
    con.execute("INSERT INTO notebook_entry_categories VALUES (?,?)", (1, 1))
    con.execute("INSERT INTO reading_quiz_pending VALUES (?,?,?,?,?)",
                ("atlas", 4, "q1", '{"prompt":"Ocean?","choices":["Pacific","Atlantic"],"correct_choice_index":1}', now))
    con.execute("INSERT INTO reading_quiz_rewards VALUES (?,?,?,?)",
                ("atlas", 4, 2, now))
    con.execute(
        "INSERT INTO practice_review_events VALUES (?,?,?,?,?,?)",
        ("req-1", "1", "again", "A", now - 60, "{}"),
    )
    con.execute(
        "INSERT INTO assessment_attempts VALUES (?,?,?,?,?,?,?)",
        (f"attempt-{uuid.uuid4().hex}", session_id, "", "kp-add", "{}", 0, now - 50),
    )
    con.commit()
    con.close()


def _build_mastery_db(path: Path, *, path_id: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.executescript(
        """
        CREATE TABLE mastery_paths (path_id TEXT PRIMARY KEY, state_json TEXT, revision INTEGER,
          created_at REAL, updated_at REAL, owner_session_id TEXT);
        CREATE TABLE mastery_interactions (interaction_id TEXT PRIMARY KEY, path_id TEXT, status TEXT,
          question_json TEXT, session_id TEXT, turn_id TEXT, user_answer TEXT, result_json TEXT,
          created_at REAL, updated_at REAL);
        CREATE TABLE mastery_events (id INTEGER PRIMARY KEY, path_id TEXT, revision INTEGER, event_type TEXT,
          payload_json TEXT, session_id TEXT, turn_id TEXT, created_at REAL);
        CREATE TABLE mastery_schema_migrations (name TEXT, applied_at REAL);
        CREATE TABLE mastery_topic_meta (path_id TEXT PRIMARY KEY, goal TEXT, description TEXT,
          emoji TEXT, map_seed INTEGER, status TEXT, created_at REAL, updated_at REAL);
        CREATE TABLE mastery_topic_sources (source_id TEXT PRIMARY KEY, path_id TEXT, kind TEXT,
          external_id TEXT, label TEXT, excerpt TEXT, position INTEGER, available INTEGER,
          metadata_json TEXT, created_at REAL);
        CREATE TABLE mastery_learning_evidence (path_id TEXT, ordinal INTEGER,
          knowledge_point_id TEXT, timestamp REAL, source TEXT, assessment_type TEXT,
          result TEXT, quality REAL, session_id TEXT, turn_id TEXT, evidence_json TEXT);
        CREATE TABLE reading_progress (material_id TEXT PRIMARY KEY, latest_locator INTEGER,
          latest_percentage REAL, furthest_locator INTEGER, furthest_percentage REAL,
          updated_at REAL);
        CREATE TABLE reading_activities (activity_id TEXT PRIMARY KEY, material_id TEXT,
          extension_id TEXT, action TEXT, locator INTEGER, result_type TEXT,
          created_at REAL);
        """
    )
    now = time.time()
    con.execute(
        "INSERT INTO mastery_paths VALUES (?,?,?,?,?,?)",
        (path_id, '{"topic":"二次函数"}', 1, now, now, ""),
    )
    con.execute(
        "INSERT INTO mastery_interactions VALUES (?,?,?,?,?,?,?,?,?,?)",
        (
            f"ix-{path_id}",
            path_id,
            "answered",
            '{"q":"顶点?"}',
            "",
            "",
            "(-b/2a,...)",
            '{"correct":true}',
            now,
            now,
        ),
    )
    con.execute(
        "INSERT INTO mastery_events (path_id,revision,event_type,payload_json,session_id,turn_id,created_at) VALUES (?,?,?,?,?,?,?)",
        (path_id, 1, "path_started", "{}", "", "", now),
    )
    con.execute(
        "INSERT INTO mastery_topic_meta VALUES (?,?,?,?,?,?,?,?)",
        (path_id, "二次函数", "函数图像", "📈", 3, "active", now, now),
    )
    con.execute(
        "INSERT INTO mastery_topic_sources VALUES (?,?,?,?,?,?,?,?,?,?)",
        (f"source-{path_id}", path_id, "document", "doc-1", "教材", "第一章", 0, 1, "{}", now),
    )
    con.execute(
        "INSERT INTO mastery_learning_evidence VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (path_id, 1, "kp-vertex", now, "quiz", "practice", "correct", 1.0, "", "", "{}"),
    )
    con.execute(
        "INSERT INTO reading_progress VALUES (?,?,?,?,?,?)",
        ("shared-material", 3, 0.3, 8, 0.8, now),
    )
    con.execute(
        "INSERT INTO reading_activities VALUES (?,?,?,?,?,?,?)",
        (f"racc-{path_id}", "shared-material", "summary", "open", 3, "card", now),
    )
    con.commit()
    con.close()


@pytest.mark.asyncio
async def test_sqlite_to_postgres_etl(tmp_path):
    migrate = _load_migrate()
    home_a = tmp_path / "userA"
    home_b = tmp_path / "userB"
    sid_a, sid_b = f"sess-{uuid.uuid4().hex}", f"sess-{uuid.uuid4().hex}"
    pid_a, pid_b = f"path-{uuid.uuid4().hex[:8]}", f"path-{uuid.uuid4().hex[:8]}"
    _build_chat_db(home_a / "chat_history.db", session_id=sid_a, orphan=True)
    _build_chat_db(home_b / "chat_history.db", session_id=sid_b, orphan=False)
    _build_mastery_db(home_a / "workspace/learning/mastery/mastery.sqlite3", path_id=pid_a)
    _build_mastery_db(home_b / "workspace/learning/mastery/mastery.sqlite3", path_id=pid_b)

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    engine = create_async_engine(os.environ["DATABASE_URL"])

    async def owner_counts(owner: str):
        async with engine.connect() as db:
            out = {}
            for table in migrate.ALL_TABLES:
                out[table] = (
                    await db.execute(
                        text(f"SELECT count(*) FROM {table} WHERE owner_user_id=:o"), {"o": owner}
                    )
                ).scalar_one()
            return out

    try:
        # 1. dry-run reports source counts incl. orphans without writing anything.
        dry_a = await migrate.migrate_chat_db(home_a / "chat_history.db", "etl_owner_a", False)
        assert dry_a["sessions"] == 1 and dry_a["turns"] == 1
        assert dry_a["messages"] == 2
        assert dry_a["turn_events"] == 1 and dry_a["skipped_orphan_turns"] == 1
        assert dry_a["skipped_orphan_events"] == 1
        assert dry_a["practice_entries"] == 1 and dry_a["practice_reviews"] == 1
        assert dry_a["assessment_cards"] == 1
        assert dry_a["notebook_categories"] == 1
        assert dry_a["notebook_entry_categories"] == 1
        assert dry_a["notebook_practice_state"] == 1
        assert dry_a["notebook_practice_events"] == 1
        assert dry_a["reading_quiz_pending"] == 1
        assert dry_a["reading_quiz_rewards"] == 1
        assert dry_a["assessment_attempts"] == 1

        # 2. execute both homes (different owners).
        counts_a_chat = await migrate.migrate_chat_db(
            home_a / "chat_history.db", "etl_owner_a", True
        )
        counts_b_chat = await migrate.migrate_chat_db(
            home_b / "chat_history.db", "etl_owner_b", True
        )
        counts_a_m = await migrate.migrate_mastery(
            home_a / "workspace/learning/mastery/mastery.sqlite3", "etl_owner_a", True
        )
        counts_b_m = await migrate.migrate_mastery(
            home_b / "workspace/learning/mastery/mastery.sqlite3", "etl_owner_b", True
        )
        assert counts_a_m["mastery_paths"] == 1 and counts_b_m["mastery_paths"] == 1
        assert counts_a_m["reading_learning_progress"] == 1
        assert counts_a_m["reading_learning_activities"] == 1

        got_a = await owner_counts("etl_owner_a")
        got_b = await owner_counts("etl_owner_b")
        assert got_a["sessions"] == 1 and got_a["turns"] == 1 and got_a["turn_events"] == 1
        assert got_a["practice_entries"] == 1 and got_a["practice_reviews"] == 1
        assert got_a["assessment_cards"] == 1 and got_a["assessment_attempts"] == 1
        assert got_a["notebook_categories"] == 1
        assert got_a["notebook_entry_categories"] == 1
        assert got_a["notebook_practice_state"] == 1
        assert got_a["notebook_practice_events"] == 1
        assert got_a["reading_quiz_pending"] == 1
        assert got_a["reading_quiz_rewards"] == 1
        assert got_b["notebook_categories"] == 1
        assert (
            got_a["mastery_paths"] == 1
            and got_a["mastery_interactions"] == 1
            and got_a["mastery_events"] == 1
        )
        assert got_b["sessions"] == 1 and got_b["mastery_paths"] == 1
        assert got_a["reading_learning_progress"] == 1
        assert got_b["reading_learning_progress"] == 1
        assert got_a["reading_learning_activities"] == 1
        assert got_b["reading_learning_activities"] == 1

        async with engine.connect() as db:
            # completed -> succeeded mapping
            status = (
                await db.execute(text("SELECT status FROM turns WHERE owner_user_id='etl_owner_a'"))
            ).scalar_one()
            assert status == "succeeded"
            # review schedule columns migrated from practice_review_state
            review = (
                await db.execute(
                    text(
                        "SELECT rating, answer, review_count, interval_days, due_at IS NOT NULL AS has_due "
                        "FROM practice_reviews WHERE owner_user_id='etl_owner_a'"
                    )
                )
            ).one()
            assert review.rating == "again" and review.answer == "A"
            assert review.review_count == 1 and review.has_due is True
            card = (
                await db.execute(
                    text("SELECT card_json FROM assessment_cards WHERE owner_user_id='etl_owner_a'")
                )
            ).scalar_one()
            assert card["question"] == "1+1=?" and card["options"]["B"] == "2"
            attempt = (
                await db.execute(
                    text("SELECT attempt_json FROM assessment_attempts WHERE owner_user_id='etl_owner_a'")
                )
            ).scalar_one()
            assert attempt["knowledge_point_id"] == "kp-add"
            # batch audit rows exist per source
            batches = (
                await db.execute(
                    text(
                        "SELECT count(*) FROM migration_batches WHERE owner_user_id='etl_owner_a' "
                        "AND length(checksum_sha256)=64"
                    )
                )
            ).scalar_one()
            assert batches == 2

        # 3. rerun is idempotent: same counts, still one review row.
        await migrate.migrate_chat_db(home_a / "chat_history.db", "etl_owner_a", True)
        await migrate.migrate_mastery(
            home_a / "workspace/learning/mastery/mastery.sqlite3", "etl_owner_a", True
        )
        got_a_again = await owner_counts("etl_owner_a")
        assert got_a_again == got_a

        # A later backup lives at a different path but represents the same
        # source IDs. It must not duplicate practice cards or Mastery events.
        later = tmp_path / "later-backup"
        later_chat = later / "chat_history.db"
        later_mastery = later / "mastery.sqlite3"
        later.mkdir()
        shutil.copy2(home_a / "chat_history.db", later_chat)
        shutil.copy2(home_a / "workspace/learning/mastery/mastery.sqlite3", later_mastery)
        await migrate.migrate_chat_db(later_chat, "etl_owner_a", True)
        await migrate.migrate_mastery(later_mastery, "etl_owner_a", True)
        assert await owner_counts("etl_owner_a") == got_a
    finally:
        # Clean up imported rows so the test is rerunnable on a shared dev DB.
        async with engine.begin() as db:
            for owner in ("etl_owner_a", "etl_owner_b"):
                await db.execute(
                    text("DELETE FROM turn_events WHERE owner_user_id=:o"), {"o": owner}
                )
                await db.execute(
                    text("DELETE FROM mastery_events WHERE owner_user_id=:o"), {"o": owner}
                )
                await db.execute(
                    text("DELETE FROM mastery_interactions WHERE owner_user_id=:o"), {"o": owner}
                )
                await db.execute(
                    text("DELETE FROM practice_reviews WHERE owner_user_id=:o"), {"o": owner}
                )
                await db.execute(
                    text("DELETE FROM practice_entries WHERE owner_user_id=:o"), {"o": owner}
                )
                await db.execute(
                    text("DELETE FROM mastery_paths WHERE owner_user_id=:o"), {"o": owner}
                )
                await db.execute(text("DELETE FROM turns WHERE owner_user_id=:o"), {"o": owner})
                await db.execute(text("DELETE FROM sessions WHERE owner_user_id=:o"), {"o": owner})
                await db.execute(
                    text("DELETE FROM migration_batches WHERE owner_user_id=:o"), {"o": owner}
                )
                await db.execute(
                    text("DELETE FROM subscriptions WHERE owner_user_id=:o"), {"o": owner}
                )
                await db.execute(text("DELETE FROM users WHERE id=:o"), {"o": owner})
        await engine.dispose()
