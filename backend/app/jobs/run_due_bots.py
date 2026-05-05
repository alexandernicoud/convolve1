"""
Scheduled-style batch run for active bots (localhost / future Cloud Run Job).

Uses the same execute_bot_run() path as the API. Filters by per-bot run_time + timezone
and deactivates bots whose runtime_days window has expired.

Run standalone:  python -m app.jobs.run_due_bots
(from backend/ with PYTHONPATH set, or `cd backend && python -m app.jobs.run_due_bots`)
"""

from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import or_

from app.config import (
    BOT_SCHEDULE_TIME,
    BOT_SCHEDULE_TZ,
    STALE_RUNNING_RUN_MINUTES,
    USER_ID,
    configure_logging,
)
from app.db import SessionLocal, init_db
from app.models import Bot
from app.services.bot_execution import (
    BotNotExecutable,
    BotRunOutcome,
    execute_bot_run,
    is_runtime_expired,
)
from app.services.stale_run_cleanup import cleanup_stale_running_runs

logger = logging.getLogger(__name__)


def _parse_hhmm(raw: str) -> tuple[int, int]:
    s = (raw or "").strip().replace(".", ":").replace(",", ":")
    parts = s.split(":")
    if len(parts) != 2:
        raise ValueError("Time must be HH:MM")
    return int(parts[0]), int(parts[1])


def is_bot_due_now(bot: Bot, now_utc: datetime) -> bool:
    """
    True if local time in the bot's timezone has reached today's run_time slot.
    """
    tz_name = bot.timezone or BOT_SCHEDULE_TZ
    time_str = bot.run_time or BOT_SCHEDULE_TIME
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        logger.warning("Invalid timezone %r for bot %s; using %s", tz_name, bot.id, BOT_SCHEDULE_TZ)
        tz = ZoneInfo(BOT_SCHEDULE_TZ)
    try:
        h, m = _parse_hhmm(time_str)
    except ValueError:
        h, m = _parse_hhmm(BOT_SCHEDULE_TIME)

    now_local = now_utc.astimezone(tz)
    scheduled_today = now_local.replace(hour=h, minute=m, second=0, microsecond=0)
    return now_local >= scheduled_today


def run_due_bots_once() -> dict[str, int]:
    """
    Query active bots for this deployment (USER_ID scope), run those due now, log summary.

    Returns count dict for tests / Cloud Run exit metrics.
    """
    init_db()
    now_utc = datetime.now(timezone.utc)
    summary = {
        "candidates": 0,
        "skipped_schedule": 0,
        "skipped_idempotent": 0,
        "deactivated_expired": 0,
        "success": 0,
        "error": 0,
        "stale_runs_cleaned": 0,
    }

    db = SessionLocal()
    try:
        summary["stale_runs_cleaned"] = cleanup_stale_running_runs(
            db,
            stale_after_minutes=STALE_RUNNING_RUN_MINUTES,
            now_utc=now_utc,
        )

        bots = (
            db.query(Bot)
            .filter(
                Bot.lifecycle_state == "active",
                or_(Bot.user_id == USER_ID, Bot.user_id.is_(None)),
            )
            .all()
        )
        summary["candidates"] = len(bots)

        for bot in bots:
            if is_runtime_expired(bot, now_utc):
                logger.info("Bot %s runtime expired; deactivating", bot.id)
                bot.is_active = False
                db.add(bot)
                db.commit()
                summary["deactivated_expired"] += 1
                continue

            if not is_bot_due_now(bot, now_utc):
                summary["skipped_schedule"] += 1
                continue

            try:
                _run, outcome = execute_bot_run(db, bot)
                if outcome == BotRunOutcome.SKIPPED_ALREADY_RAN:
                    summary["skipped_idempotent"] += 1
                elif outcome == BotRunOutcome.CREATED_SUCCESS:
                    summary["success"] += 1
                elif outcome == BotRunOutcome.CREATED_ERROR:
                    summary["error"] += 1
            except BotNotExecutable:
                logger.info("Bot %s: skipped (not executable)", bot.id)
            except Exception:
                logger.exception("Bot %s: unexpected failure in execute_bot_run", bot.id)
                summary["error"] += 1
    finally:
        db.close()

    logger.info(
        "run_due_bots_once finished: candidates=%s schedule_skip=%s idempotent_skip=%s "
        "deactivated=%s success=%s error=%s stale_cleaned=%s",
        summary["candidates"],
        summary["skipped_schedule"],
        summary["skipped_idempotent"],
        summary["deactivated_expired"],
        summary["success"],
        summary["error"],
        summary["stale_runs_cleaned"],
    )
    return summary


def main() -> int:
    configure_logging()
    logger.info(
        "run_due_bots job start (USER_ID=%s, schedule_default=%s %s, stale_run_minutes=%s)",
        USER_ID,
        BOT_SCHEDULE_TIME,
        BOT_SCHEDULE_TZ,
        STALE_RUNNING_RUN_MINUTES,
    )
    try:
        summary = run_due_bots_once()
    except Exception:
        logger.exception("run_due_bots job failed fatally (DB init or batch)")
        return 1

    logger.info(
        "run_due_bots job finished OK: success=%s error=%s stale_cleaned=%s",
        summary.get("success"),
        summary.get("error"),
        summary.get("stale_runs_cleaned"),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
