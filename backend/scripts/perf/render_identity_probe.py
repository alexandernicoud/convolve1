"""Compare a generator's candlestick renderer before and after a change, byte for byte.

    git show HEAD:backend/scripts/1.3_Adj_TrL.py > scripts/_bench_old_1.3_Adj_TrL.py
    python -m scripts.perf.render_identity_probe --old scripts/_bench_old_1.3_Adj_TrL.py \
        --new scripts/1.3_Adj_TrL.py [--n 300] [--symbol MSFT] [--ma]

Renders n real 6-month daily windows (from /tmp/convolve-gen-bench/<SYMBOL>.pkl) with each
renderer on one reused figure, as the generators do, and reports timing and how many PNGs are
byte-identical. --ma adds a 20-bar moving-average overlay (test-data generator only).
"""

from __future__ import annotations

import argparse
import importlib.util
import io
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]


def load(path: str, name: str):
    sys.path.insert(0, str(ROOT))
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def render_all(mod, windows, ma: bool):
    fig, ax = mod._make_figure_pair(224)
    out = []
    t = time.perf_counter()
    for w in windows:
        buf = io.BytesIO()
        if ma:
            mod.render_candlestick_png(fig, ax, w, 224, buf, ma_col="MA")
        else:
            mod.render_candlestick_png(fig, ax, w, 224, buf)
        out.append(buf.getvalue())
    return out, time.perf_counter() - t


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--old", required=True)
    ap.add_argument("--new", required=True)
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--symbol", default="MSFT")
    ap.add_argument("--ma", action="store_true")
    args = ap.parse_args()
    old = load(args.old, "gen_old")
    new = load(args.new, "gen_new")
    hist = pd.read_pickle(f"/tmp/convolve-gen-bench/{args.symbol}.pkl")
    if args.ma:
        hist = hist.assign(MA=hist["Close"].rolling(20).mean())
    step = max(1, (len(hist) - 146) // args.n)
    windows = [hist.iloc[s : s + 126] for s in range(20, len(hist) - 126, step)][: args.n]

    ref, t_old = render_all(old, windows, args.ma)
    cand, t_new = render_all(new, windows, args.ma)
    same = sum(a == b for a, b in zip(ref, cand))
    print(f"symbol={args.symbol} ma={args.ma} windows={len(windows)} identical={same} old_s={t_old:.2f} new_s={t_new:.2f}")
    if same < len(windows):
        from PIL import Image

        i = next(k for k, (a, b) in enumerate(zip(ref, cand)) if a != b)
        a = np.asarray(Image.open(io.BytesIO(ref[i])))
        b = np.asarray(Image.open(io.BytesIO(cand[i])))
        print(f"first mismatch window={i} differing_pixels={int(np.any(a != b, axis=-1).sum())}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
