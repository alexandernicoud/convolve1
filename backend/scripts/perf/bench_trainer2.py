"""Trainer 2.0 architecture comparison: every candidate trained by the trainer itself (protocol 2)
on one dated chart dataset, each in its own process so peak memory is per run.

    python -m scripts.perf.bench_trainer2 IMAGES_DIR --out /tmp/convolve-bench/t2 \
        --horizon 7 --timeframe 1d [--runs v1,compact,gap,resnet18,effb0,effb0_frozen,compact_repeat]

Every run uses the same purged chronological split (validation 20%, final test 15%), seed 7,
224 x 224, batch 16, at most --epochs epochs, early stopping on validation loss (patience 5).
Model selection uses validation data only; the test partition is evaluated once at the end of
each run and reported, never used to pick anything.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

RUNS = {
    "v1": {"architecture": "convolve-cnn-v1"},
    "compact": {"architecture": "convolve-cnn-compact-v1"},
    "compact_repeat": {"architecture": "convolve-cnn-compact-v1"},
    "gap": {"architecture": "convolve-cnn-gap-v1"},
    "resnet18": {"architecture": "convolve-resnet18-v1"},
    "effb0": {"architecture": "convolve-efficientnet-b0-v1"},
    "effb0_frozen": {"architecture": "convolve-efficientnet-b0-v1", "transfer": {"mode": "frozen"}},
    "compact_balacc": {"architecture": "convolve-cnn-compact-v1", "selection_metric": "val_balanced_accuracy"},
}


def one(spec: dict) -> None:
    sys.path.insert(0, os.getcwd())
    from runners.trainer_runner import run_trainer

    run_dir = Path(spec["run_dir"])
    run_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    run_trainer(spec["config"], run_dir, lambda *a: None)
    summary = json.loads((run_dir / "summary.json").read_text())
    timings = json.loads((run_dir / "timings.json").read_text())
    evaluation = json.loads((run_dir / "evaluation.json").read_text())
    model_file = run_dir / spec["config"]["model_name"]
    row = {
        "run": spec["name"],
        "architecture": spec["config"]["architecture"],
        "options": {k: spec["config"].get(k) for k in ("transfer", "selection_metric") if spec["config"].get(k)},
        "split": {
            k: v["samples"] for k, v in summary["training_setup"]["split"]["partitions"].items()
        },
        "excluded": summary["training_setup"]["split"]["excluded_by_reason"],
        "boundaries": summary["training_setup"]["split"]["boundaries"],
        "epochs_trained": summary["epochs_trained"],
        "best_epoch": summary["best_epoch"],
        "stopping": summary["stopping"]["reason"],
        "parameters": summary["model"]["parameters"],
        "trainable_parameters": summary["model"]["trainable_parameters"],
        "forward_gflops": summary["model"]["forward_gflops"],
        "validation": {k: evaluation["validation"].get(k) for k in ("n", "accuracy", "balanced_accuracy", "roc_auc", "pr_auc", "log_loss", "brier", "f1")},
        "validation_baseline": evaluation["validation"]["baseline"],
        "validation_predicted_counts": evaluation["validation"]["predicted_counts"],
        "test": {k: evaluation["test"].get(k) for k in ("n", "accuracy", "balanced_accuracy", "roc_auc", "pr_auc", "log_loss", "brier", "f1")},
        "test_baseline": evaluation["test"]["baseline"],
        "test_predicted_counts": evaluation["test"]["predicted_counts"],
        "train_images_per_second": timings.get("train_images_per_second"),
        "epoch_seconds_median": timings.get("epoch_seconds_median"),
        "peak_rss_mb": timings.get("peak_rss_mb"),
        "model_file_mb": round(model_file.stat().st_size / 1e6, 2),
        "weights_sha256": summary["reproducibility"]["weights_sha256"],
        "wall_seconds": round(time.perf_counter() - t0, 1),
    }
    with open(spec["out"], "a") as f:
        f.write(json.dumps(row) + "\n")
    print(json.dumps(row), flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="?")
    ap.add_argument("--out")
    ap.add_argument("--runs", default="v1,compact,compact_repeat,gap,resnet18,effb0,effb0_frozen")
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--horizon", type=int, required=False)
    ap.add_argument("--timeframe", default="1d")
    ap.add_argument("--one")
    args = ap.parse_args()
    if args.one:
        one(json.loads(args.one))
        return
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results = out / "results.jsonl"
    for name in args.runs.split(","):
        config = {
            "use_standard_config": False,
            "image_height": 224,
            "image_width": 224,
            "batch_size": 16,
            "epochs": args.epochs,
            "val_split": 0.2,
            "random_seed": 7,
            "folder_name": os.path.abspath(args.images),
            "model_name": "model.keras",
            "trainer_protocol": 2,
            "test_fraction": 0.15,
            "evaluate_test": True,
            "label_horizon_bars": args.horizon,
            "label_timeframe": args.timeframe,
            **RUNS[name],
        }
        spec = {"name": name, "config": config, "run_dir": str(out / name), "out": str(results)}
        print(f"=== {name}", flush=True)
        subprocess.run([sys.executable, "-m", "scripts.perf.bench_trainer2", "--one", json.dumps(spec)], check=False)


if __name__ == "__main__":
    main()
