import os
import datetime as dt
from dateutil.relativedelta import relativedelta
import time
import sys
import argparse
import json

import numpy as np
import pandas as pd

# Non-interactive backend for fast, headless PNG export
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection, PolyCollection

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.services import generator_plan as plan  # noqa: E402
from app.services import trade_outcomes as outcomes  # noqa: E402

_EXIT_NAMES = {outcomes.EXIT_TP: "TP", outcomes.EXIT_SL: "SL"}


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
        # Throttle high-frequency per-chart updates: skip disk writes that are both
        # very recent (<0.4s) and barely move the bar (<0.5%). Terminal/forced states
        # always write so the UI never misses "done"/"error".
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

        # Append to timeseries JSONL if configured
        if self.timeseries_path is not None:
            try:
                with open(self.timeseries_path, "a") as f_ts:
                    f_ts.write(json.dumps(payload) + "\n")
            except OSError:
                # If we can't append, skip silently; main progress.json is enough.
                pass


# --- Fast chart rendering (matplotlib Agg, transparent PNG) ---------------------------------
_RENDER_DPI = 100.0
_LINE_COLOR = "#1a1a1a"
_WICK_COLOR = "#1a1a1a"
_BULL_BODY = "#0d8f4a"
_BEAR_BODY = "#c41e1e"


def _make_figure_pair(img_dim: int):
    """Fixed pixel size: img_dim x img_dim. Transparent figure."""
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


def render_line_png(fig, ax, data: pd.DataFrame, img_dim: int, path: str) -> None:
    """Close line only; transparent background; square img_dim x img_dim."""
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

    ax.set_aspect("auto")
    _savefig_transparent(fig, path)


def render_candlestick_png(fig, ax, data: pd.DataFrame, img_dim: int, path: str) -> None:
    """OHLC candles + wicks; transparent background; square img_dim x img_dim.

    Wicks and bodies are two collections drawn in the same z-order as one Line2D and one
    Rectangle per candle; the PNG bytes are identical (scripts/perf/render_identity_probe.py)
    and rendering is about 15x faster. An axes that last held only these collections is
    emptied instead of fully cleared, which is also byte-identical."""
    if getattr(ax, "_convolve_candles_only", False):
        for collection in list(ax.collections):
            collection.remove()
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
            # Doji: thin horizontal segment
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

    ax.set_aspect("auto")
    _savefig_transparent(fig, path)


class SampleTimes:
    """Per-chart event times in <out_dir>/_provenance/samples.jsonl (same record fields as the
    test generator). The trainer uses them to keep training charts whose outcome window reaches
    into the validation period out of training. Best effort: charts never depend on it."""

    def __init__(self, out_dir: str, params: dict):
        self.root = os.path.join(out_dir, "_provenance")
        self.params = params
        self.ok = True
        try:
            os.makedirs(self.root, exist_ok=True)
            self._fh = open(os.path.join(self.root, "samples.jsonl"), "w")
        except OSError as exc:
            print(f"Sample times not recorded: {exc}")
            self.ok = False

    def add(self, record: dict) -> None:
        if not self.ok:
            return
        try:
            self._fh.write(json.dumps(record, default=str) + "\n")
        except (OSError, TypeError, ValueError) as exc:
            print(f"Sample times not recorded: {exc}")
            self.ok = False

    def close(self) -> None:
        if not self.ok:
            return
        try:
            self._fh.close()
            with open(os.path.join(self.root, "provenance.json"), "w") as f:
                json.dump({"schema_version": 1, "kind": "training", "created_at": time.time(), **self.params}, f, indent=2)
        except OSError as exc:
            print(f"Sample times not recorded: {exc}")


def _opt_date(value):
    return plan.parse_day(value) if value else None


