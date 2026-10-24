"""Alembic migrations on real PostgreSQL (and SQLite via Alembic).

PostgreSQL tests run only when CONVOLVE_PG_ADMIN_URL points at a server where
this user may create and drop databases, e.g.
    CONVOLVE_PG_ADMIN_URL=postgresql://postgres:@/postgres?host=/tmp/pgdata
Never point it at a production server.

Alembic reads DATABASE_URL at import time, so each migration runs in a subprocess.
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
ADMIN_URL = os.getenv("CONVOLVE_PG_ADMIN_URL", "").strip()
BASELINE = "289c17a09fbb"
HEAD = "d2a7f4c9b351"
UUID_COLUMNS = {
    ("profiles", "id"),
    ("credit_accounts", "user_id"),
    ("credit_ledger", "id"),
    ("credit_ledger", "user_id"),
    ("pipeline_runs", "user_id"),
    ("user_datasets", "user_id"),
    ("user_models", "user_id"),
    ("asset_labels", "user_id"),
    ("user_plans", "user_id"),
    ("deleted_accounts", "user_id"),
}

needs_pg = pytest.mark.skipif(not ADMIN_URL, reason="CONVOLVE_PG_ADMIN_URL not set")


def _env(url: str) -> dict:
    return {**os.environ, "CONVOLVE_TEST": "1", "DATABASE_URL": url, "APP_PROFILE": "local"}


def _alembic(url: str, *args: str) -> str:
    proc = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND, env=_env(url), capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, proc.stderr[-2000:]
    return proc.stdout + proc.stderr


def _python(url: str, code: str) -> dict:
    proc = subprocess.run(
        [sys.executable, "-c", code],
        cwd=BACKEND, env=_env(url), capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, proc.stderr[-2000:]
    return json.loads(proc.stdout.strip().splitlines()[-1])


@pytest.fixture
def pg_url():
    name = f"convolve_mig_{uuid.uuid4().hex[:10]}"
    admin = sa.create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    assert "prod" not in ADMIN_URL.lower()
    with admin.connect() as conn:
        conn.execute(sa.text(f'CREATE DATABASE "{name}"'))
    url = make_url(ADMIN_URL).set(database=name).render_as_string(hide_password=False)
    try:
        yield url
    finally:
        with admin.connect() as conn:
            conn.execute(sa.text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def _column_types(url: str) -> dict:
    engine = sa.create_engine(url)
    try:
        with engine.connect() as conn:
            rows = conn.execute(sa.text(
                "SELECT table_name, column_name, data_type FROM information_schema.columns "
                "WHERE table_schema = 'public'"
            )).all()
    finally:
        engine.dispose()
    return {(t, c): d for t, c, d in rows}


TYPE_DIFFS = """
import json
from sqlalchemy import create_engine
from alembic.migration import MigrationContext
from alembic.autogenerate import compare_metadata
from app.config import DATABASE_URL
from app.models import Base
engine = create_engine(DATABASE_URL)
with engine.connect() as conn:
    ctx = MigrationContext.configure(conn, opts={"compare_type": True})
    diffs = compare_metadata(ctx, Base.metadata)
flat = []
for d in diffs:
    flat.extend(d if isinstance(d, list) else [d])
print(json.dumps([[d[2], d[3]] for d in flat if d[0] == "modify_type"]))
"""

ORM_ROUNDTRIP = """
import json, uuid
from app.auth import ensure_profile
from app.ownership import record_pipeline_run, record_user_dataset, record_user_model, owned_run_ids, assert_run_owner
from app.db import SessionLocal
from app.models import Profile, PipelineRun
a, b = uuid.uuid4(), uuid.uuid4()
ensure_profile(a, email="a@example.invalid")
ensure_profile(b, email="b@example.invalid")
ensure_profile(a, email="a@example.invalid")
record_pipeline_run("pg_run_a", str(a), "trainer", status="queued")
record_user_dataset("pg_ds_a", str(a), source="uploaded", kind="uploaded", path="/x")
record_user_model("pg_model_a", str(a), source="trainer", storage_key="users/x/m.keras", path="gcs://b/m.keras")
denied = False
try:
    assert_run_owner("pg_run_a", str(b))
except Exception as exc:
    denied = getattr(exc, "status_code", None) == 404
