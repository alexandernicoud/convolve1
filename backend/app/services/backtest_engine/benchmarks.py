"""
Benchmarks aligned to the strategy's calendar and capital base.

Every benchmark starts with the strategy's starting capital at the close of the first decision day
(no return before the first eligible decision), buys at the next available open with the same entry
costs, and is marked at closes on the strategy's calendar (last close carried on missing bars).

- ``spy``            SPY buy-and-hold (only when SPY bars were stored with the dataset)
- ``underlying``     the dataset's single symbol, buy-and-hold
- ``equal_weight``   equal capital in every dataset symbol at the first open, no rebalancing
- ``exposure_matched`` passive mix: (strategy's average gross exposure) × equal_weight basket +
                     the rest in cash (0% return), fixed weights — a like-for-like risk budget
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

import numpy as np
import pandas as pd

from .metrics import drawdown_stats, ok, na, periodic_returns, MIN_PERIODS_RATIO, PERIODS_PER_YEAR


def _day_series(df: pd.DataFrame, col: str) -> pd.Series:
    s = df[col].astype(float)
    s.index = pd.DatetimeIndex([pd.Timestamp(t.date()) for t in df.index])
    return s[~s.index.duplicated(keep="last")]


def buy_and_hold(
    bars: pd.DataFrame, dates: Sequence[str], capital: float, commission_pct: float, slippage_pct: float
) -> Optional[Dict[str, Any]]:
    cal = pd.DatetimeIndex(pd.to_datetime(list(dates)))
    opens, closes = _day_series(bars, "Open"), _day_series(bars, "Close")
    after = opens.index[opens.index > cal[0]]
    if len(after) == 0:
        return None
    entry_day = after[0]
    fill = float(opens[entry_day]) * (1 + slippage_pct / 100.0)
    notional = capital / (1 + commission_pct / 100.0)
    shares = notional / fill
    cash_left = capital - notional * (1 + commission_pct / 100.0)
    vals: List[Optional[float]] = []
    last = None
    stale = 0
    for d in cal:
        if d < entry_day:
            vals.append(capital)
            continue
        px = closes.get(d)
        if px is None or not np.isfinite(px):
            stale += 1
            px = last
        last = px
        vals.append(cash_left + shares * float(px) if px is not None else None)
    return {"entry_date": entry_day.date().isoformat(), "entry_fill": fill, "values": vals, "stale_marks": stale}


def _summary(dates: Sequence[str], vals: Sequence[float], capital: float, timeframe: str) -> Dict[str, Any]:
    v = np.asarray(vals, dtype=float)
    r = periodic_returns(v)
    ppy = PERIODS_PER_YEAR.get(timeframe, 252)
    out = {"total_return": ok(float(v[-1] / capital - 1.0))}
    out["max_drawdown"] = drawdown_stats(list(dates), v)["max_drawdown"]
    if len(r) >= MIN_PERIODS_RATIO and r.std(ddof=1) > 0:
        out["sharpe"] = ok(float(r.mean() / r.std(ddof=1) * np.sqrt(ppy)))
    else:
        out["sharpe"] = na(f"needs at least {MIN_PERIODS_RATIO} periodic returns with variance")
    return out


def compute_benchmarks(
    bars: Dict[str, pd.DataFrame],
    sample_symbols: Sequence[str],
    dates: Sequence[str],
    capital: float,
    commission_pct: float,
    slippage_pct: float,
    avg_exposure: Optional[float],
    timeframe: str,
) -> Dict[str, Any]:
    out: Dict[str, Any] = {"method": __doc__.strip(), "series": {"date": list(dates)}, "benchmarks": {}, "unavailable": {}}
    if not dates:
        return out

    def add(key: str, label: str, res: Optional[Dict[str, Any]], extra: Dict[str, Any]) -> None:
        if res is None or any(v is None for v in res["values"]):
            out["unavailable"][key] = "no price data after the first decision date"
            return
        out["series"][key] = res["values"]
        out["benchmarks"][key] = {"label": label, **extra, "entry_date": res.get("entry_date"),
                                  "stale_marks": res.get("stale_marks", 0),
                                  **_summary(dates, res["values"], capital, timeframe)}

    if "SPY" in bars:
        add("spy", "SPY buy-and-hold", buy_and_hold(bars["SPY"], dates, capital, commission_pct, slippage_pct), {"exposure": 1.0})
    else:
        out["unavailable"]["spy"] = "SPY bars were not stored with this dataset"

    syms = sorted({s for s in sample_symbols if s in bars})
    legs = {s: buy_and_hold(bars[s], dates, capital / len(syms), commission_pct, slippage_pct) for s in syms} if syms else {}
    if len(syms) == 1:
        add("underlying", f"{syms[0]} buy-and-hold", buy_and_hold(bars[syms[0]], dates, capital, commission_pct, slippage_pct), {"exposure": 1.0})
    if syms and all(l is not None and all(v is not None for v in l["values"]) for l in legs.values()):
        basket = np.sum([np.asarray(l["values"], dtype=float) for l in legs.values()], axis=0)
        if len(syms) > 1:
            add("equal_weight", f"Equal-weight {len(syms)} symbols, buy-and-hold",
                {"values": basket.tolist(), "entry_date": min(l["entry_date"] for l in legs.values())},
                {"exposure": 1.0, "symbols": syms})
        if avg_exposure is not None and np.isfinite(avg_exposure):
            a = float(avg_exposure)
            matched = capital * (1 - a) + a * basket
            add("exposure_matched", f"{a:.0%} in {'the underlying' if len(syms) == 1 else 'the equal-weight basket'}, rest in cash",
                {"values": matched.tolist(), "entry_date": min(l["entry_date"] for l in legs.values())},
                {"exposure": a, "note": "Static mix at the strategy's average gross exposure; cash earns 0%."})
    elif syms:
        out["unavailable"]["equal_weight"] = "a symbol has no bars after the first decision date"
    return out
