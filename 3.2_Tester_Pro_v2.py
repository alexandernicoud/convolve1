#!/usr/bin/env python3
"""
Backtester Script - 3.2_Tester_Pro_v2.py
Performs backtesting of trained CNN models on chart datasets

KPI methodology (trading vs classification):
- Chart timeline: every image is processed in chronological order (parsed from filename dates).
  Equity is recorded after each chart (flat steps on NO_TRADE).
  - Trading P&L when P(long) ≥ --confidence_threshold (0–1 or 0–100); below threshold → NO_TRADE (still logged).
- Classification metrics use all images vs model predictions.

Max drawdown:
- Versus starting capital: 0% while equity >= starting; otherwise (starting - equity) / starting * 100.
- Max metrics = worst shortfall below starting over the timeline (not peak-to-trough).

Sharpe (executed trades only):
- Uses simple returns (capital_after - capital_before) / capital_before on events where trade_taken.

Profit factor:
- gross_wins / gross_losses on executed trades only; JSON null when no losing trades but had wins.
"""

import os
import re
import sys
import json
import math
import argparse
import numpy as np
from pathlib import Path
from datetime import datetime, timedelta, date
from collections import Counter
import tensorflow as tf
from tensorflow import keras
from PIL import Image
import matplotlib.pyplot as plt

def parse_args():
    parser = argparse.ArgumentParser(description='Backtest CNN model on chart dataset')
    parser.add_argument('--model_path', required=True, help='Path to Keras model file')
    parser.add_argument('--dataset_path', required=True, help='Path to dataset images directory')
    parser.add_argument('--sample_size', type=str, default='all', help='Sample size (number or "all")')
    parser.add_argument('--confidence_threshold', type=float, default=0.5, help='Confidence threshold for predictions')
    parser.add_argument('--tp_pct', type=float, default=2.0, help='Take profit percentage')
    parser.add_argument('--sl_pct', type=float, default=2.0, help='Stop loss percentage')
    parser.add_argument('--img_size', type=int, default=224, help='Image size for model input')
    parser.add_argument('--output_dir', required=True, help='Output directory for results')

    # Trading parameters
    parser.add_argument('--starting_capital', type=float, default=10000.0, help='Starting capital amount')
    parser.add_argument('--position_size_pct', type=float, default=10.0, help='Position size as percentage of capital')
    parser.add_argument('--commission_pct', type=float, default=0.1, help='Commission per trade as percentage')
    parser.add_argument('--slippage_pct', type=float, default=0.05, help='Slippage per trade as percentage')

    # Risk management
    parser.add_argument('--max_drawdown_pct', type=float, default=20.0, help='Maximum drawdown before stopping')

    return parser.parse_args()


# SYMBOL_YYYY-MM-DD_to_YYYY-MM-DD_labelX — symbol may contain underscores (non-greedy)
CHART_FILENAME_RE = re.compile(
    r"^(.+?)_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})_label(\d+)$",
    re.IGNORECASE,
)
_FALLBACK_END = datetime(9999, 12, 31, 23, 59, 59)
_FALLBACK_START = datetime(1970, 1, 1)


def parse_chart_filename_metadata(filename: str):
    """
    Extract symbol, chart_start_date, chart_end_date, label_from_pattern from basename.
    Returns dict with datetime objects and str symbol; on failure uses sort-stable fallbacks.
    """
    stem = Path(filename).stem
    m = CHART_FILENAME_RE.match(stem)
    if m:
        symbol = m.group(1).strip()
        try:
            chart_start = datetime.strptime(m.group(2), "%Y-%m-%d")
            chart_end = datetime.strptime(m.group(3), "%Y-%m-%d")
        except ValueError:
            chart_start, chart_end = _FALLBACK_START, _FALLBACK_END
        label_pat = int(m.group(4))
        return {
            "symbol": symbol,
            "chart_start_date": chart_start,
            "chart_end_date": chart_end,
            "label_from_pattern": label_pat,
            "parsed_ok": True,
        }
    return {
        "symbol": stem.split("_")[0] if "_" in stem else stem or "UNKNOWN",
        "chart_start_date": _FALLBACK_START,
        "chart_end_date": _FALLBACK_END,
        "label_from_pattern": None,
        "parsed_ok": False,
    }


def infer_label_from_filename(filename_lower: str, meta: dict) -> int:
    """Binary actual label: prefer regex label digit, else legacy heuristics."""
    if meta.get("label_from_pattern") is not None:
        return 1 if int(meta["label_from_pattern"]) != 0 else 0
    if "label0" in filename_lower or "_0." in filename_lower:
        return 0
    if "label1" in filename_lower or "_1." in filename_lower:
        return 1
    if "tp" in filename_lower or "profit" in filename_lower or "up" in filename_lower:
        return 1
    return 0


def chronological_sort_key(path: Path, meta: dict):
    end = meta["chart_end_date"]
    start = meta["chart_start_date"]
    sym = meta["symbol"].lower()
    return (end, start, sym, path.name.lower())


def _is_dataset_junk_path(path: Path) -> bool:
    """macOS zip debris: __MACOSX folders and AppleDouble ._filename files are not images."""
    if any(part == "__MACOSX" or part.lower() == "__macosx" for part in path.parts):
        return True
    if path.name.startswith("._"):
        return True
    if path.name == ".DS_Store":
        return True
    return False


def load_model(model_path):
    """Load Keras model from file"""
    print(f"Loading model from {model_path}")
    try:
        model = keras.models.load_model(model_path)
        print(f"Model loaded successfully. Input shape: {model.input_shape}")
        return model
    except Exception as e:
        raise Exception(f"Failed to load model: {e}")

