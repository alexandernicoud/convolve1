"""Read-only backup taken immediately before the lockdown.

    LOCKDOWN_DB_URL=postgresql://... python backup.py /secure/dir

Writes, in a new 0700 directory:
- catalog.json: owners, RLS flags, table/column ACLs, default ACLs and the public schema ACL;
  this is everything 02_lockdown.sql changes, so the exact prior state can be compared or restored.
- <table>.csv for every public table (COPY ... TO STDOUT, header row), plus row counts.
The session is read-only. Nothing is printed except file names and counts.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import psycopg2

CATALOG = {
    "relations": """
        select c.relname, c.relkind, c.relowner::regrole::text, c.relrowsecurity, c.relforcerowsecurity,
               c.relacl::text[]
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p','v','m','S','f') order by 1""",
    "column_acls": """
        select c.relname, a.attname, a.attacl::text[]
        from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and a.attacl is not null order by 1, 2""",
    "default_acls": """
        select d.defaclrole::regrole::text, coalesce(n.nspname, '<global>'), d.defaclobjtype, d.defaclacl::text[]
        from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace order by 1, 2, 3""",
    "public_schema": "select nspowner::regrole::text, nspacl::text[] from pg_namespace where nspname = 'public'",
    "functions": """
        select p.oid::regprocedure::text, p.proacl::text[] from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1""",
    "server": "select current_setting('server_version'), current_user, now()::text",
}


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__)
        return 2
    url = os.environ.get("LOCKDOWN_DB_URL", "").strip()
    if not url:
        print("LOCKDOWN_DB_URL is not set", file=sys.stderr)
        return 2
    out = Path(argv[0]) / datetime.now(timezone.utc).strftime("lockdown-backup-%Y%m%dT%H%M%SZ")
    out.mkdir(parents=True, mode=0o700)
    conn = psycopg2.connect(url.replace("postgresql+psycopg2://", "postgresql://"),
                            options="-c default_transaction_read_only=on -c statement_timeout=120000",
                            connect_timeout=15)
    conn.set_session(readonly=True, isolation_level="REPEATABLE READ")
    cur = conn.cursor()
    catalog = {}
    for key, sql in CATALOG.items():
        cur.execute(sql)
        catalog[key] = [list(r) for r in cur.fetchall()]
    counts = {}
    for name, kind, *_ in catalog["relations"]:
        if kind not in ("r", "p"):
            continue
        target = out / f"{name}.csv"
        with open(target, "w", encoding="utf-8") as fh:
            cur.copy_expert(f'COPY public."{name}" TO STDOUT WITH (FORMAT csv, HEADER true)', fh)
        cur.execute(f'select count(*) from public."{name}"')
        counts[name] = cur.fetchone()[0]
        os.chmod(target, 0o600)
    catalog["row_counts"] = counts
    (out / "catalog.json").write_text(json.dumps(catalog, indent=2, default=str))
    os.chmod(out / "catalog.json", 0o600)
    conn.rollback()
    conn.close()
    print(f"backup written to {out}")
    for name, n in counts.items():
        print(f"  {name}: {n} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
