"""
Read-side helpers for backtest runs: path stripping, the v1 compatibility adapter, label-definition
checks and paginated access to v2 artifacts. Stored artifacts are never modified here.
"""

from __future__ import annotations

import csv
import json
import math
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from app.services.review_meta import sanitize_config

API_VERSION = 2

V1_BANNER = "Legacy label-payoff estimate — not a price-based trading simulation."
V1_WITHHELD = {
    "sharpe_ratio": "Computed per chart on label payoffs and clipped to ±8; not a time-series Sharpe ratio.",
    "sharpe_ratio_annualized_hint": "Arbitrary scaling of a per-chart ratio, clipped to ±6; not an annualized statistic.",
}
V1_RENAMED = {
    "max_drawdown": "drawdown_below_start",
    "max_drawdown_pct": "drawdown_below_start_pct",
}

_ABS_PATH_RE = re.compile(r"(?:(?<=\s)|(?<=^)|(?<=[\"'=(:]))(?:/|[A-Za-z]:\\)[^\s\"')]+")

ARTIFACT_FILES = {
    "predictions": "predictions.csv",
    "trades": "trades.csv",
    "skipped": "skipped_entries.csv",
    "equity": "equity_daily.csv",
    "benchmarks": "benchmarks_daily.csv",
}


def strip_paths(text: Optional[str]) -> str:
    """Replace absolute filesystem paths in free text with their basename."""
    if not text:
        return ""
    return _ABS_PATH_RE.sub(lambda m: os.path.basename(m.group(0).rstrip("/\\")) or "<path>", text)


def _basename(v: Any) -> Any:
    return os.path.basename(str(v)) if isinstance(v, str) and v else v


def peak_to_trough(values: Iterable[float]) -> Optional[float]:
    peak, worst = None, 0.0
    for v in values:
        if v is None or not math.isfinite(v):
            continue
        peak = v if peak is None else max(peak, v)
        if peak > 0:
            worst = max(worst, 1 - v / peak)
    return worst if peak is not None else None


