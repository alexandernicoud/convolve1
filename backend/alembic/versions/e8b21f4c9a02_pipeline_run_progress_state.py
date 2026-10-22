"""pipeline_runs progress and lifecycle columns

Revision ID: e8b21f4c9a02
Revises: d7a12c8e3f01
Create Date: 2026-10-10

Adds nullable lifecycle columns. Does not rewrite artifacts or existing statuses.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e8b21f4c9a02"
down_revision: Union[str, Sequence[str], None] = "d7a12c8e3f01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("pipeline_runs", sa.Column("progress", sa.Float(), nullable=True, server_default="0"))
    op.add_column("pipeline_runs", sa.Column("stage", sa.String(), nullable=True))
    op.add_column("pipeline_runs", sa.Column("message", sa.Text(), nullable=True))
    op.add_column("pipeline_runs", sa.Column("error_summary", sa.Text(), nullable=True))
    op.add_column("pipeline_runs", sa.Column("artifact_ref", sa.Text(), nullable=True))
    op.add_column("pipeline_runs", sa.Column("worker_id", sa.String(), nullable=True))
    op.add_column("pipeline_runs", sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_pipeline_runs_status", "pipeline_runs", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_pipeline_runs_status", table_name="pipeline_runs")
    op.drop_column("pipeline_runs", "finished_at")
    op.drop_column("pipeline_runs", "worker_id")
    op.drop_column("pipeline_runs", "artifact_ref")
    op.drop_column("pipeline_runs", "error_summary")
    op.drop_column("pipeline_runs", "message")
    op.drop_column("pipeline_runs", "stage")
    op.drop_column("pipeline_runs", "progress")
