"""
Incremental value of the CNN over strategies that use no model.

Every baseline below trades the same test samples, on the same stored bars, with the same TP/SL/horizon
exits, position sizing, limits and per-side costs as the CNN strategy (``simulate`` with an identical
``SimConfig``). Only the choice of which candidate charts to enter differs:

- ``always_eligible``  enter every chart the CNN could have entered (no filter, ties broken by symbol)
- ``random_entry``     enter a random subset of the same size as the CNN's candidates, repeated with
                       fixed seeds; the CNN's percentile among the draws is reported
- ``passive``          the exposure-matched passive mix from ``benchmarks`` (a static fraction of the
                       buy-and-hold basket, rest in cash), on the CNN's calendar

Paired comparisons use a circular moving-block bootstrap of the per-bar return difference on the
dates both strategies share, with a block length of at least the label horizon.
"""

from __future__ import annotations

import math
from dataclasses import replace
from typing import Any, Dict, List, Optional, Sequence

import numpy as np
import pandas as pd

from . import metrics as mt
from .simulation import Signal, SimConfig, simulate

INCREMENTAL_VERSION = 1
RANDOM_DRAWS = 50
N_BOOT = 1000

EDGE, INCONCLUSIVE, NO_EDGE, INVALID = "edge", "inconclusive", "no_edge", "invalid"
VERDICT_LABEL = {
    EDGE: "Evidence of incremental edge",
    INCONCLUSIVE: "Inconclusive",
    NO_EDGE: "No demonstrated incremental edge",
    INVALID: "Invalid comparison",
}


def _v(m: Any) -> Optional[float]:
    return m.get("value") if isinstance(m, dict) else None


def _series(dates: Sequence[str], values: Sequence[float]) -> pd.Series:
    return pd.Series(np.asarray(values, dtype=float), index=pd.Index([str(d) for d in dates]))


