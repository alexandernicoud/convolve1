import logging
from zoneinfo import ZoneInfo

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import BOT_SCHEDULE_TIME, BOT_SCHEDULE_TZ
from app.db import init_db
from app.jobs.run_due_bots import run_due_bots_once


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bot-worker")


def _parse_time(raw_time: str) -> tuple[int, int]:
    parts = raw_time.split(":")
    if len(parts) != 2:
        raise ValueError("BOT_SCHEDULE_TIME must be in HH:MM format")
    return int(parts[0]), int(parts[1])


def run_daily_jobs() -> None:
    """Invoked by APScheduler at BOT_SCHEDULE_TIME; same batch as `python -m app.jobs.run_due_bots`."""
    logger.info("Starting run_due_bots_once (scheduled)")
    run_due_bots_once()


def main() -> None:
    init_db()
    hour, minute = _parse_time(BOT_SCHEDULE_TIME)
    tz = ZoneInfo(BOT_SCHEDULE_TZ)

    scheduler = BlockingScheduler(timezone=tz)
    scheduler.add_job(
        run_daily_jobs,
        CronTrigger(hour=hour, minute=minute, timezone=tz),
        id="daily-bot-runs",
        replace_existing=True,
    )

    logger.info("Worker started. Schedule: %s %s", BOT_SCHEDULE_TIME, BOT_SCHEDULE_TZ)
    scheduler.start()


if __name__ == "__main__":
    main()
