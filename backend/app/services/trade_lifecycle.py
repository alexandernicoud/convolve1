"""
Trade status vocabulary, equity snapshots and win-rate helpers for paper bots.

Entries, exits and marking live in ``paper_engine``.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Bot, BotEquitySnapshot, BotRun, BotTrade

TRADE_OPEN = "open"
TRADE_WON = "won"
TRADE_LOST = "lost"
TRADE_EXPIRED = "expired"
TRADE_CLOSED = "closed"  # manual / forced exit at market

EXIT_TP = "take_profit"
EXIT_SL = "stop_loss"
EXIT_EXPIRY = "horizon_expired"
EXIT_STALE = "expired_stale"
EXIT_MANUAL = "manual"


def all_closed_trade_statuses() -> tuple[str, ...]:
    return (TRADE_WON, TRADE_LOST, TRADE_EXPIRED, TRADE_CLOSED)


def _last_bar_ohlc(market_data: pd.DataFrame) -> tuple[date, float, float, float, float]:
    idx = market_data.index[-1]
    bar_date = idx.date() if hasattr(idx, "date") else pd.Timestamp(idx).date()
    row = market_data.iloc[-1]
    o = float(row.get("Open", row.get("open", row["Close"])))
    h = float(row.get("High", row.get("high", row["Close"])))
    low = float(row.get("Low", row.get("low", row["Close"])))
    c = float(row["Close"])
    return bar_date, o, h, low, c


def compute_equity_and_unrealized(
    db: Session,
    bot: Bot,
    market_data: Optional[pd.DataFrame],
) -> tuple[float, float, float]:
    """(total_equity, realized_pnl, unrealized_pnl); see paper_engine.mark_to_market."""
    from app.services.paper_engine import mark_to_market

    return mark_to_market(db, bot, market_data)


def record_equity_snapshot(
    db: Session,
    bot: Bot,
    *,
    market_data: Optional[pd.DataFrame],
    bot_run_id: Optional[str],
) -> BotEquitySnapshot:
    total, realized, unrealized = compute_equity_and_unrealized(db, bot, market_data)
    snap = BotEquitySnapshot(
        id=str(uuid.uuid4()),
        bot_id=bot.id,
        as_of=datetime.now(timezone.utc),
        total_equity=total,
        realized_pnl=realized,
        unrealized_pnl=unrealized,
        bot_run_id=bot_run_id,
    )
    db.add(snap)
    return snap


def count_closed_trades(db: Session, bot_id: str) -> int:
    return (
        db.query(func.count(BotTrade.id))
        .filter(
            BotTrade.bot_id == bot_id,
            BotTrade.status.in_(all_closed_trade_statuses()),
        )
        .scalar()
        or 0
    )


def win_rate_closed(db: Session, bot_id: str) -> Optional[float]:
    """Winning TP hits / (TP wins + SL losses). Excludes expired and manual closes."""
    wins = (
        db.query(func.count(BotTrade.id))
        .filter(BotTrade.bot_id == bot_id, BotTrade.status == TRADE_WON)
        .scalar()
        or 0
    )
    losses = (
        db.query(func.count(BotTrade.id))
        .filter(BotTrade.bot_id == bot_id, BotTrade.status == TRADE_LOST)
        .scalar()
        or 0
    )
    denom = wins + losses
    if denom == 0:
        return None
    return wins / denom


def win_rate_wins_over_total_closed(db: Session, bot_id: str) -> Optional[float]:
    """TP wins / all closed trades (won + lost + expired + manual)."""
    wins = (
        db.query(func.count(BotTrade.id))
        .filter(BotTrade.bot_id == bot_id, BotTrade.status == TRADE_WON)
        .scalar()
        or 0
    )
    total = (
        db.query(func.count(BotTrade.id))
        .filter(
            BotTrade.bot_id == bot_id,
            BotTrade.status.in_(all_closed_trade_statuses()),
        )
        .scalar()
        or 0
    )
    if total == 0:
        return None
    return wins / total
