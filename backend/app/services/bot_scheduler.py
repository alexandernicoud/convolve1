"""
In-process paper-bot scheduler.

Polls `run_due_bots_once` on an interval so local `uvicorn` keeps bots running
without a separate Cloud Run Job. Overlapping ticks are skipped in-process; duplicate
executions across processes are prevented in the database (bot_execution).
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

from app.config import (
    BOT_INPROCESS_SCHEDULER,
    BOT_POLL_INTERVAL_SECONDS,
    LIVE_DEPLOY_ENABLED,
    SCHEDULED_BOTS_ENABLED,
)

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_started = False
_stop = threading.Event()
_thread: Optional[threading.Thread] = None


_tick_lock = threading.Lock()


def _tick() -> None:
    from app.jobs.run_due_bots import run_due_bots_once

    if not _tick_lock.acquire(blocking=False):
        logger.info("Bot scheduler tick skipped (previous tick still running)")
        return
    try:
        summary = run_due_bots_once()
        logger.info("Bot scheduler tick: %s", summary)
    except Exception:
        logger.exception("Bot scheduler tick failed")
    finally:
        _tick_lock.release()


def _loop() -> None:
    # First pass immediately so a restart catches already-due bots.
    if not _stop.is_set():
        _tick()
    while not _stop.wait(BOT_POLL_INTERVAL_SECONDS):
        _tick()


def start_bot_scheduler() -> bool:
    """Start the daemon poller if live + scheduled flags are on. Idempotent."""
    global _started, _thread
    if not BOT_INPROCESS_SCHEDULER:
        logger.info("In-process bot scheduler disabled (BOT_INPROCESS_SCHEDULER=false); use the run_due_bots job")
        return False
    if not LIVE_DEPLOY_ENABLED or not SCHEDULED_BOTS_ENABLED:
        logger.info(
            "Bot scheduler not started (LIVE_DEPLOY_ENABLED=%s, SCHEDULED_BOTS_ENABLED=%s)",
            LIVE_DEPLOY_ENABLED,
            SCHEDULED_BOTS_ENABLED,
        )
        return False
    with _lock:
        if _started and _thread is not None and _thread.is_alive():
            return True
        _stop.clear()
        _thread = threading.Thread(
            target=_loop,
            name="convolve-bot-scheduler",
            daemon=True,
        )
        _thread.start()
        _started = True
        logger.info(
            "Bot scheduler started (interval=%ss). Paper bots run in this API process.",
            BOT_POLL_INTERVAL_SECONDS,
        )
        return True


def stop_bot_scheduler() -> None:
    _stop.set()
