"""First-party account and learning persistence foundation."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005_first_party"
down_revision = "0004_media"
branch_labels = None
depends_on = None

OWNER_TABLES = (
    "mastery_path_sessions",
    "mastery_path_leases",
    "mastery_learning_evidence",
    "assessment_attempts",
)


def _owner() -> sa.Column:
    return sa.Column(
        "owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )


def upgrade() -> None:
    # Admin credentials deliberately do not share password_credentials or the
    # ordinary-user login namespace. Bootstrap is performed by the application.
    op.create_table(
        "admin_accounts",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("username", sa.String(255), nullable=False, unique=True),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("is_superadmin", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_by_admin_id", sa.String(64), sa.ForeignKey("admin_accounts.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "uq_admin_accounts_one_superadmin", "admin_accounts", ["is_superadmin"],
        unique=True, postgresql_where=sa.text("is_superadmin"),
    )

    op.create_table(
        "mastery_path_sessions",
        _owner(),
        sa.Column("path_id", sa.String(128), sa.ForeignKey("mastery_paths.path_id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_id", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("owner_user_id", "path_id", "session_id"),
        sa.UniqueConstraint("owner_user_id", "session_id", name="uq_mastery_path_sessions_owner_session"),
    )
    op.create_table(
        "mastery_path_leases",
        _owner(),
        sa.Column("path_id", sa.String(128), sa.ForeignKey("mastery_paths.path_id", ondelete="CASCADE"), primary_key=True),
        sa.Column("session_id", sa.String(128), nullable=False),
        sa.Column("turn_id", sa.String(128), nullable=False, unique=True),
        sa.Column("acquired_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "mastery_learning_evidence",
        _owner(),
        sa.Column("path_id", sa.String(128), sa.ForeignKey("mastery_paths.path_id", ondelete="CASCADE"), nullable=False),
        sa.Column("ordinal", sa.Integer, nullable=False),
        sa.Column("knowledge_point_id", sa.String(128), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(64), nullable=False),
        sa.Column("assessment_type", sa.String(64), nullable=False),
        sa.Column("result", sa.String(64), nullable=False),
        sa.Column("quality", sa.Float),
        sa.Column("session_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("turn_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("evidence_json", sa.JSON, nullable=False),
        sa.PrimaryKeyConstraint("path_id", "ordinal"),
    )
    op.create_index("ix_mastery_evidence_owner_kp_time", "mastery_learning_evidence", ["owner_user_id", "path_id", "knowledge_point_id", "timestamp"])
    op.create_table(
        "assessment_attempts",
        sa.Column("id", sa.String(128), primary_key=True),
        _owner(),
        sa.Column("session_id", sa.String(128), nullable=False),
        sa.Column("path_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("knowledge_point_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("attempt_json", sa.JSON, nullable=False),
        sa.Column("linked_applied", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("owner_user_id", "id", name="uq_assessment_attempts_owner_id"),
    )
    op.create_index("ix_assessment_attempts_owner_session", "assessment_attempts", ["owner_user_id", "session_id", "created_at"])

    for table in OWNER_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY owner_isolation ON {table} USING (owner_user_id = current_setting('app.user_id', true)) WITH CHECK (owner_user_id = current_setting('app.user_id', true))"
        )
    op.execute(
        """DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO deeptutor_app;
          END IF;
        END $$;"""
    )


def downgrade() -> None:
    for table in reversed(OWNER_TABLES):
        op.drop_table(table)
    op.drop_index("uq_admin_accounts_one_superadmin", table_name="admin_accounts")
    op.drop_table("admin_accounts")
