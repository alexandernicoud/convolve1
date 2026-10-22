"""Durable pipeline_runs lifecycle. Does not start training."""

from __future__ import annotations

import shutil
import socket
import time
import uuid

from app.main import GlobalRun, all_runs, update_run_progress
from app.models import PipelineRun
from app.ownership import (
    fetch_pipeline_run_state,
    reconcile_orphaned_pipeline_runs,
    record_pipeline_run,
    update_pipeline_run_state,
)
from app.paths import run_dir_for


def _write_trainer_finals(run_id: str, user_id: uuid.UUID) -> None:
    """Succeeded trainer runs now require a model file and summary.json."""
    run_dir = run_dir_for(run_id, str(user_id))
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "model.keras").write_bytes(b"keras")
    (run_dir / "summary.json").write_text('{"final_metrics": {"val_accuracy": 1}}', encoding="utf-8")


def _remember(run_id: str, user_id: uuid.UUID, tool: str = "trainer") -> None:
    now = time.time()
    all_runs[run_id] = GlobalRun(
        id=run_id,
        tool=tool,
        status="running",
        progress=0.0,
        stage="starting",
        message="",
        created_at=now,
        updated_at=now,
        user_id=str(user_id),
    )


def _forget(run_id: str, user_id: uuid.UUID) -> None:
    """Drop memory and the manifest this test just wrote, so the next read is the database."""
    all_runs.pop(run_id, None)
    path = run_dir_for(run_id, str(user_id))
    if path.is_dir() and path.name == run_id:
        shutil.rmtree(path)


def _headers(client, user_id: uuid.UUID) -> dict:
    from tests.conftest import mint_token

    token = mint_token(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    client.get("/api/me", headers=headers)
    return headers


def test_progress_completion_and_restart_listing(client, user_a, user_b):
    headers_a = _headers(client, user_a)
    headers_b = _headers(client, user_b)
    run_id = "persist_ok_1"
    record_pipeline_run(run_id, str(user_a), "trainer", status="running", stage="starting")
    _remember(run_id, user_a)
    update_run_progress(run_id, 0.42, "epoch-2", "training")
    _forget(run_id, user_a)

    active = client.get("/runs/active", headers=headers_a)
    assert any(r["id"] == run_id and r["status"] == "running" for r in active.json()["runs"])

    listed = client.get("/runs", headers=headers_a)
    assert listed.status_code == 200
    match = next(r for r in listed.json()["runs"] if r["id"] == run_id)
    assert match["status"] == "running"
    assert round(match["progress"], 2) == 0.42
    assert match["stage"] == "epoch-2"

    hidden = client.get("/runs", headers=headers_b)
    assert all(r["id"] != run_id for r in hidden.json()["runs"])
    assert client.get(f"/runs/{run_id}", headers=headers_b).status_code == 404

    _remember(run_id, user_a)
    _write_trainer_finals(run_id, user_a)
    update_run_progress(run_id, 1.0, "done", "Completed", "succeeded")
    _forget(run_id, user_a)
    detail = client.get(f"/runs/{run_id}", headers=headers_a)
    assert detail.status_code == 200
    body = detail.json()
    assert body["status"] == "succeeded"
    assert body["progress"] == 1.0
    active_after = client.get("/runs/active", headers=headers_a)
    assert all(r["id"] != run_id for r in active_after.json()["runs"])

    assert update_pipeline_run_state(run_id, status="running", progress=0.1) is False
    assert fetch_pipeline_run_state(run_id)["status"] == "succeeded"


def test_failure_and_cancel_persist(client, user_a):
    headers = _headers(client, user_a)
    failed_id = "persist_fail_1"
    record_pipeline_run(failed_id, str(user_a), "trainer", status="running")
    _remember(failed_id, user_a)
    update_run_progress(failed_id, 0.2, "error", "loss exploded", "failed")
    _forget(failed_id, user_a)
    failed = client.get(f"/runs/{failed_id}", headers=headers)
    assert failed.status_code == 200
    assert failed.json()["status"] == "failed"
    assert "loss exploded" in (failed.json()["message"] or "")
    state = fetch_pipeline_run_state(failed_id)
    assert state["error_summary"]
    assert state["finished_at"]

    cancel_id = "persist_cancel_1"
    record_pipeline_run(cancel_id, str(user_a), "training-chart-generator", status="running")
    all_runs.pop(cancel_id, None)
    cancelled = client.post(f"/api/runs/{cancel_id}/cancel", headers=headers)
    assert cancelled.status_code == 200
    _forget(cancel_id, user_a)
    again = client.get(f"/runs/{cancel_id}", headers=headers)
    assert again.status_code == 200
    assert again.json()["status"] == "cancelled"
    assert fetch_pipeline_run_state(cancel_id)["status"] == "cancelled"


def test_reconcile_only_dead_local_workers(client, user_a):
    _headers(client, user_a)
    dead_id = "persist_dead_1"
    live_other_host = "persist_other_host_1"
    record_pipeline_run(
        dead_id,
        str(user_a),
        "trainer",
        status="running",
        worker_id=f"{socket.gethostname()}:99999999",
    )
    record_pipeline_run(
        live_other_host,
        str(user_a),
        "trainer",
        status="running",
        worker_id="some-other-host:123",
    )
    assert reconcile_orphaned_pipeline_runs() >= 1
    assert fetch_pipeline_run_state(dead_id)["status"] == "interrupted"
    assert fetch_pipeline_run_state(live_other_host)["status"] == "running"
    active = client.get("/runs/active", headers=_headers(client, user_a))
    assert all(r["id"] != dead_id for r in active.json()["runs"])
    assert reconcile_orphaned_pipeline_runs() == 0


def test_direct_row_without_worker_is_not_interrupted(client, user_a):
    _headers(client, user_a)
    from app.db import SessionLocal

    run_id = "persist_legacy_running"
    db = SessionLocal()
    try:
        db.add(
            PipelineRun(
                id=run_id,
                user_id=user_a,
                tool="trainer",
                status="running",
                progress=0.0,
                worker_id=None,
            )
        )
        db.commit()
    finally:
        db.close()
    reconcile_orphaned_pipeline_runs()
    assert fetch_pipeline_run_state(run_id)["status"] == "running"
