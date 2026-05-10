import os
import webbrowser
from datetime import datetime
import numpy as np
import pandas as pd
import yfinance as yf
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
import plotly.graph_objects as go
import time
import sys
import argparse
import json

# ================================
# CONFIG
# ================================

TP_MIN = 0.005
TP_MAX = 0.40
TP_STEPS = 25

SL_MIN = 0.005
SL_MAX = 0.20
SL_STEPS = 25

HORIZON_MIN = 1
HORIZON_MAX = 200

MIN_TRADES = 50
TOP_N_SAVE = 50
START_CAPITAL = 100_000.0

FEE_RATE = 0.001      # 0.1% per side
SPREAD_RATE = 0.0001  # 0.01% spread
TOTAL_COST_FRAC = 2 * FEE_RATE + SPREAD_RATE

# ==============================
# PARALLEL POSITION MODEL
# ==============================
# We ALWAYS open a new trade each day.
# Each trade size = 1/horizon so average concurrent trades ~ horizon => total exposure ~1.
PARALLEL_TRADES = True

# If both TP and SL hit on same candle:
# - "SL_FIRST"  => pessimistic
# - "TP_FIRST"  => optimistic
AMBIGUOUS_FILL = "SL_FIRST"

# For the 3D ratio plot: choose which metric to color by
# - "LINEAR"     => ratio_annual_vs_asset (annual linear return / asset annual linear)
# - "COMPOUNDED" => ratio_cagr_vs_asset   (system compounded CAGR / asset CAGR)
RATIO_METRIC_MODE = "COMPOUNDED"


# ==============================
# CNN candidate selection
# ==============================

CNN_MIN_TRADES = 800
CNN_MIN_LABEL1 = 0.35
CNN_MAX_LABEL1 = 0.65
CNN_MIN_SPREAD = 0.01
CNN_CAGR_TOLERANCE = 0.02


class ProgressWriter:
    def __init__(self, path: str, timeseries_path: str | None = None, total_steps: int | None = None):
        self.path = path
        self.timeseries_path = timeseries_path
        self.start = time.time()
        self.total_steps = total_steps

    def update(self, phase: str, percent: float | None = None, step: int | None = None):
        now = time.time()
        elapsed = now - self.start
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


def print_progress(current: int, total: int, start_time: float, bar_len: int = 30):
    if total <= 0:
        return

    frac = current / total
    frac = max(0.0, min(1.0, frac))

    elapsed = time.time() - start_time
    eta = elapsed * (1.0 - frac) / frac if frac > 0 else 0.0

    filled = int(bar_len * frac)
    bar = "█" * filled + "-" * (bar_len - filled)

    msg = (
        f"\r[{bar}] {frac * 100:6.2f}%  "
        f"elapsed: {elapsed / 60.0:5.1f} min  "
        f"ETA: {eta / 60.0:5.1f} min"
    )
    sys.stdout.write(msg)
    sys.stdout.flush()

    if current == total:
        sys.stdout.write("\n")
        sys.stdout.flush()


def mark_cnn_candidates(df: pd.DataFrame, asset_cagr: float) -> pd.DataFrame:
    df = df.copy()

    if "spread" not in df.columns:
        df["spread"] = df["tp_frac"] - df["sl_frac"]

    cond_trades = df["trades"] >= CNN_MIN_TRADES
    cond_label_balance = (df["label1_ratio"] >= CNN_MIN_LABEL1) & (df["label1_ratio"] <= CNN_MAX_LABEL1)
    cond_spread = df["spread"] >= CNN_MIN_SPREAD

    min_allowed_cagr = asset_cagr - CNN_CAGR_TOLERANCE
    cond_cagr = df["compounded_cagr"] >= min_allowed_cagr
    cond_non_nan = df["compounded_cagr"].notna()

    mask = cond_trades & cond_label_balance & cond_spread & cond_cagr & cond_non_nan
    df["is_cnn_candidate"] = mask
    df["cnn_rank_score"] = np.where(mask, df["compounded_cagr"], np.nan)

    return df


# ================================
# DATA LOADING
# ================================

def load_data(symbol: str, start: str, end: str) -> pd.DataFrame:
    print(f"\nLoading {symbol} from {start} to {end} ...")
    df = yf.download(
        symbol,
        start=start,
        end=end,
        interval="1d",
        auto_adjust=True,
        progress=False
    )

    if df is None or df.empty:
        print("No data.")
        return pd.DataFrame()

    if isinstance(df.columns, pd.MultiIndex):
        try:
            df = df.xs(symbol, axis=1, level=1)
        except Exception:
            df.columns = df.columns.get_level_values(0)

    required = {"Open", "High", "Low", "Close"}
    if not required.issubset(df.columns):
        print(f"Missing OHLC columns: {df.columns}")
        return pd.DataFrame()

    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    print(f"  -> {len(df)} rows from {df.index[0].date()} to {df.index[-1].date()}")
    return df


# ================================
# ASSET STATS
# ================================

def compute_asset_stats_from_df(df: pd.DataFrame):
    close = df["Close"]
    first = close.iloc[0]
    last = close.iloc[-1]
    total_ret = (last / first) - 1.0
    years = max((df.index[-1] - df.index[0]).days / 365.25, 1e-9)

    annual_lin = total_ret / years
    annual_cagr = (1.0 + total_ret) ** (1.0 / years) - 1.0

    return {
        "total_ret": total_ret,
        "total_ret_pct": total_ret * 100.0,
        "annual_lin": annual_lin,
        "annual_lin_pct": annual_lin * 100.0,
        "annual_cagr": annual_cagr,
        "annual_cagr_pct": annual_cagr * 100.0,
        "years": years,
    }


# ============================================================
# PARALLEL TRADE SIMULATOR (GRID)
# ============================================================

def simulate_system_for_metrics(
        df: pd.DataFrame,
        tp_frac: float,
        sl_frac: float,
        horizon_days: int,
        start_equity: float
):
    opens = df["Open"].to_numpy()
    highs = df["High"].to_numpy()
    lows = df["Low"].to_numpy()
    dates = df.index

    n = len(df)
    if n < 3:
        return None

    h = max(int(horizon_days), 1)
    years = max((dates[-1] - dates[0]).days / 365.25, 1e-9)

    # capital per position: 1/h
    w = 1.0 / h

    trades = 0
    label1_count = 0

    pnl_linear_sum = 0.0
    equity_lin = 1.0
    max_equity_lin = 1.0
    dd_min = 0.0

    # Welford only on realized TP/SL trades (not expiries)
    mean_r = 0.0
    M2 = 0.0

    equity_comp = start_equity

    # open positions: (tp_level, sl_level, expiry_index)
    open_pos = []

    # Start at i=1 because we use Open[i] as entry price
    for i in range(1, n):
        entry_price = float(opens[i])
        tp_level = entry_price * (1.0 + tp_frac)
        sl_level = entry_price * (1.0 - sl_frac)
        expiry = min(i + h - 1, n - 1)

        # open a new position every day (PARALLEL)
        open_pos.append([tp_level, sl_level, expiry])

        hi = float(highs[i])
        lo = float(lows[i])

        still_open = []
        for tpL, slL, exp in open_pos:
            hit_tp = (hi >= tpL)
            hit_sl = (lo <= slL)

            out = 0
            if hit_tp and hit_sl:
                out = +1 if AMBIGUOUS_FILL == "TP_FIRST" else -1
            elif hit_sl:
                out = -1
            elif hit_tp:
                out = +1
            elif i >= exp:
                out = 0  # expiry flat

            if out == 0 and i < exp:
                still_open.append([tpL, slL, exp])
                continue

            # realized return for this closed position
            if out == +1:
                r = tp_frac
                trades += 1
                label1_count += 1
                counted_for_stats = True
            elif out == -1:
                r = -sl_frac
                trades += 1
                counted_for_stats = True
            else:
                r = 0.0
                counted_for_stats = False

            # apply position sizing and costs
            eff_r = w * r
            eff_r -= w * TOTAL_COST_FRAC

            # linear equity update
            pnl_linear_sum += eff_r
            equity_lin += eff_r

            # cap at 0 so max drawdown never exceeds 100%
            equity_lin = max(equity_lin, 0.0)

            max_equity_lin = max(max_equity_lin, equity_lin)
            dd_min = min(dd_min, equity_lin - max_equity_lin)

            # Welford on TP/SL only
            if counted_for_stats:
                delta = eff_r - mean_r
                mean_r += delta / trades
                delta2 = eff_r - mean_r
                M2 += delta2 * delta2

            # compounded equity update
            equity_comp *= (1.0 + eff_r)
            equity_comp = max(equity_comp, 0.0)

        open_pos = still_open

    pnl_linear = pnl_linear_sum
    pnl_linear_per_year = pnl_linear / years
    pnl_linear_pct = pnl_linear * 100.0
    pnl_linear_per_year_pct = pnl_linear_per_year * 100.0

    label1_ratio = label1_count / trades if trades > 0 else 0.0

    max_drawdown = -dd_min
    max_drawdown = min(max_drawdown, 1.0)
    max_drawdown_pct = max_drawdown * 100.0

    trades_per_year = trades / years if years > 0 else np.nan

    if trades > 1:
        var = M2 / (trades - 1)
        std_r = np.sqrt(var) if var > 0 else 0.0
        if std_r > 1e-12:
            sharpe_trade = mean_r / std_r
            sharpe_annual = sharpe_trade * np.sqrt(trades_per_year)
        else:
            sharpe_annual = np.nan
    else:
        sharpe_annual = np.nan

    compounded_return = (equity_comp / start_equity) - 1.0
    if years > 0 and compounded_return > -0.999999:
        compounded_cagr = (1.0 + compounded_return) ** (1.0 / years) - 1.0
    else:
        compounded_cagr = np.nan

    calmar_ratio = (pnl_linear_per_year / max_drawdown) if max_drawdown > 1e-9 else np.nan

    return {
        "tp_frac": tp_frac,
        "sl_frac": sl_frac,
        "horizon_days": h,
        "trades": trades,
        "years": years,
        "pnl_linear": pnl_linear,
        "pnl_linear_per_year": pnl_linear_per_year,
        "pnl_linear_pct": pnl_linear_pct,
        "pnl_linear_per_year_pct": pnl_linear_per_year_pct,
        "pnl_per_trade": mean_r,
        "pnl_per_trade_pct": mean_r * 100.0,
        "label1_ratio": label1_ratio,
        "max_drawdown": max_drawdown,
        "max_drawdown_pct": max_drawdown_pct,
        "trades_per_year": trades_per_year,
        "sharpe_annual": sharpe_annual,
        "calmar_ratio": calmar_ratio,
        "equity_final": equity_comp,
        "compounded_return": compounded_return,
        "compounded_return_pct": compounded_return * 100.0,
        "compounded_cagr": compounded_cagr,
        "compounded_cagr_pct": compounded_cagr * 100.0,
    }


