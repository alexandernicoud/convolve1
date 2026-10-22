"""user_datasets + user_models ownership

Revision ID: c4e91d7b2a10
Revises: 8f3c2a91b4d0
Create Date: 2026-10-02

Does not rewrite or delete existing dataset/model files.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c4e91d7b2a10"
down_revision: Union[str, Sequence[str], None] = "8f3c2a91b4d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_datasets",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(), nullable=True),
        sa.Column("kind", sa.String(), nullable=True),
        sa.Column("path", sa.Text(), nullable=True),
        sa.Column("extra_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_datasets_user_id"), "user_datasets", ["user_id"], unique=False)
    op.create_index("ix_user_datasets_user_id_created_at", "user_datasets", ["user_id", "created_at"], unique=False)

    op.create_table(
        "user_models",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(), nullable=True),
        sa.Column("storage_key", sa.Text(), nullable=True),
        sa.Column("path", sa.Text(), nullable=True),
        sa.Column("extra_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_models_user_id"), "user_models", ["user_id"], unique=False)
    op.create_index("ix_user_models_user_id_created_at", "user_models", ["user_id", "created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_user_models_user_id_created_at", table_name="user_models")
    op.drop_index(op.f("ix_user_models_user_id"), table_name="user_models")
    op.drop_table("user_models")
    op.drop_index("ix_user_datasets_user_id_created_at", table_name="user_datasets")
    op.drop_index(op.f("ix_user_datasets_user_id"), table_name="user_datasets")
    op.drop_table("user_datasets")
