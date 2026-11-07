"""Owner-scoped server answer keys and reading quiz rewards."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0020_reading_quiz"
down_revision = "0019_notebook_practice"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reading_quiz_pending",
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("material_id", sa.Text, primary_key=True),
        sa.Column("locator", sa.Integer, primary_key=True),
        sa.Column("question_id", sa.String(128), primary_key=True),
        sa.Column("question_json", sa.JSON, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "reading_quiz_rewards",
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("material_id", sa.Text, primary_key=True),
        sa.Column("locator", sa.Integer, primary_key=True),
        sa.Column("stars", sa.Integer, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    for table in ("reading_quiz_pending", "reading_quiz_rewards"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"""CREATE POLICY owner_isolation ON {table}
            USING (owner_user_id = current_setting('app.user_id', true))
            WITH CHECK (owner_user_id = current_setting('app.user_id', true))""")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON reading_quiz_pending,reading_quiz_rewards
              TO deeptutor_app;
        END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_table("reading_quiz_rewards")
    op.drop_table("reading_quiz_pending")
