"""Research diagnostics for Labeling Optimizer runs (methodology v2).

The optimizer's profitability score asks "did this TP/SL/horizon make money historically". The
diagnostics here ask a different question: "what would a CNN training set built with these
settings look like" — label proportions, how many usable and how many non-overlapping samples it
yields, whether the label share is stable over time and across neighbouring settings, and what
precision a classifier would need to beat costs. None of this measures predictability; it only
describes observed outcomes in the research period.

Labels are those of the Generator (shared contract ``app.services.trade_outcomes``, method
``tp_first_else_zero_v2``): entry at the next open, TP and SL fixed at entry, SL first when one bar
touches both, label 1 = TP before SL within ``h`` bars from the entry bar (entry bar = bar 1),
label 0 = SL first or timeout. A sample whose level is touched inside the period is kept; an untouched
window that would need bars after the period end is excluded.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from app.services import label_grid
from app.services import trade_outcomes as outcomes

METHODOLOGY_VERSION = 2

N_BLOCKS = 4  # chronological blocks of entries for stability
MIN_SAMPLES = 30  # below this a cell is not scored
MIN_BLOCK_SAMPLES = 10
# Stability is judged relative to the minority-class share m = min(p, 1 - p): moving from 8 % to 12 %
# changes a rare class by half, while 48 % to 52 % hardly matters. Absolute tolerances would rate
# rare-label cells as stable simply because their shares are small.
REL_TOLERANCE = 0.20  # neighbours "agree" when shares differ by at most 20 % of m ...
MIN_TOLERANCE = 0.02  # ... but never less than 2 pp
REF_INDEPENDENT = 100.0  # non-overlapping windows for full data-sufficiency credit
REF_MINORITY = 0.25  # minority-class share for full balance credit
REF_REL_BLOCK_RANGE = 1.0  # block range (max - min label-1 share) equal to m scores 0 for stability
REF_LIFT = 0.25  # required precision above the base rate that scores 0 for economics
HORIZON_STEP = 0.10  # robustness compares h with about ±10 % horizons
TOP_PER_MODE = 20

SCORE_DOC: Dict[str, Any] = {
    "suitability": {
        "label": "CNN label suitability",
        "formula": "100 × geometric mean of five components (equal weights); 0 when any component is 0",
        "components": {
            "data": f"min(1, non-overlapping windows / {int(REF_INDEPENDENT)})",
            "balance": f"min(1, minority-class share / {REF_MINORITY:.2f}); a 50/50 split is not rewarded beyond that",
            "time": f"max(0, 1 − range of label-1 share across {N_BLOCKS} chronological blocks / ({REF_REL_BLOCK_RANGE:g} × minority share))",
            "neighbours": f"share of the 8 neighbouring TP/SL cells (same horizon) whose label-1 share is within max({int(MIN_TOLERANCE * 100)} pp, {int(REL_TOLERANCE * 100)} % of the minority share)",
            "economics": f"max(0, 1 − max(0, break-even precision − label-1 share) / {REF_LIFT:.2f}); 0 when TP does not cover costs",
        },
        "gate": f"cells with fewer than {MIN_SAMPLES} complete samples are not scored",
    },
    "robustness": {
        "label": "Robustness",
        "formula": "100 × arithmetic mean of four components (equal weights)",
        "components": {
            "time": "same as suitability: stability of the label-1 share across chronological blocks",
            "payoff_sign": f"share of the {N_BLOCKS} blocks whose mean net return per sample has the same sign as the whole period",
            "neighbours": "same as suitability: TP/SL neighbours with a similar label-1 share",
            "horizon": f"share of the horizons about ±{int(HORIZON_STEP * 100)} % away (same TP/SL) whose label-1 share is within the same tolerance",
        },
        "gate": f"cells with fewer than {MIN_SAMPLES} complete samples are not scored",
    },
    "profitability": {
        "label": "Historical profitability",
        "formula": "compounded CAGR of the optimizer's staggered portfolio with mark-to-market exits",
        "components": {
            "portfolio": "one position opened at every bar's open, each sized 1/h of equity, so at most h positions and 100 % exposure are open at once",
            "exits": "TP and SL fill at their levels, or at the open when a later bar gaps through them; SL first when one bar touches both",
            "expiry": "positions that reach the horizon untouched exit at that bar's close",
            "costs": "round-trip cost charged on every position, including expiries",
            "label_payoff": "label_payoff_cagr_pct is the v1 figure (expiries booked at 0 %, no gap fills); it overstates systems whose expiries lose money and is shown for comparison only",
        },
        "gate": "none",
    },
}

LIMITATIONS = [
    "Diagnostics describe observed outcomes in the research period; they do not measure whether a CNN can predict them.",
    "Consecutive samples share most of their future bars, so the effective sample size is far below the sample count; "
    "'non-overlapping windows' approximates it as samples ÷ mean bars held.",
    "Scores are heuristics with documented weights; they rank candidates, they are not probabilities or significance tests.",
    "Every grid cell is evaluated; the best of many cells is optimistic. Use the evaluation period to check a choice.",
    "Near a period end only touched windows can resolve, so the last few entries slightly favour fast TP or SL exits; the Generator labels the same way.",
    "The Generator's chart look-back is not known here, so the first decision bars may have less history than a chart needs.",
]


def selection_index(index: pd.DatetimeIndex, selection_end: Optional[str]) -> int:
    """Last bar of the research period (inclusive). Whole series when not set or out of range."""
    n = len(index)
    if not selection_end:
        return n - 1
    try:
        ts = pd.Timestamp(selection_end)
    except (TypeError, ValueError):
        return n - 1
    if index.tz is not None and ts.tzinfo is None:
        ts = ts.tz_localize(index.tz)
    pos = int(index.searchsorted(ts, side="right")) - 1
    if pos < 1 or pos >= n - 1:
        return n - 1
    return pos


def _div(a, b):
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(b > 0, a / np.where(b > 0, b, 1), np.nan)


def _shift(arr: np.ndarray, axis: int, d: int) -> np.ndarray:
    """``out[i] = arr[i - d]`` along ``axis``; NaN where that index falls outside."""
    if d == 0:
        return np.asarray(arr, dtype=np.float64).copy()
    out = np.full_like(arr, np.nan, dtype=np.float64)
    src = [slice(None)] * arr.ndim
    dst = [slice(None)] * arr.ndim
    if d > 0:
        src[axis], dst[axis] = slice(0, -d), slice(d, None)
    else:
        src[axis], dst[axis] = slice(-d, None), slice(0, d)
    out[tuple(dst)] = arr[tuple(src)]
    return out


def share_tolerance(share: np.ndarray) -> np.ndarray:
    """Allowed label-1 share difference for 'similar' cells, relative to the minority share."""
    return np.maximum(MIN_TOLERANCE, REL_TOLERANCE * np.minimum(share, 1.0 - share))


def relative_block_range(block_range: np.ndarray, share: np.ndarray) -> np.ndarray:
    return _div(block_range, np.minimum(share, 1.0 - share))


def _agree_share(share: np.ndarray, others: List[np.ndarray]) -> np.ndarray:
    agree = np.zeros(share.shape)
    total = np.zeros(share.shape)
    tol = share_tolerance(share)
    for o in others:
        ok = np.isfinite(o) & np.isfinite(share)
        total += ok
        agree += ok & (np.abs(o - share) <= tol + 1e-12)
    return _div(agree, total)


def _horizon_neighbours(horizons: np.ndarray) -> List[np.ndarray]:
    """For each horizon, the index of the horizon about 10 % shorter and about 10 % longer."""
    lo, hi = [], []
    for h in horizons:
        down = min(h - 1, int(round(h * (1 - HORIZON_STEP))))
        up = max(h + 1, int(round(h * (1 + HORIZON_STEP))))
        lo.append(int(np.argmin(np.abs(horizons - down))) if down >= horizons[0] else -1)
        hi.append(int(np.argmin(np.abs(horizons - up))) if up <= horizons[-1] else -1)
    return [np.asarray(lo), np.asarray(hi)]


def _period_stats(raw, tp_values: np.ndarray, cost: float) -> Dict[str, np.ndarray]:
    cnt, n_tp, n_sl, s_ret, s_ret0, s_held, blk_n, blk_tp, blk_ret = raw
    n = cnt.astype(np.float64)
    share1 = _div(n_tp, n)
    gross = _div(s_ret, n)
    l0_mean = _div(s_ret0, n - n_tp)
    tp = tp_values[:, None, None]
    with np.errstate(invalid="ignore", divide="ignore"):
        p_star = (cost - l0_mean) / (tp - l0_mean)
    p_star = np.where((tp - cost > 0) & np.isfinite(p_star), np.clip(p_star, 0.0, 1.0), np.nan)
    mean_held = _div(s_held, n)
    bshare = np.where(blk_n >= MIN_BLOCK_SAMPLES, _div(blk_tp, blk_n.astype(np.float64)), np.nan)
    valid_blocks = np.sum(np.isfinite(bshare), axis=-1)
    with np.errstate(invalid="ignore"), np.testing.suppress_warnings() as sup:
        sup.filter(RuntimeWarning)
        brange = np.where(valid_blocks >= 2, np.nanmax(bshare, axis=-1) - np.nanmin(bshare, axis=-1), np.nan)
    bnet = np.where(blk_n >= MIN_BLOCK_SAMPLES, _div(blk_ret, blk_n.astype(np.float64)) - cost, np.nan)
    net = gross - cost
    same_sign = (np.sign(bnet) == np.sign(net)[..., None]) & np.isfinite(bnet)
    sign_share = np.where(valid_blocks >= 2, _div(same_sign.sum(axis=-1), np.isfinite(bnet).sum(axis=-1)), np.nan)
    return {
        "samples": cnt,
        "tp": n_tp,
        "sl": n_sl,
        "share1": share1,
        "share_sl": _div(n_sl, n),
        "net": net,
        "l0_mean": l0_mean,
        "breakeven": p_star,
        "lift": p_star - share1,
        "mean_held": mean_held,
        "independent": _div(n, mean_held),
        "block_share": bshare,
        "block_range": brange,
        "sign_share": sign_share,
    }


def compute(df: pd.DataFrame, sel_end: int, tp_values, sl_values, horizons, cost: float, *, sl_first: bool = True,
            tables=None) -> Dict[str, Any]:
    """Research statistics, scores and (optionally) evaluation-period statistics for the whole grid."""
    if not label_grid.HAVE_NUMBA:
        raise ImportError("compiled label kernels unavailable")
    tp_values = np.ascontiguousarray(tp_values, dtype=np.float64)
    sl_values = np.ascontiguousarray(sl_values, dtype=np.float64)
    horizons = np.ascontiguousarray(horizons, dtype=np.int64)
    opens = np.ascontiguousarray(df["Open"].to_numpy(dtype=np.float64))
    highs = np.ascontiguousarray(df["High"].to_numpy(dtype=np.float64))
    lows = np.ascontiguousarray(df["Low"].to_numpy(dtype=np.float64))
    closes = np.ascontiguousarray(df["Close"].to_numpy(dtype=np.float64))
    n = len(opens)
    hmax = int(horizons.max())
    fp_tp, fp_sl = tables if tables is not None else label_grid.passage_tables(opens, highs, lows, tp_values, sl_values, hmax)
    flag = 1 if sl_first else 0

    raw = label_grid.research_grid(opens, closes, fp_tp, fp_sl, tp_values, sl_values, horizons, 1, int(sel_end), int(sel_end), N_BLOCKS, flag)
    sel = _period_stats(raw, tp_values, cost)

    share = sel["share1"]
    valid = sel["samples"] >= MIN_SAMPLES
    share_v = np.where(valid, share, np.nan)
    tp_sl_nb = [_shift(_shift(share_v, 0, dt), 1, ds) for dt in (-1, 0, 1) for ds in (-1, 0, 1) if dt or ds]
    nb_tp_sl = _agree_share(share_v, tp_sl_nb)
    lo_idx, hi_idx = _horizon_neighbours(horizons)
    h_nb = []
    for idx in (lo_idx, hi_idx):
        g = np.full_like(share_v, np.nan)
        ok = idx >= 0
        g[:, :, ok] = share_v[:, :, idx[ok]]
        h_nb.append(g)
    nb_h = _agree_share(share_v, h_nb)

    minority = np.minimum(share, 1.0 - share)
    rel_range = relative_block_range(sel["block_range"], share)
    comp = {
        "data": np.clip(sel["independent"] / REF_INDEPENDENT, 0.0, 1.0),
        "balance": np.clip(minority / REF_MINORITY, 0.0, 1.0),
        "time": np.where(np.isfinite(rel_range), np.clip(1.0 - rel_range / REF_REL_BLOCK_RANGE, 0.0, 1.0), 0.0),
        "neighbours": np.nan_to_num(nb_tp_sl, nan=0.0),
        "economics": np.where(np.isfinite(sel["lift"]), np.clip(1.0 - np.maximum(sel["lift"], 0.0) / REF_LIFT, 0.0, 1.0), 0.0),
        "payoff_sign": np.nan_to_num(sel["sign_share"], nan=0.0),
        "horizon": np.nan_to_num(nb_h, nan=0.0),
    }
    comp = {k: np.nan_to_num(v, nan=0.0) for k, v in comp.items()}
    with np.errstate(invalid="ignore"):
        suit = 100.0 * np.power(comp["data"] * comp["balance"] * comp["time"] * comp["neighbours"] * comp["economics"], 1.0 / 5.0)
    robust = 100.0 * (comp["time"] + comp["payoff_sign"] + comp["neighbours"] + comp["horizon"]) / 4.0
    suit = np.where(valid, suit, np.nan)
    robust = np.where(valid, robust, np.nan)

    ev = None
    if sel_end < n - 2:
        raw_e = label_grid.research_grid(opens, closes, fp_tp, fp_sl, tp_values, sl_values, horizons, int(sel_end) + 1, n - 1, n - 1, N_BLOCKS, flag)
        ev = _period_stats(raw_e, tp_values, cost)

    return {
        "tp_values": tp_values, "sl_values": sl_values, "horizons": horizons,
        "selection": sel, "evaluation": ev, "components": comp,
        "suitability": suit, "robustness": robust, "nb_tp_sl": nb_tp_sl, "nb_h": nb_h, "valid": valid,
        "tables": (fp_tp, fp_sl),
    }


# ------------------------------------------------------------------
# Serialisation
# ------------------------------------------------------------------

def _grid_ints(cube: np.ndarray, scale: float) -> list:
    """[tp, sl, h] floats -> [h][sl][tp] ints (value × scale), None where undefined."""
    a = np.asarray(cube, dtype=np.float64).transpose(2, 1, 0) * scale
    out = np.where(np.isfinite(a), np.rint(a), np.nan)
    obj = out.astype(object)
    obj[~np.isfinite(out)] = None
    obj[np.isfinite(out)] = out[np.isfinite(out)].astype(np.int64)
    return obj.tolist()


SURFACE_SCALES = {
    "suitability": 1, "robustness": 1, "label1_share": 1000, "samples": 1, "independent": 1,
    "net_return_bp": 10000, "block_range": 1000, "required_lift": 1000,
    "eval_label1_share": 1000, "eval_samples": 1, "eval_net_return_bp": 10000,
}


def surface_payload(res: Dict[str, Any]) -> Dict[str, Any]:
    sel, ev = res["selection"], res["evaluation"]
    metrics = {
        "suitability": _grid_ints(res["suitability"], 1),
        "robustness": _grid_ints(res["robustness"], 1),
        "label1_share": _grid_ints(sel["share1"], 1000),
        "samples": _grid_ints(sel["samples"], 1),
        "independent": _grid_ints(sel["independent"], 1),
        "net_return_bp": _grid_ints(sel["net"], 10000),
        "block_range": _grid_ints(sel["block_range"], 1000),
        "required_lift": _grid_ints(sel["lift"], 1000),
    }
    if ev is not None:
        metrics["eval_label1_share"] = _grid_ints(ev["share1"], 1000)
        metrics["eval_samples"] = _grid_ints(ev["samples"], 1)
        metrics["eval_net_return_bp"] = _grid_ints(ev["net"], 10000)
    return {
        "version": METHODOLOGY_VERSION,
        "layout": "metrics[name][h][sl][tp]; value = stored integer / scale",
        "tp_values": [float(x) for x in res["tp_values"]],
        "sl_values": [float(x) for x in res["sl_values"]],
        "horizons": [int(x) for x in res["horizons"]],
        "scales": {k: v for k, v in SURFACE_SCALES.items() if k in metrics},
        "metrics": metrics,
    }


def _num(v, nd=4):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, nd) if math.isfinite(f) else None


def _rank(values: np.ndarray, samples: np.ndarray) -> List[tuple]:
    """Cell indices by value desc, ties by more samples, then by grid order (deterministic)."""
    flat = values.reshape(-1)
    order = np.lexsort((np.arange(flat.size), -samples.reshape(-1), -np.nan_to_num(flat, nan=-np.inf)))
    out = []
    for p in order:
        if not np.isfinite(flat[p]):
            break
        out.append(np.unravel_index(int(p), values.shape))
    return out


def candidate_flags(c: Dict[str, Any]) -> List[str]:
    flags = []
    m = c["research"]
    if m["label1_share"] is not None and min(m["label1_share"], 1 - m["label1_share"]) < 0.10:
        flags.append("minority_class_below_10pct")
    if m["independent"] is not None and m["independent"] < 30:
        flags.append("few_non_overlapping_windows")
    share = m["label1_share"]
    if m["block_range"] is not None and share is not None and 0 < min(share, 1 - share) and m["block_range"] > 0.5 * min(share, 1 - share):
        flags.append("label_share_unstable_over_time")
    if m["neighbour_agreement"] is not None and m["neighbour_agreement"] < 0.5:
        flags.append("label_share_sensitive_to_tp_sl")
    if m["breakeven_precision"] is None:
        flags.append("target_does_not_cover_costs")
    elif m["required_lift"] is not None and m["required_lift"] <= 0:
        flags.append("base_rate_already_above_break_even")
    return flags


def candidates_payload(res: Dict[str, Any], profit_cagr: np.ndarray, *, cost: float, periods: Dict[str, Any],
                       label_payoff_cagr: Optional[np.ndarray] = None, eval_profit=None,
                       top: int = TOP_PER_MODE) -> Dict[str, Any]:
    """Top cells per ranking mode with every diagnostic, plus methodology and period metadata.

    ``profit_cagr`` ranks the profitability mode (mark-to-market); ``label_payoff_cagr`` is reported only.
    """
    sel, ev, comp = res["selection"], res["evaluation"], res["components"]
    tp_v, sl_v, hs = res["tp_values"], res["sl_values"], res["horizons"]
    samples = sel["samples"]
    rankings = {
        "profitability": _rank(np.where(np.isfinite(profit_cagr), profit_cagr, np.nan), samples),
        "suitability": _rank(res["suitability"], samples),
        "robustness": _rank(res["robustness"], samples),
    }
    rank_of = {mode: {cell: i + 1 for i, cell in enumerate(cells)} for mode, cells in rankings.items()}
    picked: List[tuple] = []
    for mode in ("suitability", "robustness", "profitability"):
        for cell in rankings[mode][:top]:
            if cell not in picked:
                picked.append(cell)

    out = []
    for cell in picked:
        a, b, c = (int(x) for x in cell)
        research = {
            "samples": int(samples[a, b, c]),
            "label1_share": _num(sel["share1"][a, b, c]),
            "label0_share": _num(1 - sel["share1"][a, b, c]) if np.isfinite(sel["share1"][a, b, c]) else None,
            "sl_share": _num(sel["share_sl"][a, b, c]),
            "timeout_share": _num(1 - sel["share1"][a, b, c] - sel["share_sl"][a, b, c]),
            "independent": _num(sel["independent"][a, b, c], 1),
            "mean_bars_held": _num(sel["mean_held"][a, b, c], 2),
            "block_label1_share": [_num(v) for v in sel["block_share"][a, b, c]],
            "block_range": _num(sel["block_range"][a, b, c]),
            "payoff_sign_consistency": _num(sel["sign_share"][a, b, c], 3),
            "neighbour_agreement": _num(res["nb_tp_sl"][a, b, c], 3),
            "horizon_agreement": _num(res["nb_h"][a, b, c], 3),
            "net_return_per_sample_pct": _num(sel["net"][a, b, c] * 100, 3),
            "label0_mean_return_pct": _num(sel["l0_mean"][a, b, c] * 100, 3),
            "breakeven_precision": _num(sel["breakeven"][a, b, c]),
            "required_lift": _num(sel["lift"][a, b, c]),
            "reward_to_risk": _num((tp_v[a] - cost) / (sl_v[b] + cost), 3),
        }
        entry = {
            "tp": float(tp_v[a]), "sl": float(sl_v[b]), "h": int(hs[c]),
            "index": {"ti": a, "si": b, "hi": c},
            "ranks": {mode: rank_of[mode].get(cell) for mode in rankings},
            "scores": {
                "profitability_cagr_pct": _num(profit_cagr[a, b, c], 2),
                "label_payoff_cagr_pct": _num(label_payoff_cagr[a, b, c], 2) if label_payoff_cagr is not None else None,
                "suitability": _num(res["suitability"][a, b, c], 1),
                "robustness": _num(res["robustness"][a, b, c], 1),
            },
            "components": {k: _num(v[a, b, c], 3) for k, v in comp.items()},
            "research": research,
            "evaluation": None,
        }
        if ev is not None:
            entry["evaluation"] = {
                "samples": int(ev["samples"][a, b, c]),
                "label1_share": _num(ev["share1"][a, b, c]),
                "net_return_per_sample_pct": _num(ev["net"][a, b, c] * 100, 3),
                "block_label1_share": [_num(v) for v in ev["block_share"][a, b, c]],
            }
            if eval_profit is not None:
                entry["evaluation"].update(eval_profit(float(tp_v[a]), float(sl_v[b]), int(hs[c])))
        entry["flags"] = candidate_flags(entry)
        out.append(entry)

    def _best(mode):
        cells = rankings[mode]
        if not cells:
            return None
        a, b, c = (int(x) for x in cells[0])
        return {"tp": float(tp_v[a]), "sl": float(sl_v[b]), "h": int(hs[c])}

    return {
        "version": METHODOLOGY_VERSION,
        "label": {
            "method": outcomes.LABEL_METHOD_V2,
            "convention": outcomes.OUTCOME_CONVENTION,
            "entry": "open of the bar after the decision bar",
            "horizon": "h bars counted from the entry bar (entry bar = bar 1)",
            "label_1": "take-profit touched before the stop-loss within the horizon",
            "label_0": "stop-loss first, or neither level within the horizon (timeout)",
            "same_bar_tie": "stop-loss first (conservative)",
            "incomplete": "an untouched window that would need bars after the period boundary is excluded; a TP or SL touch inside the period still counts (as in the Generator)",
            "prices": "split- and dividend-adjusted daily OHLC (yfinance auto_adjust), as in the Generator",
        },
        "costs_round_trip_pct": _num(cost * 100, 3),
        "periods": periods,
        "scores": SCORE_DOC,
        "limitations": LIMITATIONS,
        "best": {mode: _best(mode) for mode in rankings},
        "scored_cells": {mode: len(cells) for mode, cells in rankings.items()},
        "candidates": out,
    }