def simulate_compounded_equity_path(
    df: pd.DataFrame, tp_frac: float, sl_frac: float, horizon_days: int, start_equity: float = 1.0
) -> pd.Series:
    """
    End-of-day compounded equity, using the same parallel-trade rules as simulate_system_for_metrics.
    Multiple fills on the same day compound sequentially (not summed then compounded once), so this
    matches KPI compounded_return / CAGR. Index aligned to df.index.
    """
    opens = df["Open"].to_numpy()
    highs = df["High"].to_numpy()
    lows = df["Low"].to_numpy()
    idx = df.index
    n = len(df)
    if n < 3:
        return pd.Series(dtype=float)

    h = max(int(horizon_days), 1)
    w = 1.0 / h
    open_pos: list[list[float | int]] = []
    equity_comp = float(start_equity)
    out = np.zeros(n, dtype=float)
    out[0] = equity_comp

    for i in range(1, n):
        entry_price = float(opens[i])
        tp_level = entry_price * (1.0 + tp_frac)
        sl_level = entry_price * (1.0 - sl_frac)
        expiry = min(i + h - 1, n - 1)

        open_pos.append([tp_level, sl_level, expiry])

        hi = float(highs[i])
        lo = float(lows[i])

        still_open: list[list[float | int]] = []
        for tpL, slL, exp in open_pos:
            hit_tp = hi >= tpL
            hit_sl = lo <= slL

            out_code = 0
            if hit_tp and hit_sl:
                out_code = +1 if AMBIGUOUS_FILL == "TP_FIRST" else -1
            elif hit_sl:
                out_code = -1
            elif hit_tp:
                out_code = +1
            elif i >= exp:
                out_code = 0

            if out_code == 0 and i < exp:
                still_open.append([tpL, slL, exp])
                continue

            if out_code == +1:
                r = tp_frac
            elif out_code == -1:
                r = -sl_frac
            else:
                r = 0.0

            eff_r = w * r
            eff_r -= w * TOTAL_COST_FRAC

            equity_comp *= (1.0 + eff_r)
            equity_comp = max(equity_comp, 0.0)

        open_pos = still_open
        out[i] = equity_comp

    return pd.Series(out, index=idx)


# ================================
# GRID SEARCH
# ================================

def run_grid_search(df: pd.DataFrame, progress: ProgressWriter | None = None) -> pd.DataFrame:
    tp_values = np.linspace(TP_MIN, TP_MAX, TP_STEPS)
    sl_values = np.linspace(SL_MIN, SL_MAX, SL_STEPS)
    horizon_values = np.arange(HORIZON_MIN, HORIZON_MAX + 1)

    results = []
    total_combos = len(tp_values) * len(sl_values) * len(horizon_values)
    print(f"\nRunning grid search over {total_combos:,} combinations...\n")

    counter = 0
    start_time = time.time()

    for tp in tp_values:
        for sl in sl_values:
            for h in horizon_values:
                counter += 1

                stats = simulate_system_for_metrics(
                    df=df,
                    tp_frac=float(tp),
                    sl_frac=float(sl),
                    horizon_days=int(h),
                    start_equity=START_CAPITAL
                )
                if stats is None:
                    if (counter % 1000 == 0) or (counter == total_combos):
                        print_progress(counter, total_combos, start_time)
                        if progress is not None:
                            frac = counter / total_combos
                            progress.update(
                                "grid search",
                                percent=round(frac * 100.0, 2),
                                step=counter,
                            )
                    continue

                results.append({
                    "tp_frac": stats["tp_frac"],
                    "sl_frac": stats["sl_frac"],
                    "horizon_days": stats["horizon_days"],
                    "spread": stats["tp_frac"] - stats["sl_frac"],
                    "trades": stats["trades"],
                    "years": stats["years"],
                    "pnl_linear": stats["pnl_linear"],
                    "pnl_linear_per_year": stats["pnl_linear_per_year"],
                    "pnl_linear_pct": stats["pnl_linear_pct"],
                    "pnl_linear_per_year_pct": stats["pnl_linear_per_year_pct"],
                    "pnl_per_trade": stats["pnl_per_trade"],
                    "pnl_per_trade_pct": stats["pnl_per_trade_pct"],
                    "label1_ratio": stats["label1_ratio"],
                    "max_drawdown": stats["max_drawdown"],
                    "max_drawdown_pct": stats["max_drawdown_pct"],
                    "trades_per_year": stats["trades_per_year"],
                    "sharpe_annual": stats["sharpe_annual"],
                    "calmar_ratio": stats["calmar_ratio"],
                    "equity_final": stats["equity_final"],
                    "compounded_return": stats["compounded_return"],
                    "compounded_return_pct": stats["compounded_return_pct"],
                    "compounded_cagr": stats["compounded_cagr"],
                    "compounded_cagr_pct": stats["compounded_cagr_pct"],
                })

                if (counter % 1000 == 0) or (counter == total_combos):
                    print_progress(counter, total_combos, start_time)
                    if progress is not None:
                        frac = counter / total_combos
                        progress.update(
                            "grid search",
                            percent=round(frac * 100.0, 2),
                            step=counter,
                        )

    if not results:
        print("No systems produced metrics.")
        return pd.DataFrame()

    return pd.DataFrame(results)


# ================================
# BENCHMARKS
# ================================

def fetch_benchmark_return(ticker: str, start: datetime, end: datetime):
    df = yf.download(ticker, start=start, end=end, interval="1d",
                     auto_adjust=True, progress=False)
    if df is None or df.empty or "Close" not in df.columns:
        return None

    first = df["Close"].iloc[0]
    last = df["Close"].iloc[-1]
    total_ret = (last / first) - 1.0
    years = max((df.index[-1] - df.index[0]).days / 365.25, 1e-9)

    annual_lin = total_ret / years
    annual_cagr = (1.0 + total_ret) ** (1.0 / years) - 1.0

    return {
        "total_ret_pct": total_ret * 100.0,
        "annual_lin_pct": annual_lin * 100.0,
        "annual_cagr_pct": annual_cagr * 100.0,
        "years": years
    }


# ============================================================
# BEST SYSTEM – TIME VISUALS (CONSISTENT MODEL)
# ============================================================

def simulate_daily_realized_pnl_parallel(df: pd.DataFrame, tp_frac: float, sl_frac: float, horizon_days: int):
    opens = df["Open"].to_numpy()
    highs = df["High"].to_numpy()
    lows = df["Low"].to_numpy()
    idx = df.index
    n = len(df)
    if n < 3:
        return pd.Series(dtype=float), pd.Series(dtype=object)

    h = max(int(horizon_days), 1)
    w = 1.0 / h

    open_pos = []
    daily_realized = np.zeros(n, dtype=float)
    daily_scenario = np.array([""] * n, dtype=object)

    for i in range(1, n):
        entry = float(opens[i])
        tpL = entry * (1.0 + tp_frac)
        slL = entry * (1.0 - sl_frac)
        exp = min(i + h - 1, n - 1)
        open_pos.append([tpL, slL, exp])

        hi = float(highs[i])
        lo = float(lows[i])

        still = []
        for tp_level, sl_level, expiry in open_pos:
            hit_tp = (hi >= tp_level)
            hit_sl = (lo <= sl_level)

            out = None
            scen = None
            if hit_tp and hit_sl:
                out = +1 if AMBIGUOUS_FILL == "TP_FIRST" else -1
                scen = "TP" if out == +1 else "SL"
            elif hit_sl:
                out = -1
                scen = "SL"
            elif hit_tp:
                out = +1
                scen = "TP"
            elif i >= expiry:
                out = 0
                scen = "FLAT"

            if out == 0 and i < expiry:
                still.append([tp_level, sl_level, expiry])
                continue

            r = tp_frac if out == +1 else (-sl_frac if out == -1 else 0.0)
            eff_r = w * r
            eff_r -= w * TOTAL_COST_FRAC

            daily_realized[i] += eff_r
            daily_scenario[i] = scen

        open_pos = still

    realized = pd.Series(daily_realized, index=idx)
    scen = pd.Series(daily_scenario, index=idx)
    return realized, scen


