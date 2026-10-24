"""
When a paper bot runs and which market bar it may use.

Schedule. A bot has one daily run time (HH:MM) in its own IANA timezone. The scheduler
(Cloud Scheduler -> Cloud Run job, or the local poller) may tick as often as it likes; a bot
is due only when the most recent occurrence of its run time is later than the last one it
handled. Times are resolved with zoneinfo, so a run time keeps its wall-clock meaning across
daylight-saving changes. A run time that does not exist on a spring-forward day (e.g. 02:30)
resolves to the same instant one hour later; an ambiguous fall-back time uses its first
occurrence. Either way there is exactly one slot per calendar day.

Bars. A bot decides only on completed bars. A daily bar is complete after its exchange's
regular close plus ``CLOSE_BUFFER`` (the close times below cover the venues Convolve lists;
other venues conservatively wait until local midnight). A weekly or monthly bar is complete
once the next period has begun in the exchange timezone. No holiday calendar is applied: a
closed market produces no new bar, so the run finds nothing new and records nothing.

One execution per bot and decision bar is enforced in the database (see bot_execution).
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pandas as pd

from app.config import DEFAULT_TIMEZONE

TIMEFRAMES = ("1d", "1wk", "1mo")
DEFAULT_TIMEFRAME = "1d"
CHART_SPAN_UNITS = ("days", "weeks", "months", "years")
DEFAULT_CHART_SPAN = ("months", 6)

# A transient failure (no market data, provider error) is retried at most this often.
RETRY_AFTER = timedelta(minutes=15)
CLOSE_BUFFER = timedelta(minutes=20)

# Regular-session close, local time, keyed by the exchange timezone yfinance reports.
EXCHANGE_CLOSE = {
    "America/New_York": time(16, 0),
    "America/Toronto": time(16, 0),
    "America/Chicago": time(16, 0),
    "Europe/London": time(16, 30),
    "Europe/Zurich": time(17, 30),
    "Europe/Paris": time(17, 30),
    "Europe/Berlin": time(17, 30),
    "Europe/Amsterdam": time(17, 30),
    "Europe/Madrid": time(17, 30),
    "Europe/Rome": time(17, 30),
    "Asia/Tokyo": time(15, 30),
    "Asia/Hong_Kong": time(16, 10),
    "Asia/Shanghai": time(15, 0),
    "Asia/Singapore": time(17, 0),
    "Australia/Sydney": time(16, 10),
}


def timeframe_of(bot) -> str:
    tf = (getattr(bot, "timeframe", None) or DEFAULT_TIMEFRAME).strip()
    return tf if tf in TIMEFRAMES else DEFAULT_TIMEFRAME


def chart_span_of(bot) -> tuple[str, int]:
    unit = getattr(bot, "chart_span_unit", None)
    count = getattr(bot, "chart_span_count", None)
    if unit in CHART_SPAN_UNITS and count and int(count) > 0:
        return unit, int(count)
    return DEFAULT_CHART_SPAN


def zone(name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo((name or DEFAULT_TIMEZONE).strip())
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TIMEZONE)


def valid_timezone(name: str) -> bool:
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return False


def parse_hhmm(raw: Optional[str]) -> tuple[int, int]:
    s = (raw or "").strip().replace(".", ":").replace(",", ":")
    parts = s.split(":")
    if len(parts) != 2:
        raise ValueError("Time must be HH:MM")
    h, m = int(parts[0]), int(parts[1])
    if not (0 <= h <= 23 and 0 <= m <= 59):
        raise ValueError("Time out of range")
    return h, m


def utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _slot_on(day: date, hhmm: tuple[int, int], tz: ZoneInfo) -> datetime:
    # Round-tripping through UTC normalises a non-existent local time (DST gap).
    return datetime.combine(day, time(*hhmm)).replace(tzinfo=tz).astimezone(timezone.utc)


def _hhmm_or_default(bot) -> tuple[int, int]:
    try:
        return parse_hhmm(getattr(bot, "run_time", None))
    except ValueError:
        from app.config import BOT_SCHEDULE_TIME

        return parse_hhmm(BOT_SCHEDULE_TIME)


def latest_slot(bot, now_utc: datetime) -> datetime:
    """Most recent scheduled instant at or before now (UTC)."""
    now_utc = utc(now_utc)
    tz = zone(getattr(bot, "timezone", None))
    hhmm = _hhmm_or_default(bot)
    today = now_utc.astimezone(tz).date()
    for day in (today, today - timedelta(days=1), today - timedelta(days=2)):
        slot = _slot_on(day, hhmm, tz)
        if slot <= now_utc:
            return slot
    raise AssertionError("unreachable: a slot exists within two days")


def next_slot(bot, now_utc: datetime) -> datetime:
    """First scheduled instant strictly after now (UTC)."""
    now_utc = utc(now_utc)
    tz = zone(getattr(bot, "timezone", None))
    hhmm = _hhmm_or_default(bot)
    today = now_utc.astimezone(tz).date()
    for offset in range(0, 3):
        slot = _slot_on(today + timedelta(days=offset), hhmm, tz)
        if slot > now_utc:
            return slot
    raise AssertionError("unreachable: a slot exists within two days")


def is_due(bot, now_utc: datetime) -> bool:
    """True when a scheduled slot has passed that this bot has not handled yet."""
    if (getattr(bot, "lifecycle_state", None) or "active") != "active":
        return False
    now_utc = utc(now_utc)
    attempted = utc(getattr(bot, "last_attempt_at", None))
    handled = utc(getattr(bot, "last_slot_at", None))
    if handled is None:
        # Never finished a slot (newly deployed): evaluate the latest completed bar right away.
        return attempted is None or now_utc - attempted >= RETRY_AFTER
    slot = latest_slot(bot, now_utc)
    if slot <= handled:
        return False
    if attempted is not None and attempted >= slot and now_utc - attempted < RETRY_AFTER:
        return False
    return True


def _bar_complete_at(bar_ts: pd.Timestamp, timeframe: str) -> datetime:
    ts = pd.Timestamp(bar_ts)
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    tz = ts.tzinfo
    tz_name = getattr(tz, "key", None) or str(tz)
    day = ts.date()
    if timeframe == "1wk":
        end = datetime.combine(day + timedelta(days=7), time(0, 0))
    elif timeframe == "1mo":
        first = day.replace(day=1)
        end = datetime.combine((first + timedelta(days=32)).replace(day=1), time(0, 0))
    else:
        close = EXCHANGE_CLOSE.get(tz_name)
        if close is None:
            end = datetime.combine(day + timedelta(days=1), time(0, 0))
        else:
            end = datetime.combine(day, close)
            return (pd.Timestamp(end).tz_localize(tz).to_pydatetime() + CLOSE_BUFFER).astimezone(timezone.utc)
    return pd.Timestamp(end).tz_localize(tz).to_pydatetime().astimezone(timezone.utc)


def completed_bars(bars: pd.DataFrame, timeframe: str, now_utc: datetime) -> pd.DataFrame:
    """Drop trailing bars that were still forming at ``now_utc``."""
    if bars is None or bars.empty:
        return bars
    now_utc = utc(now_utc)
    keep = len(bars)
    while keep > 0 and _bar_complete_at(bars.index[keep - 1], timeframe) > now_utc:
        keep -= 1
    return bars.iloc[:keep]


def execution_key(timeframe: str, bar_ts: pd.Timestamp) -> str:
    return f"{timeframe}:{pd.Timestamp(bar_ts).date().isoformat()}"


def chart_window(bars: pd.DataFrame, unit: str, count: int) -> pd.DataFrame:
    """Bars inside the trained chart span ending at the decision bar (inclusive)."""
    if bars is None or bars.empty:
        return bars
    end = pd.Timestamp(bars.index[-1])
    start = end - pd.DateOffset(**{unit: int(count)})
    return bars[bars.index > start]
