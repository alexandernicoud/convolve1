# Testchart_Labeler_Rewritten.py
# ------------------------------
# - Future window = first w TRADING bars strictly after the chart end
# - Filename end date = ACTUAL last bar in the chart (not the requested end)
# - TZ-safe comparison for the future cutoff
# - Prints: base_close, entry_price (next open), hit which (TP/SL), hit_price, hit_date
# - Period length = x timeframe units, but only one chart per TRADING DAY

import os
import datetime as dt
from dateutil.relativedelta import relativedelta

import yfinance as yf
import pandas as pd
import plotly.graph_objects as go


def tp_first_else_zero_from_next_open(data, future_data, f, s):
    """
    Returns: (label, hit_price, which, hit_date)
      label: 1 if TP hit first, else 0
      hit_price: TP/SL level that was hit, or None
      which: 'TP'/'SL'/None
      hit_date: timestamp of the bar where it first hit, or None

    Logic:
    - Entry at NEXT OPEN after the chart (future_data.iloc[0].Open)
    - TP/SL as fractions of that entry price
    - Walk through future bars; SL checked before TP (conservative)
    """
    if data.empty or future_data.empty:
        return None, None, None, None

    has_open = 'Open' in future_data and not future_data['Open'].empty
    has_high = 'High' in future_data and not future_data['High'].empty
    has_low  = 'Low'  in future_data and not future_data['Low'].empty

    # Entry bar = first bar in future_data
    first_row = future_data.iloc[0]
    entry_price = float(first_row['Open']) if has_open else float(first_row.get('Close'))
    if entry_price is None:
        return None, None, None, None

    tp_level = entry_price * (1.0 + float(f))
    sl_level = entry_price * (1.0 - float(s))

    for ts, row in future_data.iterrows():
        h = float(row['High']) if has_high else float(row.get('Close', entry_price))
        l = float(row['Low'])  if has_low  else float(row.get('Close', entry_price))

        # SL first, then TP (if both in same bar -> SL wins)
        if l <= sl_level:
            return 0, sl_level, 'SL', ts
        if h >= tp_level:
            return 1, tp_level, 'TP', ts

    # Neither hit in horizon
    return 0, None, None, None


def inclusive_history(ticker, start_ts, end_ts, interval):
    """
    yfinance 'end' is exclusive; add +1 day to include intended end bar.
    """
    return ticker.history(
        start=start_ts.strftime('%Y-%m-%d'),
        end=(end_ts + dt.timedelta(days=1)).strftime('%Y-%m-%d'),
        interval=interval
    )


def first_w_trading_bars_after(ticker, last_bar_ts, w, interval):
    """
    First w trading bars STRICTLY AFTER last_bar_ts (TZ-safe cutoff).
    """
    raw = ticker.history(
        start=(last_bar_ts - dt.timedelta(days=3)).strftime('%Y-%m-%d'),
        end=(last_bar_ts + dt.timedelta(days=w*5)).strftime('%Y-%m-%d'),
        interval=interval
    )
    if raw.empty:
        return raw

    idx = raw.index
    if hasattr(idx, 'tz') and idx.tz is not None:
        cutoff = (pd.Timestamp(last_bar_ts).tz_convert(idx.tz)
                  if getattr(last_bar_ts, 'tz', None)
                  else pd.Timestamp(last_bar_ts).tz_localize(idx.tz))
    else:
        cutoff = (pd.Timestamp(last_bar_ts).tz_localize(None)
                  if getattr(last_bar_ts, 'tz', None)
                  else pd.Timestamp(last_bar_ts))

    return raw.loc[idx > cutoff].head(w)


