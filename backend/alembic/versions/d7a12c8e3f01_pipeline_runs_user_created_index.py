"""pipeline_runs (user_id, created_at) index

Revision ID: d7a12c8e3f01
Revises: c4e91d7b2a10
Create Date: 2026-10-02

Does not rewrite or delete existing rows.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "d7a12c8e3f01"
down_revision: Union[str, Sequence[str], None] = "c4e91d7b2a10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_pipeline_runs_user_id_created_at",
        "pipeline_runs",
        ["user_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_pipeline_runs_user_id_created_at", table_name="pipeline_runs")
