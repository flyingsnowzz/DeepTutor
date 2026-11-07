"""Remember the session that created a scratch Mastery path."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0016_mastery_path_creator"
down_revision = "0015_mastery_active_interaction"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "mastery_paths",
        sa.Column("owner_session_id", sa.String(128), nullable=False, server_default=""),
    )
    op.create_index(
        "ix_mastery_paths_owner_creator", "mastery_paths",
        ["owner_user_id", "owner_session_id"],
        postgresql_where=sa.text("owner_session_id <> ''"),
    )


def downgrade() -> None:
    op.drop_index("ix_mastery_paths_owner_creator", table_name="mastery_paths")
    op.drop_column("mastery_paths", "owner_session_id")