def make_time_visuals_for_best_system(df_price: pd.DataFrame, best_row: pd.Series, symbol: str, out_dir: str):
    tp = float(best_row["tp_frac"])
    sl = float(best_row["sl_frac"])
    h = int(best_row["horizon_days"])

    realized_daily, scen_daily = simulate_daily_realized_pnl_parallel(df_price, tp, sl, h)
    if realized_daily.empty:
        print("No daily realized PnL for best system.")
        return

    close = df_price["Close"]

    # ------------------------------------------------------------------
    # EXCEPTION 1: Keep the linear cumulative curve vs price (as requested)
    # ------------------------------------------------------------------
    cum_linear = realized_daily.cumsum()
    strat_lin_pct = cum_linear * 100.0

    asset_cum_lin = close / close.iloc[0] - 1.0
    asset_lin_pct = asset_cum_lin * 100.0

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(strat_lin_pct.index, strat_lin_pct.values, label="Strategy (Linear, realized)")
    ax.plot(asset_lin_pct.index, asset_lin_pct.values, color="gray", alpha=0.7, label=f"{symbol} Buy & Hold (Linear)")
    ax.set_xlabel("Date")
    ax.set_ylabel("Cumulative return (%)")
    ax.set_title(f"{symbol}: Cumulative linear performance (TP={tp:.3f}, SL={sl:.3f}, H={h})")
    ax.legend(loc="upper left")
    ax.grid(True, linestyle="--", alpha=0.3)
    fig.tight_layout()
    fig.savefig(os.path.join(out_dir, f"{symbol}_time_cum_linear_vs_price_best.png"), dpi=200)
    plt.close(fig)

    # ---------------------------------------------------------
    # Compounded cumulative curve vs price (Price is linear B&H)
    # ---------------------------------------------------------
    eq = 1.0
    eq_list = []
    for r in realized_daily.values:
        eq *= (1.0 + r)
        eq = max(eq, 0.0)
        eq_list.append(eq)
    eq_arr = np.array(eq_list)
    comp_cum = eq_arr - 1.0
    strat_comp_pct = comp_cum * 100.0

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(realized_daily.index, strat_comp_pct, label="Strategy (Compounded, realized)")
    ax.plot(asset_lin_pct.index, asset_lin_pct.values, color="gray", alpha=0.7, label=f"{symbol} Buy & Hold (Linear)")
    ax.set_xlabel("Date")
    ax.set_ylabel("Cumulative return (%)")
    ax.set_title(f"{symbol}: Cumulative compounded performance (TP={tp:.3f}, SL={sl:.3f}, H={h})")
    ax.legend(loc="upper left")
    ax.grid(True, linestyle="--", alpha=0.3)
    fig.tight_layout()
    fig.savefig(os.path.join(out_dir, f"{symbol}_time_cum_compound_vs_price_best.png"), dpi=200)
    plt.close(fig)
    
    # Export time series JSON for dashboard
    timeseries_json = {
        "dates": [d.strftime("%Y-%m-%d") if hasattr(d, 'strftime') else str(d) for d in realized_daily.index],
        "price": [float(x) for x in close.values],
        "price_dates": [d.strftime("%Y-%m-%d") if hasattr(d, 'strftime') else str(d) for d in close.index],
        "price_norm": [float(x) for x in asset_lin_pct.values],
        "strategy_cum_linear": [float(x) for x in strat_lin_pct.values],
        "strategy_cum_compounded": [float(x) for x in strat_comp_pct],
    }
    _write_json(os.path.join(out_dir, f"{symbol}_best_timeseries.json"), timeseries_json)

    # yearly comparisons
    yearly_asset_open = close.resample("YE").first()
    yearly_asset_close = close.resample("YE").last()
    yearly_asset_lin = yearly_asset_close / yearly_asset_open - 1.0

    daily_asset_ret = close.pct_change().dropna()
    yearly_asset_comp = daily_asset_ret.groupby(daily_asset_ret.index.year).apply(lambda r: (1.0 + r).prod() - 1.0)

    yearly_lin = realized_daily.resample("YE").sum()
    yearly_lin.index = yearly_lin.index.year

    yearly_comp = realized_daily.groupby(realized_daily.index.year).apply(lambda r: (1.0 + r).prod() - 1.0)

    def set_year_ticks_every_5(ax, years):
        years = list(years)
        if not years:
            return
        tick_years = years[::5] if len(years) > 5 else years
        tick_pos = [years.index(y) for y in tick_years]
        ax.set_xticks(tick_pos)
        ax.set_xticklabels(tick_years)

    # 1) Yearly linear bars
    years_lin = sorted(set(yearly_lin.index) & set(yearly_asset_lin.index.year))
    if years_lin:
        y_strat_lin = np.array([yearly_lin[y] for y in years_lin])
        y_asset_lin = np.array([yearly_asset_lin[yearly_asset_lin.index.year == y].iloc[0] for y in years_lin])

        x = np.arange(len(years_lin))
        width = 0.35
        fig, ax = plt.subplots(figsize=(10, 5))
        ax.bar(x - width / 2, y_strat_lin * 100.0, width, label="Strategy (Linear)")
        ax.bar(x + width / 2, y_asset_lin * 100.0, width, label=f"{symbol} (Linear)")
        set_year_ticks_every_5(ax, years_lin)
        ax.set_xlabel("Year")
        ax.set_ylabel("Yearly return (%)")
        ax.set_title(f"{symbol}: Yearly linear returns – strategy vs price")
        ax.legend()
        fig.tight_layout()
        fig.savefig(os.path.join(out_dir, f"{symbol}_yearly_linear_vs_price_best.png"), dpi=200)
        plt.close(fig)

    # 2) Yearly compounded bars
    years_comp = sorted(set(yearly_comp.index) & set(yearly_asset_comp.index))
    if years_comp:
        y_strat_comp = np.array([yearly_comp[y] for y in years_comp])
        y_asset_comp = np.array([yearly_asset_comp[y] for y in years_comp])

        x = np.arange(len(years_comp))
        width = 0.35
        fig, ax = plt.subplots(figsize=(10, 5))
        ax.bar(x - width / 2, y_strat_comp * 100.0, width, label="Strategy (Compounded)")
        ax.bar(x + width / 2, y_asset_comp * 100.0, width, label=f"{symbol} (Compounded)")
        set_year_ticks_every_5(ax, years_comp)
        ax.set_xlabel("Year")
        ax.set_ylabel("Yearly return (%)")
        ax.set_title(f"{symbol}: Yearly compounded returns – strategy vs price")
        ax.legend()
        fig.tight_layout()
        fig.savefig(os.path.join(out_dir, f"{symbol}_yearly_compound_vs_price_best.png"), dpi=200)
        plt.close(fig)
        
        # Export yearly returns JSON for dashboard
        yearly_returns_json = {
            "years": [int(y) for y in years_comp],
            "strategy_yearly_compounded": [float(y * 100.0) for y in y_strat_comp],
            "asset_yearly": [float(y * 100.0) for y in y_asset_comp],
        }
        _write_json(os.path.join(out_dir, f"{symbol}_yearly_returns.json"), yearly_returns_json)

    # 3) scenario counts per year (from daily_scenario closes)
    scen = scen_daily[scen_daily != ""]
    if not scen.empty:
        sc_counts = scen.groupby([scen.index.year, scen.values]).size().unstack(fill_value=0)
        years_sc = sc_counts.index.tolist()
        x = np.arange(len(years_sc))
        fig, ax = plt.subplots(figsize=(10, 5))
        bottom = np.zeros(len(years_sc))
        for sc in ["TP", "SL", "FLAT"]:
            if sc in sc_counts.columns:
                vals = sc_counts[sc].values
                ax.bar(x, vals, bottom=bottom, label=sc)
                bottom += vals
        set_year_ticks_every_5(ax, years_sc)
        ax.set_xlabel("Year")
        ax.set_ylabel("Number of closes")
        ax.set_title(f"{symbol}: Yearly scenario counts (TP / SL / FLAT) – best system")
        ax.legend()
        fig.tight_layout()
        fig.savefig(os.path.join(out_dir, f"{symbol}_yearly_scenarios_best.png"), dpi=200)
        plt.close(fig)
# ================================
# HTML VOXEL CUBE (CAGR FIELD)
# ================================

def make_html_voxel_cube(df_res: pd.DataFrame, symbol: str, out_dir: str, tp_merge: int = 1, sl_merge: int = 1, h_merge: int = 1):
    df = df_res.copy()
    if df.empty:
        return

    tp_vals = np.sort(df["tp_frac"].unique())
    sl_vals = np.sort(df["sl_frac"].unique())
    h_vals = np.sort(df["horizon_days"].unique())
    if len(tp_vals) == 0 or len(sl_vals) == 0 or len(h_vals) == 0:
        return

    tp_idx_map = {v: i for i, v in enumerate(tp_vals)}
    sl_idx_map = {v: i for i, v in enumerate(sl_vals)}
    h_idx_map = {v: i for i, v in enumerate(h_vals)}

    df["tp_idx"] = df["tp_frac"].map(tp_idx_map)
    df["sl_idx"] = df["sl_frac"].map(sl_idx_map)
    df["h_idx"] = df["horizon_days"].map(h_idx_map)

    df["tp_bin"] = df["tp_idx"] // tp_merge
    df["sl_bin"] = df["sl_idx"] // sl_merge
    df["h_bin"] = df["h_idx"] // h_merge

    # CAGR voxel cube (mean CAGR % per aggregated cell)
    agg = df.groupby(["tp_bin", "sl_bin", "h_bin"], as_index=False).agg({
        "tp_frac": "mean",
        "sl_frac": "mean",
        "horizon_days": "mean",
        "compounded_cagr_pct": "mean"
    })
    if agg.empty:
        print("No data for voxel cube after aggregation.")
        return

    pnl_dict = {
        (int(r.tp_bin), int(r.sl_bin), int(r.h_bin)): float(r.compounded_cagr_pct)
        for _, r in agg.iterrows()
    }

    nxb = agg["tp_bin"].max() + 1
    nyb = agg["sl_bin"].max() + 1
    nzb = agg["h_bin"].max() + 1

    X, Y, Z = [], [], []
    I, J, K = [], [], []
    intensity = []
    cube_count = 0

    for bx in range(nxb):
        for by in range(nyb):
            for bz in range(nzb):
                key = (bx, by, bz)
                if key not in pnl_dict:
                    continue
                val = pnl_dict[key]

                x0, x1 = float(bx), float(bx + 1)
                y0, y1 = float(by), float(by + 1)
                z0, z1 = float(bz), float(bz + 1)

                verts = [
                    (x0, y0, z0),
                    (x1, y0, z0),
                    (x1, y1, z0),
                    (x0, y1, z0),
                    (x0, y0, z1),
                    (x1, y0, z1),
                    (x1, y1, z1),
                    (x0, y1, z1),
                ]

                base = len(X)
                for (xx, yy, zz) in verts:
                    X.append(xx); Y.append(yy); Z.append(zz)
                    intensity.append(val)

                faces = [
                    (0, 1, 2), (0, 2, 3),
                    (4, 5, 6), (4, 6, 7),
                    (0, 1, 5), (0, 5, 4),
                    (1, 2, 6), (1, 6, 5),
                    (2, 3, 7), (2, 7, 6),
                    (3, 0, 4), (3, 4, 7),
                ]
                for (a, b, c) in faces:
                    I.append(base + a)
                    J.append(base + b)
                    K.append(base + c)

                cube_count += 1

    if cube_count == 0:
        print("No cubes generated for voxel cube.")
        return

    X = np.array(X); Y = np.array(Y); Z = np.array(Z)
    intensity = np.array(intensity)
    vmin, vmax = np.percentile(intensity, [5, 95])

    mesh = go.Mesh3d(
        x=X, y=Y, z=Z,
        i=I, j=J, k=K,
        intensity=intensity,
        colorscale="Plasma",
        cmin=vmin, cmax=vmax,
        opacity=1.0,
        flatshading=True,
        colorbar=dict(title="CAGR (%)")
    )

    fig = go.Figure(data=[mesh])
    fig.update_layout(
        title=f"{symbol}: TP–SL–H voxel cube (CAGR %, merged)",
        height=900,
        scene=dict(
            xaxis_title="TP bin (higher = larger TP)",
            yaxis_title="SL bin (higher = larger SL)",
            zaxis_title="Horizon bin (higher = longer horizon)",
            aspectmode="cube"
        )
    )

    html_path = os.path.join(out_dir, f"{symbol}_voxel_cube_cagr.html")
    fig.write_html(html_path)
    webbrowser.open("file://" + os.path.abspath(html_path))
    print(f"HTML voxel cube saved and opened: {html_path} (cubes: {cube_count})")
    
    # Export voxel points JSON for dashboard (use original data, not aggregated)
    voxel_json = {
        "tp": [float(x) for x in df_res["tp_frac"].values],
        "sl": [float(x) for x in df_res["sl_frac"].values],
        "h": [int(x) for x in df_res["horizon_days"].values],
        "metric": [float(x) for x in df_res["compounded_cagr_pct"].values],
        "metric_name": "compounded_cagr",
        "colorscale": DASH_COLOR_SCALE,
    }
    _write_json(os.path.join(out_dir, f"{symbol}_voxel_cube_cagr.json"), voxel_json)


