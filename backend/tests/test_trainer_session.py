"""Trainer 2.0 lifecycle and metric correctness. The runner test trains a tiny model on 32×32 images."""

from __future__ import annotations

import json
import shutil
import threading
import time
import uuid
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from app.main import trainer_runs
from app.ownership import record_pipeline_run, update_pipeline_run_state
from app.paths import run_dir_for
from app.services import review_meta, trainer_session


def _headers(client, user_id: uuid.UUID) -> dict:
    from tests.conftest import mint_token

    headers = {"Authorization": f"Bearer {mint_token(user_id)}"}
    client.get("/api/me", headers=headers)
    return headers


def _epochs(n: int, *, best: int, val: bool = True):
    rows = []
    for e in range(1, n + 1):
        row = {"epoch": e, "epochs": n, "loss": 1.0 / e, "accuracy": 0.5 + e / 1000, "timestamp": 1000.0 + 10 * e}
        if val:
            row["val_loss"] = 0.4 if e == best else 0.6 + e / 1000
            row["val_accuracy"] = 0.55
        rows.append(row)
    return rows


@pytest.fixture
def run_cleanup():
    created = []
    yield created
    for run_id, uid in created:
        trainer_runs.pop(run_id, None)
        path = run_dir_for(run_id, str(uid))
        if path.is_dir() and path.name == run_id:
            shutil.rmtree(path)


# --- pure helpers -------------------------------------------------------------------


def test_normalize_history_keeps_missing_as_null_and_sorts():
    rows = [
        {"epoch": 2, "loss": 0.5, "accuracy": 0.6},
        {"epoch": 1, "loss": 0.7, "accuracy": 0.5, "val_loss": None},
        {"epoch": 2, "loss": 0.4, "accuracy": 0.61},  # later write for the same epoch wins
        {"epoch": 0, "loss": 9},  # epochs are 1-based
        {"epoch": "x"},
    ]
    out = trainer_session.normalize_history(rows)
    assert [r["epoch"] for r in out] == [1, 2]
    assert out[1]["loss"] == 0.4
    assert out[0]["val_loss"] is None and out[0]["val_accuracy"] is None


def test_legacy_zero_validation_is_not_a_measurement_without_val_samples():
    rows = [{"epoch": 1, "loss": 0.7, "accuracy": 0.5, "val_loss": 0, "val_accuracy": 0}]
    assert trainer_session.normalize_history(rows, val_samples=0)[0]["val_loss"] is None
    # With validation samples a recorded value is kept as-is.
    assert trainer_session.normalize_history(rows, val_samples=10)[0]["val_loss"] == 0.0


def test_best_epoch_is_first_minimum_of_val_loss():
    rows = trainer_session.normalize_history(
        [{"epoch": 1, "val_loss": 0.5}, {"epoch": 2, "val_loss": 0.3}, {"epoch": 3, "val_loss": 0.3}]
    )
    assert trainer_session.best_epoch(rows) == 2
    assert trainer_session.best_epoch(trainer_session.normalize_history([{"epoch": 1, "loss": 1}])) is None


def test_epoch_durations_are_measured_differences():
    rows = trainer_session.normalize_history(_epochs(3, best=2))
    assert trainer_session.epoch_durations(rows, 1000.0) == [10.0, 10.0, 10.0]


def test_standard_architecture_shapes_match_trainer_cnn():
    arch = trainer_session.standard_architecture([224, 224])
    shapes = [layer["shape"] for layer in arch["layers"]]
    assert shapes[1] == [222, 222, 32]
    assert shapes[-3] == [26 * 26 * 128]
    assert arch["total_params"] == 896 + 18496 + 73856 + (26 * 26 * 128 * 128 + 128) + 129


