"""Derived UI/backend status for a bot from persisted state + scheduling helpers."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from app.config import BOT_SCHEDULE_TIME, BOT_SCHEDULE_TZ
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
    """
    Next daily run instant (UTC ISO) from run_time + timezone, strictly after max(now, last run).
    No schedule for closed/archived bots.
    """
    ls = getattr(bot, "lifecycle_state", None) or "active"
    if ls in ("closed", "archived"):
        return None

    try:
        from zoneinfo import ZoneInfo

        from app.jobs.run_due_bots import _parse_hhmm

        tz_name = bot.timezone or BOT_SCHEDULE_TZ
        time_str = bot.run_time or BOT_SCHEDULE_TIME
        tz = ZoneInfo(tz_name)
        try:
            h, m = _parse_hhmm(time_str)
        except ValueError:
            h, m = _parse_hhmm(BOT_SCHEDULE_TIME)

        now_local = now_utc.astimezone(tz)
        last_ref_utc: Optional[datetime] = None
        if latest_run:
            ref = latest_run.chart_date or latest_run.run_finished_at or latest_run.run_at
            if ref is not None:
                if getattr(ref, "tzinfo", None) is None:
                    ref = ref.replace(tzinfo=timezone.utc)
                last_ref_utc = ref.astimezone(timezone.utc)

        for offset in range(0, 14):
            day: date = now_local.date() + timedelta(days=offset)
            cand_local = datetime.combine(day, time(hour=h, minute=m, second=0, microsecond=0), tzinfo=tz)
            cand_utc = cand_local.astimezone(timezone.utc)
            if cand_utc <= now_utc:
                continue
            if last_ref_utc is not None and cand_utc <= last_ref_utc:
                continue
            return cand_utc.isoformat()
        return None
    except Exception:
        return None
