"""Owner-scoped task board snapshots."""

import sqlalchemy as sa
from alembic import op

revision = "0022_task_board"
down_revision = "0021_llm_usage_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_boards",
        sa.Column("owner_user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision", sa.Integer, nullable=False),
        sa.Column("board_json", sa.JSON, nullable=False),
    )
    op.execute("ALTER TABLE task_boards ENABLE ROW LEVEL SECURITY")
    op.execute("""CREATE POLICY owner_isolation ON task_boards
        USING (owner_user_id = current_setting('app.user_id', true))
        WITH CHECK (owner_user_id = current_setting('app.user_id', true))""")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='deeptutor_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON task_boards TO deeptutor_app;
        END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_table("task_boards")