def test_review_ignores_v1_heuristic_best_epoch_and_prefers_saved_weights():
    v1 = {"best_epoch": 25, "epochs_trained": 30, "final_metrics": {"val_accuracy": 0.6}}
    assert "best_epoch" not in review_meta.trainer_summary(v1)
    v2 = {
        "summary_version": 2,
        "best_epoch": 4,
        "saved_weights_epoch": 4,
        "saved_weights_metrics": {"val_accuracy": 0.7},
        "final_metrics": {"val_accuracy": 0.6},
    }
    out = review_meta.trainer_summary(v2)
    assert out["best_epoch"] == 4
    assert out["metrics"]["val_accuracy"] == 0.7


def test_training_summary_records_restored_epoch():
    from runners.trainer_runner import build_training_summary

    history = trainer_session.normalize_history(_epochs(9, best=4))
    stop = SimpleNamespace(stopped_epoch=8, restore_best_weights=True, best_weights=[1], best_epoch=3)
    summary = build_training_summary(
        history=history, model_name="m.keras", config={}, train_samples=8, val_samples=2,
        image_size=(16, 16), batch_size=4, epochs_configured=30, early_stop=stop,
    )
    assert summary["best_epoch"] == 4
    assert summary["saved_weights_epoch"] == 4
    assert summary["saved_weights_metrics"]["val_loss"] == 0.4
    assert summary["final_metrics"]["epoch"] == 9
    assert summary["stopped_early"] is True

    no_val = trainer_session.normalize_history(_epochs(3, best=1, val=False))
    stop_none = SimpleNamespace(stopped_epoch=0, restore_best_weights=True, best_weights=None, best_epoch=0)
    summary2 = build_training_summary(
        history=no_val, model_name="m.keras", config={}, train_samples=8, val_samples=0,
        image_size=(16, 16), batch_size=4, epochs_configured=3, early_stop=stop_none,
    )
    assert summary2["best_epoch"] is None
    assert summary2["saved_weights_epoch"] == 3


# --- the real runner on a tiny dataset ------------------------------------------------


def _write_tiny_dataset(folder: Path, n: int = 12) -> None:
    from PIL import Image

    folder.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(0)
    for i in range(n):
        label = i % 2
        arr = (rng.random((32, 32, 3)) * 255).astype("uint8")
        if label:
            arr[:, 16:] = 255
        Image.fromarray(arr).save(folder / f"SYM_2020-01-{i + 1:02d}_to_2020-02-01_label{label}.png")


@pytest.mark.parametrize("val_split", [0.0, 0.25])
def test_runner_records_null_validation_and_true_best_epoch(tmp_path, val_split):
    from runners.trainer_runner import run_trainer

    data = tmp_path / "images"
    _write_tiny_dataset(data)
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    events = []
    config = {
        "use_standard_config": False, "image_height": 32, "image_width": 32, "batch_size": 4,
        "epochs": 3, "val_split": val_split, "random_seed": 3, "folder_name": str(data), "model_name": "tiny.keras",
    }
    run_trainer(config, run_dir, lambda phase, pct, d: events.append((phase, pct, d)))

    history = json.loads((run_dir / "history.json").read_text())
    summary = json.loads((run_dir / "summary.json").read_text())
    jsonl = trainer_session.read_jsonl(str(run_dir / "metrics.jsonl"))
    assert [r["epoch"] for r in history] == list(range(1, len(history) + 1))
    assert len(jsonl) == len(history)
    assert (run_dir / "training_state.json").is_file()
    split = next(d for p, _, d in events if p == "loading" and "train_samples" in d)
    assert split["train_samples"] + split["val_samples"] == 12
    if val_split == 0.0:
        assert all(r["val_loss"] is None and r["val_accuracy"] is None for r in history)
        assert summary["best_epoch"] is None
        assert summary["saved_weights_epoch"] == len(history)
    else:
        assert all(isinstance(r["val_loss"], float) for r in history)
        assert summary["best_epoch"] == trainer_session.best_epoch(trainer_session.normalize_history(history))
        assert summary["saved_weights_epoch"] == summary["best_epoch"]
    assert summary["summary_version"] == 2


def _tiny_config(data: Path, **over):
    return {
        "use_standard_config": False, "image_height": 32, "image_width": 32, "batch_size": 4,
        "epochs": 3, "val_split": 0.25, "random_seed": 3, "folder_name": str(data), "model_name": "tiny.keras", **over,
    }