def load_dataset_images(dataset_path, sample_size, img_size):
    """
    Discover images, sort chronologically (chart_end, chart_start, symbol, filename), then load.
    Returns X, y, filenames, metas (parallel list of parse_chart_filename_metadata dicts).
    """
    dataset_path = Path(dataset_path)
    print(f"Loading dataset from {dataset_path}")

    if not dataset_path.exists():
        raise Exception(f"Dataset path does not exist: {dataset_path}")

    image_extensions = [".png", ".jpg", ".jpeg", ".bmp"]
    raw_paths: list[Path] = []
    for ext in image_extensions:
        raw_paths.extend(dataset_path.glob(f"**/*{ext}"))
        raw_paths.extend(dataset_path.glob(f"**/*{ext.upper()}"))

    junk_count = 0
    image_files: list[Path] = []
    for p in raw_paths:
        if _is_dataset_junk_path(p):
            junk_count += 1
            continue
        image_files.append(p)

    # Same file matched by *.png and *.PNG on case-insensitive volumes → one logical image
    by_resolved: dict[Path, Path] = {}
    for p in image_files:
        by_resolved.setdefault(p.resolve(), p)
    image_files = list(by_resolved.values())

    if junk_count:
        print(
            f"Skipped {junk_count} non-image paths (__MACOSX metadata, AppleDouble ._* files, etc.)"
        )

    if not image_files:
        raise Exception(f"No image files found in {dataset_path}")

    print(f"Found {len(image_files)} image paths (pre-sort)")

    # Attach metadata and sort (do not use filesystem order)
    decorated = []
    for p in image_files:
        meta = parse_chart_filename_metadata(p.name)
        decorated.append((chronological_sort_key(p, meta), p, meta))

    decorated.sort(key=lambda x: x[0])

    sorted_paths = [t[1] for t in decorated]

    if sample_size != "all":
        try:
            sample_limit = int(sample_size)
            if sample_limit > 0 and sample_limit < len(sorted_paths):
                sorted_paths = sorted_paths[:sample_limit]
                print(f"Limited to {sample_limit} samples after chronological sort")
        except ValueError:
            pass

    images = []
    labels = []
    filenames = []
    metas = []

    for img_path in sorted_paths:
        try:
            meta = parse_chart_filename_metadata(img_path.name)
            fn_low = img_path.name.lower()
            label = infer_label_from_filename(fn_low, meta)

            img = Image.open(img_path).convert("RGB")
            img = img.resize((img_size, img_size))
            img_array = np.array(img) / 255.0

            images.append(img_array)
            labels.append(label)
            filenames.append(str(img_path))
            metas.append(meta)

        except Exception as e:
            print(f"Warning: Failed to load {img_path}: {e}")
            continue

    if not images:
        raise Exception("No valid images could be loaded")

    X = np.array(images)
    y = np.array(labels)

    print(f"Loaded {len(X)} images with shape {X.shape} (chronological order)")
    print(f"Label distribution: {np.bincount(y)}")

    return X, y, filenames, metas


def compute_classification_metrics(y_true, y_pred):
    """Compute binary classification metrics for label1 (image-level, not trading P&L)."""
    y_true = np.array(y_true).astype(int)
    y_pred = np.array(y_pred).astype(int)
    tp = int(np.sum((y_true == 1) & (y_pred == 1)))
    tn = int(np.sum((y_true == 0) & (y_pred == 0)))
    fp = int(np.sum((y_true == 0) & (y_pred == 1)))
    fn = int(np.sum((y_true == 1) & (y_pred == 0)))

    total = tp + tn + fp + fn
    accuracy = (tp + tn) / total if total > 0 else 0.0
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

    return accuracy, precision, recall, f1


# --- Minimum samples for reporting risk ratios (avoid noise / divide-by-zero) ---
MIN_TRADES_SHARPE = 8
MIN_TRADES_ANNUALIZED_SHARPE = 30
SHARPE_STD_FLOOR = 1e-9
SHARPE_SAMPLE_CAP = 8.0
SHARPE_ANNUAL_CAP = 6.0


def max_drawdown_vs_initial(capital_history, starting_capital: float):
    """
    Drawdown measured only against initial capital (not running peak).
    Shortfall below starting: max(0, starting - equity). Reporting in $ and % of starting.
    """
    starting = float(starting_capital)
    if not capital_history or starting < 1e-12:
        return 0.0, 0.0
    min_eq = min(float(x) for x in capital_history)
    shortfall = max(0.0, starting - min_eq)
    pct = (shortfall / starting) * 100.0
    return shortfall, pct


def compute_sharpe_equity_returns(returns, n_trades: int):
    """
    Sharpe from equity step returns (not daily bars).
    - Uses sample std (ddof=1) when n>=2.
    - No sqrt(252): trades are not daily — we expose a conservative annualized hint only when
      the sample is large enough (see MIN_TRADES_ANNUALIZED_SHARPE) using sqrt(min(n, 252)).
    - Returns (sharpe_sample_or_none, sharpe_annualized_hint_or_none).
    """
    returns = np.asarray(returns, dtype=float)
    n = len(returns)
    if n_trades < MIN_TRADES_SHARPE or n < 2:
        return None, None
    mu = float(np.mean(returns))
    sd = float(np.std(returns, ddof=1))
    if sd < SHARPE_STD_FLOOR:
        return None, None
    sharpe_s = mu / sd
    sharpe_s = float(np.clip(sharpe_s, -SHARPE_SAMPLE_CAP, SHARPE_SAMPLE_CAP))
    sharpe_a = None
    if n_trades >= MIN_TRADES_ANNUALIZED_SHARPE:
        scale = np.sqrt(min(n, 252))
        sharpe_a = float(np.clip(sharpe_s * scale, -SHARPE_ANNUAL_CAP, SHARPE_ANNUAL_CAP))
    return sharpe_s, sharpe_a


def compute_profit_factor(trades):
    """
    Gross wins / gross losses (absolute). If there are no losing trades but there are wins,
    return None (JSON null) — infinity is misleading in a dashboard.
    """
    wins = [t["pnl_net"] for t in trades if t["pnl_net"] > 0]
    losses = [t["pnl_net"] for t in trades if t["pnl_net"] < 0]
    gpw = sum(wins)
    gpl = abs(sum(losses))
    if gpl < 1e-12:
        return None if gpw > 0 else None
    return gpw / gpl