def generate_and_save_labeled_charts():
    # --- Inputs ---
    # x is now the LENGTH of the period in timeframe units
    # e.g. t='1d', x=365 -> last chart ends between 0 and 365 days ago
    x = int(input("Period length in timeframe units (e.g. days for 1d): "))
    symbols = input("Symbols (comma separated): ").upper().replace(" ", "").split(",")
    folder_name = input("Folder name: ")
    candle_chart = input("Use candlechart?: ")

    t = str(input("Timeframe (1d / 1wk / 1mo): "))
    u = str(input("Unit of timespan (e.g. months): "))
    o = int(input("How many units for the timespan: "))
    w = int(input("Future horizon in bars (best: 7): "))    # w trading bars
    f = float(input("Take Profit (as fraction): "))         # e.g. 0.02
    s = float(input("Stop Loss (as fraction): "))           # e.g. 0.01
    d = int(input("Image Dimensions: "))

    use_ma = input("Use SMA?: ")
    ma = int(input("Moving Average Length: ")) if use_ma.lower() == "yes" else None

    i1 = int(input("Last chart ends n timeframe units ago (offset): "))

    os.makedirs(folder_name, exist_ok=True)

    # step unit for sliding current_end
    if t == "1d":
        step_unit = "days"
    elif t == "1wk":
        step_unit = "weeks"
    elif t == "1mo":
        step_unit = "months"
    else:
        raise ValueError("Unsupported timeframe. Use '1d', '1wk', or '1mo'.")

    for symbol in symbols:
        ticker = yf.Ticker(symbol)
        i = i1
        max_i = i1 + x              # i will run [i1, i1 + x)
        charts_saved = 0
        used_last_bars = set()      # ensure max 1 chart per trading bar

        while i < max_i:
            # Requested chart window end
            today = dt.datetime.today()
            current_end_req = today - relativedelta(**{step_unit: i})
            current_start_req = current_end_req - relativedelta(**{u: o})
            i += 1  # move further into the past for the next candidate

            # Pull chart data (inclusive end)
            data = inclusive_history(ticker, current_start_req, current_end_req, t)
            if data.empty or 'Close' not in data:
                continue

            # True last bar timestamp & filename date
            last_bar_ts = data.index[-1]

            # Only one chart per TRADING DAY (per actual last_bar_ts)
            if last_bar_ts in used_last_bars:
                continue
            used_last_bars.add(last_bar_ts)

            if getattr(last_bar_ts, 'tz', None):
                last_bar_date = last_bar_ts.tz_convert('America/New_York').date()
            else:
                last_bar_date = last_bar_ts.date()

            # Optional SMA
            if use_ma.lower() == "yes" and ma and 'Close' in data:
                data[f'SMA{ma}'] = data['Close'].rolling(window=ma).mean()

            # Future window: first w trading bars after last_bar_ts
            future = first_w_trading_bars_after(ticker, last_bar_ts, w, t)
            if future.empty:
                continue

            # Label + hit info (based on NEXT OPEN)
            label, hit_price, which, hit_date = tp_first_else_zero_from_next_open(data, future, f, s)
            if label is None:
                continue

            # --- Render chart ---
            fig = go.Figure()
            if candle_chart.lower() == "yes":
                fig.add_trace(go.Candlestick(
                    x=data.index,
                    open=data['Open'], high=data['High'],
                    low=data['Low'], close=data['Close'],
                    name='Candlestick'
                ))
            else:
                fig.add_trace(go.Scatter(
                    x=data.index, y=data['Close'],
                    mode='lines',
                    line=dict(color='black', width=1),
                    name='Close Price'
                ))

            if use_ma.lower() == "yes" and ma:
                fig.add_trace(go.Scatter(
                    x=data.index, y=data[f'SMA{ma}'],
                    mode='lines',
                    line=dict(width=1),
                    name=f'SMA {ma}'
                ))

            fig.update_layout(
                xaxis=dict(visible=False),
                yaxis=dict(visible=False),
                showlegend=False,
                margin=dict(l=0, r=0, t=0, b=0),
                plot_bgcolor='rgba(0,0,0,0)',
                paper_bgcolor='rgba(0,0,0,0)',
                xaxis_rangeslider_visible=False,
                width=d, height=d
            )

            filename = f"{folder_name}/{symbol}_{current_start_req.date()}_to_{last_bar_date}_label{label}.png"
            fig.write_image(filename, format="png", width=d, height=d, scale=1, engine="kaleido")
            charts_saved += 1

            # Audit print
            base_close = float(data['Close'].iloc[-1])
            if 'Open' in future and not future['Open'].empty:
                entry = float(future['Open'].iloc[0])
            else:
                entry = float(future['Close'].iloc[0])

            print(
                f"Saved: {filename} ({charts_saved} charts so far) | "
                f"base_close={base_close:.4f} | entry={entry:.4f} | "
                f"hit={which or 'None'} | hit_price={hit_price} | hit_date={hit_date}"
            )

        total = len([f for f in os.listdir(folder_name) if f.endswith(".png") and symbol in f])
        print(
            f"Done for {symbol}. Period length: {x} {step_unit}. "
            f"Charts saved (trading days): {total}"
        )


if __name__ == "__main__":
    generate_and_save_labeled_charts()
