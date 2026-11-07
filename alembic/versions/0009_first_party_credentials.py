"""Password credentials for first-party username accounts."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009_first_party_credentials"
down_revision = "0008_usernames"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "first_party_credentials",
        sa.Column(
            "owner_user_id", sa.String(64),
            sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True,
        ),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.execute("ALTER TABLE first_party_credentials ENABLE ROW LEVEL SECURITY")
    op.execute(
        """CREATE POLICY owner_isolation ON first_party_credentials
             USING (owner_user_id = current_setting('app.user_id', true))
             WITH CHECK (owner_user_id = current_setting('app.user_id', true))"""
    )
    op.execute(
        """DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON first_party_credentials TO deeptutor_app;
          END IF;
        END $$;"""
    )


def downgrade() -> None:
    op.drop_table("first_party_credentials")
