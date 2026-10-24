# Test chart labeler — fast path (cached yfinance + matplotlib Agg)
# -----------------------------------------------------------------
# - Future window = first w TRADING bars strictly after the chart end
# - Filename end date = ACTUAL last bar in the chart (not the requested end)
# - Period length = x timeframe units, max one chart per TRADING DAY
# - One history download per symbol; slices in memory (matches training generator)

import os
import datetime as dt
from dateutil.relativedelta import relativedelta
import time
import sys
import argparse
import json

import numpy as np
import yfinance as yf
import pandas as pd

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection, PolyCollection

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.services import trade_outcomes as outcomes  # noqa: E402
from app.services.dataset_provenance import PRICE_ADJUSTMENT_YF, ProvenanceWriter  # noqa: E402


class ProgressWriter:
    def __init__(self, path: str, timeseries_path: str | None = None, total_steps: int | None = None):
        self.path = path
        self.timeseries_path = timeseries_path
        self.start = time.time()
        self.total_steps = total_steps
        self._last_write = 0.0
        self._last_percent = None

    def update(self, phase: str, percent: float | None = None, step: int | None = None, force: bool = False):
        now = time.time()
        if not force and percent is not None and self._last_percent is not None:
            if (now - self._last_write) < 0.4 and abs(percent - self._last_percent) < 0.5:
                return
        elapsed = now - self.start
        self._last_write = now
        if percent is not None:
            self._last_percent = percent
        payload = {
            "phase": phase,
            "percent": percent,
            "elapsed_s": round(elapsed, 2),
            "updated_at": now,
            "step": step,
            "total_steps": self.total_steps,
        }
        with open(self.path, "w") as f:
            json.dump(payload, f)

        if self.timeseries_path is not None:
            try:
                with open(self.timeseries_path, "a") as f_ts:
                    f_ts.write(json.dumps(payload) + "\n")
            except OSError:
                pass


_RENDER_DPI = 100.0
_LINE_COLOR = "#1a1a1a"
_MA_COLOR = "#2563eb"
_WICK_COLOR = "#1a1a1a"
_BULL_BODY = "#0d8f4a"
_BEAR_BODY = "#c41e1e"


def _make_figure_pair(img_dim: int):
    fig = plt.figure(
        figsize=(img_dim / _RENDER_DPI, img_dim / _RENDER_DPI),
        dpi=_RENDER_DPI,
        facecolor="none",
    )
    fig.patch.set_alpha(0.0)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_facecolor("none")
    ax.patch.set_alpha(0.0)
    ax.axis("off")
    for spine in ax.spines.values():
        spine.set_visible(False)
    return fig, ax


def _savefig_transparent(fig, path: str):
    fig.savefig(
        path,
        format="png",
        dpi=_RENDER_DPI,
        facecolor="none",
        edgecolor="none",
        transparent=True,
        bbox_inches=None,
        pad_inches=0,
    )


def render_line_png(fig, ax, data: pd.DataFrame, img_dim: int, path: str, ma_col: str | None = None) -> None:
    ax._convolve_candles_only = False
    ax.clear()
    ax.set_facecolor("none")
    ax.patch.set_alpha(0.0)
    ax.axis("off")
    for spine in ax.spines.values():
        spine.set_visible(False)

    y = data["Close"].to_numpy(dtype=np.float64, copy=False)
    n = len(y)
    if n < 2:
        raise ValueError("line chart needs at least 2 points")

    x = np.arange(n, dtype=np.float64)
    ymin = float(np.min(y))
    ymax = float(np.max(y))
    if ma_col and ma_col in data.columns:
        ma = data[ma_col].to_numpy(dtype=np.float64, copy=False)
        valid = ma[np.isfinite(ma)]
        if len(valid):
            ymin = min(ymin, float(np.min(valid)))
            ymax = max(ymax, float(np.max(valid)))
    span = ymax - ymin
    pad = max(span * 0.02, 1e-9) if span > 0 else 1.0

    ax.set_xlim(-0.5, n - 0.5)
    ax.set_ylim(ymin - pad, ymax + pad)

    ax.plot(
        x,
        y,
        color=_LINE_COLOR,
        linewidth=1.0,
        solid_capstyle="butt",
        solid_joinstyle="miter",
        antialiased=False,
    )
    if ma_col and ma_col in data.columns:
        ax.plot(
            x,
            data[ma_col].to_numpy(dtype=np.float64, copy=False),
            color=_MA_COLOR,
            linewidth=1.0,
            solid_capstyle="butt",
            solid_joinstyle="miter",
            antialiased=False,
        )

    ax.set_aspect("auto")
    _savefig_transparent(fig, path)