def build_full_equity_series(starting_capital, chart_events):
    """One equity point per analyzed chart plus initial (step 0). trade_index aliases step_index for UI."""
    s0 = float(starting_capital)
    first_start = chart_events[0]["chart_start_date"] if chart_events else None
    pts = [
        {
            "step_index": 0,
            "trade_index": 0,
            "chart_end_date": None,
            "as_of_date": first_start,
            "symbol": None,
            "equity": round(s0, 2),
            "cumulative_pnl": 0.0,
            "trade_taken": False,
            "outcome": None,
            "predicted_label": None,
        }
    ]
    for k, ev in enumerate(chart_events, start=1):
        eq = float(ev["capital_after"])
        pts.append(
            {
                "step_index": k,
                "trade_index": k,
                "chart_end_date": ev["chart_end_date"],
                "as_of_date": ev["chart_end_date"],
                "symbol": ev["symbol"],
                "equity": round(eq, 2),
                "cumulative_pnl": round(eq - s0, 2),
                "trade_taken": ev["trade_taken"],
                "outcome": ev["outcome"],
                "predicted_label": int(ev["predicted_label"]),
            }
        )
    return pts


def build_drawdown_series_vs_initial(capital_history, starting_capital: float):
    """0% when equity >= starting; else (starting - equity) / starting * 100 (loss vs initial only)."""
    starting = float(starting_capital)
    out = []
    for i, eq in enumerate(capital_history):
        eq = float(eq)
        if starting < 1e-12:
            dd_pct = 0.0
        elif eq >= starting:
            dd_pct = 0.0
        else:
            dd_pct = (starting - eq) / starting * 100.0
        out.append(
            {
                "step_index": i,
                "trade_index": i,
                "drawdown_pct": round(dd_pct, 4),
            }
        )
    return out


def _parse_ymd(s: str):
    if not s:
        return None
    return datetime.strptime(s, "%Y-%m-%d").date()


def _yf_ticker(symbol: str):
    if not symbol:
        return None
    s = str(symbol).strip().upper()
    if s in ("UNKNOWN", ""):
        return None
    return s.replace(".", "-")


def _underlying_mode_symbol(chart_events):
    syms = [
        e["symbol"]
        for e in chart_events
        if e.get("symbol") and str(e["symbol"]).strip().upper() not in ("UNKNOWN", "")
    ]
    if not syms:
        return None
    return Counter(syms).most_common(1)[0][0]


def _smooth_ma(y, window: int = 5):
    """Light moving average for plot lines only (keeps endpoints)."""
    y = np.asarray(y, dtype=float)
    n = len(y)
    if n < 3:
        return y.copy()
    w = min(max(3, window | 1), n if n % 2 == 1 else n - 1)
    if w % 2 == 0:
        w -= 1
    if w < 3:
        return y.copy()
    pad = w // 2
    yp = np.pad(y, (pad, pad), mode="edge")
    k = np.ones(w, dtype=float) / w
    out = np.convolve(yp, k, mode="valid")
    return out[:n]


def _adj_close_series(df):
    import pandas as pd

    if df is None or (hasattr(df, "empty") and df.empty):
        return None
    if isinstance(df, pd.Series):
        s = df.astype(float).copy()
        s.index = pd.to_datetime(s.index).normalize()
        return s.sort_index()
    if isinstance(df.columns, pd.MultiIndex):
        for name in ("Adj Close", "Close"):
            try:
                if name not in df.columns.get_level_values(0):
                    continue
                sub = df[name]
                ser = sub.iloc[:, 0] if isinstance(sub, pd.DataFrame) else sub
                s = ser.astype(float).copy()
                s.index = pd.to_datetime(s.index).normalize()
                return s.sort_index()
            except Exception:
                continue
        try:
            flat = df.copy()
            flat.columns = [
                c[0] if isinstance(c, tuple) and len(c) > 0 else c for c in flat.columns
            ]
            col = "Adj Close" if "Adj Close" in flat.columns else "Close"
            if col in flat.columns:
                s = flat[col].astype(float).copy()
                s.index = pd.to_datetime(s.index).normalize()
                return s.sort_index()
        except Exception:
            pass
        return None
    col = "Adj Close" if "Adj Close" in df.columns else "Close"
    s = df[col].astype(float).copy()
    s.index = pd.to_datetime(s.index).normalize()
    return s.sort_index()


def _price_asof(ser, d: date):
    import pandas as pd

    if ser is None or ser.empty:
        return float("nan")
    ts = pd.Timestamp(d)
    sub = ser.loc[:ts]
    if sub.empty:
        return float("nan")
    return float(sub.iat[-1])


