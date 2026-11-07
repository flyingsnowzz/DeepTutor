"""Owner-scoped idempotency reservations for first-party turns."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0012_turn_submissions"
down_revision = "0011_turn_runtime"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "turn_submissions",
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_submission_id", sa.String(128), nullable=False),
        sa.Column("workspace_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("request_digest", sa.String(128), nullable=False),
        sa.Column("session_id", sa.String(128), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("turn_id", sa.String(128), sa.ForeignKey("turns.id", ondelete="SET NULL")),
        sa.Column("superseded_by", sa.String(128)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("owner_user_id", "client_submission_id"),
    )
    op.create_index("ix_turn_submissions_owner_session", "turn_submissions", ["owner_user_id", "session_id"])
    op.execute("ALTER TABLE turn_submissions ENABLE ROW LEVEL SECURITY")
    op.execute(
        """CREATE POLICY owner_isolation ON turn_submissions
           USING (owner_user_id = current_setting('app.user_id', true))
           WITH CHECK (owner_user_id = current_setting('app.user_id', true))"""
    )
    op.execute(
        """DO $$ BEGIN
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deeptutor_app') THEN
             GRANT SELECT, INSERT, UPDATE, DELETE ON turn_submissions TO deeptutor_app;
           END IF;
           END $$;"""
    )


def downgrade() -> None:
    op.drop_table("turn_submissions")
