"""Owner/workspace-scoped immersive reading catalog state."""

import sqlalchemy as sa
from alembic import op

revision = "0026_reading_catalog"
down_revision = "0025_session_handoff"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reading_catalog_states",
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("workspace_id", sa.String(200), primary_key=True),
        sa.Column("revision", sa.BigInteger, nullable=False),
        sa.Column("state_json", sa.JSON, nullable=False),
    )
    op.execute("ALTER TABLE reading_catalog_states ENABLE ROW LEVEL SECURITY")
    op.execute("""CREATE POLICY owner_isolation ON reading_catalog_states
        USING (owner_user_id = current_setting('app.user_id', true))
        WITH CHECK (owner_user_id = current_setting('app.user_id', true))""")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON reading_catalog_states TO deeptutor_app;
        END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_table("reading_catalog_states")
