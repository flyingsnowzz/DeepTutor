"""Durable first-party assessment card projection and attempt linkage."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013_assessment_cards"
down_revision = "0012_turn_submissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assessment_cards",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_id", sa.String(128)),
        sa.Column("origin_type", sa.String(64), nullable=False),
        sa.Column("origin_ref", sa.String(255), nullable=False),
        sa.Column("turn_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("question_id", sa.String(128), nullable=False),
        sa.Column("card_json", sa.JSON, nullable=False),
        sa.Column("latest_attempt_id", sa.String(128)),
        sa.Column("latest_attempt_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "owner_user_id", "origin_type", "origin_ref", "turn_id", "question_id",
            name="uq_assessment_cards_owner_question",
        ),
    )
    op.create_index(
        "ix_assessment_cards_owner_session", "assessment_cards",
        ["owner_user_id", "session_id", "updated_at"],
    )
    op.add_column("assessment_attempts", sa.Column("card_id", sa.BigInteger, sa.ForeignKey("assessment_cards.id", ondelete="SET NULL")))
    op.execute("ALTER TABLE assessment_cards ENABLE ROW LEVEL SECURITY")
    op.execute(
        """CREATE POLICY owner_isolation ON assessment_cards
           USING (owner_user_id = current_setting('app.user_id', true))
           WITH CHECK (owner_user_id = current_setting('app.user_id', true))"""
    )
    op.execute(
        """DO $$ BEGIN
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deeptutor_app') THEN
             GRANT SELECT, INSERT, UPDATE, DELETE ON assessment_cards TO deeptutor_app;
             GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO deeptutor_app;
           END IF;
           END $$;"""
    )


def downgrade() -> None:
    op.drop_column("assessment_attempts", "card_id")
    op.drop_table("assessment_cards")