def label_definition_mismatch(run_cfg: Dict[str, Any], dataset_summary: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """TP/SL used by a v1 run vs. the TP/SL that defined the dataset's labels (None if unknown or equal)."""
    ld = (dataset_summary or {}).get("label_definition") or {}
    tp, sl = ld.get("tp_frac"), ld.get("sl_frac")
    if tp is None or sl is None:
        return None
    run_tp, run_sl = run_cfg.get("tp_pct"), run_cfg.get("sl_pct")
    if run_tp is None or run_sl is None:
        return None
    if abs(float(run_tp) - float(tp) * 100) < 1e-9 and abs(float(run_sl) - float(sl) * 100) < 1e-9:
        return None
    return {"dataset_tp_pct": float(tp) * 100, "dataset_sl_pct": float(sl) * 100,
            "run_tp_pct": float(run_tp), "run_sl_pct": float(run_sl)}


def v1_public(results: Dict[str, Any], info: Dict[str, Any], dataset_summary: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Legacy results for display: paths removed, invalid statistics withheld, labels corrected."""
    kpis = dict(results.get("kpis") or {})
    withheld = {k: V1_WITHHELD[k] for k in V1_WITHHELD if k in kpis}
    for k in V1_WITHHELD:
        kpis.pop(k, None)
    for old, new in V1_RENAMED.items():
        if old in kpis:
            kpis[new] = kpis.pop(old)
    series = dict(results.get("series") or {})
    eq = series.get("equity") or []
    ptt = peak_to_trough([p.get("equity") for p in eq if isinstance(p, dict)])
    if ptt is not None:
        kpis["peak_to_trough_drawdown_pct_of_estimate"] = ptt * 100
    if "drawdown_pct" in series:
        series["drawdown_below_start_pct"] = series.pop("drawdown_pct")

    def clean_rows(rows: Any) -> List[Dict[str, Any]]:
        out = []
        for r in rows or []:
            if not isinstance(r, dict):
                continue
            r = dict(r)
            if "filename" in r:
                r["image_id"] = _basename(r.pop("filename"))
            for k in list(r):
                if isinstance(r[k], str) and (r[k].startswith("/") or re.match(r"^[A-Za-z]:\\", r[k])):
                    r[k] = _basename(r[k])
            out.append(r)
        return out

    events = clean_rows(results.get("chart_events"))
    labels = [e.get("actual_label") for e in events if e.get("actual_label") in (0, 1)]
    cls = dict(results.get("classification_metrics") or {})
    if labels:
        base = sum(labels) / len(labels)
        cls["positive_base_rate"] = base
        cls["majority_baseline_accuracy"] = max(base, 1 - base)
        cls["n"] = len(labels)

    run_cfg = sanitize_config(results.get("config") or info.get("config") or {})
    warnings = [
        "Trades are valued from chart labels with a synthetic entry price of 100, not from market prices.",
        "Costs are charged once per trade.",
        "Drawdown is measured below starting capital, not from the running peak.",
        "The threshold sweep was run on the test set (in-sample).",
        "The benchmark window starts at the first chart's start date, before the first trading decision.",
    ]
    mismatch = label_definition_mismatch(run_cfg, dataset_summary)
    if mismatch:
        warnings.insert(0, (
            f"TP/SL mismatch: labels were defined at TP {mismatch['dataset_tp_pct']:g}% / SL {mismatch['dataset_sl_pct']:g}%, "
            f"but this run valued them at TP {mismatch['run_tp_pct']:g}% / SL {mismatch['run_sl_pct']:g}%."
        ))
    if "max_trades_per_day" in run_cfg:
        warnings.append("max_trades_per_day was recorded but not applied by the v1 engine.")
    return {
        "api_version": API_VERSION,
        "methodology": {"id": "label_payoff_v1", "version": 1, "label": V1_BANNER},
        "banner": V1_BANNER,
        "warnings": warnings,
        "tp_sl_mismatch": mismatch,
        "withheld_metrics": withheld,
        "kpis": kpis,
        "trades": clean_rows(results.get("trades")),
        "chart_events": events,
        "series": series,
        "threshold_sweep_label": "In-sample sensitivity — not independently validated.",
        "benchmark": {k: (strip_paths(v) if isinstance(v, str) else v) for k, v in (results.get("benchmark") or {}).items()},
        "classification_metrics": cls,
        "summary": results.get("summary") or {},
        "config": run_cfg,
        "timestamp": results.get("timestamp"),
    }


def v2_public(results: Dict[str, Any]) -> Dict[str, Any]:
    """v2 results are written without paths; drop anything path-like defensively."""
    out = dict(results)
    out["api_version"] = API_VERSION
    out["banner"] = None
    model = dict(out.get("model") or {})
    for k in list(model):
        if isinstance(model[k], str) and (model[k].startswith("/") or "\\" in model[k]):
            model.pop(k)
    out["model"] = model
    out.pop("threshold_sweep", None)
    out.pop("robustness", None)
    return out


# --------------------------------------------------------------------------- CSV artifacts


def _coerce(v: str) -> Any:
    if v == "":
        return None
    try:
        f = float(v)
    except ValueError:
        return v
    return int(f) if f.is_integer() and "." not in v and "e" not in v.lower() else f


def read_artifact(output_dir: Path, name: str) -> List[Dict[str, Any]]:
    fname = ARTIFACT_FILES.get(name)
    if not fname:
        raise KeyError(name)
    path = output_dir / fname
    if not path.is_file():
        return []
    with open(path, newline="") as f:
        rows = [{k: _coerce(v) for k, v in r.items()} for r in csv.DictReader(f)]
    for r in rows:
        if "flags" in r:
            r["flags"] = [x for x in str(r["flags"] or "").split(";") if x]
    return rows


def query_rows(
    rows: List[Dict[str, Any]],
    *,
    offset: int = 0,
    limit: int = 100,
    q: Optional[str] = None,
    symbol: Optional[str] = None,
    status: Optional[str] = None,
    exit_reason: Optional[str] = None,
    prob_min: Optional[float] = None,
    prob_max: Optional[float] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    date_field: str = "decision_ts",
    outcome: Optional[str] = None,
    sort: Optional[str] = None,
    order: str = "asc",
) -> Dict[str, Any]:
    out = rows
    if q:
        ql = q.lower()
        out = [r for r in out if ql in str(r.get("sample_id", "")).lower() or ql in str(r.get("symbol", "")).lower()]
    if symbol:
        out = [r for r in out if r.get("symbol") == symbol]
    if status:
        out = [r for r in out if r.get("status") == status]
    if exit_reason:
        out = [r for r in out if r.get("exit_reason") == exit_reason]
    if outcome == "win":
        out = [r for r in out if isinstance(r.get("net_pnl"), (int, float)) and r["net_pnl"] > 0]
    elif outcome == "loss":
        out = [r for r in out if isinstance(r.get("net_pnl"), (int, float)) and r["net_pnl"] <= 0]
    if prob_min is not None:
        out = [r for r in out if isinstance(r.get("prob"), (int, float)) and r["prob"] >= prob_min]
    if prob_max is not None:
        out = [r for r in out if isinstance(r.get("prob"), (int, float)) and r["prob"] <= prob_max]
    if date_from:
        out = [r for r in out if str(r.get(date_field) or "")[:10] >= date_from[:10]]
    if date_to:
        out = [r for r in out if str(r.get(date_field) or "")[:10] <= date_to[:10]]
    if sort and out and sort in out[0]:
        present = [r for r in out if r.get(sort) is not None]
        missing = [r for r in out if r.get(sort) is None]
        present.sort(key=lambda r: (isinstance(r[sort], str), r[sort]), reverse=(order == "desc"))
        out = present + missing
    total = len(out)
    limit = max(1, min(int(limit), 1000))
    offset = max(0, int(offset))
    return {"total": total, "offset": offset, "limit": limit, "rows": out[offset: offset + limit]}
