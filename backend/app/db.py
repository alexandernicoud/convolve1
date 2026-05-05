"""
Database engine and sessions.

- **SQLite (local default):** `init_db()` runs `create_all` plus legacy `_sqlite_migrate` for
  older dev DB files. This path is convenience-only; it is not used for production.

- **Postgres / Supabase:** Schema is owned by **Alembic** (`alembic upgrade head`).
  `init_db()` only verifies connectivity and warns if migrations were not applied.

Configure `DATABASE_URL` in the environment (see `app.config` and `docs/DEPLOYMENT.md`).
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from app.config import APP_PROFILE, DATABASE_URL
from app.models import Base

logger = logging.getLogger(__name__)


def get_connect_args(url: str | None = None) -> dict[str, Any]:
    """DB-API connect args. SQLite needs check_same_thread=False for FastAPI."""
    u = url or DATABASE_URL
    if str(u).startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


def is_sqlite_url(url: str | None = None) -> bool:
    return str(url or DATABASE_URL).startswith("sqlite")


def _engine_kwargs(url: str | None = None) -> dict[str, Any]:
    u = url or DATABASE_URL
    kwargs: dict[str, Any] = {
        "pool_pre_ping": True,
        "connect_args": get_connect_args(u),
    }
    if not is_sqlite_url(u):
        # Sensible defaults for long-lived API / job workers (tune per deployment).
        kwargs["pool_size"] = 5
        kwargs["max_overflow"] = 10
    return kwargs


# Local-dev fallback target when the configured (Postgres/Supabase) DB is
# unreachable at startup. Intentionally identical to the SQLite default used
# elsewhere in dev so an existing local app.db keeps working.
_SQLITE_DEV_FALLBACK_URL = "sqlite:///./app.db"


def _create_engine_with_dev_fallback() -> tuple[str, Engine]:
    """
    Build the SQLAlchemy engine for ``DATABASE_URL``.

    In local/dev (``APP_PROFILE != "cloud"``), if the configured non-SQLite
    database refuses an opening connection (e.g. Supabase pooler is down or the
    network is offline), fall back to a local SQLite file so the backend still
    boots. In cloud mode the original behaviour is preserved: connection
    failures propagate so Cloud Run surfaces the outage instead of silently
    writing to an ephemeral SQLite file.

    Returns the (possibly rewritten) URL alongside the live engine.
    """
    primary_url = DATABASE_URL
    eng = create_engine(primary_url, **_engine_kwargs(primary_url))

    # SQLite is local-by-construction; nothing to test or fall back from.
    if is_sqlite_url(primary_url):
        return primary_url, eng

    try:
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        return primary_url, eng
    except Exception as exc:  # noqa: BLE001 — any driver/network failure should trigger fallback in dev.
        if APP_PROFILE == "cloud":
            logger.error(
                "Cloud database unreachable on startup; not falling back to SQLite. Error: %s",
                exc,
            )
            raise
        logger.warning(
            "Primary database unreachable; falling back to local SQLite for dev (%s). Error: %s",
            _SQLITE_DEV_FALLBACK_URL,
            exc,
        )
        try:
            eng.dispose()
        except Exception:  # noqa: BLE001 — disposing a half-initialised engine must not mask the real error.
            pass
        fallback_engine = create_engine(
            _SQLITE_DEV_FALLBACK_URL, **_engine_kwargs(_SQLITE_DEV_FALLBACK_URL)
        )
        return _SQLITE_DEV_FALLBACK_URL, fallback_engine


DATABASE_URL, engine = _create_engine_with_dev_fallback()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def is_sqlite_duplicate_column_error(exc: BaseException) -> bool:
    """
    True when SQLite rejected ADD COLUMN because the column already exists.

    Works for sqlite3.OperationalError and sqlalchemy.exc.OperationalError (and
    typical __cause__ / .orig chains from SQLAlchemy).
    """
    parts: list[str] = [str(exc)]
    orig = getattr(exc, "orig", None)
    if orig is not None:
        parts.append(str(orig))
    if exc.__cause__ is not None:
        parts.append(str(exc.__cause__))
    if exc.__context__ is not None and exc.__context__ is not exc.__cause__:
        parts.append(str(exc.__context__))
    msg = " ".join(parts).lower()
    return "duplicate column" in msg


def _sqlite_add_column(conn, table: str, col: str, typ: str) -> None:
    """ALTER TABLE ... ADD COLUMN; ignore duplicate-column only; re-raise other failures."""
    try:
        conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{col}" {typ}'))
    except Exception as e:
        if is_sqlite_duplicate_column_error(e):
            logger.debug(
                "SQLite ADD COLUMN skipped (column already exists): %s.%s — %s",
                table,
                col,
                e,
            )
            return
        logger.error("SQLite ADD COLUMN failed for %s.%s: %s", table, col, e)
        raise


def _sqlite_migrate(engine: Engine) -> None:
    """Legacy incremental ALTERs for old SQLite files. Not used for Postgres."""
    if engine.dialect.name != "sqlite":
        return

    columns = [
        ("bots", "model_filename", "TEXT"),
        ("bots", "run_time", "TEXT"),
        ("bots", "timezone", "TEXT"),
        ("bots", "last_run_at", "TIMESTAMP"),
        ("bots", "last_signal", "TEXT"),
        ("bots", "last_confidence", "FLOAT"),
        ("bots", "last_chart_date", "TIMESTAMP"),
        ("bots", "last_error", "TEXT"),
        ("bot_runs", "run_started_at", "TIMESTAMP"),
        ("bot_runs", "run_finished_at", "TIMESTAMP"),
        ("bot_runs", "signal", "TEXT"),
        ("bot_runs", "chart_date", "TIMESTAMP"),
        ("bot_runs", "created_at", "TIMESTAMP"),
        ("bot_runs", "run_metadata_json", "TEXT"),
        ("bots", "starting_capital", "FLOAT"),
        ("bots", "horizon_days", "INTEGER"),
        ("bots", "position_size_pct", "FLOAT"),
        ("bots", "commission_pct", "FLOAT"),
        ("bots", "slippage_pct", "FLOAT"),
        ("bots", "lifecycle_state", "TEXT"),
    ]

    with engine.begin() as conn:
        for table, col, typ in columns:
            _sqlite_add_column(conn, table, col, typ)

        try:
            conn.execute(
                text("UPDATE bot_runs SET run_started_at = run_at WHERE run_started_at IS NULL")
            )
        except Exception as e:
            logger.warning("SQLite backfill run_started_at: %s", e)
        try:
            conn.execute(
                text("UPDATE bot_runs SET signal = label WHERE signal IS NULL AND label IS NOT NULL")
            )
        except Exception as e:
            logger.warning("SQLite backfill signal: %s", e)
        try:
            conn.execute(
                text("UPDATE bot_runs SET created_at = run_at WHERE created_at IS NULL")
            )
        except Exception as e:
            logger.warning("SQLite backfill created_at: %s", e)

        for sql, label in (
            (
                "UPDATE bots SET starting_capital = 10000 WHERE starting_capital IS NULL",
                "starting_capital",
            ),
            ("UPDATE bots SET horizon_days = 5 WHERE horizon_days IS NULL", "horizon_days"),
            (
                "UPDATE bots SET position_size_pct = 10 WHERE position_size_pct IS NULL",
                "position_size_pct",
            ),
            (
                "UPDATE bots SET commission_pct = 0.1 WHERE commission_pct IS NULL",
                "commission_pct",
            ),
            (
                "UPDATE bots SET slippage_pct = 0.05 WHERE slippage_pct IS NULL",
                "slippage_pct",
            ),
        ):
            try:
                conn.execute(text(sql))
            except Exception as e:
                logger.warning("SQLite backfill %s: %s", label, e)

        try:
            conn.execute(text("UPDATE bots SET lifecycle_state = 'active' WHERE lifecycle_state IS NULL"))
            conn.execute(
                text(
                    "UPDATE bots SET lifecycle_state = 'paused' "
                    "WHERE lifecycle_state = 'active' AND is_active = 0"
                )
            )
        except Exception as e:
            logger.warning("SQLite backfill lifecycle_state: %s", e)


def _warn_sqlite_bots_user_id_nullable(engine: Engine) -> None:
    """ORM allows nullable user_id; warn if the on-disk SQLite column is still NOT NULL."""
    if engine.dialect.name != "sqlite":
        return
    insp = inspect(engine)
    try:
        tables = insp.get_table_names()
    except Exception as e:
        logger.warning("Could not inspect database tables: %s", e)
        return
    if "bots" not in tables:
        return
    try:
        cols = insp.get_columns("bots")
    except Exception as e:
        logger.warning("Could not inspect bots table: %s", e)
        return
    for c in cols:
        if c["name"] == "user_id" and c.get("nullable") is False:
            logger.warning(
                "Schema note: SQLite column bots.user_id is NOT NULL but the ORM allows NULL. "
                "INSERT/UPDATE with user_id=NULL will fail until you recreate this database file "
                "(e.g. delete the sqlite file used by DATABASE_URL) or run a manual table rebuild. "
                "New installs are unaffected."
            )
            return


def _warn_if_postgres_missing_migrations(engine: Engine) -> None:
    """Lightweight check: core tables should exist after `alembic upgrade head`."""
    if engine.dialect.name == "sqlite":
        return
    insp = inspect(engine)
    try:
        tables = set(insp.get_table_names())
    except Exception as e:
        logger.warning("Could not inspect database tables: %s", e)
        return
    if "alembic_version" in tables and "bots" in tables:
        return
    if "bots" not in tables:
        logger.warning(
            "Postgres/Supabase database has no 'bots' table. "
            "Apply migrations from backend/:  alembic upgrade head"
        )


def _log_active_database() -> None:
    """Emit a single, unambiguous line stating which DB the backend is connected to."""
    url = engine.url
    dialect = engine.dialect.name
    if dialect == "sqlite":
        logger.info("Database backend: SQLite (path=%s)", url.database)
        return

    host = url.host or "?"
    port = url.port or "?"
    database = url.database or "?"
    user = url.username or "?"
    is_supabase = "supabase" in (host or "").lower()
    logger.info(
        "Database backend: %s%s — host=%s port=%s database=%s user=%s",
        dialect,
        " (Supabase)" if is_supabase else "",
        host,
        port,
        database,
        user,
    )


def init_db() -> None:
    """
    SQLite: create tables if missing and run legacy ALTER backfills for old files.

    Postgres: do not auto-create schema; run Alembic migrations separately.
    """
    _log_active_database()
    if engine.dialect.name == "sqlite":
        Base.metadata.create_all(bind=engine)
        _sqlite_migrate(engine)
        _warn_sqlite_bots_user_id_nullable(engine)
        return

    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    _warn_if_postgres_missing_migrations(engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
