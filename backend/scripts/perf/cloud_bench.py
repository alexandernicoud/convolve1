"""Trainer benchmark inside a Cloud Run job / Batch task. Prints JSON lines to the job logs.

Never touches the database or user data: the images come from a benchmark ZIP in a bucket
(public-market charts made with the chart generator, not customer data).

    python scripts/perf/cloud_bench.py gs://BUCKET/bench/charts.zip --n 2000 --epochs 3 \
        [--matrix-archs convolve-cnn-v1,convolve-cnn-compact-v1] [--precision float32]

Steps: download + unzip (timed), device report, steady-state step matrix
(bench_training_matrix), then the unchanged trainer end to end (bench_trainer_e2e).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]


def log(event: str, **data) -> None:
    print(json.dumps({"bench": event, **data}), flush=True)


def fetch(uri: str, dest: Path) -> Path:
    t0 = time.perf_counter()
    local = dest / "bench.zip"
    if uri.startswith("gs://"):
        from google.cloud import storage

        bucket, _, name = uri[5:].partition("/")
        storage.Client().bucket(bucket).blob(name).download_to_filename(str(local))
    else:
        local = Path(uri)
    t1 = time.perf_counter()
    out = dest / "images"
    with zipfile.ZipFile(local) as zf:
        zf.extractall(out)
    pngs = [p for p in out.rglob("*.png") if "label" in p.name]
    folder = pngs[0].parent if pngs else out
    log("dataset", uri=uri, images=len(pngs), download_seconds=round(t1 - t0, 2),
        unzip_seconds=round(time.perf_counter() - t1, 2), zip_mb=round(local.stat().st_size / 2**20, 1))
    return folder


def device_report() -> None:
    import tensorflow as tf

    gpus = tf.config.list_physical_devices("GPU")
    details = []
    for g in gpus:
        try:
            details.append(tf.config.experimental.get_device_details(g))
        except Exception:  # noqa: BLE001
            details.append({"name": g.name})
    log("device", cpus=os.cpu_count(), gpus=[str(d) for d in details], tf=tf.__version__,
        cuda_build=tf.test.is_built_with_cuda())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("zip_uri")
    ap.add_argument("--n", type=int, default=2000)
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--matrix-archs", default="convolve-cnn-v1,convolve-cnn-compact-v1")
    ap.add_argument("--matrix-batches", default="16,64")
    ap.add_argument("--precision", default="float32")
    ap.add_argument("--skip-e2e", action="store_true")
    args = ap.parse_args()

    work = Path(tempfile.mkdtemp(prefix="cloud-bench-"))
    folder = fetch(args.zip_uri, work)
    device_report()
    py = sys.executable
    matrix = [py, "scripts/perf/bench_training_matrix.py", str(folder), "--n", "768", "--steps", "30",
              "--archs", args.matrix_archs, "--batches", args.matrix_batches, "--precision", args.precision,
              "--out", str(work / "matrix.json")]
    subprocess.run(matrix, cwd=str(BACKEND), check=False)
    if (work / "matrix.json").exists():
        log("matrix", rows=json.loads((work / "matrix.json").read_text()))
    if not args.skip_e2e:
        e2e = [py, "-m", "scripts.perf.bench_trainer_e2e", str(folder), "--n", str(args.n),
               "--epochs", str(args.epochs), "--out", str(work / "e2e")]
        t0 = time.perf_counter()
        subprocess.run(e2e, cwd=str(BACKEND), check=False)
        log("e2e_wall", seconds=round(time.perf_counter() - t0, 1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
