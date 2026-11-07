"""Shared, credential-free partner runtime status."""

import sqlalchemy as sa
from alembic import op

revision = "0028_partner_runtime_status"
down_revision = "0027_workspace_catalog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "partner_runtime_status",
        sa.Column("partner_id", sa.String(128), primary_key=True),
        sa.Column("owner_id", sa.String(128), nullable=False),
        sa.Column("payload", sa.JSON, nullable=False),
        sa.Column("updated_at", sa.Float, nullable=False),
    )
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON partner_runtime_status TO deeptutor_app;
        END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_table("partner_runtime_status")
