"""Durable per-owner LLM call ledger."""

import sqlalchemy as sa
from alembic import op

revision = "0021_llm_usage_ledger"
down_revision = "0020_reading_quiz"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_call_ledger",
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("call_id", sa.Text, primary_key=True),
        sa.Column("started_at", sa.Float, nullable=False),
        sa.Column("session_id", sa.Text, nullable=False),
        sa.Column("turn_id", sa.Text, nullable=False),
        sa.Column("source", sa.Text, nullable=False),
        sa.Column("usage_json", sa.JSON, nullable=False),
    )
    op.create_index("ix_llm_call_ledger_owner_time", "llm_call_ledger", ["owner_user_id", "started_at", "call_id"])
    op.execute("ALTER TABLE llm_call_ledger ENABLE ROW LEVEL SECURITY")
    op.execute("""CREATE POLICY owner_isolation ON llm_call_ledger
        USING (owner_user_id = current_setting('app.user_id', true))
        WITH CHECK (owner_user_id = current_setting('app.user_id', true))""")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON llm_call_ledger TO deeptutor_app;
        END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_index("ix_llm_call_ledger_owner_time", table_name="llm_call_ledger")
    op.drop_table("llm_call_ledger")
