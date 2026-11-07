"""Owner-scoped chat messages and legacy id mapping."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007_messages"
down_revision = "0006_mastery_topic"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "messages",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("legacy_message_id", sa.BigInteger, nullable=True),
        sa.Column("session_id", sa.String(128), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("content", sa.Text, nullable=False, server_default=""),
        sa.Column("capability", sa.String(64), nullable=False, server_default=""),
        sa.Column("events_json", sa.JSON, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("attachments_json", sa.JSON, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("metadata_json", sa.JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("parent_message_id", sa.BigInteger, sa.ForeignKey("messages.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("owner_user_id", "legacy_message_id", name="uq_messages_owner_legacy_id"),
    )
    op.create_index("ix_messages_owner_session_created", "messages", ["owner_user_id", "session_id", "created_at", "id"])
    op.create_index("ix_messages_owner_parent", "messages", ["owner_user_id", "parent_message_id"])
    op.execute("ALTER TABLE messages ENABLE ROW LEVEL SECURITY")
    op.execute(
        """CREATE POLICY owner_isolation ON messages
             USING (owner_user_id = current_setting('app.user_id', true))
             WITH CHECK (owner_user_id = current_setting('app.user_id', true))"""
    )
    op.execute(
        """DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO deeptutor_app;
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO deeptutor_app;
          END IF;
        END $$;"""
    )


def downgrade() -> None:
    op.drop_table("messages")
