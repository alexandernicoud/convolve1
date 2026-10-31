"""ambassador referral codes, referrals and citation-bonus claims

Revision ID: a3f8c1e5b902
Revises: 9c4e2b7d1f53
Create Date: 2026-10-28

Additive only. ``referrals.referee_id`` is unique: an account can be invited once and earn its
welcome bonus once. New tables get the same browser lockdown as f3d9b2c71a40 on PostgreSQL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a3f8c1e5b902"
down_revision: Union[str, Sequence[str], None] = "9c4e2b7d1f53"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BROWSER_ROLES = ("anon", "authenticated")
NEW_TABLES = ("referral_codes", "referrals", "citation_claims")
NOW = sa.text("(CURRENT_TIMESTAMP)")


def upgrade() -> None:
    op.create_table(
        "referral_codes",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
        sa.UniqueConstraint("code", name="uq_referral_codes_code"),
    )

    op.create_table(
        "referrals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("referrer_id", sa.Uuid(), nullable=False),
        sa.Column("referee_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("referee_credits", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("referrer_reward", sa.String(), nullable=True),
        sa.Column("referrer_credits", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("referee_tier", sa.String(), nullable=True),
        sa.Column("payment_id", sa.Uuid(), nullable=True),
        sa.Column("rewarded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reversed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.ForeignKeyConstraint(["referrer_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["referee_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["payment_id"], ["billing_payments.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("referee_id", name="uq_referrals_referee_id"),
    )
    op.create_index("ix_referrals_referrer_id", "referrals", ["referrer_id"])
    op.create_index("ix_referrals_payment_id", "referrals", ["payment_id"])

    op.create_table(
        "citation_claims",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("url", sa.String(length=500), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("file_name", sa.String(length=200), nullable=True),
        sa.Column("content_type", sa.String(length=100), nullable=True),
        sa.Column("file_bytes", sa.LargeBinary(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("reviewed_by", sa.Uuid(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("credits_granted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_citation_claims_user_id", "citation_claims", ["user_id"])

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
    op.drop_table("citation_claims")
    op.drop_index("ix_referrals_payment_id", table_name="referrals")
    op.drop_index("ix_referrals_referrer_id", table_name="referrals")
    op.drop_table("referrals")
    op.drop_table("referral_codes")
