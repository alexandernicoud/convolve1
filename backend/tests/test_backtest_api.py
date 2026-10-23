"""Backtest API: ownership, path stripping, v1 compatibility labelling, v2 pagination, job states."""

import json
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app.services import backtest_api as ba


def _auth(client, user):
    from tests.conftest import mint_token

    h = {"Authorization": f"Bearer {mint_token(user)}"}
    client.get("/api/me", headers=h)
    return h


def _own(run_id, user):
    from app.db import SessionLocal
    from app.models import PipelineRun

    db = SessionLocal()
    try:
        db.add(PipelineRun(id=run_id, user_id=user, tool="backtester", status="succeeded"))
        db.commit()
    finally:
        db.close()


V1_RESULTS = {
    "config": {"model_path": "/Users/x/secret/model.keras", "dataset_path": "/Users/x/ds/images", "tp_pct": 2.0, "sl_pct": 2.0,
               "max_trades_per_day": 10},
    "kpis": {"return_pct": -1.2, "sharpe_ratio": 8.0, "sharpe_ratio_annualized_hint": 6.0, "max_drawdown_pct": 1.4},
    "series": {"equity": [{"equity": 100.0}, {"equity": 110.0}, {"equity": 99.0}], "drawdown_pct": []},
    "trades": [{"trade_id": 1, "filename": "/Users/x/ds/images/MSFT_2025-01-01_to_2025-06-01_label1.png"}],
    "chart_events": [{"filename": "/Users/x/ds/images/A.png", "actual_label": 1}, {"filename": "/Users/x/ds/images/B.png", "actual_label": 0},
                     {"filename": "/Users/x/ds/images/C.png", "actual_label": 0}],
    "charts": {"equity_curve": "/Users/x/runs/eq.png"},
    "classification_metrics": {"accuracy": 0.5},
}


@pytest.fixture
def v1_run(tmp_path, monkeypatch, user_a):
    import runners.new_backtester_runner as nbr

    run_id = f"bt-v1-{uuid.uuid4().hex[:10]}"
    out = tmp_path / "out"
    out.mkdir()
    (out / "backtest_results.json").write_text(json.dumps(V1_RESULTS))
    ds = tmp_path / "ds"
    (ds / "images").mkdir(parents=True)
    (ds / "summary.json").write_text(json.dumps({"label_definition": {"tp_frac": 0.02, "sl_frac": 0.01}}))
    info = {"status": "succeeded", "output_dir": str(out), "started_at": time.time(),
            "logs": f"12:00 loading {tmp_path}/secret/model.keras", "config": {"dataset_path": str(ds / "images")}}
    monkeypatch.setattr(nbr, "get_run_info", lambda rid: info if rid == run_id else None)
    _own(run_id, user_a)
    return run_id, info


def test_v1_results_are_labelled_and_stripped(client: TestClient, user_a, v1_run, tmp_path):
    run_id, _ = v1_run
    r = client.get(f"/api/backtests/{run_id}/results", headers=_auth(client, user_a))
    assert r.status_code == 200
    body = r.json()
    text = json.dumps(body)
    assert "/Users/" not in text and str(tmp_path) not in text
    assert body["methodology"]["id"] == "label_payoff_v1"
    assert body["banner"] == "Legacy label-payoff estimate — not a price-based trading simulation."
    assert "sharpe_ratio" not in body["kpis"] and "sharpe_ratio" in body["withheld_metrics"]
    assert "max_drawdown_pct" not in body["kpis"] and body["kpis"]["drawdown_below_start_pct"] == 1.4
    assert body["kpis"]["peak_to_trough_drawdown_pct_of_estimate"] == pytest.approx(10.0)
    assert body["trades"][0]["image_id"] == "MSFT_2025-01-01_to_2025-06-01_label1.png"
    assert body["tp_sl_mismatch"]["dataset_sl_pct"] == 1.0
    assert body["classification_metrics"]["majority_baseline_accuracy"] == pytest.approx(2 / 3)
    assert any("max_trades_per_day" in w for w in body["warnings"])


def test_v1_artifact_untouched(client, user_a, v1_run, tmp_path):
    run_id, _ = v1_run
    before = (tmp_path / "out" / "backtest_results.json").read_bytes()
    client.get(f"/api/v2/backtests/{run_id}/summary", headers=_auth(client, user_a))
    assert (tmp_path / "out" / "backtest_results.json").read_bytes() == before


def test_status_strips_paths_and_reports_methodology(client, user_a, v1_run, tmp_path):
    run_id, _ = v1_run
    s = client.get(f"/api/backtests/{run_id}", headers=_auth(client, user_a)).json()
    assert str(tmp_path) not in s["log_tail"] and "model.keras" in s["log_tail"]
    assert s["methodology"]["id"] == "label_payoff_v1" and s["terminal"] is True


