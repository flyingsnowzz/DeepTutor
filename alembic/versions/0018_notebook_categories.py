"""Owner-scoped question notebook categories and card links."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0018_notebook_categories"
down_revision = "0017_first_party_reading_records"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint("uq_assessment_cards_owner_id", "assessment_cards", ["id", "owner_user_id"])
    op.create_table(
        "notebook_categories",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("id", "owner_user_id", name="uq_notebook_category_owner_id"),
    )
    op.execute("CREATE UNIQUE INDEX uq_notebook_categories_owner_name_ci ON notebook_categories (owner_user_id, lower(name))")
    op.create_table(
        "notebook_entry_categories",
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("entry_id", sa.BigInteger, primary_key=True),
        sa.Column("category_id", sa.BigInteger, primary_key=True),
        sa.ForeignKeyConstraint(["category_id", "owner_user_id"], ["notebook_categories.id", "notebook_categories.owner_user_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["entry_id", "owner_user_id"], ["assessment_cards.id", "assessment_cards.owner_user_id"], ondelete="CASCADE"),
    )
    op.create_index("ix_notebook_entry_categories_owner_category", "notebook_entry_categories", ["owner_user_id", "category_id"])
    for table in ("notebook_categories", "notebook_entry_categories"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"""CREATE POLICY owner_isolation ON {table}
                USING (owner_user_id = current_setting('app.user_id', true))
                WITH CHECK (owner_user_id = current_setting('app.user_id', true))"""
        )
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON notebook_categories, notebook_entry_categories TO deeptutor_app;
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO deeptutor_app;
        END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_table("notebook_entry_categories")
    op.drop_table("notebook_categories")
    op.drop_constraint("uq_assessment_cards_owner_id", "assessment_cards", type_="unique")
