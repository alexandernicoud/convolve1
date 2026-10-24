"""profile onboarding state

Revision ID: d2a7f4c9b351
Revises: c5f8a3d1e290
Create Date: 2026-10-24

Additive only: one nullable column. Existing users keep NULL, which the app treats as
"tour never started" (the welcome overlay is offered once).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d2a7f4c9b351"
down_revision: Union[str, Sequence[str], None] = "c5f8a3d1e290"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("profiles", sa.Column("onboarding_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("profiles", "onboarding_json")