def fetch_spy_and_underlying_indexed(chart_events, capital_history, starting_capital: float):
    """
    Daily closes from yfinance between min(chart starts) and max(chart ends).
    Aligns SPY and dataset underlying (mode symbol from filenames) to each equity step.
    Returns indexed series (start = 100) parallel to capital_history, plus metadata.
    """
    import yfinance as yf

    starting = float(starting_capital)
    n = len(capital_history)
    nan_list = [float("nan")] * n
    out = {
        "ok": False,
        "spy_indexed": nan_list.copy(),
        "underlying_indexed": nan_list.copy(),
        "underlying_symbol": None,
        "underlying_ticker": None,
        "phase_start": None,
        "phase_end": None,
        "error": None,
    }
    if not chart_events or n < 2:
        out["error"] = "no_chart_events"
        return out

    d0 = _parse_ymd(chart_events[0]["chart_start_date"])
    dates = [d0]
    for ev in chart_events:
        de = _parse_ymd(ev["chart_end_date"])
        dates.append(de)
    if len(dates) != n:
        out["error"] = "date_timeline_mismatch"
        return out

    phase_start = min(dates)
    phase_end = max(dates)
    out["phase_start"] = phase_start.isoformat()
    out["phase_end"] = phase_end.isoformat()

    und_raw = _underlying_mode_symbol(chart_events)
    out["underlying_symbol"] = und_raw
    und_tk = _yf_ticker(und_raw) if und_raw else None
    out["underlying_ticker"] = und_tk

    dl_start = phase_start.isoformat()
    dl_end = (phase_end + timedelta(days=5)).isoformat()

    try:
        spy_df = yf.download("SPY", start=dl_start, end=dl_end, progress=False, auto_adjust=True)
        spy_s = _adj_close_series(spy_df)
        sym_s = None
        if und_tk and und_tk != "SPY":
            sym_df = yf.download(und_tk, start=dl_start, end=dl_end, progress=False, auto_adjust=True)
            sym_s = _adj_close_series(sym_df)
        elif und_tk == "SPY":
            sym_s = spy_s
    except Exception as e:
        out["error"] = str(e)
        return out

    if spy_s is None or spy_s.empty:
        out["error"] = "spy_empty"
        return out

    spy_px = [_price_asof(spy_s, d) for d in dates]
    if und_tk and sym_s is not None and not sym_s.empty:
        und_px = [_price_asof(sym_s, d) for d in dates]
    else:
        und_px = [float("nan")] * n

    def forward_fill_nan(xs):
        last = None
        outv = []
        for v in xs:
            if v is None or (isinstance(v, float) and np.isnan(v)):
                outv.append(last)
            else:
                last = v
                outv.append(v)
        return outv

    spy_px = forward_fill_nan(spy_px)
    und_px = forward_fill_nan(und_px)

    def fill_leading(xs):
        first_i = next(
            (i for i, v in enumerate(xs) if v is not None and not (isinstance(v, float) and np.isnan(v)) and v > 0),
            None,
        )
        if first_i is None:
            return xs, None
        fv = xs[first_i]
        for j in range(first_i):
            xs[j] = fv
        return xs, fv

    spy_px, _ = fill_leading(spy_px)
    und_px, _ = fill_leading(und_px)

    if spy_px[0] is None or spy_px[0] <= 0:
        out["error"] = "spy_baseline_missing"
        return out

    s0s = spy_px[0]
    spy_idx = [100.0 if s0s <= 0 else (p / s0s) * 100.0 if p is not None and p > 0 else float("nan") for p in spy_px]

    und_idx = []
    u0 = und_px[0] if und_px and und_px[0] is not None and und_px[0] > 0 else None
    if u0:
        und_idx = [(p / u0) * 100.0 if p is not None and p > 0 else float("nan") for p in und_px]
    else:
        und_idx = [float("nan")] * n

    out["spy_indexed"] = [float(x) for x in spy_idx]
    out["underlying_indexed"] = [float(x) for x in und_idx]
    out["ok"] = True
    return out


def attach_benchmarks_to_equity_series(equity_pts, starting_capital: float, benchmark_bundle: dict):
    """Add strategy_indexed (100 = start) and SPY / underlying when numeric values exist (even if bundle.ok is false)."""
    starting = float(starting_capital)
    spy = benchmark_bundle.get("spy_indexed") or []
    und = benchmark_bundle.get("underlying_indexed") or []
    for i, p in enumerate(equity_pts):
        eq = float(p["equity"])
        p["strategy_indexed"] = round((eq / starting) * 100.0, 4) if starting > 1e-12 else round(eq, 4)
        sv = spy[i] if i < len(spy) else float("nan")
        uv = und[i] if i < len(und) else float("nan")
        p["spy_indexed"] = round(float(sv), 4) if isinstance(sv, (int, float)) and np.isfinite(float(sv)) else None
        p["underlying_indexed"] = round(float(uv), 4) if isinstance(uv, (int, float)) and np.isfinite(float(uv)) else None


def _entry_prob_threshold(confidence_threshold: float) -> float:
    """Config may be 0.5 (fraction) or 50 (percent)."""
    t = float(confidence_threshold)
    if t > 1.0:
        t = t / 100.0
    return float(np.clip(t, 0.0, 1.0))


def simulate_threshold_path(prob_long, y, entry_threshold, tp_pct, sl_pct, args):
    """
    Counterfactual walk: enter long iff P(long) >= entry_threshold (same TP/SL rules as main backtest).
    Returns total return % and executed-trade win rate (TP / (TP+SL)).
    """
    thr = float(np.clip(float(entry_threshold), 0.0, 1.0))
    pl = np.asarray(prob_long, dtype=float).reshape(-1)
    yy = np.asarray(y, dtype=int).reshape(-1)
    if pl.size != yy.size:
        return {"return_pct": 0.0, "win_rate": 0.0, "total_trades": 0}

    pred = (pl >= thr).astype(int)
    starting = float(args.starting_capital)
    capital = starting
    total_trades = 0
    wins = 0
    n = int(pl.size)

    for i in range(n):
        capital_before = capital
        pred_label = int(pred[i])
        actual = int(yy[i])
        if pred_label == 1:
            total_trades += 1
            position_size = capital_before * (args.position_size_pct / 100.0)
            commission_cost = position_size * (args.commission_pct / 100.0)
            slippage_cost = position_size * (args.slippage_pct / 100.0)
            if actual == 1:
                pnl_gross = position_size * (tp_pct / 100.0)
                wins += 1
            else:
                pnl_gross = -position_size * (sl_pct / 100.0)
            pnl_net = pnl_gross - commission_cost - slippage_cost
            capital += pnl_net
            current_drawdown = starting - capital
            if current_drawdown > (starting * args.max_drawdown_pct / 100.0):
                break

    final_capital = float(capital)
    return_pct = float((final_capital - starting) / starting * 100.0) if starting > 1e-12 else 0.0
    win_rate = float(wins / total_trades) if total_trades > 0 else 0.0
    return {
        "return_pct": return_pct,
        "win_rate": win_rate,
        "total_trades": int(total_trades),
    }


def build_threshold_sweep(prob_long, y, tp_pct, sl_pct, args):
    """For each P(long) cutoff 0.1*x, x=0..10, simulate strategy metrics (same timeline ordering)."""
    out = []
    for xi in range(0, 11):
        thr = round(0.1 * float(xi), 1)
        sm = simulate_threshold_path(prob_long, y, thr, tp_pct, sl_pct, args)
        out.append(
            {
                "entry_threshold": float(thr),
                "return_pct": round(float(sm["return_pct"]), 4),
                "win_rate_pct": round(float(sm["win_rate"]) * 100.0, 4),
                "trades": int(sm["total_trades"]),
            }
        )
    return out


