"""PostgreSQL guardian authorizations for first-party accounts."""

import sqlalchemy as sa
from alembic import op

revision = "0036_guardian_relationships"
down_revision = "0035_user_book_permissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "guardian_relationships",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("guardian_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("learner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("permissions_json", sa.JSON, nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("revocation_reason", sa.String(128), nullable=False, server_default=""),
        sa.CheckConstraint("guardian_user_id <> learner_user_id", name="ck_guardian_distinct_users"),
    )
    op.create_index(
        "uq_active_guardian_pair", "guardian_relationships",
        ["guardian_user_id", "learner_user_id"], unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.execute("ALTER TABLE guardian_relationships ENABLE ROW LEVEL SECURITY")
    op.execute("""CREATE POLICY participant_read ON guardian_relationships FOR SELECT
        USING (guardian_user_id = current_setting('app.user_id', true)
            OR learner_user_id = current_setting('app.user_id', true))""")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_app') THEN
            GRANT SELECT ON guardian_relationships TO deeptutor_app;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_auth') THEN
            GRANT SELECT, INSERT, UPDATE ON guardian_relationships TO deeptutor_auth;
        END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_index("uq_active_guardian_pair", table_name="guardian_relationships")
    op.drop_table("guardian_relationships")
