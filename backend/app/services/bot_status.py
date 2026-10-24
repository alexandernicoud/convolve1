"""Derived UI/backend status for a bot from persisted state + scheduling helpers."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from app.models import Bot, BotRun
from app.services.bot_execution import is_runtime_expired
from app.services.bot_schedule import is_due, next_slot, utc


def derive_bot_status(
    bot: Bot,
    *,
    now_utc: datetime,
    latest_run: Optional[BotRun],
) -> str:
    """
    Display status for UI (colors). Combines persisted lifecycle_state with runtime hints.

    Returns one of: archived, closed, expired, paused, running, error, due, waiting.
    """
    ls = getattr(bot, "lifecycle_state", None) or "active"
    if ls in ("archived", "closed", "paused"):
        return ls
    if ls == "expired" or is_runtime_expired(bot, now_utc):
        return "expired"

    lr = latest_run
    if lr and lr.status == "running":
        started = utc(lr.run_started_at or lr.run_at)
        if started and now_utc - started < timedelta(minutes=30):
            return "running"
    if lr and lr.status == "error":
        return "error"
    if is_due(bot, now_utc):
        return "due"
    return "waiting"


def next_scheduled_run_iso(
    bot: Bot,
    now_utc: datetime,
    latest_run: Optional[BotRun] = None,
) -> Optional[str]:
    """Next scheduled check (UTC ISO); None when the bot is not scheduled."""
    del latest_run
    ls = getattr(bot, "lifecycle_state", None) or "active"
    if ls != "active" or is_runtime_expired(bot, now_utc):
        return None
    if is_due(bot, now_utc):
        return utc(now_utc).isoformat()
    return next_slot(bot, now_utc).isoformat()
