"""First-party user profile fields in PostgreSQL."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010_profiles"
down_revision = "0009_first_party_credentials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("role", sa.String(16), nullable=False, server_default="user"))
    op.add_column("users", sa.Column("preset", sa.String(16), nullable=False, server_default="standard"))
    op.add_column("users", sa.Column("avatar", sa.String(128), nullable=False, server_default=""))
    op.add_column("users", sa.Column("learner_profile_json", sa.JSON, nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.create_check_constraint("ck_users_non_admin_role", "users", "role IN ('user','student','teacher')")
    op.create_check_constraint("ck_users_preset", "users", "preset IN ('standard','learner','custom')")


def downgrade() -> None:
    op.drop_constraint("ck_users_preset", "users", type_="check")
    op.drop_constraint("ck_users_non_admin_role", "users", type_="check")
    for column in ("learner_profile_json", "avatar", "preset", "role"):
        op.drop_column("users", column)