def parse_args():
    parser = argparse.ArgumentParser(description='Generate labeled training charts')
    parser.add_argument('--symbols', required=True, help='Symbols (comma separated)')
    parser.add_argument('--x', type=int, required=True, help='Charts per symbol per label')
    parser.add_argument('--out_dir', required=True, help='Output directory')
    parser.add_argument('--use_candles', required=True, help='Use candlechart (yes/no)')
    parser.add_argument('--t', required=True, help='Timeframe (1d, 1wk, 1mo)')
    parser.add_argument('--u', required=True, help='Unit of timespan (e.g. months)')
    parser.add_argument('--o', type=int, required=True, help='How many units for the timespan')
    parser.add_argument('--w', type=int, required=True, help='Future horizon in bars')
    parser.add_argument('--f', type=float, required=True, help='Take Profit (as fraction)')
    parser.add_argument('--s', type=float, required=True, help='Stop loss')
    parser.add_argument('--img_dim', type=int, required=True, help='Image dimensions')
    parser.add_argument('--i1', type=int, required=True, help='Last chart ends n time frame units ago (used when --end_date is absent)')
    parser.add_argument('--run_id', required=True, help='Run ID')
    parser.add_argument('--progress_dir', required=True, help='Directory for progress files')
    parser.add_argument('--end_date', default=None, help='Dataset end (YYYY-MM-DD): no bar after it is downloaded or used')
    parser.add_argument('--start_date', default=None, help='Fixed training period: earliest observation a chart may show')
    parser.add_argument('--floor_date', default=None, help='Authorized research start that is never crossed')
    parser.add_argument('--extend', default="no", help='yes: continue past --start_date until the target is met')

    return parser.parse_args()


