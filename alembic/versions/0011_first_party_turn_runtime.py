"""Turn ownership and active-turn constraint for first-party runtime."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0011_turn_runtime"
down_revision = "0010_profiles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("turns", sa.Column("runtime_owner_id", sa.String(255), nullable=False, server_default=""))
    op.add_column("turns", sa.Column("fencing_token", sa.BigInteger, nullable=False, server_default="0"))
    op.create_index(
        "uq_turns_one_active_per_session", "turns", ["session_id"], unique=True,
        postgresql_where=sa.text("status IN ('queued','running','waiting_input')"),
    )


def downgrade() -> None:
    op.drop_index("uq_turns_one_active_per_session", table_name="turns")
    op.drop_column("turns", "fencing_token")
    op.drop_column("turns", "runtime_owner_id")
