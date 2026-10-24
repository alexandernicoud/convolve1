"""Benchmark-only: serve yfinance Ticker.history from cached pickles so generator runs are offline
and repeatable. Active only when CONVOLVE_BENCH_OHLCV_DIR is set and this directory is on PYTHONPATH."""

import os

_dir = os.environ.get("CONVOLVE_BENCH_OHLCV_DIR")
if _dir:
    import pandas as pd
    import yfinance as yf

    _cache = {}

    def _history(self, start=None, end=None, interval="1d", **kwargs):
        sym = self.ticker.upper()
        if sym not in _cache:
            _cache[sym] = pd.read_pickle(os.path.join(_dir, f"{sym}.pkl"))
        df = _cache[sym]
        tz = df.index.tz
        lo = pd.Timestamp(start).tz_localize(tz) if start is not None else df.index[0]
        hi = pd.Timestamp(end).tz_localize(tz) if end is not None else df.index[-1] + pd.Timedelta(days=1)
        return df.loc[(df.index >= lo) & (df.index < hi)].copy()

    yf.Ticker.history = _history
