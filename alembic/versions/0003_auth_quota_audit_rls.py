"""T3 auth credentials, refresh tokens, quota, audit and row-level security"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0003_auth_quota"
down_revision = "0002_platform"
branch_labels = None
depends_on = None


# Every personal table carries owner_user_id. RLS policies compare it against
# the per-transaction GUC app.user_id. The table-owning role (local dev) bypasses
# RLS unless FORCE is set; production connects as the restricted deeptutor_app
# role which is always subject to the policies.
RLS_TABLES = [
    "auth_identities",
    "subscriptions",
    "sessions",
    "turns",
    "turn_events",
    "jobs",
    "artifacts",
    "usage_events",
    "practice_entries",
    "practice_reviews",
    "mastery_paths",
    "mastery_interactions",
    "mastery_events",
    "migration_batches",
    "refresh_tokens",
    "quota_counters",
    "quota_ledger",
    "audit_events",
    "password_credentials",
    "practice_ledger",
]

# Tables the restricted app role may mutate (everything except migration bookkeeping).
GRANT_TABLES = [t for t in RLS_TABLES if t != "migration_batches"] + ["alembic_version"]


def upgrade() -> None:
    # --- Email/password credentials -----------------------------------------
    op.create_table(
        "password_credentials",
        sa.Column(
            "owner_user_id",
            sa.String(64),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_password_credentials_email", "password_credentials", ["email"], unique=True)

    # --- Rotatable, revocable refresh tokens ---------------------------------
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "owner_user_id",
            sa.String(64),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(128), nullable=False),
        sa.Column("replaced_by", sa.String(64), nullable=True),
        sa.Column("user_agent", sa.Text, nullable=False, server_default=""),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_refresh_tokens_hash", "refresh_tokens", ["token_hash"], unique=True)
    op.create_index("ix_refresh_tokens_owner", "refresh_tokens", ["owner_user_id", "created_at"])

    # --- Quota counters (period rollups) and idempotent ledger ---------------
    op.create_table(
        "quota_counters",
        sa.Column(
            "owner_user_id",
            sa.String(64),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("period", sa.String(8), primary_key=True),  # day | month
        sa.Column("period_start", sa.Date, primary_key=True),
        sa.Column("metric", sa.String(48), primary_key=True),
        sa.Column("consumed", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )

    op.create_table(
        "quota_ledger",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "owner_user_id",
            sa.String(64),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("idempotency_key", sa.String(160), nullable=False),
        sa.Column("metric", sa.String(48), nullable=False),
        sa.Column("amount", sa.Integer, nullable=False, server_default="1"),
        sa.Column("job_id", sa.String(64), nullable=True),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("idempotency_key", name="uq_quota_ledger_idempotency_key"),
    )
    op.create_index("ix_quota_ledger_owner_time", "quota_ledger", ["owner_user_id", "created_at"])

    # --- Audit trail ----------------------------------------------------------
    op.create_table(
        "audit_events",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("request_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("owner_user_id", sa.String(64), nullable=True),
        sa.Column("tool", sa.String(64), nullable=False, server_default=""),
        sa.Column("job_id", sa.String(64), nullable=True),
        sa.Column("resource_id", sa.String(128), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="ok"),
        sa.Column("error_code", sa.String(64), nullable=False, server_default=""),
        sa.Column("usage_json", sa.JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("ip", sa.String(64), nullable=False, server_default=""),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_audit_owner_time", "audit_events", ["owner_user_id", "created_at"])
    op.create_index("ix_audit_request", "audit_events", ["request_id"])
    op.create_index("ix_audit_job", "audit_events", ["job_id"])

    # --- Idempotent answer/review ledger (mastery evidence) -------------------
    op.create_table(
        "practice_ledger",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "owner_user_id",
            sa.String(64),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "entry_id",
            sa.String(64),
            sa.ForeignKey("practice_entries.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("request_id", sa.String(128), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),  # check | review
        sa.Column("answer", sa.Text, nullable=False, server_default=""),
        sa.Column("rating", sa.String(16), nullable=False, server_default=""),
        sa.Column("is_correct", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("payload_json", sa.JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("owner_user_id", "request_id", name="uq_practice_ledger_owner_request"),
    )
    op.create_index("ix_practice_ledger_owner", "practice_ledger", ["owner_user_id", "created_at"])
    op.create_index("ix_practice_ledger_entry", "practice_ledger", ["entry_id", "created_at"])

    # --- Row-level security (defense in depth) --------------------------------
    # The application always passes owner predicates; RLS additionally blocks any
    # query that forgets them when connected as the restricted deeptutor_app
    # role. The table-owning role (local dev / migrations) bypasses RLS, and
    # production sets app.user_id per transaction (SET LOCAL). An unset GUC
    # matches nothing, so the restricted role sees zero rows by default.
    for table in RLS_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY owner_isolation ON {table}
              USING (owner_user_id = current_setting('app.user_id', true))
              WITH CHECK (owner_user_id = current_setting('app.user_id', true))
            """
        )

    # Grants are role-guarded: the role is created by deploy/postgres/init SQL
    # or by operators; local dev uses the table-owning role and skips this.
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
    op.drop_table("audit_events")
    op.drop_table("practice_ledger")
    op.drop_table("quota_ledger")
    op.drop_table("quota_counters")
    op.drop_table("refresh_tokens")
    op.drop_table("password_credentials")
