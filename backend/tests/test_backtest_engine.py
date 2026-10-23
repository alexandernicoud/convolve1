"""Portfolio accounting, metrics, benchmarks and threshold protocol of the v2 engine."""

import math

import numpy as np
import pandas as pd
import pytest

from app.services import trade_outcomes as to
from app.services.backtest_engine import benchmarks as bm
from app.services.backtest_engine import metrics as mt
from app.services.backtest_engine import thresholds as th
from app.services.backtest_engine.simulation import (
    SKIP_CASH, SKIP_EXPOSURE, SKIP_MAX_CONCURRENT, SKIP_MAX_TRADES_DAY, SKIP_SYMBOL_OPEN, Signal, SimConfig, simulate,
)

TZ = "America/New_York"


def frame(rows, start="2025-01-06"):
    """rows: list of (open, high, low, close) per business day."""
    idx = pd.bdate_range(start, periods=len(rows), tz=TZ)
    return pd.DataFrame(rows, index=idx, columns=["Open", "High", "Low", "Close"]).assign(Volume=1.0)


def flat(n, px=100.0, start="2025-01-06"):
    return frame([(px, px, px, px)] * n, start)


SPEC = to.OutcomeSpec(horizon_bars=3, tp_frac=0.02, sl_frac=0.01)


def sig(sym, day, prob=0.9, sid=None, label=1):
    return Signal(sid or f"{sym}-{day}", sym, pd.Timestamp(day, tz=TZ), prob, label)


def test_single_tp_trade_hand_reconciled():
    # decision on day 0 close; entry day 1 open 100; TP 102 touched day 2
    b = frame([(100, 100, 100, 100), (100, 101, 99.5, 100.5), (101, 103, 100.5, 102.5), (102, 102, 102, 102), (102, 102, 102, 102)])
    cfg = SimConfig(starting_capital=10_000, position_size_pct=50, commission_pct=0.1, slippage_pct=0.05)
    r = simulate([sig("A", "2025-01-06")], {"A": b}, SPEC, cfg, threshold=0.5)
    t = r.trades[0]
    entry_fill = 100 * 1.0005
    shares = 5000 / entry_fill
    exit_fill = 102 * (1 - 0.0005)
    proceeds = shares * exit_fill
    net = proceeds - proceeds * 0.001 - 5000 - 5.0
    assert t["exit_reason"] == "tp" and t["exit_ts"].startswith("2025-01-08")
    assert t["entry_fill"] == pytest.approx(entry_fill)
    assert t["shares"] == pytest.approx(shares)
    assert t["net_pnl"] == pytest.approx(net)
    assert r.equity["equity"].iloc[-1] == pytest.approx(10_000 + net)
    # cash only returns on the exit day, not the decision day
    eq = r.equity.set_index("date")
    assert eq.loc["2025-01-07", "cash"] == pytest.approx(10_000 - 5005)
    assert eq.loc["2025-01-08", "cash"] == pytest.approx(10_000 - 5005 + proceeds * 0.999)
    assert r.diagnostics["accounting"]["daily_reconciliation_ok"]


def test_mark_to_market_and_running_peak_drawdown():
    b = frame([(100,) * 4, (100, 100, 99.5, 99.6), (99.6, 100, 99.2, 99.3), (99.3, 101.9, 99.2, 101.5), (101.5,) * 4])
    cfg = SimConfig(starting_capital=1000, position_size_pct=100, commission_pct=0, slippage_pct=0)
    r = simulate([sig("A", "2025-01-06")], {"A": b}, SPEC, cfg, threshold=0.5)
    eq = r.equity["equity"].to_numpy()
    assert eq[1] == pytest.approx(996.0)  # marked at 99.6
    peak = np.maximum.accumulate(eq)
    np.testing.assert_allclose(r.equity["drawdown"].to_numpy(), 1 - eq / peak)


