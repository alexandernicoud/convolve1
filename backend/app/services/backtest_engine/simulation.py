"""
Chronological long-only portfolio simulation on stored OHLC bars (methodology ``price_sim_v2``).

Execution convention (per trading day T on the union calendar of all symbols):

1. Entries. Signals whose entry bar (the bar after the decision bar) falls on T are ranked by
   (probability desc, symbol, sample_id) and filled at T's open × (1 + slippage). Size is
   ``position_size_pct`` of equity at the previous close. An entry is skipped (never resized) when the
   symbol already has an open position, the concurrent-position or daily-entry limit is reached, the
   exposure cap would be exceeded, or cash cannot cover notional + entry commission.
2. Exits. TP/SL/timeout follow ``trade_outcomes.resolve_outcome`` on the same bars (levels from the
   raw entry open; SL checked first; gaps through the stop fill at the open). Fill = exit price ×
   (1 − slippage). Cash settles on the actual exit bar.
3. Marking. Open positions are valued at T's close; when a symbol has no bar on T, its last close is
   carried and counted as a stale mark.

Costs: commission is a fraction of traded notional, charged on entry and on exit; slippage is an
adverse price move on each side. Positions still open at the end are marked at the last close and
reported as open (never booked as exits).
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Sequence

import numpy as np
import pandas as pd

from app.services import trade_outcomes as to

METHODOLOGY_ID = "price_sim_v2"
METHODOLOGY_VERSION = 2
ENGINE_VERSION = "2.0.0"

SKIP_SYMBOL_OPEN = "symbol_position_open"
SKIP_MAX_CONCURRENT = "max_concurrent_positions"
SKIP_MAX_TRADES_DAY = "max_trades_per_day"
SKIP_EXPOSURE = "exposure_cap"
SKIP_CASH = "insufficient_cash"
SKIP_NO_ENTRY_BAR = "no_entry_bar"
SKIP_INVALID_DATA = "invalid_market_data"
SKIP_DRAWDOWN_HALT = "drawdown_halt"
SKIP_PURGED = "purged_by_leakage_audit"
SKIP_BEFORE_START = "before_simulation_start"


@dataclass(frozen=True)
class SimConfig:
    starting_capital: float = 10_000.0
    position_size_pct: float = 10.0
    max_exposure_pct: float = 100.0
    max_concurrent_positions: int = 10
    max_trades_per_day: Optional[int] = None
    commission_pct: float = 0.1  # per side, % of traded notional
    slippage_pct: float = 0.05  # per side, % adverse price move
    drawdown_halt_pct: Optional[float] = None  # stop opening new positions beyond this drawdown

    def validate(self) -> None:
        if not (self.starting_capital > 0):
            raise ValueError("starting_capital must be positive")
        if not (0 < self.position_size_pct <= 100):
            raise ValueError("position_size_pct must be in (0, 100]")
        if not (0 < self.max_exposure_pct <= 100):
            raise ValueError("max_exposure_pct must be in (0, 100] (no leverage)")
        if self.max_concurrent_positions < 1:
            raise ValueError("max_concurrent_positions must be >= 1")
        if self.max_trades_per_day is not None and self.max_trades_per_day < 1:
            raise ValueError("max_trades_per_day must be >= 1 when set")
        if self.commission_pct < 0 or self.slippage_pct < 0:
            raise ValueError("costs must be non-negative")
        if self.drawdown_halt_pct is not None and not (0 < self.drawdown_halt_pct <= 100):
            raise ValueError("drawdown_halt_pct must be in (0, 100]")

    def as_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["cost_convention"] = (
            "commission_pct and slippage_pct are percentages applied on each side: commission on traded "
            "notional at entry and at exit; slippage as an adverse fill-price move at entry and at exit."
        )
        return d


@dataclass
class Signal:
    sample_id: str
    symbol: str
    decision_ts: pd.Timestamp
    prob: float
    label: Optional[int] = None


@dataclass
class _Position:
    sig: Signal
    outcome: to.Outcome
    entry_date: pd.Timestamp
    exit_date: Optional[pd.Timestamp]
    shares: float
    entry_fill: float
    notional: float
    entry_commission: float
    last_mark: float
    stale_marks: int = 0


def _day(ts: pd.Timestamp) -> pd.Timestamp:
    return pd.Timestamp(ts.date())


def _fmt(ts: Optional[pd.Timestamp]) -> Optional[str]:
    return ts.isoformat() if ts is not None else None


@dataclass
class SimResult:
    config: Dict[str, Any]
    trades: List[Dict[str, Any]]
    skipped: List[Dict[str, Any]]
    equity: pd.DataFrame
    diagnostics: Dict[str, Any] = field(default_factory=dict)


def simulate(
    signals: Sequence[Signal],
    bars: Dict[str, pd.DataFrame],
    spec: to.OutcomeSpec,
    cfg: SimConfig,
    *,
    threshold: float,
    start_date: Optional[pd.Timestamp] = None,
    purged: Optional[set] = None,
) -> SimResult:
    """Run the simulation. ``signals`` are all predictions; only prob >= threshold are entry candidates."""
    cfg.validate()
    purged = purged or set()
    c, sl = cfg.commission_pct / 100.0, cfg.slippage_pct / 100.0

    closes: Dict[str, pd.Series] = {}
    for sym, df in bars.items():
        s = df["Close"].astype(float)
        s.index = pd.DatetimeIndex([_day(t) for t in df.index])
        closes[sym] = s[~s.index.duplicated(keep="last")]

    skipped: List[Dict[str, Any]] = []
    candidates: List[tuple] = []  # (entry_date, signal, outcome)
    ambiguous = gap_stop = gap_target = irregular = 0
    for sig in signals:
        if sig.prob is None or not math.isfinite(sig.prob) or sig.prob < threshold:
            continue
        if sig.sample_id in purged:
            skipped.append({"sample_id": sig.sample_id, "symbol": sig.symbol, "entry_ts": None, "prob": sig.prob, "reason": SKIP_PURGED})
            continue
        df = bars.get(sig.symbol)
        if df is None:
            skipped.append({"sample_id": sig.sample_id, "symbol": sig.symbol, "entry_ts": None, "prob": sig.prob, "reason": SKIP_INVALID_DATA})
            continue
        out = to.resolve_outcome(df, sig.decision_ts, spec)
        if out.status == to.STATUS_INVALID:
            skipped.append({"sample_id": sig.sample_id, "symbol": sig.symbol, "entry_ts": None, "prob": sig.prob,
                            "reason": SKIP_INVALID_DATA, "detail": out.invalid_reason})
            continue
        if out.entry_ts is None:
            skipped.append({"sample_id": sig.sample_id, "symbol": sig.symbol, "entry_ts": None, "prob": sig.prob, "reason": SKIP_NO_ENTRY_BAR})
            continue
        candidates.append((_day(out.entry_ts), sig, out))

    day0 = _day(start_date) if start_date is not None else (
        min(_day(s.decision_ts) for s in signals) if signals else None
    )
    if day0 is None:
        empty = pd.DataFrame(columns=["date", "cash", "positions_value", "equity"])
        return SimResult(cfg.as_dict(), [], skipped, empty, {"reason": "no signals"})

    last_needed = day0
    for d, _, out in candidates:
        last_needed = max(last_needed, _day(out.exit_ts) if out.exit_ts is not None else d)
    if signals:
        last_needed = max(last_needed, max(_day(s.decision_ts) for s in signals))
    cal = sorted(set().union(*[set(s.index) for s in closes.values()])) if closes else []
    open_end = any(out.exit_ts is None for _, _, out in candidates)
    end = max(cal) if (open_end and cal) else last_needed
    cal = [d for d in cal if day0 <= d <= end]
    if not cal or cal[0] != day0:
        cal = [day0] + [d for d in cal if d > day0]

    by_day: Dict[pd.Timestamp, List[tuple]] = {}
    for d, sig, out in candidates:
        if d <= day0:
            skipped.append({"sample_id": sig.sample_id, "symbol": sig.symbol, "entry_ts": _fmt(out.entry_ts),
                            "prob": sig.prob, "reason": SKIP_BEFORE_START})
            continue
        by_day.setdefault(d, []).append((sig, out))

    cash = float(cfg.starting_capital)
    positions: Dict[str, _Position] = {}
    trades: List[Dict[str, Any]] = []
    rows: List[Dict[str, Any]] = []
    realized = costs_cum = commission_cum = slippage_cum = 0.0
    peak = cash
    prev_equity = cash
    halted_on: Optional[str] = None
    max_recon_err = 0.0
    stale_total = 0
    traded_notional = 0.0

    for i, d in enumerate(cal):
        day_comm = 0.0
        day_val = 0.0  # valuation change of positions (entry fill / previous mark -> exit fill / mark)
        entries_today = 0
        equity_ref = prev_equity
        mv_ref = sum(p.shares * p.last_mark for p in positions.values())
        dd_now = 1.0 - prev_equity / peak if peak > 0 else 0.0

        if i > 0:
            todays = sorted(by_day.get(d, []), key=lambda so: (-so[0].prob, so[0].symbol, so[0].sample_id))
            for sig, out in todays:
                rec = {"sample_id": sig.sample_id, "symbol": sig.symbol, "entry_ts": _fmt(out.entry_ts), "prob": sig.prob}
                if cfg.drawdown_halt_pct is not None and dd_now * 100.0 >= cfg.drawdown_halt_pct:
                    halted_on = halted_on or d.date().isoformat()
                    skipped.append({**rec, "reason": SKIP_DRAWDOWN_HALT})
                    continue
                if sig.symbol in positions:
                    skipped.append({**rec, "reason": SKIP_SYMBOL_OPEN})
                    continue
                if len(positions) >= cfg.max_concurrent_positions:
                    skipped.append({**rec, "reason": SKIP_MAX_CONCURRENT})
                    continue
                if cfg.max_trades_per_day is not None and entries_today >= cfg.max_trades_per_day:
                    skipped.append({**rec, "reason": SKIP_MAX_TRADES_DAY})
                    continue
                notional = equity_ref * cfg.position_size_pct / 100.0
                if mv_ref + notional > equity_ref * cfg.max_exposure_pct / 100.0 + 1e-9:
                    skipped.append({**rec, "reason": SKIP_EXPOSURE})
                    continue
                comm = notional * c
                if notional + comm > cash + 1e-9:
                    skipped.append({**rec, "reason": SKIP_CASH})
                    continue
                fill = out.entry_price * (1.0 + sl)
                shares = notional / fill
                cash -= notional + comm
                day_comm += comm
                commission_cum += comm
                slippage_cum += shares * (fill - out.entry_price)
                traded_notional += notional
                mv_ref += notional
                entries_today += 1
                positions[sig.symbol] = _Position(
                    sig=sig, outcome=out, entry_date=d,
                    exit_date=_day(out.exit_ts) if out.exit_ts is not None else None,
                    shares=shares, entry_fill=fill, notional=notional, entry_commission=comm, last_mark=fill,
                )

        for sym in sorted(list(positions)):
            p = positions[sym]
            if p.exit_date is None or p.exit_date != d:
                continue
            out = p.outcome
            exit_fill = out.exit_price * (1.0 - sl)
            proceeds = p.shares * exit_fill
            comm = proceeds * c
            cash += proceeds - comm
            day_val += p.shares * (exit_fill - p.last_mark)
            day_comm += comm
            commission_cum += comm
            slippage_cum += p.shares * (out.exit_price - exit_fill)
            traded_notional += proceeds
            net_pnl = proceeds - comm - p.notional - p.entry_commission
            realized += net_pnl
            trades.append(_trade_record(p, exit_fill, comm, net_pnl, "closed"))
            del positions[sym]

        mv = 0.0
        stale_today = 0
        for sym, p in positions.items():
            s = closes.get(sym)
            px = s.get(d) if s is not None else None
            if px is None or not math.isfinite(float(px)):
                px = p.last_mark
                p.stale_marks += 1
                stale_today += 1
            px = float(px)
            day_val += p.shares * (px - p.last_mark)
            p.last_mark = px
            mv += p.shares * px
        stale_total += stale_today

        if cash < -1e-6:
            raise AssertionError(f"negative cash on {d.date()}: {cash}")
        equity = cash + mv
        recon = (equity - prev_equity) - (day_val - day_comm)
        max_recon_err = max(max_recon_err, abs(recon))
        costs_cum = commission_cum + slippage_cum
        peak = max(peak, equity)
        unrealized = sum(p.shares * p.last_mark - p.notional - p.entry_commission for p in positions.values())
        rows.append({
            "date": d.date().isoformat(),
            "cash": cash,
            "positions_value": mv,
            "equity": equity,
            "gross_exposure": mv / equity if equity > 0 else None,
            "n_positions": len(positions),
            "entries": entries_today,
            "realized_pnl": realized,
            "unrealized_pnl": unrealized,
            "commission_cum": commission_cum,
            "slippage_cum": slippage_cum,
            "costs_cum": costs_cum,
            "drawdown": 1.0 - equity / peak if peak > 0 else 0.0,
            "stale_marks": stale_today,
        })
        prev_equity = equity

    for sym in sorted(positions):
        p = positions[sym]
        trades.append(_trade_record(p, None, 0.0, None, "open_at_end"))

    for t in trades:
        flags = t.get("flags") or []
        ambiguous += to.FLAG_AMBIGUOUS in flags
        gap_stop += to.FLAG_GAP_STOP in flags
        gap_target += to.FLAG_GAP_TARGET in flags
        irregular += to.FLAG_IRREGULAR_GAP in flags

    equity_df = pd.DataFrame(rows)
    final = equity_df["equity"].iloc[-1] if len(equity_df) else cfg.starting_capital
    tol = 1e-6 * cfg.starting_capital
    open_value = sum(p.shares * p.last_mark for p in positions.values())
    identity_err = abs(final - (cash + open_value))
    pnl_err = abs((final - cfg.starting_capital) - (realized + sum(
        p.shares * p.last_mark - p.notional - p.entry_commission for p in positions.values())))
    diagnostics = {
        "accounting": {
            "identity_equity_eq_cash_plus_positions": identity_err <= tol,
            "identity_max_abs_error": identity_err,
            "daily_reconciliation_max_abs_error": max_recon_err,
            "daily_reconciliation_ok": max_recon_err <= tol,
            "pnl_reconciliation_abs_error": pnl_err,
            "pnl_reconciliation_ok": pnl_err <= tol,
            "tolerance": tol,
        },
        "candidates": len(candidates),
        "executed": sum(1 for t in trades),
        "open_at_end": len(positions),
        "skipped_by_reason": _count(skipped, "reason"),
        "ambiguous_same_bar_tp_sl": ambiguous,
        "gap_through_stop": gap_stop,
        "gap_through_target": gap_target,
        "irregular_bar_gaps": irregular,
        "stale_marks": stale_total,
        "drawdown_halt_first_date": halted_on,
        "traded_notional": traded_notional,
        "calendar": {"first": cal[0].date().isoformat(), "last": cal[-1].date().isoformat(), "n_days": len(cal)},
    }
    return SimResult(cfg.as_dict(), trades, skipped, equity_df, diagnostics)


def _trade_record(p: _Position, exit_fill: Optional[float], exit_comm: float, net_pnl: Optional[float], status: str) -> Dict[str, Any]:
    out = p.outcome
    closed = status == "closed"
    entry_cost = p.notional + p.entry_commission
    slippage_cost = p.shares * (p.entry_fill - out.entry_price) + (
        p.shares * (out.exit_price - exit_fill) if closed and exit_fill is not None else 0.0
    )
    unreal = p.shares * p.last_mark - entry_cost if not closed else None
    return {
        "sample_id": p.sig.sample_id,
        "symbol": p.sig.symbol,
        "prob": p.sig.prob,
        "label": p.sig.label,
        "decision_ts": _fmt(out.decision_ts),
        "entry_ts": _fmt(out.entry_ts),
        "entry_open": out.entry_price,
        "entry_fill": p.entry_fill,
        "shares": p.shares,
        "notional": p.notional,
        "tp_price": out.tp_price,
        "sl_price": out.sl_price,
        "status": status,
        "exit_ts": _fmt(out.exit_ts) if closed else None,
        "exit_reason": out.exit_reason if closed else None,
        "exit_price": out.exit_price if closed else None,
        "exit_fill": exit_fill if closed else None,
        "bars_held": out.bars_held if closed else None,
        "holding_days": (pd.Timestamp(out.exit_ts).normalize() - pd.Timestamp(out.entry_ts).normalize()).days if closed else None,
        "gross_return": out.gross_return if closed else None,
        "commission": p.entry_commission + exit_comm,
        "slippage_cost": slippage_cost,
        "costs": p.entry_commission + exit_comm + slippage_cost,
        "net_pnl": net_pnl,
        "net_return": (net_pnl / entry_cost) if (closed and net_pnl is not None) else None,
        "mark_price": p.last_mark if not closed else None,
        "unrealized_pnl": unreal,
        "stale_marks": p.stale_marks,
        "flags": list(out.flags),
    }


def _count(rows: List[Dict[str, Any]], key: str) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for r in rows:
        out[r[key]] = out.get(r[key], 0) + 1
    return out
