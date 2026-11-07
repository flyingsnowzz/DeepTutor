"""Keep one active Mastery interaction per path under concurrent writers."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0015_mastery_active_interaction"
down_revision = "0014_mastery_event_sequence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "uq_mastery_one_active_interaction",
        "mastery_interactions",
        ["path_id"],
        unique=True,
        postgresql_where=sa.text(
            "status IN ('registered', 'awaiting_input', 'answered')"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_mastery_one_active_interaction", table_name="mastery_interactions")
