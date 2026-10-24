"""The generators' batched candlestick renderer draws the same pixels as the original
one-patch-per-candle renderer (training charts must not change when rendering gets faster)."""

from __future__ import annotations

import importlib.util
import io
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

matplotlib = pytest.importorskip("matplotlib")
matplotlib.use("Agg")
from matplotlib.lines import Line2D  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]


def _load(name: str):
    sys.path.insert(0, str(BACKEND))
    spec = importlib.util.spec_from_file_location(name.replace(".", "_"), BACKEND / "scripts" / name)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _reference(mod, fig, ax, data: pd.DataFrame, path, ma_col=None) -> None:
    """The renderer as it was before batching: one Line2D and one Rectangle per candle."""
    ax.clear()
    ax.set_facecolor("none")
    ax.patch.set_alpha(0.0)
    ax.axis("off")
    for spine in ax.spines.values():
        spine.set_visible(False)
    o, h, l, c = (data[k].to_numpy(dtype=np.float64, copy=False) for k in ("Open", "High", "Low", "Close"))
    n = len(c)
    ymin, ymax = float(np.min(l)), float(np.max(h))
    if ma_col:
        ma = data[ma_col].to_numpy(dtype=np.float64, copy=False)
        finite = ma[np.isfinite(ma)]
        if finite.size:
            ymin, ymax = min(ymin, float(finite.min())), max(ymax, float(finite.max()))
    span = ymax - ymin
    pad = max(span * 0.02, 1e-9) if span > 0 else 1.0
    ax.set_xlim(-0.5, n - 0.5)
    ax.set_ylim(ymin - pad, ymax + pad)
    half_w = 0.35
    min_body = max((ymax - ymin) * 0.0015, 1e-9)
    for i in range(n):
        oi, hi, li, ci = o[i], h[i], l[i], c[i]
        ax.add_line(Line2D([i, i], [li, hi], color=mod._WICK_COLOR, linewidth=1.0, zorder=1, antialiased=False))
        top, bot = max(oi, ci), min(oi, ci)
        if abs(ci - oi) < min_body:
            mid = 0.5 * (oi + ci)
            bot, top = mid - min_body * 0.5, mid + min_body * 0.5
        color = mod._BULL_BODY if ci >= oi else mod._BEAR_BODY
        ax.add_patch(Rectangle((i - half_w, bot), 2 * half_w, top - bot, facecolor=color, edgecolor=color,
                               linewidth=0.5, zorder=2, antialiased=False))
    if ma_col:
        ax.plot(np.arange(n, dtype=np.float64), data[ma_col].to_numpy(dtype=np.float64), color=mod._MA_COLOR,
                linewidth=1.0, zorder=3, antialiased=False)
    ax.set_aspect("auto")
    mod._savefig_transparent(fig, path)


def _windows(n_windows: int = 12, bars: int = 126, seed: int = 0):
    rng = np.random.default_rng(seed)
    total = n_windows * 7 + bars + 20
    close = 100 * np.exp(np.cumsum(rng.normal(0, 0.015, total)))
    open_ = np.r_[close[0], close[:-1]] * np.exp(rng.normal(0, 0.006, total))
    open_[::17] = close[::17]  # doji candles
    open_[5::29] *= 1.04  # gaps
    high = np.maximum(open_, close) * np.exp(np.abs(rng.normal(0, 0.008, total)))
    low = np.minimum(open_, close) * np.exp(-np.abs(rng.normal(0, 0.008, total)))
    df = pd.DataFrame({"Open": open_, "High": high, "Low": low, "Close": close})
    df["MA"] = df["Close"].rolling(20).mean()
    return [df.iloc[s : s + bars].reset_index(drop=True) for s in range(0, n_windows * 7, 7)]


def _render(fn, fig, ax, windows, **kw):
    out = []
    for w in windows:
        buf = io.BytesIO()
        fn(fig, ax, w, buf, **kw)
        out.append(buf.getvalue())
    return out


def test_training_generator_candles_are_byte_identical():
    mod = _load("1.3_Adj_TrL.py")
    windows = _windows()
    fig_a, ax_a = mod._make_figure_pair(224)
    fig_b, ax_b = mod._make_figure_pair(224)
    new = _render(lambda f, a, w, p: mod.render_candlestick_png(f, a, w, 224, p), fig_a, ax_a, windows)
    ref = _render(lambda f, a, w, p: _reference(mod, f, a, w, p), fig_b, ax_b, windows)
    assert new == ref
    # A line chart in between must not leave candles behind on the reused axes.
    mod.render_line_png(fig_a, ax_a, windows[0], 224, io.BytesIO())
    assert _render(lambda f, a, w, p: mod.render_candlestick_png(f, a, w, 224, p), fig_a, ax_a, windows[:2]) == ref[:2]


def test_test_data_generator_candles_with_moving_average_are_byte_identical():
    mod = _load("1.4_Adj_testL.py")
    if not hasattr(mod, "_MA_COLOR"):
        pytest.skip("test-data generator has no moving-average overlay")
    windows = _windows(seed=1)
    fig_a, ax_a = mod._make_figure_pair(224)
    fig_b, ax_b = mod._make_figure_pair(224)
    for ma in (None, "MA"):
        new = _render(lambda f, a, w, p: mod.render_candlestick_png(f, a, w, 224, p, ma_col=ma), fig_a, ax_a, windows)
        ref = _render(lambda f, a, w, p: _reference(mod, f, a, w, p, ma_col=ma), fig_b, ax_b, windows)
        assert new == ref, f"ma_col={ma}"
