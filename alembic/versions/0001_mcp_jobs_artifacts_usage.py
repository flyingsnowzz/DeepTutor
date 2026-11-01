"""T1 MCP jobs, artifacts and usage events"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0001_mcp_jobs"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mcp_dev_users",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("display_name", sa.String(255), nullable=False, server_default="Local Dev User"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )

    op.create_table(
        "jobs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), nullable=False),
        sa.Column("session_id", sa.String(64), nullable=False),
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
        sa.Column("owner_user_id", sa.String(64), nullable=False),
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
        sa.Column("owner_user_id", sa.String(64), nullable=False),
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


def downgrade() -> None:
    op.drop_index("ix_usage_owner_time", table_name="usage_events")
    op.drop_table("usage_events")
    op.drop_index("ix_artifacts_job", table_name="artifacts")
    op.drop_index("ix_artifacts_owner", table_name="artifacts")
    op.drop_table("artifacts")
    op.drop_index("ix_jobs_owner_status", table_name="jobs")
    op.drop_index("ix_jobs_owner_updated", table_name="jobs")
    op.drop_table("jobs")
    op.drop_table("mcp_dev_users")
