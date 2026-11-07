"""Process-wide scheduled jobs and revision in PostgreSQL."""

import sqlalchemy as sa
from alembic import op

revision = "0024_cron_jobs"
down_revision = "0023_calendar_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scheduled_jobs",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("owner_key", sa.Text, nullable=False),
        sa.Column("next_run_at_ms", sa.BigInteger),
        sa.Column("payload_json", sa.JSON, nullable=False),
        sa.Column("updated_at_ms", sa.BigInteger, nullable=False),
    )
    op.create_index("ix_scheduled_jobs_owner", "scheduled_jobs", ["owner_key"])
    op.create_table(
        "scheduled_jobs_meta",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("revision", sa.BigInteger, nullable=False),
    )
    op.execute("INSERT INTO scheduled_jobs_meta(id,revision) VALUES (1,0)")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_jobs,scheduled_jobs_meta TO deeptutor_app;
        END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_table("scheduled_jobs_meta")
    op.drop_index("ix_scheduled_jobs_owner", table_name="scheduled_jobs")
    op.drop_table("scheduled_jobs")
