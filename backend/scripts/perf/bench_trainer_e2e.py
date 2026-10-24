"""Run the unchanged trainer end to end on N real images and print its stage timings.

    python -m scripts.perf.bench_trainer_e2e IMAGES_DIR --n 2000 [--epochs 30] [--out /tmp/convolve-bench]

The standard configuration (224x224, batch 16, val split 0.2, seed 7, early stopping) is used, with
only the epoch cap overridable for throughput runs. When --n exceeds the number of real images, the
images are reused under new names; that is a throughput test only, never a model-quality test.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path


def stage_subset(images: Path, n: int, dest: Path) -> int:
    files = sorted(p for p in images.iterdir() if p.suffix == ".png" and "label" in p.name)
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    for i in range(n):
        src = files[i % len(files)]
        name = src.name if i < len(files) else f"r{i // len(files)}_{src.name}"
        os.symlink(src.resolve(), dest / name)
    return min(n, len(files))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("images")
    ap.add_argument("--n", type=int, default=2000)
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--out", default="/tmp/convolve-bench")
    args = ap.parse_args()

    out = Path(args.out) / f"n{args.n}_e{args.epochs}"
    images = out / "images"
    unique = stage_subset(Path(args.images), args.n, images)
    run_dir = out / "run"
    shutil.rmtree(run_dir, ignore_errors=True)
    run_dir.mkdir(parents=True)

    sys.path.insert(0, os.getcwd())
    from app.jobs.train_worker import _apply_tf_threads, configure_threads

    threads = int(os.getenv("TRAINER_THREADS", "8"))
    configure_threads(threads)
    t_import = time.perf_counter()
    _apply_tf_threads(threads)
    from runners.trainer_runner import run_trainer

    import_s = time.perf_counter() - t_import
    config = {
        "use_standard_config": args.epochs == 30,
        "image_height": 224,
        "image_width": 224,
        "batch_size": 16,
        "epochs": args.epochs,
        "val_split": 0.2,
        "random_seed": 7,
        "folder_name": str(images),
        "model_name": "model.keras",
    }
    t = time.perf_counter()
    run_trainer(config, run_dir, lambda *a, **k: None)
    total = time.perf_counter() - t
    timings = json.loads((run_dir / "timings.json").read_text())
    summary = json.loads((run_dir / "summary.json").read_text())
    report = {
        "n_images": args.n,
        "unique_images": unique,
        "epochs_cap": args.epochs,
        "epochs_trained": summary["epochs_trained"],
        "best_epoch": summary.get("best_epoch"),
        "final_val_accuracy": (summary.get("saved_weights_metrics") or {}).get("val_accuracy"),
        "import_and_threads_seconds": round(import_s, 2),
        "run_trainer_seconds": round(total, 2),
        **{k: v for k, v in timings.items() if k != "epochs"},
        "epochs": timings["epochs"],
    }
    print(json.dumps(report, indent=2))
    (out / "report.json").write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