def run_backtest(model, X, y, filenames, metas, confidence_threshold, tp_pct, sl_pct, output_dir, args):
    """Per-chart timeline: predict all, then walk chronology; P&L only on predicted long."""
    print("Running backtest simulation...")

    predictions = model.predict(X, batch_size=32, verbose=1)
    if predictions.ndim == 1 or predictions.shape[1] == 1:
        prob_long = predictions.reshape(-1)
    else:
        prob_long = predictions[:, 1]
    entry_thr = _entry_prob_threshold(confidence_threshold)
    predicted_classes = (prob_long >= entry_thr).astype(int)
    confidence_scores = prob_long

    print(f"Total predictions: {len(predictions)}")
    print(f"Class distribution - Predicted: {np.bincount(predicted_classes)}")
    print(f"Class distribution - Actual: {np.bincount(y)}")
    print(f"Confidence stats - Mean: {np.mean(confidence_scores):.3f}, Min: {np.min(confidence_scores):.3f}, Max: {np.max(confidence_scores):.3f}")
    print(
        f"Trade entry: P(long) ≥ {entry_thr:.4f} (--confidence_threshold {confidence_threshold}). "
        "Charts below threshold are NO_TRADE but remain in chart_events and equity timeline."
    )

    accuracy, precision, recall, f1 = compute_classification_metrics(y, predicted_classes)
    avg_confidence_all = float(np.mean(confidence_scores)) if len(confidence_scores) else 0.0

    starting = float(args.starting_capital)
    capital = starting
    chart_events = []
    executed_trades = []

    n = len(filenames)
    for i in range(n):
        capital_before = capital
        pred_label = int(predicted_classes[i])
        actual = int(y[i])
        conf = float(confidence_scores[i])
        meta = metas[i]
        fn = filenames[i]

        entry_price = 100.0
        position_size = 0.0
        exit_price = entry_price
        pnl_gross = 0.0
        commission_cost = 0.0
        slippage_cost = 0.0
        pnl_net = 0.0
        trade_taken = False
        outcome = "NO_TRADE"

        if pred_label == 1:
            trade_taken = True
            position_size = capital_before * (args.position_size_pct / 100.0)
            commission_cost = position_size * (args.commission_pct / 100.0)
            slippage_cost = position_size * (args.slippage_pct / 100.0)
            if actual == 1:
                outcome = "TP"
                pnl_gross = position_size * (tp_pct / 100.0)
                exit_price = entry_price * (1.0 + tp_pct / 100.0)
            else:
                outcome = "SL"
                pnl_gross = -position_size * (sl_pct / 100.0)
                exit_price = entry_price * (1.0 - sl_pct / 100.0)
            pnl_net = pnl_gross - commission_cost - slippage_cost
            capital += pnl_net

        capital_after = capital

        chart_start_s = meta["chart_start_date"].strftime("%Y-%m-%d")
        chart_end_s = meta["chart_end_date"].strftime("%Y-%m-%d")

        event = {
            "event_index": i + 1,
            "filename": fn,
            "symbol": meta["symbol"],
            "chart_start_date": chart_start_s,
            "chart_end_date": chart_end_s,
            "actual_label": actual,
            "predicted_label": pred_label,
            "confidence": conf,
            "trade_taken": trade_taken,
            "outcome": outcome,
            "capital_before": float(capital_before),
            "capital_after": float(capital_after),
            "position_size": float(position_size),
            "entry_price": float(entry_price),
            "exit_price": float(exit_price),
            "pnl_gross": float(pnl_gross),
            "commission": float(commission_cost),
            "slippage": float(slippage_cost),
            "pnl_net": float(pnl_net),
        }
        chart_events.append(event)

        if trade_taken:
            executed_trades.append(
                {
                    "trade_id": len(executed_trades) + 1,
                    "entry_price": float(entry_price),
                    "exit_price": float(exit_price),
                    "prediction": pred_label,
                    "actual": actual,
                    "confidence": conf,
                    "outcome": outcome,
                    "pnl_gross": float(pnl_gross),
                    "commission": float(commission_cost),
                    "slippage": float(slippage_cost),
                    "pnl_net": float(pnl_net),
                    "capital_after": float(capital_after),
                    "filename": fn,
                }
            )

            current_drawdown = starting - capital
            if current_drawdown > (starting * args.max_drawdown_pct / 100.0):
                print(f"Max drawdown limit ({args.max_drawdown_pct}%) reached. Stopping after this chart.")
                break

    total_charts_analyzed = len(chart_events)
    total_trades = sum(1 for e in chart_events if e["trade_taken"])
    winning_trades = sum(1 for e in chart_events if e["outcome"] == "TP")
    losing_trades = sum(1 for e in chart_events if e["outcome"] == "SL")
    no_trade_count = sum(1 for e in chart_events if e["outcome"] == "NO_TRADE")

    total_pnl = float(sum(e["pnl_net"] for e in chart_events if e["trade_taken"]))
    final_capital = float(chart_events[-1]["capital_after"]) if chart_events else starting
    return_pct = float((final_capital - starting) / starting * 100.0) if starting > 1e-12 else 0.0

    capital_history = [starting] + [float(e["capital_after"]) for e in chart_events]
    max_dd_abs, max_dd_pct = max_drawdown_vs_initial(capital_history, starting)

    win_rate = (winning_trades / total_trades) if total_trades > 0 else 0.0
    trade_frequency = (total_trades / total_charts_analyzed) if total_charts_analyzed > 0 else 0.0
    no_trade_rate = (no_trade_count / total_charts_analyzed) if total_charts_analyzed > 0 else 0.0

    exec_pnls = [e["pnl_net"] for e in chart_events if e["trade_taken"]]
    avg_win = (
        float(np.mean([p for p in exec_pnls if p > 0]))
        if any(p > 0 for p in exec_pnls)
        else 0.0
    )
    avg_loss = (
        float(abs(np.mean([p for p in exec_pnls if p < 0])))
        if any(p < 0 for p in exec_pnls)
        else 0.0
    )

    profit_factor = compute_profit_factor(executed_trades) if executed_trades else None

    exec_simple_rets = []
    for e in chart_events:
        if e["trade_taken"] and e["capital_before"] > 1e-12:
            exec_simple_rets.append((e["capital_after"] - e["capital_before"]) / e["capital_before"])
    exec_rets_arr = np.array(exec_simple_rets, dtype=float)
    sharpe_sample, sharpe_annual_hint = compute_sharpe_equity_returns(exec_rets_arr, total_trades)

    avg_confidence_trades = (
        float(np.mean([e["confidence"] for e in chart_events if e["trade_taken"]]))
        if total_trades > 0
        else 0.0
    )

    metrics = {
        "total_charts_analyzed": total_charts_analyzed,
        "total_trades": total_trades,
        "winning_trades": winning_trades,
        "losing_trades": losing_trades,
        "no_trade_count": no_trade_count,
        "trade_frequency": float(trade_frequency),
        "no_trade_rate": float(no_trade_rate),
        "win_rate": float(win_rate),
        "total_pnl": total_pnl,
        "final_capital": final_capital,
        "return_pct": return_pct,
        "max_drawdown": float(max_dd_abs),
        "max_drawdown_pct": float(max_dd_pct),
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "profit_factor": profit_factor,
        "sharpe_ratio": sharpe_sample,
        "sharpe_ratio_annualized_hint": sharpe_annual_hint,
        "metrics_insufficient_sample": total_trades < MIN_TRADES_SHARPE,
        "avg_confidence": avg_confidence_trades,
        "avg_confidence_all_images": avg_confidence_all,
        "confidence_threshold": float(confidence_threshold),
        "tp_pct": float(tp_pct),
        "sl_pct": float(sl_pct),
        "model_accuracy": float(accuracy),
        "model_precision": float(precision),
        "model_recall": float(recall),
        "model_f1": float(f1),
        "capital_history": capital_history,
        "threshold_sweep": build_threshold_sweep(prob_long, y, tp_pct, sl_pct, args),
    }

    return chart_events, executed_trades, metrics


