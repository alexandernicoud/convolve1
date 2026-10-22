"""Training session view for the Trainer UI.

Assembles everything the session page shows from durable sources (run directory files and
the pipeline_runs row) plus the live in-process state when this API process owns the run.
Values that were never recorded stay absent or null; nothing is estimated here except the
clearly named ``mean_epoch_seconds`` (a mean of measured epoch durations).
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Iterable, List, Optional

HISTORY_KEYS = (
    "loss",
    "accuracy",
    "val_loss",
    "val_accuracy",
    "label_1_recall",
    "val_label_1_recall",
)
VAL_KEYS = ("val_loss", "val_accuracy", "val_label_1_recall")
HISTORY_LIMIT = 2000

# UI stage per trainer phase. Only phases the runner actually emits are listed.
PHASE_STAGE = {
    "queued": "queued",
    "starting": "preparing",
    "loading": "preparing",
    "building": "initializing",
    "training": "training",
    "saving": "saving",
    "done": "completed",
    "completed": "completed",
    "cancelled": "cancelled",
    "canceled": "cancelled",
    "error": "failed",
}


def _num(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if out != out or out in (float("inf"), float("-inf")):
        return None
    return out


def normalize_history(rows: Iterable[Any], *, val_samples: Optional[int] = None) -> List[Dict[str, Any]]:
    """One row per epoch (last write wins), sorted, missing metrics as None.

    Older runs wrote 0 for absent validation metrics; when the run is known to have had no
    validation samples those zeros are not measurements and become None.
    """
    by_epoch: Dict[int, Dict[str, Any]] = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        epoch = row.get("epoch")
        try:
            epoch_i = int(epoch)
        except (TypeError, ValueError):
            continue
        if epoch_i < 1:
            continue
        out: Dict[str, Any] = {"epoch": epoch_i}
        epochs = row.get("epochs")
        if isinstance(epochs, (int, float)) and epochs > 0:
            out["epochs"] = int(epochs)
        for key in HISTORY_KEYS:
            out[key] = _num(row.get(key))
        ts = _num(row.get("timestamp"))
        if ts is not None:
            out["timestamp"] = ts
        if val_samples == 0:
            for key in VAL_KEYS:
                out[key] = None
        by_epoch[epoch_i] = out
    ordered = [by_epoch[k] for k in sorted(by_epoch)]
    return ordered[-HISTORY_LIMIT:]


def read_json(path: str) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def read_jsonl(path: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    parsed = json.loads(line)
                except ValueError:
                    continue  # a partially written last line during training
                if isinstance(parsed, dict):
                    rows.append(parsed)
    except OSError:
        return []
    return rows


def disk_history(run_dir: str) -> List[Dict[str, Any]]:
    """history.json once training ended, otherwise the per-epoch metrics.jsonl stream."""
    hist = read_json(os.path.join(run_dir, "history.json"))
    if isinstance(hist, list) and hist:
        return hist
    return read_jsonl(os.path.join(run_dir, "metrics.jsonl"))


def best_epoch(history: List[Dict[str, Any]]) -> Optional[int]:
    """Lowest val_loss, first occurrence (the epoch Keras EarlyStopping restores)."""
    best: Optional[int] = None
    best_value = float("inf")
    for row in history:
        value = row.get("val_loss")
        if value is None:
            continue
        if value < best_value:
            best_value = value
            best = int(row["epoch"])
    return best


def epoch_durations(history: List[Dict[str, Any]], data_ready_at: Optional[float]) -> List[float]:
    """Measured seconds per epoch from consecutive epoch-end timestamps."""
    stamps = [row.get("timestamp") for row in history if row.get("timestamp") is not None]
    out: List[float] = []
    prev = data_ready_at
    for ts in stamps:
        if prev is not None and ts > prev:
            out.append(ts - prev)
        prev = ts
    return out


def standard_architecture(image_size: Optional[List[int]]) -> Optional[Dict[str, Any]]:
    """Layer table of the fixed trainer CNN (runners/trainer_runner.py) for a given input size."""
    if not image_size or len(image_size) != 2:
        return None
    try:
        h, w = int(image_size[0]), int(image_size[1])
    except (TypeError, ValueError):
        return None
    layers: List[Dict[str, Any]] = [{"name": "Input", "shape": [h, w, 3], "params": 0}]
    channels = 3
    for filters in (32, 64, 128):
        h, w = h - 2, w - 2
        if h <= 0 or w <= 0:
            return None
        params = 3 * 3 * channels * filters + filters
        layers.append({"name": f"Conv2D 3×3 · {filters}", "shape": [h, w, filters], "params": params, "activation": "relu"})
        h, w = h // 2, w // 2
        layers.append({"name": "MaxPool 2×2", "shape": [h, w, filters], "params": 0})
        channels = filters
    flat = h * w * channels
    layers.append({"name": "Flatten", "shape": [flat], "params": 0})
    layers.append({"name": "Dense · 128", "shape": [128], "params": flat * 128 + 128, "activation": "relu"})
    layers.append({"name": "Dense · 1", "shape": [1], "params": 129, "activation": "sigmoid"})
    return {
        "family": "Convolve standard CNN",
        "layers": layers,
        "total_params": sum(layer["params"] for layer in layers),
        "loss": "binary_crossentropy",
        "optimizer": "adam (Keras default learning rate)",
        "early_stopping": {"monitor": "val_loss", "patience": 5, "restore_best_weights": True},
    }


def _dataset_block(meta: Dict[str, Any], dataset_summary: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if meta.get("dataset_id"):
        out["id"] = meta["dataset_id"]
    ds = dataset_summary or {}
    for src, dst in (("dataset_name", "name"), ("name", "name"), ("total_images", "image_count")):
        if ds.get(src) is not None and dst not in out:
            out[dst] = ds[src]
    if isinstance(ds.get("label_distribution"), dict):
        out["label_distribution"] = ds["label_distribution"]
    if meta.get("generator_run_id"):
        out["generator_run_id"] = meta["generator_run_id"]
    market: Dict[str, Any] = {}
    for key in ("symbols", "timeframe", "timespanUnit", "timespanCount", "useCandles", "horizonBars",
                "takeProfitFraction", "stopLossFraction", "training_period_start", "training_period_end"):
        if meta.get(key) is not None:
            market[key] = meta[key]
    if market:
        out["market"] = market
    return out


def _config_block(cfg: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
    standard = cfg.get("use_standard_config", True)
    out: Dict[str, Any] = {"use_standard_config": bool(standard)}
    if standard:
        out.update({"image_size": [224, 224], "batch_size": 16, "epochs": 30, "val_split": 0.2, "random_seed": 7})
    else:
        if cfg.get("image_height") and cfg.get("image_width"):
            out["image_size"] = [cfg["image_height"], cfg["image_width"]]
        for key in ("batch_size", "epochs", "val_split"):
            if cfg.get(key) is not None:
                out[key] = cfg[key]
        out["random_seed"] = cfg.get("random_seed", 7)
    for key in ("image_size", "batch_size", "epochs", "val_split", "random_seed"):
        if state.get(key) is not None:
            out[key] = state[key]
    return out


def build_session(
    run_id: str,
    run_dir: Optional[str],
    *,
    status: str,
    progress: Dict[str, Any],
    live_history: Optional[List[Dict[str, Any]]] = None,
    live_state: Optional[Dict[str, Any]] = None,
    row: Optional[Dict[str, Any]] = None,
    dataset_summary: Optional[Dict[str, Any]] = None,
    worker_active: Optional[bool] = None,
) -> Dict[str, Any]:
    """Session payload: identity, dataset, config, timing, full history, best epoch, summary."""
    run_dir = run_dir if run_dir and os.path.isdir(run_dir) else None
    meta = (read_json(os.path.join(run_dir, "model_metadata.json")) if run_dir else None) or {}
    summary = (read_json(os.path.join(run_dir, "summary.json")) if run_dir else None) or {}
    disk_state = (read_json(os.path.join(run_dir, "training_state.json")) if run_dir else None) or {}
    state: Dict[str, Any] = {**disk_state, **(live_state or {})}
    if not isinstance(meta, dict):
        meta = {}
    if not isinstance(summary, dict):
        summary = {}

    val_samples = summary.get("val_samples", state.get("val_samples"))
    raw = live_history if live_history else (disk_history(run_dir) if run_dir else [])
    history = normalize_history(raw, val_samples=val_samples if isinstance(val_samples, int) else None)

    cfg = meta.get("training_config") if isinstance(meta.get("training_config"), dict) else {}
    if not cfg and isinstance(summary.get("config"), dict):
        cfg = summary["config"]
    config = _config_block(cfg, state)

    phase = str(progress.get("phase") or "").lower()
    stage = PHASE_STAGE.get(phase)
    if status == "done":
        stage = "completed"
    elif status == "failed":
        stage = "failed"
    elif status == "cancelled":
        stage = "cancelled"
    elif stage is None:
        stage = "preparing" if status == "running" else status

    epochs_total = None
    if history and history[-1].get("epochs"):
        epochs_total = history[-1]["epochs"]
    elif progress.get("epochs"):
        epochs_total = progress.get("epochs")
    elif config.get("epochs"):
        epochs_total = config.get("epochs")

    best = best_epoch(history)
    by_epoch = {r["epoch"]: r for r in history}
    durations = epoch_durations(history, _num(state.get("data_ready_at")))

    started_at = (row or {}).get("created_at") or _num(meta.get("created_at"))
    finished_at = (row or {}).get("finished_at") or _num(summary.get("completed_at"))

    model_name = meta.get("model_name") or summary.get("model_name") or cfg.get("model_name")
    session: Dict[str, Any] = {
        "run_id": run_id,
        "stage": stage,
        "model_name": model_name,
        "dataset": _dataset_block(meta, dataset_summary),
        "config": config,
        "architecture": standard_architecture(config.get("image_size")),
        "train_samples": summary.get("train_samples", state.get("train_samples")),
        "val_samples": val_samples,
        "train_label_counts": state.get("train_label_counts"),
        "val_label_counts": state.get("val_label_counts"),
        "epochs_total": epochs_total,
        "epochs_completed": len(history),
        "history": history,
        "best_epoch": best,
        "best_metrics": by_epoch.get(best) if best else None,
        "mean_epoch_seconds": (sum(durations) / len(durations)) if durations else None,
        "started_at": started_at or None,
        "updated_at": (row or {}).get("updated_at") or None,
        "finished_at": finished_at or None,
        "error": None,
        "worker_active": worker_active,
    }
    if summary:
        session["summary"] = {
            k: summary.get(k)
            for k in (
                "epochs_configured",
                "epochs_trained",
                "stopped_early",
                "best_epoch",
                "saved_weights_epoch",
                "saved_weights_metrics",
                "summary_version",
                "completed_at",
            )
            if summary.get(k) is not None
        }
        if not summary.get("summary_version"):
            # v1 summaries: Keras 3 restores best val_loss weights at train end, so the saved
            # model corresponds to the best epoch measured from history (if validation existed).
            session["summary"]["saved_weights_epoch"] = best or (history[-1]["epoch"] if history else None)
            session["summary"]["saved_weights_inferred"] = True
    if stage == "failed":
        session["error"] = progress.get("message") or progress.get("error") or (row or {}).get("error_summary")
    return session
