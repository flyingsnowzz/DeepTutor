"""Persist first-party Mastery topic presentation and source references."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_mastery_topic"
down_revision = "0005_first_party"
branch_labels = None
depends_on = None

TABLES = ("mastery_topic_meta", "mastery_topic_sources")


def upgrade() -> None:
    op.create_table(
        "mastery_topic_meta",
        sa.Column("path_id", sa.String(128), sa.ForeignKey("mastery_paths.path_id", ondelete="CASCADE"), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("goal", sa.Text, nullable=False, server_default=""),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("emoji", sa.String(32), nullable=False, server_default="🧭"),
        sa.Column("map_seed", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "mastery_topic_sources",
        sa.Column("source_id", sa.String(128), primary_key=True),
        sa.Column("path_id", sa.String(128), sa.ForeignKey("mastery_paths.path_id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("external_id", sa.String(255), nullable=False, server_default=""),
        sa.Column("label", sa.Text, nullable=False),
        sa.Column("excerpt", sa.Text, nullable=False, server_default=""),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("available", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("metadata_json", sa.JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_mastery_topic_sources_owner_path", "mastery_topic_sources", ["owner_user_id", "path_id", "position"])
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY owner_isolation ON {table} USING (owner_user_id = current_setting('app.user_id', true)) WITH CHECK (owner_user_id = current_setting('app.user_id', true))"
        )
    op.execute(
        """DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO deeptutor_app;
          END IF;
        END $$;"""
    )


def downgrade() -> None:
    op.drop_table("mastery_topic_sources")
    op.drop_table("mastery_topic_meta")
