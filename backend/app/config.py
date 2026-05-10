"""
Central deployment-oriented configuration. Read environment variables only here.

Local defaults keep `dev.sh` / uvicorn workflows unchanged; production sets DATABASE_URL,
BOT_DATA_DIR, MODEL_STORAGE_ROOT, etc.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import List

from dotenv import load_dotenv

# Load backend/.env then backend/.env.local (override) so DATABASE_URL and other vars
# are set without exporting manually. CWD-independent (works with uvicorn from repo root).
_backend_root = Path(__file__).resolve().parent.parent
load_dotenv(_backend_root / ".env")
load_dotenv(_backend_root / ".env.local", override=True)


def _get_env_list(name: str, default: str) -> List[str]:
    raw = os.getenv(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return int(raw.strip())


# --- Core paths & database ---
# Resolved after dotenv: if DATABASE_URL is unset in env and .env files, SQLite fallback
# (local dev only). Cloud Run / production: set DATABASE_URL to Postgres — no .env in image.
#   postgresql://... or postgresql+psycopg2://... ?sslmode=require
DATABASE_URL = os.getenv("DATABASE_URL") or "sqlite:///./app.db"

_default_data_dir = Path(__file__).resolve().parent.parent / "bot_data"
BOT_DATA_DIR = os.getenv("BOT_DATA_DIR", str(_default_data_dir))

MODEL_STORAGE_ROOT = Path(
    os.getenv("MODEL_STORAGE_ROOT", str(Path(BOT_DATA_DIR) / "models" / "keras"))
)
MAX_KERAS_UPLOAD_BYTES = _env_int("MAX_KERAS_UPLOAD_BYTES", 500 * 1024 * 1024)

# --- Deployment profile (storage backend selection) ---
# "local"  -> uploaded .keras files live on local disk under MODEL_STORAGE_ROOT / BOT_DATA_DIR
#             (current behaviour; default; preserved exactly).
# "cloud"  -> uploaded .keras files are stored in Google Cloud Storage under MODEL_BUCKET;
#             DB rows persist a stable "gcs://{bucket}/{key}" reference instead of an
#             absolute container-local path. Bot inference downloads the model on demand
#             into MODEL_CACHE_DIR before tf.keras.models.load_model.
_raw_profile = os.getenv("APP_PROFILE", "local").strip().lower()
APP_PROFILE = _raw_profile if _raw_profile in ("local", "cloud") else "local"

# Required only when APP_PROFILE == "cloud". Empty string in local mode is fine.
MODEL_BUCKET = os.getenv("MODEL_BUCKET", "").strip()

# Cloud-only: where to materialise downloaded .keras files inside the runtime
# (Cloud Run instances have writable /tmp). Cached across requests on the same instance.
MODEL_CACHE_DIR = os.getenv("MODEL_CACHE_DIR", "/tmp/convolve_models")

# --- Scheduling (bots + optional worker) ---
BOT_SCHEDULE_TIME = os.getenv("BOT_SCHEDULE_TIME", "16:10")
# DEFAULT_TIMEZONE is canonical; BOT_SCHEDULE_TZ kept for backward compatibility.
_default_tz = os.getenv("DEFAULT_TIMEZONE") or os.getenv("BOT_SCHEDULE_TZ", "America/New_York")
DEFAULT_TIMEZONE = _default_tz
BOT_SCHEDULE_TZ = DEFAULT_TIMEZONE

# --- Identity & HTTP ---
USER_ID = os.getenv("USER_ID", "local-user")
API_PORT = _env_int("API_PORT", 8001)
CORS_ORIGINS = _get_env_list(
    "CORS_ORIGINS",
    # Local-dev default. Both localhost and 127.0.0.1 are listed for the Vite (5173)
    # and CRA/Next (3000) ports so the SPA can hit http://127.0.0.1:8001 either way
    # without "Failed to fetch" preflight errors. Production/cloud overrides this
    # via the CORS_ORIGINS env var (see docs/DEPLOYMENT.md), so this literal only
    # affects local development.
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000",
)

# --- Process mode (documentation / sanity checks; job work uses `python -m app.jobs.run_due_bots`) ---
# "api" = HTTP server. "job" = batch worker image (optional label; job entrypoint does not require this).
APP_MODE = os.getenv("APP_MODE", "api").strip().lower()

# --- API startup: do not run bot batches unless explicitly enabled ---
RUN_BOTS_ON_API_STARTUP = _env_bool("RUN_BOTS_ON_API_STARTUP", False)

<<<<<<< HEAD
=======
# --- Live / scheduled bot execution (disable on first Cloud Run for pipeline-only testing) ---
LIVE_DEPLOY_ENABLED = _env_bool("LIVE_DEPLOY_ENABLED", False)
SCHEDULED_BOTS_ENABLED = _env_bool("SCHEDULED_BOTS_ENABLED", False)

>>>>>>> 1a47ef7 (Prepare backend for manual pipeline deployment)
# --- Logging ---
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").strip().upper()

# --- Crash recovery: BotRun rows stuck in "running" longer than this are marked error ---
STALE_RUNNING_RUN_MINUTES = (
    _env_int("STALE_RUNNING_RUN_MINUTES", 120)
    if os.getenv("STALE_RUNNING_RUN_MINUTES") is not None
    else _env_int("STALE_RUN_MINUTES", 120)
)


def configure_logging() -> None:
    """Idempotent root logging setup for API and CLI job processes."""
    level = getattr(logging, LOG_LEVEL, logging.INFO)
    if not isinstance(level, int):
        level = logging.INFO
    logging.basicConfig(
        level=level,
        format="%(levelname)s %(name)s: %(message)s",
        force=True,
    )
