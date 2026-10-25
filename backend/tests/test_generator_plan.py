"""Generator sample planning: estimate == generation, boundaries, balancing, validation."""

from __future__ import annotations

import importlib.util
import json
import os
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from pydantic import ValidationError

from app.services import generator_plan as gp
from app.services import trade_outcomes as outcomes

HOLIDAYS = {date(2021, 1, 1), date(2021, 1, 18), date(2021, 2, 15), date(2021, 4, 2), date(2021, 5, 31),
            date(2021, 7, 5), date(2021, 9, 6), date(2021, 11, 25), date(2021, 12, 24),
            date(2022, 1, 17), date(2022, 2, 21), date(2022, 4, 15), date(2022, 5, 30), date(2022, 6, 20),
            date(2022, 7, 4), date(2022, 9, 5), date(2022, 11, 24), date(2022, 12, 26)}


def trading_days(start: str, end: str) -> list:
    return [d.date() for d in pd.bdate_range(start, end) if d.date() not in HOLIDAYS]


def synthetic(start="2021-01-01", end="2022-12-31", drift=0.0, vol=0.012, seed=0, tz="America/New_York") -> pd.DataFrame:
    days = trading_days(start, end)
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(rng.normal(drift, vol, len(days))))
    open_ = close * np.exp(rng.normal(0, vol / 3, len(days)))
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, vol / 2, len(days))))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, vol / 2, len(days))))
    idx = pd.DatetimeIndex(pd.to_datetime(days)).tz_localize(tz)
    return pd.DataFrame({"Open": open_, "High": high, "Low": low, "Close": close, "Volume": 1.0}, index=idx)


def params(**kw) -> gp.PlanParams:
    base = dict(timeframe="1d", lookback_unit="weeks", lookback_count=2, horizon=5, tp=0.02, sl=0.02,
                per_class=40, end_date=date(2022, 12, 30))
    base.update(kw)
    return gp.PlanParams(**base)


# --- labels -----------------------------------------------------------------------------------

@pytest.mark.parametrize("w,tp,sl", [(1, 0.01, 0.01), (5, 0.02, 0.015), (12, 0.05, 0.03), (30, 0.2, 0.1)])
def test_vectorized_labels_match_outcome_contract(w, tp, sl):
    df = synthetic(seed=w)
    df.iloc[40, 2] = np.nan            # missing low inside some horizons
    df.iloc[80, 0] = df.iloc[79, 3] * 0.9   # gap down through stops
    df.iloc[120, 1] = df.iloc[120, 0] * 1.3  # one bar touching both levels
    df.iloc[120, 2] = df.iloc[120, 0] * 0.7
    labels = gp.outcome_labels(df, w, tp, sl)
    spec = outcomes.OutcomeSpec(horizon_bars=w, tp_frac=tp, sl_frac=sl, timeframe="1d")
    for pos in range(len(df)):
        oc = outcomes.resolve_outcome(df, df.index[pos], spec)
        want = outcomes.label_for_method(oc, outcomes.LABEL_METHOD_V2)
        if want is None:
            want = gp.LABEL_INVALID if oc.status == outcomes.STATUS_INVALID else gp.LABEL_INCOMPLETE
        assert labels[pos] == want, pos


# --- trading days and holidays -----------------------------------------------------------------

def test_walk_uses_each_trading_bar_once_and_skips_holidays():
    df = synthetic()
    p = params(per_class=0, start_date=date(2022, 1, 1))
    plan = gp.plan_symbol("SYN", df, p)
    bars = trading_days("2021-01-01", "2022-12-30")
    # Every calendar step whose 2-week window starts on/after the training start maps to the
    # newest trading bar on or before it; each bar is used once.
    steps = [date(2022, 12, 30) - timedelta(days=i) for i in range(400)]
    steps = [e for e in steps if e - timedelta(weeks=2) >= date(2022, 1, 1)]
    expected = {max(b for b in bars if b <= e) for e in steps}
    decisions = {s.decision_date for s in plan.selections}
    assert len(decisions) == len(plan.selections)
    assert decisions.isdisjoint(HOLIDAYS)
    assert all(d.weekday() < 5 for d in decisions)
    assert plan.decision_bars == len(expected) == 242
    assert decisions <= expected


