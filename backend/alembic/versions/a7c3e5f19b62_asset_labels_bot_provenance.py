"""asset_labels + bot provenance columns

Revision ID: a7c3e5f19b62
Revises: f3d9b2c71a40
Create Date: 2026-10-21

Additive only. Existing bots keep NULL provenance (unknown); nothing is backfilled
or inferred. backend/library_labels.json is left in place and still read as a fallback.
The new table gets the same browser lockdown as f3d9b2c71a40 on PostgreSQL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7c3e5f19b62"
down_revision: Union[str, Sequence[str], None] = "f3d9b2c71a40"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BROWSER_ROLES = ("anon", "authenticated")


def upgrade() -> None:
    op.add_column("bots", sa.Column("provenance", sa.String(), nullable=True))
    op.add_column("bots", sa.Column("source_model_id", sa.String(), nullable=True))
    op.add_column("bots", sa.Column("source_training_run_id", sa.String(), nullable=True))
    op.add_column("bots", sa.Column("source_backtest_run_id", sa.String(), nullable=True))
    op.create_index("ix_bots_source_model_id", "bots", ["source_model_id"], unique=False)
    op.create_index("ix_bots_source_training_run_id", "bots", ["source_training_run_id"], unique=False)

    op.create_table(
        "asset_labels",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("asset_id", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=True),
        sa.Column("tags_json", sa.Text(), nullable=True),
        sa.Column("favorite", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "kind", "asset_id", name="uq_asset_labels_user_kind_asset"),
    )
    op.create_index(op.f("ix_asset_labels_user_id"), "asset_labels", ["user_id"], unique=False)

    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute('ALTER TABLE public."asset_labels" ENABLE ROW LEVEL SECURITY')
    roles = bind.execute(
        sa.text("SELECT rolname FROM pg_roles WHERE rolname = ANY(:names)"), {"names": list(BROWSER_ROLES)}
    ).scalars().all()
    if roles:
        op.execute(f'REVOKE ALL ON TABLE public."asset_labels" FROM {", ".join(sorted(roles))}')


def downgrade() -> None:
    op.drop_index(op.f("ix_asset_labels_user_id"), table_name="asset_labels")
    op.drop_table("asset_labels")
    op.drop_index("ix_bots_source_training_run_id", table_name="bots")
    op.drop_index("ix_bots_source_model_id", table_name="bots")
    op.drop_column("bots", "source_backtest_run_id")
    op.drop_column("bots", "source_training_run_id")
    op.drop_column("bots", "source_model_id")
    op.drop_column("bots", "provenance")