# ================================
# DASHBOARD JSON EXPORT HELPERS
# ================================
DASH_COLOR_SCALE = "Viridis"

def _write_json(path: str, obj: dict):
    """Helper to write JSON file."""
    with open(path, "w") as f:
        json.dump(obj, f, indent=2)


# ================================
# VISUALS
# ================================

def save_tp_sl_heatmap_grid(df_all: pd.DataFrame, horizons: list, value_col: str, title: str, out_path: str):
    """
    6-panel heatmap layout with a single external colorbar on the RIGHT (no overlay).
    Also exports JSON data for interactive dashboard.
    """
    fig, axes = plt.subplots(2, 3, figsize=(14, 8))
    axes = axes.ravel()

    vmin = np.nanpercentile(df_all[value_col], 5)
    vmax = np.nanpercentile(df_all[value_col], 95)

    # Collect data for JSON export
    json_data = {
        "title": title,
        "metric_name": "cagr" if "cagr" in value_col.lower() else "annual_linear_pl",
        "horizons": {},
        "vmin": float(vmin),
        "vmax": float(vmax),
    }
    
    # Get TP and SL values from first horizon (they should be consistent)
    first_h = horizons[0]
    first_sub = df_all[df_all["horizon_days"] == first_h]
    if not first_sub.empty:
        tp_values = sorted(first_sub["tp_frac"].unique())
        sl_values = sorted(first_sub["sl_frac"].unique())
        json_data["tp_values"] = [float(x) for x in tp_values]
        json_data["sl_values"] = [float(x) for x in sl_values]

    last_im = None
    for ax, h in zip(axes, horizons):
        sub = df_all[df_all["horizon_days"] == h]
        pivot = sub.pivot(index="sl_frac", columns="tp_frac", values=value_col)

        # Export matrix to JSON
        if not pivot.empty:
            # Convert to list of lists (SL rows, TP columns)
            matrix = []
            for sl_val in sl_values:
                row = []
                for tp_val in tp_values:
                    if sl_val in pivot.index and tp_val in pivot.columns:
                        val = pivot.loc[sl_val, tp_val]
                        row.append(float(val) if not pd.isna(val) else None)
                    else:
                        row.append(None)
                matrix.append(row)
            json_data["horizons"][str(h)] = {"z": matrix}

        last_im = ax.imshow(
            pivot.values, origin="lower", aspect="auto",
            extent=[pivot.columns.min(), pivot.columns.max(),
                    pivot.index.min(), pivot.index.max()],
            vmin=vmin, vmax=vmax, cmap="plasma"
        )
        ax.set_title(f"H={h}d")
        ax.set_xlabel("TP fraction")
        ax.set_ylabel("SL fraction")

    fig.suptitle(title, fontsize=14)

    # Leave room for the colorbar and avoid overlaps
    fig.subplots_adjust(right=0.88, top=0.90, wspace=0.25, hspace=0.25)

    # Dedicated colorbar axis on the right
    cax = fig.add_axes([0.90, 0.15, 0.02, 0.70])
    cbar = fig.colorbar(last_im, cax=cax)
    cbar.set_label(value_col)

    fig.savefig(out_path, dpi=200)
    plt.close(fig)
    
    # Export JSON (same base name, .json extension)
    json_path = out_path.replace(".png", ".json")
    _write_json(json_path, json_data)


