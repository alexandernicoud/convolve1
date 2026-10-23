"""Load fleet inputs from the bot_* tables for one owner scope (read-only)."""

from __future__ import annotations

from datetime import datetime, time, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Bot, BotEquitySnapshot, BotRun, BotTrade
from app.ownership import bot_scope_clause
from app.services.backtest_api import strip_paths
from app.services.bot_status import derive_bot_status, next_scheduled_run_iso
from app.services.fleet import (
    ACTIVITY_WINDOW,
    CLOSED_TRADE_STATUSES,
    ERROR_LOOKBACK,
    FLEET_LIFECYCLES,
    BotIn,
    RunIn,
    TradeIn,
    infer_currency,
)


def as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _day_utc(d) -> datetime:
    return datetime.combine(d, time.min, tzinfo=timezone.utc)


def trade_win_rate_db(db: Session, bot_ids: List[str]) -> Tuple[Optional[float], int, int]:
    """Unified trade win rate: closed trades with net P&L > 0 / all closed trades with a P&L."""
    if not bot_ids:
        return None, 0, 0
    base = db.query(func.count(BotTrade.id)).filter(
        BotTrade.bot_id.in_(bot_ids),
        BotTrade.status.in_(CLOSED_TRADE_STATUSES),
        BotTrade.pnl_amount.isnot(None),
    )
    n = int(base.scalar() or 0)
    wins = int(base.filter(BotTrade.pnl_amount > 0).scalar() or 0)
    return ((wins / n) if n else None), wins, n


def load_fleet_inputs(db: Session, owner_id: str, now: datetime) -> Tuple[List[BotIn], Dict[str, int]]:
    scoped = db.query(Bot).filter(bot_scope_clause(owner_id)).order_by(Bot.created_at.asc()).all()
    excluded: Dict[str, int] = {}
    fleet = []
    for b in scoped:
        ls = b.lifecycle_state or "active"
        if ls in FLEET_LIFECYCLES:
            fleet.append(b)
        else:
            excluded[ls] = excluded.get(ls, 0) + 1
    if not fleet:
        return [], excluded
    ids = [b.id for b in fleet]

    snaps: Dict[str, List[Tuple[datetime, float, float]]] = {i: [] for i in ids}
    for bot_id, as_of, eq, realized in (
        db.query(BotEquitySnapshot.bot_id, BotEquitySnapshot.as_of, BotEquitySnapshot.total_equity, BotEquitySnapshot.realized_pnl)
        .filter(BotEquitySnapshot.bot_id.in_(ids))
        .order_by(BotEquitySnapshot.bot_id, BotEquitySnapshot.as_of.asc(), BotEquitySnapshot.id.asc())
    ):
        snaps[bot_id].append((as_utc(as_of), float(eq), float(realized or 0.0)))

    run_time = func.coalesce(BotRun.run_finished_at, BotRun.run_started_at, BotRun.run_at)
    trades_by_bot: Dict[str, List[TradeIn]] = {i: [] for i in ids}
    rows = db.query(BotTrade).filter(BotTrade.bot_id.in_(ids)).order_by(BotTrade.entry_date.asc(), BotTrade.created_at.asc()).all()
    run_ids = {r for t in rows for r in (t.prediction_run_id, t.exit_run_id) if r}
    run_at: Dict[str, datetime] = {}
    if run_ids:
        for rid, t in db.query(BotRun.id, run_time).filter(BotRun.id.in_(run_ids)):
            if t is not None:
                run_at[rid] = as_utc(t)
    for t in rows:
        opened = run_at.get(t.prediction_run_id or "")
        closed = run_at.get(t.exit_run_id or "") if t.exit_date else None
        trades_by_bot[t.bot_id].append(
            TradeIn(
                id=t.id,
                bot_id=t.bot_id,
                status=t.status,
                notional=float(t.position_notional),
                entry_price=float(t.entry_price),
                opened_at=opened or _day_utc(t.entry_date),
                opened_precise=opened is not None,
                closed_at=(closed or _day_utc(t.exit_date)) if t.exit_date else None,
                closed_precise=closed is not None if t.exit_date else True,
                exit_price=float(t.exit_price) if t.exit_price is not None else None,
                pnl=float(t.pnl_amount) if t.pnl_amount is not None else None,
                exit_reason=t.exit_reason,
            )
        )

    a_start = now - ACTIVITY_WINDOW
    recent: Dict[str, List[RunIn]] = {i: [] for i in ids}
    errors: Dict[str, List[RunIn]] = {i: [] for i in ids}
    since = min(a_start, now - ERROR_LOOKBACK)
    for bot_id, t, status, signal, err in (
        db.query(BotRun.bot_id, run_time, BotRun.status, BotRun.signal, BotRun.error_message)
        .filter(BotRun.bot_id.in_(ids), run_time >= since)
        .order_by(run_time.asc())
    ):
        at = as_utc(t)
        if at is None:
            continue
        if at >= a_start:
            recent[bot_id].append(RunIn(at=at, status=status, signal=signal, error=err))
        if status == "error":
            errors[bot_id].append(RunIn(at=at, status=status, error=strip_paths(err)))

    out: List[BotIn] = []
    for b in fleet:
        latest = db.query(BotRun).filter(BotRun.bot_id == b.id).order_by(run_time.desc()).first()
        before = (
            db.query(func.max(run_time)).filter(BotRun.bot_id == b.id, run_time < a_start).scalar()
        )
        ccy, src = infer_currency(b.symbol)
        status = derive_bot_status(b, now_utc=now, latest_run=latest)
        out.append(
            BotIn(
                id=b.id,
                name=b.name,
                symbol=b.symbol,
                lifecycle=b.lifecycle_state or "active",
                status=status,
                created_at=as_utc(b.created_at) or now,
                starting_capital=float(b.starting_capital or 0.0),
                commission_pct=float(b.commission_pct or 0.0),
                slippage_pct=float(b.slippage_pct or 0.0),
                snaps=snaps[b.id],
                trades=trades_by_bot[b.id],
                runs_recent=recent[b.id],
                last_run_at=as_utc(
                    (latest.run_finished_at or latest.run_started_at or latest.run_at) if latest else None
                ),
                last_run_before_window=as_utc(before),
                errors_recent=errors[b.id],
                last_error=(strip_paths(latest.error_message) if latest is not None and latest.status == "error" else None),
                next_run_at=next_scheduled_run_iso(b, now, latest),
                source_backtest_run_id=b.source_backtest_run_id,
                currency=ccy,
                currency_source=src,
            )
        )
    return out, excluded
