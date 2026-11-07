"""Shared audit trail for account and resource actions."""

import sqlalchemy as sa
from alembic import op

revision = "0031_account_audit"
down_revision = "0030_web_source_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "account_audit_events",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("actor_id", sa.String(64), nullable=False),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("target_user_id", sa.String(64)),
        sa.Column("payload_json", sa.JSON, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_account_audit_actor_time", "account_audit_events", ["actor_id", "created_at"])
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_app') THEN
            GRANT SELECT, INSERT ON account_audit_events TO deeptutor_app;
            GRANT USAGE, SELECT ON SEQUENCE account_audit_events_id_seq TO deeptutor_app;
        END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_index("ix_account_audit_actor_time", table_name="account_audit_events")
    op.drop_table("account_audit_events")
