"""Research queue: Generator / Optimizer / test data outside the API process.

The dispatcher is a fake that records executions; workers run in-test through
research_worker.run_job with stand-in tool functions, so nothing fetches market data.
"""

from __future__ import annotations

import json
import time
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app import config as app_config
from app.db import SessionLocal
from app.jobs import research_worker
from app.main import all_runs
from app.models import PipelineRun
from app.services import research_jobs
from tests.conftest import mint_token

GEN = dict(
    symbols="AAPL", chartsPerLabel=20, useCandles=True, timeframe="1d", timespanUnit="months",
    timespanCount=6, horizonBars=7, takeProfitFraction=0.02, stopLossFraction=0.01,
    imageDimension=64, endOffset=0,
)


class FakeDispatcher:
    def __init__(self) -> None:
        self.runs: list[str] = []
        self.cancelled: list[str] = []
        self.ended: dict[str, bool] = {}

    def run(self, run_id: str) -> str:
        self.runs.append(run_id)
        return f"exec-{run_id}"

    def cancel(self, execution: str) -> None:
        self.cancelled.append(execution)

    def finished(self, execution: str):
        return self.ended.get(execution, False)


@pytest.fixture
def research(monkeypatch):
    fake = FakeDispatcher()
    monkeypatch.setattr(app_config, "RESEARCH_EXECUTION", "local_process")
    monkeypatch.setattr(app_config, "RESEARCH_MAX_ACTIVE_JOBS", 4)
    monkeypatch.setattr(app_config, "RESEARCH_MAX_ACTIVE_JOBS_PER_USER", 1)
    monkeypatch.setattr(app_config, "RESEARCH_MAX_QUEUED_JOBS_PER_USER", 3)
    monkeypatch.setattr(app_config, "RESEARCH_MAX_RUNS_PER_DAY", 0)
    monkeypatch.setattr(research_jobs, "POLL_PUMP_INTERVAL_S", 0.0)
    research_jobs.set_dispatcher(fake)
    yield fake
    research_jobs.set_dispatcher(None)
    research_jobs._last_execution_check.clear()
    db = SessionLocal()
    try:
        db.query(PipelineRun).filter(PipelineRun.tool.in_(research_jobs.TOOLS)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _h(uid: uuid.UUID) -> dict:
    return {"Authorization": f"Bearer {mint_token(uid)}"}


def _row(run_id: str) -> PipelineRun:
    db = SessionLocal()
    try:
        row = db.get(PipelineRun, run_id)
        db.expunge(row)
        return row
    finally:
        db.close()


def _start(client, uid, **overrides) -> str:
    r = client.post("/api/training-chart-generator/run", json={**GEN, **overrides}, headers=_h(uid))
    assert r.status_code == 200, r.text
    return r.json()["run_id"]


def _progress(client, uid, run_id) -> dict:
    r = client.get(f"/api/training-chart-generator/progress/{run_id}", headers=_h(uid))
    assert r.status_code == 200, r.text
    return r.json()


def _ok_generator(main, run_id, payload):
    """Stand-in for the generator: writes its finals, then reports success the way the tool does."""
    run_dir = Path(main.get_run_dir(run_id))
    (run_dir / "artifacts").mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(run_dir / f"training-dataset-{run_id}.zip", "w") as z:
        z.writestr("a_label0.png", b"png")
    (run_dir / "artifacts" / "dataset_stats.json").write_text(json.dumps({"total_charts": 1}))
    (run_dir / "progress.json").write_text(json.dumps({"phase": "done", "percent": 100, "elapsed_s": 1}))
    main.update_run_progress(run_id, 1.0, "completed", "Chart generation completed successfully", "succeeded")


def _set_old_heartbeat(run_id: str, seconds: int) -> None:
    def mutate(extra):
        extra[research_jobs.HEARTBEAT_KEY] = time.time() - seconds

    research_jobs._patch_extra(run_id, mutate)


def test_run_is_queued_for_a_worker_and_progress_comes_from_the_row(client, user_a, research):
    run_id = _start(client, user_a)
    assert research.runs == [run_id]
    row = _row(run_id)
    assert row.status == "queued" and row.worker_id == research_jobs.PENDING
    assert run_id not in all_runs  # the row, not this process's memory, is the source of truth
    assert _progress(client, user_a, run_id)["phase"] == "Starting a research worker"

    job = research_jobs.claim(run_id, "job/test/0/0")
    assert job["tool"] == "training-chart-generator" and job["payload"]["symbols"] == "AAPL"
    research_jobs.report(run_id, {"phase": "Rendering charts", "percent": 42.0, "elapsed_s": 3.0})
    view = _progress(client, user_a, run_id)
    assert (view["phase"], view["percent"]) == ("Rendering charts", 42.0)
    assert _row(run_id).progress == pytest.approx(0.42)


def test_worker_runs_the_tool_and_the_run_succeeds_once(client, user_a, research):
    run_id = _start(client, user_a)
    assert research_worker.run_job(run_id, runners={"training-chart-generator": _ok_generator}) == 0
    assert _row(run_id).status == "succeeded"
    assert _progress(client, user_a, run_id)["phase"] == "done"
    # A second execution for the same run (duplicate dispatch, late retry) does nothing.
    calls = []
    assert research_worker.run_job(run_id, runners={"training-chart-generator": lambda *a: calls.append(a)}) == 0
    assert calls == []
    assert research_jobs.claim(run_id, "job/other/0/0") is None


def test_users_second_run_waits_and_starts_when_the_first_ends(client, user_a, research):
    first = _start(client, user_a)
    second = _start(client, user_a, symbols="MSFT")
    assert research.runs == [first]
    assert _row(second).worker_id == research_jobs.WAITING
    assert _progress(client, user_a, second)["phase"] == "Queued: starts when your current run finishes"
    assert research_jobs.claim(second, "job/x/0/0") is None  # never dispatched, so not claimable

    research_worker.run_job(first, runners={"training-chart-generator": _ok_generator})
    _progress(client, user_a, second)  # any status poll moves the queue
    assert research.runs == [first, second]


def test_global_cap_is_fifo_across_users(client, user_a, user_b, research, monkeypatch):
    monkeypatch.setattr(app_config, "RESEARCH_MAX_ACTIVE_JOBS", 1)
    a1 = _start(client, user_a)
    b1 = _start(client, user_b)
    a2 = _start(client, user_a, symbols="MSFT")
    assert research.runs == [a1]
    assert _progress(client, user_b, b1)["phase"] == "Queued: next to start"
    assert _progress(client, user_a, a2)["phase"] == "Queued: 1 run ahead of yours"
    research_worker.run_job(a1, runners={"training-chart-generator": _ok_generator})
    research_jobs.pump_queue()
    assert research.runs == [a1, b1]


def test_identical_resubmission_is_refused_without_a_new_run(client, user_a, research):
    first = _start(client, user_a)
    r = client.post("/api/training-chart-generator/run", json=GEN, headers=_h(user_a))
    assert r.status_code == 409
    assert r.json()["detail"] == {
        "code": "duplicate_submission",
        "message": "An identical run is already queued or running; it was not started again.",
        "run_id": first,
    }
    db = SessionLocal()
    try:
        assert db.query(PipelineRun).filter(PipelineRun.user_id == user_a).count() == 1
    finally:
        db.close()


def test_queue_depth_limit(client, user_a, research, monkeypatch):
    monkeypatch.setattr(app_config, "RESEARCH_MAX_QUEUED_JOBS_PER_USER", 1)
    _start(client, user_a)
    _start(client, user_a, symbols="MSFT")
    r = client.post("/api/training-chart-generator/run", json={**GEN, "symbols": "NVDA"}, headers=_h(user_a))
    assert r.status_code == 429 and r.json()["detail"]["code"] == "queue_full"


def test_other_users_cannot_see_or_cancel_a_run(client, user_a, user_b, research):
    run_id = _start(client, user_a)
    assert client.get(f"/api/training-chart-generator/progress/{run_id}", headers=_h(user_b)).status_code == 404
    assert client.post(f"/api/training-chart-generator/cancel/{run_id}", headers=_h(user_b)).status_code == 404
    assert client.post(f"/api/runs/{run_id}/cancel", headers=_h(user_b)).status_code == 404
    assert _row(run_id).status == "queued"


def test_cancelling_a_waiting_run_frees_the_queue_without_starting_it(client, user_a, research):
    first = _start(client, user_a)
    second = _start(client, user_a, symbols="MSFT")
    r = client.post(f"/api/training-chart-generator/cancel/{second}", headers=_h(user_a))
    assert r.status_code == 200
    assert _row(second).status == "cancelled"
    research_worker.run_job(first, runners={"training-chart-generator": _ok_generator})
    research_jobs.pump_queue()
    assert research.runs == [first]


def test_cancelling_a_running_run_stops_the_worker(client, user_a, research, monkeypatch):
    monkeypatch.setattr(research_worker, "_CANCEL_POLL_S", 0.05)
    monkeypatch.setattr(research_worker, "_PROGRESS_POLL_S", 0.05)
    run_id = _start(client, user_a)
    seen = {}

    def long_tool(main, rid, payload):
        # Cancelled on another API instance: only the row changes, this disk does not.
        research_jobs.update_pipeline_run_state(rid, status="cancelled", stage="cancelled", message="Cancelled by user")
        assert not main._progress_phase_is_cancelled(rid)
        deadline = time.time() + 10
        while time.time() < deadline and not main._progress_phase_is_cancelled(rid):
            time.sleep(0.05)
        seen["cancelled"] = main._progress_phase_is_cancelled(rid)
        main.update_run_progress(rid, 0.0, "cancelled", "Cancelled by user", "cancelled")

    assert research_worker.run_job(run_id, runners={"training-chart-generator": long_tool}) == 0
    assert seen["cancelled"] is True  # the worker relayed the cancel to the tool's own check
    assert _row(run_id).status == "cancelled"
    assert _progress(client, user_a, run_id)["phase"] == "cancelled"


def test_tool_crash_fails_the_run_and_releases_the_slot(client, user_a, research):
    first = _start(client, user_a)
    second = _start(client, user_a, symbols="MSFT")

    def broken(main, rid, payload):
        raise RuntimeError("symbol data unavailable /srv/secret/path")

    assert research_worker.run_job(first, runners={"training-chart-generator": broken}) == 0
    row = _row(first)
    assert row.status == "failed" and "/srv/secret" not in (row.message or "")
    research_jobs.pump_queue()
    assert research.runs == [first, second]


def test_tool_that_returns_without_an_outcome_is_failed(client, user_a, research):
    run_id = _start(client, user_a)
    assert research_worker.run_job(run_id, runners={"training-chart-generator": lambda *a: None}) == 0
    assert _row(run_id).status == "failed"


def test_dead_worker_is_failed_after_its_heartbeat_goes_stale(client, user_a, research, monkeypatch):
    monkeypatch.setattr(app_config, "RESEARCH_JOB_STALE_SECONDS", 30)
    first = _start(client, user_a)
    second = _start(client, user_a, symbols="MSFT")
    research_jobs.claim(first, "job/dead/0/0")
    _set_old_heartbeat(first, 60)
    _progress(client, user_a, first)
    assert _row(first).status == "running"  # execution still reported alive: keep waiting

    research_jobs._last_execution_check.clear()
    research.ended[f"exec-{first}"] = True
    view = _progress(client, user_a, first)
    assert view["phase"] == "error" and "stopped without reporting" in view["error_message"]
    assert research.cancelled == [f"exec-{first}"]  # leftover processes of the dead worker are stopped
    assert research.runs == [first, second]


def test_retry_attempt_takes_over_only_its_own_task(client, user_a, research):
    run_id = _start(client, user_a)
    assert research_jobs.claim(run_id, "job/exec-1/0/0") is not None
    assert research_jobs.claim(run_id, "job/exec-2/0/0", retry_of="job/exec-2/0/") is None
    job = research_jobs.claim(run_id, "job/exec-1/0/1", retry_of="job/exec-1/0/")
    assert job is not None and job["attempts"] == 2


def test_daily_run_limit(client, user_a, research, monkeypatch):
    monkeypatch.setattr(app_config, "RESEARCH_MAX_RUNS_PER_DAY", 2)
    monkeypatch.setattr(app_config, "RESEARCH_MAX_QUEUED_JOBS_PER_USER", 5)
    _start(client, user_a)
    _start(client, user_a, symbols="MSFT")
    r = client.post("/api/training-chart-generator/run", json={**GEN, "symbols": "NVDA"}, headers=_h(user_a))
    assert r.status_code == 429 and r.json()["detail"]["code"] == "daily_limit"


def test_free_beta_size_limits_refuse_before_registering(client, user_a, research, monkeypatch):
    monkeypatch.setattr(app_config, "FREE_BETA", True)
    monkeypatch.setattr(app_config, "BETA_MAX_SYMBOLS", 2)
    r = client.post("/api/training-chart-generator/run", json={**GEN, "symbols": "AAPL,MSFT,NVDA"}, headers=_h(user_a))
    assert r.status_code == 422 and r.json()["detail"]["code"] == "beta_limit"
    r = client.post(
        "/api/labeling-optimizer/run", json={"symbol": "MSFT", "start": "1990-01-01", "end": "2024-06-01"}, headers=_h(user_a)
    )
    assert r.status_code == 422 and r.json()["detail"]["code"] == "beta_limit"
    db = SessionLocal()
    try:
        assert db.query(PipelineRun).filter(PipelineRun.user_id == user_a).count() == 0
    finally:
        db.close()
    beta = client.get("/api/plans").json().get("beta") or {}
    assert beta.get("free_beta") is True and beta["max_symbols"] == 2


def test_testdata_status_comes_from_the_row(client, user_a, research):
    body = {"symbols": "AAPL", "dataset_name": "t1", "period_length_units": 5, "img_dim": 64}
    r = client.post("/runs/testdata/start", json=body, headers=_h(user_a))
    assert r.status_code == 200, r.text
    run_id = r.json()["run_id"]
    research_jobs.claim(run_id, "job/t/0/0")
    research_jobs.report(run_id, {"phase": "generating", "percent": 30.0, "elapsed_s": 1})
    s = client.get(f"/runs/testdata/{run_id}/status", headers=_h(user_a)).json()
    assert s["status"] == "running" and s["progress"] == pytest.approx(0.3) and s["stage"] == "generating"


def test_inprocess_mode_is_unchanged(client, user_a, research, monkeypatch):
    monkeypatch.setattr(app_config, "RESEARCH_EXECUTION", "inprocess")
    import app.main as main

    calls = []
    monkeypatch.setattr(main, "run_training_chart_generator", lambda cfg, rid: calls.append(rid))
    run_id = _start(client, user_a)
    assert calls == [run_id] and research.runs == []
    assert research_jobs.load_row(run_id) is None


def test_foreign_host_orphans_are_interrupted_only_when_long_quiet():
    from app.ownership import reconcile_orphaned_pipeline_runs, record_pipeline_run
    from tests.conftest import _profiled

    uid = _profiled(uuid.uuid4())
    fresh, old, job = (f"orph-{uuid.uuid4().hex[:8]}" for _ in range(3))
    for rid in (fresh, old, job):
        record_pipeline_run(rid, str(uid), "backtester", status="running")
    db = SessionLocal()
    try:
        long_ago = datetime.now(timezone.utc) - timedelta(hours=4)
        db.query(PipelineRun).filter(PipelineRun.id == fresh).update({PipelineRun.worker_id: "gone-host:12"})
        db.query(PipelineRun).filter(PipelineRun.id == old).update(
            {PipelineRun.worker_id: "gone-host:13", PipelineRun.updated_at: long_ago}
        )
        db.query(PipelineRun).filter(PipelineRun.id == job).update(
            {PipelineRun.worker_id: "job/exec/0/0", PipelineRun.updated_at: long_ago}
        )
        db.commit()
    finally:
        db.close()
    reconcile_orphaned_pipeline_runs()
    assert _row(fresh).status == "running"
    assert _row(old).status == "interrupted"
    assert _row(job).status == "running"
