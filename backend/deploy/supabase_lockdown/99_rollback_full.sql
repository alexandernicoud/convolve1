-- FULL rollback: restores the exact pre-lockdown state, which RE-EXPOSES every app table
-- to anyone holding the public anon key. Emergency use only, and only if the partial
-- rollback (98_rollback_rls_only.sql) did not help. Safe to rerun.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  t text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Run as postgres, not %', current_user;
  END IF;
  FOREACH t IN ARRAY ARRAY['alembic_version', 'bots', 'bot_runs', 'bot_trades', 'bot_equity_snapshots'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO anon, authenticated', t);
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;

COMMIT;
