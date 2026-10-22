"""CNN training through a Cloud Run Job: dispatch, worker lifecycle, ownership, storage."""

from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

from app.db import SessionLocal
from app.jobs import train_worker
from app.main import trainer_runs
from app.models import PipelineRun
from app.ownership import record_user_dataset
from app.paths import dataset_dir_for, run_dir_for
from app.services import trainer_jobs
from app.services.durable_outputs import LocalCopyStore, publish_dataset_dir, set_artifact_store

BACKEND = Path(__file__).resolve().parent.parent


class FakeDispatcher:
    def __init__(self) -> None:
        self.runs: List[str] = []
        self.cancelled: List[str] = []
        self.ended: Optional[bool] = None
        self.fail = False

    def run(self, run_id: str) -> str:
        if self.fail:
            raise RuntimeError("quota exceeded")
        self.runs.append(run_id)
        return f"projects/p/locations/europe-west6/jobs/convolve-trainer/executions/exec-{len(self.runs)}"

    def cancel(self, execution: str) -> None:
        self.cancelled.append(execution)

    def finished(self, execution: str) -> Optional[bool]:
        return self.ended


class FakeTrainer:
    """Same signature and file outputs as runners.trainer_runner.run_trainer."""

    def __init__(self, on_epoch=None, error: Optional[Exception] = None) -> None:
        self.calls: List[Dict[str, Any]] = []
        self.on_epoch = on_epoch
        self.error = error

    def __call__(self, config, run_dir, progress_cb, cancel_event=None):
        from runners.trainer_runner import CancelledError

        self.calls.append(dict(config))
        progress_cb("loading", 5, {"message": "Scanning dataset folder..."})
        if self.error:
            raise self.error
        history = []
        for epoch in (1, 2):
            if self.on_epoch:
                self.on_epoch(epoch)
            if cancel_event is not None and cancel_event.is_set():
                raise CancelledError("Training cancelled by user")
            row = {"epoch": epoch, "epochs": 2, "loss": 0.7 - epoch / 10, "accuracy": 0.5,
                   "val_loss": 0.6, "val_accuracy": 0.55 + epoch / 100}
            history.append(row)
            progress_cb("training", 25 + epoch * 35, {"message": f"Epoch {epoch}/2", **row})
        run_dir = Path(run_dir)
        (run_dir / config["model_name"]).write_bytes(f"weights-{run_dir.name}".encode())
        (run_dir / "history.json").write_text(json.dumps(history), encoding="utf-8")
        (run_dir / "summary.json").write_text(json.dumps({"config": config}), encoding="utf-8")
        progress_cb("done", 100, {"message": "Training completed successfully!"})


@pytest.fixture
def store(tmp_path: Path):
    copy = LocalCopyStore(tmp_path / "durable")
    set_artifact_store(copy)
    yield copy
    set_artifact_store(None)


@pytest.fixture
def dispatcher(monkeypatch):
    fake = FakeDispatcher()
    trainer_jobs.set_dispatcher(fake)
    monkeypatch.setattr(trainer_jobs, "TRAINER_EXECUTION", "cloud_run_job")
    yield fake
    trainer_jobs.set_dispatcher(None)


@pytest.fixture
def cleanup():
    paths: List[Path] = []
    yield paths
    for path in paths:
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)


def _headers(client, user_id: uuid.UUID) -> dict:
    from tests.conftest import mint_token

    headers = {"Authorization": f"Bearer {mint_token(user_id)}"}
    client.get("/api/me", headers=headers)
    return headers


def _dataset(user_id: uuid.UUID, cleanup: List[Path], *, n: int = 8, size: int = 32, publish: bool = True) -> str:
    from PIL import Image

    dataset_id = f"dset_job_{uuid.uuid4().hex[:8]}"
    root = dataset_dir_for(dataset_id, str(user_id))
    images = root / "images"
    images.mkdir(parents=True, exist_ok=True)
    for i in range(n):
        Image.new("RGB", (size, size), (i * 20 % 255, 80, 160)).save(images / f"c{i:02d}_label{i % 2}.png")
    (root / "summary.json").write_text(
        json.dumps({"dataset_id": dataset_id, "total_images": n, "created_at": 1}), encoding="utf-8"
    )
    record_user_dataset(dataset_id, str(user_id), source="uploaded", kind="training", path=str(root))
    if publish:
        ok, err = publish_dataset_dir(dataset_id, str(user_id), root)
        assert ok, err
    cleanup.append(root)
    return dataset_id