def test_runner_writes_stage_timings_and_batch_progress(tmp_path):
    from runners.trainer_runner import run_trainer

    data = tmp_path / "images"
    _write_tiny_dataset(data, n=24)
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    events = []
    run_trainer(_tiny_config(data), run_dir, lambda phase, pct, d: events.append((phase, pct, d)))

    timings = json.loads((run_dir / "timings.json").read_text())
    history = json.loads((run_dir / "history.json").read_text())
    for key in ("tf_import_seconds", "scan_seconds", "pipeline_build_seconds", "model_build_seconds",
                "first_batch_seconds", "fit_seconds", "model_save_seconds"):
        assert timings["stages"][key] >= 0, key
    assert [e["epoch"] for e in timings["epochs"]] == [r["epoch"] for r in history]
    assert all(abs(e["seconds"] - e["train_seconds"] - e["val_seconds"]) < 1e-2 for e in timings["epochs"])
    done = next(d for p, _, d in events if p == "done")
    assert done["timings"]["stages"]["fit_seconds"] == timings["stages"]["fit_seconds"]

    batches = [d for p, _, d in events if p == "training" and "batch" in d]
    # The first batch is always reported so the UI moves before the first epoch ends.
    assert batches and batches[0]["batch"] == 1 and batches[0]["epoch_in_progress"] == 1
    assert all("epoch" not in d for d in batches), "batch reports must not add epoch history rows"
    percents = [pct for p, pct, _ in events if p == "training"]
    assert percents == sorted(percents)
    validating = [d for p, _, d in events if p == "training" and d.get("validating")]
    assert [d["epoch_in_progress"] for d in validating] == [r["epoch"] for r in history]
    assert all(d["batch"] == d["batches"] for d in validating)

    block = trainer_session.timings_block(timings, {"queue_to_claim_seconds": 12.0, "dataset_restore_seconds": 0.4, "publish_seconds": 2.0})
    keys = [p["key"] for p in block["phases"]]
    assert keys[:2] == ["waiting_for_machine", "dataset_download"] and keys[-1] == "upload"
    assert {"training", "validation", "first_batch", "model_save"} <= set(keys)
    fit_parts = sum(p["seconds"] for p in block["phases"] if p["key"] in ("first_batch", "training", "validation"))
    assert abs(fit_parts - timings["stages"]["fit_seconds"]) < 0.05


def test_runner_cancel_stops_within_the_epoch(tmp_path):
    from runners.trainer_runner import CancelledError, run_trainer

    data = tmp_path / "images"
    _write_tiny_dataset(data, n=24)
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    cancel = threading.Event()
    events = []

    def progress(phase, pct, d):
        events.append((phase, d))
        if phase == "training" and d.get("batch") == 1:
            cancel.set()

    with pytest.raises(CancelledError):
        run_trainer(_tiny_config(data, batch_size=2, epochs=5), run_dir, progress, cancel_event=cancel)
    # 18 training images at batch 2 is 9 steps; cancellation must not wait for the epoch to end.
    assert not any("epoch" in d for _, d in events)
    assert trainer_session.read_jsonl(str(run_dir / "metrics.jsonl")) == []
    assert (run_dir / "timings.json").is_file()


def test_timings_block_is_absent_without_measurements():
    assert trainer_session.timings_block(None, None) is None
    assert trainer_session.timings_block({"stages": {}}, {}) is None
    only_worker = trainer_session.timings_block(None, {"queue_to_claim_seconds": 9.5})
    assert only_worker["phases"] == [{"key": "waiting_for_machine", "seconds": 9.5}]


# --- API: session view and lifecycle ---------------------------------------------------


