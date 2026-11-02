"""T4 reading sessions, review tasks, hook deliveries and job channel"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0004_media"
down_revision = "0003_auth_quota"
branch_labels = None
depends_on = None


RLS_TABLES = [
    "reading_materials",
    "reading_segments",
    "reading_sessions",
    "reading_messages",
    "review_tasks",
    "hook_deliveries",
]


def upgrade() -> None:
    # Host channel attribution on jobs (workbuddy / qianwen-office / doubao / first-party).
    op.add_column(
        "jobs",
        sa.Column("source_channel", sa.String(48), nullable=False, server_default="first_party"),
    )
    op.create_index("ix_jobs_owner_channel", "jobs", ["owner_user_id", "source_channel"])

    # --- Immersive reading -----------------------------------------------------
    op.create_table(
        "reading_materials",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "owner_user_id",
            sa.String(64),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(32), nullable=False),  # pdf | text | transcript | slides | url
        sa.Column("title", sa.String(512), nullable=False, server_default=""),
        sa.Column("source_artifact_ref", sa.String(64), nullable=True),
        sa.Column("source_uri", sa.Text, nullable=False, server_default=""),
        sa.Column("source_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("status", sa.String(32), nullable=False, server_default="ready"),
        sa.Column("meta_json", sa.JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("segment_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index(
        "ix_reading_materials_owner", "reading_materials", ["owner_user_id", "created_at"]
    )

    op.create_table(
        "reading_segments",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column(
            "owner_user_id",
            sa.String(64),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "material_id",
            sa.String(64),
            sa.ForeignKey("reading_materials.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ordinal", sa.Integer, nullable=False),
        sa.Column("locator_type", sa.String(16), nullable=False),  # page | section | timestamp
        sa.Column("locator_value", sa.String(128), nullable=False, server_default=""),
        sa.Column("locator_label", sa.String(255), nullable=False, server_default=""),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("content_tsv", sa.Text, nullable=True),
    )
    op.create_index("ix_reading_segments_material", "reading_segments", ["material_id", "ordinal"])
    op.create_index(
        "ix_reading_segments_owner", "reading_segments", ["owner_user_id", "material_id"]
    )

    op.create_table(
        "reading_sessions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "owner_user_id",
            sa.String(64),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "material_id",
            sa.String(64),
            sa.ForeignKey("reading_materials.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(512), nullable=False, server_default=""),
        sa.Column("mode", sa.String(32), nullable=False, server_default="study"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index(
        "ix_reading_sessions_owner", "reading_sessions", ["owner_user_id", "updated_at"]
    )

    op.create_table(
        "reading_messages",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column(
            "owner_user_id",
            sa.String(64),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "session_id",
            sa.String(64),
            sa.ForeignKey("reading_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(16), nullable=False),  # user | assistant
        sa.Column("kind", sa.String(24), nullable=False, server_default="question"),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("citations_json", sa.JSON, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_reading_messages_session", "reading_messages", ["session_id", "created_at"])

    # --- Review tasks generated after jobs/hooks -------------------------------
    op.create_table(
        "review_tasks",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "owner_user_id",
            sa.String(64),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(32), nullable=False),  # quiz | summary | revisit
        sa.Column("source_type", sa.String(32), nullable=False),  # job | material | manual
        sa.Column("source_ref", sa.String(128), nullable=False, server_default=""),
        sa.Column("status", sa.String(24), nullable=False, server_default="pending"),
        sa.Column("payload_json", sa.JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("result_json", sa.JSON, nullable=True),
        sa.Column(
            "due_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint(
            "owner_user_id", "source_type", "source_ref", "kind", name="uq_review_tasks_source_kind"
        ),
    )
    op.create_index(
        "ix_review_tasks_owner_due", "review_tasks", ["owner_user_id", "status", "due_at"]
    )

    # --- External host hook deliveries -----------------------------------------
    op.create_table(
        "hook_deliveries",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "owner_user_id",
            sa.String(64),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("channel", sa.String(48), nullable=False, server_default="unknown"),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("source_ref", sa.String(128), nullable=False, server_default=""),
        sa.Column("idempotency_key", sa.String(160), nullable=False),
        sa.Column("payload_json", sa.JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.String(24), nullable=False, server_default="received"),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text, nullable=False, server_default=""),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("idempotency_key", name="uq_hook_deliveries_idempotency"),
    )
    op.create_index("ix_hook_deliveries_owner", "hook_deliveries", ["owner_user_id", "created_at"])
    op.create_index("ix_hook_deliveries_retry", "hook_deliveries", ["status", "next_retry_at"])

    for table in RLS_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY owner_isolation ON {table}
              USING (owner_user_id = current_setting('app.user_id', true))
              WITH CHECK (owner_user_id = current_setting('app.user_id', true))
            """
        )
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO deeptutor_app;
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO deeptutor_app;
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    for table in RLS_TABLES:
        op.execute(f"DROP POLICY IF EXISTS owner_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.drop_table("hook_deliveries")
    op.drop_table("review_tasks")
    op.drop_table("reading_messages")
    op.drop_table("reading_sessions")
    op.drop_table("reading_segments")
    op.drop_table("reading_materials")
    op.drop_index("ix_jobs_owner_channel", table_name="jobs")
    op.drop_column("jobs", "source_channel")
