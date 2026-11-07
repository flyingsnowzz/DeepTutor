"""Owner-scoped MarginNote 4 sync images and device-token lookup."""

import sqlalchemy as sa
from alembic import op

revision = "0034_marginnote4_state"
down_revision = "0033_device_credentials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "marginnote4_states",
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("kb_name", sa.String(256), primary_key=True),
        sa.Column("sqlite_image", sa.LargeBinary, nullable=False),
        sa.Column("revision", sa.BigInteger, nullable=False, server_default="0"),
    )
    op.execute("ALTER TABLE marginnote4_states ENABLE ROW LEVEL SECURITY")
    op.execute("""CREATE POLICY owner_isolation ON marginnote4_states
        USING (owner_user_id = current_setting('app.user_id', true))
        WITH CHECK (owner_user_id = current_setting('app.user_id', true))""")
    op.create_table(
        "marginnote4_device_index",
        sa.Column("device_id", sa.String(64), primary_key=True),
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kb_name", sa.String(256), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.ForeignKeyConstraint(
            ["owner_user_id", "kb_name"],
            ["marginnote4_states.owner_user_id", "marginnote4_states.kb_name"],
            ondelete="CASCADE",
        ),
    )
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE ON marginnote4_states TO deeptutor_app;
            REVOKE ALL ON marginnote4_device_index FROM deeptutor_app;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_auth') THEN
            GRANT SELECT, INSERT, UPDATE ON marginnote4_device_index TO deeptutor_auth;
        END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_table("marginnote4_device_index")
    op.drop_table("marginnote4_states")
