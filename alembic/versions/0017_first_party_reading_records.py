"""Owner-scoped Reading learning records from the local Mastery store."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0017_first_party_reading_records"
down_revision = "0016_mastery_path_creator"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reading_learning_progress",
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("material_id", sa.Text, primary_key=True),
        sa.Column("latest_locator", sa.Integer, nullable=False),
        sa.Column("latest_percentage", sa.Float, nullable=False),
        sa.Column("furthest_locator", sa.Integer, nullable=False),
        sa.Column("furthest_percentage", sa.Float, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_reading_learning_progress_owner_updated", "reading_learning_progress",
        ["owner_user_id", "updated_at"],
    )
    op.create_table(
        "reading_learning_activities",
        sa.Column("activity_id", sa.String(128), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("material_id", sa.Text, nullable=False),
        sa.Column("extension_id", sa.String(64), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("locator", sa.Integer, nullable=False),
        sa.Column("result_type", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_reading_learning_activities_owner_recent", "reading_learning_activities",
        ["owner_user_id", "created_at", "activity_id"],
    )
    for table in ("reading_learning_progress", "reading_learning_activities"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"""CREATE POLICY owner_isolation ON {table}
            USING (owner_user_id = current_setting('app.user_id', true))
            WITH CHECK (owner_user_id = current_setting('app.user_id', true))"""
        )
    op.execute(
        """DO $$ BEGIN
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deeptutor_app') THEN
             GRANT SELECT, INSERT, UPDATE, DELETE ON
               reading_learning_progress,reading_learning_activities TO deeptutor_app;
           END IF;
           END $$;"""
    )


def downgrade() -> None:
    op.drop_table("reading_learning_activities")
    op.drop_table("reading_learning_progress")
