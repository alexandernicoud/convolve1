"""
Paper-trading engine for deployed bots, on completed bars only.

Execution convention (identical to the Backtester, ``trade_outcomes.next_open_tp_sl_v1``):

- The model decides at the close of the latest completed bar (the decision bar).
- A BUY becomes a pending entry. It fills at the open of the first bar after the decision
  bar, once that bar has completed, at open x (1 + slippage). Nothing is filled at a price
  that was not yet observable when the signal was formed.
- TP and SL levels are fixed from the entry bar's open. Every bar from the entry bar on is
  checked; SL wins when both levels fall inside one bar; an open through the stop fills at
  that open; a timeout exits at the close of bar ``horizon`` (the entry bar is bar 1).
- Exits fill at price x (1 - slippage). Commission is charged on traded notional at entry
  and at exit.
- Long only, one position at a time. Size = position_size_pct of realized equity (cash) at
  the fill. A BUY while a position is open is recorded and not traded.
- Open positions are marked at the latest completed close x (1 - slippage), net of both
  commissions.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone
from typing import Any, Optional

import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Bot, BotRun, BotTrade
from app.services import trade_outcomes as to
from app.services.bot_schedule import timeframe_of, utc
from app.services.trade_lifecycle import (
    EXIT_EXPIRY,
    EXIT_SL,
    EXIT_TP,
    TRADE_EXPIRED,
    TRADE_LOST,
    TRADE_OPEN,
    TRADE_WON,
    all_closed_trade_statuses,
)

ENGINE_VERSION = "paper_next_open_v1"

ENTRY_PENDING = "pending"
ENTRY_FILLED = "filled"
ENTRY_SKIPPED_OPEN = "skipped_position_open"
ENTRY_CANCELLED = "cancelled"

_EXIT_REASON = {to.EXIT_TP: EXIT_TP, to.EXIT_SL: EXIT_SL, to.EXIT_TIMEOUT: EXIT_EXPIRY}
_STATUS = {to.EXIT_TP: TRADE_WON, to.EXIT_SL: TRADE_LOST, to.EXIT_TIMEOUT: TRADE_EXPIRED}


def assumptions(bot: Bot) -> dict[str, Any]:
    """What a run of this bot assumes; stored on every run and shown in the UI."""
    tf = timeframe_of(bot)
    return {
        "engine": ENGINE_VERSION,
        "outcome_convention": to.OUTCOME_CONVENTION,
        "timeframe": tf,
        "decision": "close of the latest completed bar",
        "entry": "open of the next bar x (1 + slippage), filled once that bar has completed",
        "exits": "TP/SL from the entry open, checked on every bar from the entry bar; SL first when both touch one bar; "
        "an open through the stop fills at the open; timeout at the close of the last horizon bar",
        "horizon": f"{int(bot.horizon_days)} bars ({tf}), entry bar counts as bar 1",
        "costs": f"commission {bot.commission_pct}% per side on traded notional; slippage {bot.slippage_pct}% per side",
        "sizing": f"{bot.position_size_pct}% of cash at the fill; long only; one position at a time",
        "marking": "latest completed close x (1 - slippage), net of both commissions",
        "data": "Yahoo Finance via yfinance, split- and dividend-adjusted; no exchange holiday calendar "
        "(a closed market produces no new bar)",
    }


def outcome_spec(bot: Bot) -> to.OutcomeSpec:
    return to.OutcomeSpec(
        horizon_bars=max(1, int(bot.horizon_days)),
        tp_frac=float(bot.tp_pct) / 100.0,
        sl_frac=float(bot.sl_pct) / 100.0,
        timeframe=timeframe_of(bot),
    )


def realized_pnl(db: Session, bot: Bot) -> float:
    total = (
        db.query(func.coalesce(func.sum(BotTrade.pnl_amount), 0.0))
        .filter(BotTrade.bot_id == bot.id, BotTrade.status.in_(all_closed_trade_statuses()))
        .scalar()
    )
    return float(total or 0.0)


def open_trades(db: Session, bot: Bot) -> list[BotTrade]:
    return db.query(BotTrade).filter(BotTrade.bot_id == bot.id, BotTrade.status == TRADE_OPEN).all()


def pending_entries(db: Session, bot: Bot) -> list[BotRun]:
    return (
        db.query(BotRun)
        .filter(BotRun.bot_id == bot.id, BotRun.entry_state == ENTRY_PENDING)
        .order_by(BotRun.decision_bar_at.asc())
        .all()
    )


def earliest_needed_bar(db: Session, bot: Bot) -> Optional[datetime]:
    """Oldest decision bar an open position or pending entry still depends on."""
    refs = [utc(r.decision_bar_at) for r in pending_entries(db, bot)]
    for t in open_trades(db, bot):
        if t.decision_bar_at is not None:
            refs.append(utc(t.decision_bar_at))
        else:
            refs.append(datetime.combine(t.entry_date, datetime.min.time(), tzinfo=timezone.utc))
    refs = [r for r in refs if r is not None]
    return min(refs) if refs else None


def _bar_at(bars: pd.DataFrame, when: datetime) -> Optional[pd.Timestamp]:
    """The bar whose date equals ``when``'s date in the bars' timezone."""
    target = pd.Timestamp(when)
    if bars.index.tz is not None:
        target = target.tz_convert(bars.index.tz) if target.tzinfo else target.tz_localize(bars.index.tz)
    matches = bars.index[bars.index.normalize() == target.normalize()]
    return matches[0] if len(matches) else None


def _costs(bot: Bot) -> tuple[float, float]:
    return float(bot.commission_pct) / 100.0, float(bot.slippage_pct) / 100.0


def _close(trade: BotTrade, *, bot: Bot, raw_exit: float, exit_ts: pd.Timestamp, reason: str, status: str,
           exit_run_id: Optional[str], bars_held: Optional[int]) -> float:
    _c, s = _costs(bot)
    exit_fill = raw_exit * (1.0 - s)
    ratio = exit_fill / trade.entry_price
    pnl = unrealized(bot, trade, raw_exit)
    trade.exit_price = exit_fill
    trade.exit_date = pd.Timestamp(exit_ts).date()
    trade.exit_reason = reason
    trade.exit_run_id = exit_run_id
    trade.status = status
    trade.pnl_amount = pnl
    trade.pnl_pct = (ratio - 1.0) * 100.0
    trade.bars_held = bars_held
    return pnl


def _estimated_expiry(entry: date, horizon: int, timeframe: str) -> date:
    """Calendar estimate for display; the exit itself counts bars."""
    if timeframe == "1wk":
        return entry + pd.Timedelta(weeks=horizon - 1)
    if timeframe == "1mo":
        return (pd.Timestamp(entry) + pd.DateOffset(months=horizon - 1)).date()
    return (pd.Timestamp(entry) + pd.offsets.BDay(horizon - 1)).date()


def _fill_pending(db: Session, bot: Bot, bars: pd.DataFrame, events: dict) -> None:
    spec = outcome_spec(bot)
    c, s = _costs(bot)
    for run in pending_entries(db, bot):
        if open_trades(db, bot):
            run.entry_state = ENTRY_SKIPPED_OPEN
            continue
        decision = _bar_at(bars, utc(run.decision_bar_at))
        if decision is None:
            run.entry_state = ENTRY_CANCELLED
            events["cancelled"].append({"run_id": run.id, "reason": "decision bar missing from market data"})
            continue
        oc = to.resolve_outcome(bars, decision, spec)
        if oc.status == to.STATUS_INVALID:
            run.entry_state = ENTRY_CANCELLED
            events["cancelled"].append({"run_id": run.id, "reason": oc.invalid_reason})
            continue
        if oc.entry_ts is None:
            continue  # the entry bar has not completed yet
        cash = float(bot.starting_capital) + realized_pnl(db, bot)
        notional = cash * float(bot.position_size_pct) / 100.0
        if notional <= 0 or notional * (1.0 + c) > cash + 1e-9:
            run.entry_state = ENTRY_CANCELLED
            events["cancelled"].append({"run_id": run.id, "reason": "insufficient cash"})
            continue
        entry_date = pd.Timestamp(oc.entry_ts).date()
        trade = BotTrade(
            id=str(uuid.uuid4()),
            bot_id=bot.id,
            prediction_run_id=run.id,
            decision_bar_at=utc(pd.Timestamp(decision).to_pydatetime()),
            entry_date=entry_date,
            entry_price=float(oc.entry_price) * (1.0 + s),
            position_notional=notional,
            tp_price=oc.tp_price,
            sl_price=oc.sl_price,
            horizon_days=spec.horizon_bars,
            expiry_date=_estimated_expiry(entry_date, spec.horizon_bars, spec.timeframe),
            status=TRADE_OPEN,
        )
        db.add(trade)
        run.entry_state = ENTRY_FILLED
        db.flush()
        events["filled"].append({"trade_id": trade.id, "run_id": run.id, "entry_date": entry_date.isoformat()})


def _resolve_legacy(trade: BotTrade, bars: pd.DataFrame) -> Optional[tuple[str, float, pd.Timestamp, int, list]]:
    """Trades opened by the previous engine (entered at a close, no decision bar recorded):
    walk the bars after the entry date with the stored levels and the same SL-first rules."""
    after = bars[bars.index.normalize() > pd.Timestamp(trade.entry_date).tz_localize(bars.index.tz)]
    window = after.iloc[: int(trade.horizon_days)]
    flags: list = ["legacy_entry_at_close"]
    for k, (ts, row) in enumerate(window.iterrows()):
        o, h, l = float(row["Open"]), float(row["High"]), float(row["Low"])
        if trade.sl_price is not None and l <= trade.sl_price:
            if trade.tp_price is not None and h >= trade.tp_price:
                flags.append(to.FLAG_AMBIGUOUS)
            px = o if o <= trade.sl_price else trade.sl_price
            return to.EXIT_SL, px, ts, k + 1, flags
        if trade.tp_price is not None and h >= trade.tp_price:
            return to.EXIT_TP, float(trade.tp_price), ts, k + 1, flags
    if len(window) >= int(trade.horizon_days) and len(window):
        return to.EXIT_TIMEOUT, float(window["Close"].iloc[-1]), window.index[-1], len(window), flags
    return None


def _resolve_open(db: Session, bot: Bot, bars: pd.DataFrame, exit_run_id: Optional[str], events: dict) -> float:
    spec = outcome_spec(bot)
    realized = 0.0
    for trade in open_trades(db, bot):
        if trade.decision_bar_at is None:
            res = _resolve_legacy(trade, bars)
            if res is None:
                continue
            reason, px, ts, held, flags = res
        else:
            decision = _bar_at(bars, utc(trade.decision_bar_at))
            if decision is None:
                continue
            oc = to.resolve_outcome(bars, decision, spec)
            trade.bars_held = oc.bars_available
            if oc.status != to.STATUS_RESOLVED or oc.exit_reason not in _EXIT_REASON:
                continue
            reason, px, ts, held, flags = oc.exit_reason, float(oc.exit_price), oc.exit_ts, oc.bars_held, oc.flags
        realized += _close(
            trade, bot=bot, raw_exit=px, exit_ts=ts, reason=_EXIT_REASON[reason], status=_STATUS[reason],
            exit_run_id=exit_run_id, bars_held=held,
        )
        trade.outcome_flags = json.dumps(flags) if flags else None
        events["closed"].append({"trade_id": trade.id, "reason": _EXIT_REASON[reason], "exit_date": trade.exit_date.isoformat()})
    return realized


def settle(db: Session, bot: Bot, bars: pd.DataFrame, *, exit_run_id: Optional[str]) -> dict:
    """Fill pending entries and resolve open trades on completed bars. Caller commits."""
    events: dict = {"filled": [], "closed": [], "cancelled": []}
    if bars is None or bars.empty:
        events["realized"] = 0.0
        return events
    _fill_pending(db, bot, bars, events)
    db.flush()
    events["realized"] = _resolve_open(db, bot, bars, exit_run_id, events)
    # An entry and its exit can resolve in one pass (e.g. stop hit on the entry bar).
    db.flush()
    return events


def queue_entry(db: Session, bot: Bot, run: BotRun) -> str:
    """Record what a BUY on ``run`` will do; returns the entry_state."""
    if open_trades(db, bot):
        run.entry_state = ENTRY_SKIPPED_OPEN
    elif pending_entries(db, bot):
        run.entry_state = ENTRY_SKIPPED_OPEN
    else:
        run.entry_state = ENTRY_PENDING
    return run.entry_state


def unrealized(bot: Bot, trade: BotTrade, close: float) -> float:
    """Net P&L if ``trade`` were sold at ``close``: slippage and both commissions included."""
    c, s = _costs(bot)
    ratio = float(close) * (1.0 - s) / trade.entry_price
    return trade.position_notional * (ratio - 1.0) - trade.position_notional * c - trade.position_notional * ratio * c


def mark_to_market(db: Session, bot: Bot, bars: Optional[pd.DataFrame]) -> tuple[float, float, float]:
    """(total_equity, realized_pnl, unrealized_pnl) at the latest completed close."""
    realized = realized_pnl(db, bot)
    total_unrealized = 0.0
    if bars is not None and not bars.empty:
        close = float(bars["Close"].iloc[-1])
        total_unrealized = sum(unrealized(bot, t, close) for t in open_trades(db, bot))
    return float(bot.starting_capital) + realized + total_unrealized, realized, total_unrealized


def close_all(db: Session, bot: Bot, bars: pd.DataFrame) -> float:
    """Manual stop: exit open positions at the latest completed close; cancel pending entries."""
    from app.services.trade_lifecycle import EXIT_MANUAL, TRADE_CLOSED

    for run in pending_entries(db, bot):
        run.entry_state = ENTRY_CANCELLED
    if bars is None or bars.empty:
        return 0.0
    ts = bars.index[-1]
    close = float(bars["Close"].iloc[-1])
    return sum(
        _close(t, bot=bot, raw_exit=close, exit_ts=ts, reason=EXIT_MANUAL, status=TRADE_CLOSED, exit_run_id=None, bars_held=t.bars_held)
        for t in open_trades(db, bot)
    )
