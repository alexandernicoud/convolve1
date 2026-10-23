"""Shared outcome contract (app/services/trade_outcomes.py)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app.services import trade_outcomes as to

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def frame(rows, start="2024-01-01", freq="B", tz="America/New_York"):
    idx = pd.date_range(start, periods=len(rows), freq=freq, tz=tz)
    return pd.DataFrame(rows, columns=["Open", "High", "Low", "Close"], index=idx)


SPEC = to.OutcomeSpec(horizon_bars=3, tp_frac=0.02, sl_frac=0.01)


def test_tp_reached():
    b = frame([[100, 100, 100, 100], [100, 101, 99.5, 100.5], [100.5, 102.5, 100, 102]])
    o = to.resolve_outcome(b, b.index[0], to.OutcomeSpec(3, 0.02, 0.01))
    assert o.exit_reason == "tp"  # TP inside the available bars is determinate even if the horizon is short
    b = frame([[100, 100, 100, 100], [100, 101, 99.5, 100.5], [100.5, 102.5, 100, 102], [102, 103, 101, 102]])
    o = to.resolve_outcome(b, b.index[0], SPEC)
    assert (o.exit_reason, o.target_label, o.bars_held) == ("tp", 1, 2)
    assert o.entry_price == 100 and o.exit_price == pytest.approx(102.0)
    assert o.gross_return == pytest.approx(0.02)
    assert o.entry_ts == b.index[1] and o.exit_ts == b.index[2]


def test_sl_reached_on_entry_bar():
    b = frame([[100, 100, 100, 100], [100, 100.5, 98.9, 99], [99, 99, 99, 99], [99, 99, 99, 99]])
    o = to.resolve_outcome(b, b.index[0], SPEC)
    assert (o.exit_reason, o.target_label, o.bars_held) == ("sl", 0, 1)
    assert o.exit_price == pytest.approx(99.0)
    assert to.FLAG_GAP_STOP not in o.flags


def test_both_levels_same_bar_is_sl_first_and_flagged():
    b = frame([[100, 100, 100, 100], [100, 102.5, 98.5, 101], [101, 101, 101, 101], [101, 101, 101, 101]])
    o = to.resolve_outcome(b, b.index[0], SPEC)
    assert o.exit_reason == "sl" and to.FLAG_AMBIGUOUS in o.flags
    assert o.exit_price == pytest.approx(99.0)


def test_gap_through_stop_fills_at_open():
    b = frame([[100, 100, 100, 100], [100, 100.5, 99.5, 100], [97, 97.5, 96, 97], [97, 97, 97, 97]])
    o = to.resolve_outcome(b, b.index[0], SPEC)
    assert o.exit_reason == "sl" and to.FLAG_GAP_STOP in o.flags
    assert o.exit_price == pytest.approx(97.0) and o.gross_return == pytest.approx(-0.03)


def test_gap_through_target_fills_at_target():
    b = frame([[100, 100, 100, 100], [100, 100.5, 99.5, 100], [104, 105, 103.5, 104], [104, 104, 104, 104]])
    o = to.resolve_outcome(b, b.index[0], SPEC)
    assert o.exit_reason == "tp" and to.FLAG_GAP_TARGET in o.flags and o.exit_price == pytest.approx(102.0)


@pytest.mark.parametrize("last_close,sign", [(101.5, 1), (99.4, -1)])
def test_timeout_exits_at_last_horizon_close(last_close, sign):
    b = frame([[100, 100, 100, 100], [100, 101, 99.5, 100.5], [100.5, 101.5, 99.6, 101], [101, 101.9, 99.2, last_close], [1, 1, 1, 1]])
    o = to.resolve_outcome(b, b.index[0], SPEC)
    assert (o.exit_reason, o.target_label, o.bars_held) == ("timeout", 0, 3)
    assert o.exit_ts == b.index[3] and o.exit_price == pytest.approx(last_close)
    assert np.sign(o.gross_return) == sign


def test_incomplete_horizon_has_no_label_or_return():
    b = frame([[100, 100, 100, 100], [100, 101, 99.5, 100.5], [100.5, 101.5, 99.6, 101]])
    o = to.resolve_outcome(b, b.index[0], SPEC)
    assert o.status == to.STATUS_INCOMPLETE and o.target_label is None and o.gross_return is None
    assert o.bars_available == 2 and o.exit_ts is None
    assert to.label_for_method(o, to.LABEL_METHOD_LEGACY) == 0
    assert to.label_for_method(o, to.LABEL_METHOD_V2) is None
    last = to.resolve_outcome(b, b.index[-1], SPEC)
    assert last.status == to.STATUS_INCOMPLETE and last.entry_ts is None


def test_missing_bar_is_flagged_not_filled():
    idx = pd.DatetimeIndex(["2024-01-02", "2024-01-03", "2024-01-15", "2024-01-16", "2024-01-17"], tz="America/New_York")
    b = pd.DataFrame([[100, 100, 100, 100], [100, 101, 99.5, 100.5], [100.5, 101, 99.6, 100.7], [100, 101, 99.5, 100], [1, 1, 1, 1]], columns=list(to.OHLC), index=idx)
    o = to.resolve_outcome(b, b.index[0], SPEC)
    assert to.FLAG_IRREGULAR_GAP in o.flags and o.exit_reason == "timeout" and o.bars_held == 3


def test_nan_price_is_invalid():
    b = frame([[100, 100, 100, 100], [100, np.nan, 99.5, 100.5], [100, 101, 99.5, 100], [100, 101, 99.5, 100]])
    o = to.resolve_outcome(b, b.index[0], SPEC)
    assert o.status == to.STATUS_INVALID and o.target_label is None


def test_duplicate_timestamps_are_rejected():
    b = frame([[100, 100, 100, 100]] * 4)
    b.index = pd.DatetimeIndex([b.index[0], b.index[1], b.index[1], b.index[2]])
    o = to.resolve_outcome(b, b.index[0], SPEC)
    assert o.status == to.STATUS_INVALID and o.invalid_reason == "duplicate_timestamps"


def test_decision_bar_must_exist():
    b = frame([[100, 100, 100, 100]] * 4)
    o = to.resolve_outcome(b, pd.Timestamp("2030-01-01", tz="America/New_York"), SPEC)
    assert o.status == to.STATUS_INVALID and o.invalid_reason == "decision_bar_missing"


def test_weekly_timeframe_counts_bars_not_days():
    rows = [[100, 100, 100, 100], [100, 101, 99.5, 100.5], [100.5, 101, 99.6, 100.7], [100, 101, 99.5, 100.2]]
    b = frame(rows, freq="W-FRI")
    o = to.resolve_outcome(b, b.index[0], to.OutcomeSpec(3, 0.02, 0.01, timeframe="1wk"))
    assert o.exit_reason == "timeout" and o.bars_held == 3 and to.FLAG_IRREGULAR_GAP not in o.flags
    o_daily_rules = to.resolve_outcome(b, b.index[0], to.OutcomeSpec(3, 0.02, 0.01, timeframe="1d"))
    assert to.FLAG_IRREGULAR_GAP in o_daily_rules.flags


def test_adjusted_prices_scale_invariant_and_mixing_rejected():
    rows = [[100, 100, 100, 100], [100, 101, 99.5, 100.5], [100.5, 102.5, 100, 102], [102, 103, 101, 102]]
    a = to.resolve_outcome(frame(rows), frame(rows).index[0], SPEC)
    scaled = frame([[v * 0.37 for v in r] for r in rows])
    b = to.resolve_outcome(scaled, scaled.index[0], SPEC)
    assert (a.exit_reason, a.bars_held) == (b.exit_reason, b.bars_held)
    assert a.gross_return == pytest.approx(b.gross_return)
    to.assert_same_adjustment("yfinance_auto_adjust", "yfinance_auto_adjust")
    with pytest.raises(ValueError):
        to.assert_same_adjustment("yfinance_auto_adjust", "unadjusted")


def _legacy_label_fn():
    spec = importlib.util.spec_from_file_location("gen14", SCRIPTS / "1.4_Adj_testL.py")
    src = (SCRIPTS / "1.4_Adj_testL.py").read_text()
    start = src.index("def tp_first_else_zero_from_next_open")
    end = src.index("def inclusive_history")
    ns: dict = {}
    exec(src[start:end], ns)  # noqa: S102 - isolate the pure labelling function without importing yfinance
    return ns["tp_first_else_zero_from_next_open"]


def test_labels_match_generator_on_random_walks():
    legacy = _legacy_label_fn()
    rng = np.random.default_rng(7)
    for trial in range(300):
        n = 40
        close = 100 * np.exp(np.cumsum(rng.normal(0, 0.015, n)))
        opn = np.r_[100, close[:-1]] * np.exp(rng.normal(0, 0.006, n))
        high = np.maximum(opn, close) * (1 + np.abs(rng.normal(0, 0.008, n)))
        low = np.minimum(opn, close) * (1 - np.abs(rng.normal(0, 0.008, n)))
        b = frame(np.c_[opn, high, low, close].tolist())
        w = int(rng.integers(1, 10))
        spec = to.OutcomeSpec(w, 0.02, 0.01)
        d = int(rng.integers(0, n - 1))
        future = b.iloc[d + 1 : d + 1 + w]
        lab, _px, which, _ts = legacy(b.iloc[: d + 1], future, 0.02, 0.01)
        o = to.resolve_outcome(b, b.index[d], spec)
        assert to.label_for_method(o, to.LABEL_METHOD_LEGACY) == lab, (trial, d, w)
        if which == "TP":
            assert o.exit_reason == "tp"
        elif which == "SL":
            assert o.exit_reason == "sl"
        else:
            assert o.exit_reason in ("timeout", "incomplete")
