"""Platform accounts, sessions, practice and mastery state"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0002_platform"
down_revision = "0001_mcp_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # T1 created a small mcp_dev_users stub. T2 introduces the real account model.
    op.execute("DROP TABLE IF EXISTS usage_events")
    op.execute("DROP TABLE IF EXISTS artifacts")
    op.execute("DROP TABLE IF EXISTS jobs")
    op.execute("DROP TABLE IF EXISTS mcp_dev_users")

    op.create_table(
        "users",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("display_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "auth_identities",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("provider", "subject", name="uq_auth_identities_provider_subject"),
    )
    op.create_index("ix_auth_identities_owner", "auth_identities", ["owner_user_id"])

    op.create_table(
        "subscriptions",
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("plan", sa.String(32), nullable=False, server_default="free"),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )

    # Sessions / turns / events
    op.create_table(
        "sessions",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(512), nullable=False, server_default="New conversation"),
        sa.Column("compressed_summary", sa.Text, nullable=False, server_default=""),
        sa.Column("summary_up_to_message_id", sa.BigInteger, nullable=True),
        sa.Column(
            "preferences_json", sa.JSON, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_sessions_owner_updated", "sessions", ["owner_user_id", "updated_at"])
    op.create_index("ix_sessions_owner_deleted", "sessions", ["owner_user_id", "deleted_at"])

    op.create_table(
        "turns",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "session_id",
            sa.String(128),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("capability", sa.String(64), nullable=False, server_default="chat"),
        sa.Column("status", sa.String(32), nullable=False, server_default="running"),
        sa.Column("error", sa.Text, nullable=False, server_default=""),
        sa.Column("failure_code", sa.String(64), nullable=False, server_default=""),
        sa.Column("retryable", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("state_version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("assistant_message_id", sa.BigInteger, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_turns_owner_updated", "turns", ["owner_user_id", "updated_at"])
    op.create_index("ix_turns_session_updated", "turns", ["session_id", "updated_at"])

    op.create_table(
        "turn_events",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "turn_id", sa.String(128), sa.ForeignKey("turns.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("seq", sa.Integer, nullable=False),
        sa.Column("type", sa.String(64), nullable=False),
        sa.Column("source", sa.String(64), nullable=False, server_default=""),
        sa.Column("stage", sa.String(64), nullable=False, server_default=""),
        sa.Column("content", sa.Text, nullable=False, server_default=""),
        sa.Column("metadata_json", sa.JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("turn_id", "seq", name="uq_turn_events_turn_seq"),
    )
    op.create_index("ix_turn_events_owner_time", "turn_events", ["owner_user_id", "created_at"])
    op.create_index("ix_turn_events_turn_seq", "turn_events", ["turn_id", "seq"])

    # MCP jobs / artifacts / usage, now referencing real users.
    op.create_table(
        "jobs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("session_id", sa.String(128), nullable=False),
        sa.Column("capability", sa.String(64), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("input_json", sa.JSON, nullable=False),
        sa.Column("result_json", sa.JSON, nullable=True),
        sa.Column("error_json", sa.JSON, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "owner_user_id", "idempotency_key", name="uq_jobs_owner_idempotency_key"
        ),
    )
    op.create_index("ix_jobs_owner_updated", "jobs", ["owner_user_id", "updated_at"])
    op.create_index("ix_jobs_owner_status", "jobs", ["owner_user_id", "status"])

    op.create_table(
        "artifacts",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("job_id", sa.String(64), sa.ForeignKey("jobs.id"), nullable=True),
        sa.Column("object_key", sa.Text, nullable=False),
        sa.Column("bucket", sa.String(255), nullable=False),
        sa.Column("kind", sa.String(64), nullable=False),
        sa.Column("mime_type", sa.String(255), nullable=False),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("size_bytes", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_artifacts_owner", "artifacts", ["owner_user_id", "created_at"])
    op.create_index("ix_artifacts_job", "artifacts", ["job_id"])

    op.create_table(
        "usage_events",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("job_id", sa.String(64), nullable=True),
        sa.Column("capability", sa.String(64), nullable=False),
        sa.Column("provider", sa.String(128), nullable=True),
        sa.Column("model", sa.String(255), nullable=True),
        sa.Column("prompt_tokens", sa.Integer, nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer, nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Numeric(12, 6), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_usage_owner_time", "usage_events", ["owner_user_id", "created_at"])

    # Practice question bank / review schedule.
    op.create_table(
        "practice_entries",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("session_id", sa.String(128), nullable=True),
        sa.Column("origin_type", sa.String(64), nullable=False, server_default="conversation"),
        sa.Column("origin_ref", sa.String(255), nullable=False, server_default=""),
        sa.Column("question_id", sa.String(128), nullable=False),
        sa.Column("question", sa.Text, nullable=False),
        sa.Column("question_type", sa.String(64), nullable=False, server_default=""),
        sa.Column("options_json", sa.JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("correct_answer", sa.Text, nullable=False, server_default=""),
        sa.Column("explanation", sa.Text, nullable=False, server_default=""),
        sa.Column("difficulty", sa.String(32), nullable=False, server_default=""),
        sa.Column("user_answer", sa.Text, nullable=False, server_default=""),
        sa.Column("source", sa.String(64), nullable=False, server_default="deep_question"),
        sa.Column("mastery_path_id", sa.String(128), nullable=True),
        sa.Column("knowledge_point_id", sa.String(128), nullable=True),
        sa.Column("is_correct", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("resolved", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("bookmarked", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("attempt_count", sa.Integer, nullable=False, server_default="1"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index(
        "ix_practice_entries_owner_updated", "practice_entries", ["owner_user_id", "updated_at"]
    )
    op.create_index(
        "ix_practice_entries_owner_bookmark",
        "practice_entries",
        ["owner_user_id", "bookmarked", "updated_at"],
    )
    op.create_index(
        "ix_practice_entries_owner_source",
        "practice_entries",
        ["owner_user_id", "source", "resolved", "updated_at"],
    )

    op.create_table(
        "practice_reviews",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "entry_id",
            sa.String(64),
            sa.ForeignKey("practice_entries.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("request_id", sa.String(128), nullable=False),
        sa.Column("rating", sa.String(32), nullable=False),
        sa.Column("answer", sa.Text, nullable=False, server_default=""),
        sa.Column("is_mistake", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("first_wrong_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("interval_days", sa.Float, nullable=False, server_default="1"),
        sa.Column("ease", sa.Float, nullable=False, server_default="2.5"),
        sa.Column("streak", sa.Integer, nullable=False, server_default="0"),
        sa.Column("lapses", sa.Integer, nullable=False, server_default="0"),
        sa.Column("review_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_review_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint(
            "owner_user_id", "request_id", name="uq_practice_reviews_owner_request"
        ),
    )
    op.create_index(
        "ix_practice_reviews_owner_due", "practice_reviews", ["owner_user_id", "due_at"]
    )
    op.create_index("ix_practice_reviews_entry", "practice_reviews", ["entry_id", "updated_at"])

    # Mastery learning state. state_json intentionally stores the aggregate snapshot
    # while normalized tables hold queryable evidence/interactions.
    op.create_table(
        "mastery_paths",
        sa.Column("path_id", sa.String(128), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("revision", sa.Integer, nullable=False, server_default="1"),
        sa.Column("state_json", sa.JSON, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index(
        "ix_mastery_paths_owner_updated", "mastery_paths", ["owner_user_id", "updated_at"]
    )

    op.create_table(
        "mastery_interactions",
        sa.Column("interaction_id", sa.String(128), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "path_id",
            sa.String(128),
            sa.ForeignKey("mastery_paths.path_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("question_json", sa.JSON, nullable=False),
        sa.Column("session_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("turn_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("user_answer", sa.Text, nullable=False, server_default=""),
        sa.Column("result_json", sa.JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index(
        "ix_mastery_interactions_owner_path",
        "mastery_interactions",
        ["owner_user_id", "path_id", "updated_at"],
    )

    op.create_table(
        "mastery_events",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "path_id",
            sa.String(128),
            sa.ForeignKey("mastery_paths.path_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer, nullable=False),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("payload_json", sa.JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("session_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("turn_id", sa.String(128), nullable=False, server_default=""),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index(
        "ix_mastery_events_owner_path",
        "mastery_events",
        ["owner_user_id", "path_id", "revision", "id"],
    )

    # One-time SQLite -> Postgres ETL bookkeeping: one row per (owner, source path),
    # refreshed on every rerun so operators can audit what was imported and when.
    op.create_table(
        "migration_batches",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("source_kind", sa.String(32), nullable=False),
        sa.Column("source_path", sa.Text, nullable=False),
        sa.Column("checksum_sha256", sa.String(64), nullable=False),
        sa.Column("counts_json", sa.JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "executed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint(
            "owner_user_id", "source_path", name="uq_migration_batches_owner_source"
        ),
    )
    op.create_index(
        "ix_migration_batches_owner", "migration_batches", ["owner_user_id", "executed_at"]
    )


def downgrade() -> None:
    # Drop every table introduced/rebuilt by this revision (children first, so
    # foreign keys resolve cleanly), then recreate the exact 0001 schema so the
    # 0001 downgrade and re-upgrade paths stay consistent.
    for name in [
        "migration_batches",
        "mastery_events",
        "mastery_interactions",
        "mastery_paths",
        "practice_reviews",
        "practice_entries",
        "turn_events",
        "turns",
        "sessions",
        "artifacts",
        "jobs",
        "usage_events",
        "subscriptions",
        "auth_identities",
        "users",
    ]:
        op.execute(f"DROP TABLE IF EXISTS {name}")  # nosec - internal allowlist

    revision_0001 = op.get_context().script.get_revision("0001_mcp_jobs").module
    revision_0001.upgrade()
