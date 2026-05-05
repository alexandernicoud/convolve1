"""Assemble full GET /api/bots/{id}/trading response (read-only aggregation)."""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Optional

import pandas as pd
from sqlalchemy.orm import Session

from app.bot_runner import fetch_market_data
from app.models import Bot, BotEquitySnapshot, BotRun, BotTrade
from app.schemas.bot import (
    BotConfigSectionOut,
    BotEquityPointOut,
    BotOpenTradeRowOut,
    BotOut,
    BotPerformanceSectionOut,
    BotPredictionHistoryRowOut,
    BotRunOut,
    BotSummarySectionOut,
    BotTradeOut,
    BotTradingDetailFullOut,
)
from app.services.bot_status import derive_bot_status, next_scheduled_run_iso
from app.services.trade_lifecycle import (
    TRADE_OPEN,
    _apply_slippage_exit_long,
    _commission_round_trip,
    _last_bar_ohlc,
    all_closed_trade_statuses,
    compute_equity_and_unrealized,
    count_closed_trades,
    win_rate_wins_over_total_closed,
)

logger = logging.getLogger(__name__)


def _per_trade_unrealized(bot: Bot, trade: BotTrade, market_data: pd.DataFrame) -> float:
    if market_data is None or market_data.empty:
        return 0.0
    _, _o, _h, _l, close = _last_bar_ohlc(market_data)
    slip = float(bot.slippage_pct)
    exit_mark = _apply_slippage_exit_long(close, slip)
    comm = float(bot.commission_pct)
    gross = trade.position_notional * (exit_mark - trade.entry_price) / trade.entry_price
    fees = _commission_round_trip(trade.position_notional, comm)
    return gross - fees


