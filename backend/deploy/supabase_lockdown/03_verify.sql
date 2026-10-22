-- Read-only. One row per check; every "ok" must be true after 02_lockdown.sql.
-- Safe to run any time (before the patch it shows the current exposure).

WITH app AS (
  SELECT c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relowner
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('alembic_version', 'bots', 'bot_runs', 'bot_trades', 'bot_equity_snapshots')
),
browser AS (SELECT unnest(ARRAY['anon', 'authenticated']) AS rolname),
pub AS (
  SELECT c.oid, c.relname, c.relkind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
)
SELECT 'rls enabled on app tables' AS check,
       bool_and(relrowsecurity) AS ok,
       coalesce(string_agg(relname, ', ') FILTER (WHERE NOT relrowsecurity), '') AS detail
FROM app
UNION ALL
SELECT 'rls not forced (owner keeps access)',
       NOT bool_or(relforcerowsecurity),
       coalesce(string_agg(relname, ', ') FILTER (WHERE relforcerowsecurity), '')
FROM app
UNION ALL
SELECT 'app tables owned by postgres',
       bool_and(relowner = 'postgres'::regrole),
       coalesce(string_agg(relname, ', ') FILTER (WHERE relowner <> 'postgres'::regrole), '')
FROM app
UNION ALL
SELECT 'postgres can bypass rls',
       (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = 'postgres'),
       ''
UNION ALL
SELECT 'no table/view privileges for anon/authenticated in public',
       count(*) = 0,
       coalesce(string_agg(DISTINCT relname || ':' || rolname, ', '), '')
FROM pub, browser
WHERE relkind <> 'S'
  AND (has_table_privilege(rolname, oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege(rolname, oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
UNION ALL
SELECT 'no sequence privileges for anon/authenticated in public',
       count(*) = 0,
       coalesce(string_agg(DISTINCT relname || ':' || rolname, ', '), '')
FROM pub, browser
WHERE relkind = 'S' AND has_sequence_privilege(rolname, oid, 'USAGE,SELECT,UPDATE')
UNION ALL
SELECT 'no executable public functions for anon/authenticated',
       count(*) = 0,
       coalesce(string_agg(DISTINCT p.oid::regprocedure::text || ':' || rolname, ', '), '')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, browser
WHERE n.nspname = 'public' AND has_function_privilege(rolname, p.oid, 'EXECUTE')
UNION ALL
SELECT 'postgres default privileges in public do not grant anon/authenticated',
       count(*) = 0,
       coalesce(string_agg(DISTINCT d.defaclobjtype::text || ':' || a.grantee::regrole::text, ', '), '')
FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
WHERE n.nspname = 'public' AND d.defaclrole = 'postgres'::regrole
  AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)
UNION ALL
-- Informational: postgres cannot change these. Objects created by supabase_admin in public
-- would still be granted to the browser roles (Supabase normally creates none there).
SELECT 'info: supabase_admin defaults in public still grant anon/authenticated',
       true,
       coalesce(string_agg(DISTINCT d.defaclobjtype::text || ':' || a.grantee::regrole::text, ', '), 'none')
FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
WHERE n.nspname = 'public' AND d.defaclrole = 'supabase_admin'::regrole
  AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole);