def generate_and_save_labeled_charts(symbols, x, out_dir, use_candles, t, u, o, w, f, s, img_dim, i1, progress=None,
                                     end_date=None, start_date=None, floor_date=None, extend=False, report_path=None):
    print("=== Training Chart Generator Started ===")
    symbols = symbols.upper().replace(" ", "").split(",")
    print(f"Configuration: symbols={symbols}, charts_per_label={x}, timeframe={t}, use_candles={use_candles}")
    print(f"Output directory: {out_dir}")

    os.makedirs(out_dir, exist_ok=True)

    if progress:
        progress.update("initializing", percent=5.0)

    if t not in plan.TIMEFRAMES:
        raise ValueError("Unsupported timeframe. Use '1d', '1wk', or '1mo'.")
    if end_date is None:
        step_unit = {"1d": "days", "1wk": "weeks", "1mo": "months"}[t]
        end_date = dt.date.today() - relativedelta(**{step_unit: int(i1)})

    params = plan.PlanParams(
        timeframe=t, lookback_unit=u, lookback_count=int(o), horizon=int(w), tp=float(f), sl=float(s),
        per_class=int(x), end_date=end_date, start_date=start_date, floor_date=floor_date, extend=bool(extend),
    )
    print(f"Permitted period: {floor_date or start_date or 'start of history'} → {end_date} (extend={bool(extend)})")
    spec = outcomes.OutcomeSpec(horizon_bars=int(w), tp_frac=float(f), sl_frac=float(s), timeframe=t)
    times = SampleTimes(out_dir, {
        "label_method": outcomes.LABEL_METHOD_V2,
        "outcome": spec.as_dict(),
        "timeframe": t,
        "horizon_bars": int(w),
        "tp_frac": float(f),
        "sl_frac": float(s),
        "lookback": {"unit": u, "count": int(o)},
        "symbols": symbols,
        "dataset_end": end_date.isoformat(),
        "training_start": start_date.isoformat() if start_date else None,
        "research_floor": floor_date.isoformat() if floor_date else None,
        "extend_history": bool(extend),
        "data_source": {"provider": "yfinance", "method": "Ticker.history", "interval": t},
    })
    candles = str(use_candles).lower() == "yes"
    report = {"schema_version": 1, "params": {
        "per_class": int(x), "timeframe": t, "end_date": end_date.isoformat(),
        "start_date": start_date.isoformat() if start_date else None,
        "floor_date": floor_date.isoformat() if floor_date else None, "extend": bool(extend),
    }, "symbols": []}
    fetch_start = plan.history_fetch_start(params)

    for symbol_idx, symbol in enumerate(symbols):
        print(f"Starting symbol {symbol_idx + 1}/{len(symbols)}: {symbol}")
        if progress:
            progress.update(f"processing_symbol_{symbol}", percent=round(5 + symbol_idx / len(symbols) * 90, 2), force=True)
        try:
            history = plan.fetch_history(symbol, t, end_date, fetch_start)
        except Exception as exc:  # noqa: BLE001 — a failed download skips the symbol
            print(f"No history available for {symbol}: {exc}")
            history = None
        sp = plan.plan_symbol(symbol, history, params, use_candles=candles)
        bars = plan.prepare_bars(history, t, end_date, floor_date)
        rendered = {0: 0, 1: 0}
        render_failed = 0
        total_sel = max(len(sp.selections), 1)

        fig_mpl, ax_mpl = _make_figure_pair(img_dim)
        try:
            for n_done, sel in enumerate(sp.selections, start=1):
                data = bars.iloc[sel.lo: sel.pos + 1]
                decision_ts = bars.index[sel.pos]
                outcome = outcomes.resolve_outcome(bars, decision_ts, spec)
                label = outcomes.label_for_method(outcome, outcomes.LABEL_METHOD_V2)
                if label != sel.label:
                    print(f"Skipping {symbol} at {sel.decision_date}: label check failed ({label} vs {sel.label})")
                    render_failed += 1
                    continue
                future = bars.iloc[sel.pos + 1: sel.pos + 1 + int(w)]
                which = _EXIT_NAMES.get(outcome.exit_reason)
                filename = f"{out_dir}/{symbol}_{sel.window_start}_to_{sel.decision_date}_label{label}.png"
                try:
                    if candles and all(c in data for c in ("Open", "High", "Low", "Close")):
                        render_candlestick_png(fig_mpl, ax_mpl, data, img_dim, filename)
                    else:
                        render_line_png(fig_mpl, ax_mpl, data, img_dim, filename)
                except Exception as e:  # noqa: BLE001
                    print(f"Error creating chart for {symbol} at {sel.decision_date}: {e}")
                    render_failed += 1
                    continue
                rendered[label] += 1
                times.add({
                    "image_id": os.path.basename(filename),
                    "symbol": symbol,
                    "timeframe": t,
                    "observation_start": data.index[0].isoformat(),
                    "observation_end": decision_ts.isoformat(),
                    "decision_ts": decision_ts.isoformat(),
                    "earliest_entry_ts": future.index[0].isoformat(),
                    # The label depends on every bar up to here (label 0 = no TP within the horizon).
                    "horizon_end_ts": future.index[-1].isoformat(),
                    "horizon_bars_available": int(len(future)),
                    "horizon_bars": int(w),
                    "label": int(label),
                    "label_method": outcomes.LABEL_METHOD_V2,
                    "exit_reason": which,
                    "exit_ts": outcome.exit_ts.isoformat() if which and outcome.exit_ts is not None else None,
                    "outcome": outcome.to_record(),
                })
                if progress:
                    overall = (symbol_idx + n_done / total_sel) / len(symbols)
                    progress.update(
                        f"generating_charts_{symbol}",
                        percent=round(5 + min(overall, 1.0) * 90, 2),
                        step=rendered[0] + rendered[1],
                    )
        finally:
            plt.close(fig_mpl)

        summary = sp.summary()
        summary.update({"rendered_label0": rendered[0], "rendered_label1": rendered[1], "render_failed": render_failed})
        report["symbols"].append(summary)
        print(
            f"Done with symbol {symbol}: {rendered[0] + rendered[1]} charts (label 0: {rendered[0]}, label 1: {rendered[1]}) "
            f"from {sp.raw_bars} bars; stopped at {sp.stop_reason}"
        )

    times.close()
    if report_path:
        try:
            with open(report_path, "w") as fh:
                json.dump(report, fh, indent=2, default=str)
        except OSError as exc:
            print(f"Generation report not written: {exc}")
    print("=== Training Chart Generator Completed ===")
    overall_total = len([fn for fn in os.listdir(out_dir) if fn.endswith('.png')])
    print(f"Overall total charts generated: {overall_total}")
    return report


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
            progress=progress,
            end_date=_opt_date(args.end_date),
            start_date=_opt_date(args.start_date),
            floor_date=_opt_date(args.floor_date),
            extend=str(args.extend).lower() == "yes",
            report_path=os.path.join(args.progress_dir, "generation_report.json"),
        )
        progress.update("generation_complete", percent=95.0, force=True)
        print("Chart generation completed successfully!")
    except Exception as e:
        print(f"Error during chart generation: {e}")
        progress.update("error", percent=0.0, force=True)
        raise
