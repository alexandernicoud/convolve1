"""founding beta member discount: one-time redemption tracking

Revision ID: b6e2d9f4a1c7
Revises: a3f8c1e5b902
Create Date: 2026-10-31

Additive only. One row per account (primary key user_id), so the offer can be redeemed once.
Same browser lockdown as f3d9b2c71a40 on PostgreSQL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b6e2d9f4a1c7"
down_revision: Union[str, Sequence[str], None] = "a3f8c1e5b902"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BROWSER_ROLES = ("anon", "authenticated")
NOW = sa.text("(CURRENT_TIMESTAMP)")


def upgrade() -> None:
    op.create_table(
        "founding_discounts",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("percent", sa.Integer(), nullable=False),
        sa.Column("checkout_session_id", sa.String(), nullable=True),
        sa.Column("offered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("subscription_ref", sa.String(), nullable=True),
        sa.Column("payment_ref", sa.String(), nullable=True),
        sa.Column("redeemed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    roles = bind.execute(
        sa.text("SELECT rolname FROM pg_roles WHERE rolname = ANY(:names)"), {"names": list(BROWSER_ROLES)}
    ).scalars().all()
    op.execute('ALTER TABLE public."founding_discounts" ENABLE ROW LEVEL SECURITY')
    if roles:
        op.execute(f'REVOKE ALL ON TABLE public."founding_discounts" FROM {", ".join(sorted(roles))}')


def downgrade() -> None:
    op.drop_table("founding_discounts")
