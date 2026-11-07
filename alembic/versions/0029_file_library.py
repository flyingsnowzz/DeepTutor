"""Owner-scoped file library metadata."""

import sqlalchemy as sa
from alembic import op

revision = "0029_file_library"
down_revision = "0028_partner_runtime_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "library_files_pg",
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("filename", sa.Text, nullable=False),
        sa.Column("mime_type", sa.Text, nullable=False),
        sa.Column("size_bytes", sa.BigInteger, nullable=False),
        sa.Column("library_path", sa.Text, nullable=False),
        sa.Column("created_at", sa.Float, nullable=False),
        sa.Column("updated_at", sa.Float, nullable=False),
        sa.Column("is_deleted", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.Float),
    )
    op.create_index("uq_library_owner_active_hash", "library_files_pg", ["owner_user_id", "sha256"],
                    unique=True, postgresql_where=sa.text("is_deleted = false"))
    op.execute("ALTER TABLE library_files_pg ENABLE ROW LEVEL SECURITY")
    op.execute("""CREATE POLICY owner_isolation ON library_files_pg
        USING (owner_user_id = current_setting('app.user_id', true))
        WITH CHECK (owner_user_id = current_setting('app.user_id', true))""")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON library_files_pg TO deeptutor_app;
        END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_index("uq_library_owner_active_hash", table_name="library_files_pg")
    op.drop_table("library_files_pg")