def _request(dataset_id: str, model_name: str = "model.keras") -> Dict[str, Any]:
    return {
        "dataset_id": dataset_id,
        "model_name": model_name,
        "use_standard_config": False,
        "image_height": 32,
        "image_width": 32,
        "batch_size": 4,
        "epochs": 1,
        "val_split": 0.25,
        "random_seed": 7,
    }


def _row(run_id: str) -> PipelineRun:
    db = SessionLocal()
    try:
        row = db.get(PipelineRun, run_id)
        db.expunge(row)
        return row
    finally:
        db.close()


def _start(client, headers, dataset_id, cleanup, user_id, **kw) -> str:
    resp = client.post("/trainer/runs", json=_request(dataset_id, **kw), headers=headers)
    assert resp.status_code == 200, resp.text
    run_id = resp.json()["run_id"]
    cleanup.append(run_dir_for(run_id, str(user_id)))
    return run_id


def test_dispatch_queues_run_and_passes_only_the_run_id(client, user_a, user_b, store, dispatcher, cleanup):
    headers_a = _headers(client, user_a)
    headers_b = _headers(client, user_b)
    dataset_id = _dataset(user_a, cleanup)

    run_id = _start(client, headers_a, dataset_id, cleanup, user_a)

    assert dispatcher.runs == [run_id]
    assert run_id not in trainer_runs
    row = _row(run_id)
    assert row.status == "queued"
    assert row.worker_id == "job/pending"
    job = json.loads(row.extra_json)["trainer_job"]
    assert job["dataset_id"] == dataset_id
    assert job["execution"].endswith("/executions/exec-1")
    for key, value in _request(dataset_id).items():
        assert job["config"][key] == value
    assert job["metadata"]["training_run_id"] == run_id

    progress = client.get(f"/trainer/runs/{run_id}", headers=headers_a)
    assert progress.status_code == 200
    assert progress.json()["status"] == "running"
    assert progress.json()["progress"]["phase"] == "queued"
    assert client.get(f"/trainer/runs/{run_id}", headers=headers_b).status_code == 404
    assert client.post(f"/trainer/runs/{run_id}/cancel", headers=headers_b).status_code == 404
    assert _row(run_id).status == "queued"


def test_dispatch_failure_marks_run_failed(client, user_a, store, dispatcher, cleanup):
    headers = _headers(client, user_a)
    dataset_id = _dataset(user_a, cleanup)
    dispatcher.fail = True

    resp = client.post("/trainer/runs", json=_request(dataset_id), headers=headers)

    assert resp.status_code == 503
    assert "quota exceeded" in resp.json()["detail"]
    db = SessionLocal()
    try:
        rows = db.query(PipelineRun).filter(PipelineRun.user_id == user_a, PipelineRun.tool == "trainer").all()
        assert len(rows) == 1 and rows[0].status == "failed"
        assert "Could not start training job" in rows[0].error_summary
        cleanup.append(run_dir_for(rows[0].id, str(user_a)))
    finally:
        db.close()


def test_job_mode_requires_dataset_id(client, user_a, dispatcher):
    headers = _headers(client, user_a)
    resp = client.post("/trainer/runs", json={"folder_name": "/tmp/x", "model_name": "m.keras"}, headers=headers)
    assert resp.status_code == 400
    assert dispatcher.runs == []


def test_unstored_dataset_is_published_before_dispatch(client, user_a, store, dispatcher, cleanup):
    headers = _headers(client, user_a)
    dataset_id = _dataset(user_a, cleanup, publish=False)
    assert trainer_jobs.dataset_is_stored(dataset_id, str(user_a))[0] is False

    _start(client, headers, dataset_id, cleanup, user_a)

    assert trainer_jobs.dataset_is_stored(dataset_id, str(user_a)) == (True, "")
    assert any(store.root.rglob(f"datasets/{dataset_id}/dataset.zip"))


