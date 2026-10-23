import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import label_optimizer_audit as audit  # noqa: E402


@pytest.fixture(scope="module")
def engine():
    return audit.load_engine()


def _prices(n=260, seed=7):
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(rng.normal(0, 0.02, n)))
    open_ = np.r_[100.0, close[:-1]] * (1 + rng.normal(0, 0.004, n))
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.01, n)))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.01, n)))
    idx = pd.bdate_range("2024-01-01", periods=n)
    return pd.DataFrame({"Open": open_, "High": high, "Low": low, "Close": close}, index=idx)


@pytest.mark.parametrize("tp,sl,h", [(0.03, 0.02, 1), (0.05, 0.03, 5), (0.1, 0.2, 20)])
def test_label_walk_reproduces_engine(engine, tp, sl, h):
    df = _prices()
    ref = engine.simulate_system_for_metrics(df, tp, sl, h, float(engine.START_CAPITAL))
    ours = audit.walk_candidate(df, tp, sl, h, engine=engine, mark_to_market=False)
    assert ours["equity_final"] == pytest.approx(ref["equity_final"], rel=1e-9)
    assert ours["cagr_pct"] == pytest.approx(ref["compounded_cagr_pct"], rel=1e-9)


def test_expiry_valuation_is_the_only_difference_without_gaps(engine):
    df = _prices()
    # TP/SL far out of reach: every position expires.
    label = audit.walk_candidate(df, 5.0, 0.99, 3, engine=engine, mark_to_market=False)
    mtm = audit.walk_candidate(df, 5.0, 0.99, 3, engine=engine, mark_to_market=True)
    assert label["tp_hits"] == label["sl_hits"] == 0
    assert label["expiries"] == mtm["expiries"] > 0
    # Label model books only costs on expiry, so it can only lose.
    assert label["equity_final"] < float(engine.START_CAPITAL)
    assert mtm["equity_final"] != pytest.approx(label["equity_final"])


def test_classify_region_thresholds():
    assert audit.classify_region({"share_within_25pct": 0.7, "median_ratio": 0.8, "share_within_50pct": 0.9}) == "plateau"
    assert audit.classify_region({"share_within_25pct": 0.1, "median_ratio": 0.4, "share_within_50pct": 0.5}) == "ridge"
    assert audit.classify_region({"share_within_25pct": 0.0, "median_ratio": 0.1, "share_within_50pct": 0.1}) == "isolated"
