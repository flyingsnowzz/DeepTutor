"""Owner-scoped shared-book permissions for PostgreSQL accounts."""

import sqlalchemy as sa
from alembic import op

revision = "0035_user_book_permissions"
down_revision = "0034_marginnote4_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_book_permissions",
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("permission_json", sa.JSON, nullable=False),
    )
    op.execute("ALTER TABLE user_book_permissions ENABLE ROW LEVEL SECURITY")
    op.execute("""CREATE POLICY owner_isolation ON user_book_permissions
        USING (owner_user_id = current_setting('app.user_id', true))
        WITH CHECK (owner_user_id = current_setting('app.user_id', true))""")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON user_book_permissions TO deeptutor_app;
        END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_table("user_book_permissions")