def test_cash_never_negative_and_exposure_cap():
    syms = {s: flat(12) for s in "ABCDEFG"}
    sigs = [sig(s, "2025-01-06", prob=0.9 - i * 0.01) for i, s in enumerate(syms)]
    cfg = SimConfig(starting_capital=1000, position_size_pct=30, max_exposure_pct=70, max_concurrent_positions=10, commission_pct=0.1)
    r = simulate(sigs, syms, to.OutcomeSpec(horizon_bars=5, tp_frac=0.02, sl_frac=0.01), cfg, threshold=0.5)
    assert (r.equity["cash"] >= -1e-9).all()
    assert (r.equity["gross_exposure"] <= 0.70 + 1e-9).all()
    assert len(r.trades) == 2
    assert [t["symbol"] for t in r.trades] == ["A", "B"]  # highest probability first
    assert {s["reason"] for s in r.skipped} == {SKIP_EXPOSURE}


def test_insufficient_cash_skip():
    syms = {s: flat(12) for s in "ABC"}
    cfg = SimConfig(starting_capital=1000, position_size_pct=50, max_exposure_pct=100, commission_pct=1.0)
    r = simulate([sig(s, "2025-01-06", 0.9 - i * 0.1) for i, s in enumerate(syms)], syms,
                 to.OutcomeSpec(horizon_bars=5, tp_frac=0.02, sl_frac=0.01), cfg, threshold=0.5)
    reasons = [s["reason"] for s in r.skipped]
    assert len(r.trades) == 1 and SKIP_CASH in reasons


def test_one_position_per_symbol_and_limits():
    b = flat(20)
    sigs = [sig("A", "2025-01-06", sid="a1"), sig("A", "2025-01-07", sid="a2")]
    r = simulate(sigs, {"A": b}, to.OutcomeSpec(horizon_bars=5, tp_frac=0.02, sl_frac=0.01), SimConfig(), threshold=0.5)
    assert [s["reason"] for s in r.skipped] == [SKIP_SYMBOL_OPEN]

    syms = {s: flat(12) for s in "ABCD"}
    r = simulate([sig(s, "2025-01-06") for s in syms], syms, SPEC, SimConfig(max_concurrent_positions=2), threshold=0.5)
    assert sorted(s["reason"] for s in r.skipped) == [SKIP_MAX_CONCURRENT] * 2
    r = simulate([sig(s, "2025-01-06") for s in syms], syms, SPEC, SimConfig(max_trades_per_day=3), threshold=0.5)
    assert [s["reason"] for s in r.skipped] == [SKIP_MAX_TRADES_DAY]


def test_ordering_is_deterministic_on_ties():
    syms = {s: flat(12) for s in "CAB"}
    sigs = [sig(s, "2025-01-06", 0.8) for s in "CAB"]
    r1 = simulate(sigs, syms, SPEC, SimConfig(max_concurrent_positions=2), threshold=0.5)
    r2 = simulate(list(reversed(sigs)), syms, SPEC, SimConfig(max_concurrent_positions=2), threshold=0.5)
    assert [t["symbol"] for t in r1.trades] == [t["symbol"] for t in r2.trades] == ["A", "B"]


def test_open_at_end_is_marked_not_booked():
    b = flat(3)
    r = simulate([sig("A", "2025-01-06")], {"A": b}, to.OutcomeSpec(horizon_bars=5, tp_frac=0.02, sl_frac=0.01), SimConfig(), threshold=0.5)
    assert r.trades[0]["status"] == "open_at_end" and r.trades[0]["net_pnl"] is None
    assert r.diagnostics["open_at_end"] == 1


def test_gap_through_stop_fills_at_open():
    b = frame([(100,) * 4, (100, 100.5, 99.5, 100), (97, 97.5, 96, 97), (97,) * 4])
    r = simulate([sig("A", "2025-01-06")], {"A": b}, SPEC, SimConfig(slippage_pct=0), threshold=0.5)
    assert r.trades[0]["exit_reason"] == "sl" and r.trades[0]["exit_price"] == pytest.approx(97)
    assert "gap_through_stop" in r.trades[0]["flags"]


def test_below_threshold_never_trades():
    r = simulate([sig("A", "2025-01-06", prob=0.4)], {"A": flat(10)}, SPEC, SimConfig(), threshold=0.5)
    assert r.trades == [] and (r.equity["equity"] == 10_000).all()


