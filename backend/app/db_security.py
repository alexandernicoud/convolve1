"""Checks that the database is reachable by the backend and closed to browser roles.

With RLS enabled and no policies, a role that is neither the table owner nor
BYPASSRLS gets empty results instead of an error, so a misconfigured
DATABASE_URL would look like "no data". These checks make that loud.
"""

from __future__ import annotations

from pathlib import Path
from typing import List, Optional, Tuple

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

BROWSER_ROLES = ("anon", "authenticated")
# Tables the training worker reads/updates, and the privileges it needs on each.
WORKER_TABLES = {
    "pipeline_runs": ("SELECT", "UPDATE"),
    "user_datasets": ("SELECT",),
    "profiles": ("SELECT",),
}
Check = Tuple[str, bool, str]


def client_ssl_in_use(conn: Connection) -> Optional[bool]:
    """Whether this client's own link is encrypted (through a pooler, pg_stat_ssl only sees the pooler's link)."""
    info = getattr(conn.connection.dbapi_connection, "info", None)
    ssl = getattr(info, "ssl_in_use", None)
    if ssl is None:
        ssl = getattr(getattr(info, "pgconn", None), "ssl_in_use", None)
    return None if ssl is None else bool(ssl)


def expected_revision() -> Optional[str]:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    root = Path(__file__).resolve().parents[1]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    return ScriptDirectory.from_config(cfg).get_current_head()


def worker_database_checks(conn: Connection, *, require_ssl: bool) -> List[Check]:
    """Read-only checks that the training worker can use this connection. Call inside a read-only transaction."""
    if conn.dialect.name != "postgresql":
        tables = set(inspect(conn).get_table_names())
        return [(f"table {t}", t in tables, "present" if t in tables else "missing") for t in WORKER_TABLES]

    user, version, read_only = conn.execute(text(
        "SELECT current_user, current_setting('server_version'), current_setting('transaction_read_only')"
    )).one()
    ssl = client_ssl_in_use(conn)
    checks: List[Check] = [
        ("read-only session", read_only == "on", f"user={user} server={version}"),
        ("client connection encrypted", bool(ssl) or not require_ssl,
         {True: "TLS", False: "not encrypted", None: "unknown driver"}[ssl]),
    ]
    head = expected_revision()
    has_version_table = conn.execute(text("SELECT to_regclass('public.alembic_version') IS NOT NULL")).scalar()
    current = conn.execute(text("SELECT version_num FROM alembic_version")).scalar() if has_version_table else None
    checks.append(("schema revision", current == head, f"database={current or 'none'} code={head}"))
    for table, privileges in WORKER_TABLES.items():
        if not conn.execute(text("SELECT to_regclass(:t) IS NOT NULL"), {"t": f"public.{table}"}).scalar():
            checks.append((f"table {table}", False, "missing (alembic upgrade head not applied)"))
            continue
        missing = [
            p for p in privileges
            if not conn.execute(text("SELECT has_table_privilege(current_user, :t, :p)"),
                                {"t": f"public.{table}", "p": p}).scalar()
        ]
        checks.append((f"table {table}", not missing,
                       f"{user} lacks {', '.join(missing)}" if missing else "/".join(privileges)))
    return checks


def rls_blocked_tables(conn: Connection) -> List[str]:
    """Public tables with RLS that the current role would silently not see."""
    if conn.dialect.name != "postgresql":
        return []
    rows = conn.execute(text("""
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_roles me ON me.rolname = current_user
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
          AND NOT me.rolsuper AND NOT me.rolbypassrls
          AND (c.relforcerowsecurity OR NOT pg_has_role(current_user, c.relowner, 'USAGE'))
        ORDER BY 1
    """)).scalars().all()
    return list(rows)


def browser_exposed_tables(conn: Connection) -> List[str]:
    """Public tables that anon/authenticated could reach through the Data API."""
    if conn.dialect.name != "postgresql":
        return []
    roles = conn.execute(
        text("SELECT rolname FROM pg_roles WHERE rolname = ANY(:r)"), {"r": list(BROWSER_ROLES)}
    ).scalars().all()
    if not roles:
        return []
    rows = conn.execute(text("""
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
          AND (
            NOT c.relrowsecurity AND c.relkind IN ('r', 'p')
            OR EXISTS (
              SELECT 1 FROM unnest(CAST(:roles AS text[])) AS r(name)
              WHERE has_table_privilege(r.name, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            )
          )
        ORDER BY 1
    """), {"roles": list(roles)}).scalars().all()
    return list(rows)