def test_other_user_cannot_read(client, user_a, user_b, v1_run):
    run_id, _ = v1_run
    hb = _auth(client, user_b)
    for url in (f"/api/backtests/{run_id}", f"/api/backtests/{run_id}/results", f"/api/v2/backtests/{run_id}/summary",
                f"/api/v2/backtests/{run_id}/trades", f"/api/v2/backtests/{run_id}/sample-image/A.png"):
        assert client.get(url, headers=hb).status_code == 404, url


def test_v2_endpoints_refuse_legacy_runs(client, user_a, v1_run):
    run_id, _ = v1_run
    r = client.get(f"/api/v2/backtests/{run_id}/trades", headers=_auth(client, user_a))
    assert r.status_code == 404 and "legacy" in r.json()["detail"]


def test_interrupted_state(client, user_a, monkeypatch, tmp_path):
    import app.main as m
    import runners.new_backtester_runner as nbr

    run_id = f"bt-int-{uuid.uuid4().hex[:10]}"
    info = {"status": "running", "output_dir": str(tmp_path), "started_at": m._API_STARTED_AT - 100, "progress": 0.4}
    monkeypatch.setattr(nbr, "get_run_info", lambda rid: info if rid == run_id else None)
    _own(run_id, user_a)
    s = client.get(f"/api/backtests/{run_id}", headers=_auth(client, user_a)).json()
    assert s["status"] == "interrupted" and s["terminal"] is True
    assert info["status"] == "running"  # nothing rewritten, nothing retried


@pytest.fixture
def v2_run(tmp_path, monkeypatch, user_a):
    import runners.new_backtester_runner as nbr

    run_id = f"bt-v2-{uuid.uuid4().hex[:10]}"
    out = tmp_path / "out"
    out.mkdir()
    (out / "backtest_results.json").write_text(json.dumps({
        "methodology": {"id": "price_sim_v2"}, "model": {"model_id": "m1", "path": "/abs/x"}, "findings": [{"id": "f"}],
        "threshold_sweep": {"rows": []}, "robustness": {}, "trading_metrics": {}, "classification_metrics": {},
    }))
    cols = "sample_id,symbol,prob,entry_ts,status,exit_reason,net_pnl,flags\n"
    rows = "".join(f"S{i}.png,{'AB'[i % 2]},{i / 10},2025-01-{i + 10:02d}T00:00:00-05:00,closed,{'tp' if i % 3 else 'sl'},{i - 4},gap_through_stop\n" for i in range(9))
    (out / "trades.csv").write_text(cols + rows)
    ds = tmp_path / "ds" / "images"
    ds.mkdir(parents=True)
    (ds / "S1.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (tmp_path / "secret.png").write_bytes(b"x")
    info = {"status": "succeeded", "engine": "v2", "output_dir": str(out), "started_at": time.time(),
            "config": {"dataset_path": str(ds)}}
    monkeypatch.setattr(nbr, "get_run_info", lambda rid: info if rid == run_id else None)
    _own(run_id, user_a)
    return run_id


def test_v2_trades_paginate_and_filter(client, user_a, v2_run):
    h = _auth(client, user_a)
    r = client.get(f"/api/v2/backtests/{v2_run}/trades?limit=4&offset=0&sort=prob&order=desc", headers=h).json()
    assert r["total"] == 9 and len(r["rows"]) == 4 and r["rows"][0]["prob"] == 0.8
    assert r["rows"][0]["flags"] == ["gap_through_stop"]
    r = client.get(f"/api/v2/backtests/{v2_run}/trades?symbol=A&exit_reason=sl", headers=h).json()
    assert all(x["symbol"] == "A" and x["exit_reason"] == "sl" for x in r["rows"])
    r = client.get(f"/api/v2/backtests/{v2_run}/trades?outcome=loss", headers=h).json()
    assert all(x["net_pnl"] <= 0 for x in r["rows"])
    s = client.get(f"/api/v2/backtests/{v2_run}/summary", headers=h).json()
    assert "/abs/" not in json.dumps(s) and "threshold_sweep" not in s


def test_sample_image_route_is_contained(client, user_a, v2_run):
    h = _auth(client, user_a)
    assert client.get(f"/api/v2/backtests/{v2_run}/sample-image/S1.png", headers=h).status_code == 200
    for bad in ("..%2Fsecret.png", "..%2F..%2Fsecret.png", "secret.png", "S1.txt"):
        assert client.get(f"/api/v2/backtests/{v2_run}/sample-image/{bad}", headers=h).status_code == 404, bad


def test_strip_paths_unit():
    s = ba.strip_paths("Loading /Users/a/b/model.keras done; 'C:\\data\\x.png' and ratio 1/2")
    assert "/Users" not in s and "model.keras" in s and "1/2" in s
