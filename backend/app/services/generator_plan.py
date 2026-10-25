"""Sample selection for the training chart generator, shared by generation and the pre-run estimate.

The generator walks backward from the dataset end one timeframe step at a time. Each step's
newest bar is a decision bar (one chart per bar); the chart shows the lookback window ending at
that step and the label follows ``trade_outcomes`` (``LABEL_METHOD_V2``). Charts are kept until
each class reaches ``per_class`` for the symbol or the permitted history runs out. Balancing to
50 / 50 happens afterwards across all symbols together (``finalize``).

Boundaries:
* ``end_date`` is a hard ceiling: bars whose period ends after it are dropped before anything
  else, so outcomes can never read later prices. A label that needs those bars is incomplete.
* ``start_date`` (fixed training period) is the earliest observation a chart may show.
  ``extend`` lets the walk continue past it when the target is not reached.
* ``floor_date`` (an authorized research start, e.g. from the Labeling Optimizer) is never
  crossed, with or without ``extend``.
"""

from __future__ import annotations

import calendar
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from typing import Any, Dict, Iterable, List, Optional

import numpy as np
import pandas as pd
from dateutil.relativedelta import relativedelta

TIMEFRAMES = ("1d", "1wk", "1mo")
LOOKBACK_UNITS = ("days", "weeks", "months", "years")
BALANCE_MODES = ("match_minority", "keep_all")

LABEL_INCOMPLETE = -1
LABEL_INVALID = -2

# A lookback window may start this many days before the first available bar and still count
# as complete (the window start fell on a weekend or holiday).
_COVERAGE_SLACK_DAYS = {"1d": 4, "1wk": 7, "1mo": 31}
_STEP = {"1d": relativedelta(days=1), "1wk": relativedelta(weeks=1), "1mo": relativedelta(months=1)}

STOP_TARGET = "target_reached"
STOP_START = "training_start"
STOP_FLOOR = "research_start"
STOP_HISTORY = "history_start"
STOP_NO_DATA = "no_data"


@dataclass(frozen=True)
class PlanParams:
    timeframe: str
    lookback_unit: str
    lookback_count: int
    horizon: int
    tp: float
    sl: float
    per_class: int
    end_date: date
    start_date: Optional[date] = None
    floor_date: Optional[date] = None
    extend: bool = False

    def lookback(self) -> relativedelta:
        unit = self.lookback_unit.lower()
        if unit not in LOOKBACK_UNITS:
            unit = "months"
        return relativedelta(**{unit: int(self.lookback_count)})


@dataclass
class Selection:
    pos: int
    lo: int
    decision_date: date
    window_start: date
    window_end: date
    label: int


@dataclass
class SymbolPlan:
    symbol: str
    raw_bars: int = 0
    first_bar: Optional[str] = None
    last_bar: Optional[str] = None
    invalid_bars: int = 0
    decision_bars: int = 0
    valid_windows: int = 0
    incomplete_horizon: int = 0
    invalid_windows: int = 0
    label1_found: int = 0
    label0_found: int = 0
    skipped_class_full: int = 0
    kept_label1: int = 0
    kept_label0: int = 0
    earliest_observation: Optional[str] = None
    earliest_decision: Optional[str] = None
    stop_reason: str = STOP_NO_DATA
    selections: List[Selection] = field(default_factory=list, repr=False)

    def summary(self) -> Dict[str, Any]:
        d = asdict(self)
        d.pop("selections", None)
        return d


def _day(ts: Any) -> date:
    t = pd.Timestamp(ts)
    if t.tzinfo is not None:
        t = t.tz_localize(None)
    return t.date()


def _period_end(d: date, timeframe: str) -> date:
    if timeframe == "1wk":
        return d + timedelta(days=6)
    if timeframe == "1mo":
        return date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])
    return d


def prepare_bars(history: pd.DataFrame, timeframe: str, end_date: date, floor_date: Optional[date] = None) -> pd.DataFrame:
    """History restricted to the permitted period, sorted, one row per bar.

    Weekly and monthly bars are dated by their first day; they are kept only when the whole
    period ends on or before ``end_date``.
    """
    if history is None or history.empty or "Close" not in history:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close"])
    df = history.copy()
    df = df[~df.index.duplicated(keep="last")].sort_index()
    days = [_day(t) for t in df.index]
    keep = [(_period_end(d, timeframe) <= end_date) and (floor_date is None or d >= floor_date) for d in days]
    return df.loc[np.asarray(keep, dtype=bool)]


def _ohlc(df: pd.DataFrame, col: str) -> np.ndarray:
    if col in df.columns:
        return df[col].to_numpy(dtype=float)
    return df["Close"].to_numpy(dtype=float)


