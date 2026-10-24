"""Start the scheduled bots job on demand (Cloud Run Admin API, runtime service account)."""

from __future__ import annotations

import logging

from app import config

logger = logging.getLogger(__name__)

_RUN_API = "https://run.googleapis.com/v2"


def request_batch() -> bool:
    """Ask Cloud Run for one bots-job execution now. Best effort: due bots also run on the next
    Cloud Scheduler tick, and duplicate executions are deduplicated per bot and bar."""
    if not (config.LIVE_DEPLOY_ENABLED and config.SCHEDULED_BOTS_ENABLED):
        return False
    if not (config.BOT_JOB_NAME and config.BOT_JOB_PROJECT and config.BOT_JOB_REGION):
        return False
    path = f"projects/{config.BOT_JOB_PROJECT}/locations/{config.BOT_JOB_REGION}/jobs/{config.BOT_JOB_NAME}"
    try:
        import google.auth
        from google.auth.transport.requests import AuthorizedSession

        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        resp = AuthorizedSession(credentials).post(f"{_RUN_API}/{path}:run", json={}, timeout=30)
        if resp.status_code >= 300:
            logger.warning("Bots job start returned %s: %s", resp.status_code, resp.text[:300])
            return False
        return True
    except Exception:
        logger.exception("Could not start the bots job; the next scheduled tick will run due bots")
        return False
