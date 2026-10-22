"""The compiled labeling grid must match the original Python bar walk exactly."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import numpy as np
import pandas as pd

os.environ.setdefault("MPLBACKEND", "Agg")

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "7.2.py"
_spec = importlib.util.spec_from_file_location("label_opt_72", _SCRIPT)
opt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(opt)


def _frame(n: int, open_, high, low, close=None) -> pd.DataFrame:
    open_ = np.asarray(open_, dtype=np.float64)
    high = np.asarray(high, dtype=np.float64)
    low = np.asarray(low, dtype=np.float64)
    if close is None:
        close = open_.copy()
    idx = pd.bdate_range("2012-01-02", periods=n)
    return pd.DataFrame({"Open": open_, "High": high, "Low": low, "Close": close}, index=idx)


def _walk(n: int, seed: int, vol: float) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    steps = rng.normal(0.0, vol, n)
    close = 100.0 * np.exp(np.cumsum(steps))
    open_ = np.empty(n)
    open_[0] = close[0]
    open_[1:] = close[:-1]
    high = np.maximum(open_, close) * (1.0 + np.abs(rng.normal(0.0, vol * 0.4, n)))
    low = np.minimum(open_, close) * (1.0 - np.abs(rng.normal(0.0, vol * 0.4, n)))
    return _frame(n, open_, high, low, close)


def _quiet(n: int) -> pd.DataFrame:
    open_ = np.full(n, 50.0)
    return _frame(n, open_, open_ + 0.05, open_ - 0.02, open_)


def _same(a, b) -> None:
    assert a.keys() == b.keys()
    for key in a:
        left, right = a[key], b[key]
        if isinstance(left, (float, np.floating)) or isinstance(right, (float, np.floating)):
            if np.isnan(left) and np.isnan(right):
                continue
            assert left == right, key
        else:
            assert left == right, key


def _compare(df, tp, sl, horizon, equity=None, ambiguous="SL_FIRST"):
    equity = opt.START_CAPITAL if equity is None else equity
    previous = opt.AMBIGUOUS_FILL
    opt.AMBIGUOUS_FILL = ambiguous
    try:
        original = opt.simulate_system_for_metrics(df, tp, sl, horizon, equity)
        compiled = opt.simulate_system_for_metrics_numba(df, tp, sl, horizon, equity)
    finally:
        opt.AMBIGUOUS_FILL = previous
    if original is None:
        assert compiled is None
        return
    assert compiled is not None
    _same(original, compiled)


def test_short_series_is_skipped():
    df = _quiet(2)
    assert opt.simulate_system_for_metrics(df, 0.02, 0.01, 5, opt.START_CAPITAL) is None
    assert opt.simulate_system_for_metrics_numba(df, 0.02, 0.01, 5, opt.START_CAPITAL) is None


def test_tie_stop_gap_and_expiry_match():
    # Same bar trades through both barriers. SL_FIRST is the production rule.
    both = _frame(4, [100, 100, 100, 100], [110, 110, 110, 110], [90, 90, 90, 90])
    _compare(both, 0.05, 0.05, 1, ambiguous="SL_FIRST")
    _compare(both, 0.05, 0.05, 1, ambiguous="TP_FIRST")
    stop_only = opt.simulate_system_for_metrics(both, 0.05, 0.05, 1, opt.START_CAPITAL)
    opt.AMBIGUOUS_FILL = "TP_FIRST"
    try:
        target_only = opt.simulate_system_for_metrics(both, 0.05, 0.05, 1, opt.START_CAPITAL)
    finally:
        opt.AMBIGUOUS_FILL = "SL_FIRST"
    assert stop_only["label1_ratio"] == 0.0
    assert target_only["label1_ratio"] == 1.0

    # Low reaches the stop. High does not reach the target.
    stop_before = _frame(6, [100] * 6, [102] * 6, [90] * 6)
    _compare(stop_before, 0.05, 0.05, 3)
    stopped = opt.simulate_system_for_metrics(stop_before, 0.05, 0.05, 3, opt.START_CAPITAL)
    assert stopped["label1_ratio"] == 0.0
    assert stopped["trades"] > 0

    # Gap down through an older stop, and a same-bar gap through the new stop.
    open_ = np.array([100, 100, 100, 80, 100, 100], dtype=np.float64)
    high = np.array([100.4, 100.4, 100.4, 81, 100.4, 100.4])
    low = np.array([99.7, 99.7, 99.7, 50, 99.7, 99.7])
    _compare(_frame(6, open_, high, low), 0.02, 0.01, 4)

    # Nothing is touched, so every position expires flat and still pays the cost.
    quiet = _quiet(8)
    _compare(quiet, 0.10, 0.10, 50)
    expired = opt.simulate_system_for_metrics(quiet, 0.10, 0.10, 50, opt.START_CAPITAL)
    assert expired["trades"] == 0
    assert expired["pnl_linear"] < 0.0
    assert expired["horizon_days"] == 50

    # Stop distance greater than the stake floors compounded equity at zero.
    ruin = _frame(8, [100] * 8, [104] * 8, [-1] * 8)
    _compare(ruin, 0.05, 1.0, 1)
    ruined = opt.simulate_system_for_metrics(ruin, 0.05, 1.0, 1, opt.START_CAPITAL)
    assert ruined["equity_final"] == 0.0


def test_many_prices_and_parameter_edges_match():
    series = [
        _quiet(30),
        _walk(40, seed=1, vol=0.004),
        _walk(40, seed=2, vol=0.02),
        _walk(17, seed=3, vol=0.05),
        _frame(12, np.linspace(10, 30, 12), np.linspace(11, 40, 12), np.linspace(9, 20, 12)),
        _frame(9, np.full(9, 0.5), np.full(9, 0.55), np.full(9, 0.2)),
    ]
    tps = [0.005, 0.02, 0.1, 0.4]
    sls = [0.005, 0.01, 0.05, 0.2]
    horizons = [1, 2, 7, 20, 100, 200, 10_000]
    for df in series:
        for tp in tps:
            for sl in sls:
                for horizon in horizons:
                    _compare(df, tp, sl, horizon)
                    _compare(df, tp, sl, horizon, equity=1.0)
                    _compare(df, tp, sl, horizon, ambiguous="TP_FIRST")


def test_full_parameter_grid_matches_exactly():
    df = _quiet(24)
    original = opt._run_grid_search_python(df)
    compiled = opt._run_grid_search_numba(df)
    assert len(original) == 25 * 25 * 200
    assert list(original.columns) == list(compiled.columns)
    for column in original.columns:
        left = original[column].to_numpy()
        right = compiled[column].to_numpy()
        if np.issubdtype(left.dtype, np.floating) or np.issubdtype(right.dtype, np.floating):
            left = left.astype(np.float64)
            right = right.astype(np.float64)
            both_nan = np.isnan(left) & np.isnan(right)
            assert np.all(both_nan | (left == right)), column
        else:
            assert np.array_equal(left, right), column


def test_python_mode_does_not_call_numba(monkeypatch):
    monkeypatch.setenv("CONVOLVE_LABEL_GRID", "python")
    monkeypatch.setattr(opt, "_NUMBA_BROKEN", False)

    def _forbidden(*_args, **_kwargs):
        raise AssertionError("Numba grid was called")

    monkeypatch.setattr(opt, "_run_grid_search_numba", _forbidden)
    out = opt.run_grid_search(_quiet(4))
    reference = opt._run_grid_search_python(_quiet(4))
    assert len(out) == len(reference) == 25 * 25 * 200


def test_numba_failure_uses_original_grid(monkeypatch):
    monkeypatch.delenv("CONVOLVE_LABEL_GRID", raising=False)
    monkeypatch.setattr(opt, "_NUMBA_BROKEN", False)
    calls = {"python": 0}

    def _boom(*_args, **_kwargs):
        raise ImportError("simulated compile failure")

    monkeypatch.setattr(opt, "_run_grid_search_numba", _boom)
    real_python = opt._run_grid_search_python

    def _counting(df, progress=None):
        calls["python"] += 1
        return real_python(df, progress)

    monkeypatch.setattr(opt, "_run_grid_search_python", _counting)
    out = opt.run_grid_search(_quiet(3))
    assert calls["python"] == 1
    assert len(out) == 25 * 25 * 200
    assert opt._NUMBA_BROKEN is True
