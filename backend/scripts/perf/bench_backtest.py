"""Time the v2 backtest pipeline stage by stage on a local test dataset (offline).

    .venv/bin/python -m scripts.perf.bench_backtest GENERATOR_CHARTS_DIR MODEL_PATH [--profile]

GENERATOR_CHARTS_DIR is a test-data generator output (PNG files plus ``_provenance``). It is
linked into a dataset layout under /tmp; nothing in the repository is modified.
"""

from __future__ import annotations

import argparse
import cProfile
import json
import pstats
import shutil
import time
from pathlib import Path


def build_dataset(charts: Path, root: Path) -> Path:
    from app.services import dataset_provenance as dp

    if root.exists():
        shutil.rmtree(root)
    images = root / "images"
    images.mkdir(parents=True)
    for png in charts.glob("*.png"):
        (images / png.name).symlink_to(png.resolve())
    shutil.copytree(charts / dp.STAGING_DIR, root / dp.PROVENANCE_DIR)
    return root


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("charts")
    ap.add_argument("model")
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--profile", action="store_true")
    ap.add_argument("--out", default="/tmp/convolve-bench/backtest")
    args = ap.parse_args()

    t_import = time.perf_counter()
    import keras

    from app.services.backtest_engine import pipeline

    import_s = time.perf_counter() - t_import
    out = Path(args.out)
    dataset = build_dataset(Path(args.charts), out / "dataset")
    t = time.perf_counter()
    model = keras.models.load_model(args.model, compile=False)
    load_s = time.perf_counter() - t

    marks = []

    def progress(p: float, msg: str) -> None:
        if not marks or marks[-1][1].split(" ")[0] != msg.split(" ")[0]:
            marks.append((time.perf_counter(), msg))

    config = {
        "output_dir": str(out / "result"),
        "dataset_dir": str(dataset),
        "threshold_mode": "fixed",
        "confidence_threshold": args.threshold,
    }
    prof = cProfile.Profile() if args.profile else None
    t0 = time.perf_counter()
    if prof:
        prof.enable()
    results = pipeline.run(config, progress, model=model)
    if prof:
        prof.disable()
    total = time.perf_counter() - t0
    marks.append((time.perf_counter(), "end"))
    stages = [{"stage": m[1], "seconds": round(n[0] - m[0], 3)} for m, n in zip(marks, marks[1:])]
    report = {
        "n_samples": results["dataset"]["n_samples_used"],
        "import_seconds": round(import_s, 2),
        "model_load_seconds": round(load_s, 3),
        "pipeline_seconds": round(total, 2),
        "stages": stages,
    }
    print(json.dumps(report, indent=2))
    if prof:
        pstats.Stats(prof).sort_stats("cumulative").print_stats(30)


if __name__ == "__main__":
    main()
