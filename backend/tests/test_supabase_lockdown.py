"""Rehearsal of deploy/supabase_lockdown on a replica of the production Supabase database.

Needs CONVOLVE_PG_ADMIN_URL (superuser on a disposable PostgreSQL 17 server) on which
"postgres" is not a superuser, because the replica recreates Supabase's role layout:
- postgres: NOSUPERUSER, BYPASSRLS, owner of the app tables, member of anon/authenticated;
- authenticator (PostgREST) switches to anon/authenticated with SET ROLE;
- the public schema ACL and default ACLs of postgres and supabase_admin as read from production;
- auth.users owned by supabase_auth_admin;
- the production schema at Alembic 289c17a09fbb with comparable rows.
The production API (git commit 6dea84d) is run against the replica before and after the patch.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url

BACKEND = Path(__file__).resolve().parents[1]
LOCKDOWN = BACKEND / "deploy" / "supabase_lockdown"
ADMIN_URL = os.getenv("CONVOLVE_PG_ADMIN_URL", "").strip()
BASELINE = "289c17a09fbb"
PRODUCTION_API_COMMIT = "6dea84d"
APP_TABLES = ("alembic_version", "bots", "bot_runs", "bot_trades", "bot_equity_snapshots")
BROWSER = ("anon", "authenticated")
PROD_TABLE_ACL = "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"
PROD_PUBLIC_DEFAULTS = {
    ("postgres", "S"): "{postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}",
    ("postgres", "f"): "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
    ("postgres", "r"): PROD_TABLE_ACL,
    ("supabase_admin", "S"): "{postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}",
    ("supabase_admin", "f"): "{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}",
    ("supabase_admin", "r"): "{postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}",
}
PROD_COLUMNS = {
    "alembic_version": 1, "bot_equity_snapshots": 7, "bot_runs": 17, "bot_trades": 18, "bots": 27,
}
PROD_FKS = {
    ("bot_runs", "bot_id", "bots"), ("bot_equity_snapshots", "bot_id", "bots"),
    ("bot_equity_snapshots", "bot_run_id", "bot_runs"), ("bot_trades", "bot_id", "bots"),
    ("bot_trades", "exit_run_id", "bot_runs"), ("bot_trades", "prediction_run_id", "bot_runs"),
}


def acl(text: str | None) -> tuple:
    """ACL text as a sorted tuple of entries: ACLs are sets, their text order depends on grant order."""
    return tuple(sorted(text.strip("{}").split(","))) if text else ()


def _admin():
    return sa.create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")


def _usable() -> str:
    if not ADMIN_URL:
        return "CONVOLVE_PG_ADMIN_URL not set"
    try:
        with _admin().connect() as c:
            if c.execute(sa.text("show server_version_num")).scalar() < "170000":
                return "needs PostgreSQL 17"
            if c.execute(sa.text("select rolsuper from pg_roles where rolname = 'postgres'")).scalar():
                return "postgres is a superuser on this server; Supabase's layout cannot be replicated"
    except Exception as exc:  # noqa: BLE001
        return f"admin server unavailable: {exc}"
    return ""


SKIP = _usable()
pytestmark = pytest.mark.skipif(bool(SKIP), reason=SKIP or "ok")


@pytest.fixture(scope="module", autouse=True)
def _roles():
    assert "prod" not in ADMIN_URL.lower() and "supabase.co" not in ADMIN_URL.lower()
    with _admin().connect() as c:
        for name, attrs in (
            ("supabase_admin", "LOGIN SUPERUSER"),
            ("postgres", "LOGIN NOSUPERUSER CREATEROLE CREATEDB BYPASSRLS"),
            ("anon", "NOLOGIN"), ("authenticated", "NOLOGIN"), ("service_role", "NOLOGIN BYPASSRLS"),
            ("authenticator", "LOGIN NOINHERIT"), ("supabase_auth_admin", "LOGIN NOINHERIT CREATEROLE"),
        ):
            exists = c.execute(sa.text("select 1 from pg_roles where rolname = :n"), {"n": name}).scalar()
            c.execute(sa.text(f"{'ALTER' if exists else 'CREATE'} ROLE {name} {attrs}"))
        c.execute(sa.text("GRANT anon, authenticated, service_role TO authenticator"))
        c.execute(sa.text("GRANT anon, authenticated TO postgres"))


@pytest.fixture(scope="module")
def production_api(tmp_path_factory) -> Path:
    dest = tmp_path_factory.mktemp("prod_api")
    archive = subprocess.run(["git", "archive", PRODUCTION_API_COMMIT, "backend"], cwd=BACKEND.parent,
                             capture_output=True, check=True).stdout
    subprocess.run(["tar", "-x", "-C", str(dest)], input=archive, check=True)
    return dest / "backend"


class Replica:
    def __init__(self, name: str):
        base = make_url(ADMIN_URL).set(database=name)
        self.name = name
        self.su = sa.create_engine(base, isolation_level="AUTOCOMMIT")
        self.postgres_url = base.set(username="postgres", password=None).render_as_string(hide_password=False)
        self.postgres = sa.create_engine(self.postgres_url)
        self.authenticator = sa.create_engine(base.set(username="authenticator", password=None))
        self.auth_admin = sa.create_engine(base.set(username="supabase_auth_admin", password=None))

    def dispose(self):
        for e in (self.su, self.postgres, self.authenticator, self.auth_admin):
            e.dispose()

    def run_sql(self, filename: str, *flags: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(LOCKDOWN / "run_sql.py"), str(LOCKDOWN / filename), *flags],
            env={**os.environ, "LOCKDOWN_DB_URL": self.postgres_url}, capture_output=True, text=True, timeout=120,
        )

    def apply(self) -> subprocess.CompletedProcess:
        proc = self.run_sql("02_lockdown.sql")
        assert proc.returncode == 0, proc.stdout + proc.stderr
        return proc

    def as_browser(self, role: str, sql: str):
        """What PostgREST does: authenticator connects, then SET ROLE anon/authenticated."""
        with self.authenticator.connect() as conn:
            tx = conn.begin()
            try:
                conn.execute(sa.text(f"SET LOCAL ROLE {role}"))
                res = conn.execute(sa.text(sql))
                return res.fetchall() if res.returns_rows else "ok"
            except sa.exc.DBAPIError as exc:
                return type(exc.orig).__name__
            finally:
                tx.rollback()

    def catalog(self) -> dict:
        with self.su.connect() as c:
            rel = c.execute(sa.text("""
                select n.nspname || '.' || c.relname, c.relkind, c.relowner::regrole::text, c.relrowsecurity,
                       c.relforcerowsecurity, c.relacl::text
                from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
                  and c.relkind in ('r','p','v','m','S','f')""")).all()
            cols = c.execute(sa.text("""
                select c.relname || '.' || a.attname, a.attacl::text from pg_attribute a
                join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
                where n.nspname not in ('pg_catalog', 'information_schema') and a.attacl is not null""")).all()
            defaults = c.execute(sa.text("""
                select d.defaclrole::regrole::text, coalesce(n.nspname, '<global>'), d.defaclobjtype, d.defaclacl::text
                from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace""")).all()
            schemas = c.execute(sa.text("select nspname, nspowner::regrole::text, nspacl::text from pg_namespace")).all()
            roles = c.execute(sa.text("""
                select rolname, rolsuper, rolbypassrls, rolinherit, rolcanlogin from pg_roles
                where rolname in ('postgres','anon','authenticated','service_role','authenticator','supabase_auth_admin')""")).all()
            version = c.execute(sa.text("select version_num from alembic_version")).scalar()
        return {
            "relations": {r[0]: (*r[1:5], acl(r[5])) for r in rel},
            "column_acls": {k: acl(v) for k, v in cols},
            "defaults": {(r[0], r[1], r[2]): acl(r[3]) for r in defaults},
            "schemas": {r[0]: (r[1], acl(r[2])) for r in schemas},
            "roles": {r[0]: tuple(r[1:]) for r in roles},
            "alembic_version": version,
        }


def _alembic(url: str, *args: str) -> None:
    proc = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND,
                          env={**os.environ, "DATABASE_URL": url, "CONVOLVE_TEST": "1", "APP_PROFILE": "local"},
                          capture_output=True, text=True, timeout=180)
    assert proc.returncode == 0, proc.stderr[-2000:]


@pytest.fixture
def replica():
    name = f"convolve_replica_{uuid.uuid4().hex[:10]}"
    with _admin().connect() as c:
        c.execute(sa.text(f'CREATE DATABASE "{name}" OWNER postgres'))
    r = Replica(name)
    with r.su.connect() as c:
        for stmt in (
            "GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role",
            *(
                f"ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA public GRANT ALL ON {kind} TO postgres, anon, authenticated, service_role"
                for owner in ("postgres", "supabase_admin") for kind in ("TABLES", "SEQUENCES", "FUNCTIONS")
            ),
            "CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin",
            "GRANT USAGE ON SCHEMA auth TO postgres, anon, authenticated, service_role",
            "ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON TABLES TO postgres",
            "SET ROLE supabase_auth_admin",
            "CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb, created_at timestamptz DEFAULT now())",
            "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$",
            "GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated",
            "RESET ROLE",
        ):
            c.execute(sa.text(stmt))
    _alembic(r.postgres_url, "upgrade", BASELINE)
    with r.auth_admin.begin() as c:
        c.execute(sa.text("""INSERT INTO auth.users (id, email, raw_app_meta_data)
                             VALUES (gen_random_uuid(), 'owner@example.invalid', '{"provider": "google"}')"""))
    with r.postgres.begin() as c:
        bot_cols = ("id, user_id, name, symbol, model_path, confidence_threshold, img_size, tp_pct, sl_pct, runtime_days, "
                    "run_time, timezone, is_active, lifecycle_state, starting_capital, horizon_days, position_size_pct, "
                    "commission_pct, slippage_pct, created_at, updated_at")
        for bot_id, active, state in (("bot-active", True, "active"), ("bot-archived", False, "archived")):
            c.execute(sa.text(f"""INSERT INTO bots ({bot_cols}) VALUES (:id, 'local-user', 'AAPL bot', 'AAPL',
                '/Users/someone/bot_data/models/m.keras', 0.5, 224, 2, 1, 30, '09:30', 'America/New_York', :active,
                :state, 10000, 5, 10, 0.1, 0.05, now() - interval '3 days', now())"""),
                {"id": bot_id, "active": active, "state": state})
        for i in (1, 2):
            c.execute(sa.text("""INSERT INTO bot_runs (id, bot_id, run_at, status, signal, confidence, equity, created_at)
                                 VALUES (:id, 'bot-active', now() - make_interval(days => :i), 'success', 'BUY', 0.7, 10000, now())"""),
                      {"id": f"run-{i}", "i": i})
        c.execute(sa.text("""INSERT INTO bot_trades (id, bot_id, prediction_run_id, entry_date, entry_price, position_notional,
                                 horizon_days, expiry_date, status, created_at)
                             VALUES ('trade-1', 'bot-active', 'run-1', current_date - 1, 100, 1000, 5, current_date + 4, 'open', now())"""))
        for i in (1, 2, 3):
            c.execute(sa.text("""INSERT INTO bot_equity_snapshots (id, bot_id, as_of, total_equity, realized_pnl, bot_run_id)
                                 VALUES (:id, 'bot-active', now() - make_interval(days => :i), 10000, 0, 'run-1')"""),
                      {"id": f"snap-{i}", "i": i})
    try:
        yield r
    finally:
        r.dispose()
        with _admin().connect() as c:
            c.execute(sa.text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


def _changed(before: dict, after: dict) -> dict:
    out = {}
    for section in ("relations", "column_acls", "defaults", "schemas", "roles"):
        keys = set(before[section]) | set(after[section])
        diff = {k for k in keys if before[section].get(k) != after[section].get(k)}
        if diff:
            out[section] = diff
    return out


PRODUCTION_API_PROBE = r"""
import json, os
from app.db import engine
assert engine.dialect.name == "postgresql", engine.dialect.name
from fastapi.testclient import TestClient
from app.main import app
from app.db import SessionLocal
from app.models import BotRun
out = {}
with TestClient(app) as c:
    bots = c.get("/api/bots")
    out["GET /api/bots"] = [bots.status_code, sorted(b["id"] for b in bots.json())]
    for path in ("/api/bots/bot-active", "/api/bots/bot-active/runs", "/api/bots/bot-active/trading",
                 "/api/dashboard/bundle", "/api/dashboard/trades"):
        out["GET " + path] = c.get(path).status_code
    out["POST pause"] = c.post("/api/bots/bot-active/pause").status_code
    out["POST resume"] = c.post("/api/bots/bot-active/resume").status_code
