# Backend deployment notes (Step 3)

This document describes how to run the API and the scheduled bot job locally, which environment variables matter, and how this maps to a future split stack (Vercel + Supabase + Cloud Run Jobs).

## Run the API locally

From the `backend/` directory (so `app` is importable):

```bash
cd backend
# optional: export DATABASE_URL=sqlite:///./app.db
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

Or use your existing `dev.sh` / workflow. The API **does not** run bot batches on startup unless `RUN_BOTS_ON_API_STARTUP=true`.

## Run the scheduled bot job locally

Same `backend/` directory, same env as the API (especially `DATABASE_URL`, `USER_ID`, `BOT_DATA_DIR`, model paths):

```bash
cd backend
python -m app.jobs.run_due_bots
```

This is the intended standalone entrypoint for Cloud Run Jobs: one process, one batch, exit code 0 on success, non-zero on fatal failure (e.g. DB unavailable).

## Environment variables (centralized in `app/config.py`)

| Variable | Purpose | Default (local) |
|----------|---------|-----------------|
| `DATABASE_URL` | SQLAlchemy URL (SQLite or Postgres / Supabase) | `sqlite:///./app.db` |
| `BOT_DATA_DIR` | Bot charts, model copies, runtime files | `backend/bot_data` |
| `MODEL_STORAGE_ROOT` | Anonymous `.keras` upload registry | under `BOT_DATA_DIR` |
| `MAX_KERAS_UPLOAD_BYTES` | Upload cap | ~500MB |
| `DEFAULT_TIMEZONE` | Canonical IANA zone for scheduling fallbacks | `America/New_York` |
| `BOT_SCHEDULE_TZ` | Legacy alias for `DEFAULT_TIMEZONE` if set | — |
| `BOT_SCHEDULE_TIME` | Default HH:MM when bot has no `run_time` | `16:10` |
| `RUN_BOTS_ON_API_STARTUP` | If `true`, API starts a background due-bot batch once | `false` |
| `APP_MODE` | `api` or `job` (informational; job work uses `python -m app.jobs.run_due_bots`) | `api` |
| `LOG_LEVEL` | Root logging level | `INFO` |
| `STALE_RUNNING_RUN_MINUTES` or `STALE_RUN_MINUTES` | Mark stuck `bot_runs.status=running` as error after N minutes | `120` |
| `USER_ID` | Bot row scope for single-user / dev | `local-user` |
| `CORS_ORIGINS` | Comma-separated origins for the API | localhost dev ports |

Do not read `os.environ` elsewhere for these; add new settings to `app/config.py`.

## Postgres / Supabase vs SQLite

- **Default local:** `DATABASE_URL` points at a SQLite file; `init_db()` can create tables and apply legacy SQLite ALTER backfills.
- **Postgres (recommended for any shared or production environment):** schema is applied with **Alembic**, not `create_all`. From `backend/` run `alembic upgrade head` after setting `DATABASE_URL`. See **`docs/POSTGRES.md`** for Supabase connection strings, migration workflow, and cutover notes.

## Intended future architecture

- **Frontend**: Vercel (static + serverless); points `VITE_*` API base URL at the backend host.
- **Database**: Supabase Postgres; set `DATABASE_URL` to the pooled or direct connection string.
- **Scheduled bot batch**: Cloud Run Job invoking the same image with command `python -m app.jobs.run_due_bots` on a schedule (no FastAPI/uvicorn).
- **Model storage**: Today files live under `MODEL_STORAGE_ROOT` / `BOT_DATA_DIR`. Swap-in GCS/S3 later by implementing `KerasModelStorage` and changing `get_keras_model_storage()` in `app/storage/__init__.py` (routes stay unchanged).

## Stale `running` runs

If a process dies after creating a `BotRun` with `status=running`, the next job batch calls `cleanup_stale_running_runs` before processing bots. Rows older than `STALE_RUNNING_RUN_MINUTES` are marked `error` with a clear message and bot summaries are synced. This is crash recovery only, not distributed locking.

## Container notes

`backend/Dockerfile` builds a Python image suitable for **API** (`uvicorn app.main:app`). For Cloud Run Jobs, reuse the same image with a different command/args: `python -m app.jobs.run_due_bots`. Set `PORT` only for the HTTP service.

## What remains before production cloud deployment

- **Secrets**: Move DB URLs and keys out of plain env in source; use Secret Manager / CI.
- **Migrations**: Use **Alembic** for Postgres (`alembic upgrade head`). SQLite-only `_sqlite_migrate` is for local legacy files only.
- **HTTPS / CORS**: Restrict `CORS_ORIGINS` to real frontend origins.
- **Object storage**: Implement cloud `KerasModelStorage` when leaving single-disk VPS.
- **Job idempotency & monitoring**: Cloud Scheduler → Cloud Run Job with alerts on non-zero exits.
- **Frontend**: Ensure production API URL is set in the Vite env at build time.

The codebase is **container-ready** (single Dockerfile, explicit job entrypoint, no hidden bot execution on API boot). Remaining work is operational (secrets, DB, CORS, storage swap), not structural blockers for packaging the backend.
