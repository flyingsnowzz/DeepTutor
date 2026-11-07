"""Owner-scoped spaced-review state and idempotent review/import records."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0019_notebook_practice"
down_revision = "0018_notebook_categories"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notebook_practice_state",
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("entry_id", sa.BigInteger, primary_key=True),
        sa.Column("is_mistake", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("first_wrong_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("interval_days", sa.Float, nullable=False, server_default="1"),
        sa.Column("ease", sa.Float, nullable=False, server_default="2.5"),
        sa.Column("streak", sa.Integer, nullable=False, server_default="0"),
        sa.Column("lapses", sa.Integer, nullable=False, server_default="0"),
        sa.Column("review_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_review_at", sa.DateTime(timezone=True)),
        sa.Column("version", sa.Integer, nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["entry_id", "owner_user_id"], ["assessment_cards.id", "assessment_cards.owner_user_id"], ondelete="CASCADE"),
    )
    op.create_index("ix_notebook_practice_owner_due", "notebook_practice_state", ["owner_user_id", "due_at"])
    op.create_table(
        "notebook_practice_events",
        sa.Column("request_id", sa.String(100), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entry_id", sa.BigInteger, nullable=False),
        sa.Column("rating", sa.String(16), nullable=False),
        sa.Column("answer", sa.Text, nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("outcome_json", sa.JSON, nullable=False),
        sa.ForeignKeyConstraint(["entry_id", "owner_user_id"], ["assessment_cards.id", "assessment_cards.owner_user_id"], ondelete="CASCADE"),
    )
    op.create_index("ix_notebook_practice_events_owner_entry", "notebook_practice_events", ["owner_user_id", "entry_id", "reviewed_at"])
    op.create_table(
        "notebook_practice_imports",
        sa.Column("token", sa.String(32), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.String(200), nullable=False),
        sa.Column("target", sa.String(16), nullable=False),
        sa.Column("payload_json", sa.JSON, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("result_json", sa.JSON),
    )
    for table in ("notebook_practice_state", "notebook_practice_events", "notebook_practice_imports"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"""CREATE POLICY owner_isolation ON {table}
            USING (owner_user_id = current_setting('app.user_id', true))
            WITH CHECK (owner_user_id = current_setting('app.user_id', true))""")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON
              notebook_practice_state,notebook_practice_events,notebook_practice_imports
              TO deeptutor_app;
        END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_table("notebook_practice_imports")
    op.drop_table("notebook_practice_events")
    op.drop_table("notebook_practice_state")
