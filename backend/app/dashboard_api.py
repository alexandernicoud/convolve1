"""Dashboard aggregates: overview metrics and per-bot equity series for charts."""

from __future__ import annotations

from datetime import datetime, time, timezone
from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, aliased

from app.config import USER_ID
from app.db import get_db
from app.models import Bot, BotEquitySnapshot, BotRun, BotTrade
from app.services.bot_status import next_scheduled_run_iso
from app.schemas.bot import (
    BotEquityPointOut,
    DashboardActivityItemOut,
    DashboardBundleOut,
    DashboardOverviewOut,
    DashboardTradeRowOut,
    EquitySeriesOut,
)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

CLOSED_STATUSES = ("won", "lost", "expired", "closed")
LONG_LABELS = ("LONG", "1", "long")


def _user_scope_filter():
    return or_(Bot.user_id == USER_ID, Bot.user_id.is_(None))


def _scoped_active_bots(db: Session) -> List[Bot]:
    """Non-archived bots for the current user scope (dashboard overview)."""
    return (
        db.query(Bot)
        .filter(_user_scope_filter(), Bot.lifecycle_state != "archived")
        .order_by(Bot.created_at.desc())
        .all()
    )


def _max_drawdown_pct_from_points(points: List[BotEquityPointOut]) -> Optional[float]:
    if len(points) < 2:
        return None
    peak = float(points[0].total_equity)
    max_dd = 0.0
    for p in points:
        v = float(p.total_equity)
        peak = max(peak, v)
        if peak > 0:
            dd = (peak - v) / peak
            max_dd = max(max_dd, dd)
    return max_dd * 100.0


def _label_1_precision_for_scope(
    db: Session, bot_ids: List[str], restrict_bot_id: Optional[str] = None
) -> Tuple[Optional[float], int]:
    """Precision of LONG predictions: won / (won + lost) for trades linked to LONG runs."""
    if not bot_ids:
        return None, 0
    PredRun = aliased(BotRun)
    q = (
        db.query(BotTrade)
        .join(PredRun, BotTrade.prediction_run_id == PredRun.id)
        .filter(
            BotTrade.bot_id.in_(bot_ids),
            BotTrade.status.in_(("won", "lost")),
            or_(
                PredRun.label.in_(LONG_LABELS),
                PredRun.signal.in_(("LONG", "1", "long")),
            ),
        )
    )
    if restrict_bot_id:
        q = q.filter(BotTrade.bot_id == restrict_bot_id)
    rows = q.all()
    wins = sum(1 for t in rows if t.status == "won")
    losses = sum(1 for t in rows if t.status == "lost")
    n = wins + losses
    if n == 0:
        return None, 0
    return wins / n, n