def make_visualizations(df_res: pd.DataFrame, symbol: str, out_dir: str, asset_stats: dict, df_price: pd.DataFrame):
    if df_res.empty:
        return

    df = df_res.copy()

    asset_total = asset_stats["total_ret"]
    asset_annual_lin = asset_stats["annual_lin"]
    asset_cagr = asset_stats["annual_cagr"]

    # ratios
    df["ratio_total_vs_asset"] = df["pnl_linear"] / asset_total if abs(asset_total) > 1e-12 else np.nan
    df["ratio_annual_vs_asset"] = df["pnl_linear_per_year"] / asset_annual_lin if abs(asset_annual_lin) > 1e-12 else np.nan
    df["ratio_cagr_vs_asset"] = df["compounded_cagr"] / asset_cagr if abs(asset_cagr) > 1e-12 else np.nan

    # Best system by CAGR
    best_idx = df["compounded_cagr"].idxmax()
    best_row = df.loc[best_idx]

    # =========================
    # 1) Best horizon by avg CAGR
    # =========================
    grp_h = df.groupby("horizon_days")["compounded_cagr_pct"].mean()
    best_h = int(grp_h.idxmax())
    print(f"\nBest horizon (by avg CAGR): h = {best_h} days")

    subset_h = df[df["horizon_days"] == best_h].copy()

    # =========================
    # 2) Heatmap TP vs SL (best_h) – CAGR %
    # =========================
    pivot_cagr = subset_h.pivot(index="sl_frac", columns="tp_frac", values="compounded_cagr_pct")
    if not pivot_cagr.empty:
        plt.figure(figsize=(8, 6))
        im = plt.imshow(
            pivot_cagr.values, origin="lower", aspect="auto",
            extent=[pivot_cagr.columns.min(), pivot_cagr.columns.max(),
                    pivot_cagr.index.min(), pivot_cagr.index.max()],
            cmap="plasma"
        )
        plt.colorbar(im, label="CAGR (%)")
        plt.xlabel("TP fraction")
        plt.ylabel("SL fraction")
        plt.title(f"{symbol}: CAGR (TP vs SL, horizon={best_h}d)")
        plt.tight_layout()
        plt.savefig(os.path.join(out_dir, f"{symbol}_heatmap_cagr_tp_sl_h{best_h}.png"), dpi=200)
        plt.close()

    # =========================
    # 3) Heatmap TP vs SL (best_h) – L1 prediction rate
    # =========================
    pivot_l1 = subset_h.pivot(index="sl_frac", columns="tp_frac", values="label1_ratio")
    if not pivot_l1.empty:
        plt.figure(figsize=(8, 6))
        im = plt.imshow(
            pivot_l1.values, origin="lower", aspect="auto",
            extent=[pivot_l1.columns.min(), pivot_l1.columns.max(),
                    pivot_l1.index.min(), pivot_l1.index.max()],
            cmap="plasma"
        )
        plt.colorbar(im, label="L1 prediction rate")
        plt.xlabel("TP fraction")
        plt.ylabel("SL fraction")
        plt.title(f"{symbol}: L1 prediction rate (TP vs SL, horizon={best_h}d)")
        plt.tight_layout()
        plt.savefig(os.path.join(out_dir, f"{symbol}_heatmap_label1_tp_sl_h{best_h}.png"), dpi=200)
        plt.close()

    # =========================
    # 4) Heatmap spread vs horizon (CAGR)
    # =========================
    pivot_spread_h = df.pivot_table(
        index="spread", columns="horizon_days",
        values="compounded_cagr_pct", aggfunc="mean"
    ).sort_index()
    if not pivot_spread_h.empty:
        plt.figure(figsize=(10, 6))
        im = plt.imshow(
            pivot_spread_h.values, origin="lower", aspect="auto",
            extent=[pivot_spread_h.columns.min(), pivot_spread_h.columns.max(),
                    pivot_spread_h.index.min(), pivot_spread_h.index.max()],
            cmap="plasma"
        )
        plt.colorbar(im, label="CAGR (%)")
        plt.xlabel("Horizon (days)")
        plt.ylabel("TP - SL (spread)")
        plt.title(f"{symbol}: CAGR (spread vs horizon)")
        plt.tight_layout()
        plt.savefig(os.path.join(out_dir, f"{symbol}_heatmap_cagr_spread_horizon.png"), dpi=200)
        plt.close()

    # =========================
    # 5) 3D scatter TP–SL–H vs ratio (sample horizon every 5th)
    # =========================
    df_plot = df[df["horizon_days"] % 5 == 0].copy()

    if RATIO_METRIC_MODE.upper() == "COMPOUNDED":
        metric = "ratio_cagr_vs_asset"
        metric_label = "Ratio: System CAGR / Asset CAGR"
    else:
        metric = "ratio_annual_vs_asset"
        metric_label = "Ratio: System annual linear / Asset annual linear"

    vals = df_plot[metric].to_numpy()
    valid = ~np.isnan(vals)
    if valid.sum() > 0:
        vmin, vmax = np.percentile(vals[valid], [2, 98])

        fig = plt.figure(figsize=(9, 7))
        ax = fig.add_subplot(111, projection="3d")
        sc2 = ax.scatter(
            df_plot["tp_frac"],
            df_plot["sl_frac"],
            df_plot["horizon_days"],
            c=vals,
            s=6,
            alpha=0.75,
            cmap="viridis",
            vmin=vmin,
            vmax=vmax
        )

        topN_ratio = df_plot.sort_values(metric, ascending=False).head(100)
        ax.scatter(
            topN_ratio["tp_frac"],
            topN_ratio["sl_frac"],
            topN_ratio["horizon_days"],
            s=40,
            facecolors="none",
            edgecolors="white",
            linewidths=1.5
        )

        ax.set_xlabel("TP fraction")
        ax.set_ylabel("SL fraction")
        ax.set_zlabel("Horizon (days)")
        ax.invert_yaxis()

        cb = fig.colorbar(sc2, ax=ax)
        cb.set_label(metric_label)

        ax.set_title(f"{symbol}: TP–SL–H vs ratio (3D, horizon sampled every 5d)")
        plt.tight_layout()
        plt.savefig(os.path.join(out_dir, f"{symbol}_3d_tp_sl_h_ratio_vs_asset.png"), dpi=200)
        plt.close(fig)

    # =========================
    # 6) Scatter horizon vs spread (color = CAGR)
    # =========================
    plt.figure(figsize=(8, 5))
    sc = plt.scatter(
        df["horizon_days"], df["spread"],
        c=df["compounded_cagr_pct"],
        s=6, alpha=0.55, cmap="viridis"
    )
    plt.xlabel("Horizon (days)")
    plt.ylabel("TP - SL (spread)")
    plt.title(f"{symbol}: Horizon vs spread (color = CAGR)")
    cb = plt.colorbar(sc)
    cb.set_label("CAGR (%)")
    plt.grid(True, linestyle="--", alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, f"{symbol}_scatter_horizon_vs_spread_cagr.png"), dpi=200)
    plt.close()

    # =========================
    # 7) Risk–return cloud (y = CAGR)
    # =========================
    plt.figure(figsize=(8, 5))
    plt.scatter(df["max_drawdown_pct"], df["compounded_cagr_pct"], s=6, alpha=0.45)
    plt.xlabel("Max drawdown (%)")
    plt.ylabel("CAGR (%)")
    plt.title(f"{symbol}: Risk–return (CAGR vs max drawdown)")
    plt.grid(True, linestyle="--", alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, f"{symbol}_risk_return_cagr_vs_maxdd.png"), dpi=200)
    plt.close()

    # =========================
    # 8) CAGR vs winrate
    # =========================
    plt.figure(figsize=(8, 5))
    plt.scatter(df["label1_ratio"], df["compounded_cagr_pct"], s=6, alpha=0.4)
    plt.xlabel("L1 prediction rate")
    plt.ylabel("CAGR (%)")
    plt.title(f"{symbol}: CAGR vs L1 prediction rate")
    plt.grid(True, linestyle="--", alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, f"{symbol}_cagr_vs_winrate.png"), dpi=200)
    plt.close()

    # =========================
    # 9) Histograms
    # =========================
    # EXCEPTION 2: Keep annual linear P/L histogram (as requested)
    plt.figure(figsize=(8, 4))
    plt.hist(df["pnl_linear_per_year_pct"].dropna(), bins=60)
    plt.xlabel("Annual linear P/L (%)")
    plt.ylabel("Count of systems")
    plt.title(f"{symbol}: Annual linear P/L distribution")
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, f"{symbol}_hist_annual_pnl_per_year.png"), dpi=200)
    plt.close()

    # CAGR histogram
    plt.figure(figsize=(8, 4))
    plt.hist(df["compounded_cagr_pct"].dropna(), bins=60)
    plt.xlabel("CAGR (%)")
    plt.ylabel("Count of systems")
    plt.title(f"{symbol}: CAGR distribution")
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, f"{symbol}_hist_cagr.png"), dpi=200)
    plt.close()

    # =========================
    # 10) Envelope heatmap (best CAGR over horizons)
    # =========================
    best_env = df.groupby(["sl_frac", "tp_frac"])["compounded_cagr_pct"].max().reset_index()
    pivot_env = best_env.pivot(index="sl_frac", columns="tp_frac", values="compounded_cagr_pct")
    if not pivot_env.empty:
        plt.figure(figsize=(8, 6))
        im = plt.imshow(
            pivot_env.values, origin="lower", aspect="auto",
            extent=[pivot_env.columns.min(), pivot_env.columns.max(),
                    pivot_env.index.min(), pivot_env.index.max()],
            cmap="plasma"
        )
        plt.colorbar(im, label="Best CAGR (%)\n(max over horizons)")
        plt.xlabel("TP fraction")
        plt.ylabel("SL fraction")
        plt.title(f"{symbol}: Envelope CAGR (TP vs SL, best horizon per pair)")
        plt.tight_layout()
        plt.savefig(os.path.join(out_dir, f"{symbol}_heatmap_envelope_best_cagr_tp_sl.png"), dpi=200)
        plt.close()

    # =========================
    # 11) CAGR vs horizon (spread groups) with uniform plasma scale
    # =========================
    df_line = df.copy()
    n_bins = 8
    df_line["spread_bin"] = pd.qcut(df_line["spread"], n_bins, duplicates="drop")

    groups = list(df_line.groupby("spread_bin", observed=True))
    groups.sort(key=lambda x: float(x[0].left) if hasattr(x[0], "left") else 0.0)

    cmap = plt.cm.plasma
    plt.figure(figsize=(9, 5))
    for idx, (label, grp) in enumerate(groups):
        grp2 = grp.groupby("horizon_days")["compounded_cagr_pct"].mean().reset_index()
        color = cmap(idx / max(len(groups) - 1, 1))
        plt.plot(grp2["horizon_days"], grp2["compounded_cagr_pct"], alpha=0.85, label=str(label), color=color)

    plt.xlabel("Horizon (days)")
    plt.ylabel("CAGR (%)")
    plt.title(f"{symbol}: CAGR vs horizon (grouped by spread)")
    plt.grid(True, linestyle="--", alpha=0.3)
    plt.legend(fontsize=7)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, f"{symbol}_cagr_vs_horizon_spread_groups.png"), dpi=200)
    plt.close()

    # =========================
    # 12) Correlation matrix
    # =========================
    corr_cols = [
        "tp_frac", "sl_frac", "spread", "horizon_days",
        "trades", "trades_per_year", "label1_ratio",
        "compounded_cagr_pct",
        "max_drawdown_pct", "sharpe_annual", "calmar_ratio",
        "ratio_annual_vs_asset", "ratio_cagr_vs_asset"
    ]
    corr_cols = [c for c in corr_cols if c in df.columns]
    corr = df[corr_cols].corr()

    plt.figure(figsize=(10, 8))
    ax = plt.gca()
    im = ax.imshow(corr.values, origin="lower", aspect="auto")
    plt.colorbar(im, label="Correlation")
    plt.xticks(range(len(corr_cols)), corr_cols, rotation=90)
    plt.yticks(range(len(corr_cols)), corr_cols)
    for i in range(len(corr_cols)):
        ax.add_patch(Rectangle((i - 0.5, i - 0.5), 1, 1, facecolor="white", edgecolor="white"))
    plt.title(f"{symbol}: Correlation matrix (params, performance, risk)")
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, f"{symbol}_correlation_matrix.png"), dpi=200)
    plt.close()

    # =========================
    # 13) 6-panel heatmap layouts (CAGR)
    # =========================
    hs = [1, 5, 20, 50, 100, 200]

    save_tp_sl_heatmap_grid(
        df_all=df,
        horizons=hs,
        value_col="compounded_cagr_pct",
        title=f"{symbol}: TP–SL heatmaps (CAGR %) for key horizons",
        out_path=os.path.join(out_dir, f"{symbol}_tp_sl_heatmap_grid_cagr.png")
    )
    
    # Also export annual linear P/L heatmap grid (if data available)
    if "pnl_linear_per_year_pct" in df.columns:
        save_tp_sl_heatmap_grid(
            df_all=df,
            horizons=hs,
            value_col="pnl_linear_per_year_pct",
            title=f"{symbol}: TP–SL heatmaps (Annual Linear P/L %) for key horizons",
            out_path=os.path.join(out_dir, f"{symbol}_tp_sl_heatmap_grid_annual_linear_pl.png")
        )

    # =========================
    # 14) Time-based visuals for best system
    # =========================
    make_time_visuals_for_best_system(df_price, best_row, symbol, out_dir)

    # =========================
    # 15) Voxel cube (CAGR)
    # =========================
    make_html_voxel_cube(df_res, symbol, out_dir, tp_merge=1, sl_merge=1, h_merge=1)


# ================================
# RAW DATA EXPORTS FOR INTERACTIVE DASHBOARD
# ================================

