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
    # Trainer protocol 2 (absent in older runs).
    "auc",
    "pr_auc",
    "balanced_accuracy",
    "val_auc",
    "val_pr_auc",
    "val_balanced_accuracy",
    "val_precision",
    "val_recall",
    "val_f1",
    "learning_rate",
)
VAL_KEYS = tuple(k for k in HISTORY_KEYS if k.startswith("val_"))
# Recorded with each saved run; protocol 1 runs selected on val_loss.
SELECTION_MODES = {"val_loss": "min"}
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


def best_epoch(history: List[Dict[str, Any]], monitor: str = "val_loss", mode: str = "min") -> Optional[int]:
    """Best value of the run's selection metric, first occurrence (the epoch Keras
    EarlyStopping restores)."""
    best: Optional[int] = None
    best_value: Optional[float] = None
    for row in history:
        value = row.get(monitor)
        if value is None:
            continue
        if best_value is None or (value < best_value if mode == "min" else value > best_value):
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


def standard_architecture(
    image_size: Optional[List[int]],
    architecture: Optional[str] = None,
    *,
    model_layers: Optional[List[Dict[str, Any]]] = None,
    model_params: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """Layer table of the trained CNN (runners/cnn_architectures.py) for a given input size."""
    from runners.cnn_architectures import DEFAULT_ARCHITECTURE, ARCHITECTURES

    arch = ARCHITECTURES.get(architecture or DEFAULT_ARCHITECTURE)
    if arch is None or not image_size or len(image_size) != 2:
        return None
    try:
        h, w = int(image_size[0]), int(image_size[1])
    except (TypeError, ValueError):
        return None
    if arch.family == "builder":
        # Graph networks: the run summary has the measured layer table and parameter count.
        return {
            "id": arch.id,
            "family": arch.label,
            "stages": list(arch.stages),
            "layers": model_layers or None,
            "total_params": model_params,
            "loss": "binary_crossentropy",
        }
    layers: List[Dict[str, Any]] = [{"name": "Input", "shape": [h, w, 3], "params": 0}]
    channels = 3
    for filters, k in arch.conv_blocks:
        h, w = h - (k - 1), w - (k - 1)
        if h <= 0 or w <= 0:
            return None
        params = k * k * channels * filters + filters
        layers.append({"name": f"Conv2D {k}×{k} · {filters}", "shape": [h, w, filters], "params": params, "activation": "relu"})
        h, w = h // 2, w // 2
        layers.append({"name": "MaxPool 2×2", "shape": [h, w, filters], "params": 0})
        channels = filters
    flat = h * w * channels
    units = arch.dense_units
    layers.append({"name": "Flatten", "shape": [flat], "params": 0})
    layers.append({"name": f"Dense · {units}", "shape": [units], "params": flat * units + units, "activation": "relu"})
    layers.append({"name": "Dense · 1", "shape": [1], "params": units + 1, "activation": "sigmoid"})
    return {
        "id": arch.id,
        "family": "Convolve standard CNN" if arch.id == DEFAULT_ARCHITECTURE else arch.label,
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
    # Opt-in options; absent means the original architecture, random split and PNG pipeline.
    for key in ("architecture", "validation_method", "input_pipeline"):
        if cfg.get(key):
            out[key] = cfg[key]
    protocol = int(cfg.get("trainer_protocol") or 1)
    out["trainer_protocol"] = protocol
    if protocol >= 2:
        out.setdefault("validation_method", "chronological")
        for key in ("test_fraction", "evaluate_test", "label_horizon_bars", "label_timeframe", "label_horizon_source"):
            if cfg.get(key) is not None:
                out[key] = cfg[key]
    else:
        out.setdefault("validation_method", "random")
    return out


def timings_block(trainer: Optional[Dict[str, Any]], worker: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Measured wall time per phase, in run order. Phases that were not measured are omitted."""
    trainer = trainer if isinstance(trainer, dict) else {}
    worker = worker if isinstance(worker, dict) else {}
    stages = trainer.get("stages") if isinstance(trainer.get("stages"), dict) else {}
    if not stages and not worker:
        return None
    epochs = [e for e in trainer.get("epochs") or [] if isinstance(e, dict)]
    validation = sum(_num(e.get("val_seconds")) or 0.0 for e in epochs) if epochs else None
    fit = _num(stages.get("fit_seconds"))

    def total(*keys: str) -> Optional[float]:
        values = [_num(stages.get(k)) for k in keys]
        return sum(v for v in values if v is not None) if any(v is not None for v in values) else None

    raw = [
        ("waiting_for_machine", _num(worker.get("queue_to_claim_seconds"))),
        ("dataset_download", _num(worker.get("dataset_restore_seconds"))),
        ("framework_start", _num(worker.get("tensorflow_import_seconds")) or _num(stages.get("tf_import_seconds"))),
        ("data_preparation", total("scan_seconds", "split_seconds", "pipeline_build_seconds")),
        ("model_build", _num(stages.get("model_build_seconds"))),
        ("first_batch", _num(stages.get("first_batch_seconds"))),
        ("training", (fit - validation - (_num(stages.get("first_batch_seconds")) or 0.0)) if fit is not None and validation is not None else fit),
        ("validation", validation if fit is not None else None),
        ("model_save", _num(stages.get("model_save_seconds"))),
        ("upload", _num(worker.get("publish_seconds"))),
    ]
    phases = [{"key": key, "seconds": round(max(0.0, value), 2)} for key, value in raw if value is not None]
    return {
        "phases": phases,
        "measured_seconds": round(sum(p["seconds"] for p in phases), 2),
        "epochs_measured": len(epochs),
        "epoch_seconds_median": _num(trainer.get("epoch_seconds_median")),
        "train_images_per_second": _num(trainer.get("train_images_per_second")),
        "cpu_count": trainer.get("cpu_count"),
        "cpu_utilization": _num(trainer.get("cpu_utilization")),
        "peak_rss_mb": _num(trainer.get("peak_rss_mb")),
        "model_file_mb": _num(stages.get("model_file_mb")),
    }


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
    worker_timings: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Session payload: identity, dataset, config, timing, full history, best epoch, summary."""
    run_dir = run_dir if run_dir and os.path.isdir(run_dir) else None
    trainer_timings = (read_json(os.path.join(run_dir, "timings.json")) if run_dir else None) or progress.get("timings")
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

    stopping = summary.get("stopping") if isinstance(summary.get("stopping"), dict) else {}
    options = summary.get("options") if isinstance(summary.get("options"), dict) else None
    if options is None and cfg.get("trainer_protocol"):
        from runners.trainer_options import OptionsError, resolve

        try:
            options = resolve(cfg)
        except (OptionsError, ValueError, TypeError):
            options = None
    selection = stopping.get("monitor") or (options or {}).get("selection_metric") or cfg.get("selection_metric") or "val_loss"
    mode = stopping.get("mode") or ("min" if selection == "val_loss" else "max")
    best = best_epoch(history, selection, mode)
    by_epoch = {r["epoch"]: r for r in history}
    durations = epoch_durations(history, _num(state.get("data_ready_at")))

    started_at = (row or {}).get("created_at") or _num(meta.get("created_at"))
    finished_at = (row or {}).get("finished_at") or _num(summary.get("completed_at"))

    model_name = meta.get("model_name") or summary.get("model_name") or cfg.get("model_name")
    model_block = summary.get("model") if isinstance(summary.get("model"), dict) else None
    architecture = standard_architecture(
        config.get("image_size"),
        config.get("architecture"),
        model_layers=(model_block or {}).get("layers"),
        model_params=(model_block or {}).get("parameters"),
    )
    if architecture and options:
        architecture["optimizer"] = options.get("optimizer")
        architecture["lr_schedule"] = options.get("lr_schedule")
        architecture["regularization"] = options.get("regularization")
        architecture["early_stopping"] = {
            **(options.get("early_stopping") or {}),
            "monitor": selection,
            "restore_best_weights": True,
        }
        if model_block and model_block.get("parameters") is not None:
            architecture["total_params"] = model_block["parameters"]
    evaluation = read_json(os.path.join(run_dir, "evaluation.json")) if run_dir else None
    split = state.get("split") or ((summary.get("training_setup") or {}).get("split") if isinstance(summary.get("training_setup"), dict) else None)
    session: Dict[str, Any] = {
        "run_id": run_id,
        "stage": stage,
        "model_name": model_name,
        "dataset": _dataset_block(meta, dataset_summary),
        "config": config,
        "architecture": architecture,
        "trainer_protocol": config["trainer_protocol"],
        "options": options,
        "selection_metric": {"name": selection, "mode": mode},
        "train_samples": summary.get("train_samples", state.get("train_samples")),
        "val_samples": val_samples,
        "test_samples": summary.get("test_samples", state.get("test_samples")),
        "train_label_counts": state.get("train_label_counts"),
        "val_label_counts": state.get("val_label_counts"),
        "test_label_counts": state.get("test_label_counts"),
        "split": split if isinstance(split, dict) else None,
        "evaluation": evaluation if isinstance(evaluation, dict) else None,
        "stopping": stopping or None,
        "model": model_block,
        "reproducibility": summary.get("reproducibility") if isinstance(summary.get("reproducibility"), dict) else None,
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
        "timings": timings_block(trainer_timings, worker_timings),
        "live_epoch": None,
    }
    if stage == "training" and progress.get("batch") is not None:
        session["live_epoch"] = {
            k: progress.get(k) for k in ("epoch_in_progress", "epochs", "batch", "batches", "images_per_second", "elapsed_seconds", "validating")
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
    if isinstance(summary.get("training_setup"), dict):
        session["training_setup"] = summary["training_setup"]
    if stage == "failed":
        session["error"] = progress.get("message") or progress.get("error") or (row or {}).get("error_summary")
    return session
