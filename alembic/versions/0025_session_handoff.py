"""Shared short-lived session handoff secrets and rate buckets."""

import sqlalchemy as sa
from alembic import op

revision = "0025_session_handoff"
down_revision = "0024_cron_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "session_handoff_records",
        sa.Column("code_hash", sa.String(64), primary_key=True),
        sa.Column("ticket_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("encrypted_ticket", sa.Text, nullable=False),
        sa.Column("public_host", sa.Text, nullable=False),
        sa.Column("expires_at", sa.BigInteger, nullable=False),
        sa.Column("code_consumed_at", sa.BigInteger),
        sa.Column("ticket_consumed_at", sa.BigInteger),
        sa.Column("failed_attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.BigInteger, nullable=False),
    )
    op.create_index("ix_session_handoff_expiry", "session_handoff_records", ["expires_at"])
    op.create_table(
        "session_handoff_rate_limits",
        sa.Column("bucket", sa.Text, primary_key=True),
        sa.Column("window_start", sa.BigInteger, nullable=False),
        sa.Column("count", sa.Integer, nullable=False),
    )
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON
                session_handoff_records,session_handoff_rate_limits TO deeptutor_app;
        END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_table("session_handoff_rate_limits")
    op.drop_index("ix_session_handoff_expiry", table_name="session_handoff_records")
    op.drop_table("session_handoff_records")
