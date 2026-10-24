"""Architecture x validation-method comparison on one dated chart dataset.

    python -m scripts.perf.bench_architectures IMAGES_DIR --out /tmp/convolve-bench/arch
        [--archs convolve-cnn-v1,convolve-cnn-compact-v1] [--methods random,chronological]
        [--seeds 7] [--test-fraction 0.15] [--epochs 30]

The most recent --test-fraction of windows is a common test period that no run sees. Windows
that overlap it are removed from the development set. Each (architecture, method, seed) trains
with the trainer itself (224x224, batch 16, val split 0.2, early stopping, deterministic init)
on the development set, and the saved model is then scored on the test period with the
trainer's decode. Validation accuracy measures what the user sees; test accuracy measures what
the model does on later, unseen market data.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("images")
    ap.add_argument("--out", required=True)
    ap.add_argument("--archs", default="convolve-cnn-v1,convolve-cnn-compact-v1,convolve-cnn-balanced-v1,convolve-cnn-deep-v1")
    ap.add_argument("--methods", default="random,chronological")
    ap.add_argument("--seeds", default="7")
    ap.add_argument("--test-fraction", type=float, default=0.15)
    ap.add_argument("--epochs", type=int, default=30)
    args = ap.parse_args()

    sys.path.insert(0, os.getcwd())
    import numpy as np
    import tensorflow as tf

    from runners.trainer_runner import build_image_dataset, chart_window, run_trainer, scan_labeled_png_paths

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    paths, labels = scan_labeled_png_paths(args.images, None)
    order = sorted(range(len(paths)), key=lambda i: (chart_window(paths[i])[1], os.path.basename(paths[i])))
    n_test = int(len(order) * args.test_fraction)
    test_idx = order[-n_test:]
    test_start = min(chart_window(paths[i])[0] for i in test_idx)
    dev_idx = [i for i in order[:-n_test] if chart_window(paths[i])[1] < test_start]
    dev_dir = out / "dev_images"
    shutil.rmtree(dev_dir, ignore_errors=True)
    dev_dir.mkdir(parents=True)
    for i in dev_idx:
        os.symlink(os.path.abspath(paths[i]), dev_dir / os.path.basename(paths[i]))
    test_paths = [paths[i] for i in test_idx]
    test_labels = np.asarray([labels[i] for i in test_idx], dtype=np.float32)
    split = {
        "dataset_images": len(paths),
        "dev_images": len(dev_idx),
        "test_images": len(test_idx),
        "purged_before_test": len(order) - n_test - len(dev_idx),
        "dev_period": [chart_window(paths[dev_idx[0]])[0], chart_window(paths[dev_idx[-1]])[1]],
        "test_period": [test_start, chart_window(paths[test_idx[-1]])[1]],
        "test_label_1_share": round(float(test_labels.mean()), 4),
    }
    print(json.dumps(split), flush=True)
    results_file = out / "results.jsonl"

    for seed in [int(s) for s in args.seeds.split(",")]:
        for arch in args.archs.split(","):
            for method in args.methods.split(","):
                run_dir = out / f"{arch}__{method}__s{seed}"
                shutil.rmtree(run_dir, ignore_errors=True)
                run_dir.mkdir(parents=True)
                config = {
                    "use_standard_config": False,
                    "image_height": 224,
                    "image_width": 224,
                    "batch_size": 16,
                    "epochs": args.epochs,
                    "val_split": 0.2,
                    "random_seed": seed,
                    "folder_name": str(dev_dir),
                    "model_name": "model.keras",
                    "architecture": arch,
                    "validation_method": method,
                    "deterministic_init": True,
                }
                tf.keras.utils.clear_session()
                t0 = time.perf_counter()
                run_trainer(config, run_dir, lambda *a: None)
                wall = time.perf_counter() - t0
                summary = json.loads((run_dir / "summary.json").read_text())
                timings = json.loads((run_dir / "timings.json").read_text())
                model = tf.keras.models.load_model(str(run_dir / "model.keras"))
                ds = build_image_dataset(test_paths, test_labels.astype(int).tolist(), (224, 224), 64, False, None)
                t1 = time.perf_counter()
                prob = np.concatenate([model(x, training=False).numpy().reshape(-1) for x, _ in ds])
                infer_s = time.perf_counter() - t1
                pred = (prob >= 0.5).astype(np.float32)
                eps = 1e-7
                test_loss = float(-np.mean(test_labels * np.log(prob + eps) + (1 - test_labels) * np.log(1 - prob + eps)))
                best = summary.get("saved_weights_metrics") or {}
                row = {
                    "architecture": arch,
                    "validation_method": method,
                    "seed": seed,
                    "train_samples": summary["train_samples"],
                    "val_samples": summary["val_samples"],
                    "purged": summary["training_setup"].get("purged_overlapping_train_samples"),
                    "epochs_trained": summary["epochs_trained"],
                    "best_epoch": summary["best_epoch"],
                    "val_accuracy": best.get("val_accuracy"),
                    "val_loss": best.get("val_loss"),
                    "train_accuracy_at_best": best.get("accuracy"),
                    "test_accuracy": round(float((pred == test_labels).mean()), 4),
                    "test_loss": round(test_loss, 4),
                    "test_pred_label_1_share": round(float(pred.mean()), 4),
                    "wall_seconds": round(wall, 1),
                    "epoch_seconds_median": timings.get("epoch_seconds_median"),
                    "train_images_per_second": timings.get("train_images_per_second"),
                    "inference_images_per_second": round(len(test_paths) / infer_s, 1),
                    "peak_rss_mb": timings.get("peak_rss_mb"),
                    "model_file_mb": timings["stages"].get("model_file_mb"),
                    "parameters": model.count_params(),
                }
                with open(results_file, "a") as f:
                    f.write(json.dumps({"split": split, **row}) + "\n")
                print(json.dumps(row), flush=True)
                (run_dir / "model.keras").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
