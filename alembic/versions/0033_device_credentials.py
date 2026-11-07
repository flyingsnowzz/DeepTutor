"""Shared device credential state for learner pairing."""

import sqlalchemy as sa
from alembic import op

revision = "0033_device_credentials"
down_revision = "0032_user_grants"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "device_credential_state",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("records_json", sa.JSON, nullable=False),
        sa.Column("revision", sa.BigInteger, nullable=False),
    )
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE ON device_credential_state TO deeptutor_app;
        END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_table("device_credential_state")
