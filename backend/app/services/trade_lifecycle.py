"""
Open/close bot trades from daily bars and TP/SL/horizon rules.

Long-only, one open position per bot at a time. Commission and slippage apply
to entry/exit prices consistently with typical backtest-style sizing.
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


def _apply_slippage_exit_long(price: float, slippage_pct: float) -> float:
    """Sell: worse price (lower)."""
    return price * (1.0 - slippage_pct / 100.0)


def _apply_slippage_entry_long(price: float, slippage_pct: float) -> float:
    """Buy: worse price (higher)."""
    return price * (1.0 + slippage_pct / 100.0)


def _commission_round_trip(notional: float, commission_pct: float) -> float:
    return notional * (commission_pct / 100.0) * 2.0


def _close_trade(
    trade: BotTrade,
    *,
    exit_price: float,
    exit_d: date,
    reason: str,
    exit_run_id: Optional[str],
    commission_pct: float,
) -> None:
    gross = trade.position_notional * (exit_price - trade.entry_price) / trade.entry_price
    fees = _commission_round_trip(trade.position_notional, commission_pct)
    trade.pnl_amount = gross - fees
    trade.pnl_pct = (exit_price - trade.entry_price) / trade.entry_price * 100.0
    trade.exit_date = exit_d
    trade.exit_price = exit_price
    trade.exit_reason = reason
    trade.exit_run_id = exit_run_id
    if reason in (EXIT_TP,):
        trade.status = TRADE_WON
    elif reason in (EXIT_SL,):
        trade.status = TRADE_LOST
    elif reason == EXIT_MANUAL:
        trade.status = TRADE_CLOSED
    else:
        trade.status = TRADE_EXPIRED


def process_open_trades(
    db: Session,
    bot: Bot,
    market_data: pd.DataFrame,
    *,
    exit_run_id: Optional[str],
) -> float:
    """
    Update open trades using the latest candle; return sum of realized PnL (amount) from closes.
    """
    if market_data is None or market_data.empty:
        return 0.0

    bar_date, _o, high, low, close = _last_bar_ohlc(market_data)
    comm = float(bot.commission_pct)
    slip = float(bot.slippage_pct)

    realized = 0.0
    open_trades = (
        db.query(BotTrade)
        .filter(BotTrade.bot_id == bot.id, BotTrade.status == TRADE_OPEN)
        .all()
    )

    for trade in open_trades:
        exit_px: Optional[float] = None
        exit_reason: Optional[str] = None
        exit_d = bar_date

        if bar_date > trade.expiry_date:
            exit_px = _apply_slippage_exit_long(close, slip)
            exit_reason = EXIT_STALE
        elif bar_date == trade.expiry_date:
            if trade.sl_price is not None and low <= trade.sl_price:
                exit_px = _apply_slippage_exit_long(trade.sl_price, slip)
                exit_reason = EXIT_SL
            elif trade.tp_price is not None and high >= trade.tp_price:
                exit_px = _apply_slippage_exit_long(trade.tp_price, slip)
                exit_reason = EXIT_TP
            else:
                exit_px = _apply_slippage_exit_long(close, slip)
                exit_reason = EXIT_EXPIRY
        else:
            if trade.sl_price is not None and low <= trade.sl_price:
                exit_px = _apply_slippage_exit_long(trade.sl_price, slip)
                exit_reason = EXIT_SL
            elif trade.tp_price is not None and high >= trade.tp_price:
                exit_px = _apply_slippage_exit_long(trade.tp_price, slip)
                exit_reason = EXIT_TP

        if exit_px is not None and exit_reason is not None:
            _close_trade(
                trade,
                exit_price=exit_px,
                exit_d=exit_d,
                reason=exit_reason,
                exit_run_id=exit_run_id,
                commission_pct=comm,
            )
            db.add(trade)
            realized += float(trade.pnl_amount or 0.0)

    return realized


def close_all_open_trades_manual(
    db: Session,
    bot: Bot,
    market_data: pd.DataFrame,
    *,
    exit_run_id: Optional[str],
) -> float:
    """
    Close every open position at latest bar close with slippage (same exit pricing as MTM).
    exit_reason = manual. Returns sum of realized PnL from those closes.
    """
    if market_data is None or market_data.empty:
        return 0.0

    bar_date, _o, _h, _l, close = _last_bar_ohlc(market_data)
    comm = float(bot.commission_pct)
    slip = float(bot.slippage_pct)
    exit_px = _apply_slippage_exit_long(close, slip)

    realized = 0.0
    open_trades = (
        db.query(BotTrade)
        .filter(BotTrade.bot_id == bot.id, BotTrade.status == TRADE_OPEN)
        .all()
    )
    for trade in open_trades:
        _close_trade(
            trade,
            exit_price=exit_px,
            exit_d=bar_date,
            reason=EXIT_MANUAL,
            exit_run_id=exit_run_id,
            commission_pct=comm,
        )
        db.add(trade)
        realized += float(trade.pnl_amount or 0.0)

    return realized


def has_open_trade(db: Session, bot_id: str) -> bool:
    n = (
        db.query(func.count(BotTrade.id))
        .filter(BotTrade.bot_id == bot_id, BotTrade.status == TRADE_OPEN)
        .scalar()
    )
    return bool(n and n > 0)


def open_trade_from_buy_signal(
    db: Session,
    bot: Bot,
    market_data: pd.DataFrame,
    prediction_run: BotRun,
) -> Optional[BotTrade]:
    """Open a long if signal is BUY and no position is open."""
    if market_data is None or market_data.empty:
        return None
    if has_open_trade(db, bot.id):
        return None

    bar_date, _o, _h, _l, close = _last_bar_ohlc(market_data)
    slip = float(bot.slippage_pct)
    entry_px = _apply_slippage_entry_long(close, slip)

    total_equity, _, _ = compute_equity_and_unrealized(db, bot, market_data)
    pos_pct = float(bot.position_size_pct)
    notional = max(0.0, total_equity * (pos_pct / 100.0))
    if notional <= 0:
        return None

    tp_pct = bot.tp_pct
    sl_pct = bot.sl_pct
    horizon = int(bot.horizon_days)

    tp_price = entry_px * (1.0 + float(tp_pct) / 100.0) if tp_pct is not None else None
    sl_price = entry_px * (1.0 - float(sl_pct) / 100.0) if sl_pct is not None else None
    expiry = bar_date + timedelta(days=horizon)

    trade = BotTrade(
        id=str(uuid.uuid4()),
        bot_id=bot.id,
        prediction_run_id=prediction_run.id,
        entry_date=bar_date,
        entry_price=entry_px,
        position_notional=notional,
        tp_price=tp_price,
        sl_price=sl_price,
        horizon_days=horizon,
        expiry_date=expiry,
        status=TRADE_OPEN,
    )
    db.add(trade)
    return trade


def compute_equity_and_unrealized(
    db: Session,
    bot: Bot,
    market_data: Optional[pd.DataFrame],
) -> tuple[float, float, float]:
    """
    Returns (total_equity, realized_pnl, unrealized_pnl).
    Realized = sum closed trade pnl_amount. Unrealized = MTM for open trades at last close.
    """
    start = float(bot.starting_capital)
    realized_rows = (
        db.query(func.coalesce(func.sum(BotTrade.pnl_amount), 0.0))
        .filter(
            BotTrade.bot_id == bot.id,
            BotTrade.status.in_(all_closed_trade_statuses()),
        )
        .scalar()
    )
    realized = float(realized_rows or 0.0)

    unrealized = 0.0
    if market_data is not None and not market_data.empty:
        _, _o, _h, _l, close = _last_bar_ohlc(market_data)
        slip = float(bot.slippage_pct)
        exit_mark = _apply_slippage_exit_long(close, slip)
        comm = float(bot.commission_pct)
        open_trades = (
            db.query(BotTrade)
            .filter(BotTrade.bot_id == bot.id, BotTrade.status == TRADE_OPEN)
            .all()
        )
        for t in open_trades:
            gross = t.position_notional * (exit_mark - t.entry_price) / t.entry_price
            fees = _commission_round_trip(t.position_notional, comm)
            unrealized += gross - fees

    total = start + realized + unrealized
    return total, realized, unrealized


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
