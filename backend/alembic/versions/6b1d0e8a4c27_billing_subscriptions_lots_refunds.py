"""billing: subscription fields, credit lots, payments, cash refunds, webhook events

Revision ID: 6b1d0e8a4c27
Revises: d2a7f4c9b351
Create Date: 2026-10-25

Additive only. Existing user_plans rows keep their values; the new columns are NULL/false.
Existing credit balances are not converted into lots: a balance not covered by any lot is
treated as untracked legacy credit (never cash-refundable, consumed before purchased lots).
New tables get the same browser lockdown as f3d9b2c71a40 on PostgreSQL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "6b1d0e8a4c27"
down_revision: Union[str, Sequence[str], None] = "d2a7f4c9b351"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BROWSER_ROLES = ("anon", "authenticated")
NEW_TABLES = ("billing_payments", "credit_lots", "credit_lot_moves", "billing_refunds", "billing_events")
NOW = sa.text("(CURRENT_TIMESTAMP)")


def upgrade() -> None:
    with op.batch_alter_table("user_plans") as batch:
        batch.add_column(sa.Column("provider", sa.String(), nullable=True))
        batch.add_column(sa.Column("provider_customer_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("provider_subscription_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("billing_country", sa.String(length=2), nullable=True))
        batch.add_column(sa.Column("pending_plan_id", sa.String(), nullable=True))
    op.create_index("ix_user_plans_provider_subscription_id", "user_plans", ["provider_subscription_id"])

    op.create_table(
        "billing_payments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("provider_payment_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("item_id", sa.String(), nullable=False),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("refunded_minor", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("country", sa.String(length=2), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint("amount_minor >= 0", name="ck_billing_payments_amount_nonnegative"),
        sa.CheckConstraint("refunded_minor >= 0 AND refunded_minor <= amount_minor", name="ck_billing_payments_refund_bounds"),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "provider_payment_id", name="uq_billing_payments_provider_ref"),
    )
    op.create_index("ix_billing_payments_user_id", "billing_payments", ["user_id"])

    op.create_table(
        "credit_lots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("source_key", sa.Text(), nullable=False),
        sa.Column("item_id", sa.String(), nullable=True),
        sa.Column("credits_total", sa.Integer(), nullable=False),
        sa.Column("credits_remaining", sa.Integer(), nullable=False),
        sa.Column("credits_refunded", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("payment_id", sa.Uuid(), nullable=True),
        sa.Column("amount_minor", sa.Integer(), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("withdrawal_waived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("statutory_override", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint("credits_remaining >= 0", name="ck_credit_lots_remaining_nonnegative"),
        sa.CheckConstraint("credits_refunded >= 0", name="ck_credit_lots_refunded_nonnegative"),
        sa.CheckConstraint("credits_remaining + credits_refunded <= credits_total", name="ck_credit_lots_conservation"),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["payment_id"], ["billing_payments.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_key", name="uq_credit_lots_source_key"),
    )
    op.create_index("ix_credit_lots_user_id", "credit_lots", ["user_id"])
    op.create_index("ix_credit_lots_payment_id", "credit_lots", ["payment_id"])

    op.create_table(
        "credit_lot_moves",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("lot_id", sa.Uuid(), nullable=False),
        sa.Column("ledger_key", sa.Text(), nullable=False),
        sa.Column("run_id", sa.String(), nullable=True),
        sa.Column("delta", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.ForeignKeyConstraint(["lot_id"], ["credit_lots.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_credit_lot_moves_lot_id", "credit_lot_moves", ["lot_id"])
    op.create_index("ix_credit_lot_moves_ledger_key", "credit_lot_moves", ["ledger_key"])
    op.create_index("ix_credit_lot_moves_run_id", "credit_lot_moves", ["run_id"])

    op.create_table(
        "billing_refunds",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("request_id", sa.String(), nullable=False),
        sa.Column("payment_id", sa.Uuid(), nullable=True),
        sa.Column("lot_id", sa.Uuid(), nullable=True),
        sa.Column("credits", sa.Integer(), nullable=False),
        sa.Column("unused_value_minor", sa.Integer(), nullable=False),
        sa.Column("rate_bps", sa.Integer(), nullable=False),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("basis", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("provider_refund_id", sa.String(), nullable=True),
        sa.Column("idempotency_key", sa.Text(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint("amount_minor >= 0", name="ck_billing_refunds_amount_nonnegative"),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["payment_id"], ["billing_payments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["lot_id"], ["credit_lots.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("idempotency_key", name="uq_billing_refunds_idempotency_key"),
    )
    op.create_index("ix_billing_refunds_user_id", "billing_refunds", ["user_id"])
    op.create_index("ix_billing_refunds_request_id", "billing_refunds", ["request_id"])
    op.create_index("ix_billing_refunds_payment_id", "billing_refunds", ["payment_id"])
    op.create_index("ix_billing_refunds_lot_id", "billing_refunds", ["lot_id"])

    op.create_table(
        "billing_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("event_id", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("outcome", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "event_id", name="uq_billing_events_provider_event"),
    )
    op.create_index("ix_billing_events_user_id", "billing_events", ["user_id"])

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
    op.drop_table("billing_events")
    op.drop_table("billing_refunds")
    op.drop_table("credit_lot_moves")
    op.drop_table("credit_lots")
    op.drop_table("billing_payments")
    op.drop_index("ix_user_plans_provider_subscription_id", table_name="user_plans")
    with op.batch_alter_table("user_plans") as batch:
        for col in ("pending_plan_id", "billing_country", "ended_at", "canceled_at", "cancel_at_period_end",
                    "provider_subscription_id", "provider_customer_id", "provider"):
            batch.drop_column(col)
