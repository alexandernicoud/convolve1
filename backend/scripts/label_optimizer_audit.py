"""Methodology audit for the labeling optimizer (7.2.py).

Reads a completed grid and the price data it was computed from, and writes
``optimizer_audit.json`` + ``optimizer_surface.json`` next to the other
artifacts. The optimizer's own numbers are reproduced unchanged; every
alternative valuation below is reported separately and labelled as such.

Standalone use on an existing run:
    python label_optimizer_audit.py --run_dir runs/<user>/<run_id> [--ohlc_csv prices.csv]
"""
from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

AUDIT_VERSION = 1
TRAIN_FRACTION = 0.6
TOP_CANDIDATES = 15


# ------------------------------------------------------------------
# Engine access
# ------------------------------------------------------------------

def load_engine():
    """Import 7.2.py as a module (its CLI lives under __main__)."""
    os.environ.setdefault("MPLBACKEND", "Agg")
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "7.2.py")
    spec = importlib.util.spec_from_file_location("label_optimizer_engine", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ------------------------------------------------------------------
# Single-candidate walk with selectable exit valuation
# ------------------------------------------------------------------

def walk_candidate(df: pd.DataFrame, tp: float, sl: float, h: int, *, engine, mark_to_market: bool):
    """Same entry, sizing, cost and same-bar rule as 7.2.py.

    mark_to_market=False reproduces 7.2.py exactly (expiry books 0, TP/SL fill at
    their levels even through gaps). mark_to_market=True books the actual
    close-to-entry move at expiry and fills at the open when a later bar gaps
    through a level.
    """
    opens = df["Open"].to_numpy(dtype=float)
    highs = df["High"].to_numpy(dtype=float)
    lows = df["Low"].to_numpy(dtype=float)
    closes = df["Close"].to_numpy(dtype=float)
    n = len(df)
    h = max(int(h), 1)
    w = 1.0 / h
    cost = float(engine.TOTAL_COST_FRAC)
    sl_first = engine.AMBIGUOUS_FILL != "TP_FIRST"
    start_equity = float(engine.START_CAPITAL)

    equity = start_equity
    tp_hits = sl_hits = expiries = 0
    expiry_returns: list[float] = []
    path_realized = [start_equity]
    path_marked = [start_equity]
    open_pos: list[list[float]] = []  # entry, tpL, slL, expiry_idx, entry_idx

    for i in range(1, n):
        entry = opens[i]
        open_pos.append([entry, entry * (1 + tp), entry * (1 - sl), min(i + h - 1, n - 1), i])
        hi, lo, op, cl = highs[i], lows[i], opens[i], closes[i]
        still = []
        for pos in open_pos:
            e, tpL, slL, exp, k = pos
            hit_tp = hi >= tpL
            hit_sl = lo <= slL
            if hit_tp and hit_sl:
                out = -1 if sl_first else 1
            elif hit_sl:
                out = -1
            elif hit_tp:
                out = 1
            else:
                out = 0
            if out == 0 and i < exp:
                still.append(pos)
                continue
            if out == 1:
                r = tp
                if mark_to_market and k < i and op >= tpL:
                    r = op / e - 1.0
                tp_hits += 1
            elif out == -1:
                r = -sl
                if mark_to_market and k < i and op <= slL:
                    r = op / e - 1.0
                sl_hits += 1
            else:
                r = (cl / e - 1.0) if mark_to_market else 0.0
                expiries += 1
                expiry_returns.append(cl / e - 1.0)
            equity *= 1.0 + (w * r - w * cost)
            equity = max(equity, 0.0)
        open_pos = still
        unreal = sum(w * (cl / p[0] - 1.0) for p in open_pos)
        path_realized.append(equity)
        path_marked.append(equity * (1.0 + unreal))

    years = max((df.index[-1] - df.index[0]).days / 365.25, 1e-9)
    total = equity / start_equity - 1.0
    cagr = (1.0 + total) ** (1.0 / years) - 1.0 if total > -0.999999 else float("nan")
    marked = np.asarray(path_marked)
    peak = np.maximum.accumulate(marked)
    dd = float(np.max(1.0 - marked / peak)) if len(marked) else 0.0
    exp_arr = np.asarray(expiry_returns) if expiry_returns else np.zeros(0)
    return {
        "equity_final": equity,
        "total_return_pct": total * 100.0,
        "cagr_pct": cagr * 100.0,
        "years": years,
        "tp_hits": tp_hits,
        "sl_hits": sl_hits,
        "expiries": expiries,
        "expiry_mean_move_pct": float(exp_arr.mean() * 100.0) if exp_arr.size else None,
        "expiry_negative_share": float((exp_arr < 0).mean()) if exp_arr.size else None,
        "max_drawdown_marked_pct": dd * 100.0,
        "path_realized": path_realized,
        "path_marked": path_marked,
    }


# ------------------------------------------------------------------
# Full-grid mark-to-market (compiled)
# ------------------------------------------------------------------

def mtm_grid(df: pd.DataFrame, tp_values, sl_values, horizons, *, engine):
    """compounded CAGR % under mark-to-market exits for every grid cell, or None."""
    try:
        from numba import njit, prange
    except Exception:
        return None

    @njit(cache=False, parallel=True)
    def _grid(opens, highs, lows, closes, tps, sls, hs, cost, sl_first):
        n = opens.shape[0]
        n_tp, n_sl, n_h = tps.shape[0], sls.shape[0], hs.shape[0]
        out = np.empty(n_tp * n_sl * n_h, dtype=np.float64)
        for p in prange(n_tp * n_sl * n_h):
            hi_i = p % n_h
            tmp = p // n_h
            si = tmp % n_sl
            ti = tmp // n_sl
            tp = tps[ti]
            sl = sls[si]
            h = hs[hi_i]
            if h < 1:
                h = 1
            w = 1.0 / h
            entry = np.empty(n)
            alive = np.zeros(n, dtype=np.bool_)
            eq = 1.0
            for i in range(1, n):
                entry[i] = opens[i]
                alive[i] = True
                start = i - h + 1
                if start < 1:
                    start = 1
                for k in range(start, i + 1):
                    if not alive[k]:
                        continue
                    e = entry[k]
                    tpL = e * (1.0 + tp)
                    slL = e * (1.0 - sl)
                    exp = k + h - 1
                    if exp > n - 1:
                        exp = n - 1
                    hit_tp = highs[i] >= tpL
                    hit_sl = lows[i] <= slL
                    out_k = 0
                    if hit_tp and hit_sl:
                        out_k = -1 if sl_first else 1
                    elif hit_sl:
                        out_k = -1
                    elif hit_tp:
                        out_k = 1
                    if out_k == 0 and i < exp:
                        continue
                    alive[k] = False
                    if out_k == 1:
                        r = tp
                        if k < i and opens[i] >= tpL:
                            r = opens[i] / e - 1.0
                    elif out_k == -1:
                        r = -sl
                        if k < i and opens[i] <= slL:
                            r = opens[i] / e - 1.0
                    else:
                        r = closes[i] / e - 1.0
                    eq *= 1.0 + (w * r - w * cost)
                    if eq < 0.0:
                        eq = 0.0
            out[p] = eq
        return out

    o = np.ascontiguousarray(df["Open"].to_numpy(dtype=np.float64))
    hgh = np.ascontiguousarray(df["High"].to_numpy(dtype=np.float64))
    lw = np.ascontiguousarray(df["Low"].to_numpy(dtype=np.float64))
    c = np.ascontiguousarray(df["Close"].to_numpy(dtype=np.float64))
    eq = _grid(o, hgh, lw, c,
               np.ascontiguousarray(tp_values, dtype=np.float64),
               np.ascontiguousarray(sl_values, dtype=np.float64),
               np.ascontiguousarray(horizons, dtype=np.int64),
               float(engine.TOTAL_COST_FRAC), engine.AMBIGUOUS_FILL != "TP_FIRST")
    years = max((df.index[-1] - df.index[0]).days / 365.25, 1e-9)
    with np.errstate(invalid="ignore", divide="ignore"):
        cagr = np.where(eq > 1e-6, eq ** (1.0 / years) - 1.0, np.nan) * 100.0
    return cagr.reshape(len(tp_values), len(sl_values), len(horizons))


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _f(x, nd=4):
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None
    return round(v, nd)


def _cube(df_res: pd.DataFrame, col: str, tp_values, sl_values, horizons):
    """[tp, sl, h] array of a grid column."""
    ti = np.searchsorted(tp_values, df_res["tp_frac"].to_numpy())
    si = np.searchsorted(sl_values, df_res["sl_frac"].to_numpy())
    hi = np.searchsorted(horizons, df_res["horizon_days"].to_numpy())
    cube = np.full((len(tp_values), len(sl_values), len(horizons)), np.nan)
    cube[ti, si, hi] = df_res[col].to_numpy(dtype=float)
    return cube


def neighbourhood(cube, ti, si, hi):
    best = cube[ti, si, hi]
    vals = []
    for dt in (-1, 0, 1):
        for ds in (-1, 0, 1):
            for dh in (-1, 0, 1):
                if dt == ds == dh == 0:
                    continue
                a, b, c = ti + dt, si + ds, hi + dh
                if 0 <= a < cube.shape[0] and 0 <= b < cube.shape[1] and 0 <= c < cube.shape[2]:
                    v = cube[a, b, c]
                    if np.isfinite(v):
                        vals.append(float(v))
    if not vals or not np.isfinite(best):
        return None
    arr = np.asarray(vals)
    ratio = arr / best if abs(best) > 1e-12 else np.full_like(arr, np.nan)
    tp_line = cube[:, si, hi]
    return {
        "best": float(best),
        "count": int(arr.size),
        "median": float(np.median(arr)),
        "min": float(arr.min()),
        "max": float(arr.max()),
        "median_ratio": float(np.median(ratio)),
        "share_within_25pct": float(np.mean(ratio >= 0.75)),
        "share_within_50pct": float(np.mean(ratio >= 0.5)),
        "tp_step_minus": _f(tp_line[ti - 1]) if ti > 0 else None,
        "tp_step_plus": _f(tp_line[ti + 1]) if ti + 1 < len(tp_line) else None,
        "h_step_plus": _f(cube[ti, si, hi + 1]) if hi + 1 < cube.shape[2] else None,
    }


def classify_region(nb) -> str:
    if nb is None:
        return "unknown"
    if nb["share_within_25pct"] >= 0.6 and nb["median_ratio"] >= 0.75:
        return "plateau"
    if nb["share_within_50pct"] >= 0.5:
        return "ridge"
    return "isolated"


def configured_vs_applied(cfg: dict, engine) -> list[dict]:
    applied = {
        "tp_min_pct": engine.TP_MIN * 100, "tp_max_pct": engine.TP_MAX * 100,
        "sl_min_pct": engine.SL_MIN * 100, "sl_max_pct": engine.SL_MAX * 100,
        "horizon_min": engine.HORIZON_MIN, "horizon_max": engine.HORIZON_MAX,
        "grid_tp_steps": engine.TP_STEPS, "grid_sl_steps": engine.SL_STEPS,
        "fee_rate_pct": engine.FEE_RATE * 100, "min_trades": engine.MIN_TRADES,
        "objective": "max_cagr",
    }
    rows = []
    for key, used in applied.items():
        if key not in cfg:
            continue
        want = cfg[key]
        if isinstance(used, str) or isinstance(want, str):
            match = str(want) == str(used)
        else:
            try:
                match = abs(float(want) - float(used)) < 1e-9
            except (TypeError, ValueError):
                match = False
        note = None
        if key == "min_trades":
            note = "Not applied when selecting the highest-scoring candidate."
            match = False
        rows.append({"field": key, "configured": want, "applied": used, "match": bool(match), "note": note})
    return rows


def _segment_eval(df_seg, tp, sl, h, engine):
    lab = walk_candidate(df_seg, tp, sl, h, engine=engine, mark_to_market=False)
    mtm = walk_candidate(df_seg, tp, sl, h, engine=engine, mark_to_market=True)
    c = df_seg["Close"].to_numpy(dtype=float)
    return {
        "start": str(df_seg.index[0].date()),
        "end": str(df_seg.index[-1].date()),
        "bars": int(len(df_seg)),
        "label_model_return_pct": _f(lab["total_return_pct"], 2),
        "mark_to_market_return_pct": _f(mtm["total_return_pct"], 2),
        "buy_and_hold_return_pct": _f((c[-1] / c[0] - 1.0) * 100.0, 2),
        "tp_hits": mtm["tp_hits"], "sl_hits": mtm["sl_hits"], "expiries": mtm["expiries"],
    }


def walk_forward(df_price: pd.DataFrame, engine):
    n = len(df_price)
    split = int(n * TRAIN_FRACTION)
    if split < 60 or n - split < 40:
        return {"available": False, "reason": "Fewer than 100 bars; no chronological holdout."}
    train = df_price.iloc[:split]
    test = df_price.iloc[split:]
    with contextlib.redirect_stdout(io.StringIO()):
        res = engine.run_grid_search(train, progress=None)
        test_res = engine.run_grid_search(test, progress=None)
    if res.empty:
        return {"available": False, "reason": "Training grid produced no results."}
    pick = res.nlargest(1, "compounded_cagr_pct").iloc[0]
    tp, sl, h = float(pick["tp_frac"]), float(pick["sl_frac"]), int(pick["horizon_days"])
    pct = None
    if not test_res.empty:
        row = test_res[
            np.isclose(test_res["tp_frac"], tp) & np.isclose(test_res["sl_frac"], sl)
            & (test_res["horizon_days"] == h)
        ]
        if not row.empty:
            v = float(row["compounded_return_pct"].iloc[0])
            pct = float((test_res["compounded_return_pct"] < v).mean() * 100.0)
    return {
        "available": True,
        "train_fraction": TRAIN_FRACTION,
        "train": {
            "start": str(train.index[0].date()), "end": str(train.index[-1].date()), "bars": int(len(train)),
            "selected": {"tp": tp, "sl": sl, "h": h},
            "in_sample_return_pct": _f(pick["compounded_return_pct"], 2),
        },
        "test": _segment_eval(test, tp, sl, h, engine),
        "test_percentile_label_model": _f(pct, 1),
    }


# ------------------------------------------------------------------
# Main entry
# ------------------------------------------------------------------

def run_audit(df_price: pd.DataFrame, df_res: pd.DataFrame, out_dir: str, *, symbol: str, start: str,
              end: str, engine, config: dict | None = None, log=print) -> dict:
    tp_values = np.sort(df_res["tp_frac"].unique())
    sl_values = np.sort(df_res["sl_frac"].unique())
    horizons = np.sort(df_res["horizon_days"].unique()).astype(int)

    best = df_res.nlargest(1, "compounded_cagr_pct").iloc[0]
    tp, sl, h = float(best["tp_frac"]), float(best["sl_frac"]), int(best["horizon_days"])
    ti = int(np.searchsorted(tp_values, tp))
    si = int(np.searchsorted(sl_values, sl))
    hi = int(np.searchsorted(horizons, h))

    log("audit: reproducing best candidate")
    lab = walk_candidate(df_price, tp, sl, h, engine=engine, mark_to_market=False)
    mtm = walk_candidate(df_price, tp, sl, h, engine=engine, mark_to_market=True)
    reproduced = abs(lab["equity_final"] - float(best["equity_final"])) <= 1e-6 * max(1.0, float(best["equity_final"]))

    cube_lab = _cube(df_res, "compounded_cagr_pct", tp_values, sl_values, horizons)
    best_val = float(best["compounded_cagr_pct"])
    ties = int(np.sum(np.isclose(cube_lab, best_val, rtol=1e-9, atol=1e-9)))
    tie_rows = df_res[np.isclose(df_res["compounded_cagr_pct"], best_val, rtol=1e-9, atol=1e-9)]
    nb_lab = neighbourhood(cube_lab, ti, si, hi)

    log("audit: mark-to-market grid")
    cube_mtm = mtm_grid(df_price, tp_values, sl_values, horizons, engine=engine)
    nb_mtm = neighbourhood(cube_mtm, ti, si, hi) if cube_mtm is not None else None
    mtm_best = None
    if cube_mtm is not None and np.isfinite(cube_mtm).any():
        a, b, c = np.unravel_index(np.nanargmax(cube_mtm), cube_mtm.shape)
        mtm_best = {"tp": float(tp_values[a]), "sl": float(sl_values[b]), "h": int(horizons[c]),
                    "cagr_pct": _f(cube_mtm[a, b, c], 2),
                    "label_model_cagr_pct": _f(cube_lab[a, b, c], 2)}

    finite = cube_lab[np.isfinite(cube_lab)]
    near_best = int(np.sum(finite >= 0.9 * best_val)) if best_val > 0 else None

    # Rows with identical outcomes at the same TP/horizon differ only in an SL that never
    # triggered; they are one candidate, not several.
    top = df_res.sort_values("compounded_cagr_pct", ascending=False).head(TOP_CANDIDATES * 20)
    groups: list[tuple[pd.Series, list[float]]] = []
    seen: dict[tuple, int] = {}
    for _, r in top.iterrows():
        key = (round(float(r["compounded_cagr_pct"]), 6), float(r["tp_frac"]), int(r["horizon_days"]), int(r["trades"]))
        if key in seen:
            groups[seen[key]][1].append(float(r["sl_frac"]))
            continue
        if len(groups) >= TOP_CANDIDATES:
            continue
        seen[key] = len(groups)
        groups.append((r, [float(r["sl_frac"])]))
    candidates = []
    for rank, (r, sls) in enumerate(groups, start=1):
        a = int(np.searchsorted(tp_values, r["tp_frac"]))
        b = int(np.searchsorted(sl_values, r["sl_frac"]))
        c = int(np.searchsorted(horizons, int(r["horizon_days"])))
        nb = neighbourhood(cube_lab, a, b, c)
        candidates.append({
            "rank": rank, "tp": float(r["tp_frac"]), "sl": float(r["sl_frac"]), "h": int(r["horizon_days"]),
            "sl_min": min(sls), "sl_max": max(sls), "tied": len(sls),
            "cagr_pct": _f(r["compounded_cagr_pct"], 2),
            "mtm_cagr_pct": _f(cube_mtm[a, b, c], 2) if cube_mtm is not None else None,
            "trades": int(r["trades"]),
            "tp_share": _f(r["label1_ratio"], 4),
            "max_dd_pct": _f(r["max_drawdown_pct"], 2),
            "neighbour_median_ratio": _f(nb["median_ratio"], 3) if nb else None,
            "region": classify_region(nb),
        })

    log("audit: chronological holdout")
    try:
        wf = walk_forward(df_price, engine)
    except Exception as exc:  # holdout is diagnostic only
        wf = {"available": False, "reason": f"Holdout failed: {exc}"}

    closes = df_price["Close"].to_numpy(dtype=float)
    dates = [d.strftime("%Y-%m-%d") for d in df_price.index]
    asset_pct = ((closes / closes[0]) - 1.0) * 100.0
    sc = float(engine.START_CAPITAL)

    years = lab["years"]
    n_bars = len(df_price)
    defects = [
        {
            "id": "expiry_zero",
            "severity": "critical",
            "title": "Expired trades book zero return",
            "detail": ("A trade that reaches its horizon without touching TP or SL is booked at 0% "
                       "(cost only) instead of its actual close-to-entry move "
                       f"(7.2.py simulate_system_for_metrics, `r = 0.0`). For this candidate "
                       f"{lab['expiries']} of {lab['expiries'] + lab['tp_hits'] + lab['sl_hits']} positions expired; "
                       + (f"{lab['expiry_negative_share'] * 100:.0f}% of them were actually losing at expiry."
                          if lab["expiry_negative_share"] is not None else "")),
        },
        {
            "id": "in_sample",
            "severity": "critical",
            "title": "Selection and evaluation use the same data",
            "detail": (f"The reported score is the maximum over {int(np.isfinite(cube_lab).sum()):,} "
                       f"parameter combinations evaluated on the same {n_bars} bars. No holdout or walk-forward "
                       "is applied inside the optimizer."),
        },
        {
            "id": "config_ignored",
            "severity": "high",
            "title": "Configured search settings are not passed to the optimizer",
            "detail": ("Only symbol/start/end reach 7.2.py; TP/SL ranges, grid steps, fee, min trades and "
                       "objective from the form are stored but the script's built-in defaults are used."),
        },
        {
            "id": "win_rate_definition",
            "severity": "medium",
            "title": "'Win rate' excludes expired trades",
            "detail": ("label1_ratio counts TP hits among TP/SL exits only. With most positions expiring, "
                       f"a value of {float(best['label1_ratio']) * 100:.0f}% says little about profitability."),
        },
        {
            "id": "drawdown_realized_only",
            "severity": "medium",
            "title": "Drawdown ignores open positions; metrics.json drawdown is always 0",
            "detail": ("max_drawdown_pct is measured on realized linear P/L only. export_metrics_json "
                       "computes min(0, max(-100, dd)) on a positive number, so metrics.json always reports 0."),
        },
        {
            "id": "gap_fills",
            "severity": "low",
            "title": "Gaps through TP/SL fill at the level",
            "detail": ("For horizons above one day, a bar that opens beyond SL is filled at the SL level rather "
                       "than at the open. Not relevant for a 1-day horizon."),
        },
        {
            "id": "short_window",
            "severity": "medium",
            "title": "CAGR is annualised from a short window",
            "detail": f"The window covers {years:.2f} years; CAGR extrapolates compounding over that span.",
        },
    ]

    region = classify_region(nb_lab)
    oos_ok = bool(wf.get("available") and wf["test"]["mark_to_market_return_pct"] is not None
                  and wf["test"]["buy_and_hold_return_pct"] is not None
                  and wf["test"]["mark_to_market_return_pct"] > wf["test"]["buy_and_hold_return_pct"])
    recommend = False  # in-sample idealised payoff can never qualify on its own

    audit = {
        "version": AUDIT_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "symbol": symbol, "start": start, "end": end,
        "bars": n_bars, "years": _f(years, 3),
        "objective": {"key": "compounded_cagr_pct",
                      "label": "Compounded CAGR of the label-payoff simulation (single objective)"},
        "evaluation": "in_sample",
        "payoff_model": {
            "name": "label_payoff",
            "entry": "Open of each bar, one new position per bar",
            "sizing": "1/h of equity per position (parallel positions)",
            "exits": "TP / SL at level; ambiguous same-bar resolved SL first",
            "expiry": "Booked at 0% (cost only)",
            "costs_round_trip_pct": _f(float(engine.TOTAL_COST_FRAC) * 100, 3),
        },
        "best": {
            "tp": tp, "sl": sl, "h": h,
            "cagr_pct": _f(best_val, 2),
            "total_return_pct": _f(best["compounded_return_pct"], 2),
            "linear_pl_per_year_pct": _f(best["pnl_linear_per_year_pct"], 2),
            "trades_counted": int(best["trades"]),
            "tp_share": _f(best["label1_ratio"], 4),
            "max_dd_realized_pct": _f(best["max_drawdown_pct"], 2),
            "reproduced": bool(reproduced),
            "ties": ties,
            "tie_sl_values": sorted({float(x) for x in tie_rows["sl_frac"]})[:30],
            "tie_tp_values": sorted({float(x) for x in tie_rows["tp_frac"]})[:30],
            "tie_horizons": sorted({int(x) for x in tie_rows["horizon_days"]})[:30],
        },
        "exits": {
            "tp_hits": lab["tp_hits"], "sl_hits": lab["sl_hits"], "expiries": lab["expiries"],
            "expiry_mean_move_pct": _f(lab["expiry_mean_move_pct"], 3),
            "expiry_negative_share": _f(lab["expiry_negative_share"], 3),
        },
        "mark_to_market": {
            "description": ("Same entries, sizing, costs and same-bar rule; expiries booked at the actual "
                            "close-to-entry move and gap-through fills at the open."),
            "cagr_pct": _f(mtm["cagr_pct"], 2),
            "total_return_pct": _f(mtm["total_return_pct"], 2),
            "max_dd_marked_pct": _f(mtm["max_drawdown_marked_pct"], 2),
            "label_max_dd_marked_pct": _f(lab["max_drawdown_marked_pct"], 2),
            "best_under_mtm": mtm_best,
            "grid_available": cube_mtm is not None,
        },
        "asset": {
            "total_return_pct": _f(asset_pct[-1], 2),
            "cagr_pct": _f(((closes[-1] / closes[0]) ** (1.0 / years) - 1.0) * 100.0, 2) if closes[0] > 0 else None,
        },
        "robustness": {
            "region": region,
            "label_model": nb_lab,
            "mark_to_market": nb_mtm,
            "cells_within_10pct_of_best": near_best,
            "grid_cells": int(np.isfinite(cube_lab).sum()),
        },
        "walk_forward": wf,
        "configuration": configured_vs_applied(config or {}, engine),
        "defects": defects,
        "candidates": candidates,
        "verdict": {
            "evidence": "insufficient",
            "recommend": recommend,
            "out_of_sample_beats_buy_and_hold": oos_ok,
        },
        "series": {
            "dates": dates,
            "label_model_pct": [_f((v / sc - 1) * 100, 3) for v in lab["path_realized"]],
            "mark_to_market_pct": [_f((v / sc - 1) * 100, 3) for v in mtm["path_marked"]],
            "asset_pct": [_f(v, 3) for v in asset_pct],
        },
    }

    surface = {
        "tp_values": [float(x) for x in tp_values],
        "sl_values": [float(x) for x in sl_values],
        "horizons": [int(x) for x in horizons],
        "label_model": [[[_f(cube_lab[a, b, c], 1) for a in range(len(tp_values))]
                         for b in range(len(sl_values))] for c in range(len(horizons))],
        "mark_to_market": ([[[_f(cube_mtm[a, b, c], 1) for a in range(len(tp_values))]
                             for b in range(len(sl_values))] for c in range(len(horizons))]
                           if cube_mtm is not None else None),
        "best": {"tp": tp, "sl": sl, "h": h},
    }

    with open(os.path.join(out_dir, "optimizer_audit.json"), "w") as f:
        json.dump(audit, f, separators=(",", ":"))
    with open(os.path.join(out_dir, "optimizer_surface.json"), "w") as f:
        json.dump(surface, f, separators=(",", ":"))
    log("audit: written optimizer_audit.json, optimizer_surface.json")
    return audit


def _cli():
    p = argparse.ArgumentParser()
    p.add_argument("--run_dir", required=True)
    p.add_argument("--ohlc_csv", default=None, help="Optional OHLC CSV instead of downloading")
    args = p.parse_args()

    engine = load_engine()
    art = os.path.join(args.run_dir, "artifacts")
    with open(os.path.join(art, "metrics.json")) as f:
        m = json.load(f)
    cfg = {}
    cfg_path = os.path.join(args.run_dir, "optimizer_config.json")
    if os.path.isfile(cfg_path):
        with open(cfg_path) as f:
            cfg = json.load(f)
    symbol, start, end = m["symbol"], m["start"], m["end"]
    if args.ohlc_csv:
        df = pd.read_csv(args.ohlc_csv, index_col=0, parse_dates=True)
        df = df.dropna(subset=["Open", "High", "Low", "Close"])
    else:
        df = engine.load_data(symbol, start, end)
    full = os.path.join(art, f"{symbol}_LO_full.csv")
    cols = ["tp_frac", "sl_frac", "horizon_days", "trades", "label1_ratio", "max_drawdown_pct",
            "pnl_linear_per_year_pct", "equity_final", "compounded_return_pct", "compounded_cagr_pct"]
    df_res = pd.read_csv(full, usecols=cols)
    run_audit(df, df_res, art, symbol=symbol, start=start, end=end, engine=engine, config=cfg)


if __name__ == "__main__":
    sys.exit(_cli())
