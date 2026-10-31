"""feedback questionnaire responses and contact messages

Revision ID: 9c4e2b7d1f53
Revises: 6b1d0e8a4c27
Create Date: 2026-10-27

Additive only. ``feedback_responses.user_id`` is unique: one completed questionnaire (and one
bonus grant) per account. New tables get the same browser lockdown as f3d9b2c71a40 on PostgreSQL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9c4e2b7d1f53"
down_revision: Union[str, Sequence[str], None] = "6b1d0e8a4c27"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BROWSER_ROLES = ("anon", "authenticated")
NEW_TABLES = ("feedback_responses", "contact_messages")
NOW = sa.text("(CURRENT_TIMESTAMP)")


def upgrade() -> None:
    op.create_table(
        "feedback_responses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("survey_version", sa.String(), nullable=False),
        sa.Column("answers_json", sa.Text(), nullable=False),
        sa.Column("credits_granted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_feedback_responses_user_id"),
    )

    op.create_table(
        "contact_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("topic", sa.String(length=64), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("ip_hash", sa.String(length=64), nullable=True),
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_contact_messages_user_id", "contact_messages", ["user_id"])
    op.create_index("ix_contact_messages_ip_hash", "contact_messages", ["ip_hash"])
    op.create_index("ix_contact_messages_created_at", "contact_messages", ["created_at"])

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
    op.drop_table("contact_messages")
    op.drop_table("feedback_responses")