def test_session_full_history_after_restart(client, user_a, run_cleanup):
    run_id = f"20260101_000000_{uuid.uuid4().hex[:6]}"
    run_cleanup.append((run_id, user_a))
    record_pipeline_run(run_id, str(user_a), "trainer", status="running")
    run_dir = run_dir_for(run_id, str(user_a))
    run_dir.mkdir(parents=True, exist_ok=True)
    history = _epochs(27, best=21)
    (run_dir / "history.json").write_text(json.dumps(history))
    (run_dir / "summary.json").write_text(json.dumps({"val_samples": 20, "train_samples": 80, "epochs_trained": 27}))
    (run_dir / "model.keras").write_bytes(b"k")
    (run_dir / "model_metadata.json").write_text(json.dumps({"model_name": "demo.keras", "symbols": ["AAPL"], "timeframe": "1d"}))
    update_pipeline_run_state(run_id, status="succeeded", progress=1.0, stage="completed", message="done")

    body = client.get(f"/trainer/runs/{run_id}", headers=_headers(client, user_a)).json()
    assert body["status"] == "done"
    session = body["session"]
    assert len(session["history"]) == 27  # no 20-epoch truncation
    assert session["best_epoch"] == 21
    assert session["stage"] == "completed"
    assert session["model_name"] == "demo.keras"
    assert session["dataset"]["market"]["symbols"] == ["AAPL"]
    # v1 summary: saved weights inferred from history (Keras 3 restores best weights).
    assert session["summary"]["saved_weights_epoch"] == 21
    assert session["summary"]["saved_weights_inferred"] is True


def test_session_restores_running_history_from_metrics_jsonl(client, user_a, run_cleanup):
    run_id = f"20260101_000001_{uuid.uuid4().hex[:6]}"
    run_cleanup.append((run_id, user_a))
    record_pipeline_run(run_id, str(user_a), "trainer", status="running", stage="training")
    run_dir = run_dir_for(run_id, str(user_a))
    run_dir.mkdir(parents=True, exist_ok=True)
    lines = "\n".join(json.dumps(r) for r in _epochs(4, best=3)) + "\n{\"epoch\": 5, \"lo"  # partial last line
    (run_dir / "metrics.jsonl").write_text(lines)
    (run_dir / "training_state.json").write_text(json.dumps({"train_samples": 40, "val_samples": 10, "data_ready_at": 1000.0}))

    body = client.get(f"/trainer/runs/{run_id}", headers=_headers(client, user_a)).json()
    assert body["status"] == "running"
    assert [r["epoch"] for r in body["session"]["history"]] == [1, 2, 3, 4]
    assert body["session"]["train_samples"] == 40
    assert body["session"]["mean_epoch_seconds"] == 10.0


def test_running_session_shows_the_options_from_its_config(tmp_path):
    cfg = {"trainer_protocol": 2, "image_height": 64, "image_width": 64, "selection_metric": "val_auc",
           "lr_schedule": {"name": "cosine", "alpha": 0}, "optimizer": None, "purge_chart_windows": None}
    (tmp_path / "model_metadata.json").write_text(json.dumps({"training_config": cfg}))
    s = trainer_session.build_session("r", str(tmp_path), status="running", progress={"phase": "training"})
    assert s["options"]["lr_schedule"]["name"] == "cosine"
    assert s["options"]["optimizer"]["name"] == "adam" and s["options"]["purge_chart_windows"] is True
    assert s["selection_metric"] == {"name": "val_auc", "mode": "max"}

    legacy = tmp_path / "legacy"
    legacy.mkdir()
    (legacy / "model_metadata.json").write_text(json.dumps({"training_config": {"image_height": 64, "image_width": 64}}))
    assert trainer_session.build_session("r", str(legacy), status="running", progress={})["options"] is None