def test_window_start_on_a_holiday_still_counts_as_complete():
    df = synthetic(start="2021-01-04")  # first bar after the New Year holiday
    p = params(per_class=0, end_date=date(2021, 3, 31), lookback_count=1)
    plan = gp.plan_symbol("SYN", df, p)
    assert plan.earliest_observation == "2021-01-04"
    assert plan.stop_reason == gp.STOP_HISTORY


# --- counts and balancing ---------------------------------------------------------------------

def test_counts_add_up_and_respect_the_per_class_target():
    df = synthetic()
    plan = gp.plan_symbol("SYN", df, params(per_class=30))
    assert plan.kept_label0 <= 30 and plan.kept_label1 <= 30
    assert plan.valid_windows == plan.label0_found + plan.label1_found
    assert plan.kept_label0 + plan.kept_label1 + plan.skipped_class_full == plan.valid_windows
    assert plan.decision_bars == plan.valid_windows + plan.incomplete_horizon + plan.invalid_windows
    assert len(plan.selections) == plan.kept_label0 + plan.kept_label1
    if plan.stop_reason == gp.STOP_TARGET:
        assert plan.kept_label0 == plan.kept_label1 == 30


def test_rare_label_limits_balanced_total_and_keep_all_does_not():
    df = synthetic(drift=-0.004, seed=3)  # falling prices: take profit rarely first
    p = params(per_class=200, tp=0.04, sl=0.01)
    plan = gp.plan_symbol("SYN", df, p)
    assert plan.kept_label1 < plan.kept_label0
    bal = gp.finalize([plan], 200, "match_minority")
    assert bal["final_label0"] == bal["final_label1"] == plan.kept_label1
    assert bal["removed_for_balance"] == plan.kept_label0 - plan.kept_label1
    assert not bal["fulfilled"] and bal["limit"]["code"] == gp.STOP_HISTORY
    assert "label 1" in bal["limit"]["message"]
    keep = gp.finalize([plan], 200, "keep_all")
    assert keep["final_total"] == plan.kept_label0 + plan.kept_label1
    assert keep["removed_for_balance"] == 0


def test_balancing_is_global_across_symbols():
    a = gp.plan_symbol("A", synthetic(seed=1), params(per_class=25))
    b = gp.plan_symbol("B", synthetic(drift=-0.004, seed=2), params(per_class=25, tp=0.04, sl=0.01))
    tot = gp.finalize([a, b], 25, "match_minority")
    k0, k1 = a.kept_label0 + b.kept_label0, a.kept_label1 + b.kept_label1
    assert tot["final_total"] == 2 * min(k0, k1)
    assert tot["requested_total"] == 100


def test_insufficient_history_reports_maximum_and_constraint():
    df = synthetic(start="2022-10-01")
    out = gp.finalize([gp.plan_symbol("SYN", df, params(per_class=500))], 500, "match_minority")
    assert not out["fulfilled"]
    assert out["final_total"] < out["requested_total"]
    assert out["limit"]["code"] == gp.STOP_HISTORY
    assert out["earliest_observation"] >= "2022-10-03"


def test_no_data_symbol():
    plan = gp.plan_symbol("NONE", pd.DataFrame(), params())
    assert plan.stop_reason == gp.STOP_NO_DATA and not plan.selections
    out = gp.finalize([plan], 40, "match_minority")
    assert out["final_total"] == 0 and out["limit"]["code"] == gp.STOP_NO_DATA


# --- training start, extension and boundaries -------------------------------------------------

def test_fixed_period_stops_at_training_start_and_extension_goes_further():
    df = synthetic()
    fixed = gp.plan_symbol("SYN", df, params(per_class=150, start_date=date(2022, 9, 1)))
    assert fixed.stop_reason == gp.STOP_START
    assert all(s.window_start >= date(2022, 9, 1) for s in fixed.selections)
    ext = gp.plan_symbol("SYN", df, params(per_class=150, start_date=date(2022, 9, 1), extend=True))
    assert len(ext.selections) > len(fixed.selections)
    assert ext.earliest_observation < "2022-09-01"


