-- Partial rollback: switch RLS off again but keep anon/authenticated locked out.
-- Use if anything that connects as postgres misbehaves after the lockdown (not expected:
-- postgres owns the tables and has BYPASSRLS). Safe to rerun.

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
    END IF;
  END LOOP;
END $$;

COMMIT;