@router.get("/bundle", response_model=DashboardBundleOut)
def get_dashboard_bundle(db: Session = Depends(get_db)):
    now_utc = datetime.now(timezone.utc)
    bots = _scoped_active_bots(db)
    bot_ids = [b.id for b in bots]
    bot_by_id = {b.id: b for b in bots}

    total_realized = 0.0
    if bot_ids:
        tr = (
            db.query(func.coalesce(func.sum(BotTrade.pnl_amount), 0.0))
            .filter(
                BotTrade.bot_id.in_(bot_ids),
                BotTrade.status.in_(CLOSED_STATUSES),
            )
            .scalar()
        )
        total_realized = float(tr or 0.0)

    open_unrealized = 0.0
    total_starting_capital = 0.0
    current_equity = 0.0
    for b in bots:
        total_starting_capital += float(b.starting_capital or 0.0)
        snap = (
            db.query(BotEquitySnapshot)
            .filter(BotEquitySnapshot.bot_id == b.id)
            .order_by(BotEquitySnapshot.as_of.desc())
            .first()
        )
        if snap and snap.unrealized_pnl is not None:
            open_unrealized += float(snap.unrealized_pnl)
        if snap:
            current_equity += float(snap.total_equity)
        else:
            current_equity += float(b.starting_capital or 0.0)

    active_bots = sum(1 for b in bots if getattr(b, "lifecycle_state", "active") == "active")

    best_id = None
    best_name = None
    best_pnl = None
    best_symbol = None
    best_start = None
    best_return_pct = None
    best_max_dd: Optional[float] = None
    best_l1_prec: Optional[float] = None
    best_l1_n = 0

    for b in bots:
        pnl = (
            db.query(func.coalesce(func.sum(BotTrade.pnl_amount), 0.0))
            .filter(
                BotTrade.bot_id == b.id,
                BotTrade.status.in_(CLOSED_STATUSES),
            )
            .scalar()
        )
        pnl = float(pnl or 0.0)
        if best_pnl is None or pnl > best_pnl:
            best_pnl = pnl
            best_id = b.id
            best_name = b.name or b.symbol
            best_symbol = b.symbol
            best_start = float(b.starting_capital or 0.0)

    if best_id and best_start and best_start > 0 and best_pnl is not None:
        best_return_pct = (best_pnl / best_start) * 100.0

    if best_id:
        snaps = (
            db.query(BotEquitySnapshot)
            .filter(BotEquitySnapshot.bot_id == best_id)
            .order_by(BotEquitySnapshot.as_of.asc())
            .all()
        )
        pts = [
            BotEquityPointOut(
                as_of=s.as_of,
                total_equity=s.total_equity,
                realized_pnl=s.realized_pnl,
                unrealized_pnl=s.unrealized_pnl,
            )
            for s in snaps
        ]
        best_max_dd = _max_drawdown_pct_from_points(pts)
        bp, bn = _label_1_precision_for_scope(db, bot_ids, restrict_bot_id=best_id)
        best_l1_prec = bp
        best_l1_n = bn

    wins = (
        db.query(func.count(BotTrade.id))
        .filter(BotTrade.bot_id.in_(bot_ids), BotTrade.status == "won")
        .scalar()
        or 0
    )
    losses = (
        db.query(func.count(BotTrade.id))
        .filter(BotTrade.bot_id.in_(bot_ids), BotTrade.status == "lost")
        .scalar()
        or 0
    )
    win_rate = (wins / (wins + losses)) if (wins + losses) > 0 else None

    total_closed = (
        db.query(func.count(BotTrade.id))
        .filter(BotTrade.bot_id.in_(bot_ids), BotTrade.status.in_(CLOSED_STATUSES))
        .scalar()
        or 0
    )

    open_trades_count = (
        db.query(func.count(BotTrade.id))
        .filter(BotTrade.bot_id.in_(bot_ids), BotTrade.status == "open")
        .scalar()
        or 0
    )

    l1_prec, l1_n = _label_1_precision_for_scope(db, bot_ids, restrict_bot_id=None)

    next_run = None
    for b in bots:
        if getattr(b, "lifecycle_state", "active") != "active":
            continue
        lr = (
            db.query(BotRun)
            .filter(BotRun.bot_id == b.id)
            .order_by(BotRun.run_at.desc())
            .first()
        )
        n = next_scheduled_run_iso(b, now_utc, lr)
        if n:
            next_run = n
            break

    overview = DashboardOverviewOut(
        total_realized_pnl=total_realized,
        open_unrealized_pnl=open_unrealized,
        active_bots=active_bots,
        best_bot_id=best_id,
        best_bot_name=best_name,
        best_realized_pnl=best_pnl,
        win_rate_closed=win_rate,
        total_closed_trades=int(total_closed),
        open_trades_count=int(open_trades_count),
        next_scheduled_run_iso=next_run,
        total_starting_capital=total_starting_capital,
        current_equity=current_equity,
        label_1_precision=l1_prec,
        label_1_precision_sample=l1_n,
        best_bot_symbol=best_symbol,
        best_bot_starting_capital=best_start,
        best_bot_return_pct=best_return_pct,
        best_bot_max_drawdown_pct=best_max_dd,
        best_bot_label_1_precision=best_l1_prec,
        best_bot_label_1_sample=best_l1_n,
    )

    equity_by_bot: List[EquitySeriesOut] = []
    for b in sorted(bots, key=lambda x: x.created_at, reverse=True):
        snaps = (
            db.query(BotEquitySnapshot)
            .filter(BotEquitySnapshot.bot_id == b.id)
            .order_by(BotEquitySnapshot.as_of.asc())
            .limit(400)
            .all()
        )
        points = [
            BotEquityPointOut(
                as_of=s.as_of,
                total_equity=s.total_equity,
                realized_pnl=s.realized_pnl,
                unrealized_pnl=s.unrealized_pnl,
            )
            for s in snaps
        ]
        equity_by_bot.append(
            EquitySeriesOut(
                bot_id=b.id,
                name=b.name,
                symbol=b.symbol,
                points=points,
            )
        )

    # Activity feed: merge recent predictions and closed trades
    activity_feed: List[DashboardActivityItemOut] = []
    if bot_ids:
        recent_runs = (
            db.query(BotRun)
            .filter(BotRun.bot_id.in_(bot_ids))
            .order_by(BotRun.run_at.desc())
            .limit(14)
            .all()
        )
        for r in recent_runs:
            bb = bot_by_id.get(r.bot_id)
            sym = bb.symbol if bb else "—"
            nm = (bb.name or sym) if bb else "—"
            if r.status == "error":
                title = "Run error"
                sub = (r.error_message or "")[:120] or None
            else:
                sig = (r.label or r.signal or "NEUTRAL").upper()
                title = f"Prediction · {sig}"
                conf = r.confidence
                sub = f"Confidence {round(conf * 100)}%" if conf is not None else None
            activity_feed.append(
                DashboardActivityItemOut(
                    at=r.run_at,
                    kind="prediction",
                    symbol=sym,
                    bot_name=nm,
                    title=title,
                    subtitle=sub,
                    confidence=r.confidence,
                )
            )

        recent_trades = (
            db.query(BotTrade)
            .filter(
                BotTrade.bot_id.in_(bot_ids),
                BotTrade.status.in_(CLOSED_STATUSES),
                BotTrade.exit_date.isnot(None),
            )
            .order_by(BotTrade.exit_date.desc(), BotTrade.created_at.desc())
            .limit(14)
            .all()
        )
        for t in recent_trades:
            bb = bot_by_id.get(t.bot_id)
            sym = bb.symbol if bb else "—"
            nm = (bb.name or sym) if bb else "—"
            pnl = float(t.pnl_amount) if t.pnl_amount is not None else None
            reason = (t.exit_reason or t.status or "").upper()
            ex = t.exit_date.isoformat() if t.exit_date else ""
            activity_feed.append(
                DashboardActivityItemOut(
                    at=datetime.combine(t.exit_date, time.min, tzinfo=timezone.utc)
                    if t.exit_date
                    else now_utc,
                    kind="trade_closed",
                    symbol=sym,
                    bot_name=nm,
                    title=f"Trade closed · {reason}",
                    subtitle=f"Exit {ex}" if ex else None,
                    pnl_amount=pnl,
                )
            )

    activity_feed.sort(key=lambda x: x.at, reverse=True)
    activity_feed = activity_feed[:12]

    return DashboardBundleOut(overview=overview, equity_by_bot=equity_by_bot, activity_feed=activity_feed)


