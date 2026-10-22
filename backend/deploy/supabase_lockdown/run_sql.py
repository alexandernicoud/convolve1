"""Run one lockdown SQL file against LOCKDOWN_DB_URL and print notices and result rows.

    LOCKDOWN_DB_URL=postgresql://... python run_sql.py 03_verify.sql [--read-only]

The URL is never printed. --read-only opens a read-only session (use it for 03_verify.sql).
Exit code 1 if the script raises or, for 03_verify.sql, if any check is not ok.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg2


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    path = Path(argv[0])
    read_only = "--read-only" in argv[1:]
    url = os.environ.get("LOCKDOWN_DB_URL", "").strip()
    if not url:
        print("LOCKDOWN_DB_URL is not set", file=sys.stderr)
        return 2
    options = "-c statement_timeout=60000"
    if read_only:
        options += " -c default_transaction_read_only=on"
    conn = psycopg2.connect(url.replace("postgresql+psycopg2://", "postgresql://"), options=options, connect_timeout=15)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("select current_user, current_database(), current_setting('server_version')")
    print("connected as %s to %s (PostgreSQL %s)" % cur.fetchone())
    try:
        cur.execute(path.read_text())
    except psycopg2.Error as exc:
        for notice in conn.notices:
            print(notice.strip())
        print(f"FAILED: {exc.pgerror or exc}".strip(), file=sys.stderr)
        return 1
    for notice in conn.notices:
        print(notice.strip())
    failed = False
    if cur.description:
        names = [d.name for d in cur.description]
        for row in cur.fetchall():
            record = dict(zip(names, row))
            print(" | ".join(str(v) for v in row))
            if record.get("ok") is False:
                failed = True
    print("OK" if not failed else "CHECKS FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
