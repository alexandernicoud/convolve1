# Postgres / Supabase (Step 4a)

Production and staging should use **Postgres** (e.g. Supabase). The app uses one SQLAlchemy engine and **`DATABASE_URL`** only — no second database layer.

## What is SQLite-only vs production-ready

| Area | SQLite (local default) | Postgres / Supabase |
|------|------------------------|---------------------|
| Schema creation | `init_db()` runs `metadata.create_all` + legacy `_sqlite_migrate` for old files | **Alembic** (`alembic upgrade head`) owns the schema |
| `init_db()` | Creates/patches tables | Only checks connectivity; logs a warning if core tables are missing |
| Migrations | Incremental ALTER hacks (dev convenience) | `alembic/versions/*.py` |

The SQLite ALTER path remains for **local legacy databases**; it is not the deployment story.

## Prerequisites

- Python deps include `psycopg2-binary` and `alembic` (see `requirements.txt`).
- A Postgres instance (Supabase project or local Docker Postgres).

## Connection string (Supabase)

In the Supabase dashboard, copy the **URI** for SQLAlchemy. Typical shape:

```text
postgresql+psycopg2://USER:PASSWORD@HOST:5432/postgres?sslmode=require
```

- Use the **Session** pooler port `5432` (or direct connection) for Alembic and long-lived API workers unless you know you need the transaction pooler (`6543`).
- If the password contains special characters, URL-encode it in the URI.
- `sslmode=require` (or `verify-full`) is normal for Supabase.

**Local runs (recommended):** put `DATABASE_URL` in `backend/.env` (see `backend/.env.example`). The app loads it automatically via `python-dotenv` when `app.config` is imported — no `export` needed.

You can still override with a shell `export DATABASE_URL=...` if you prefer.

No application code changes are required beyond that env value.

## Initialize schema (first deploy)

From the **`backend/`** directory (where `alembic.ini` lives):

```bash
cd backend
source .venv/bin/activate   # if you use a venv
pip install -r requirements.txt
export DATABASE_URL='postgresql+psycopg2://...'
alembic upgrade head
```

Then start the API or job as usual; `init_db()` will connect and verify the DB is reachable.

## Create a new migration after model changes

1. Edit `app/models.py`.
2. Autogenerate (review the diff before committing):

   ```bash
   cd backend
   export DATABASE_URL=...   # any DB Alembic can connect to (can be SQLite scratch file)
   alembic revision --autogenerate -m "short_description"
   ```

3. Adjust the revision if needed (constraints, data backfills).
4. Apply: `alembic upgrade head` on each environment.

## Local development with Postgres instead of SQLite

```bash
cd backend
export DATABASE_URL='postgresql+psycopg2://user:pass@localhost:5432/mydb'
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

Frontend can stay on `localhost`; point it at the same API base URL as today.

## If tables already exist (e.g. manual `create_all`)

If you accidentally created tables without Alembic, align Alembic’s version without re-running DDL:

```bash
alembic stamp head
```

Only do this when the live schema matches the migration chain.

## Migrating **data** from SQLite to Postgres

Alembic only handles **schema**. Copying rows is a separate step:

- Export/import with `pgloader`, custom scripts, or ORM-based dump/load.
- Risks: type differences (minimal here: strings, floats, datetimes), foreign-key order, and `user_id` nullability on very old SQLite files (see `db.py` warnings).

Test on a copy before cutting over production.

## Switching from SQLite to Supabase (checklist)

1. Create Supabase project; note connection string.
2. Set `DATABASE_URL` (with SSL as required).
3. Run `alembic upgrade head` from `backend/`.
4. Migrate data if you need existing bots/runs (optional one-time).
5. Point staging API at Supabase; run smoke tests (bots API, dashboard, job).
6. Promote to production with the same env var.
