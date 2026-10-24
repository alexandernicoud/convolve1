"""Peak memory and throughput of one input-pipeline epoch as the dataset grows (no training).

Builds a dataset of N chart PNGs by cycling the files of SOURCE under new dated names, then, in a
fresh process per (pipeline, N), iterates one full shuffled epoch exactly as the trainer does:

  files  : runners.trainer_runner.build_image_dataset (PNG folder; RAM cache only below ~280 MiB)
  shards : runners.dataset_shards.write_shards + epoch_indexed_shard_dataset (full shuffle, cap 200k)

Also reports how well each pipeline shuffles: the share of distinct source tickers... is not
measurable on cycled data, so it reports the shuffle window instead (records the order can mix).

    python scripts/perf/bench_pipeline_memory.py SOURCE_IMAGES --sizes 2000,10000,40000 --out /tmp/x.json
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))


def _peak_rss_mb() -> float:
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return peak / (1024 * 1024) if sys.platform == "darwin" else peak / 1024


def _make_dataset(source: Path, n: int, dest: Path) -> None:
    files = sorted(source.glob("*.png"))
    dest.mkdir(parents=True, exist_ok=True)
    for i in range(n):
        src = files[i % len(files)]
        label = 1 if src.stem.endswith("label1") else 0
        # Distinct dated names so chronological ordering stays valid; content is a real chart.
        year, day = 1900 + i // 365, i % 365
        start = f"{year:04d}-{1 + day // 31:02d}-{1 + day % 28:02d}"
        name = f"SYN_{start}_to_{start}_label{label}.png"
        target = dest / name
        if not target.exists():
            os.link(src, target) if hasattr(os, "link") else shutil.copy(src, target)


def _child(pipeline: str, folder: str, batch: int) -> dict:
    import tensorflow as tf  # noqa: F401

    from runners import dataset_shards
    from runners.trainer_runner import SHARD_SHUFFLE_MAX, build_image_dataset, scan_labeled_png_paths

    paths, labels = scan_labeled_png_paths(folder, None)
    n = len(paths)
    img = (224, 224)
    rss_before = _peak_rss_mb()
    t0 = time.perf_counter()
    write_s = 0.0
    if pipeline == "files":
        ds = build_image_dataset(paths, labels, img, batch, shuffle=True, shuffle_seed=7)
        window = min(n, 10_000)
    else:
        shard_dir = Path(tempfile.mkdtemp(prefix="bench-shards-"))
        manifest = dataset_shards.write_shards(paths, labels, shard_dir, shard_images=dataset_shards.DEFAULT_SHARD_IMAGES)
        write_s = time.perf_counter() - t0
        files = [str(shard_dir / s["file"]) for s in manifest["shards"]]
        window = min(n, SHARD_SHUFFLE_MAX)
        ds = dataset_shards.epoch_indexed_shard_dataset(
            files, img, batch, shuffle_buffer=window, seed=7, initial_epoch=0, epochs=1
        )
    t1 = time.perf_counter()
    seen = 0
    for x, _y in ds:
        seen += int(x.shape[0])
    iterate_s = time.perf_counter() - t1
    if pipeline == "shards":
        shutil.rmtree(shard_dir, ignore_errors=True)
    return {
        "pipeline": pipeline,
        "images": n,
        "seen": seen,
        "shuffle_window": window,
        "shard_write_seconds": round(write_s, 2),
        "epoch_seconds": round(iterate_s, 2),
        "images_per_second": round(seen / iterate_s, 1),
        "peak_rss_mb": round(_peak_rss_mb(), 1),
        "rss_after_tf_import_mb": round(rss_before, 1),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("source", nargs="?")
    ap.add_argument("--sizes", default="2000,10000,40000")
    ap.add_argument("--pipelines", default="files,shards")
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--out", required=False)
    ap.add_argument("--child", nargs=2, metavar=("PIPELINE", "FOLDER"))
    args = ap.parse_args()

    if args.child:
        print(json.dumps(_child(args.child[0], args.child[1], args.batch)))
        return 0

    work = Path(tempfile.mkdtemp(prefix="bench-pipeline-"))
    rows = []
    try:
        for n in [int(s) for s in args.sizes.split(",")]:
            folder = work / f"n{n}"
            _make_dataset(Path(args.source), n, folder)
            for pipeline in args.pipelines.split(","):
                out = subprocess.run(
                    [sys.executable, __file__, "--child", pipeline, str(folder), "--batch", str(args.batch)],
                    capture_output=True, text=True, cwd=str(BACKEND), env={**os.environ, "TF_CPP_MIN_LOG_LEVEL": "2"},
                )
                line = next((l for l in reversed(out.stdout.splitlines()) if l.startswith("{")), None)
                if line is None:
                    print(out.stderr[-2000:], file=sys.stderr)
                    return 1
                row = json.loads(line)
                rows.append(row)
                print(json.dumps(row), flush=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    if args.out:
        Path(args.out).write_text(json.dumps(rows, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
