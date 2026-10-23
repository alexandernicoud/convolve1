"""
End-to-end v2 backtest: verify dataset -> predict -> audit -> threshold -> simulate -> metrics,
benchmarks, robustness, findings -> versioned artifacts in ``output_dir``.

Artifacts (all relative to output_dir):
  predictions.csv       every test sample with raw P(label 1), label, purge flag
  trades.csv            executed trades (closed and open-at-end)
  skipped_entries.csv   candidate entries that were not executed, with reason
  equity_daily.csv      cash / positions / equity / exposure / costs / drawdown per trading day
  benchmarks_daily.csv  aligned benchmark values on the same calendar
  backtest_results.json methodology, lineage, configuration, metrics, audit, findings
"""

from __future__ import annotations

import csv
import json
import math
import os
import re
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import numpy as np
import pandas as pd

from app.services import dataset_provenance as dp
from app.services import leakage_audit as la
from app.services import trade_outcomes as to
from . import benchmarks as bm
from . import findings as fd
from . import metrics as mt
from . import thresholds as th
from .simulation import ENGINE_VERSION, METHODOLOGY_ID, METHODOLOGY_VERSION, Signal, SimConfig, simulate

RESULTS_SCHEMA_VERSION = 2
_LABEL_RE = re.compile(r"_label(\d)\.png$")


class BacktestInputError(RuntimeError):
    """Inputs cannot support a valid v2 simulation; message is user-facing."""


def _progress(cb: Optional[Callable[[float, str], None]], p: float, msg: str) -> None:
    if cb:
        cb(p, msg)


def _write_csv(path: Path, rows: List[Dict[str, Any]], columns: List[str]) -> None:
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r.get(k) is None else (";".join(r[k]) if isinstance(r.get(k), list) else r[k])) for k in columns})


def _json_safe(o: Any) -> Any:
    if isinstance(o, dict):
        return {str(k): _json_safe(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_json_safe(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating, float)):
        f = float(o)
        return f if math.isfinite(f) else None
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, pd.Timestamp):
        return o.isoformat()
    return o


TRADE_COLUMNS = [
    "sample_id", "symbol", "prob", "label", "decision_ts", "entry_ts", "entry_open", "entry_fill", "shares",
    "notional", "tp_price", "sl_price", "status", "exit_ts", "exit_reason", "exit_price", "exit_fill", "bars_held",
    "holding_days", "gross_return", "commission", "slippage_cost", "costs", "net_pnl", "net_return", "mark_price",
    "unrealized_pnl", "stale_marks", "flags",
]
EQUITY_COLUMNS = [
    "date", "cash", "positions_value", "equity", "gross_exposure", "n_positions", "entries", "realized_pnl",
    "unrealized_pnl", "commission_cum", "slippage_cum", "costs_cum", "drawdown", "stale_marks",
]


