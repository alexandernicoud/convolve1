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
# Tests set CONVOLVE_TEST=1 before import so a developer .env.local cannot override the
# isolated sqlite URL / JWT secret used by pytest.
_backend_root = Path(__file__).resolve().parent.parent
_in_test = os.getenv("CONVOLVE_TEST", "").strip() in ("1", "true", "yes", "on")
if not _in_test:
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
MAX_DATASET_UPLOAD_BYTES = _env_int("MAX_DATASET_UPLOAD_BYTES", 1024 * 1024 * 1024)
# Cloud Run's filesystem is memory; extracted images count against instance RAM.
MAX_DATASET_EXTRACTED_BYTES = _env_int("MAX_DATASET_EXTRACTED_BYTES", 2 * 1024 * 1024 * 1024)

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
# Cloud mode also stores completed experiment files in this bucket under
# users/{user_id}/... (models, datasets, and final result files). No second bucket.
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
# Single-tenant bot scope until the Auth cutover assigns rows to a real UUID.
# Do not remove: production Cloud Run still relies on this when AUTH_REQUIRED is false.
USER_ID = os.getenv("USER_ID", "local-user")

# Supabase Auth (FastAPI verifies JWTs; the SPA uses the anon key only).
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "").strip()
SUPABASE_JWT_AUDIENCE = os.getenv("SUPABASE_JWT_AUDIENCE", "authenticated").strip() or "authenticated"
# Local/dev defaults on so the new SPA login actually gates the API.
# Cloud/prod stays off until the explicit cutover (AUTH_REQUIRED=true on Cloud Run).
AUTH_REQUIRED = _env_bool("AUTH_REQUIRED", APP_PROFILE != "cloud")
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

# --- CNN training execution ---
# "inprocess" trains inside the API process (BackgroundTasks). Default, and the only
# mode that works without pipeline_runs ownership rows and durable dataset storage.
# "cloud_run_job" starts TRAINER_JOB_NAME through the Cloud Run Jobs API; the job runs
# `python -m app.jobs.train_worker` and reads everything else from the database.
_raw_trainer_execution = os.getenv("TRAINER_EXECUTION", "inprocess").strip().lower()
TRAINER_EXECUTION = (
    _raw_trainer_execution if _raw_trainer_execution in ("inprocess", "cloud_run_job") else "inprocess"
)
TRAINER_JOB_NAME = os.getenv("TRAINER_JOB_NAME", "convolve-trainer").strip()
TRAINER_JOB_PROJECT = (os.getenv("TRAINER_JOB_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT") or "").strip()
TRAINER_JOB_REGION = os.getenv("TRAINER_JOB_REGION", "europe-west6").strip()
# TensorFlow intra/inter-op and OpenMP threads inside the training job. Match the job's vCPU count.
TRAINER_THREADS = max(1, _env_int("TRAINER_THREADS", 8))
# A queued/running job row with no progress for this long is checked against the
# Cloud Run execution so a crashed or timed-out job does not stay "running" forever.
TRAINER_JOB_STALE_SECONDS = max(60, _env_int("TRAINER_JOB_STALE_SECONDS", 300))

# The scheduled bots job (`python -m app.jobs.run_due_bots`). When set, the API starts one
# execution right after a bot is deployed so its first evaluation does not wait for the next
# Cloud Scheduler tick. Unset (local): the in-process scheduler picks the bot up.
BOT_JOB_NAME = os.getenv("BOT_JOB_NAME", "").strip()
BOT_JOB_PROJECT = (os.getenv("BOT_JOB_PROJECT") or TRAINER_JOB_PROJECT).strip()
BOT_JOB_REGION = (os.getenv("BOT_JOB_REGION") or TRAINER_JOB_REGION).strip()

# --- API startup: one-shot due-bot batch (the in-process poller is separate) ---
RUN_BOTS_ON_API_STARTUP = _env_bool("RUN_BOTS_ON_API_STARTUP", False)

# --- Live / scheduled bot execution ---
# Local profile defaults ON so paper bots actually run from `npm run dev:backend`.
# Cloud stays off unless explicitly enabled (pipeline-only Cloud Run).
_local_live_default = APP_PROFILE != "cloud"
LIVE_DEPLOY_ENABLED = _env_bool("LIVE_DEPLOY_ENABLED", _local_live_default)
SCHEDULED_BOTS_ENABLED = _env_bool("SCHEDULED_BOTS_ENABLED", _local_live_default)

# --- Credits ---
# "off": runs are free; nothing is written to the credit ledger (current production).
# "enforce": runs are charged from the server-side ledger and refused (HTTP 402) without
# enough credits. Turn on only once pricing and allocations are final.
_raw_credits_mode = os.getenv("CREDITS_MODE", "off").strip().lower()
CREDITS_MODE = _raw_credits_mode if _raw_credits_mode in ("off", "enforce") else "off"

# Poll for due bots inside the API process. Local development only: in cloud, Cloud Scheduler
# triggers the `run_due_bots` Cloud Run job and API instances must not poll.
BOT_INPROCESS_SCHEDULER = _env_bool("BOT_INPROCESS_SCHEDULER", APP_PROFILE != "cloud")

# How often the in-process (or worker) scheduler looks for due bots.
BOT_POLL_INTERVAL_SECONDS = max(15, _env_int("BOT_POLL_INTERVAL_SECONDS", 60))

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
