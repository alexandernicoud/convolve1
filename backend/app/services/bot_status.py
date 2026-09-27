"""Derived UI/backend status for a bot from persisted state + scheduling helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from app.models import Bot, BotRun
from app.services.bot_execution import is_runtime_expired


def derive_bot_status(
    bot: Bot,
    *,
    now_utc: datetime,
    latest_run: Optional[BotRun],
) -> str:
    """
    Display status for UI (colors). Combines persisted lifecycle_state with runtime hints.

    Returns one of: archived, closed, expired, paused, running, error, waiting, active.
    """
    ls = getattr(bot, "lifecycle_state", None) or "active"
    if ls == "archived":
        return "archived"
    if ls == "closed":
        return "closed"
    if ls == "paused":
        return "paused"
    if ls == "expired" or is_runtime_expired(bot, now_utc):
        return "expired"

    lr = latest_run
    if lr and lr.status == "running":
        started = lr.run_started_at or lr.run_at
        if started:
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            if now_utc - started < timedelta(minutes=30):
                return "running"

    if lr and lr.status == "error":
        return "error"

    try:
        from app.jobs.run_due_bots import is_bot_due_now

        if not is_bot_due_now(bot, now_utc):
            return "waiting"
    except Exception:
        pass

    return "active"


def next_scheduled_run_iso(
    bot: Bot,
    now_utc: datetime,
    latest_run: Optional[BotRun],
) -> Optional[str]:
    """Next analysis instant (UTC ISO). Continuous test: last finish + poll interval."""
    ls = getattr(bot, "lifecycle_state", None) or "active"
    if ls in ("closed", "archived", "paused"):
        return None

    from app.config import BOT_POLL_INTERVAL_SECONDS

    ref = None
    if latest_run:
        ref = latest_run.run_finished_at or latest_run.run_started_at or latest_run.run_at
        if ref is not None and getattr(ref, "tzinfo", None) is None:
            ref = ref.replace(tzinfo=timezone.utc)
    if ref is None:
        return (now_utc + timedelta(seconds=int(BOT_POLL_INTERVAL_SECONDS))).isoformat()
    nxt = ref + timedelta(seconds=int(BOT_POLL_INTERVAL_SECONDS))
    if nxt <= now_utc:
        nxt = now_utc + timedelta(seconds=5)
    return nxt.isoformat()