def outcome_labels(df: pd.DataFrame, horizon: int, tp: float, sl: float) -> np.ndarray:
    """Per-bar label under ``trade_outcomes.resolve_outcome`` + ``LABEL_METHOD_V2``.

    1 = take profit first, 0 = stop loss first or no touch within ``horizon`` bars,
    ``LABEL_INCOMPLETE`` = no touch and the horizon runs past the data,
    ``LABEL_INVALID`` = a non-finite or non-positive price inside the horizon.
    """
    o, h, l, c = (_ohlc(df, k) for k in ("Open", "High", "Low", "Close"))
    n = len(c)
    w = int(horizon)
    out = np.full(n, LABEL_INCOMPLETE, dtype=np.int8)
    if n < 2:
        return out
    k = np.arange(n - 1)
    entry = o[k + 1]
    tp_lvl = entry * (1.0 + float(tp))
    sl_lvl = entry * (1.0 - float(sl))
    good = np.isfinite(o) & np.isfinite(h) & np.isfinite(l) & np.isfinite(c) & (o > 0) & (h > 0) & (l > 0) & (c > 0)
    avail = np.minimum(w, n - 1 - k)
    invalid = np.zeros(n - 1, dtype=bool)
    resolved = np.zeros(n - 1, dtype=bool)
    lab = np.full(n - 1, LABEL_INCOMPLETE, dtype=np.int8)
    for e in range(w):
        j = k + 1 + e
        live = e < avail
        jj = np.where(live, j, 0)
        invalid |= live & ~good[jj]
    for e in range(w):
        j = k + 1 + e
        live = (e < avail) & ~resolved
        if not live.any():
            break
        jj = np.where(live, j, 0)
        hit_sl = live & (l[jj] <= sl_lvl)
        hit_tp = live & ~hit_sl & (h[jj] >= tp_lvl)
        lab[hit_sl] = 0
        lab[hit_tp] = 1
        resolved |= hit_sl | hit_tp
    timeout = ~resolved & (avail >= w)
    lab[timeout] = 0
    lab[invalid] = LABEL_INVALID
    out[: n - 1] = lab
    return out


def plan_symbol(symbol: str, history: pd.DataFrame, params: PlanParams, *, use_candles: bool = True) -> SymbolPlan:
    """Replays the generator's backward walk without rendering."""
    plan = SymbolPlan(symbol=symbol)
    df = prepare_bars(history, params.timeframe, params.end_date, params.floor_date)
    plan.raw_bars = int(len(df))
    if df.empty:
        return plan
    days = np.array([np.datetime64(_day(t), "D") for t in df.index])
    plan.first_bar = str(days[0])
    plan.last_bar = str(days[-1])
    cols = ["Open", "High", "Low", "Close"] if use_candles else ["Close"]
    vals = np.column_stack([_ohlc(df, k) for k in cols])
    bar_ok = np.all(np.isfinite(vals) & (vals > 0), axis=1)
    plan.invalid_bars = int((~bar_ok).sum())
    bad_cum = np.concatenate([[0], np.cumsum(~bar_ok)])
    labels = outcome_labels(df, params.horizon, params.tp, params.sl)

    first = days[0].astype(object)
    coverage_start = first - timedelta(days=_COVERAGE_SLACK_DAYS.get(params.timeframe, 4))
    if params.floor_date is not None:
        coverage_start = max(coverage_start, params.floor_date)
    step = _STEP.get(params.timeframe, _STEP["1d"])
    lookback = params.lookback()
    x = max(int(params.per_class), 0)
    counts = {0: 0, 1: 0}
    used: set = set()
    plan.stop_reason = STOP_HISTORY
    i = 0
    while True:
        if x and min(counts.values()) >= x:
            plan.stop_reason = STOP_TARGET
            break
        end_req = params.end_date - step * i
        i += 1
        pos = int(np.searchsorted(days, np.datetime64(end_req, "D"), side="right")) - 1
        if pos < 0:
            plan.stop_reason = STOP_HISTORY
            break
        if pos in used:
            continue
        win_start = end_req - lookback
        if params.floor_date is not None and win_start < params.floor_date:
            plan.stop_reason = STOP_FLOOR
            break
        if win_start < coverage_start:
            plan.stop_reason = STOP_HISTORY
            break
        if params.start_date is not None and not params.extend and win_start < params.start_date:
            plan.stop_reason = STOP_START
            break
        used.add(pos)
        plan.decision_bars += 1
        lo = int(np.searchsorted(days, np.datetime64(win_start, "D"), side="left"))
        if pos - lo + 1 < 2 or bad_cum[pos + 1] - bad_cum[lo] > 0:
            plan.invalid_windows += 1
            continue
        lab = int(labels[pos])
        if lab == LABEL_INVALID:
            plan.invalid_windows += 1
            continue
        if lab == LABEL_INCOMPLETE:
            plan.incomplete_horizon += 1
            continue
        plan.valid_windows += 1
        if lab == 1:
            plan.label1_found += 1
        else:
            plan.label0_found += 1
        if x and counts[lab] >= x:
            plan.skipped_class_full += 1
            continue
        counts[lab] += 1
        sel = Selection(pos=pos, lo=lo, decision_date=days[pos].astype(object), window_start=win_start, window_end=end_req, label=lab)
        plan.selections.append(sel)
        plan.earliest_observation = str(days[lo])
        plan.earliest_decision = sel.decision_date.isoformat()
    plan.kept_label0, plan.kept_label1 = counts[0], counts[1]
    return plan