def _scoped_all_bots(db: Session) -> List[Bot]:
    """All bots for user (including archived) — for destructive resets."""
    return db.query(Bot).filter(_user_scope_filter()).order_by(Bot.created_at.desc()).all()


@router.get("/trades", response_model=List[DashboardTradeRowOut])
def list_dashboard_trades(bot_id: Optional[str] = None, db: Session = Depends(get_db)):
    """All trades across bots (optional filter by bot)."""
    bots = _scoped_all_bots(db)
    bot_by_id = {b.id: b for b in bots}
    ids = [b.id for b in bots]
    if not ids:
        return []
    if bot_id:
        if bot_id not in bot_by_id:
            raise HTTPException(status_code=404, detail="Bot not found")
        ids = [bot_id]

    rows = (
        db.query(BotTrade)
        .filter(BotTrade.bot_id.in_(ids))
        .order_by(BotTrade.entry_date.desc())
        .limit(2000)
        .all()
    )
    out: List[DashboardTradeRowOut] = []
    for t in rows:
        bb = bot_by_id.get(t.bot_id)
        sym = bb.symbol if bb else "—"
        nm = (bb.name or sym) if bb else "—"
        ex = t.exit_date.isoformat() if t.exit_date else None
        out.append(
            DashboardTradeRowOut(
                id=t.id,
                bot_id=t.bot_id,
                bot_name=nm,
                symbol=sym,
                entry_date=t.entry_date.isoformat(),
                exit_date=ex,
                status=t.status,
                pnl_amount=float(t.pnl_amount) if t.pnl_amount is not None else None,
                pnl_pct=float(t.pnl_pct) if t.pnl_pct is not None else None,
            )
        )
    return out


@router.post("/reset-trading-history")
def reset_trading_history(db: Session = Depends(get_db)):
    """
    Delete all runs, trades, and equity snapshots for bots in this user scope.
    Bots themselves are kept. Irreversible — call only after UI confirmation.
    """
    bots = _scoped_all_bots(db)
    bot_ids = [b.id for b in bots]
    if not bot_ids:
        return {"ok": True, "deleted_runs": 0, "deleted_trades": 0, "deleted_snapshots": 0}

    n_tr = db.query(BotTrade).filter(BotTrade.bot_id.in_(bot_ids)).delete(synchronize_session=False)
    n_sn = (
        db.query(BotEquitySnapshot).filter(BotEquitySnapshot.bot_id.in_(bot_ids)).delete(synchronize_session=False)
    )
    n_rn = db.query(BotRun).filter(BotRun.bot_id.in_(bot_ids)).delete(synchronize_session=False)
    db.commit()
    return {"ok": True, "deleted_runs": n_rn, "deleted_trades": n_tr, "deleted_snapshots": n_sn}
