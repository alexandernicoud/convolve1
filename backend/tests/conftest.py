"""Isolated sqlite + JWT secret. Must run before any app import."""

from __future__ import annotations

import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone

os.environ["CONVOLVE_TEST"] = "1"
os.environ["AUTH_REQUIRED"] = "true"
os.environ["APP_PROFILE"] = "local"
os.environ["SUPABASE_JWT_SECRET"] = "test-jwt-secret-convolve-hs256-key-32ch"
os.environ["SUPABASE_URL"] = ""
os.environ["SUPABASE_JWT_AUDIENCE"] = "authenticated"
os.environ["LIVE_DEPLOY_ENABLED"] = "false"
os.environ["SCHEDULED_BOTS_ENABLED"] = "false"
os.environ["RUN_BOTS_ON_API_STARTUP"] = "false"

_fd, _db_path = tempfile.mkstemp(suffix=".db")
os.close(_fd)
# CONVOLVE_TEST_DATABASE_URL runs the suite against a disposable, already migrated Postgres
# database (e.g. for row-lock and unique-constraint behaviour). Never a shared server.
os.environ["DATABASE_URL"] = os.environ.get("CONVOLVE_TEST_DATABASE_URL") or f"sqlite:///{_db_path}"

import jwt  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import PipelineRun  # noqa: E402
from app.db import SessionLocal  # noqa: E402

JWT_SECRET = os.environ["SUPABASE_JWT_SECRET"]
AUDIENCE = "authenticated"


def mint_token(user_id: uuid.UUID, *, expired: bool = False, secret: str = JWT_SECRET) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": f"{user_id.hex[:8]}@test.local",
        "aud": AUDIENCE,
        "role": "authenticated",
        "iat": int(now.timestamp()),
        "exp": int((now - timedelta(hours=1) if expired else now + timedelta(hours=1)).timestamp()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest.fixture(scope="session", autouse=True)
def _db_schema() -> None:
    init_db()
    from app.db import engine
    from sqlalchemy import text

    if engine.dialect.name == "postgresql":
        # Supabase provides auth.users; account deletion removes the caller's row from it.
        with engine.begin() as conn:
            conn.execute(text("create schema if not exists auth"))
            conn.execute(text("create table if not exists auth.users (id uuid primary key)"))


def _profiled(uid: uuid.UUID) -> uuid.UUID:
    """A signed-in user: the first authenticated request creates the profile row."""
    from app.auth import ensure_profile

    ensure_profile(uid)
    return uid


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def user_a() -> uuid.UUID:
    return _profiled(uuid.uuid4())


@pytest.fixture
def user_b() -> uuid.UUID:
    return _profiled(uuid.uuid4())
