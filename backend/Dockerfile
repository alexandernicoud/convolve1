# Convolve backend — Cloud Run (API) and Cloud Run Jobs (batch).
# Build from the backend/ directory:
#   docker build -t convolve-api .
# Run API (Cloud Run sets PORT, usually 8080):
#   docker run -e DATABASE_URL=... -e PORT=8080 -p 8080:8080 convolve-api
# Run job (override command):
#   docker run -e DATABASE_URL=... -e BOT_DATA_DIR=/tmp/bot_data convolve-api \
#     python -m app.jobs.run_due_bots

FROM python:3.11-slim

WORKDIR /app/backend

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
# Cloud Run injects PORT at runtime (commonly 8080). Local: docker run -e PORT=8000 ...
ENV PORT=8080

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application package (app/), runners/, alembic/, etc.
COPY . .

# Logs: uvicorn + app use stderr/stdout (Cloud Logging picks them up).
# No file-only logging configured.

EXPOSE 8080

# API service — listen on all interfaces; Cloud Run requires listening on $PORT.
# exec replaces shell so uvicorn receives SIGTERM for graceful shutdown.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
