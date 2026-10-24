"""bot scheduling: timeframe and chart span, slot tracking, per-bar execution keys

Revision ID: c5f8a3d1e290
Revises: b9d4e2f7c813
Create Date: 2026-10-24

Additive only. Legacy bot_runs keep execution_key NULL (NULLs never collide in a unique
constraint), legacy bots keep timeframe NULL (= "1d"). The prediction-run constraint on
bot_trades matches the existing rule of one trade per BUY run; the upgrade fails loudly if
a database somehow holds duplicates instead of silently dropping rows.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c5f8a3d1e290"
down_revision: Union[str, Sequence[str], None] = "b9d4e2f7c813"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("bots", sa.Column("timeframe", sa.String(), nullable=True))
    op.add_column("bots", sa.Column("chart_span_unit", sa.String(), nullable=True))
    op.add_column("bots", sa.Column("chart_span_count", sa.Integer(), nullable=True))
    op.add_column("bots", sa.Column("last_slot_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("bots", sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True))

    op.add_column("bot_runs", sa.Column("execution_key", sa.String(), nullable=True))
    op.add_column("bot_runs", sa.Column("trigger", sa.String(), nullable=True))
    op.add_column("bot_runs", sa.Column("attempts", sa.Integer(), nullable=True))
    op.add_column("bot_runs", sa.Column("decision_bar_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("bot_runs", sa.Column("entry_state", sa.String(), nullable=True))
    with op.batch_alter_table("bot_runs") as batch:
        batch.create_unique_constraint("uq_bot_runs_bot_execution_key", ["bot_id", "execution_key"])

    op.add_column("bot_trades", sa.Column("decision_bar_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("bot_trades", sa.Column("outcome_flags", sa.Text(), nullable=True))
    op.add_column("bot_trades", sa.Column("bars_held", sa.Integer(), nullable=True))
    with op.batch_alter_table("bot_trades") as batch:
        batch.create_unique_constraint("uq_bot_trades_prediction_run", ["prediction_run_id"])


def downgrade() -> None:
    with op.batch_alter_table("bot_trades") as batch:
        batch.drop_constraint("uq_bot_trades_prediction_run", type_="unique")
    op.drop_column("bot_trades", "bars_held")
    op.drop_column("bot_trades", "outcome_flags")
    op.drop_column("bot_trades", "decision_bar_at")
    with op.batch_alter_table("bot_runs") as batch:
        batch.drop_constraint("uq_bot_runs_bot_execution_key", type_="unique")
    for col in ("entry_state", "decision_bar_at", "attempts", "trigger", "execution_key"):
        op.drop_column("bot_runs", col)
    for col in ("last_attempt_at", "last_slot_at", "chart_span_count", "chart_span_unit", "timeframe"):
        op.drop_column("bots", col)
