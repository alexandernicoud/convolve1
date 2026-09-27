import logging
from time import sleep

from app.config import (
    BOT_POLL_INTERVAL_SECONDS,
    LIVE_DEPLOY_ENABLED,
    SCHEDULED_BOTS_ENABLED,
)
from app.db import init_db
from app.jobs.run_due_bots import run_due_bots_once


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bot-worker")


def main() -> None:
    if not LIVE_DEPLOY_ENABLED or not SCHEDULED_BOTS_ENABLED:
        logger.info(
            "Worker disabled (LIVE_DEPLOY_ENABLED=%s, SCHEDULED_BOTS_ENABLED=%s)",
            LIVE_DEPLOY_ENABLED,
            SCHEDULED_BOTS_ENABLED,
        )
        return

    init_db()
    logger.info(
        "Worker polling every %ss for due paper bots",
        BOT_POLL_INTERVAL_SECONDS,
    )
    while True:
        try:
            summary = run_due_bots_once()
            logger.info("Worker tick: %s", summary)
        except Exception:
            logger.exception("Worker tick failed")
        sleep(BOT_POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