def render_candlestick_png(
    fig, ax, data: pd.DataFrame, img_dim: int, path: str, ma_col: str | None = None
) -> None:
    """Wicks and bodies are two collections drawn in the same z-order as one Line2D and one
    Rectangle per candle; the PNG bytes are identical (scripts/perf/render_identity_probe.py)
    and rendering is about 15x faster. An axes that last held only this chart's artists is
    emptied instead of fully cleared, which is also byte-identical."""
    if getattr(ax, "_convolve_candles_only", False):
        for artist in [*ax.collections, *ax.lines]:
            artist.remove()
    else:
        ax.clear()
        ax.set_facecolor("none")
        ax.patch.set_alpha(0.0)
        ax.axis("off")
        for spine in ax.spines.values():
            spine.set_visible(False)

    o = data["Open"].to_numpy(dtype=np.float64, copy=False)
    h = data["High"].to_numpy(dtype=np.float64, copy=False)
    l = data["Low"].to_numpy(dtype=np.float64, copy=False)
    c = data["Close"].to_numpy(dtype=np.float64, copy=False)
    n = len(c)
    if n < 2:
        raise ValueError("candlestick needs at least 2 bars")

    ymin = float(np.min(l))
    ymax = float(np.max(h))
    if ma_col and ma_col in data.columns:
        ma = data[ma_col].to_numpy(dtype=np.float64, copy=False)
        valid = ma[np.isfinite(ma)]
        if len(valid):
            ymin = min(ymin, float(np.min(valid)))
            ymax = max(ymax, float(np.max(valid)))
    span = ymax - ymin
    pad = max(span * 0.02, 1e-9) if span > 0 else 1.0

    ax.set_xlim(-0.5, n - 0.5)
    ax.set_ylim(ymin - pad, ymax + pad)

    half_w = 0.35
    min_body = max((ymax - ymin) * 0.0015, 1e-9)

    wicks = []
    bodies = []
    colors = []
    for i in range(n):
        oi, hi, li, ci = o[i], h[i], l[i], c[i]
        wicks.append([(i, li), (i, hi)])
        top = max(oi, ci)
        bot = min(oi, ci)
        if abs(ci - oi) < min_body:
            mid = 0.5 * (oi + ci)
            bot = mid - min_body * 0.5
            top = mid + min_body * 0.5
        x0, width, height = i - half_w, 2 * half_w, top - bot
        bodies.append([(x0, bot), (x0 + width, bot), (x0 + width, bot + height), (x0, bot + height)])
        colors.append(_BULL_BODY if ci >= oi else _BEAR_BODY)

    # Line2D and Rectangle defaults, stated so the collections stroke identically.
    ax.add_collection(
        LineCollection(wicks, colors=_WICK_COLOR, linewidths=1.0, zorder=1, antialiaseds=False,
                       capstyle="projecting", joinstyle="round"),
        autolim=False,
    )
    ax.add_collection(
        PolyCollection(bodies, facecolors=colors, edgecolors=colors, linewidths=0.5, zorder=2,
                       antialiaseds=False, capstyle="butt", joinstyle="miter"),
        autolim=False,
    )
    ax._convolve_candles_only = True

    if ma_col and ma_col in data.columns:
        x = np.arange(n, dtype=np.float64)
        ax.plot(
            x,
            data[ma_col].to_numpy(dtype=np.float64, copy=False),
            color=_MA_COLOR,
            linewidth=1.0,
            zorder=3,
            antialiased=False,
        )

    ax.set_aspect("auto")
    _savefig_transparent(fig, path)


