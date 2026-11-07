"""Stable numeric event IDs for the synchronous Mastery API."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0014_mastery_event_sequence"
down_revision = "0013_assessment_cards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "mastery_events",
        sa.Column("event_seq", sa.BigInteger(), sa.Identity(), nullable=False),
    )
    op.create_unique_constraint(
        "uq_mastery_events_event_seq", "mastery_events", ["event_seq"]
    )
    op.execute(
        """DO $$ BEGIN
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deeptutor_app') THEN
             GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO deeptutor_app;
           END IF;
           END $$;"""
    )


def downgrade() -> None:
    op.drop_constraint("uq_mastery_events_event_seq", "mastery_events", type_="unique")
    op.drop_column("mastery_events", "event_seq")
