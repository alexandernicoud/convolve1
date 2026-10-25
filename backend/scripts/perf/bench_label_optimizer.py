"""Time the Labeling Optimizer pipeline stage by stage on a deterministic synthetic series (offline).

    .venv/bin/python -m scripts.perf.bench_label_optimizer --bars 1260 [--engine legacy|fast] [--eval-bars 0]

Runs one engine per process so peak RSS is attributable. Benchmark index fetches are stubbed
out; nothing touches the network. Output goes under /tmp/convolve-bench/label_optimizer.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import resource
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]


def synthetic_ohlc(bars: int, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    close = 100.0 * np.exp(np.cumsum(rng.normal(0.0003, 0.018, bars)))
    open_ = np.r_[close[0], close[:-1]] * (1.0 + rng.normal(0.0, 0.004, bars))
    high = np.maximum(open_, close) * (1.0 + np.abs(rng.normal(0.0, 0.008, bars)))
    low = np.minimum(open_, close) * (1.0 - np.abs(rng.normal(0.0, 0.008, bars)))
    idx = pd.bdate_range("2015-01-02", periods=bars)
    return pd.DataFrame({"Open": open_, "High": high, "Low": low, "Close": close}, index=idx)


def load_engine():
    spec = importlib.util.spec_from_file_location("label_opt_bench", ROOT / "scripts" / "7.2.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    mod.fetch_benchmark_return = lambda *a, **k: None
    return mod


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bars", type=int, default=1260)
    ap.add_argument("--eval-bars", type=int, default=0, help="Reserve the last N bars as the evaluation period")
    ap.add_argument("--engine", choices=["legacy", "fast"], default="fast")
    ap.add_argument("--out", default="/tmp/convolve-bench/label_optimizer")
    args = ap.parse_args()

    os.environ["MPLBACKEND"] = "Agg"
    os.environ["CONVOLVE_LABEL_ENGINE"] = args.engine
    t0 = time.perf_counter()
    opt = load_engine()
    import_s = time.perf_counter() - t0

    df = synthetic_ohlc(args.bars)
    run_dir = Path(args.out) / f"{args.engine}_{args.bars}_{args.eval_bars}"
    if run_dir.exists():
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True)
    kwargs = {}
    if args.eval_bars:
        cfg = {"selection_end": str(df.index[-args.eval_bars - 1].date())}
        (run_dir / "optimizer_config.json").write_text(json.dumps(cfg))
    start, end = str(df.index[0].date()), str(df.index[-1].date())

    t1 = time.perf_counter()
    stages = opt.run_headless("SYN", start, end, str(run_dir), df=df, **kwargs)
    total = time.perf_counter() - t1

    art = run_dir / "artifacts"
    sizes = {p.name: p.stat().st_size for p in sorted(art.iterdir()) if p.is_file()}
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    peak_mb = rss / (1024 * 1024) if sys.platform == "darwin" else rss / 1024
    report = {
        "engine": args.engine,
        "bars": args.bars,
        "eval_bars": args.eval_bars,
        "import_s": round(import_s, 3),
        "pipeline_s": round(total, 3),
        "stages_s": stages,
        "peak_rss_mb": round(peak_mb, 1),
        "artifact_bytes_total": sum(sizes.values()),
        "json_bytes": {k: v for k, v in sizes.items() if k.endswith(".json")},
        "other_bytes": sum(v for k, v in sizes.items() if not k.endswith(".json")),
        "run_dir": str(run_dir),
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