def finalize(plans: Iterable[SymbolPlan], per_class: int, balance_mode: str) -> Dict[str, Any]:
    """Totals after the generator's global 50 / 50 trimming (same rule as the run post-processing)."""
    plans = list(plans)
    n_sym = len(plans)
    kept0 = sum(p.kept_label0 for p in plans)
    kept1 = sum(p.kept_label1 for p in plans)
    balanced = balance_mode != "keep_all"
    if balanced and kept0 and kept1:
        final0 = final1 = min(kept0, kept1)
    else:
        final0, final1 = kept0, kept1
    requested_total = int(per_class) * 2 * n_sym
    final_total = final0 + final1
    earliest = [p.earliest_observation for p in plans if p.earliest_observation]
    totals = {
        key: sum(getattr(p, key) for p in plans)
        for key in (
            "raw_bars", "invalid_bars", "decision_bars", "valid_windows", "incomplete_horizon",
            "invalid_windows", "label1_found", "label0_found", "skipped_class_full",
        )
    }
    return {
        "per_class": int(per_class),
        "symbols": n_sym,
        "requested_total": requested_total,
        "balance_mode": "keep_all" if not balanced else "match_minority",
        "kept_label0": kept0,
        "kept_label1": kept1,
        "removed_for_balance": (kept0 - final0) + (kept1 - final1),
        "final_label0": final0,
        "final_label1": final1,
        "final_total": final_total,
        "fulfilled": final_total >= requested_total,
        "earliest_observation": min(earliest) if earliest else None,
        **totals,
        "limit": limiting_constraint(plans, per_class, balanced, final_total, requested_total),
    }


_STOP_TEXT = {
    STOP_START: "the training start",
    STOP_FLOOR: "the research start transferred from the Labeling Optimizer",
    STOP_HISTORY: "the start of the available market history",
    STOP_NO_DATA: "missing market data",
}


def limiting_constraint(plans: List[SymbolPlan], per_class: int, balanced: bool, final_total: int, requested_total: int) -> Optional[Dict[str, str]]:
    """Why the target is not reached, in plain words; None when it is."""
    if final_total >= requested_total:
        return None
    short = [p for p in plans if p.stop_reason != STOP_TARGET]
    if not short:
        kept0 = sum(p.kept_label0 for p in plans)
        kept1 = sum(p.kept_label1 for p in plans)
        return {"code": "balance", "message": f"Balancing trims the larger class to the smaller one ({min(kept0, kept1)} per class)."}
    reasons = sorted({p.stop_reason for p in short})
    code = reasons[0] if len(reasons) == 1 else "mixed"
    k1 = sum(p.kept_label1 for p in short)
    k0 = sum(p.kept_label0 for p in short)
    rarer = "label 1 (take profit first)" if k1 <= k0 else "label 0"
    where = " / ".join(_STOP_TEXT.get(r, r) for r in reasons)
    names = ", ".join(p.symbol for p in short[:4]) + ("…" if len(short) > 4 else "")
    msg = f"{names}: the walk reached {where} before {rarer} reached {per_class} charts."
    if balanced:
        msg += " Balanced mode then trims the other class to the same count."
    return {"code": code, "message": msg}


def fetch_history(symbol: str, timeframe: str, end_date: date, start_date: Optional[date] = None) -> pd.DataFrame:
    """Bars up to ``end_date`` only (yfinance ``end`` is exclusive)."""
    import yfinance as yf

    end = (end_date + timedelta(days=1)).isoformat()
    t = yf.Ticker(symbol)
    if start_date is not None:
        return t.history(start=start_date.isoformat(), end=end, interval=timeframe)
    return t.history(period="max", end=end, interval=timeframe)


def history_fetch_start(params: PlanParams) -> Optional[date]:
    """Earliest date the run may download: the floor, else the fixed start unless extending."""
    if params.floor_date is not None:
        if params.start_date is not None and not params.extend:
            return max(params.floor_date, params.start_date)
        return params.floor_date
    if params.start_date is not None and not params.extend:
        return params.start_date
    return None


def parse_day(value: Any) -> Optional[date]:
    if value in (None, ""):
        return None
    return date.fromisoformat(str(value)[:10])