db = SessionLocal()
row = db.get(PipelineRun, "pg_run_a")
print(json.dumps({
    "profiles": db.query(Profile).count(),
    "owner_type": type(row.user_id).__name__,
    "owner_ok": row.user_id == a,
    "a_runs": sorted(owned_run_ids(str(a))),
    "b_runs": sorted(owned_run_ids(str(b))),
    "b_denied_404": denied,
}))
db.close()
"""


@needs_pg
def test_fresh_database_upgrades_to_head_with_uuid_columns(pg_url):
    _alembic(pg_url, "upgrade", "head")
    assert HEAD in _alembic(pg_url, "current")
    types = _column_types(pg_url)
    for column in UUID_COLUMNS:
        assert types[column] == "uuid", (column, types[column])
    assert types[("bots", "user_id")] == "character varying"
    assert _python(pg_url, TYPE_DIFFS) == []


@needs_pg
def test_orm_ownership_roundtrip_on_migrated_schema(pg_url):
    """The staging failure was `operator does not exist: character = uuid` here."""
    _alembic(pg_url, "upgrade", "head")
    out = _python(pg_url, ORM_ROUNDTRIP)
    assert out["profiles"] == 2
    assert out["owner_type"] == "UUID" and out["owner_ok"]
    assert out["a_runs"] == ["pg_run_a"]
    assert out["b_runs"] == []
    assert out["b_denied_404"] is True


@needs_pg
def test_existing_bot_schema_upgrades_and_keeps_rows(pg_url):
    """A database already at the initial bot schema (pre-ownership) upgrades in place."""
    _alembic(pg_url, "upgrade", BASELINE)
    engine = sa.create_engine(pg_url)
    with engine.begin() as conn:
        cols = {r[0] for r in conn.execute(sa.text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'bots'"
        ))}
        values = {
            "id": "legacy-bot-1", "user_id": "legacy-owner", "symbol": "AAPL", "model_path": "m.keras",
            "confidence_threshold": 0.5, "img_size": 224, "is_active": True, "lifecycle_state": "active",
            "starting_capital": 10000.0, "horizon_days": 5, "position_size_pct": 1.0,
            "commission_pct": 0.0, "slippage_pct": 0.0,
        }
        assert set(values) <= cols
        conn.execute(
            sa.text(f"INSERT INTO bots ({', '.join(values)}) VALUES ({', '.join(':' + k for k in values)})"),
            values,
        )
    engine.dispose()
    _alembic(pg_url, "upgrade", "head")
    engine = sa.create_engine(pg_url)
    with engine.connect() as conn:
        assert conn.execute(sa.text("SELECT count(*) FROM bots WHERE id = 'legacy-bot-1'")).scalar() == 1
    engine.dispose()
    assert _column_types(pg_url)[("pipeline_runs", "user_id")] == "uuid"


@needs_pg
def test_downgrade_to_baseline_and_upgrade_again(pg_url):
    _alembic(pg_url, "upgrade", "head")
    _alembic(pg_url, "downgrade", BASELINE)
    assert ("profiles", "id") not in _column_types(pg_url)
    _alembic(pg_url, "upgrade", "head")
    assert _column_types(pg_url)[("profiles", "id")] == "uuid"


@needs_pg
def test_supabase_shaped_auth_users_foreign_key(pg_url):
    """Supabase keys auth.users by uuid; profiles.id must reference it."""
    engine = sa.create_engine(pg_url)
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE SCHEMA auth"))
        conn.execute(sa.text("CREATE TABLE auth.users (id uuid PRIMARY KEY)"))
    engine.dispose()
    _alembic(pg_url, "upgrade", "head")
    known, unknown = uuid.uuid4(), uuid.uuid4()
    engine = sa.create_engine(pg_url)
    try:
        with engine.connect() as conn:
            fk = conn.execute(sa.text(
                "SELECT confrelid::regclass::text FROM pg_constraint WHERE conname = 'fk_profiles_auth_users'"
            )).scalar()
        assert fk == "auth.users"
        with engine.begin() as conn:
            conn.execute(sa.text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": known})
            conn.execute(sa.text("INSERT INTO profiles (id) VALUES (:id)"), {"id": known})
        with pytest.raises(sa.exc.IntegrityError):
            with engine.begin() as conn:
                conn.execute(sa.text("INSERT INTO profiles (id) VALUES (:id)"), {"id": unknown})
        with engine.begin() as conn:
            conn.execute(sa.text("DELETE FROM auth.users WHERE id = :id"), {"id": known})
            assert conn.execute(sa.text("SELECT count(*) FROM profiles")).scalar() == 0
    finally:
        engine.dispose()


def test_sqlite_alembic_upgrade_head(tmp_path):
    """Local SQLite normally uses create_all; Alembic on SQLite must still work."""
    url = f"sqlite:///{tmp_path / 'alembic.db'}"
    _alembic(url, "upgrade", "head")
    assert HEAD in _alembic(url, "current")
    assert _python(url, TYPE_DIFFS) == []
    out = _python(url, ORM_ROUNDTRIP)
    assert out["a_runs"] == ["pg_run_a"] and out["b_runs"] == [] and out["b_denied_404"] is True