def test_extension_never_crosses_the_research_floor():
    df = synthetic()
    floor = date(2022, 6, 1)
    plan = gp.plan_symbol("SYN", df, params(per_class=500, start_date=date(2022, 9, 1), extend=True, floor_date=floor))
    assert plan.stop_reason == gp.STOP_FLOOR
    assert min(s.window_start for s in plan.selections) >= floor
    assert plan.earliest_observation >= floor.isoformat()
    out = gp.finalize([plan], 500, "match_minority")
    assert out["limit"]["code"] == gp.STOP_FLOOR and "Labeling Optimizer" in out["limit"]["message"]


def test_bars_after_the_dataset_end_are_never_used():
    end = date(2022, 6, 30)
    full = synthetic()
    cut = full[[d.date() <= end for d in full.index]]
    p = params(per_class=0, end_date=end, horizon=10)
    a, b = gp.plan_symbol("SYN", full, p), gp.plan_symbol("SYN", cut, p)
    assert [(s.pos, s.label) for s in a.selections] == [(s.pos, s.label) for s in b.selections]
    assert a.incomplete_horizon > 0  # the last decision bars cannot resolve inside the period
    assert max(s.window_end for s in a.selections) <= end
    assert a.last_bar == "2022-06-30"


def test_weekly_bars_that_end_after_the_dataset_end_are_dropped():
    idx = pd.date_range("2022-01-03", "2022-06-27", freq="W-MON")
    df = pd.DataFrame({"Open": 1.0, "High": 1.1, "Low": 0.9, "Close": 1.0}, index=idx)
    kept = gp.prepare_bars(df, "1wk", date(2022, 6, 29))
    assert kept.index[-1] == pd.Timestamp("2022-06-20")  # week of 06-27 ends 07-03


def test_fetch_requests_no_bars_after_the_end(monkeypatch):
    calls = []

    class FakeTicker:
        def __init__(self, sym):
            pass

        def history(self, **kw):
            calls.append(kw)
            return pd.DataFrame()

    import yfinance

    monkeypatch.setattr(yfinance, "Ticker", FakeTicker)
    gp.fetch_history("SYN", "1d", date(2022, 6, 30), date(2020, 1, 1))
    gp.fetch_history("SYN", "1d", date(2022, 6, 30))
    assert calls[0] == {"start": "2020-01-01", "end": "2022-07-01", "interval": "1d"}
    assert calls[1] == {"period": "max", "end": "2022-07-01", "interval": "1d"}


def test_history_fetch_start():
    assert gp.history_fetch_start(params()) is None
    assert gp.history_fetch_start(params(start_date=date(2022, 1, 1))) == date(2022, 1, 1)
    assert gp.history_fetch_start(params(start_date=date(2022, 1, 1), extend=True)) is None
    fl = date(2021, 6, 1)
    assert gp.history_fetch_start(params(start_date=date(2022, 1, 1), extend=True, floor_date=fl)) == fl


# --- the script renders exactly the planned samples ---------------------------------------