def build_trading_detail_full(
    db: Session,
    bot: Bot,
    *,
    market_data: Optional[pd.DataFrame] = None,
) -> BotTradingDetailFullOut:
    if market_data is None:
        try:
            market_data = fetch_market_data(bot.symbol)
        except Exception as exc:
            logger.warning(
                "fetch_market_data failed for symbol=%s bot=%s: %s",
                bot.symbol,
                bot.id,
                exc,
            )
            market_data = pd.DataFrame()

    total_eq, realized, unreal = compute_equity_and_unrealized(db, bot, market_data)
    start = float(bot.starting_capital)
    total_return_pct = ((total_eq - start) / start * 100.0) if start else 0.0

    latest_run = (
        db.query(BotRun)
        .filter(BotRun.bot_id == bot.id)
        .order_by(BotRun.run_at.desc())
        .first()
    )
    now_utc = datetime.now(timezone.utc)
    derived = derive_bot_status(bot, now_utc=now_utc, latest_run=latest_run)
    next_iso = next_scheduled_run_iso(bot, now_utc, latest_run)

    created = bot.created_at
    if created and created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    started_days = 0
    if created:
        started_days = max(0, (now_utc - created).days)

    pred_count = db.query(BotRun).filter(BotRun.bot_id == bot.id, BotRun.status == "success").count()

    open_rows: list[BotOpenTradeRowOut] = []
    bar_date: Optional[date] = None
    last_close: Optional[float] = None
    if market_data is not None and not market_data.empty:
        bar_date, _o, _h, _l, last_close = _last_bar_ohlc(market_data)

    open_trades = (
        db.query(BotTrade)
        .filter(BotTrade.bot_id == bot.id, BotTrade.status == TRADE_OPEN)
        .order_by(BotTrade.entry_date.desc())
        .all()
    )
    for t in open_trades:
        u = _per_trade_unrealized(bot, t, market_data) if market_data is not None and not market_data.empty else 0.0
        days_held = 0
        if bar_date:
            days_held = max(0, (bar_date - t.entry_date).days)
        open_rows.append(
            BotOpenTradeRowOut(
                id=t.id,
                entry_date=t.entry_date,
                entry_price=t.entry_price,
                tp_price=t.tp_price,
                sl_price=t.sl_price,
                current_price=last_close,
                unrealized_pnl=u,
                days_held=days_held,
            )
        )

    closed_trades = (
        db.query(BotTrade)
        .filter(BotTrade.bot_id == bot.id, BotTrade.status.in_(all_closed_trade_statuses()))
        .order_by(BotTrade.exit_date.desc(), BotTrade.created_at.desc())
        .all()
    )

    snaps = (
        db.query(BotEquitySnapshot)
        .filter(BotEquitySnapshot.bot_id == bot.id)
        .order_by(BotEquitySnapshot.as_of.asc())
        .all()
    )
    equity_points = [
        BotEquityPointOut(
            as_of=s.as_of,
            total_equity=s.total_equity,
            realized_pnl=s.realized_pnl,
            unrealized_pnl=s.unrealized_pnl,
        )
        for s in snaps
    ]

    runs = (
        db.query(BotRun)
        .filter(BotRun.bot_id == bot.id)
        .order_by(BotRun.run_at.desc())
        .all()
    )
    trade_by_run: dict[str, str] = {}
    for tr in (
        db.query(BotTrade)
        .filter(BotTrade.bot_id == bot.id, BotTrade.prediction_run_id.isnot(None))
        .all()
    ):
        if tr.prediction_run_id:
            trade_by_run[tr.prediction_run_id] = tr.id

    pred_rows: list[BotPredictionHistoryRowOut] = []
    for r in runs:
        tid = trade_by_run.get(r.id)
        trade_opened = bool(tid)
        pred_rows.append(
            BotPredictionHistoryRowOut(
                run_id=r.id,
                run_at=r.run_at,
                chart_date=r.chart_date,
                signal=r.signal,
                confidence=r.confidence,
                label=r.label,
                status=r.status,
                trade_opened=trade_opened,
                linked_trade_id=tid,
            )
        )

    bot_out = BotOut.model_validate(bot)
    if latest_run:
        bot_out.latest_run = BotRunOut.model_validate(latest_run)
    bot_out = bot_out.model_copy(
        update={
            "derived_status": derived,
            "next_scheduled_run_iso": next_iso,
            "lifecycle_state": getattr(bot, "lifecycle_state", "active"),
        }
    )

    summary = BotSummarySectionOut(
        id=bot.id,
        symbol=bot.symbol,
        model_filename=bot.model_filename,
        started_at=created,
        runtime_days=bot.runtime_days,
        lifecycle_state=getattr(bot, "lifecycle_state", "active"),
        derived_status=derived,
        next_scheduled_run_iso=next_iso,
        days_running=started_days,
    )

    config = BotConfigSectionOut(
        starting_capital=bot.starting_capital,
        tp_pct=bot.tp_pct,
        sl_pct=bot.sl_pct,
        horizon_days=bot.horizon_days,
        position_size_pct=bot.position_size_pct,
        commission_pct=bot.commission_pct,
        slippage_pct=bot.slippage_pct,
        run_time=bot.run_time,
        timezone=bot.timezone,
    )

    perf = BotPerformanceSectionOut(
        current_equity=total_eq,
        realized_pnl=realized,
        unrealized_pnl=unreal,
        total_return_pct=total_return_pct,
        accuracy_winning_trades_over_total_closed=win_rate_wins_over_total_closed(db, bot.id),
        closed_trades_count=count_closed_trades(db, bot.id),
        open_trades_count=len(open_trades),
        predictions_count=int(pred_count),
    )

    return BotTradingDetailFullOut(
        bot=bot_out,
        summary=summary,
        config=config,
        performance=perf,
        open_trades_detail=open_rows,
        closed_trades=[BotTradeOut.model_validate(t) for t in closed_trades],
        prediction_history=pred_rows,
        equity_history=equity_points,
        recent_runs=[BotRunOut.model_validate(r) for r in runs[:80]],
    )