def generate_charts(
    capital_history,
    chart_events,
    executed_trades,
    metrics,
    output_dir,
    starting_capital,
    benchmark_bundle=None,
):
    """Generate performance charts from full per-chart equity path (smoothed lines; benchmarks indexed)."""
    output_dir = Path(output_dir)
    charts_dir = output_dir / "charts"
    charts_dir.mkdir(exist_ok=True)

    charts_generated = {}
    benchmark_bundle = benchmark_bundle or {}
    starting = float(starting_capital)

    if capital_history and len(capital_history) > 1:
        xs = np.arange(len(capital_history), dtype=float)
        win = min(7, max(3, len(capital_history) // 4 | 1))
        plt.figure(figsize=(12, 6))
        if benchmark_bundle.get("ok"):
            strat = np.array(
                [(float(capital_history[i]) / starting) * 100.0 for i in range(len(capital_history))],
                dtype=float,
            )
            spy = np.array(benchmark_bundle["spy_indexed"], dtype=float)
            und = np.array(benchmark_bundle["underlying_indexed"], dtype=float)
            plt.plot(xs, _smooth_ma(strat, win), linewidth=2.4, color="#3B82F6", label="Strategy (indexed)")
            plt.plot(xs, _smooth_ma(spy, win), linewidth=2.0, color="#F59E0B", label="SPY (indexed)", alpha=0.9)
            if np.isfinite(und).any():
                plt.plot(xs, _smooth_ma(und, win), linewidth=2.0, color="#10B981", label="Underlying (indexed)", alpha=0.9)
            plt.axhline(y=100.0, color="red", linestyle="--", alpha=0.45, linewidth=1, label="Start = 100")
            plt.ylabel("Indexed (start = 100)")
            plt.title("Equity vs SPY & underlying (indexed)", fontsize=14, fontweight="bold")
        else:
            ch = np.array(capital_history, dtype=float)
            plt.plot(xs, _smooth_ma(ch, win), linewidth=2.4, color="#3B82F6", label="Equity ($)")
            plt.ylabel("Equity ($)")
            plt.title("Equity curve (per chart)", fontsize=14, fontweight="bold")
            min_cap, max_cap = float(np.min(ch)), float(np.max(ch))
            pad = 1.0 if min_cap == max_cap else (max_cap - min_cap) * 0.005
            plt.ylim(min_cap - pad, max_cap + pad)
            plt.axhline(y=starting, color="red", linestyle="--", alpha=0.5, label="Starting capital")
        plt.xlabel("Chart step #")
        plt.grid(True, alpha=0.3)
        plt.legend(loc="best", framealpha=0.92)
        plt.tight_layout()
        equity_path = charts_dir / "equity_curve.png"
        plt.savefig(equity_path, dpi=150, bbox_inches="tight")
        plt.close()
        charts_generated["equity_curve"] = str(equity_path)

    if executed_trades:
        pnls = [t["pnl_net"] for t in executed_trades]
        plt.figure(figsize=(10, 6))
        plt.hist(pnls, bins=max(10, len(pnls) // 5), alpha=0.7, color="#10B981", edgecolor="white")
        plt.axvline(x=0, color="red", linestyle="--", alpha=0.7, linewidth=2)
        plt.axvline(x=np.mean(pnls), color="blue", linestyle="-", alpha=0.7, linewidth=2, label=f"Mean: ${np.mean(pnls):.2f}")
        plt.title("Trade P&L Distribution (executed only)", fontsize=14, fontweight="bold")
        plt.xlabel("Trade P&L ($)")
        plt.ylabel("Count")
        plt.grid(True, alpha=0.3)
        plt.legend()
        plt.tight_layout()
        pnl_path = charts_dir / "pnl_distribution.png"
        plt.savefig(pnl_path, dpi=150, bbox_inches="tight")
        plt.close()
        charts_generated["pnl_distribution"] = str(pnl_path)

    if capital_history and len(capital_history) > 1:
        drawdowns = []
        for eq in capital_history:
            eq = float(eq)
            if starting < 1e-12:
                dd = 0.0
            elif eq >= starting:
                dd = 0.0
            else:
                dd = (starting - eq) / starting * 100.0
            drawdowns.append(dd)
        win_d = min(7, max(3, len(drawdowns) // 4 | 1))
        plt.figure(figsize=(10, 6))
        plt.plot(
            np.arange(len(drawdowns)),
            _smooth_ma(np.array(drawdowns, dtype=float), win_d),
            color="#EF4444",
            linewidth=2.2,
        )
        plt.title("Drawdown vs starting capital (%)", fontsize=14, fontweight="bold")
        plt.xlabel("Chart step #")
        plt.ylabel("Drawdown (%)")
        plt.grid(True, alpha=0.3)
        plt.tight_layout()
        drawdown_path = charts_dir / "drawdown.png"
        plt.savefig(drawdown_path, dpi=150, bbox_inches="tight")
        plt.close()
        charts_generated["drawdown"] = str(drawdown_path)

    # Create comprehensive metrics dashboard
    fig, axes = plt.subplots(3, 3, figsize=(15, 12))
    fig.suptitle('Backtest Performance Dashboard', fontsize=16, fontweight='bold')

    # Row 1: Basic metrics
    axes[0,0].bar(['Win Rate'], [metrics['win_rate'] * 100], color='#10B981', alpha=0.7)
    axes[0,0].set_ylabel('Percentage (%)')
    axes[0,0].set_title('Win Rate')
    axes[0,0].set_ylim(0, 100)

    axes[0,1].bar(['Total P&L'], [metrics['total_pnl']], color='#3B82F6' if metrics['total_pnl'] >= 0 else '#EF4444', alpha=0.7)
    axes[0,1].set_ylabel('Amount ($)')
    axes[0,1].set_title('Total P&L')

    axes[0,2].bar(['Return %'], [metrics['return_pct']], color='#10B981' if metrics['return_pct'] >= 0 else '#EF4444', alpha=0.7)
    axes[0,2].set_ylabel('Percentage (%)')
    axes[0,2].set_title('Total Return %')

    # Row 2: Risk metrics
    axes[1,0].bar(['Max Drawdown'], [metrics['max_drawdown']], color='#EF4444', alpha=0.7)
    axes[1,0].set_ylabel('Amount ($)')
    axes[1,0].set_title('Max DD vs start')

    pf_disp = metrics.get("profit_factor")
    if pf_disp is None or not np.isfinite(pf_disp):
        axes[1,1].bar(['Profit Factor'], [0], color='#8B5CF6', alpha=0.7)
        axes[1,1].set_title('Profit Factor (n/a)')
    else:
        axes[1,1].bar(['Profit Factor'], [min(float(pf_disp), 5)], color='#8B5CF6', alpha=0.7)
        axes[1,1].set_title('Profit Factor')
        if float(pf_disp) > 5:
            axes[1,1].text(0, 4.5, f'>{5:.1f}', ha='center', va='bottom', fontweight='bold')
    axes[1,1].set_ylabel('Ratio')

    axes[1,2].bar(['Trades'], [metrics['total_trades']], color='#F59E0B', alpha=0.7)
    axes[1,2].set_ylabel('Count')
    axes[1,2].set_title('Total Trades')

    # Row 3: Additional metrics
    axes[2,0].bar(['Avg Win'], [metrics['avg_win']], color='#10B981', alpha=0.7)
    axes[2,0].set_ylabel('Amount ($)')
    axes[2,0].set_title('Average Win')

    axes[2,1].bar(['Avg Loss'], [metrics['avg_loss']], color='#EF4444', alpha=0.7)
    axes[2,1].set_ylabel('Amount ($)')
    axes[2,1].set_title('Average Loss')

    sr = metrics.get("sharpe_ratio")
    sr_plot = float(sr) if sr is not None and np.isfinite(sr) else 0.0
    axes[2,2].bar(['Sharpe Ratio'], [sr_plot], color='#06B6D4', alpha=0.7)
    axes[2,2].set_ylabel('Ratio')
    axes[2,2].set_title('Sharpe (executed trade returns)')

    plt.tight_layout()
    dashboard_path = charts_dir / 'performance_dashboard.png'
    plt.savefig(dashboard_path, dpi=150, bbox_inches='tight')
    plt.close()
    charts_generated["performance_dashboard"] = str(dashboard_path)

    return charts_generated

def main():
    try:
        args = parse_args()

        print("=" * 60)
        print("CNN Backtester - Starting Analysis")
        print("=" * 60)
        print(f"Model: {args.model_path}")
        print(f"Dataset: {args.dataset_path}")
        print(f"Sample size: {args.sample_size}")
        print(f"Confidence threshold: {args.confidence_threshold}")
        print(f"TP/SL: {args.tp_pct}% / {args.sl_pct}%")
        print(f"Output: {args.output_dir}")
        print()

        # Create output directory
        output_dir = Path(args.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        # Load model
        model = load_model(args.model_path)

        # Load dataset (chronological order; metas parallel to rows)
        X, y, filenames, metas = load_dataset_images(args.dataset_path, args.sample_size, args.img_size)

        chart_events, executed_trades, metrics = run_backtest(
            model, X, y, filenames, metas,
            args.confidence_threshold,
            args.tp_pct, args.sl_pct,
            args.output_dir, args
        )

        threshold_sweep = metrics.pop("threshold_sweep", [])
        capital_history = metrics.pop("capital_history")
        equity_series = build_full_equity_series(args.starting_capital, chart_events)
        drawdown_series = build_drawdown_series_vs_initial(capital_history, args.starting_capital)
        benchmark_bundle = fetch_spy_and_underlying_indexed(
            chart_events, capital_history, args.starting_capital
        )
        attach_benchmarks_to_equity_series(equity_series, args.starting_capital, benchmark_bundle)
        if benchmark_bundle.get("ok"):
            print(
                f"Benchmarks: SPY + underlying {benchmark_bundle.get('underlying_ticker') or 'n/a'} "
                f"({benchmark_bundle.get('phase_start')} → {benchmark_bundle.get('phase_end')})"
            )
        else:
            print(f"Benchmark fetch skipped: {benchmark_bundle.get('error')}")

        confidence_series = [
            {
                "step_index": k + 1,
                "trade_index": k + 1,
                "confidence": round(float(ev["confidence"]), 4),
            }
            for k, ev in enumerate(chart_events)
        ]

        charts = generate_charts(
            capital_history,
            chart_events,
            executed_trades,
            metrics,
            args.output_dir,
            args.starting_capital,
            benchmark_bundle,
        )

        # Save results in format expected by frontend
        results = {
            "timestamp": datetime.now().isoformat(),
            "config": {
                "model_path": args.model_path,
                "dataset_path": args.dataset_path,
                "sample_size": args.sample_size,
                "confidence_threshold": args.confidence_threshold,
                "tp_pct": args.tp_pct,
                "sl_pct": args.sl_pct,
                "img_size": args.img_size,
                "starting_capital": args.starting_capital,
                "position_size_pct": args.position_size_pct,
                "commission_pct": args.commission_pct,
                "slippage_pct": args.slippage_pct,
                "max_drawdown_pct": args.max_drawdown_pct
            },
            "kpis": {
                "trades": metrics["total_trades"],
                "total_charts_analyzed": metrics["total_charts_analyzed"],
                "no_trade_count": metrics["no_trade_count"],
                "trade_frequency": metrics["trade_frequency"],
                "no_trade_rate": metrics["no_trade_rate"],
                "pnl": metrics["total_pnl"],
                "return_pct": metrics["return_pct"],
                "win_rate": metrics["win_rate"] * 100,
                "profit_factor": metrics["profit_factor"],
                "sharpe_ratio": metrics["sharpe_ratio"],
                "sharpe_ratio_annualized_hint": metrics["sharpe_ratio_annualized_hint"],
                "metrics_insufficient_sample": metrics["metrics_insufficient_sample"],
                "max_drawdown": metrics["max_drawdown"],
                "max_drawdown_pct": metrics["max_drawdown_pct"],
                "avg_win": metrics["avg_win"],
                "avg_loss": metrics["avg_loss"],
                "sample_size": len(X),
                "starting_capital": args.starting_capital,
                "position_size_pct": args.position_size_pct,
                "commission_pct": args.commission_pct,
                "slippage_pct": args.slippage_pct,
                "strategy_max_drawdown_limit_pct": args.max_drawdown_pct,
                "avg_confidence_trades": metrics["avg_confidence"],
                "avg_confidence_all_images": metrics["avg_confidence_all_images"],
                # Image-level classification (not equivalent to trading edge)
                "accuracy": metrics["model_accuracy"] * 100,
                "precision": metrics["model_precision"] * 100,
                "recall": metrics["model_recall"] * 100,
                "model_accuracy": metrics["model_accuracy"] * 100,
                "model_precision": metrics["model_precision"] * 100,
                "model_recall": metrics["model_recall"] * 100,
                "model_f1": metrics["model_f1"] * 100,
            },
            "classification_metrics": {
                "description": "Per-image label agreement; independent of simulated trade P&L.",
                "accuracy": metrics["model_accuracy"],
                "precision": metrics["model_precision"],
                "recall": metrics["model_recall"],
                "f1": metrics["model_f1"],
            },
            "series": {
                "equity": equity_series,
                "drawdown_pct": drawdown_series,
                "confidence_by_trade": confidence_series,
                "threshold_sweep": threshold_sweep,
            },
            "benchmark": {
                "ok": bool(benchmark_bundle.get("ok")),
                "spy_ticker": "SPY",
                "underlying_symbol": benchmark_bundle.get("underlying_symbol"),
                "underlying_ticker": benchmark_bundle.get("underlying_ticker"),
                "phase_start": benchmark_bundle.get("phase_start"),
                "phase_end": benchmark_bundle.get("phase_end"),
                "error": benchmark_bundle.get("error"),
            },
            "trades": executed_trades[:500],
            "chart_events": chart_events,
            "charts": charts,
            "summary": {
                "total_images_processed": len(X),
                "charts_analyzed": len(chart_events),
                "trades_executed": len(executed_trades),
                "model_predictions": sum(1 for e in chart_events if e["predicted_label"] == 1),
                "avg_confidence": metrics["avg_confidence"],
                "avg_confidence_all_images": metrics["avg_confidence_all_images"],
            }
        }

        def _json_sanitize(obj):
            if isinstance(obj, float):
                if math.isnan(obj) or math.isinf(obj):
                    return None
                return obj
            if isinstance(obj, dict):
                return {k: _json_sanitize(v) for k, v in obj.items()}
            if isinstance(obj, list):
                return [_json_sanitize(x) for x in obj]
            return obj

        results = _json_sanitize(results)

        # Save JSON results
        with open(output_dir / "backtest_results.json", "w") as f:
            json.dump(results, f, indent=2, default=str)

        print("\n" + "=" * 60)
        print("BACKTEST COMPLETED SUCCESSFULLY")
        print("=" * 60)
        print(f"Charts analyzed: {metrics['total_charts_analyzed']}")
        print(f"Total trades (executed): {metrics['total_trades']}")
        print(f"Return %: {metrics['return_pct']:.2f}")
        print(f"Max drawdown vs start (abs): {metrics['max_drawdown']:.2f}")
        print(f"Max drawdown vs start (% of initial): {metrics['max_drawdown_pct']:.2f}%")
        print(f"Final capital: ${metrics['final_capital']:.2f}")
        print(f"Results saved to: {output_dir}")
        print("=" * 60)

        return 0

    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())