def test_session_live_in_process_run_has_full_history(client, user_a, run_cleanup):
    run_id = f"20260101_000002_{uuid.uuid4().hex[:6]}"
    run_cleanup.append((run_id, user_a))
    record_pipeline_run(run_id, str(user_a), "trainer", status="running", stage="training")
    run_dir = run_dir_for(run_id, str(user_a))
    run_dir.mkdir(parents=True, exist_ok=True)
    full = _epochs(25, best=12)
    trainer_runs[run_id] = {
        "status": "running",
        "progress": {"phase": "training", "percent": 80, "epoch": 25, "epochs": 30},
        "last_metrics": full[-1],
        "history_preview": full[-20:],
        "artifact_paths": [],
        "run_dir": run_dir,
        "cancel_event": threading.Event(),
        "history": full,
        "training_state": {"train_samples": 80, "val_samples": 20},
        "worker_active": True,
    }
    body = client.get(f"/trainer/runs/{run_id}", headers=_headers(client, user_a)).json()
    assert len(body["history_preview"]) == 20
    assert len(body["session"]["history"]) == 25
    assert body["session"]["stage"] == "training"
    assert body["session"]["epochs_total"] == 25 or body["session"]["epochs_total"] == 30
    assert body["session"]["worker_active"] is True


def test_interrupted_run_reports_failure_reason(client, user_a, run_cleanup):
    run_id = f"20260101_000003_{uuid.uuid4().hex[:6]}"
    run_cleanup.append((run_id, user_a))
    record_pipeline_run(run_id, str(user_a), "trainer", status="running")
    run_dir_for(run_id, str(user_a)).mkdir(parents=True, exist_ok=True)
    update_pipeline_run_state(run_id, status="interrupted", progress=0.0, stage="error", message="worker gone")
    body = client.get(f"/trainer/runs/{run_id}", headers=_headers(client, user_a)).json()
    assert body["status"] == "failed"
    assert body["session"]["stage"] == "failed"
    assert "restarted" in body["session"]["error"]


def test_cancelled_run_is_terminal(client, user_a, run_cleanup):
    run_id = f"20260101_000004_{uuid.uuid4().hex[:6]}"
    run_cleanup.append((run_id, user_a))
    record_pipeline_run(run_id, str(user_a), "trainer", status="running")
    run_dir_for(run_id, str(user_a)).mkdir(parents=True, exist_ok=True)
    update_pipeline_run_state(run_id, status="cancelled", progress=0.0, stage="cancelled", message="Training cancelled")
    body = client.get(f"/trainer/runs/{run_id}", headers=_headers(client, user_a)).json()
    assert body["status"] == "cancelled"
    assert body["session"]["stage"] == "cancelled"


def test_session_is_owner_only_and_unknown_is_404(client, user_a, user_b, run_cleanup):
    run_id = f"20260101_000005_{uuid.uuid4().hex[:6]}"
    run_cleanup.append((run_id, user_a))
    record_pipeline_run(run_id, str(user_a), "trainer", status="running")
    assert client.get(f"/trainer/runs/{run_id}", headers=_headers(client, user_b)).status_code == 404
    missing = f"20260101_000006_{uuid.uuid4().hex[:6]}"
    assert client.get(f"/trainer/runs/{missing}", headers=_headers(client, user_a)).status_code == 404


def test_history_endpoint_follows_analysis_source_run(client, user_a, run_cleanup):
    trainer_id = f"20260101_000007_{uuid.uuid4().hex[:6]}"
    analysis_run = f"20260101_000008_{uuid.uuid4().hex[:6]}"
    run_cleanup.extend([(trainer_id, user_a), (analysis_run, user_a)])
    record_pipeline_run(trainer_id, str(user_a), "trainer", status="running")
    record_pipeline_run(analysis_run, str(user_a), "analysis", status="running")
    tdir = run_dir_for(trainer_id, str(user_a))
    tdir.mkdir(parents=True, exist_ok=True)
    (tdir / "history.json").write_text(json.dumps(_epochs(3, best=2)))
    adir = run_dir_for(analysis_run, str(user_a))
    adir.mkdir(parents=True, exist_ok=True)
    (adir / "analysis_context.json").write_text(json.dumps({"source_trainer_run_id": trainer_id}))
    rows = client.get(f"/trainer/runs/{analysis_run}/history", headers=_headers(client, user_a)).json()
    assert [r["epoch"] for r in rows] == [1, 2, 3]
