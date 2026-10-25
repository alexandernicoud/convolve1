"""Research diagnostics (methodology v2): agreement with the shared trade-outcome contract,
period boundaries, scores and deterministic ranking."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.services import label_grid, label_research
from app.services import trade_outcomes as outcomes

pytestmark = pytest.mark.skipif(not label_grid.HAVE_NUMBA, reason="compiled label kernels unavailable")

TPS = np.array([0.01, 0.03, 0.08])
SLS = np.array([0.01, 0.025, 0.06])
HS = np.array([1, 2, 5, 9], dtype=np.int64)


def _bars(n: int = 90, seed: int = 3) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    close = 100.0 * np.exp(np.cumsum(rng.normal(0.0, 0.02, n)))
    open_ = np.r_[close[0], close[:-1]] * (1.0 + rng.normal(0.0, 0.01, n))
    high = np.maximum(open_, close) * (1.0 + np.abs(rng.normal(0.0, 0.012, n)))
    low = np.minimum(open_, close) * (1.0 - np.abs(rng.normal(0.0, 0.012, n)))
    # Hand-placed edge cases: a bar touching both levels, gaps through levels.
    high[20], low[20] = open_[20] * 1.2, open_[20] * 0.8
    open_[40] = close[39] * 0.88
    low[40] = min(low[40], open_[40])
    open_[60] = close[59] * 1.12
    high[60] = max(high[60], open_[60])
    idx = pd.bdate_range("2020-01-02", periods=n)
    return pd.DataFrame({"Open": open_, "High": high, "Low": low, "Close": close}, index=idx)


def _arrays(df):
    return tuple(np.ascontiguousarray(df[c].to_numpy(dtype=np.float64)) for c in ("Open", "High", "Low", "Close"))


def _kernel(df, k_lo, k_hi, data_end, sl_first=1):
    o, h, l, c = _arrays(df)
    fp_tp, fp_sl = label_grid.passage_tables(o, h, l, TPS, SLS, int(HS.max()))
    return label_grid.research_grid(o, c, fp_tp, fp_sl, TPS, SLS, HS, k_lo, k_hi, data_end, label_research.N_BLOCKS, sl_first)


def _brute(df, k_lo, k_hi, data_end):
    """The same statistics from the Generator's contract, one sample at a time."""
    bars = df.iloc[: data_end + 1]
    shape = (len(TPS), len(SLS), len(HS))
    cnt = np.zeros(shape, dtype=np.int64)
    n_tp = np.zeros(shape, dtype=np.int64)
    s_ret = np.zeros(shape)
    s_held = np.zeros(shape)
    blk_n = np.zeros(shape + (label_research.N_BLOCKS,), dtype=np.int64)
    span = k_hi - k_lo + 1
    for a, tp in enumerate(TPS):
        for b, sl in enumerate(SLS):
            for c, h in enumerate(HS):
                spec = outcomes.OutcomeSpec(horizon_bars=int(h), tp_frac=float(tp), sl_frac=float(sl), timeframe="1d")
                for k in range(k_lo, k_hi + 1):
                    out = outcomes.resolve_outcome(bars, bars.index[k - 1], spec)
                    label = outcomes.label_for_method(out, outcomes.LABEL_METHOD_V2)
                    if label is None:
                        continue
                    cnt[a, b, c] += 1
                    n_tp[a, b, c] += label
                    s_ret[a, b, c] += out.gross_return
                    s_held[a, b, c] += out.bars_held
                    blk_n[a, b, c, ((k - k_lo) * label_research.N_BLOCKS) // span] += 1
    return cnt, n_tp, s_ret, s_held, blk_n


@pytest.mark.parametrize("k_lo,k_hi,data_end", [(1, 89, 89), (1, 59, 59), (60, 89, 89)])
def test_research_kernel_matches_contract_per_sample(k_lo, k_hi, data_end):
    df = _bars()
    cnt, n_tp_hit, n_sl_hit, s_ret, _s0, s_held, blk_n, _bt, _br = _kernel(df, k_lo, k_hi, data_end)
    b_cnt, b_tp, b_ret, b_held, b_blk = _brute(df, k_lo, k_hi, data_end)
    assert np.array_equal(cnt, b_cnt)
    assert np.array_equal(n_tp_hit, b_tp)
    assert np.allclose(s_ret, b_ret, rtol=0, atol=1e-12)
    assert np.array_equal(s_held, b_held)
    assert np.array_equal(blk_n, b_blk)
    assert np.all(n_tp_hit + n_sl_hit <= cnt)


def test_same_bar_tie_gap_and_timeout_by_hand():
    idx = pd.bdate_range("2021-01-04", periods=6)
    # decision bar 0; entry bar 1 opens at 100 and touches both 105 and 95.
    tie = pd.DataFrame({"Open": [100, 100, 100, 100, 100, 100], "High": [100, 106, 100, 100, 100, 100],
                        "Low": [100, 94, 100, 100, 100, 100], "Close": [100] * 6}, index=idx, dtype=float)
    o, h, l, c = _arrays(tie)
    tps, sls, hs = np.array([0.05]), np.array([0.05]), np.array([3], dtype=np.int64)
    fp_tp, fp_sl = label_grid.passage_tables(o, h, l, tps, sls, 3)
    cnt, ntp, nsl, s_ret, *_ = label_grid.research_grid(o, c, fp_tp, fp_sl, tps, sls, hs, 1, 1, 5, 4, 1)
    assert (cnt[0, 0, 0], ntp[0, 0, 0], nsl[0, 0, 0]) == (1, 0, 1)
    assert s_ret[0, 0, 0] == pytest.approx(-0.05)
    spec = outcomes.OutcomeSpec(horizon_bars=3, tp_frac=0.05, sl_frac=0.05, timeframe="1d")
    assert outcomes.resolve_outcome(tie, idx[0], spec).exit_reason == outcomes.EXIT_SL

    # Gap down through the stop on the bar after entry fills at that open.
    gap = tie.copy()
    gap.loc[idx[1], ["High", "Low"]] = [100.5, 99.5]
    gap.loc[idx[2], ["Open", "High", "Low", "Close"]] = [90, 91, 89, 90]
    o, h, l, c = _arrays(gap)
    fp_tp, fp_sl = label_grid.passage_tables(o, h, l, tps, sls, 3)
    _cnt, _ntp, _nsl, s_ret, *_ = label_grid.research_grid(o, c, fp_tp, fp_sl, tps, sls, hs, 1, 1, 5, 4, 1)
    assert s_ret[0, 0, 0] == pytest.approx(-0.10)
    assert outcomes.resolve_outcome(gap, idx[0], spec).gross_return == pytest.approx(-0.10)

    # Nothing touched: timeout at the close of the last horizon bar; incomplete windows excluded.
    flat = tie.copy()
    flat.loc[idx[1], ["High", "Low"]] = [100.5, 99.5]
    flat.loc[idx[3], "Close"] = 102.0
    o, h, l, c = _arrays(flat)
    fp_tp, fp_sl = label_grid.passage_tables(o, h, l, tps, sls, 3)
    cnt, ntp, nsl, s_ret, _s0, held, *_ = label_grid.research_grid(o, c, fp_tp, fp_sl, tps, sls, hs, 1, 5, 5, 4, 1)
    assert cnt[0, 0, 0] == 3  # entries 1, 2, 3; entries 4 and 5 would need bars after the end
    out = outcomes.resolve_outcome(flat, idx[0], spec)
    assert out.exit_reason == outcomes.EXIT_TIMEOUT and out.gross_return == pytest.approx(0.02)
    assert outcomes.label_for_method(outcomes.resolve_outcome(flat, idx[4], spec), outcomes.LABEL_METHOD_V2) is None


def test_research_period_never_reads_later_bars():
    df = _bars()
    sel_end = 59
    base = label_research.compute(df, sel_end, TPS, SLS, HS, 0.002)
    shocked = df.copy()
    shocked.iloc[sel_end + 1:, :] *= np.linspace(0.5, 2.0, len(df) - sel_end - 1)[:, None]
    shocked["High"] = shocked[["Open", "High", "Close"]].max(axis=1)
    shocked["Low"] = shocked[["Open", "Low", "Close"]].min(axis=1)
    moved = label_research.compute(shocked, sel_end, TPS, SLS, HS, 0.002)
    for key in ("samples", "share1", "net", "block_range"):
        assert np.array_equal(np.nan_to_num(base["selection"][key], nan=-9), np.nan_to_num(moved["selection"][key], nan=-9)), key
    assert np.array_equal(np.nan_to_num(base["suitability"], nan=-1), np.nan_to_num(moved["suitability"], nan=-1))
    assert np.array_equal(np.nan_to_num(base["robustness"], nan=-1), np.nan_to_num(moved["robustness"], nan=-1))
    assert base["evaluation"] is not None
    assert not np.array_equal(base["evaluation"]["net"], moved["evaluation"]["net"])


def test_selection_index_boundaries():
    idx = pd.bdate_range("2020-01-01", periods=10)
    assert label_research.selection_index(idx, None) == 9
    assert label_research.selection_index(idx, "not a date") == 9
    assert label_research.selection_index(idx, "2020-01-07") == 4
    assert label_research.selection_index(idx, "2020-01-04") == 2  # weekend -> last bar before it
    assert label_research.selection_index(idx, "2019-01-01") == 9  # before the data: whole range
    assert label_research.selection_index(idx, "2030-01-01") == 9  # at/after the last bar: no evaluation


def test_scores_follow_documented_formulas():
    res = label_research.compute(_bars(160, seed=11), 159, TPS, SLS, HS, 0.002)
    comp, sel = res["components"], res["selection"]
    valid = res["valid"]
    assert valid.any()
    a, b, c = (int(x) for x in np.argwhere(valid)[0])
    share = sel["share1"][a, b, c]
    assert comp["data"][a, b, c] == pytest.approx(min(1.0, sel["independent"][a, b, c] / label_research.REF_INDEPENDENT))
    assert comp["balance"][a, b, c] == pytest.approx(min(1.0, min(share, 1 - share) / label_research.REF_MINORITY))
    rel = sel["block_range"][a, b, c] / min(share, 1 - share)
    assert comp["time"][a, b, c] == pytest.approx(max(0.0, 1.0 - rel / label_research.REF_REL_BLOCK_RANGE))
    prod = np.prod([comp[k][a, b, c] for k in ("data", "balance", "time", "neighbours", "economics")])
    assert res["suitability"][a, b, c] == pytest.approx(100.0 * prod ** 0.2)
    mean4 = np.mean([comp[k][a, b, c] for k in ("time", "payoff_sign", "neighbours", "horizon")])
    assert res["robustness"][a, b, c] == pytest.approx(100.0 * mean4)
    assert np.all(np.isnan(res["suitability"][~valid]))
    finite = res["suitability"][valid]
    assert np.all((finite >= 0) & (finite <= 100))


def test_stability_tolerance_is_relative_to_the_minority_share():
    tol = label_research.share_tolerance(np.array([0.05, 0.08, 0.30, 0.50, 0.92]))
    assert tol.tolist() == pytest.approx([0.02, 0.02, 0.06, 0.10, 0.02])
    # A rare class whose share wanders by 8 pp is unstable; a balanced one moving by 8 pp is not.
    rel = label_research.relative_block_range(np.array([0.08, 0.08]), np.array([0.08, 0.45]))
    assert rel[0] == pytest.approx(1.0) and rel[1] == pytest.approx(0.08 / 0.45)


def test_ranking_ties_and_determinism():
    values = np.array([[[5.0, 5.0], [np.nan, 1.0]]])
    samples = np.array([[[10, 20], [99, 10]]])
    assert label_research._rank(values, samples) == [(0, 0, 1), (0, 0, 0), (0, 1, 1)]
    df = _bars(160, seed=11)
    periods = {"research": {}, "evaluation": None}
    one = label_research.candidates_payload(label_research.compute(df, 159, TPS, SLS, HS, 0.002), np.zeros((3, 3, 4)),
                                            cost=0.002, periods=periods)
    two = label_research.candidates_payload(label_research.compute(df, 159, TPS, SLS, HS, 0.002), np.zeros((3, 3, 4)),
                                            cost=0.002, periods=periods)
    assert one == two
    assert one["version"] == label_research.METHODOLOGY_VERSION
    assert one["label"]["method"] == outcomes.LABEL_METHOD_V2
    for cand in one["candidates"]:
        assert set(cand["scores"]) >= {"profitability_cagr_pct", "label_payoff_cagr_pct", "suitability", "robustness"}


def test_surface_payload_layout():
    res = label_research.compute(_bars(), 59, TPS, SLS, HS, 0.002)
    pay = label_research.surface_payload(res)
    assert pay["version"] == label_research.METHODOLOGY_VERSION
    grid = pay["metrics"]["label1_share"]
    assert len(grid) == len(HS) and len(grid[0]) == len(SLS) and len(grid[0][0]) == len(TPS)
    assert "eval_label1_share" in pay["metrics"]
