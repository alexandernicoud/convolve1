"""Compact, sanitized summaries of recorded run artifacts for the Review workspace.

Everything here reads values tools already wrote; nothing is estimated. Missing
inputs produce missing keys (never zeros) so the UI can say "not recorded".
"""

from __future__ import annotations

import json
import os
import threading
from typing import Any, Dict, Iterable, List, Optional, Tuple

# Keys that can carry absolute host paths or credentials. Never sent to the browser.
_PATH_KEYS = {
    "folder_name",
    "model_path",
    "dataset_path",
    "output_dir",
    "chart_folder",
    "extracted_path",
    "img_path",
    "logs",
    "user_id",
}

_JSON_CACHE: Dict[str, Tuple[float, int, Any]] = {}
_JSON_CACHE_LOCK = threading.Lock()
_JSON_CACHE_MAX = 512


def read_json_cached(path: str) -> Optional[Any]:
    """json.load keyed on (mtime, size). Large result files are parsed once per change."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = os.path.abspath(path)
    with _JSON_CACHE_LOCK:
        hit = _JSON_CACHE.get(key)
        if hit and hit[0] == st.st_mtime and hit[1] == st.st_size:
            return hit[2]
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    with _JSON_CACHE_LOCK:
        if len(_JSON_CACHE) >= _JSON_CACHE_MAX:
            _JSON_CACHE.pop(next(iter(_JSON_CACHE)))
        _JSON_CACHE[key] = (st.st_mtime, st.st_size, data)
    return data


def read_json_dict_cached(path: str) -> Optional[Dict[str, Any]]:
    data = read_json_cached(path)
    return data if isinstance(data, dict) else None


def sanitize_config(cfg: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Drop path/credential keys and any string value that looks like an absolute path."""
    if not isinstance(cfg, dict):
        return {}
    out: Dict[str, Any] = {}
    for k, v in cfg.items():
        if k in _PATH_KEYS:
            continue
        if isinstance(v, str) and (v.startswith("/") or (len(v) > 2 and v[1] == ":" and v[2] in "\\/")):
            continue
        if isinstance(v, dict):
            out[k] = sanitize_config(v)
        else:
            out[k] = v
    return out


def _pick(src: Dict[str, Any], keys: Iterable[str]) -> Dict[str, Any]:
    return {k: src[k] for k in keys if src.get(k) is not None}


def downsample(points: List[Any], max_points: int) -> List[Any]:
    """Evenly thin a series, always keeping the first and last point."""
    n = len(points)
    if n <= max_points or max_points < 3:
        return list(points)
    step = (n - 1) / (max_points - 1)
    return [points[round(i * step)] for i in range(max_points)]


# ---------------------------------------------------------------------------
# Trainer
# ---------------------------------------------------------------------------

TRAINER_METRIC_KEYS = (
    "accuracy",
    "val_accuracy",
    "loss",
    "val_loss",
    "label_1_recall",
    "val_label_1_recall",
    "val_label_1_accuracy",
)


def saved_model_metrics(summary: Dict[str, Any]) -> Dict[str, Any]:
    """Metrics of the epoch whose weights were saved (summary v2), else the last logged epoch."""
    if not isinstance(summary, dict):
        return {}
    saved = summary.get("saved_weights_metrics")
    if isinstance(saved, dict):
        return saved
    final = summary.get("final_metrics")
    return final if isinstance(final, dict) else {}


def recorded_best_epoch(summary: Dict[str, Any]) -> Optional[int]:
    """summary v1 stored best_epoch as len(history) - 5, which is not a measurement; ignore it."""
    if not isinstance(summary, dict) or not summary.get("summary_version"):
        return None
    value = summary.get("best_epoch")
    return int(value) if isinstance(value, (int, float)) else None


def trainer_summary(summary: Dict[str, Any]) -> Dict[str, Any]:
    """Training setup + saved-model metrics, keeping train vs validation keys distinct."""
    if not summary:
        return {}
    cfg = summary.get("config") if isinstance(summary.get("config"), dict) else {}
    final = saved_model_metrics(summary)
    out: Dict[str, Any] = _pick(
        summary, ("train_samples", "val_samples", "batch_size", "epochs_trained", "completed_at")
    )
    best = recorded_best_epoch(summary)
    if best is not None:
        out["best_epoch"] = best
    if summary.get("saved_weights_epoch") is not None:
        out["saved_weights_epoch"] = summary["saved_weights_epoch"]
    if isinstance(summary.get("image_size"), list):
        out["image_size"] = summary["image_size"]
    out.update(_pick(cfg, ("epochs", "val_split", "random_seed", "use_standard_config", "learning_rate", "optimizer")))
    if "use_standard_config" in cfg:
        out["architecture"] = "Convolve standard CNN" if cfg.get("use_standard_config") else "Custom configuration"
    metrics = _pick(final, TRAINER_METRIC_KEYS)
    if summary.get("epochs_trained") is not None:
        metrics["epochs_trained"] = summary["epochs_trained"]
    if best is not None:
        metrics["best_epoch"] = best
    if metrics:
        out["metrics"] = metrics
    return out


def history_series(history: Any, max_points: int = 400) -> List[Dict[str, Any]]:
    if not isinstance(history, list):
        return []
    rows = []
    for h in history:
        if not isinstance(h, dict) or h.get("epoch") is None:
            continue
        row = {"epoch": h["epoch"]}
        row.update(_pick(h, TRAINER_METRIC_KEYS))
        rows.append(row)
    return downsample(rows, max_points)


