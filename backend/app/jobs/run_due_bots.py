"""
Scheduled batch for paper bots: the Cloud Run job entrypoint (and the local poller's tick).

    python -m app.jobs.run_due_bots

Cloud Scheduler triggers the job every few minutes; the job decides which bots are due
(bot_schedule.is_due), so frequent ticks never run a daily bot more than once per slot, and
duplicate executions of a bar are prevented in the database (bot_execution). Exit code 0
means the batch completed (individual bot failures are recorded on the bot and logged);
1 means the batch itself could not run (database, configuration).
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import or_

from app import config, ml_versions
from app.config import configure_logging
from app.db import SessionLocal, init_db
from app.models import Bot
from app.services.bot_execution import (
    MAX_ATTEMPTS,
    BotNotExecutable,
    BotRunOutcome,
    MarketDataUnavailable,
    execute_bot_run,
    is_runtime_expired,
)
from app.services.bot_schedule import RETRY_AFTER, is_due, latest_slot, utc
from app.services.stale_run_cleanup import cleanup_stale_running_runs

logger = logging.getLogger(__name__)


def is_bot_due_now(bot: Bot, now_utc: datetime) -> bool:
    return is_due(bot, now_utc)


def _empty_summary() -> dict[str, int]:
    return {
        "candidates": 0,
        "due": 0,
        "skipped_schedule": 0,
        "skipped_idempotent": 0,
        "skipped_in_progress": 0,
        "no_new_data": 0,
        "deactivated_expired": 0,
        "success": 0,
        "error": 0,
        "stale_runs_cleaned": 0,
    }


def _take_slot(db, bot_id: str, slot: datetime, now: datetime) -> bool:
    """Record this attempt; False when another worker attempted the slot moments ago."""
    won = (
        db.query(Bot)
        .filter(
            Bot.id == bot_id,
            or_(Bot.last_slot_at.is_(None), Bot.last_slot_at < slot),
            or_(Bot.last_attempt_at.is_(None), Bot.last_attempt_at < slot, Bot.last_attempt_at <= now - RETRY_AFTER),
        )
        .update({Bot.last_attempt_at: now}, synchronize_session=False)
    )
    db.commit()
    return won == 1


def _finish_slot(db, bot_id: str, slot: datetime) -> None:
    db.query(Bot).filter(Bot.id == bot_id).update({Bot.last_slot_at: slot}, synchronize_session=False)
    db.commit()


def run_due_bots_once(now_utc: Optional[datetime] = None) -> dict[str, int]:
    summary = _empty_summary()
    if not config.LIVE_DEPLOY_ENABLED or not config.SCHEDULED_BOTS_ENABLED:
        logger.info(
            "run_due_bots_once: no-op (LIVE_DEPLOY_ENABLED=%s, SCHEDULED_BOTS_ENABLED=%s)",
            config.LIVE_DEPLOY_ENABLED,
            config.SCHEDULED_BOTS_ENABLED,
        )
        return summary

    init_db()
    now = utc(now_utc) or datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        summary["stale_runs_cleaned"] = cleanup_stale_running_runs(
            db, stale_after_minutes=config.STALE_RUNNING_RUN_MINUTES, now_utc=now
        )
        query = db.query(Bot).filter(Bot.lifecycle_state == "active")
        if not config.AUTH_REQUIRED:
            query = query.filter(or_(Bot.user_id == config.USER_ID, Bot.user_id.is_(None)))
        bots = query.all()
        summary["candidates"] = len(bots)

        for bot in bots:
            if is_runtime_expired(bot, now):
                logger.info("Bot %s runtime expired; marking expired", bot.id)
                bot.lifecycle_state = "expired"
                bot.is_active = False
                db.commit()
                summary["deactivated_expired"] += 1
                continue
            if not is_due(bot, now):
                summary["skipped_schedule"] += 1
                continue
            slot = latest_slot(bot, now)
            if not _take_slot(db, bot.id, slot, now):
                summary["skipped_in_progress"] += 1
                continue
            summary["due"] += 1
            db.refresh(bot)
            finished = True
            try:
                run, outcome = execute_bot_run(db, bot, trigger="schedule", now_utc=now)
                if outcome == BotRunOutcome.CREATED_SUCCESS:
                    summary["success"] += 1
                elif outcome == BotRunOutcome.CREATED_ERROR:
                    summary["error"] += 1
                    finished = int(run.attempts or 1) >= MAX_ATTEMPTS
                elif outcome == BotRunOutcome.SKIPPED_IN_PROGRESS:
                    summary["skipped_in_progress"] += 1
                    finished = False
                elif run.status == "success":
                    summary["no_new_data"] += 1
                else:
                    summary["skipped_idempotent"] += 1
            except MarketDataUnavailable as exc:
                logger.warning("Bot %s: %s (will retry)", bot.id, exc)
                summary["error"] += 1
                finished = False
            except BotNotExecutable:
                logger.info("Bot %s: no longer active", bot.id)
            except Exception:
                logger.exception("Bot %s: unexpected failure", bot.id)
                db.rollback()
                summary["error"] += 1
                finished = False
            if finished:
                _finish_slot(db, bot.id, slot)
    finally:
        db.close()

    logger.info("run_due_bots summary %s", json.dumps(summary, sort_keys=True))
    return summary


def main() -> int:
    configure_logging()
    logger.info(
        "run_due_bots job start (live=%s scheduled=%s auth_required=%s)",
        config.LIVE_DEPLOY_ENABLED,
        config.SCHEDULED_BOTS_ENABLED,
        config.AUTH_REQUIRED,
    )
    problems = ml_versions.version_mismatches()
    if problems:
        logger.error("ML package versions do not match requirements.txt; models may not load: %s", "; ".join(problems))
    try:
        run_due_bots_once()
    except Exception:
        logger.exception("run_due_bots job failed (database or configuration)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
