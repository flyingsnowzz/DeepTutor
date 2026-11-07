"""Stable usernames for first-party PostgreSQL accounts."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008_usernames"
down_revision = "0007_messages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(255), nullable=True))
    op.create_index(
        "uq_users_username_ci", "users", [sa.text("lower(username)")],
        unique=True, postgresql_where=sa.text("username IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_users_username_ci", table_name="users")
    op.drop_column("users", "username")