def tp_first_else_zero_from_next_open(data, future_data, f, s):
    if data.empty or future_data.empty:
        return None, None, None, None

    has_open = "Open" in future_data and not future_data["Open"].empty
    has_high = "High" in future_data and not future_data["High"].empty
    has_low = "Low" in future_data and not future_data["Low"].empty

    first_row = future_data.iloc[0]
    entry_price = float(first_row["Open"]) if has_open else float(first_row.get("Close"))
    if entry_price is None:
        return None, None, None, None

    tp_level = entry_price * (1.0 + float(f))
    sl_level = entry_price * (1.0 - float(s))

    for ts, row in future_data.iterrows():
        h = float(row["High"]) if has_high else float(row.get("Close", entry_price))
        l = float(row["Low"]) if has_low else float(row.get("Close", entry_price))

        if l <= sl_level:
            return 0, sl_level, "SL", ts
        if h >= tp_level:
            return 1, tp_level, "TP", ts

    return 0, None, None, None


def inclusive_history(ticker, start_ts, end_ts, interval):
    return ticker.history(
        start=start_ts.strftime("%Y-%m-%d"),
        end=(end_ts + dt.timedelta(days=1)).strftime("%Y-%m-%d"),
        interval=interval,
    )


def align_to_index_tz(ts, index):
    if hasattr(index, "tz") and index.tz is not None:
        ts_parsed = pd.Timestamp(ts)
        if ts_parsed.tzinfo is None:
            return ts_parsed.tz_localize(index.tz)
        return ts_parsed.tz_convert(index.tz)
    return pd.Timestamp(ts)


def parse_args():
    parser = argparse.ArgumentParser(description="Generate labeled test charts")
    parser.add_argument("--symbols", required=True, help="Symbols (comma separated)")
    parser.add_argument("--x", type=int, required=True, help="Period length in timeframe units")
    parser.add_argument("--out_dir", required=True, help="Output directory")
    parser.add_argument("--use_candles", required=True, help="Use candlechart (yes/no)")
    parser.add_argument("--t", required=True, help="Timeframe (1d, 1wk, 1mo)")
    parser.add_argument("--u", required=True, help="Unit of timespan (e.g. months)")
    parser.add_argument("--o", type=int, required=True, help="How many units for the timespan")
    parser.add_argument("--w", type=int, required=True, help="Future horizon in bars")
    parser.add_argument("--f", type=float, required=True, help="Take Profit (as fraction)")
    parser.add_argument("--s", type=float, required=True, help="Stop loss")
    parser.add_argument("--img_dim", type=int, required=True, help="Image dimensions")
    parser.add_argument("--i1", type=int, required=True, help="Last chart ends n timeframe units ago")
    parser.add_argument("--use_sma", default="no", help="Use SMA (yes/no)")
    parser.add_argument("--sma_length", type=int, default=20, help="SMA length")
    parser.add_argument("--run_id", required=True, help="Run ID")
    parser.add_argument("--progress_dir", required=True, help="Directory for progress files")
    return parser.parse_args()


