"""No-model baselines, paired bootstrap and verdict of the v2 backtest (incremental value of the CNN)."""

import numpy as np
import pandas as pd

from app.services import trade_outcomes as to
from app.services.backtest_engine import benchmarks as bm
from app.services.backtest_engine import findings as fd
from app.services.backtest_engine import incremental as inc
from app.services.backtest_engine import metrics as mt
from app.services.backtest_engine.simulation import Signal, SimConfig, simulate

TZ = "America/New_York"
SPEC = to.OutcomeSpec(horizon_bars=5, tp_frac=0.02, sl_frac=0.02)


def walk(seed, n=260, start="2024-01-02"):
    rng = np.random.default_rng(seed)
    close = 100 * np.cumprod(1 + rng.normal(0, 0.012, n))
    open_ = np.concatenate([[100], close[:-1]]) * (1 + rng.normal(0, 0.002, n))
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.006, n)))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.006, n)))
    idx = pd.bdate_range(start, periods=n, tz=TZ)
    return pd.DataFrame({"Open": open_, "High": high, "Low": low, "Close": close, "Volume": 1.0}, index=idx)


def setup(model):
    bars = {s: walk(i) for i, s in enumerate(["AAA", "BBB", "CCC"])}
    signals, outcomes = [], {}
    for sym, df in bars.items():
        for ts in df.index[:-SPEC.horizon_bars - 1]:
            sid = f"{sym}-{ts.date()}"
            o = to.resolve_outcome(df, ts, SPEC)
            label = to.label_for_method(o, to.LABEL_METHOD_V2)
            outcomes[sid] = o
            signals.append(Signal(sid, sym, ts, model(label), label))
    cfg = SimConfig(starting_capital=10_000, position_size_pct=20, max_concurrent_positions=5)
    start = min(s.decision_ts for s in signals)
    res = simulate(signals, bars, SPEC, cfg, threshold=0.5, start_date=start, outcomes=outcomes)
    tm = mt.trading_metrics(res.equity, res.trades, cfg.starting_capital, "1d")
    bench = bm.compute_benchmarks(bars, list(bars), res.equity["date"].tolist(), cfg.starting_capital, cfg.commission_pct,
                                  cfg.slippage_pct, (tm.get("avg_exposure") or {}).get("value"), "1d")
    return inc.compute_incremental(
        cnn_res=res, cnn_metrics=tm, signals=signals, bars=bars, spec=SPEC, cfg=cfg, threshold=0.5, start=start,
        purged=set(), outcomes=outcomes, benchmarks=bench, timeframe="1d", evaluation_class="independent_test", draws=12,
    )


def test_paired_bootstrap_is_zero_for_identical_curves_and_positive_for_a_dominant_one():
    d = [str(x.date()) for x in pd.bdate_range("2024-01-02", periods=200)]
    rng = np.random.default_rng(3)
    base = 100 * np.cumprod(1 + rng.normal(0, 0.01, 200))
    same = inc.paired_block_bootstrap(inc._series(d, base), inc._series(d, base), 5, 252)
    assert same["mean_diff_annualized"] == 0 and same["ci95_annualized"][0] <= 0 <= same["ci95_annualized"][1]
    better = inc.paired_block_bootstrap(inc._series(d, base * np.cumprod(np.full(200, 1.001))), inc._series(d, base), 5, 252)
    assert better["ci95_annualized"][0] > 0 and better["p_diff_le_0"] == 0
    short = inc.paired_block_bootstrap(inc._series(d[:20], base[:20]), inc._series(d[:20], base[:20]), 5, 252)
    assert short.get("value") is None and "needs at least" in short["unavailable"]


def test_a_model_that_knows_the_label_is_not_judged_without_edge():
    out = setup(lambda label: 0.9 if label == 1 else 0.1)
    assert out["always_eligible"]["executed_trades"] > 0
    assert out["cnn"]["expectancy_return"] > out["always_eligible"]["expectancy_return"]
    assert out["random_entry"]["cnn_percentile"] == 1.0
    assert out["verdict"]["id"] in (inc.EDGE, inc.INCONCLUSIVE)
    assert out["paired"]["always_eligible"]["mean_diff_annualized"] > 0


def test_an_inverted_model_shows_no_incremental_edge_and_findings_link_to_improve():
    out = setup(lambda label: 0.1 if label == 1 else 0.9)
    assert out["verdict"]["id"] == inc.NO_EDGE
    found = fd.build_findings({"incremental": out, "trading_metrics": {}, "classification_metrics": {}, "threshold": {"source": "validation_locked"}})
    v = next(f for f in found if f["id"] == "incremental_verdict")
    assert v["severity"] == fd.NEGATIVE and v["action"]["kind"] == fd.ACTION_IMPROVE
    assert next(f for f in found if f["id"] == "filter_expectancy")["severity"] == fd.NEGATIVE


def test_verdict_is_invalid_without_trades_and_capped_for_exploratory_runs():
    v = inc.verdict({"cnn": {"executed_trades": 0}, "always_eligible": {"executed_trades": 3}, "paired": {}}, "independent_test")
    assert v["id"] == inc.INVALID
    edge_like = {
        "cnn": {"executed_trades": 80, "closed_trades": 80, "total_return": 0.2},
        "always_eligible": {"executed_trades": 120},
        "paired": {"always_eligible": {"mean_diff_annualized": 0.1, "ci95_annualized": [0.05, 0.15]}},
        "random_entry": {"cnn_percentile": 1.0, "p_random_ge_cnn": 0.02, "draws": 50},
    }
    assert inc.verdict(edge_like, "independent_test")["id"] == inc.EDGE
    capped = inc.verdict(edge_like, "exploratory")
    assert capped["id"] == inc.INCONCLUSIVE and any("independent" in r for r in capped["reasons"])