# ---------------------------------------------------------------------------
# Backtest
# ---------------------------------------------------------------------------

# Simulated trading outcome. All P&L figures are net of the modelled commission and slippage.
BACKTEST_PERFORMANCE_KEYS = (
    "return_pct",
    "pnl",
    "win_rate",
    "profit_factor",
    "sharpe_ratio",
    "sharpe_ratio_annualized_hint",
    "max_drawdown",
    "max_drawdown_pct",
    "avg_win",
    "avg_loss",
    "trades",
    "no_trade_count",
    "trade_frequency",
    "total_charts_analyzed",
    "metrics_insufficient_sample",
    "avg_confidence_trades",
)
# Trading assumptions that must match before two backtests are comparable.
BACKTEST_ASSUMPTION_KEYS = (
    "starting_capital",
    "position_size_pct",
    "commission_pct",
    "slippage_pct",
    "confidence_threshold",
    "tp_pct",
    "sl_pct",
    "sample_size",
    "img_size",
    "max_drawdown_pct",
    "max_trades_per_day",
)


def backtest_summary(info: Dict[str, Any], results: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Headline performance, per-image classification and the assumptions behind them."""
    cfg = info.get("config") if isinstance(info.get("config"), dict) else {}
    out: Dict[str, Any] = {"assumptions": _pick(cfg, BACKTEST_ASSUMPTION_KEYS)}
    if not results:
        return out
    kpis = results.get("kpis") if isinstance(results.get("kpis"), dict) else {}
    perf = _pick(kpis, BACKTEST_PERFORMANCE_KEYS)
    if perf:
        perf["costs_included"] = True
        out["performance"] = perf
    cm = results.get("classification_metrics")
    if isinstance(cm, dict):
        out["classification"] = _pick(cm, ("accuracy", "precision", "recall", "f1"))
    bench = results.get("benchmark") if isinstance(results.get("benchmark"), dict) else {}
    if bench.get("phase_start") or bench.get("phase_end"):
        out["period"] = {"start": bench.get("phase_start"), "end": bench.get("phase_end")}
    if bench.get("underlying_symbol"):
        out["symbol"] = bench["underlying_symbol"]
    rc = results.get("config") if isinstance(results.get("config"), dict) else {}
    for k, v in _pick(rc, BACKTEST_ASSUMPTION_KEYS).items():
        out["assumptions"].setdefault(k, v)
    return out


def backtest_equity(results: Optional[Dict[str, Any]], max_points: int = 400) -> List[Dict[str, Any]]:
    if not results:
        return []
    series = results.get("series") if isinstance(results.get("series"), dict) else {}
    equity = series.get("equity") if isinstance(series.get("equity"), list) else []
    keep = ("as_of_date", "equity", "strategy_indexed", "spy_indexed", "underlying_indexed")
    rows = [{k: p.get(k) for k in keep if p.get(k) is not None} for p in equity if isinstance(p, dict)]
    return downsample(rows, max_points)


# ---------------------------------------------------------------------------
# Labeling optimizer (in-sample label search, not a trading backtest)
# ---------------------------------------------------------------------------


def optimizer_summary(cfg: Optional[Dict[str, Any]], metrics: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {"in_sample": True}
    if cfg:
        out["config"] = _pick(
            cfg,
            (
                "symbol",
                "start",
                "end",
                "timeframe",
                "objective",
                "fee_rate_pct",
                "min_trades",
                "tp_min_pct",
                "tp_max_pct",
                "sl_min_pct",
                "sl_max_pct",
                "horizon_min",
                "horizon_max",
                "grid_tp_steps",
                "grid_sl_steps",
            ),
        )
    if metrics:
        out["best"] = _pick(
            metrics,
            (
                "best_tp",
                "best_sl",
                "best_h",
                "best_cagr",
                "best_linear_annual_pl",
                "max_drawdown",
                "trades",
                "win_rate",
                "calmar_ratio",
                "asset_annual_cagr_pct",
            ),
        )
    return out


# ---------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------

GENERATOR_CONFIG_KEYS = (
    "symbols",
    "timeframe",
    "timespanUnit",
    "timespanCount",
    "chartsPerLabel",
    "horizonBars",
    "takeProfitFraction",
    "stopLossFraction",
    "imageDimension",
    "useCandles",
    "balanceMode",
    "volumeMode",
    "trainingStartIso",
    "referenceEndIso",
    "endOffset",
)


def generator_summary(cfg: Optional[Dict[str, Any]], stats: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if cfg:
        out["config"] = _pick(cfg, GENERATOR_CONFIG_KEYS)
    if stats:
        out["stats"] = _pick(
            stats,
            ("total_charts", "symbols_count", "timeframe", "chart_type", "balance_mode", "balanced", "removed_for_balance"),
        )
        if isinstance(stats.get("label_counts"), dict):
            out["label_distribution"] = stats["label_counts"]
    return out


def analysis_summary(delivery: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not delivery:
        return {}
    items = delivery.get("artifacts_summary") if isinstance(delivery.get("artifacts_summary"), list) else []
    artifacts = [
        _pick(a, ("id", "type", "title", "subtitle", "layer_name", "png_file"))
        for a in items
        if isinstance(a, dict)
    ]
    return {
        "artifact_count": delivery.get("artifact_count", len(artifacts)),
        "artifacts": artifacts,
        "images": [f for f in (delivery.get("generated_files") or []) if isinstance(f, str)],
    }