def generate_and_save_labeled_charts(
    symbols,
    x,
    out_dir,
    use_candles,
    t,
    u,
    o,
    w,
    f,
    s,
    img_dim,
    i1,
    use_sma="no",
    sma_length=20,
    progress=None,
):
    print("=== Test Chart Generator Started ===")
    symbols = symbols.upper().replace(" ", "").split(",")
    print(f"Configuration: symbols={symbols}, period_units={x}, out_dir={out_dir}")
    print(f"timeframe={t}, use_candles={use_candles}, use_sma={use_sma}")

    os.makedirs(out_dir, exist_ok=True)

    if progress:
        progress.update("initializing", percent=5.0, force=True)

    if t == "1d":
        step_unit = "days"
    elif t == "1wk":
        step_unit = "weeks"
    elif t == "1mo":
        step_unit = "months"
    else:
        raise ValueError("Unsupported timeframe. Use '1d', '1wk', or '1mo'.")

    want_sma = str(use_sma).lower() == "yes" and sma_length and int(sma_length) > 0
    ma_col = f"SMA{int(sma_length)}" if want_sma else None

    spec = outcomes.OutcomeSpec(horizon_bars=int(w), tp_frac=float(f), sl_frac=float(s), timeframe=t)
    prov = ProvenanceWriter(out_dir, {
        "kind": "test",
        "label_method": outcomes.LABEL_METHOD_V2,
        "outcome": spec.as_dict(),
        "timeframe": t,
        "lookback": {"unit": u, "count": int(o)},
        "image": {"dim": int(img_dim), "candles": str(use_candles).lower() == "yes", "sma": int(sma_length) if want_sma else None},
        "period": {"units": int(x), "end_offset_units": int(i1), "step_unit": step_unit},
        "price_adjustment": PRICE_ADJUSTMENT_YF,
        "data_source": {"provider": "yfinance", "method": "Ticker.history", "version": getattr(yf, "__version__", None), "interval": t},
        "symbols": symbols,
    })
    hist_start_all = None
    hist_end_all = None

    for symbol_idx, symbol in enumerate(symbols):
        print(f"Starting symbol {symbol_idx + 1}/{len(symbols)}: {symbol}")
        if progress:
            overall = symbol_idx / max(len(symbols), 1)
            progress.update(f"processing_symbol_{symbol}", percent=round(5 + overall * 90, 2), force=True)

        ticker = yf.Ticker(symbol)
        # One download covering chart windows + future horizon for the whole period
        history_start = (
            dt.datetime.today()
            - relativedelta(**{step_unit: i1 + x})
            - relativedelta(**{u: o})
            - relativedelta(days=max(int(sma_length or 0) * 3, 5))
        )
        history_end = dt.datetime.today() + relativedelta(**{step_unit: max(w * 2, 2)})
        history = inclusive_history(ticker, history_start, history_end, t)
        if history.empty or "Close" not in history:
            print(f"No history available for {symbol}, skipping.")
            continue

        if history.index.has_duplicates:
            n_dup = int(history.index.duplicated(keep="last").sum())
            prov.notes.append(f"{symbol}: dropped {n_dup} duplicate bar timestamp(s), keeping the last")
            history = history[~history.index.duplicated(keep="last")]
        history = history.sort_index()
        prov.add_history(symbol, history, role="sample")
        hist_start_all = history_start if hist_start_all is None else min(hist_start_all, history_start)
        hist_end_all = history_end if hist_end_all is None else max(hist_end_all, history_end)

        if want_sma:
            history[ma_col] = history["Close"].rolling(window=int(sma_length)).mean()

        history_index = history.index
        used_last_bars = set()
        i = i1
        max_i = i1 + x
        charts_saved = 0

        fig_mpl, ax_mpl = _make_figure_pair(img_dim)
        try:
            while i < max_i:
                today = dt.datetime.today()
                current_end_req = today - relativedelta(**{step_unit: i})
                current_start_req = current_end_req - relativedelta(**{u: o})
                i += 1

                start_ts = align_to_index_tz(current_start_req, history_index)
                end_ts = align_to_index_tz(current_end_req, history_index)
                data = history.loc[(history_index >= start_ts) & (history_index <= end_ts)]
                if data.empty or "Close" not in data:
                    continue

                last_bar_ts = data.index[-1]
                if last_bar_ts in used_last_bars:
                    continue
                used_last_bars.add(last_bar_ts)

                if getattr(last_bar_ts, "tz", None):
                    last_bar_date = last_bar_ts.tz_convert("America/New_York").date()
                else:
                    last_bar_date = last_bar_ts.date()

                future = history.loc[history_index > last_bar_ts].head(w)
                if future.empty:
                    prov.skip("no_future_bars")
                    continue

                outcome = outcomes.resolve_outcome(history, last_bar_ts, spec)
                label = outcomes.label_for_method(outcome, outcomes.LABEL_METHOD_V2)
                if label is None:
                    prov.skip(f"outcome_{outcome.status}")
                    continue
                which = outcome.exit_reason
                hit_price = outcome.exit_price
                hit_date = outcome.exit_ts

                if data.empty or len(data) < 2 or "Close" not in data or data["Close"].empty:
                    prov.skip("window_too_short")
                    continue

                filename = f"{out_dir}/{symbol}_{current_start_req.date()}_to_{last_bar_date}_label{label}.png"
                os.makedirs(os.path.dirname(filename) or out_dir, exist_ok=True)

                try:
                    if use_candles.lower() == "yes" and all(c in data for c in ("Open", "High", "Low", "Close")):
                        render_candlestick_png(fig_mpl, ax_mpl, data, img_dim, filename, ma_col=ma_col)
                    else:
                        render_line_png(fig_mpl, ax_mpl, data, img_dim, filename, ma_col=ma_col)
                except Exception as e:
                    print(f"Error creating chart for {symbol} at {last_bar_date}: {e}")
                    continue

                charts_saved += 1
                prov.add_sample({
                    "image_id": os.path.basename(filename),
                    "symbol": symbol,
                    "timeframe": t,
                    "observation_start": data.index[0].isoformat(),
                    "observation_end": last_bar_ts.isoformat(),
                    "requested_start": str(current_start_req.date()),
                    "window_bars": int(len(data)),
                    "decision_ts": last_bar_ts.isoformat(),
                    "earliest_entry_ts": outcome.entry_ts.isoformat() if outcome.entry_ts is not None else None,
                    "horizon_bars": int(w),
                    "tp_frac": float(f),
                    "sl_frac": float(s),
                    "label": int(label),
                    "label_method": outcomes.LABEL_METHOD_V2,
                    "outcome_convention": outcomes.OUTCOME_CONVENTION,
                    "outcome": outcome.to_record(),
                    "price_adjustment": PRICE_ADJUSTMENT_YF,
                })

                if progress:
                    # i advances from i1 → i1+x; map into 5–95 across symbols
                    steps_done = (i - i1) / max(x, 1)
                    overall = (symbol_idx + min(steps_done, 1.0)) / max(len(symbols), 1)
                    progress.update(
                        f"generating_charts_{symbol}",
                        percent=round(5 + min(overall, 1.0) * 90, 2),
                        step=charts_saved,
                    )

                base = float(data["Close"].iloc[-1])
                if "Open" in future and not future["Open"].empty:
                    entry = float(future["Open"].iloc[0])
                else:
                    entry = float(future["Close"].iloc[0])

                print(
                    f"Saved: {filename} ({charts_saved} charts) | "
                    f"base_close={base:.4f} | entry={entry:.4f} | "
                    f"hit={which or 'None'} | hit_price={hit_price} | hit_date={hit_date}"
                )
        finally:
            plt.close(fig_mpl)

        total = len([f for f in os.listdir(out_dir) if f.endswith(".png") and symbol in f])
        print(f"Done for {symbol}. Period length: {x} {step_unit}. Charts saved: {total}")

    if hist_start_all is not None and "SPY" not in prov.histories:
        try:
            spy = inclusive_history(yf.Ticker("SPY"), hist_start_all, hist_end_all, t)
            if not spy.empty:
                spy = spy[~spy.index.duplicated(keep="last")].sort_index()
                prov.add_history("SPY", spy, role="benchmark")
        except Exception as e:  # benchmark data is optional; its absence is reported, never filled in
            prov.notes.append(f"SPY benchmark history unavailable: {e}")
    prov.write()
    print(f"Provenance written: {len(prov.samples)} samples, skipped={prov.skipped}")

    print("=== Test Chart Generator Completed ===")
    overall_total = len([f for f in os.listdir(out_dir) if f.endswith(".png")])
    print(f"Overall total charts generated: {overall_total}")


if __name__ == "__main__":
    args = parse_args()
    progress = ProgressWriter(
        path=os.path.join(args.progress_dir, "progress.json"),
        timeseries_path=os.path.join(args.progress_dir, "progress_timeseries.jsonl"),
    )
    progress.update("starting", percent=0.0, force=True)

    try:
        generate_and_save_labeled_charts(
            symbols=args.symbols,
            x=args.x,
            out_dir=args.out_dir,
            use_candles=args.use_candles,
            t=args.t,
            u=args.u,
            o=args.o,
            w=args.w,
            f=args.f,
            s=args.s,
            img_dim=args.img_dim,
            i1=args.i1,
            use_sma=args.use_sma,
            sma_length=args.sma_length,
            progress=progress,
        )
        progress.update("generation_complete", percent=95.0, force=True)
        print("Chart generation completed successfully!")
    except Exception as e:
        print(f"Error during chart generation: {e}")
        progress.update("error", percent=0.0, force=True)
        raise
