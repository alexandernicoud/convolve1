"""
Trading metrics (from the simulated equity curve and trades) and classification metrics (from
predictions vs. labels), kept strictly separate.

A metric that is undefined or statistically inappropriate is returned as
``{"value": None, "unavailable": "<reason>"}`` — never as 0 and never clipped.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence

import numpy as np
import pandas as pd

PERIODS_PER_YEAR = {"1d": 252, "1wk": 52, "1mo": 12}
MIN_PERIODS_RATIO = 30  # Sharpe/Sortino/volatility need at least this many periodic returns
MIN_DAYS_ANNUALIZE = 90  # annualized return needs at least this calendar span
BOOTSTRAP_SEED = 0


def ok(value: Any, **extra: Any) -> Dict[str, Any]:
    if isinstance(value, (float, np.floating)):
        value = float(value)
        if not math.isfinite(value):
            return na("not a finite number")
    return {"value": value, **extra}


def na(reason: str) -> Dict[str, Any]:
    return {"value": None, "unavailable": reason}


def wilson(k: int, n: int, z: float = 1.959964) -> Optional[List[float]]:
    if n <= 0:
        return None
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [max(0.0, centre - half), min(1.0, centre + half)]


# --------------------------------------------------------------------------- equity-based


def periodic_returns(equity: pd.Series) -> np.ndarray:
    e = np.asarray(equity, dtype=float)
    if len(e) < 2:
        return np.zeros(0)
    return e[1:] / e[:-1] - 1.0


def drawdown_stats(dates: Sequence[str], equity: Sequence[float]) -> Dict[str, Any]:
    e = np.asarray(equity, dtype=float)
    if len(e) == 0:
        return {"max_drawdown": na("no equity observations")}
    peak = np.maximum.accumulate(e)
    dd = 1.0 - e / peak
    i_trough = int(np.argmax(dd))
    i_peak = int(np.argmax(e[: i_trough + 1])) if i_trough > 0 else 0
    rec = None
    for j in range(i_trough, len(e)):
        if e[j] >= peak[i_trough]:
            rec = j
            break
    longest = cur = 0
    start_long = end_long = None
    start = None
    for j in range(len(e)):
        if dd[j] > 0:
            if cur == 0:
                start = j
            cur += 1
            if cur > longest:
                longest, start_long, end_long = cur, start, j
        else:
            cur = 0
    out = {
        "max_drawdown": ok(float(dd.max()), definition="peak-to-trough on marked-to-market equity, running peak"),
        "max_drawdown_peak_date": dates[i_peak] if dd.max() > 0 else None,
        "max_drawdown_trough_date": dates[i_trough] if dd.max() > 0 else None,
        "max_drawdown_recovery_date": dates[rec] if (rec is not None and dd.max() > 0) else None,
        "longest_drawdown_periods": longest,
    }
    if start_long is not None:
        d0, d1 = pd.Timestamp(dates[start_long - 1 if start_long > 0 else 0]), pd.Timestamp(dates[end_long])
        out["longest_drawdown_days"] = int((d1 - d0).days)
    else:
        out["longest_drawdown_days"] = 0
    return out


def trading_metrics(equity_df: pd.DataFrame, trades: List[Dict[str, Any]], starting_capital: float, timeframe: str) -> Dict[str, Any]:
    ppy = PERIODS_PER_YEAR.get(timeframe, 252)
    m: Dict[str, Any] = {"assumptions": {
        "periods_per_year": ppy,
        "return_frequency": f"per {timeframe} bar on the union trading calendar",
        "risk_free_rate": 0.0,
        "sharpe": "mean(periodic return) / stdev(periodic return, ddof=1) × sqrt(periods_per_year); no clipping",
        "sortino": "mean(periodic return) / sqrt(mean(min(r, 0)^2)) × sqrt(periods_per_year)",
        "min_periods": MIN_PERIODS_RATIO,
        "min_days_for_annualized_return": MIN_DAYS_ANNUALIZE,
    }}
    if equity_df is None or len(equity_df) == 0:
        m["total_return"] = na("no equity observations")
        return m
    eq = equity_df["equity"].astype(float).to_numpy()
    dates = equity_df["date"].astype(str).tolist()
    final = float(eq[-1])
    closed = [t for t in trades if t["status"] == "closed"]
    gross_pnl = sum(t["shares"] * (t["exit_price"] - t["entry_open"]) for t in closed)
    open_unreal_gross = sum(t["shares"] * (t["mark_price"] - t["entry_open"]) for t in trades if t["status"] != "closed")
    costs = float(equity_df["costs_cum"].iloc[-1])
    m["net_pnl"] = ok(final - starting_capital)
    m["total_return"] = ok(final / starting_capital - 1.0)
    m["gross_pnl"] = ok(gross_pnl + open_unreal_gross, definition="P&L at raw (pre-slippage) prices, before commissions")
    m["gross_return"] = ok((gross_pnl + open_unreal_gross) / starting_capital)
    m["total_costs"] = ok(costs)
    m["total_commission"] = ok(float(equity_df["commission_cum"].iloc[-1]))
    m["total_slippage"] = ok(float(equity_df["slippage_cum"].iloc[-1]))
    m.update(drawdown_stats(dates, eq))

    span_days = (pd.Timestamp(dates[-1]) - pd.Timestamp(dates[0])).days
    m["span_days"] = span_days
    r = periodic_returns(eq)
    m["n_periods"] = int(len(r))
    if span_days >= MIN_DAYS_ANNUALIZE and len(r) > 0 and final > 0:
        m["annualized_return"] = ok((final / starting_capital) ** (ppy / len(r)) - 1.0)
    else:
        m["annualized_return"] = na(f"needs at least {MIN_DAYS_ANNUALIZE} calendar days (have {span_days})")
    if len(r) >= MIN_PERIODS_RATIO:
        sd = float(np.std(r, ddof=1))
        m["annualized_volatility"] = ok(sd * math.sqrt(ppy))
        m["sharpe"] = ok(float(np.mean(r)) / sd * math.sqrt(ppy)) if sd > 0 else na("zero return variance (no exposure)")
        dd = math.sqrt(float(np.mean(np.minimum(r, 0.0) ** 2)))
        m["sortino"] = ok(float(np.mean(r)) / dd * math.sqrt(ppy)) if dd > 0 else na("no negative periods")
    else:
        reason = f"needs at least {MIN_PERIODS_RATIO} periodic returns (have {len(r)})"
        m["annualized_volatility"] = na(reason)
        m["sharpe"] = na(reason)
        m["sortino"] = na(reason)

    expo = equity_df["gross_exposure"].astype(float)
    m["avg_exposure"] = ok(float(expo.mean()))
    m["time_in_market"] = ok(float((equity_df["n_positions"] > 0).mean()))
    traded = sum(t["notional"] for t in trades) + sum(t["shares"] * t["exit_fill"] for t in closed)
    m["turnover"] = ok(traded / float(np.mean(eq)), definition="traded notional (entries + exits) / mean equity")

    m["executed_trades"] = len(trades)
    m["closed_trades"] = len(closed)
    m["open_at_end"] = len(trades) - len(closed)
    if closed:
        net = np.array([t["net_pnl"] for t in closed], dtype=float)
        nr = np.array([t["net_return"] for t in closed], dtype=float)
        wins, losses = net[net > 0], net[net <= 0]
        m["win_rate"] = ok(len(wins) / len(net), ci95=wilson(len(wins), len(net)), n=len(net),
                           definition="share of closed trades with net P&L > 0 after all costs")
        m["avg_win_return"] = ok(float(nr[net > 0].mean())) if len(wins) else na("no winning trades")
        m["avg_loss_return"] = ok(float(nr[net <= 0].mean())) if len(losses) else na("no losing trades")
        m["profit_factor"] = ok(float(wins.sum() / -losses.sum())) if len(losses) and losses.sum() < 0 else na("no losing trades")
        m["expectancy_pnl"] = ok(float(net.mean()))
        m["expectancy_return"] = ok(float(nr.mean()))
        held = [t["bars_held"] for t in closed]
        m["holding_bars"] = {"min": int(min(held)), "median": float(np.median(held)), "max": int(max(held)),
                             "histogram": _int_hist(held)}
        m["exit_reasons"] = _counts([t["exit_reason"] for t in closed])
    else:
        for k in ("win_rate", "avg_win_return", "avg_loss_return", "profit_factor", "expectancy_pnl", "expectancy_return"):
            m[k] = na("no closed trades")
    return m


def _int_hist(vals: Sequence[int]) -> List[Dict[str, int]]:
    c: Dict[int, int] = {}
    for v in vals:
        c[int(v)] = c.get(int(v), 0) + 1
    return [{"bars": k, "count": c[k]} for k in sorted(c)]


def _counts(vals: Sequence[Any]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for v in vals:
        out[str(v)] = out.get(str(v), 0) + 1
    return out


def block_bootstrap(returns: np.ndarray, block: int, n_boot: int = 1000, seed: int = BOOTSTRAP_SEED, ppy: int = 252) -> Dict[str, Any]:
    """Moving-block bootstrap of total return and Sharpe (circular blocks, fixed seed)."""
    r = np.asarray(returns, dtype=float)
    n = len(r)
    if n < 2 * MIN_PERIODS_RATIO:
        return na(f"needs at least {2 * MIN_PERIODS_RATIO} periodic returns (have {n})")
    block = max(2, min(block, n // 4))
    rng = np.random.default_rng(seed)
    n_blocks = math.ceil(n / block)
    tot, sh = [], []
    for _ in range(n_boot):
        starts = rng.integers(0, n, size=n_blocks)
        idx = (starts[:, None] + np.arange(block)[None, :]).ravel() % n
        s = r[idx[:n]]
        tot.append(float(np.prod(1 + s) - 1))
        sd = s.std(ddof=1)
        if sd > 0:
            sh.append(float(s.mean() / sd * math.sqrt(ppy)))
    return {
        "method": "circular moving-block bootstrap of periodic returns",
        "block_length": block,
        "n_boot": n_boot,
        "seed": seed,
        "total_return_ci95": [float(np.percentile(tot, 2.5)), float(np.percentile(tot, 97.5))],
        "sharpe_ci95": [float(np.percentile(sh, 2.5)), float(np.percentile(sh, 97.5))] if len(sh) > n_boot // 2 else None,
        "p_total_return_le_0": float(np.mean(np.asarray(tot) <= 0)),
    }


# --------------------------------------------------------------------------- classification


def roc_auc(y: np.ndarray, p: np.ndarray) -> Optional[float]:
    pos, neg = p[y == 1], p[y == 0]
    if len(pos) == 0 or len(neg) == 0:
        return None
    ranks = pd.Series(np.concatenate([pos, neg])).rank(method="average").to_numpy()
    return float((ranks[: len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def average_precision(y: np.ndarray, p: np.ndarray) -> Optional[float]:
    if (y == 1).sum() == 0:
        return None
    order = np.argsort(-p, kind="mergesort")
    ys, ps = y[order], p[order]
    tp = np.cumsum(ys)
    k = np.arange(1, len(ys) + 1)
    # step-wise AP at distinct thresholds
    last = np.r_[ps[1:] != ps[:-1], True]
    prec, rec = tp[last] / k[last], tp[last] / ys.sum()
    rec_prev = np.r_[0.0, rec[:-1]]
    return float(np.sum((rec - rec_prev) * prec))


def classification_metrics(labels: Sequence[int], probs: Sequence[float], threshold: float, n_bins: int = 10, seed: int = BOOTSTRAP_SEED) -> Dict[str, Any]:
    y = np.asarray(labels, dtype=int)
    p = np.asarray(probs, dtype=float)
    n = len(y)
    if n == 0:
        return {"n": 0, "unavailable": "no labelled predictions"}
    yhat = (p >= threshold).astype(int)
    tp = int(((yhat == 1) & (y == 1)).sum())
    tn = int(((yhat == 0) & (y == 0)).sum())
    fp = int(((yhat == 1) & (y == 0)).sum())
    fn = int(((yhat == 0) & (y == 1)).sum())
    pos = int(y.sum())

    def ratio(a: int, b: int, what: str) -> Dict[str, Any]:
        return ok(a / b, ci95=wilson(a, b), n=b) if b > 0 else na(f"no {what}")

    acc = ratio(tp + tn, n, "samples")
    base = pos / n
    majority = max(base, 1 - base)
    prec1, rec1 = ratio(tp, tp + fp, "predicted label-1 samples"), ratio(tp, tp + fn, "label-1 samples")
    prec0, rec0 = ratio(tn, tn + fn, "predicted label-0 samples"), ratio(tn, tn + fp, "label-0 samples")

    def f1(pr: Dict[str, Any], rc: Dict[str, Any]) -> Dict[str, Any]:
        if pr["value"] is None or rc["value"] is None or (pr["value"] + rc["value"]) == 0:
            return na("precision or recall undefined/zero")
        return ok(2 * pr["value"] * rc["value"] / (pr["value"] + rc["value"]))

    auc = roc_auc(y, p)
    auc_ci = None
    if auc is not None and n >= 30:
        rng = np.random.default_rng(seed)
        vals = []
        for _ in range(500):
            idx = rng.integers(0, n, n)
            a = roc_auc(y[idx], p[idx])
            if a is not None:
                vals.append(a)
        if len(vals) > 250:
            auc_ci = [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]
    ap = average_precision(y, p)
    edges = np.linspace(0, 1, n_bins + 1)
    calib = []
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (p >= lo) & ((p < hi) if i < n_bins - 1 else (p <= hi))
        k = int(mask.sum())
        if k == 0:
            calib.append({"lo": lo, "hi": hi, "n": 0, "mean_prob": None, "observed_rate": None, "ci95": None})
            continue
        obs = int(y[mask].sum())
        calib.append({"lo": float(lo), "hi": float(hi), "n": k, "mean_prob": float(p[mask].mean()),
                      "observed_rate": obs / k, "ci95": wilson(obs, k)})
    return {
        "n": n,
        "threshold": threshold,
        "note": "Label-based classification quality. Label-1 precision is not a trading win rate.",
        "confusion_matrix": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
        "accuracy": acc,
        "positive_base_rate": ok(base, n=n),
        "majority_baseline_accuracy": ok(majority, majority_class=int(base >= 0.5)),
        "precision_label1": prec1,
        "recall_label1": rec1,
        "f1_label1": f1(prec1, rec1),
        "precision_label0": prec0,
        "recall_label0": rec0,
        "f1_label0": f1(prec0, rec0),
        "roc_auc": ok(auc, ci95=auc_ci) if auc is not None else na("needs both classes"),
        "pr_auc": ok(ap, baseline=base) if ap is not None else na("no label-1 samples"),
        "brier": ok(float(np.mean((p - y) ** 2)), reference_constant_base_rate=float(base * (1 - base))),
        "calibration": calib,
    }