def paired_block_bootstrap(
    a: pd.Series, b: pd.Series, block: int, ppy: int, n_boot: int = N_BOOT, seed: int = mt.BOOTSTRAP_SEED
) -> Dict[str, Any]:
    """Bootstrap of mean(per-bar return of a − per-bar return of b) on shared dates, annualized."""
    common = a.index.intersection(b.index)
    if len(common) < 2:
        return mt.na("the two equity curves share fewer than two dates")
    ra = a.loc[common].to_numpy(dtype=float)
    rb = b.loc[common].to_numpy(dtype=float)
    ra = ra[1:] / ra[:-1] - 1.0
    rb = rb[1:] / rb[:-1] - 1.0
    d = ra - rb
    n = len(d)
    if n < 2 * mt.MIN_PERIODS_RATIO:
        return mt.na(f"needs at least {2 * mt.MIN_PERIODS_RATIO} shared periodic returns (have {n})")
    block = max(2, min(block, n // 4))
    rng = np.random.default_rng(seed)
    n_blocks = math.ceil(n / block)
    means = np.empty(n_boot)
    for i in range(n_boot):
        starts = rng.integers(0, n, size=n_blocks)
        idx = (starts[:, None] + np.arange(block)[None, :]).ravel() % n
        means[i] = d[idx[:n]].mean()
    return {
        "method": "circular moving-block bootstrap of per-bar return differences on shared dates",
        "n_periods": n,
        "block_length": block,
        "n_boot": n_boot,
        "seed": seed,
        "mean_diff_annualized": float(d.mean() * ppy),
        "ci95_annualized": [float(np.percentile(means, 2.5) * ppy), float(np.percentile(means, 97.5) * ppy)],
        "p_diff_le_0": float(np.mean(means <= 0)),
        "total_return_diff": float(np.prod(1 + ra) - np.prod(1 + rb)),
    }


def _yearly(values: pd.Series) -> Dict[str, float]:
    out: Dict[str, float] = {}
    years = pd.Index([d[:4] for d in values.index])
    for y in sorted(set(years)):
        v = values[years == y]
        prev = values[years < y]
        start = float(prev.iloc[-1]) if len(prev) else float(v.iloc[0])
        out[y] = float(v.iloc[-1] / start - 1.0) if start > 0 else float("nan")
    return out


def _strategy(res, cfg: SimConfig, timeframe: str) -> Dict[str, Any]:
    tm = mt.trading_metrics(res.equity, res.trades, cfg.starting_capital, timeframe)
    return {
        "total_return": _v(tm.get("total_return")),
        "gross_return": _v(tm.get("gross_return")),
        "annualized_return": _v(tm.get("annualized_return")),
        "sharpe": _v(tm.get("sharpe")),
        "max_drawdown": _v(tm.get("max_drawdown")),
        "avg_exposure": _v(tm.get("avg_exposure")),
        "expectancy_return": _v(tm.get("expectancy_return")),
        "closed_trades": tm.get("closed_trades"),
        "executed_trades": tm.get("executed_trades"),
    }


def compute_incremental(
    *,
    cnn_res,
    cnn_metrics: Dict[str, Any],
    signals: Sequence[Signal],
    bars: Dict[str, pd.DataFrame],
    spec,
    cfg: SimConfig,
    threshold: float,
    start,
    purged: set,
    outcomes: Dict[str, Any],
    benchmarks: Dict[str, Any],
    timeframe: str,
    evaluation_class: Optional[str],
    draws: int = RANDOM_DRAWS,
) -> Dict[str, Any]:
    ppy = mt.PERIODS_PER_YEAR.get(timeframe, 252)
    block = max(5, int(spec.horizon_bars))
    out: Dict[str, Any] = {
        "version": INCREMENTAL_VERSION,
        "method": __doc__.strip(),
        "same_as_cnn": "Same test samples, bars, TP/SL/horizon exits, sizing, limits and per-side costs.",
    }
    cnn_eq = _series(cnn_res.equity["date"], cnn_res.equity["equity"]) if len(cnn_res.equity) else None
    cnn = {
        "total_return": _v(cnn_metrics.get("total_return")),
        "gross_return": _v(cnn_metrics.get("gross_return")),
        "annualized_return": _v(cnn_metrics.get("annualized_return")),
        "sharpe": _v(cnn_metrics.get("sharpe")),
        "max_drawdown": _v(cnn_metrics.get("max_drawdown")),
        "avg_exposure": _v(cnn_metrics.get("avg_exposure")),
        "expectancy_return": _v(cnn_metrics.get("expectancy_return")),
        "closed_trades": cnn_metrics.get("closed_trades"),
        "executed_trades": cnn_metrics.get("executed_trades"),
    }
    out["cnn"] = cnn

    eligible = [s for s in signals if s.sample_id not in purged and s.sample_id in outcomes and outcomes[s.sample_id].entry_ts is not None]
    candidates = [s for s in eligible if s.prob is not None and math.isfinite(s.prob) and s.prob >= threshold]
    out["candidates"] = {"cnn": len(candidates), "eligible": len(eligible)}

    # Always eligible: every chart, no model filter.
    flat = [replace(s, prob=1.0) for s in eligible]
    always = simulate(flat, bars, spec, cfg, threshold=0.5, start_date=start, purged=purged, outcomes=outcomes)
    out["always_eligible"] = {"label": "Every eligible chart, no model filter", **_strategy(always, cfg, timeframe)}
    always_eq = _series(always.equity["date"], always.equity["equity"]) if len(always.equity) else None

    # Random entry at the CNN's candidate count.
    k = len(candidates)
    rand_rows: List[Dict[str, Any]] = []
    if 0 < k < len(eligible):
        for seed in range(draws):
            rng = np.random.default_rng(1000 + seed)
            pick = set(rng.choice(len(eligible), size=k, replace=False).tolist())
            sigs = [replace(s, prob=1.0 if i in pick else 0.0) for i, s in enumerate(eligible)]
            r = simulate(sigs, bars, spec, cfg, threshold=0.5, start_date=start, purged=purged, outcomes=outcomes)
            e = r.equity
            closed = [t for t in r.trades if t["status"] == "closed"]
            rand_rows.append({
                "total_return": float(e["equity"].iloc[-1] / cfg.starting_capital - 1.0) if len(e) else None,
                "executed_trades": len(r.trades),
                "expectancy_return": float(np.mean([t["net_return"] for t in closed])) if closed else None,
            })
        rets = np.array([x["total_return"] for x in rand_rows if x["total_return"] is not None], dtype=float)
        trades = np.array([x["executed_trades"] for x in rand_rows], dtype=float)
        cnn_ret = cnn["total_return"]
        out["random_entry"] = {
            "label": f"Random {k} of {len(eligible)} eligible charts, {draws} seeded draws",
            "draws": draws,
            "seeds": [1000, 1000 + draws - 1],
            "median_total_return": float(np.median(rets)) if len(rets) else None,
            "p05_total_return": float(np.percentile(rets, 5)) if len(rets) else None,
            "p95_total_return": float(np.percentile(rets, 95)) if len(rets) else None,
            "median_executed_trades": float(np.median(trades)) if len(trades) else None,
            "cnn_percentile": float(np.mean(rets < cnn_ret)) if (len(rets) and cnn_ret is not None) else None,
            "p_random_ge_cnn": float((1 + np.sum(rets >= cnn_ret)) / (1 + len(rets))) if (len(rets) and cnn_ret is not None) else None,
        }
    else:
        out["random_entry"] = mt.na(
            "the CNN selected no charts" if k == 0 else "the CNN selected every eligible chart, so a random subset equals the always-eligible baseline"
        )

    # Paired comparisons.
    paired: Dict[str, Any] = {}
    if cnn_eq is not None and always_eq is not None:
        paired["always_eligible"] = paired_block_bootstrap(cnn_eq, always_eq, block, ppy)
    passive_vals = (benchmarks.get("series") or {}).get("exposure_matched")
    bench_dates = (benchmarks.get("series") or {}).get("date")
    if cnn_eq is not None and passive_vals and bench_dates:
        passive_eq = _series(bench_dates, passive_vals)
        paired["passive"] = paired_block_bootstrap(cnn_eq, passive_eq, block, ppy)
        out["passive"] = {
            "label": ((benchmarks.get("benchmarks") or {}).get("exposure_matched") or {}).get("label") or "Exposure-matched passive mix",
            "total_return": _v(((benchmarks.get("benchmarks") or {}).get("exposure_matched") or {}).get("total_return")),
        }
    else:
        out["passive"] = mt.na("no exposure-matched passive benchmark for this dataset")
    out["paired"] = paired

    # Robustness: per-year returns versus the always-eligible baseline.
    if cnn_eq is not None and always_eq is not None:
        cy, ay = _yearly(cnn_eq), _yearly(always_eq)
        years = [y for y in cy if y in ay]
        out["by_year"] = [{"year": y, "cnn": cy[y], "always_eligible": ay[y], "diff": cy[y] - ay[y]} for y in years]
        out["years_cnn_ahead"] = sum(1 for y in years if cy[y] > ay[y])
        out["years"] = len(years)

    out["verdict"] = verdict(out, evaluation_class)
    return out


def verdict(inc: Dict[str, Any], evaluation_class: Optional[str]) -> Dict[str, Any]:
    cnn = inc.get("cnn") or {}
    reasons: List[str] = []
    pa = (inc.get("paired") or {}).get("always_eligible") or {}
    pp = (inc.get("paired") or {}).get("passive") or {}
    rnd = inc.get("random_entry") or {}
    closed = cnn.get("closed_trades") or 0

    invalid: List[str] = []
    if not cnn.get("executed_trades"):
        invalid.append("The CNN strategy executed no trades.")
    if not (inc.get("always_eligible") or {}).get("executed_trades"):
        invalid.append("The always-eligible baseline executed no trades.")
    if "mean_diff_annualized" not in pa:
        invalid.append(f"The paired comparison could not be computed ({pa.get('reason', 'no shared dates')}).")
    if invalid:
        return {"id": INVALID, "label": VERDICT_LABEL[INVALID], "reasons": invalid}

    lo_a, hi_a = pa["ci95_annualized"]
    point_a = pa["mean_diff_annualized"]
    lo_p = (pp.get("ci95_annualized") or [None, None])[0]
    pct = rnd.get("cnn_percentile")
    p_rand = rnd.get("p_random_ge_cnn")

    if point_a <= 0 or (pct is not None and pct < 0.5):
        if point_a <= 0:
            reasons.append(f"Versus entering every eligible chart, the CNN's mean annualized return difference is {point_a:+.1%} (95% CI {lo_a:+.1%} to {hi_a:+.1%}).")
        if pct is not None and pct < 0.5:
            reasons.append(f"The CNN's return is below the median of {rnd.get('draws')} random selections of the same size (percentile {pct:.0%}).")
        vid = NO_EDGE
    else:
        strong = lo_a > 0 and (lo_p is None or lo_p > 0) and (p_rand is None or p_rand < 0.05) and (cnn.get("total_return") or 0) > 0 and closed >= 30
        reasons.append(f"Versus every eligible chart: {point_a:+.1%} annualized (95% CI {lo_a:+.1%} to {hi_a:+.1%}).")
        if lo_p is not None:
            reasons.append(f"Versus the exposure-matched passive mix: {pp['mean_diff_annualized']:+.1%} annualized (95% CI {lo_p:+.1%} to {pp['ci95_annualized'][1]:+.1%}).")
        if p_rand is not None:
            reasons.append(f"Random selections of the same size beat or matched the CNN in {p_rand:.0%} of draws (including the observed result).")
        if closed < 30:
            reasons.append(f"Only {closed} closed trades.")
        vid = EDGE if strong else INCONCLUSIVE

    if evaluation_class != "independent_test" and vid == EDGE:
        vid = INCONCLUSIVE
        reasons.append("This is not an independent test (see the leakage audit), so it cannot count as evidence.")
    return {"id": vid, "label": VERDICT_LABEL[vid], "reasons": reasons}
