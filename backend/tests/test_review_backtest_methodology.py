"""Review keeps legacy label-payoff estimates and price-based simulations apart."""

from app.services import review_meta as rm


V1_RESULTS = {
    "kpis": {
        "return_pct": -5.4, "pnl": -540.0, "win_rate": 35.0, "profit_factor": 0.86, "sharpe_ratio": -0.07,
        "sharpe_ratio_annualized_hint": -1.1, "max_drawdown": 722.5, "max_drawdown_pct": 7.2, "trades": 546,
    },
    "classification_metrics": {"accuracy": 0.37},
    "series": {"equity": [{"as_of_date": "2024-01-01", "equity": 10000.0, "strategy_indexed": 100.0}]},
}

V2_RESULTS = {
    "methodology": {"id": "price_sim_v2", "outcome_spec": {"tp_frac": 0.02, "sl_frac": 0.01}},
    "evaluation_class": "exploratory",
    "threshold": {"value": 0.42, "source": "user_fixed"},
    "config": {"starting_capital": 10000.0, "commission_pct": 0.1, "slippage_pct": 0.05},
    "dataset": {"symbols": ["MSFT"], "first_decision": "2024-05-06T00:00:00+00:00", "last_decision": "2026-10-19T00:00:00+00:00"},
    "trading_metrics": {
        "total_return": {"value": -0.093}, "net_pnl": {"value": -930.2}, "win_rate": {"value": 0.336},
        "profit_factor": {"value": 0.63}, "sharpe": {"value": None, "unavailable": "fewer than 30 periods"},
        "max_drawdown": {"value": 0.097}, "executed_trades": 292,
    },
    "classification_metrics": {"accuracy": {"value": 0.372}, "precision_label1": {"value": 0.35}},
}


def test_runner_records_terminal_state_in_pipeline_runs():
    import uuid

    from app.db import SessionLocal
    from app.models import PipelineRun, Profile
    from runners.new_backtester_runner import _persist_terminal_state

    rid = f"bt-{uuid.uuid4()}"
    db = SessionLocal()
    try:
        uid = uuid.uuid4()
        db.add(Profile(id=uid))
        db.flush()
        db.add(PipelineRun(id=rid, user_id=uid, tool="backtester", status="running"))
        db.commit()
    finally:
        db.close()
    _persist_terminal_state(rid, "failed", 0.0, "INPUT_ERROR: missing /Users/someone/private/file.csv")
    db = SessionLocal()
    try:
        row = db.get(PipelineRun, rid)
        assert row.status == "failed" and row.finished_at is not None
        assert "/Users/someone" not in (row.message or "") and "file.csv" in row.message
    finally:
        db.close()


def test_v1_summary_withholds_invalid_metrics_and_relabels():
    s = rm.backtest_summary({"config": {"tp_pct": 2, "sl_pct": 1}}, V1_RESULTS)
    p = s["performance"]
    assert s["methodology"]["id"] == "label_payoff_v1"
    assert "not a price-based trading simulation" in s["methodology"]["label"]
    assert p["estimate"] is True
    assert "sharpe_ratio" not in p and "sharpe_ratio_annualized_hint" not in p
    assert "max_drawdown_pct" not in p and p["drawdown_below_start_pct"] == 7.2
    assert "win_rate" not in p and p["label_precision_pct"] == 35.0


def test_v2_summary_reads_price_simulation(tmp_path):
    s = rm.backtest_summary({"config": {"tp_pct": 5, "sl_pct": 5}}, V2_RESULTS)
    p = s["performance"]
    assert s["methodology"] == {"id": "price_sim_v2", "label": "Price-based portfolio simulation",
                                "evaluation_class": "exploratory", "threshold_source": "user_fixed"}
    assert abs(p["return_pct"] - (-9.3)) < 1e-9 and p["trades"] == 292
    assert "sharpe_ratio" not in p, "unavailable metrics are omitted, never zero-filled"
    assert p["metrics_insufficient_sample"] is True
    assert s["assumptions"]["tp_pct"] == 2.0 and s["assumptions"]["sl_pct"] == 1.0, "exits come from the dataset"
    assert s["assumptions"]["confidence_threshold"] == 0.42
    assert s["period"] == {"start": "2024-05-06", "end": "2026-10-19"}

    (tmp_path / "equity_daily.csv").write_text("date,equity\n2024-05-06,10000\n2024-05-07,9900\n")
    (tmp_path / "benchmarks_daily.csv").write_text("date,spy,underlying\n2024-05-06,10000,10000\n2024-05-07,10100,\n")
    eq = rm.backtest_equity(V2_RESULTS, output_dir=str(tmp_path))
    assert eq[1] == {"as_of_date": "2024-05-07", "equity": 9900.0, "strategy_indexed": 99.0, "spy_indexed": 101.0}
    assert rm.backtest_equity(V2_RESULTS, output_dir=None) == []
