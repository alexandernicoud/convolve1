"""
Conservative crash recovery: mark BotRun rows stuck in status='running' as terminal failures.

Not distributed locking — single-process / scheduled job hygiene only.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Bot, BotRun
from app.services.bot_execution import sync_bot_run_summary

logger = logging.getLogger(__name__)


def cleanup_stale_running_runs(
    db: Session,
    *,
    stale_after_minutes: int,
    now_utc: datetime | None = None,
) -> int:
    """
    Mark runs with status 'running' whose start time is older than the threshold as error.

    Uses coalesce(run_started_at, run_at) as the reference instant.
    Returns the number of rows updated.
    """
    if stale_after_minutes <= 0:
        return 0

    now = now_utc or datetime.now(timezone.utc)
    threshold = now - timedelta(minutes=stale_after_minutes)
    ref = func.coalesce(BotRun.run_started_at, BotRun.run_at)

    stale = (
        db.query(BotRun)
        .filter(BotRun.status == "running", ref < threshold)
        .order_by(BotRun.run_at.asc())
        .all()
    )

    if not stale:
        return 0

    msg = (
        f"Stale run recovery: no completion after {stale_after_minutes} minutes "
        "(process likely crashed or was killed)."
    )
    count = 0
    for run in stale:
        run.status = "error"
        run.run_finished_at = now
        run.error_message = msg
        db.add(run)
        bot = db.query(Bot).filter(Bot.id == run.bot_id).first()
        if bot is not None:
            sync_bot_run_summary(db, bot, run)
        count += 1

    db.commit()
    logger.warning("Marked %s stale running bot_runs as error (threshold=%s min)", count, stale_after_minutes)
    return count
