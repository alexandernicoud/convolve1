-- Close the Supabase Data API (anon / authenticated) on the existing application tables.
--
-- Scope: public.alembic_version, bots, bot_runs, bot_trades, bot_equity_snapshots, any
-- sequences/functions in public, and the postgres role's default privileges in public.
-- Creates nothing, changes no data, does not touch alembic_version's value, the auth/storage
-- schemas, service_role, or supabase_admin's defaults (postgres cannot alter those).
--
-- The API connects as postgres: table owner with BYPASSRLS, so RLS with no policies
-- does not affect it. Safe to rerun. Run as postgres (Supabase SQL editor or run_sql.py).

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  t text;
  tables constant text[] := ARRAY['alembic_version', 'bots', 'bot_runs', 'bot_trades', 'bot_equity_snapshots'];
  extra text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Run as postgres, not %', current_user;
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated')) <> 2 THEN
    RAISE EXCEPTION 'anon/authenticated roles not found: this is not a Supabase database';
  END IF;

  FOREACH t IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'public.% does not exist, skipped', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;

  SELECT string_agg(c.relname, ', ') INTO extra
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relname <> ALL (tables);
  IF extra IS NOT NULL THEN
    RAISE NOTICE 'Other public relations were left unchanged: %', extra;
  END IF;
END $$;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- Abort (and roll everything back) unless the end state is exactly as intended.
DO $$
DECLARE
  problems text;
BEGIN
  SELECT string_agg(format('%s:%s', c.relname, r.rolname), ', ') INTO problems
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
  WHERE n.nspname = 'public'
    AND c.relname IN ('alembic_version', 'bots', 'bot_runs', 'bot_trades', 'bot_equity_snapshots')
    AND (
      NOT c.relrowsecurity
      OR has_table_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_any_column_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
    );
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Lockdown incomplete: %', problems;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace,
         aclexplode(d.defaclacl) a
    WHERE n.nspname = 'public' AND d.defaclrole = 'postgres'::regrole
      AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)
  ) THEN
    RAISE EXCEPTION 'postgres default privileges in public still grant anon/authenticated';
  END IF;
END $$;

COMMIT;