def test_worker_success_stores_model_before_succeeded(client, user_a, user_b, store, dispatcher, cleanup):
    headers_a = _headers(client, user_a)
    headers_b = _headers(client, user_b)
    dataset_id = _dataset(user_a, cleanup)
    run_id = _start(client, headers_a, dataset_id, cleanup, user_a)
    # The API has already looked at the run dir; a later publish by the job must still restore.
    client.get(f"/trainer/runs/{run_id}/download/model", headers=headers_a)
    from app.services.durable_outputs import _MANIFEST_CACHE

    # In production the job publishes from another process, so nothing here would clear a cached miss.
    assert run_id not in _MANIFEST_CACHE
    trainer = FakeTrainer()

    assert train_worker.run_job(run_id, trainer=trainer) == 0

    row = _row(run_id)
    assert row.status == "succeeded" and row.worker_id.startswith("job/")
    durable = json.loads(row.extra_json)["durable"]
    assert {item["rel"] for item in durable["files"]} >= {"model.keras", "summary.json", "history.json", "model_metadata.json"}
    received = trainer.calls[0]
    expected = dict(_request(dataset_id))
    for key, value in expected.items():
        assert received[key] == value
    assert received["folder_name"] == str(dataset_dir_for(dataset_id, str(user_a)) / "images")

    view = client.get(f"/trainer/runs/{run_id}", headers=headers_a).json()
    assert view["status"] == "done"
    assert view["last_metrics"]["epoch"] == 2
    assert len(view["history_preview"]) == 2

    shutil.rmtree(run_dir_for(run_id, str(user_a)))
    downloaded = client.get(f"/trainer/runs/{run_id}/download/model", headers=headers_a)
    assert downloaded.status_code == 200
    assert downloaded.content == f"weights-{run_id}".encode()
    assert client.get(f"/trainer/runs/{run_id}/download/model", headers=headers_b).status_code == 404
    assert any(m["model_id"] == run_id for m in client.get("/api/models", headers=headers_a).json()["models"])
    assert not any(m["model_id"] == run_id for m in client.get("/api/models", headers=headers_b).json()["models"])
    detail = client.get(f"/runs/{run_id}", headers=headers_a)
    assert detail.status_code == 200 and detail.json()["status"] == "succeeded"
    assert client.get(f"/runs/{run_id}", headers=headers_b).status_code == 404

    # A duplicate execution for the same run does nothing.
    assert train_worker.run_job(run_id, trainer=trainer) == 0
    assert len(trainer.calls) == 1


def test_storage_failure_is_failed_not_succeeded(client, user_a, store, dispatcher, cleanup):
    headers = _headers(client, user_a)
    dataset_id = _dataset(user_a, cleanup)
    run_id = _start(client, headers, dataset_id, cleanup, user_a)

    class FailingStore(LocalCopyStore):
        def put_file(self, key: str, src: Path) -> str:
            raise OSError("bucket unavailable")

    set_artifact_store(FailingStore(store.root))
    assert train_worker.run_job(run_id, trainer=FakeTrainer()) == 1

    row = _row(run_id)
    assert row.status == "failed"
    assert "could not be stored" in row.error_summary.lower()
    assert not any(store.root.rglob("model.keras"))
    assert client.get(f"/trainer/runs/{run_id}", headers=headers).json()["status"] == "failed"


