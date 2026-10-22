"""lock down public tables for the Supabase Data API

Revision ID: f3d9b2c71a40
Revises: e8b21f4c9a02
Create Date: 2026-10-18

Supabase exposes the public schema through its Data API to the browser's anon key.
Only the backend may read or write these tables, so:
- RLS is enabled with no policies: browser roles see nothing even if a grant reappears.
  The backend connects as the table owner, which bypasses RLS (not FORCEd).
- anon/authenticated lose every table and sequence privilege.
- The migrating role's default privileges stop granting them access to future objects.

PostgreSQL only. Roles that do not exist (plain Postgres, Cloud SQL) are skipped.
Supabase's own schemas (auth, storage, ...) are not touched.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f3d9b2c71a40"
down_revision: Union[str, Sequence[str], None] = "e8b21f4c9a02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BROWSER_ROLES = ("anon", "authenticated")
APP_TABLES = (
    "alembic_version",
    "bots",
    "bot_runs",
    "bot_trades",
    "bot_equity_snapshots",
    "profiles",
    "credit_accounts",
    "credit_ledger",
    "pipeline_runs",
    "user_datasets",
    "user_models",
)


def _existing(bind, names, query: str) -> list:
    rows = bind.execute(sa.text(query), {"names": list(names)}).scalars().all()
    return [n for n in names if n in set(rows)]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    tables = _existing(
        bind, APP_TABLES,
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY(:names)",
    )
    roles = _existing(bind, BROWSER_ROLES, "SELECT rolname FROM pg_roles WHERE rolname = ANY(:names)")
    for table in tables:
        op.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')
    if not roles:
        return
    grantees = ", ".join(roles)
    for table in tables:
        op.execute(f'REVOKE ALL ON TABLE public."{table}" FROM {grantees}')
    op.execute(f"REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {grantees}")
    for kind in ("TABLES", "SEQUENCES", "FUNCTIONS"):
        op.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON {kind} FROM {grantees}")


def downgrade() -> None:
    # Grants are deliberately not restored: re-opening the tables to the browser
    # key is never a safe rollback. Only RLS is switched off again.
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    tables = _existing(
        bind, APP_TABLES,
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY(:names)",
    )
    for table in tables:
        op.execute(f'ALTER TABLE public."{table}" DISABLE ROW LEVEL SECURITY')
