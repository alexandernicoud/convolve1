# Standalone Supabase Data API lockdown

Closes the five existing application tables to the browser roles `anon` and `authenticated`
without deploying anything and without the unfinished auth/persistence migrations.

| File | Writes? | Purpose |
|---|---|---|
| `backup.py` | no (read-only session) | catalog snapshot (owners, RLS, ACLs, default ACLs) + CSV of every public table |
| `03_verify.sql` | no | one row per check; all `ok` must be true after the lockdown |
| `02_lockdown.sql` | yes, one transaction | enable RLS, revoke browser grants, revoke postgres default grants in public |
| `98_rollback_rls_only.sql` | yes | disable RLS, keep browser roles locked out |
| `99_rollback_full.sql` | yes | restore the exact prior state (re-exposes the tables) |
| `run_sql.py` | as the file | runs one file, prints notices/rows, never prints the URL |

Rehearsed on PostgreSQL 17.6 against a replica of production's roles, ACLs and schema:
`backend/tests/test_supabase_lockdown.py` (needs `CONVOLVE_PG_ADMIN_URL` pointing at a disposable PG17 server).

## What changes

- `public.alembic_version`, `bots`, `bot_runs`, `bot_trades`, `bot_equity_snapshots`:
  RLS enabled (not forced, no policies); every privilege of `anon` and `authenticated` revoked.
- Any sequences/functions in `public` (none today): `anon`/`authenticated` privileges revoked.
- `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public`: no more automatic grants to
  `anon`/`authenticated` on new tables, sequences and functions.

Unchanged: data, `alembic_version`'s value, `service_role` and `postgres` grants, the `auth`,
`storage`, `extensions`, `graphql*`, `realtime`, `vault` schemas, the public schema ACL, roles,
and `supabase_admin`'s default privileges (postgres is not allowed to alter them).

The production API connects as `postgres`, which owns the tables and has `BYPASSRLS`, so it is
unaffected. The later Alembic migrations (`8f3c2a91b4d0` … `f3d9b2c71a40`) still apply on top.

## Procedure

Use the session pooler (the direct host is IPv6-only). Never echo the URL.

```bash
cd backend/deploy/supabase_lockdown
read -rs LOCKDOWN_DB_URL && export LOCKDOWN_DB_URL   # postgresql://postgres.<ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require
```

1. Backup (read-only). Also confirm in the Supabase dashboard (Database → Backups) whether a
   platform backup exists for today; on the Free plan it is not downloadable, so keep this one.
   ```bash
   ../../.venv/bin/python backup.py ~/convolve-backups   # 0700 directory, never inside the repo
   ```
2. Before-state: `../../.venv/bin/python run_sql.py 03_verify.sql --read-only` (expected: checks fail).
3. Apply: `../../.venv/bin/python run_sql.py 02_lockdown.sql`.
   It aborts and changes nothing if it cannot get a lock within 5 s (rerun) or if the end state
   is not exactly as intended.
4. Verify: `../../.venv/bin/python run_sql.py 03_verify.sql --read-only` (expected: `OK`).
5. Smoke-test the production API: `GET /api/bots` and `GET /api/dashboard/bundle` return 200
   with the same bots as before.
6. Optional external check with the public anon key (no data is returned after the lockdown):
   `curl -s "https://<ref>.supabase.co/rest/v1/bots?select=id" -H "apikey: <anon key>"` → `401`/`42501` permission denied.

## Rollback

- API misbehaves (not expected): `run_sql.py 98_rollback_rls_only.sql` — RLS off, tables stay closed.
- Emergency only: `run_sql.py 99_rollback_full.sql` — exact prior state, tables exposed again.
- Data loss (the patch changes no data, so only for unrelated incidents): restore from the CSVs
  in the backup directory, parents first: `bots`, `bot_runs`, `bot_trades`, `bot_equity_snapshots`.