def test_cancel_during_training_stops_job_and_stays_cancelled(client, user_a, store, dispatcher, cleanup):
    headers = _headers(client, user_a)
    dataset_id = _dataset(user_a, cleanup)
    run_id = _start(client, headers, dataset_id, cleanup, user_a)

    def cancel_on_first_epoch(epoch: int) -> None:
        if epoch == 1:
            assert client.post(f"/trainer/runs/{run_id}/cancel", headers=headers).status_code == 200

    assert train_worker.run_job(run_id, trainer=FakeTrainer(on_epoch=cancel_on_first_epoch)) == 0

    assert _row(run_id).status == "cancelled"
    assert dispatcher.cancelled == ["projects/p/locations/europe-west6/jobs/convolve-trainer/executions/exec-1"]
    assert not any(store.root.rglob("model.keras"))
    assert client.get(f"/trainer/runs/{run_id}", headers=headers).json()["status"] == "cancelled"


def test_cancel_before_the_job_starts(client, user_a, store, dispatcher, cleanup):
    headers = _headers(client, user_a)
    dataset_id = _dataset(user_a, cleanup)
    run_id = _start(client, headers, dataset_id, cleanup, user_a)
    assert client.post(f"/trainer/runs/{run_id}/cancel", headers=headers).status_code == 200
    trainer = FakeTrainer()

    assert train_worker.run_job(run_id, trainer=trainer) == 0

    assert trainer.calls == []
    assert _row(run_id).status == "cancelled"


def test_trainer_error_is_a_clear_terminal_failure(client, user_a, store, dispatcher, cleanup):
    headers = _headers(client, user_a)
    dataset_id = _dataset(user_a, cleanup)
    run_id = _start(client, headers, dataset_id, cleanup, user_a)

    assert train_worker.run_job(run_id, trainer=FakeTrainer(error=ValueError("no labeled PNGs"))) == 1

    row = _row(run_id)
    assert row.status == "failed"
    assert "no labeled PNGs" in row.error_summary
    view = client.get(f"/trainer/runs/{run_id}", headers=headers).json()
    assert view["status"] == "failed" and "no labeled PNGs" in view["progress"]["message"]


def test_concurrent_runs_keep_separate_files(client, user_a, store, dispatcher, cleanup):
    headers = _headers(client, user_a)
    dataset_id = _dataset(user_a, cleanup)
    first = _start(client, headers, dataset_id, cleanup, user_a)
    second = _start(client, headers, dataset_id, cleanup, user_a)

    assert train_worker.run_job(first, trainer=FakeTrainer()) == 0
    assert train_worker.run_job(second, trainer=FakeTrainer()) == 0

    keys = {}
    for run_id in (first, second):
        files = json.loads(_row(run_id).extra_json)["durable"]["files"]
        keys[run_id] = next(item["key"] for item in files if item["rel"] == "model.keras")
        assert f"/runs/{run_id}/" in keys[run_id]
        assert (store.root / keys[run_id]).read_bytes() == f"weights-{run_id}".encode()
    assert keys[first] != keys[second]
    assert run_dir_for(first, str(user_a)) != run_dir_for(second, str(user_a))


def test_quiet_job_is_failed_once_its_execution_has_ended(client, user_a, store, dispatcher, cleanup):
    headers = _headers(client, user_a)
    dataset_id = _dataset(user_a, cleanup)
    run_id = _start(client, headers, dataset_id, cleanup, user_a)
    db = SessionLocal()
    try:
        db.query(PipelineRun).filter(PipelineRun.id == run_id).update(
            {PipelineRun.status: "running", PipelineRun.updated_at: datetime.now(timezone.utc) - timedelta(hours=1)},
            synchronize_session=False,
        )
        db.commit()
    finally:
        db.close()

    dispatcher.ended = False
    assert client.get(f"/trainer/runs/{run_id}", headers=headers).json()["status"] == "running"
    trainer_jobs._last_execution_check.pop(run_id, None)
    dispatcher.ended = True
    view = client.get(f"/trainer/runs/{run_id}", headers=headers).json()
    assert view["status"] == "failed"
    assert "ended without reporting" in view["progress"]["message"]