def export_voxel_data(df_res: pd.DataFrame, out_dir: str):
    """Export voxel points for 3D interactive plot."""
    if df_res.empty:
        return
    
    # Full dataset
    voxel_points = []
    for _, row in df_res.iterrows():
        voxel_points.append({
            "tp": float(row["tp_frac"]),
            "sl": float(row["sl_frac"]),
            "h": int(row["horizon_days"]),
            "metric": float(row["compounded_cagr_pct"]),
            "metric_name": "cagr"
        })
    
    with open(os.path.join(out_dir, "voxel_points.json"), "w") as f:
        json.dump(voxel_points, f, indent=2)
    
    # Top 10% by CAGR
    df_top = df_res.nlargest(max(1, len(df_res) // 10), "compounded_cagr_pct")
    voxel_top = []
    for _, row in df_top.iterrows():
        voxel_top.append({
            "tp": float(row["tp_frac"]),
            "sl": float(row["sl_frac"]),
            "h": int(row["horizon_days"]),
            "metric": float(row["compounded_cagr_pct"]),
            "metric_name": "cagr"
        })
    
    with open(os.path.join(out_dir, "voxel_points_top.json"), "w") as f:
        json.dump(voxel_top, f, indent=2)


def export_heatmap_data(df_res: pd.DataFrame, out_dir: str):
    """Export heatmap matrices for key horizons."""
    if df_res.empty:
        return
    
    tp_values = sorted(df_res["tp_frac"].unique())
    sl_values = sorted(df_res["sl_frac"].unique())
    horizons = [1, 5, 20, 50, 100, 200]
    
    # CAGR heatmaps
    heatmaps_cagr = {
        "metric_name": "cagr",
        "horizons": {},
        "tp_values": [float(x) for x in tp_values],
        "sl_values": [float(x) for x in sl_values]
    }
    
    for h in horizons:
        df_h = df_res[df_res["horizon_days"] == h]
        if df_h.empty:
            continue
        
        matrix = []
        for sl in sl_values:
            row = []
            for tp in tp_values:
                matches = df_h[(df_h["tp_frac"] == tp) & (df_h["sl_frac"] == sl)]
                if not matches.empty:
                    row.append(matches["compounded_cagr_pct"].iloc[0])
                else:
                    row.append(None)
            matrix.append(row)
        
        heatmaps_cagr["horizons"][str(h)] = matrix
    
    with open(os.path.join(out_dir, "heatmaps_cagr.json"), "w") as f:
        json.dump(heatmaps_cagr, f, indent=2)
    
    # Linear annual P/L heatmaps
    heatmaps_linear = {
        "metric_name": "linear",
        "horizons": {},
        "tp_values": [float(x) for x in tp_values],
        "sl_values": [float(x) for x in sl_values]
    }
    
    for h in horizons:
        df_h = df_res[df_res["horizon_days"] == h]
        if df_h.empty:
            continue
        
        matrix = []
        for sl in sl_values:
            row = []
            for tp in tp_values:
                matches = df_h[(df_h["tp_frac"] == tp) & (df_h["sl_frac"] == sl)]
                if not matches.empty:
                    row.append(matches["pnl_linear_per_year_pct"].iloc[0])
                else:
                    row.append(None)
            matrix.append(row)
        
        heatmaps_linear["horizons"][str(h)] = matrix
    
    with open(os.path.join(out_dir, "heatmaps_linear.json"), "w") as f:
        json.dump(heatmaps_linear, f, indent=2)


def _density_preserving_sample_indices(
    x: np.ndarray,
    y: np.ndarray,
    max_points: int = 14000,
    nx: int = 40,
    ny: int = 40,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """
    Subsample row indices so the 2D scatter still reflects the full (x,y) domain.
    Uses a uniform grid in data space and caps points per occupied cell — avoids
    arbitrary "first N rows" bias when JSON size must stay bounded.
    """
    rng = rng or np.random.default_rng(42)
    n = len(x)
    if n <= max_points:
        return np.arange(n, dtype=int)
    finite = np.isfinite(x) & np.isfinite(y)
    if not finite.any():
        return np.arange(min(max_points, n), dtype=int)
    xf = x[finite]
    yf = y[finite]
    orig_idx = np.nonzero(finite)[0]
    xmin, xmax = float(np.min(xf)), float(np.max(xf))
    ymin, ymax = float(np.min(yf)), float(np.max(yf))
    span_x = xmax - xmin
    span_y = ymax - ymin
    if span_x <= 1e-15:
        span_x = 1.0
    if span_y <= 1e-15:
        span_y = 1.0
    xe = np.linspace(xmin, xmax, nx + 1)
    ye = np.linspace(ymin, ymax, ny + 1)
    xi = np.searchsorted(xe, np.clip(xf, xmin, xmax), side="right") - 1
    yi = np.searchsorted(ye, np.clip(yf, ymin, ymax), side="right") - 1
    xi = np.clip(xi, 0, nx - 1)
    yi = np.clip(yi, 0, ny - 1)
    cell_to_rows: dict[tuple[int, int], list[int]] = {}
    for k in range(len(orig_idx)):
        key = (int(xi[k]), int(yi[k]))
        cell_to_rows.setdefault(key, []).append(int(orig_idx[k]))
    cells = [rows for rows in cell_to_rows.values() if rows]
    if not cells:
        return rng.choice(n, size=min(max_points, n), replace=False)
    per_cell = max(1, max_points // len(cells))
    out: list[int] = []
    for rows in cells:
        arr = np.array(rows, dtype=int)
        if len(arr) <= per_cell:
            out.extend(arr.tolist())
        else:
            out.extend(rng.choice(arr, size=per_cell, replace=False).tolist())
    out_arr = np.array(out, dtype=int)
    if len(out_arr) > max_points:
        out_arr = rng.choice(out_arr, size=max_points, replace=False)
    return np.unique(out_arr)


def _histogram_annual_pl_edges_counts(pnl_values: pd.Series) -> tuple[np.ndarray, np.ndarray]:
    """Freedman–Diaconis–style bin count, clamped for readable dashboard bars."""
    arr = pnl_values.astype(float).values
    arr = arr[np.isfinite(arr)]
    if len(arr) < 2:
        return np.array([], dtype=float), np.array([], dtype=int)
    q75, q25 = np.percentile(arr, [75, 25])
    iqr = float(q75 - q25)
    span = float(arr.max() - arr.min())
    n = len(arr)
    if iqr > 1e-12 and span > 0:
        h = 2.0 * iqr / (n ** (1.0 / 3.0))
        nbins = int(np.ceil(span / h)) if h > 1e-12 else int(np.sqrt(n))
    else:
        nbins = int(np.sqrt(n))
    nbins = int(np.clip(nbins, 16, 64))
    counts, edges = np.histogram(arr, bins=nbins)
    return edges, counts


def export_metrics_json(df_res: pd.DataFrame, symbol: str, start: str, end: str, asset_stats: dict, out_dir: str):
    """Export summary metrics as JSON."""
    if df_res.empty:
        return
    
    best = df_res.nlargest(1, "compounded_cagr_pct").iloc[0]
    
    metrics = {
        "symbol": symbol,
        "start": start,
        "end": end,
        "best_tp": float(best["tp_frac"]),
        "best_sl": float(best["sl_frac"]),
        "best_h": int(best["horizon_days"]),
        "best_cagr": float(best["compounded_cagr_pct"]),
        "best_linear_annual_pl": float(best["pnl_linear_per_year_pct"]),
        "max_drawdown": float(min(0, max(-100, best["max_drawdown_pct"]))),
        "trades": int(best["trades"]),
        "asset_total_ret_pct": float(asset_stats.get("total_ret_pct", 0)),
        "asset_annual_cagr_pct": float(asset_stats.get("annual_cagr_pct", 0)),
        "compounded_return_pct": float(best.get("compounded_return_pct", 0)),
        "compounded_return_per_year": float(best.get("compounded_cagr_pct", 0))  # CAGR is already per-year
    }
    
    # Add win rate if label1_ratio exists
    if "label1_ratio" in best and not pd.isna(best["label1_ratio"]):
        metrics["win_rate"] = float(best["label1_ratio"])
    
    # Add volatility if available
    if "volatility_annual" in best and not pd.isna(best["volatility_annual"]):
        metrics["volatility_annual"] = float(best["volatility_annual"])
    elif "sharpe_annual" in best and not pd.isna(best["sharpe_annual"]):
        # Approximate volatility from Sharpe if CAGR and Sharpe are available
        if metrics["best_cagr"] != 0 and best["sharpe_annual"] != 0:
            metrics["volatility_annual"] = abs(metrics["best_cagr"] / best["sharpe_annual"])
    
    # Add risk-adjusted metrics
    if "sharpe_annual" in best and not pd.isna(best["sharpe_annual"]):
        metrics["sharpe_annual"] = float(best["sharpe_annual"])
    if "calmar_ratio" in best and not pd.isna(best["calmar_ratio"]):
        metrics["calmar_ratio"] = float(best["calmar_ratio"])
    if metrics["max_drawdown"] != 0:
        metrics["return_drawdown_ratio"] = abs(metrics["best_cagr"] / metrics["max_drawdown"])
    
    # Add additional data for advanced charts (only if data is valid)
    try:
        # 1. Scatter: CAGR vs max DD (+ pnl for optional use). Full grid when small;
        #    density-preserving subsample when large (keeps ~14k points for Plotly scattergl).
        SCATTER_MAX = 14000
        if len(df_res) > 0:
            valid_scatter = df_res[["max_drawdown_pct", "pnl_linear", "compounded_cagr_pct"]].dropna()
            if len(valid_scatter) > 0:
                total_sc = len(valid_scatter)
                idx = _density_preserving_sample_indices(
                    valid_scatter["max_drawdown_pct"].to_numpy(dtype=float),
                    valid_scatter["compounded_cagr_pct"].to_numpy(dtype=float),
                    max_points=SCATTER_MAX,
                )
                sub = valid_scatter.iloc[idx]
                metrics["scatter_data"] = {
                    "max_dd": sub["max_drawdown_pct"].tolist(),
                    "pnl": sub["pnl_linear"].tolist(),
                    "cagr": sub["compounded_cagr_pct"].tolist(),
                    "total_points": int(total_sc),
                    "displayed_points": int(len(sub)),
                    "sampled": bool(total_sc > len(sub)),
                }

        # 2. Histogram: annual linear P/L % across all grid rows — FD bins + bar-friendly centers/widths
        if "pnl_linear_per_year_pct" in df_res.columns:
            pnl_values = df_res["pnl_linear_per_year_pct"].dropna()
            if len(pnl_values) > 10:
                edges, counts = _histogram_annual_pl_edges_counts(pnl_values)
                if len(counts) > 0:
                    centers = (edges[:-1] + edges[1:]) / 2.0
                    widths = np.diff(edges)
                    metrics["hist_data"] = {
                        "centers": centers.tolist(),
                        "widths": widths.tolist(),
                        "counts": counts.astype(int).tolist(),
                        "bin_edges": edges.tolist(),
                        "bins": edges[:-1].tolist(),
                    }

        # 3. L1 rate vs cumulative linear return (fraction); same sampling strategy as scatter
        if "label1_ratio" in df_res.columns and "pnl_linear" in df_res.columns:
            valid_data = df_res[["label1_ratio", "pnl_linear"]].dropna()
            if len(valid_data) > 5:
                total_pd = len(valid_data)
                idx_pd = _density_preserving_sample_indices(
                    valid_data["label1_ratio"].to_numpy(dtype=float),
                    valid_data["pnl_linear"].to_numpy(dtype=float),
                    max_points=SCATTER_MAX,
                )
                sub_pd = valid_data.iloc[idx_pd]
                metrics["prediction_data"] = {
                    "l1_rate": sub_pd["label1_ratio"].tolist(),
                    "pnl": sub_pd["pnl_linear"].tolist(),
                    "total_points": int(total_pd),
                    "displayed_points": int(len(sub_pd)),
                    "sampled": bool(total_pd > len(sub_pd)),
                }

        # 4. Benchmark data for best system vs benchmarks
        try:
            best_cagr = float(best["compounded_cagr_pct"]) if not pd.isna(best["compounded_cagr_pct"]) else 0
            asset_cagr = float(asset_stats.get("annual_cagr_pct", 0))

            # Calculate additional benchmarks based on typical market performance
            # S&P 500 historical average ~8-10%, Bonds ~3-5%, Risk-free ~2-3%
            sp500_cagr = 9.5  # Approximate long-term S&P 500 CAGR
            bonds_cagr = 4.2  # Approximate bond returns
            risk_free_cagr = 2.8  # Approximate T-bill returns

            metrics["benchmark_data"] = {
                "names": ["Best System", "Asset (Buy & Hold)", "S&P 500", "Bonds", "Risk-Free"],
                "values": [best_cagr, asset_cagr, sp500_cagr, bonds_cagr, risk_free_cagr]
            }
        except Exception as e:
            print(f"Warning: Benchmark calculation failed: {e}")
            # Fallback
            best_cagr = float(best["compounded_cagr_pct"]) if not pd.isna(best["compounded_cagr_pct"]) else 0
            asset_cagr = float(asset_stats.get("annual_cagr_pct", 0))
            metrics["benchmark_data"] = {
                "names": ["Best System", "Buy & Hold"],
                "values": [best_cagr, asset_cagr]
            }

        # 5. Correlation matrix data (simplified)
        corr_cols = ["tp_frac", "sl_frac", "compounded_cagr_pct", "max_drawdown_pct"]
        corr_cols = [c for c in corr_cols if c in df_res.columns and df_res[c].notna().any()]
        if len(corr_cols) >= 2 and len(df_res) > 5:
            try:
                corr_matrix = df_res[corr_cols].corr()
                # Convert NaN to 0 for JSON serialization
                corr_matrix = corr_matrix.fillna(0)
                metrics["correlation_data"] = {
                    "matrix": corr_matrix.values.tolist(),
                    "labels": corr_cols
                }
            except:
                pass  # Skip correlation if it fails

    except Exception as e:
        print(f"Warning: Failed to export advanced chart data: {e}")
        # Continue without advanced data

    with open(os.path.join(out_dir, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)


def export_horizon_best_data(df_res: pd.DataFrame, out_dir: str):
    """Export best CAGR per horizon (for CAGR vs Horizon Spread chart)."""
    if df_res.empty:
        return
    
    # Group by horizon, find best CAGR for each
    horizon_best = []
    for h in sorted(df_res["horizon_days"].unique()):
        df_h = df_res[df_res["horizon_days"] == h]
        if df_h.empty:
            continue
        best_row = df_h.nlargest(1, "compounded_cagr_pct").iloc[0]
        horizon_best.append({
            "horizon": int(h),
            "best_cagr": float(best_row["compounded_cagr_pct"]),
            "tp": float(best_row["tp_frac"]),
            "sl": float(best_row["sl_frac"]),
        })
    
    with open(os.path.join(out_dir, "horizon_best.json"), "w") as f:
        json.dump({"data": horizon_best}, f, indent=2)


def export_cagr_vs_horizon_spread_json(df_res: pd.DataFrame, out_dir: str, n_bins: int = 8) -> None:
    """
    Mean compounded_cagr_pct by horizon_days, with rows grouped by spread (tp_frac - sl_frac)
    quantile buckets. Matches the logic of the matplotlib CAGR vs horizon (spread groups) chart.
    """
    if df_res.empty:
        return

    df = df_res.copy()
    if "spread" not in df.columns:
        df["spread"] = df["tp_frac"] - df["sl_frac"]

    spread = df["spread"].astype(float)
    if spread.notna().sum() < 10:
        return

    n_bins = int(max(3, min(n_bins, spread.nunique(dropna=True))))
    try:
        df["spread_bin"] = pd.qcut(spread, q=n_bins, duplicates="drop")
    except (ValueError, TypeError):
        nb = int(min(n_bins, max(2, spread.nunique(dropna=True))))
        try:
            df["spread_bin"] = pd.cut(spread, bins=nb, duplicates="drop")
        except TypeError:
            try:
                df["spread_bin"] = pd.cut(spread, bins=nb)
            except (ValueError, TypeError):
                return
        except (ValueError, TypeError):
            return

    groups = list(df.groupby("spread_bin", observed=True))
    groups.sort(key=lambda x: float(x[0].left) if hasattr(x[0], "left") else 0.0)

    spread_groups: list[dict] = []
    for bin_interval, grp in groups:
        if grp.empty:
            continue
        if hasattr(bin_interval, "left") and hasattr(bin_interval, "right"):
            lo, hi = float(bin_interval.left), float(bin_interval.right)
            label_frac = f"({lo:.4f}, {hi:.4f}]"
            label_pct = f"({lo * 100:.2f}%, {hi * 100:.2f}%]"
            smin, smax = lo, hi
        else:
            label_frac = str(bin_interval)
            label_pct = label_frac
            smin, smax = None, None

        g2 = grp.groupby("horizon_days", as_index=False)["compounded_cagr_pct"].mean()
        g2 = g2.sort_values("horizon_days")
        if g2.empty:
            continue

        spread_groups.append(
            {
                "label": label_frac,
                "spread_pct_label": label_pct,
                "spread_min": smin,
                "spread_max": smax,
                "horizons": [int(h) for h in g2["horizon_days"].values],
                "cagr_values": [float(x) for x in g2["compounded_cagr_pct"].values],
            }
        )

    if not spread_groups:
        return

    payload = {
        "chart_id": "cagr_vs_horizon_spread",
        "spread_groups": spread_groups,
    }
    with open(os.path.join(out_dir, "cagr_vs_horizon_spread.json"), "w") as f:
        json.dump(payload, f, indent=2)


def export_best_system_timeseries(df_price: pd.DataFrame, best_row: pd.Series, symbol: str, out_dir: str):
    """Export cumulative compounded equity vs buy & hold, same compounding rules as grid KPIs."""
    tp = float(best_row["tp_frac"])
    sl = float(best_row["sl_frac"])
    h = int(best_row["horizon_days"])

    eq_series = simulate_compounded_equity_path(df_price, tp, sl, h, start_equity=1.0)
    if eq_series.empty or len(eq_series) < 2:
        return

    close = df_price["Close"].reindex(eq_series.index).ffill()
    if close.isna().all():
        return

    # Total return % from t0, shared calendar, identical index
    c0 = float(close.iloc[0])
    strat_pct = (eq_series / float(eq_series.iloc[0]) - 1.0) * 100.0
    asset_pct = (close / c0 - 1.0) * 100.0

    dates = [d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else str(d) for d in eq_series.index]

    timeseries = {
        "dates": dates,
        "strategy_compounded_pct": [float(x) for x in strat_pct.values],
        "asset_normalized_pct": [float(x) for x in asset_pct.values],
        "price_dates": dates,
        "price_normalized_pct": [float(x) for x in asset_pct.values],
        "aligned": True,
    }

    with open(os.path.join(out_dir, "best_system_timeseries.json"), "w") as f:
        json.dump(timeseries, f, indent=2)


def export_yearly_compounded_returns(df_price: pd.DataFrame, best_row: pd.Series, symbol: str, out_dir: str):
    """Yearly total return % from first to last session in each year (strategy equity path vs close)."""
    tp = float(best_row["tp_frac"])
    sl = float(best_row["sl_frac"])
    h = int(best_row["horizon_days"])

    eq_series = simulate_compounded_equity_path(df_price, tp, sl, h, start_equity=1.0)
    if eq_series.empty:
        return

    close = df_price["Close"].reindex(eq_series.index).ffill()

    years_list: list[int] = []
    strat_y: list[float] = []
    asset_y: list[float] = []

    for y in sorted(set(eq_series.index.year) & set(close.index.year)):
        eq_y = eq_series[eq_series.index.year == y]
        cl_y = close[close.index.year == y]
        if len(eq_y) < 2 or len(cl_y) < 2:
            continue
        years_list.append(int(y))
        strat_y.append(float((eq_y.iloc[-1] / eq_y.iloc[0] - 1.0) * 100.0))
        asset_y.append(float((cl_y.iloc[-1] / cl_y.iloc[0] - 1.0) * 100.0))

    if not years_list:
        return

    yearly_data = {
        "years": years_list,
        "strategy_compounded_pct": strat_y,
        "price_compounded_pct": asset_y,
    }

    with open(os.path.join(out_dir, "yearly_compounded.json"), "w") as f:
        json.dump(yearly_data, f, indent=2)


def export_best_system_heatmap(df_res: pd.DataFrame, best_row: pd.Series, out_dir: str):
    """Export envelope heatmap (TP×SL) for best horizon."""
    best_h = int(best_row["horizon_days"])
    
    # Get all systems at best horizon
    df_h = df_res[df_res["horizon_days"] == best_h].copy()
    if df_h.empty:
        return
    
    tp_values = sorted(df_h["tp_frac"].unique())
    sl_values = sorted(df_h["sl_frac"].unique())
    
    # Build matrix
    matrix = []
    for sl in sl_values:
        row = []
        for tp in tp_values:
            matches = df_h[(df_h["tp_frac"] == tp) & (df_h["sl_frac"] == sl)]
            if not matches.empty:
                row.append(float(matches["compounded_cagr_pct"].iloc[0]))
            else:
                row.append(None)
        matrix.append(row)
    
    heatmap_data = {
        "horizon": best_h,
        "tp_values": [float(x) for x in tp_values],
        "sl_values": [float(x) for x in sl_values],
        "matrix": matrix,
        "best_tp": float(best_row["tp_frac"]),
        "best_sl": float(best_row["sl_frac"]),
    }
    
    with open(os.path.join(out_dir, "best_system_heatmap.json"), "w") as f:
        json.dump(heatmap_data, f, indent=2)


def export_best_system_trades(df_price: pd.DataFrame, best_row: pd.Series, out_dir: str):
    """Export per-trade PnL for best system (for trade quality metrics)."""
    tp = float(best_row["tp_frac"])
    sl = float(best_row["sl_frac"])
    h = int(best_row["horizon_days"])
    
    realized_daily, scen_daily = simulate_daily_realized_pnl_parallel(df_price, tp, sl, h)
    if realized_daily is None or realized_daily.empty or scen_daily is None or scen_daily.empty:
        return
    
    # Extract individual trade PnLs from scenarios
    trades = []
    for date, scen_value in scen_daily.items():
        if scen_value in ["TP", "SL"] and date in realized_daily.index and not pd.isna(realized_daily[date]):
            pnl = realized_daily[date]
            trades.append({
                "date": date.strftime("%Y-%m-%d") if hasattr(date, 'strftime') else str(date),
                "pnl": float(pnl),
                "pnl_pct": float(pnl * 100.0),
                "scenario": scen_value
            })
    
    trades_data = {"trades": trades}
    
    with open(os.path.join(out_dir, "best_system_trades.json"), "w") as f:
        json.dump(trades_data, f, indent=2)


# ================================
# SUMMARY & BENCHMARK COMPARISON
# ================================

def print_and_save_summary(symbol: str, start: str, end: str, df_res: pd.DataFrame, out_dir: str, asset_stats: dict):
    if df_res.empty:
        return

    df = df_res.copy()

    best = df.loc[df["compounded_cagr"].idxmax()].copy()

    start_dt = datetime.strptime(start, "%Y-%m-%d")
    end_dt = datetime.strptime(end, "%Y-%m-%d")

    bm_tickers = {"^GSPC": "S&P 500", "^NDX": "Nasdaq 100"}
    bm_results = {}
    for tick, name in bm_tickers.items():
        res = fetch_benchmark_return(tick, start_dt, end_dt)
        if res is not None:
            bm_results[name] = {"ticker": tick, **res}

    print("\n=== Best system (by CAGR) ===")
    print(best[[
        "tp_frac", "sl_frac", "horizon_days",
        "trades",
        "compounded_cagr_pct",
        "compounded_return_pct",
        "pnl_linear_per_year_pct",
        "label1_ratio",
        "max_drawdown_pct",
        "sharpe_annual",
        "calmar_ratio",
        "equity_final"
    ]])

    lines = []
    lines.append(f"Symbol: {symbol}")
    lines.append(f"Period: {start} to {end}")
    lines.append("")
    lines.append("Best system by CAGR:")
    lines.append(best.to_string())
    lines.append("")
    lines.append("Underlying asset buy & hold:")
    # Ensure we have scalar values, not Series
    asset_total_ret_pct = asset_stats['total_ret_pct'] if isinstance(asset_stats['total_ret_pct'], (int, float)) else asset_stats['total_ret_pct'].item()
    asset_annual_lin_pct = asset_stats['annual_lin_pct'] if isinstance(asset_stats['annual_lin_pct'], (int, float)) else asset_stats['annual_lin_pct'].item()
    asset_annual_cagr_pct = asset_stats['annual_cagr_pct'] if isinstance(asset_stats['annual_cagr_pct'], (int, float)) else asset_stats['annual_cagr_pct'].item()

    lines.append(
        f"{symbol}: total={asset_total_ret_pct:.2f}%, "
        f"annual_linear={asset_annual_lin_pct:.2f}%, "
        f"annual_CAGR={asset_annual_cagr_pct:.2f}%"
    )
    lines.append("")
    lines.append("External benchmarks (buy & hold):")
    for name, vals in bm_results.items():
        # Ensure we have scalar values, not Series
        total_ret_pct = vals['total_ret_pct'] if isinstance(vals['total_ret_pct'], (int, float)) else vals['total_ret_pct'].item()
        annual_lin_pct = vals['annual_lin_pct'] if isinstance(vals['annual_lin_pct'], (int, float)) else vals['annual_lin_pct'].item()
        annual_cagr_pct = vals['annual_cagr_pct'] if isinstance(vals['annual_cagr_pct'], (int, float)) else vals['annual_cagr_pct'].item()

        lines.append(
            f"{name} (ticker {vals['ticker']}): "
            f"total={total_ret_pct:.2f}%, "
            f"annual_linear={annual_lin_pct:.2f}%, "
            f"annual_CAGR={annual_cagr_pct:.2f}%"
        )

    summary_name = os.path.join(out_dir, f"label_grid_summary_{symbol}_{start}_to_{end}.txt")
    with open(summary_name, "w") as f:
        f.write("\n".join(lines))

    # CAGR-only benchmark chart (consistent with "everything CAGR")
    names = ["Best system", f"{symbol} (buy & hold)"]
    vals = [
        best["compounded_cagr_pct"] if isinstance(best["compounded_cagr_pct"], (int, float)) else best["compounded_cagr_pct"].item(),
        asset_stats["annual_cagr_pct"] if isinstance(asset_stats["annual_cagr_pct"], (int, float)) else asset_stats["annual_cagr_pct"].item()
    ]

    for name, vals_bm in bm_results.items():
        names.append(name)
        cagr_val = vals_bm["annual_cagr_pct"] if isinstance(vals_bm["annual_cagr_pct"], (int, float)) else vals_bm["annual_cagr_pct"].item()
        vals.append(cagr_val)

    x = np.arange(len(names))
    plt.figure(figsize=(9, 5))
    plt.bar(x, vals)
    plt.xticks(x, names, rotation=15)
    plt.ylabel("CAGR (%)")
    plt.title(f"{symbol}: Best system vs benchmarks (CAGR)")
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, f"{symbol}_benchmarks_vs_best_cagr.png"), dpi=200)
    plt.close()


# ================================
# MAIN
# ================================

def main():
    raw = input("Symbols (comma separated): ").upper()
    symbols = [s for s in raw.replace(" ", "").split(",") if s]

    start = input("Start date (YYYY-MM-DD, default 2010-01-01): ") or "2010-01-01"
    end = input("End date   (YYYY-MM-DD, default today): ") or datetime.today().strftime("%Y-%m-%d")

    for symbol in symbols:
        print(f"\n=== {symbol} ===")
        df = load_data(symbol, start, end)
        if df.empty:
            continue

        out_dir = f"label_grid_{symbol}_{start}_to_{end}"
        os.makedirs(out_dir, exist_ok=True)

        asset_stats = compute_asset_stats_from_df(df)

        df_res = run_grid_search(df, progress)

        if df_res.empty:
            continue

        asset_total = asset_stats["total_ret"]
        asset_annual_lin = asset_stats["annual_lin"]
        asset_cagr = asset_stats["annual_cagr"]

        df_res["ratio_total_vs_asset"] = df_res["pnl_linear"] / asset_total if abs(asset_total) > 1e-12 else np.nan
        df_res["ratio_annual_vs_asset"] = df_res["pnl_linear_per_year"] / asset_annual_lin if abs(asset_annual_lin) > 1e-12 else np.nan
        df_res["ratio_cagr_vs_asset"] = df_res["compounded_cagr"] / asset_cagr if abs(asset_cagr) > 1e-12 else np.nan

        df_res = mark_cnn_candidates(df_res, asset_cagr)

        full_csv_path = os.path.join(out_dir, f"{symbol}_LO_full.csv")
        df_res.to_csv(full_csv_path, index=False)
        print(f"Saved full LO grid with CNN flags to {full_csv_path}")

        df_cnn = df_res[df_res["is_cnn_candidate"]].copy().sort_values("cnn_rank_score", ascending=False)
        cnn_csv_path = os.path.join(out_dir, f"{symbol}_cnn_candidates.csv")
        df_cnn.to_csv(cnn_csv_path, index=False)
        print(f"Saved {len(df_cnn)} CNN candidate TP-SL-H rows to {cnn_csv_path}")

        print("\nTop 10 CNN candidates (for CNN training):")
        print(df_cnn[[
            "tp_frac", "sl_frac", "horizon_days",
            "spread", "trades", "label1_ratio",
            "compounded_cagr_pct", "cnn_rank_score"
        ]].head(10))

        print("\nTop 5 systems by CAGR (%):")
        print(
            df_res.sort_values("compounded_cagr_pct", ascending=False)[
                ["tp_frac", "sl_frac", "horizon_days",
                 "trades",
                 "compounded_cagr_pct",
                 "compounded_return_pct",
                 "pnl_linear_per_year_pct",
                 "label1_ratio",
                 "max_drawdown_pct"]
            ].head(5).to_string(index=False)
        )

        # Save best systems (by CAGR)
        csv_full = os.path.join(out_dir, f"label_grid_full_{symbol}_{start}_to_{end}.csv")
        df_res.to_csv(csv_full, index=False)

        csv_best = os.path.join(out_dir, f"label_grid_best_{symbol}_{start}_to_{end}.csv")
        df_res.sort_values("compounded_cagr", ascending=False).head(TOP_N_SAVE).to_csv(csv_best, index=False)

        make_visualizations(df_res, symbol, out_dir, asset_stats, df)
        print_and_save_summary(symbol, start, end, df_res, out_dir, asset_stats)

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--symbol", type=str, default=None)
    p.add_argument("--start", type=str, default=None)
    p.add_argument("--end", type=str, default=None)
    p.add_argument("--run_id", type=str, default=None)
    p.add_argument("--out_dir", type=str, default="runs")
    return p.parse_args()

if __name__ == "__main__":
    args = parse_args()

    # If user passed --symbol, run headless (NO input prompts)
    if args.symbol:
        symbol = args.symbol.upper()
        start = args.start or "2010-01-01"
        end = args.end or datetime.today().strftime("%Y-%m-%d")

        run_id = args.run_id or datetime.now().strftime("%Y%m%d_%H%M%S")
        run_dir = os.path.join(args.out_dir, run_id)
        out_dir = os.path.join(run_dir, "artifacts")
        os.makedirs(out_dir, exist_ok=True)

        progress = ProgressWriter(
            path=os.path.join(run_dir, "progress.json"),
            timeseries_path=os.path.join(run_dir, "progress_timeseries.jsonl"),
            total_steps=TP_STEPS * SL_STEPS * (HORIZON_MAX - HORIZON_MIN + 1),
        )
        progress.update("starting", percent=0.0, step=0)

        # run your existing logic (same as inside main, but without input())
        df = load_data(symbol, start, end)
        if df.empty:
            raise SystemExit("No data.")

        asset_stats = compute_asset_stats_from_df(df)
        df_res = run_grid_search(df, progress=progress)
        if df_res.empty:
            raise SystemExit("No results.")

        # keep the rest identical to your main()
        asset_total = asset_stats["total_ret"]
        asset_annual_lin = asset_stats["annual_lin"]
        asset_cagr = asset_stats["annual_cagr"]

        df_res["ratio_total_vs_asset"] = df_res["pnl_linear"] / asset_total if abs(asset_total) > 1e-12 else np.nan
        df_res["ratio_annual_vs_asset"] = df_res["pnl_linear_per_year"] / asset_annual_lin if abs(asset_annual_lin) > 1e-12 else np.nan
        df_res["ratio_cagr_vs_asset"] = df_res["compounded_cagr"] / asset_cagr if abs(asset_cagr) > 1e-12 else np.nan

        df_res = mark_cnn_candidates(df_res, asset_cagr)

        df_res.to_csv(os.path.join(out_dir, f"{symbol}_LO_full.csv"), index=False)
        df_cnn = df_res[df_res["is_cnn_candidate"]].copy().sort_values("cnn_rank_score", ascending=False)
        df_cnn.to_csv(os.path.join(out_dir, f"{symbol}_cnn_candidates.csv"), index=False)

        csv_full = os.path.join(out_dir, f"label_grid_full_{symbol}_{start}_to_{end}.csv")
        df_res.to_csv(csv_full, index=False)

        csv_best = os.path.join(out_dir, f"label_grid_best_{symbol}_{start}_to_{end}.csv")
        df_res.sort_values("compounded_cagr", ascending=False).head(TOP_N_SAVE).to_csv(csv_best, index=False)

        make_visualizations(df_res, symbol, out_dir, asset_stats, df)
        print_and_save_summary(symbol, start, end, df_res, out_dir, asset_stats)
        
        # Export raw data for interactive dashboard
        export_voxel_data(df_res, out_dir)
        export_heatmap_data(df_res, out_dir)
        export_metrics_json(df_res, symbol, start, end, asset_stats, out_dir)
        
        # Export advanced dashboard data
        best_row = df_res.nlargest(1, "compounded_cagr_pct").iloc[0]
        export_horizon_best_data(df_res, out_dir)
        export_cagr_vs_horizon_spread_json(df_res, out_dir, n_bins=8)
        export_best_system_timeseries(df, best_row, symbol, out_dir)  # df is the price dataframe
        export_yearly_compounded_returns(df, best_row, symbol, out_dir)  # df is the price dataframe
        export_best_system_heatmap(df_res, best_row, out_dir)
        export_best_system_trades(df, best_row, out_dir)  # df is the price dataframe

        # Mark run as complete
        progress.update("done", percent=100.0, step=progress.total_steps)

    # Otherwise run interactive mode (WITH prompts)
    else:
        main()

