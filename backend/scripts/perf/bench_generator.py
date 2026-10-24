"""Time a generator script offline and fingerprint its output.

    python -m scripts.perf.bench_generator SCRIPT --x 1000 [--symbols MSFT] [--workers 4] [--out DIR]

Market data comes from pickles in CONVOLVE_BENCH_OHLCV_DIR (default /tmp/convolve-gen-bench) through
scripts/perf/gen_offline/sitecustomize.py, so two script versions see identical bars. Prints wall
time, chart count, and a SHA-256 over every (file name, file bytes) pair for pixel-identity checks.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def fingerprint(out: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(out.glob("*.png")):
        digest.update(path.name.encode())
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("script")
    ap.add_argument("--x", type=int, default=1000)
    ap.add_argument("--symbols", default="MSFT")
    ap.add_argument("--workers", default="")
    ap.add_argument("--out", default="/tmp/convolve-gen-bench/out")
    ap.add_argument("--i1", type=int, default=30)
    args = ap.parse_args()

    out = Path(args.out)
    shutil.rmtree(out, ignore_errors=True)
    (out / "charts").mkdir(parents=True)
    env = dict(os.environ)
    env.setdefault("CONVOLVE_BENCH_OHLCV_DIR", "/tmp/convolve-gen-bench")
    env["PYTHONPATH"] = os.pathsep.join([str(HERE / "gen_offline"), env.get("PYTHONPATH", "")])
    if args.workers:
        env["CHART_RENDER_WORKERS"] = args.workers
    script = Path(args.script).resolve()
    common = ["--symbols", args.symbols, "--out_dir", str(out / "charts"), "--use_candles", "yes", "--t", "1d",
              "--u", "months", "--o", "6", "--w", "7", "--f", "0.02", "--s", "0.01", "--img_dim", "224",
              "--i1", str(args.i1), "--progress_dir", str(out)]
    cmd = [sys.executable, str(script), "--x", str(args.x), *common, "--run_id", "bench"]
    t = time.perf_counter()
    proc = subprocess.run(cmd, cwd=str(script.parent), env=env, capture_output=True, text=True)
    wall = time.perf_counter() - t
    if proc.returncode != 0:
        print(proc.stdout[-2000:], proc.stderr[-3000:])
        raise SystemExit(proc.returncode)
    pngs = list((out / "charts").glob("*.png"))
    report = {
        "script": script.name,
        "workers": args.workers or "default",
        "charts": len(pngs),
        "label1": sum(1 for p in pngs if p.name.endswith("_label1.png")),
        "wall_seconds": round(wall, 2),
        "charts_per_second": round(len(pngs) / wall, 1) if wall else None,
        "fingerprint": fingerprint(out / "charts"),
    }
    prov = out / "charts" / "_provenance" / "samples.jsonl"
    if prov.is_file():
        report["provenance_sha256"] = hashlib.sha256(prov.read_bytes()).hexdigest()
    print(json.dumps(report))


if __name__ == "__main__":
    main()