def test_long_job_is_not_marked_stale_from_api_disk(client, user_a, store, dispatcher, cleanup):
    headers = _headers(client, user_a)
    dataset_id = _dataset(user_a, cleanup)
    run_id = _start(client, headers, dataset_id, cleanup, user_a)
    assert trainer_jobs.claim(run_id, "job/exec-1/0") is not None
    manifest = run_dir_for(run_id, str(user_a)) / "run_manifest.json"
    data = json.loads(manifest.read_text())
    data["updated_at"] = data["created_at"] = data["updated_at"] - 7200
    manifest.write_text(json.dumps(data))

    detail = client.get(f"/runs/{run_id}", headers=headers)

    assert detail.status_code == 200
    assert detail.json()["status"] == "running"


def test_job_spec_resources_and_threads():
    yaml = pytest.importorskip("yaml")
    spec = yaml.safe_load((BACKEND / "deploy" / "trainer-job.yaml").read_text(encoding="utf-8"))
    task = spec["spec"]["template"]["spec"]["template"]["spec"]
    container = task["containers"][0]
    env = {item["name"]: item for item in container["env"]}

    assert container["command"] == ["python", "-m", "app.jobs.train_worker"]
    assert container["resources"]["limits"] == {"cpu": "8", "memory": "8Gi"}
    assert task["maxRetries"] == 0
    assert 1800 <= int(task["timeoutSeconds"]) <= 3600
    for name in ("TRAINER_THREADS", "OMP_NUM_THREADS", "TF_NUM_INTRAOP_THREADS", "TF_NUM_INTEROP_THREADS"):
        assert env[name]["value"] == "8"
    assert env["APP_PROFILE"]["value"] == "cloud"
    assert "value" not in env["DATABASE_URL"] and "secretKeyRef" in env["DATABASE_URL"]["valueFrom"]


def test_worker_sets_thread_env_before_tensorflow(monkeypatch):
    for name in ("OMP_NUM_THREADS", "TF_NUM_INTRAOP_THREADS", "TF_NUM_INTEROP_THREADS"):
        monkeypatch.delenv(name, raising=False)
    values = train_worker.configure_threads(8)
    assert values == {"OMP_NUM_THREADS": "8", "TF_NUM_INTRAOP_THREADS": "8", "TF_NUM_INTEROP_THREADS": "8"}


def test_worker_access_check_local():
    assert train_worker.check_access() == 0


def test_worker_rejects_unknown_run():
    assert train_worker.run_job("no_such_run_123") == 0


def test_real_trainer_in_job_keeps_architecture_and_settings(client, user_a, store, dispatcher, cleanup):
    headers = _headers(client, user_a)
    dataset_id = _dataset(user_a, cleanup)
    run_id = _start(client, headers, dataset_id, cleanup, user_a)

    assert train_worker.run_job(run_id) == 0

    import tensorflow as tf

    run_dir = run_dir_for(run_id, str(user_a))
    model = tf.keras.models.load_model(run_dir / "model.keras")
    assert [layer.__class__.__name__ for layer in model.layers] == [
        "Conv2D", "MaxPooling2D", "Conv2D", "MaxPooling2D", "Conv2D", "MaxPooling2D", "Flatten", "Dense", "Dense",
    ]
    assert [layer.filters for layer in model.layers if hasattr(layer, "filters")] == [32, 64, 128]
    assert model.layers[-1].units == 1 and model.layers[-1].activation.__name__ == "sigmoid"
    assert model.optimizer.__class__.__name__ == "Adam"
    summary = json.loads((run_dir / "summary.json").read_text())
    assert summary["batch_size"] == 4 and summary["image_size"] == [32, 32]
    assert summary["train_samples"] == 6 and summary["val_samples"] == 2
    assert _row(run_id).status == "succeeded"


def test_local_inprocess_training_still_works(client, user_a, store, cleanup):
    assert trainer_jobs.job_mode_enabled() is False
    headers = _headers(client, user_a)
    dataset_id = _dataset(user_a, cleanup)

    run_id = _start(client, headers, dataset_id, cleanup, user_a)

    view = client.get(f"/trainer/runs/{run_id}", headers=headers).json()
    assert view["status"] == "done"
    assert (run_dir_for(run_id, str(user_a)) / "model.keras").is_file()
    assert _row(run_id).status == "succeeded"
    assert trainer_jobs.is_job_run(run_id) is False
