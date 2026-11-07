"""Owner-scoped workspace registry and migration metadata."""

import sqlalchemy as sa
from alembic import op

revision = "0027_workspace_catalog"
down_revision = "0026_reading_catalog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_catalog_states",
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision", sa.BigInteger, nullable=False),
        sa.Column("state_json", sa.JSON, nullable=False),
    )
    op.execute("ALTER TABLE workspace_catalog_states ENABLE ROW LEVEL SECURITY")
    op.execute("""CREATE POLICY owner_isolation ON workspace_catalog_states
        USING (owner_user_id = current_setting('app.user_id', true))
        WITH CHECK (owner_user_id = current_setting('app.user_id', true))""")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_catalog_states TO deeptutor_app;
        END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_table("workspace_catalog_states")