with SessionLocal() as db:
    from datetime import datetime, timezone
    db.add(BotRun(id="probe-run", bot_id="bot-active", status="success", run_at=datetime.now(timezone.utc)))
    db.commit()
    out["orm insert"] = db.get(BotRun, "probe-run") is not None
    db.delete(db.get(BotRun, "probe-run"))
    db.commit()
    out["orm delete"] = db.get(BotRun, "probe-run") is None
print(json.dumps(out))
"""


def _probe_production_api(api_dir: Path, url: str) -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CONVOLVE_", "AUTH_", "SUPABASE_"))}
    env.update({"DATABASE_URL": url, "APP_PROFILE": "cloud", "USER_ID": "local-user", "PYTHONPATH": str(api_dir),
                "SCHEDULED_BOTS_ENABLED": "false", "RUN_BOTS_ON_API_STARTUP": "false"})
    proc = subprocess.run([sys.executable, "-c", PRODUCTION_API_PROBE], cwd=api_dir, env=env,
                          capture_output=True, text=True, timeout=300)
    assert proc.returncode == 0, proc.stderr[-3000:]
    return json.loads(proc.stdout.strip().splitlines()[-1])


# --- replica fidelity -------------------------------------------------------------------------

def test_replica_matches_production_catalog(replica):
    cat = replica.catalog()
    public = {k.split(".", 1)[1]: v for k, v in cat["relations"].items() if k.startswith("public.")}
    assert set(public) == set(APP_TABLES)
    for name, (kind, owner, rls, forced, entries) in public.items():
        assert (kind, owner, rls, forced, entries) == ("r", "postgres", False, False, acl(PROD_TABLE_ACL)), name
    public_defaults = {(role, kind): v for (role, nsp, kind), v in cat["defaults"].items() if nsp == "public"}
    assert public_defaults == {k: acl(v) for k, v in PROD_PUBLIC_DEFAULTS.items()}
    assert cat["roles"]["postgres"] == (False, True, True, True)
    assert cat["alembic_version"] == BASELINE
    with replica.su.connect() as c:
        cols = dict(c.execute(sa.text("""select table_name, count(*) from information_schema.columns
                                          where table_schema = 'public' group by 1""")).all())
        fks = set(c.execute(sa.text("""
            select cl.relname, a.attname, rc.relname from pg_constraint k
            join pg_class cl on cl.oid = k.conrelid join pg_class rc on rc.oid = k.confrelid
            join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
            join pg_namespace n on n.oid = cl.relnamespace where k.contype = 'f' and n.nspname = 'public'""")).all())
    assert cols == PROD_COLUMNS
    assert fks == PROD_FKS


def test_before_patch_the_data_api_exposes_everything(replica):
    assert len(replica.as_browser("anon", "SELECT id FROM bots")) == 2
    assert replica.as_browser("anon", "UPDATE bots SET name = 'pwned'") == "ok"
    assert replica.as_browser("authenticated", "DELETE FROM bot_trades") == "ok"
    assert replica.run_sql("03_verify.sql", "--read-only").returncode == 1


# --- the patch ------------------------------------------------------------------------------

def test_patch_runs_as_non_superuser_postgres_and_verifies(replica):
    proc = replica.apply()
    assert "connected as postgres" in proc.stdout
    verify = replica.run_sql("03_verify.sql", "--read-only")
    assert verify.returncode == 0, verify.stdout
    assert "CHECKS FAILED" not in verify.stdout


@pytest.mark.parametrize("role", BROWSER)
def test_browser_roles_cannot_read_or_modify_any_app_table(replica, role):
    replica.apply()
    denied = "InsufficientPrivilege"
    for table in APP_TABLES:
        col = "version_num" if table == "alembic_version" else "id"
        assert replica.as_browser(role, f"SELECT * FROM public.{table} LIMIT 1") == denied, table
        assert replica.as_browser(role, f"SELECT count(*) FROM public.{table}") == denied, table
        assert replica.as_browser(role, f"INSERT INTO public.{table} ({col}) VALUES ('x')") == denied, table
        assert replica.as_browser(role, f"UPDATE public.{table} SET {col} = {col}") == denied, table
        assert replica.as_browser(role, f"DELETE FROM public.{table}") == denied, table
        assert replica.as_browser(role, f"TRUNCATE public.{table}") == denied, table


def test_column_level_access_is_gone(replica):
    replica.apply()
    with replica.su.connect() as c:
        rows = c.execute(sa.text("""
            select table_name, grantee, privilege_type from information_schema.column_privileges
            where table_schema = 'public' and grantee in ('anon', 'authenticated')""")).all()
    assert rows == []


def test_production_api_behaves_identically_after_lockdown(replica, production_api):
    before = _probe_production_api(production_api, replica.postgres_url)
    replica.apply()
    after = _probe_production_api(production_api, replica.postgres_url)
    assert before == after
    assert after["GET /api/bots"] == [200, ["bot-active"]]
    assert all(after[k] == 200 for k in after if k.startswith("GET /api/") and k != "GET /api/bots"), after
    assert after["POST pause"] == 200
    assert after["orm insert"] and after["orm delete"]
    with replica.postgres.connect() as c:
        assert c.execute(sa.text("select count(*) from bot_equity_snapshots")).scalar() == 3


def test_patch_is_idempotent(replica):
    replica.apply()
    first = replica.catalog()
    second_run = replica.apply()
    assert _changed(first, replica.catalog()) == {}
    assert "FAILED" not in second_run.stdout


def test_patch_changes_only_app_tables_and_postgres_public_defaults(replica):
    before = replica.catalog()
    replica.apply()
    after = replica.catalog()
    changed = _changed(before, after)
    assert changed.pop("relations") == {f"public.{t}" for t in APP_TABLES}
    assert changed.pop("defaults") == {("postgres", "public", k) for k in ("r", "S", "f")}
    assert changed == {}
    assert after["alembic_version"] == BASELINE
    for t in APP_TABLES:
        _, owner, rls, forced, entries = after["relations"][f"public.{t}"]
        assert (owner, rls, forced, entries) == (
            "postgres", True, False, acl("{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"))
    assert all(v == before["defaults"][key] for key, v in after["defaults"].items() if key[0] == "supabase_admin")


def test_supabase_auth_is_unaffected(replica):
    replica.apply()
    user = uuid.uuid4()
    with replica.auth_admin.begin() as c:
        c.execute(sa.text("INSERT INTO auth.users (id, email) VALUES (:id, 'new@example.invalid')"), {"id": user})
        c.execute(sa.text("UPDATE auth.users SET email = 'changed@example.invalid' WHERE id = :id"), {"id": user})
    with replica.postgres.connect() as c:
        assert c.execute(sa.text("select count(*) from auth.users")).scalar() == 2
    assert replica.as_browser("authenticated", "SELECT auth.uid()") == [(None,)]
    with replica.auth_admin.begin() as c:
        c.execute(sa.text("DELETE FROM auth.users WHERE id = :id"), {"id": user})


def test_patch_waits_at_most_lock_timeout_and_leaves_nothing_half_done(replica):
    before = replica.catalog()
    with replica.postgres.connect() as holder:
        tx = holder.begin()
        holder.execute(sa.text("SELECT count(*) FROM bot_runs"))
        proc = replica.run_sql("02_lockdown.sql")
        tx.rollback()
    assert proc.returncode == 1
    assert "lock timeout" in proc.stderr.lower()
    assert _changed(before, replica.catalog()) == {}
    replica.apply()


# --- rollback -------------------------------------------------------------------------------

def test_partial_rollback_turns_off_rls_but_keeps_browser_roles_out(replica):
    replica.apply()
    proc = replica.run_sql("98_rollback_rls_only.sql")
    assert proc.returncode == 0, proc.stderr
    cat = replica.catalog()
    assert all(not cat["relations"][f"public.{t}"][2] for t in APP_TABLES)
    assert replica.as_browser("anon", "SELECT * FROM bots") == "InsufficientPrivilege"
    replica.apply()


def test_full_rollback_restores_the_exact_prior_state(replica):
    before = replica.catalog()
    replica.apply()
    proc = replica.run_sql("99_rollback_full.sql")
    assert proc.returncode == 0, proc.stderr
    assert _changed(before, replica.catalog()) == {}
    assert len(replica.as_browser("anon", "SELECT id FROM bots")) == 2
    replica.apply()
    assert replica.as_browser("anon", "SELECT id FROM bots") == "InsufficientPrivilege"


def test_backup_captures_prior_state_and_restores(replica, tmp_path):
    proc = subprocess.run([sys.executable, str(LOCKDOWN / "backup.py"), str(tmp_path)],
                          env={**os.environ, "LOCKDOWN_DB_URL": replica.postgres_url},
                          capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr
    (backup,) = tmp_path.iterdir()
    assert oct(backup.stat().st_mode & 0o777) == "0o700"
    catalog = json.loads((backup / "catalog.json").read_text())
    assert catalog["row_counts"] == {"alembic_version": 1, "bot_equity_snapshots": 3, "bot_runs": 2,
                                     "bot_trades": 1, "bots": 2}
    assert any(r[0] == "bots" and "anon=arwdDxtm/postgres" in r[5] for r in catalog["relations"])
    replica.apply()
    order = ("bots", "bot_runs", "bot_trades", "bot_equity_snapshots")
    raw = replica.postgres.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute("TRUNCATE bots, bot_runs, bot_trades, bot_equity_snapshots")
        for table in order:
            with open(backup / f"{table}.csv", encoding="utf-8") as fh:
                cur.copy_expert(f"COPY public.{table} FROM STDIN WITH (FORMAT csv, HEADER true)", fh)
        raw.commit()
    finally:
        raw.close()
    with replica.postgres.connect() as c:
        counts = {t: c.execute(sa.text(f"select count(*) from {t}")).scalar() for t in order}
    assert counts == {"bots": 2, "bot_runs": 2, "bot_trades": 1, "bot_equity_snapshots": 3}


# --- forward compatibility and residual risk ---------------------------------------------------

def test_release_migrations_still_apply_after_the_standalone_patch(replica):
    replica.apply()
    _alembic(replica.postgres_url, "upgrade", "head")
    with replica.postgres.connect() as c:
        from app.db_security import browser_exposed_tables, rls_blocked_tables

        assert rls_blocked_tables(c) == []
        assert browser_exposed_tables(c) == []
        tables = c.execute(sa.text("select tablename from pg_tables where schemaname = 'public'")).scalars().all()
    assert {"profiles", "pipeline_runs", "user_datasets", "user_models", "credit_ledger"} <= set(tables)
    for table in tables:
        assert replica.as_browser("anon", f"SELECT 1 FROM public.{table} LIMIT 1") == "InsufficientPrivilege", table


def test_tables_created_by_postgres_later_are_not_exposed(replica):
    replica.apply()
    with replica.postgres.begin() as c:
        c.execute(sa.text("CREATE TABLE public.later_by_postgres (id int)"))
    assert replica.as_browser("anon", "SELECT * FROM later_by_postgres") == "InsufficientPrivilege"


def test_residual_risk_supabase_admin_tables_are_flagged_by_verify(replica):
    replica.apply()
    with replica.su.connect() as c:
        c.execute(sa.text("SET ROLE supabase_admin"))
        c.execute(sa.text("CREATE TABLE public.later_by_supabase_admin (id int)"))
    assert replica.as_browser("anon", "SELECT * FROM later_by_supabase_admin") == []
    verify = replica.run_sql("03_verify.sql", "--read-only")
    assert verify.returncode == 1
    assert "later_by_supabase_admin" in verify.stdout
