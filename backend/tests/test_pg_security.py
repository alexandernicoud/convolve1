"""Browser roles cannot reach application tables on a Supabase-shaped database.

Runs only with CONVOLVE_PG_ADMIN_URL (a superuser on a disposable local server).
Each test builds a database the way Supabase does:
- anon / authenticated / service_role roles, and Supabase's default grants to them;
- a non-superuser owner (convolve_app) that runs migrations and the backend, like
  Supabase's "postgres" user;
- auth.users owned by supabase_auth_admin.
It starts at the production baseline (bot tables only, already granted to anon) and
migrates to head. Privileges are checked with SET ROLE, i.e. as the Data API would.
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url

BACKEND = Path(__file__).resolve().parents[1]
ADMIN_URL = os.getenv("CONVOLVE_PG_ADMIN_URL", "").strip()
BASELINE = "289c17a09fbb"
OWNER = "convolve_app"
BROWSER = ("anon", "authenticated")
PRIVATE = (
    "profiles", "credit_accounts", "credit_ledger", "pipeline_runs", "user_datasets",
    "user_models", "asset_labels", "bots", "bot_runs", "bot_trades", "bot_equity_snapshots", "alembic_version",
)

pytestmark = pytest.mark.skipif(not ADMIN_URL, reason="CONVOLVE_PG_ADMIN_URL not set")


def _env(url: str) -> dict:
    return {**os.environ, "CONVOLVE_TEST": "1", "DATABASE_URL": url, "APP_PROFILE": "local"}


def _run(url: str, *args: str, ok: bool = True) -> subprocess.CompletedProcess:
    proc = subprocess.run([sys.executable, *args], cwd=BACKEND, env=_env(url),
                          capture_output=True, text=True, timeout=180)
    if ok:
        assert proc.returncode == 0, proc.stderr[-2000:]
    return proc


def _alembic(url: str, *args: str) -> None:
    _run(url, "-m", "alembic", *args)


@pytest.fixture(scope="module", autouse=True)
def _cluster_roles():
    admin = sa.create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    assert "prod" not in ADMIN_URL.lower() and "supabase" not in ADMIN_URL.lower()
    with admin.connect() as conn:
        for name, attrs in (
            ("anon", "NOLOGIN"), ("authenticated", "NOLOGIN"), ("service_role", "NOLOGIN BYPASSRLS"),
            ("supabase_auth_admin", "NOLOGIN"), (OWNER, "LOGIN NOSUPERUSER CREATEDB"),
            ("convolve_reader", "LOGIN NOSUPERUSER"),
        ):
            exists = conn.execute(sa.text("SELECT 1 FROM pg_roles WHERE rolname = :n"), {"n": name}).scalar()
            if not exists:
                conn.execute(sa.text(f"CREATE ROLE {name} {attrs}"))
    admin.dispose()


@pytest.fixture
def db():
    """(superuser url, owner url) for a fresh Supabase-shaped database at the baseline."""
    name = f"convolve_sec_{uuid.uuid4().hex[:10]}"
    admin = sa.create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(sa.text(f'CREATE DATABASE "{name}" OWNER {OWNER}'))
    su_url = make_url(ADMIN_URL).set(database=name)
    owner_url = su_url.set(username=OWNER, password=None)
    su = sa.create_engine(su_url, isolation_level="AUTOCOMMIT")
    with su.connect() as conn:
        for stmt in (
            "CREATE SCHEMA auth",
            "CREATE TABLE auth.users (id uuid PRIMARY KEY, email text)",
            "ALTER TABLE auth.users OWNER TO supabase_auth_admin",
            "ALTER SCHEMA auth OWNER TO supabase_auth_admin",
            f"GRANT USAGE ON SCHEMA auth TO {OWNER}, authenticated",
            f"GRANT SELECT, REFERENCES ON auth.users TO {OWNER}",
            "GRANT SELECT ON auth.users TO authenticated",
            "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role",
            f"ALTER DEFAULT PRIVILEGES FOR ROLE {OWNER} IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role",
            f"ALTER DEFAULT PRIVILEGES FOR ROLE {OWNER} IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role",
            f"ALTER DEFAULT PRIVILEGES FOR ROLE {OWNER} IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role",
        ):
            conn.execute(sa.text(stmt))
    owner = owner_url.render_as_string(hide_password=False)
    _alembic(owner, "upgrade", BASELINE)
    oe = sa.create_engine(owner_url)
    with oe.begin() as conn:
        conn.execute(sa.text("CREATE SEQUENCE public.legacy_seq"))
        conn.execute(sa.text(
            "INSERT INTO bots (id, user_id, symbol, model_path, confidence_threshold, img_size, is_active, "
            "lifecycle_state, starting_capital, horizon_days, position_size_pct, commission_pct, slippage_pct, "
            "created_at, updated_at) VALUES ('prod-bot', 'local-user', 'AAPL', 'm.keras', 0.5, 224, true, 'active', "
            "10000, 5, 10, 0.1, 0.05, now(), now())"
        ))
    oe.dispose()
    su.dispose()
    su = sa.create_engine(su_url)
    try:
        yield su, owner
    finally:
        su.dispose()
        with admin.connect() as conn:
            conn.execute(sa.text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def _as_role(su, role: str, sql: str, params=None):
    """Run sql as `role` in a rolled-back transaction. Returns rows or the DB error class name."""
    with su.connect() as conn:
        tx = conn.begin()
        try:
            conn.execute(sa.text(f"SET LOCAL ROLE {role}"))
            assert conn.execute(sa.text("SELECT current_user")).scalar() == role
            result = conn.execute(sa.text(sql), params or {})
            return result.fetchall() if result.returns_rows else "ok"
        except sa.exc.DBAPIError as exc:
            return type(exc.orig).__name__
        finally:
            tx.rollback()


def test_baseline_mirrors_production_exposure(db):
    su, _ = db
    assert _as_role(su, "anon", "SELECT id FROM bots") == [("prod-bot",)]


def test_browser_roles_have_no_privileges_after_migration(db):
    su, owner = db
    _alembic(owner, "upgrade", "head")
    with su.connect() as conn:
        rows = conn.execute(sa.text(
            "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, "
            "has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), "
            "has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') "
            "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind = 'r'"
        )).all()
        seq = conn.execute(sa.text(
            "SELECT has_sequence_privilege('anon', 'public.legacy_seq', 'USAGE,SELECT,UPDATE'), "
            "has_sequence_privilege('authenticated', 'public.legacy_seq', 'USAGE,SELECT,UPDATE')"
        )).one()
    by_name = {r[0]: r[1:] for r in rows}
    assert set(PRIVATE) <= set(by_name)
    for table, (rls, forced, anon, authed) in by_name.items():
        assert rls and not forced, table
        assert not anon and not authed, table
    assert seq == (False, False)


@pytest.mark.parametrize("role", BROWSER)
@pytest.mark.parametrize("table", PRIVATE)
def test_browser_role_cannot_read_or_write(db, role, table):
    su, owner = db
    _alembic(owner, "upgrade", "head")
    denied = "InsufficientPrivilege"
    assert _as_role(su, role, f'SELECT * FROM public."{table}" LIMIT 1') == denied
    assert _as_role(su, role, f'DELETE FROM public."{table}"') == denied
    assert _as_role(su, role, f'UPDATE public."{table}" SET {_any_column(su, table)} = {_any_column(su, table)}') == denied
    assert _as_role(su, role, f'INSERT INTO public."{table}" DEFAULT VALUES') == denied
    assert _as_role(su, role, f'TRUNCATE public."{table}"') == denied


def _any_column(su, table: str) -> str:
    with su.connect() as conn:
        return conn.execute(sa.text(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' "
            "AND table_name = :t ORDER BY ordinal_position LIMIT 1"
        ), {"t": table}).scalar()


def test_regranted_table_still_returns_nothing(db):
    """Defense in depth: a later accidental GRANT exposes no rows because RLS has no policies."""
    su, owner = db
    _alembic(owner, "upgrade", "head")
    with su.connect() as conn:
        conn.execute(sa.text("GRANT SELECT, UPDATE ON bots, credit_accounts TO authenticated"))
        conn.commit()
    assert _as_role(su, "authenticated", "SELECT id FROM bots") == []
    assert _as_role(su, "authenticated", "UPDATE credit_accounts SET balance = 999999") == "ok"
    with su.connect() as conn:
        assert conn.execute(sa.text("SELECT count(*) FROM bots")).scalar() == 1


def test_future_tables_get_no_browser_grants(db):
    su, owner = db
    _alembic(owner, "upgrade", "head")
    oe = sa.create_engine(owner)
    with oe.begin() as conn:
        conn.execute(sa.text("CREATE TABLE public.added_later (id int)"))
        conn.execute(sa.text("CREATE SEQUENCE public.added_later_seq"))
        from app.db_security import browser_exposed_tables

        exposed = browser_exposed_tables(conn)
    oe.dispose()
    assert _as_role(su, "anon", "SELECT * FROM added_later") == "InsufficientPrivilege"
    assert _as_role(su, "authenticated", "SELECT nextval('added_later_seq')") == "InsufficientPrivilege"
    assert exposed == ["added_later"]


def test_backend_owner_keeps_full_access(db):
    su, owner = db
    _alembic(owner, "upgrade", "head")
    from tests.test_pg_migrations import ORM_ROUNDTRIP

    a, b = uuid.uuid4(), uuid.uuid4()
    with su.begin() as conn:
        conn.execute(sa.text("SET LOCAL ROLE supabase_auth_admin"))
        conn.execute(sa.text("INSERT INTO auth.users (id) VALUES (:a), (:b)"), {"a": a, "b": b})
    script = ORM_ROUNDTRIP.replace("a, b = uuid.uuid4(), uuid.uuid4()", f"a, b = uuid.UUID('{a}'), uuid.UUID('{b}')")
    assert script != ORM_ROUNDTRIP
    proc = _run(owner, "-c", script)
    import json

    out = json.loads(proc.stdout.strip().splitlines()[-1])
    assert out["profiles"] == 2 and out["a_runs"] == ["pg_run_a"] and out["b_denied_404"] is True
    oe = sa.create_engine(owner)
    with oe.connect() as conn:
        from app.db_security import browser_exposed_tables, rls_blocked_tables

        assert rls_blocked_tables(conn) == []
        assert browser_exposed_tables(conn) == []
        assert conn.execute(sa.text("SELECT count(*) FROM bots")).scalar() == 1
    oe.dispose()


def test_non_owner_backend_role_is_detected(db):
    """A DATABASE_URL for a role that is not the owner would silently see empty tables."""
    su, owner = db
    _alembic(owner, "upgrade", "head")
    with su.connect() as conn:
        conn.execute(sa.text("GRANT USAGE ON SCHEMA public TO convolve_reader"))
        conn.execute(sa.text("GRANT SELECT ON ALL TABLES IN SCHEMA public TO convolve_reader"))
        conn.commit()
    reader = sa.create_engine(make_url(owner).set(username="convolve_reader"))
    with reader.connect() as conn:
        from app.db_security import rls_blocked_tables

        assert conn.execute(sa.text("SELECT count(*) FROM bots")).scalar() == 0
        assert set(PRIVATE) <= set(rls_blocked_tables(conn))
    reader.dispose()
    proc = _run(make_url(owner).set(username="convolve_reader").render_as_string(hide_password=False),
                "-m", "app.jobs.train_worker", "--check", ok=False)
    assert proc.returncode == 1
    assert "FAIL row level security lets this user see its tables: alembic_version" in proc.stderr + proc.stdout


def test_worker_check_passes_for_owner_and_fails_when_exposed(db):
    su, owner = db
    _alembic(owner, "upgrade", "head")
    good = _run(owner, "-m", "app.jobs.train_worker", "--check", ok=False)
    assert good.returncode == 0, good.stderr[-1500:]
    with su.connect() as conn:
        conn.execute(sa.text("GRANT SELECT ON profiles TO anon"))
        conn.commit()
    bad = _run(owner, "-m", "app.jobs.train_worker", "--check", ok=False)
    assert bad.returncode == 1
    assert "profiles" in bad.stderr + bad.stdout


CANARY = "canary-pw-7f3a"


def _check(url: str, **env) -> subprocess.CompletedProcess:
    proc = subprocess.run([sys.executable, "-m", "app.jobs.train_worker", "--check"], cwd=BACKEND,
                          env={**_env(url), **env}, capture_output=True, text=True, timeout=180)
    return proc


def _with_password(url: str) -> str:
    return make_url(url).set(password=CANARY).render_as_string(hide_password=False)


def test_worker_check_on_production_shaped_baseline_is_read_only_and_explains(db):
    """Production today: bot tables only, locked down. The check must say what is missing and change nothing."""
    su, owner = db
    with su.connect() as conn:
        for table in ("alembic_version", "bots", "bot_runs", "bot_trades", "bot_equity_snapshots"):
            conn.execute(sa.text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
            conn.execute(sa.text(f"REVOKE ALL ON {table} FROM anon, authenticated"))
        conn.commit()
        before = conn.execute(sa.text("SELECT version_num FROM alembic_version")).scalar()
    proc = _check(_with_password(owner))
    out = proc.stdout + proc.stderr
    assert proc.returncode == 1
    assert "OK   read-only session" in out
    assert f"FAIL schema revision: database={BASELINE}" in out
    assert "FAIL table pipeline_runs: missing" in out
    assert "OK   tables closed to browser roles" in out
    assert CANARY not in out
    with su.connect() as conn:
        assert conn.execute(sa.text("SELECT version_num FROM alembic_version")).scalar() == before
        assert conn.execute(sa.text(
            "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pipeline_runs'")).scalar() == 0


def test_worker_check_cannot_write(db):
    _, owner = db
    _alembic(owner, "upgrade", "head")
    code = (
        "import app.db_security as s\n"
        "from sqlalchemy import text\n"
        "def write(conn, require_ssl):\n"
        "    conn.execute(text(\"UPDATE bots SET name = 'x'\"))\n"
        "    return []\n"
        "s.worker_database_checks = write\n"
        "from app.jobs import train_worker\n"
        "try:\n"
        "    train_worker.check_access()\n"
        "    print('WROTE')\n"
        "except Exception as exc:\n"
        "    print(type(getattr(exc, 'orig', exc)).__name__)\n"
    )
    proc = _run(owner, "-c", code)
    assert proc.stdout.strip().splitlines()[-1] == "ReadOnlySqlTransaction"


def test_worker_check_passes_on_head_and_hides_credentials(db):
    _, owner = db
    _alembic(owner, "upgrade", "head")
    proc = _check(_with_password(owner))
    out = proc.stdout + proc.stderr
    assert proc.returncode == 0, out[-2000:]
    assert "Training worker can run with this configuration" in out
    assert CANARY not in out
    unreachable = make_url(owner).set(password=CANARY, host="/nonexistent-socket-dir").render_as_string(hide_password=False)
    bad = _check(unreachable, APP_PROFILE="cloud")
    assert bad.returncode != 0
    assert CANARY not in bad.stdout + bad.stderr


def test_worker_check_requires_tls_in_cloud(db):
    _, owner = db
    _alembic(owner, "upgrade", "head")
    proc = _check(owner, APP_PROFILE="cloud", MODEL_BUCKET="")
    out = proc.stdout + proc.stderr
    assert proc.returncode == 1
    assert "FAIL client connection encrypted: not encrypted" in out


def test_supabase_auth_keeps_working(db):
    su, owner = db
    _alembic(owner, "upgrade", "head")
    user = uuid.uuid4()
    with su.connect() as conn:
        conn.execute(sa.text("SET ROLE supabase_auth_admin"))
        conn.execute(sa.text("INSERT INTO auth.users (id, email) VALUES (:id, 'a@example.invalid')"), {"id": user})
        conn.commit()
    oe = sa.create_engine(owner)
    with oe.begin() as conn:
        conn.execute(sa.text("INSERT INTO profiles (id, email) VALUES (:id, 'a@example.invalid')"), {"id": user})
        conn.execute(sa.text("INSERT INTO credit_accounts (user_id, balance, version) VALUES (:id, 5, 1)"), {"id": user})
    with su.connect() as conn:
        assert conn.execute(sa.text(
            "SELECT has_table_privilege('authenticated', 'auth.users', 'SELECT')")).scalar() is True
        conn.execute(sa.text("SET ROLE supabase_auth_admin"))
        conn.execute(sa.text("DELETE FROM auth.users WHERE id = :id"), {"id": user})
        conn.commit()
    with oe.connect() as conn:
        assert conn.execute(sa.text("SELECT count(*) FROM profiles")).scalar() == 0
        assert conn.execute(sa.text("SELECT count(*) FROM credit_accounts")).scalar() == 0
    oe.dispose()


def test_downgrade_and_upgrade_again_as_owner(db):
    su, owner = db
    _alembic(owner, "upgrade", "head")
    _alembic(owner, "downgrade", BASELINE)
    assert _as_role(su, "anon", "SELECT id FROM bots") == "InsufficientPrivilege"
    _alembic(owner, "upgrade", "head")
    assert _as_role(su, "anon", "SELECT * FROM profiles") == "InsufficientPrivilege"
