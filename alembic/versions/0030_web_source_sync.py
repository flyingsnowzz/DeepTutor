"""Shared durable web source scheduler state."""

import sqlalchemy as sa
from alembic import op

revision = "0030_web_source_sync"
down_revision = "0029_file_library"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "web_source_sync_state",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("sqlite_image", sa.LargeBinary, nullable=False),
        sa.Column("revision", sa.BigInteger, nullable=False, server_default="0"),
    )
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE ON web_source_sync_state TO deeptutor_app;
        END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_table("web_source_sync_state")