def run(config: Dict[str, Any], progress: Optional[Callable[[float, str], None]] = None, model: Any = None) -> Dict[str, Any]:
    t0 = time.time()
    out_dir = Path(config["output_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    dataset_dir = Path(config["dataset_dir"])
    images_dir = dataset_dir / "images"
    warnings: List[str] = []

    # 1. Dataset provenance -----------------------------------------------------------------------
    _progress(progress, 0.05, "Verifying dataset provenance")
    meta = dp.load_provenance(dataset_dir)
    if not meta:
        raise BacktestInputError("Dataset has no stored provenance or market data; regenerate it to run a price-based backtest.")
    manifest_path = dp.provenance_dir(dataset_dir) / "dataset_manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.is_file() else {}
    fingerprint = dp.dataset_fingerprint(images_dir)
    if manifest.get("fingerprint") and manifest["fingerprint"] != fingerprint:
        raise BacktestInputError("Dataset images changed after registration (fingerprint mismatch); results would not be reproducible.")
    if meta.get("label_method") != to.LABEL_METHOD_V2:
        raise BacktestInputError(f"Unsupported label method {meta.get('label_method')!r}.")
    oc = meta.get("outcome") or {}
    spec = to.OutcomeSpec(horizon_bars=int(oc["horizon_bars"]), tp_frac=float(oc["tp_frac"]), sl_frac=float(oc["sl_frac"]),
                          timeframe=str(oc.get("timeframe") or meta.get("timeframe") or "1d"))
    timeframe = spec.timeframe

    samples = {s["image_id"]: s for s in dp.load_samples(dataset_dir)}
    present = sorted(p.name for p in images_dir.glob("*.png") if not p.name.startswith("._"))
    usable = [n for n in present if n in samples]
    if len(usable) < len(present):
        warnings.append(f"{len(present) - len(usable)} image(s) have no provenance record and are excluded.")
    if not usable:
        raise BacktestInputError("No dataset image has a provenance record.")
    usable.sort(key=lambda n: (samples[n]["decision_ts"], samples[n]["symbol"], n))

    bars: Dict[str, pd.DataFrame] = {}
    for sym in dp.iter_symbols(meta):
        df = dp.load_ohlcv(dataset_dir, sym)
        if df is not None:
            bars[sym] = df
    sample_syms = sorted({samples[n]["symbol"] for n in usable})
    missing_syms = [s for s in sample_syms if s not in bars]
    if missing_syms:
        raise BacktestInputError(f"Stored market data missing for: {', '.join(missing_syms)}")

    # Stored outcomes must reproduce from stored bars.
    mismatches = 0
    for n in usable:
        s = samples[n]
        o = to.resolve_outcome(bars[s["symbol"]], pd.Timestamp(s["decision_ts"]), spec)
        if to.label_for_method(o, to.LABEL_METHOD_V2) != s.get("label"):
            mismatches += 1
    if mismatches:
        raise BacktestInputError(f"{mismatches} stored label(s) do not reproduce from stored bars.")

    # 2. Predictions ------------------------------------------------------------------------------
    _progress(progress, 0.15, "Loading model")
    from app.services import cnn_inference as ci

    if model is None:
        import keras

        model = keras.models.load_model(config["model_path"], compile=False)
    io = ci.model_io(model)
    paths = [str(images_dir / n) for n in usable]
    probs: List[np.ndarray] = []
    for done, p in ci.iter_predictions(model, paths, batch_size=int(config.get("batch_size", 32)), io=io):
        probs.append(p)
        _progress(progress, 0.15 + 0.35 * done / len(paths), f"Predicting {done}/{len(paths)}")
    prob = np.concatenate(probs)

    # 3. Threshold --------------------------------------------------------------------------------
    _progress(progress, 0.52, "Selecting threshold")
    threshold_info: Dict[str, Any]
    mode = config.get("threshold_mode", "fixed")
    if mode == "validation":
        val = _validation_threshold(config, model, io, ci)
        if val.get("threshold") is None:
            raise BacktestInputError("Validation threshold unavailable: " + str(val.get("unavailable")))
        threshold_info = {"value": val["threshold"], "source": la.THRESHOLD_VALIDATION_LOCKED, "selection": val}
    else:
        threshold_info = {"value": float(config["confidence_threshold"]), "source": la.THRESHOLD_USER_FIXED,
                          "note": "Entered by the user; not selected on validation data."}
    thr = float(threshold_info["value"])

    # 4. Leakage audit ----------------------------------------------------------------------------
    _progress(progress, 0.56, "Auditing information availability")
    tr_meta = _read_json(config.get("training_metadata_path"))
    tr_images = Path(config["training_images_dir"]) if config.get("training_images_dir") else None
    training = la.training_side_from_metadata(tr_meta, tr_images, threshold_info["source"])
    audit = la.run_audit(
        test_dataset_id=config.get("dataset_id"),
        test_samples=[samples[n] for n in usable],
        test_image_names=usable,
        training=training,
        test_bars=bars,
        embargo_bars=int(config.get("embargo_bars", 0)),
        prior_runs_same_pair=int(config.get("prior_runs_same_pair", 0)),
        allow_reuse_override=bool(config.get("allow_reuse_override", False)),
    )
    if audit["blocked"]:
        _write_json(out_dir / "leakage_audit.json", audit)
        raise BacktestInputError("Evaluation blocked by the leakage audit: " + " ".join(audit["blocking_reasons"]))
    purged = set(audit["purged_sample_ids"])

    # 5. Simulation -------------------------------------------------------------------------------
    _progress(progress, 0.62, "Simulating portfolio")
    sim_cfg = SimConfig(
        starting_capital=float(config.get("starting_capital", 10_000)),
        position_size_pct=float(config.get("position_size_pct", 10)),
        max_exposure_pct=float(config.get("max_exposure_pct", 100)),
        max_concurrent_positions=int(config.get("max_concurrent_positions", 10)),
        max_trades_per_day=int(config["max_trades_per_day"]) if config.get("max_trades_per_day") else None,
        commission_pct=float(config.get("commission_pct", 0.1)),
        slippage_pct=float(config.get("slippage_pct", 0.05)),
        drawdown_halt_pct=float(config["max_drawdown_pct"]) if config.get("max_drawdown_pct") else None,
    )
    signals = [Signal(n, samples[n]["symbol"], pd.Timestamp(samples[n]["decision_ts"]), float(prob[i]), samples[n].get("label"))
               for i, n in enumerate(usable)]
    start = min(s.decision_ts for s in signals)
    res = simulate(signals, bars, spec, sim_cfg, threshold=thr, start_date=start, purged=purged)
    acct = res.diagnostics["accounting"]
    if not (acct["identity_equity_eq_cash_plus_positions"] and acct["daily_reconciliation_ok"] and acct["pnl_reconciliation_ok"]):
        raise RuntimeError(f"Accounting check failed: {acct}")

    def sim_summary(r) -> Dict[str, Any]:
        e = r.equity
        tot = float(e["equity"].iloc[-1] / sim_cfg.starting_capital - 1) if len(e) else None
        return {"total_return": tot, "executed_trades": len(r.trades),
                "max_drawdown": float(e["drawdown"].max()) if len(e) else None}

    # 6. Metrics, benchmarks ----------------------------------------------------------------------
    _progress(progress, 0.70, "Computing metrics")
    tm = mt.trading_metrics(res.equity, res.trades, sim_cfg.starting_capital, timeframe)
    keep = [i for i, n in enumerate(usable) if n not in purged and samples[n].get("label") is not None]
    cm = mt.classification_metrics([samples[usable[i]]["label"] for i in keep], [float(prob[i]) for i in keep], thr)
    cm["purged_excluded"] = len(purged)
    dates = res.equity["date"].tolist()
    bench = bm.compute_benchmarks(bars, sample_syms, dates, sim_cfg.starting_capital, sim_cfg.commission_pct,
                                  sim_cfg.slippage_pct, (tm.get("avg_exposure") or {}).get("value"), timeframe)

    # 7. Robustness + sweep (re-simulations on the same signals) ---------------------------------
    _progress(progress, 0.78, "Robustness analysis")
    rob = _robustness(res, signals, bars, spec, sim_cfg, thr, start, purged, timeframe, sim_summary)
    _progress(progress, 0.88, "Threshold sensitivity (in-sample)")
    sweep = th.sensitivity_sweep(
        lambda t: sim_summary(simulate(signals, bars, spec, sim_cfg, threshold=t, start_date=start, purged=purged)),
        [s.label if s.sample_id not in purged else None for s in signals], [s.prob for s in signals], thr,
    )

    # 8. Artifacts --------------------------------------------------------------------------------
    _progress(progress, 0.94, "Saving results")
    pred_rows = [{
        "sample_id": n, "symbol": samples[n]["symbol"], "decision_ts": samples[n]["decision_ts"],
        "earliest_entry_ts": samples[n].get("earliest_entry_ts"), "prob": float(prob[i]),
        "label": samples[n].get("label"), "signal": int(prob[i] >= thr), "purged": int(n in purged),
    } for i, n in enumerate(usable)]
    _write_csv(out_dir / "predictions.csv", pred_rows, list(pred_rows[0].keys()))
    _write_csv(out_dir / "trades.csv", res.trades, TRADE_COLUMNS)
    _write_csv(out_dir / "skipped_entries.csv", res.skipped, ["sample_id", "symbol", "entry_ts", "prob", "reason", "detail"])
    res.equity.to_csv(out_dir / "equity_daily.csv", index=False, columns=EQUITY_COLUMNS, float_format="%.10g")
    pd.DataFrame(bench["series"]).to_csv(out_dir / "benchmarks_daily.csv", index=False, float_format="%.10g")

    results: Dict[str, Any] = {
        "schema_version": RESULTS_SCHEMA_VERSION,
        "methodology": {
            "id": METHODOLOGY_ID, "version": METHODOLOGY_VERSION, "engine_version": ENGINE_VERSION,
            "label": "Price-based portfolio simulation on stored OHLC bars",
            "outcome_convention": to.OUTCOME_CONVENTION, "outcome_spec": spec.as_dict(),
            "execution": (
                "Decision at the chart's last close; entry at the next bar's open plus slippage; exits by TP/SL/timeout "
                "on stored bars (SL first when both touch one bar; gap through the stop fills at the open); "
                "marked to market at each close."
            ),
            "limitations": [
                "OHLC bars do not reveal intrabar order; same-bar TP/SL is resolved stop-first.",
                "Costs are a flat percentage per side; no spread, borrow, market-impact or partial-fill model.",
                "Fractional shares are allowed; no lot sizes or minimum order sizes.",
                "Calendar is the union of stored bars; no external exchange calendar is applied.",
                "Prices are split- and dividend-adjusted (yfinance auto_adjust); dividends are not paid separately.",
            ],
        },
        "created_at": time.time(),
        "duration_s": round(time.time() - t0, 2),
        "model": {**(config.get("model_ref") or {}), "io": io.as_dict()},
        "dataset": {
            "dataset_id": config.get("dataset_id"), "fingerprint": fingerprint, "label_method": meta.get("label_method"),
            "price_adjustment": meta.get("price_adjustment"), "data_source": meta.get("data_source"),
            "timeframe": timeframe, "symbols": sample_syms, "n_images": len(present), "n_samples_used": len(usable),
            "market_data": {s: {k: v for k, v in (meta.get("market_data") or {}).get(s, {}).items() if k != "file"} for s in bars},
            "first_decision": signals[0].decision_ts.isoformat(), "last_decision": signals[-1].decision_ts.isoformat(),
        },
        "config": sim_cfg.as_dict(),
        "threshold": threshold_info,
        "evaluation_class": audit["evaluation_class"],
        "leakage_audit": audit,
        "trading_metrics": tm,
        "classification_metrics": cm,
        "benchmarks": {k: v for k, v in bench.items() if k != "series"},
        "robustness": rob,
        "threshold_sweep": sweep,
        "diagnostics": res.diagnostics,
        "warnings": warnings,
        "artifacts": ["predictions.csv", "trades.csv", "skipped_entries.csv", "equity_daily.csv", "benchmarks_daily.csv"],
    }
    results["findings"] = fd.build_findings(results)
    results = _json_safe(results)
    _write_json(out_dir / "backtest_results.json", results)
    _progress(progress, 1.0, "Backtest completed successfully")
    return results


def _robustness(res, signals, bars, spec, cfg: SimConfig, thr, start, purged, timeframe, summarize) -> Dict[str, Any]:
    closed = [t for t in res.trades if t["status"] == "closed"]
    out: Dict[str, Any] = {"min_group_size": 10}

    def group(key: Callable[[Dict[str, Any]], str]) -> List[Dict[str, Any]]:
        g: Dict[str, List[Dict[str, Any]]] = {}
        for t in closed:
            g.setdefault(key(t), []).append(t)
        rows = []
        for k in sorted(g):
            ts = g[k]
            net = [t["net_pnl"] for t in ts]
            wins = sum(1 for v in net if v > 0)
            rows.append({"group": k, "n": len(ts), "net_pnl": float(sum(net)), "mean_net_return": float(np.mean([t["net_return"] for t in ts])),
                         "win_rate": wins / len(ts), "win_rate_ci95": mt.wilson(wins, len(ts)), "unstable": len(ts) < 10})
        return rows

    out["by_quarter"] = group(lambda t: f"{t['exit_ts'][:4]}-Q{(int(t['exit_ts'][5:7]) - 1) // 3 + 1}")
    out["by_year"] = group(lambda t: t["exit_ts"][:4])
    out["by_symbol"] = group(lambda t: t["symbol"])
    out["by_probability"] = group(lambda t: f"{math.floor(t['prob'] * 10) / 10:.1f}–{math.floor(t['prob'] * 10) / 10 + 0.1:.1f}")

    pos = sorted((t["net_pnl"] for t in closed), reverse=True)
    total = sum(pos)
    out["concentration"] = {"top3_share_of_net": (sum(pos[:3]) / total) if (total > 0 and len(pos) >= 3) else None,
                            "n": len(pos)}

    def rerun(**kw) -> Dict[str, Any]:
        c = SimConfig(**{**cfg.__dict__, **kw})
        return summarize(simulate(signals, bars, spec, c, threshold=thr, start_date=start, purged=purged))

    out["slippage_sensitivity"] = [{"multiplier": m, "slippage_pct": cfg.slippage_pct * m, **rerun(slippage_pct=cfg.slippage_pct * m)} for m in (0, 1, 2, 4)]
    out["commission_sensitivity"] = [{"multiplier": m, "commission_pct": cfg.commission_pct * m, **rerun(commission_pct=cfg.commission_pct * m)} for m in (0, 1, 2, 4)]
    r = mt.periodic_returns(res.equity["equity"].to_numpy()) if len(res.equity) else np.zeros(0)
    out["bootstrap"] = mt.block_bootstrap(r, block=max(5, spec.horizon_bars), ppy=mt.PERIODS_PER_YEAR.get(timeframe, 252))
    return out


def _validation_threshold(config: Dict[str, Any], model, io, ci) -> Dict[str, Any]:
    state = _read_json(config.get("training_state_path")) or {}
    val_files = state.get("val_files")
    tr_dir = config.get("training_images_dir")
    if not isinstance(val_files, list) or not val_files or not tr_dir:
        return {"threshold": None, "unavailable": "the model's recorded validation files are not available"}
    root = Path(tr_dir)
    index = {p.name: p for p in root.rglob("*.png")}
    paths, labels = [], []
    for name in sorted(val_files):
        m = _LABEL_RE.search(name)
        if name in index and m:
            paths.append(str(index[name]))
            labels.append(int(m.group(1)))
    if len(paths) < len(val_files):
        return {"threshold": None, "unavailable": f"only {len(paths)} of {len(val_files)} validation images found"}
    probs = ci.predict_paths(model, paths, batch_size=32)
    sel = th.select_on_validation(labels, probs)
    sel["source"] = "training_state.json val_files (recorded by the trainer)"
    sel["caveats"] = [
        "The validation split was also used for early stopping / checkpoint selection during training.",
        "Validation labels use the training generator's label method (incomplete horizons labelled 0).",
    ]
    return sel


def _read_json(path: Optional[str]) -> Optional[Dict[str, Any]]:
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else None
    except (OSError, ValueError):
        return None


def _write_json(path: Path, obj: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w") as f:
        json.dump(_json_safe(obj), f, indent=2)
    os.replace(tmp, path)