def _load_script():
    path = Path(__file__).resolve().parents[1] / "scripts" / "1.3_Adj_TrL.py"
    spec = importlib.util.spec_from_file_location("gen_script_13", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_generation_matches_estimate(tmp_path, monkeypatch):
    df = synthetic(start="2022-01-03", end="2022-08-31", seed=5)
    monkeypatch.setattr(gp, "fetch_history", lambda sym, tf, end, start=None: df)
    mod = _load_script()
    p = params(per_class=6, end_date=date(2022, 8, 31), lookback_count=1, horizon=3)
    expected = gp.plan_symbol("SYN", df, p)
    report = mod.generate_and_save_labeled_charts(
        "SYN", 6, str(tmp_path / "out"), "yes", "1d", "weeks", 1, 3, 0.02, 0.02, 64, 0,
        end_date=date(2022, 8, 31), report_path=str(tmp_path / "report.json"),
    )
    pngs = sorted(f for f in os.listdir(tmp_path / "out") if f.endswith(".png"))
    assert len(pngs) == len(expected.selections) == 12
    assert sum(f.endswith("_label1.png") for f in pngs) == expected.kept_label1
    row = json.loads((tmp_path / "report.json").read_text())["symbols"][0]
    assert row["rendered_label0"] + row["rendered_label1"] == 12 and row["render_failed"] == 0
    assert report["params"]["end_date"] == "2022-08-31"
    samples = [json.loads(x) for x in (tmp_path / "out" / "_provenance" / "samples.jsonl").read_text().splitlines()]
    assert all(s["horizon_end_ts"][:10] <= "2022-08-31" for s in samples)


# --- API mapping and validation ------------------------------------------------------------

_REQ = dict(symbols="aapl, msft", chartsPerLabel=50, useCandles=True, timeframe="1d", timespanUnit="months",
            timespanCount=6, horizonBars=7, takeProfitFraction=0.02, stopLossFraction=0.01,
            imageDimension=224, endOffset=0)


def test_request_validation_messages():
    from app.main import TrainingChartGeneratorRequest, generator_request_errors

    req = TrainingChartGeneratorRequest(**_REQ, datasetName="  AAPL daily  ")
    assert req.symbols == "AAPL,MSFT" and req.datasetName == "AAPL daily"
    with pytest.raises(ValidationError, match="Dataset name is required"):
        TrainingChartGeneratorRequest(**_REQ, datasetName="   ")
    bad = TrainingChartGeneratorRequest.model_construct(**{
        **_REQ, "symbols": " ", "stopLossFraction": 1.0, "volumeMode": "by_period",
        "trainingStartIso": "2023-01-01", "referenceEndIso": "2022-01-01", "datasetName": "",
        "balanceMode": None,
    })
    errs = generator_request_errors(bad)
    assert errs["symbols"] == "Add at least one stock symbol."
    assert errs["stopLoss"].startswith("Stop loss")
    assert errs["trainingStart"] == "Training start must be before the dataset end."
    assert errs["datasetName"] == "Dataset name is required."
    future = (date.today() + timedelta(days=3)).isoformat()
    with pytest.raises(ValidationError, match="future"):
        TrainingChartGeneratorRequest(**_REQ, referenceEndIso=future)


def test_plan_params_mapping_and_estimate():
    from app.main import estimate_generator_counts, generator_plan_params

    cfg = {**_REQ, "volumeMode": "by_period", "trainingStartIso": "2022-03-01", "referenceEndIso": "2022-12-30",
           "extendHistory": True, "sourceOptimizer": {"research_start": "2022-01-03"}}
    p = generator_plan_params(cfg)
    assert (p.start_date, p.end_date, p.floor_date, p.extend) == (date(2022, 3, 1), date(2022, 12, 30), date(2022, 1, 3), True)
    assert generator_plan_params({**_REQ, "extendHistory": True}).extend is False  # only for fixed periods

    seen = []

    def loader(sym, tf, end, start):
        seen.append((sym, end, start))
        return synthetic(seed=1 if sym == "AAA" else 2)

    cfg = {**_REQ, "symbols": "AAA,BBB", "chartsPerLabel": 400, "volumeMode": "by_period",
           "trainingStartIso": "2022-06-01", "referenceEndIso": "2022-12-30", "timespanUnit": "weeks", "timespanCount": 2}
    out = estimate_generator_counts(cfg, loader)
    assert out["ok"] and out["source"] == "market_data" and out["requested_total"] == 1600
    assert not out["fulfilled"] and out["limit"]["code"] == gp.STOP_START
    assert out["window_per_class"] > 0
    assert out["with_extension"]["final_total"] > out["final_total"]
    assert all(end == date(2022, 12, 30) for _, end, _ in seen)
    assert seen[0][2] == date(2022, 6, 1)  # fixed period: nothing before the training start is fetched

    extended = estimate_generator_counts({**cfg, "extendHistory": True}, loader)
    assert extended["window_per_class"] == out["window_per_class"]
    assert extended["final_total"] >= out["final_total"]
