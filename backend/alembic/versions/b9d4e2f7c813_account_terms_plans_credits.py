"""account deletion tombstones, terms acceptance, user plans, credit ledger detail

Revision ID: b9d4e2f7c813
Revises: a7c3e5f19b62
Create Date: 2026-10-24

Additive only; nothing is backfilled. Existing users keep NULL terms columns (they are
prompted in the app) and get no user_plans row (they resolve to the default plan).
credit_accounts gains a non-negative balance check; every existing row holds 0.
New tables get the same browser lockdown as f3d9b2c71a40 on PostgreSQL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b9d4e2f7c813"
down_revision: Union[str, Sequence[str], None] = "a7c3e5f19b62"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BROWSER_ROLES = ("anon", "authenticated")
NEW_TABLES = ("user_plans", "deleted_accounts")


def upgrade() -> None:
    op.add_column("profiles", sa.Column("terms_version", sa.String(), nullable=True))
    op.add_column("profiles", sa.Column("privacy_version", sa.String(), nullable=True))
    op.add_column("profiles", sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True))

    op.add_column("credit_ledger", sa.Column("tool", sa.String(), nullable=True))
    op.add_column("credit_ledger", sa.Column("note", sa.Text(), nullable=True))
    with op.batch_alter_table("credit_accounts") as batch:
        batch.create_check_constraint("ck_credit_accounts_balance_nonnegative", "balance >= 0")

    op.create_table(
        "user_plans",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("plan_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "deleted_accounts",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("user_id"),
    )

    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    roles = bind.execute(
        sa.text("SELECT rolname FROM pg_roles WHERE rolname = ANY(:names)"), {"names": list(BROWSER_ROLES)}
    ).scalars().all()
    for table in NEW_TABLES:
        op.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')
        if roles:
            op.execute(f'REVOKE ALL ON TABLE public."{table}" FROM {", ".join(sorted(roles))}')


def downgrade() -> None:
    op.drop_table("deleted_accounts")
    op.drop_table("user_plans")
    with op.batch_alter_table("credit_accounts") as batch:
        batch.drop_constraint("ck_credit_accounts_balance_nonnegative", type_="check")
    op.drop_column("credit_ledger", "note")
    op.drop_column("credit_ledger", "tool")
    op.drop_column("profiles", "terms_accepted_at")
    op.drop_column("profiles", "privacy_version")
    op.drop_column("profiles", "terms_version")
