# Google Cloud Run — backend preparation

Build and run configuration for:

- **Cloud Run service** — FastAPI + uvicorn (HTTP)
- **Cloud Run job** — `python -m app.jobs.run_due_bots` (scheduled batch; no HTTP)

Do not bake secrets into the image. Set environment variables (or Secret Manager → env) on the service/job.

## Build

From the `backend/` directory:

```bash
docker build -t YOUR_REGION-docker.pkg.dev/PROJECT/REPO/convolve-api:TAG .
```

## API service (container command)

Default image command:

```text
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Cloud Run sets `PORT` (often `8080`). The Dockerfile `CMD` uses `${PORT}`.

## Job (container command override)

Use the **same image**, override command/args:

```text
python -m app.jobs.run_due_bots
```

No uvicorn, no FastAPI process. Ensure the same `DATABASE_URL`, `BOT_DATA_DIR`, `USER_ID`, etc. as the API unless you intentionally isolate environments.

## Required / important environment variables

| Variable | Required in prod? | Example / notes |
|----------|-------------------|-----------------|
| `DATABASE_URL` | **Yes** (Postgres) | `postgresql+psycopg2://user:pass@host:5432/postgres?sslmode=require` |
| `BOT_DATA_DIR` | **Yes** | `/tmp/bot_data` or a mounted volume path — ephemeral disk on Cloud Run unless you attach storage |
| `MODEL_STORAGE_ROOT` | Recommended | Defaults to `{BOT_DATA_DIR}/models/keras` if unset |
| `DEFAULT_TIMEZONE` | Optional | `America/New_York` (IANA); used for scheduling fallbacks |
| `RUN_BOTS_ON_API_STARTUP` | Optional | **`false`** (default) — do **not** set `true` on the API service unless you intend a batch on every instance start |
| `APP_MODE` | Optional | `api` for HTTP service; informational only |
| `LOG_LEVEL` | Optional | `INFO` or `DEBUG` — logging goes to **stdout/stderr** (Cloud Logging) |

Also set for a public API:

| Variable | Notes |
|----------|--------|
| `CORS_ORIGINS` | Comma-separated frontend origins, e.g. `https://app.example.com` — **not** localhost in prod |
| `USER_ID` | Single-tenant scope for bot rows; set a stable string per deployment if you use it |

Optional (see `app/config.py`):

| Variable | Example |
|----------|---------|
| `BOT_SCHEDULE_TIME` | `16:10` |
| `STALE_RUNNING_RUN_MINUTES` | `120` |
| `MAX_KERAS_UPLOAD_BYTES` | `524288000` |

## Port

- The process **must** listen on the port given by the **`PORT`** environment variable (Cloud Run sets it).
- The Dockerfile defaults `PORT=8080` for local runs; Cloud Run overrides at runtime.

## Health and jobs

- **`RUN_BOTS_ON_API_STARTUP`** defaults to **`false`** in code — API instances do not run the due-bot batch on startup unless you explicitly enable it.
- Scheduled execution should use a **Cloud Run Job** with `python -m app.jobs.run_due_bots`, not the API service.

## Local filesystem

- There is **no** committed `.env` in the image (see `.dockerignore`).
- `DATABASE_URL` without a value falls back to SQLite (`sqlite:///./app.db`) for local dev only — **set `DATABASE_URL` for Cloud Run** so Postgres is used.
- `BOT_DATA_DIR` should point to a writable directory (e.g. `/tmp/bot_data` or a mounted volume) for charts, uploaded models, and run artifacts.

## Migrations

Apply Alembic before or as part of deploy:

```bash
alembic upgrade head
```

(Run against the same `DATABASE_URL` as production, from CI or a one-off job.)