# --- metrics ---------------------------------------------------------------------------------


def _eq(vals, start="2025-01-01"):
    d = pd.bdate_range(start, periods=len(vals))
    return pd.DataFrame({"date": [x.date().isoformat() for x in d], "equity": vals, "costs_cum": 0.0, "commission_cum": 0.0,
                         "slippage_cum": 0.0, "gross_exposure": 0.5, "n_positions": 1})


def test_sharpe_unavailable_with_few_periods_and_not_clipped():
    m = mt.trading_metrics(_eq([100, 101, 102]), [], 100, "1d")
    assert m["sharpe"]["value"] is None and "needs at least" in m["sharpe"]["unavailable"]
    assert m["annualized_return"]["value"] is None
    vals = 100 * np.cumprod(np.r_[1, np.full(120, 1.01) + np.tile([0.0001, -0.0001], 60)])
    m = mt.trading_metrics(_eq(vals.tolist()), [], 100, "1d")
    assert m["sharpe"]["value"] > 100  # extreme but real: never clipped


def test_missing_trade_metrics_stay_missing():
    m = mt.trading_metrics(_eq([100] * 40), [], 100, "1d")
    assert m["win_rate"]["value"] is None and m["profit_factor"]["value"] is None
    assert m["sharpe"]["value"] is None  # zero variance


def test_drawdown_uses_running_peak():
    dates = ["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-06", "2025-01-07"]
    d = mt.drawdown_stats(dates, [100, 120, 90, 130, 117])
    assert d["max_drawdown"]["value"] == pytest.approx(0.25)
    assert d["max_drawdown_peak_date"] == "2025-01-02" and d["max_drawdown_recovery_date"] == "2025-01-06"


def test_classification_metrics_are_label_based_and_separate():
    y = [1, 0, 1, 0, 0, 0]
    p = [0.9, 0.8, 0.7, 0.2, 0.1, 0.3]
    cm = mt.classification_metrics(y, p, 0.5)
    assert cm["confusion_matrix"] == {"tp": 2, "fp": 1, "tn": 3, "fn": 0}
    assert cm["majority_baseline_accuracy"]["value"] == pytest.approx(4 / 6)
    assert cm["roc_auc"]["value"] == pytest.approx(7 / 8)
    assert "win_rate" not in cm


# --- benchmarks --------------------------------------------------------------------------------


def test_benchmark_starts_at_first_decision_and_buys_next_open():
    b = frame([(100,) * 4, (110, 110, 110, 110), (120, 120, 120, 120)], start="2025-01-06")
    dates = ["2025-01-06", "2025-01-07", "2025-01-08"]
    res = bm.buy_and_hold(b, dates, 1000, 0, 0)
    assert res["entry_date"] == "2025-01-07"
    assert res["values"] == pytest.approx([1000, 1000, 1000 * 120 / 110])
    out = bm.compute_benchmarks({"A": b}, ["A"], dates, 1000, 0, 0, 0.25, "1d")
    assert out["series"]["exposure_matched"][-1] == pytest.approx(750 + 0.25 * 1000 * 120 / 110)
    assert "spy" in out["unavailable"]


# --- thresholds --------------------------------------------------------------------------------


def test_validation_selection_uses_only_validation_inputs():
    rng = np.random.default_rng(0)
    y = rng.integers(0, 2, 200)
    p = np.clip(0.5 + (y - 0.5) * 0.3 + rng.normal(0, 0.15, 200), 0, 1)
    sel = th.select_on_validation(y, p)
    assert sel["threshold"] is not None and sel["rule"] == th.SELECTION_RULE
    assert sel["n_validation"] == 200


def test_sweep_is_labelled_and_never_replaces_headline():
    calls = []
    out = th.sensitivity_sweep(lambda t: calls.append(t) or {"total_return": t}, [1, 0, 1], [0.9, 0.2, 0.6], 0.55)
    assert out["label"] == "In-sample sensitivity — not independently validated."
    assert out["in_sample"] is True
    heads = [r for r in out["rows"] if r["is_headline"]]
    assert len(heads) == 1 and heads[0]["threshold"] == 0.55
