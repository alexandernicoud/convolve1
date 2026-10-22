"""Completed outputs stay readable after the local run directory is removed."""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest

from app.main import _locate_dataset_dir, all_runs, update_run_progress
from app.ownership import merge_dataset_extra, record_pipeline_run, record_user_dataset
from app.paths import dataset_dir_for, run_dir_for
from app.services.durable_outputs import (
    LocalCopyStore,
    get_artifact_store,
    publish_dataset_dir,
    set_artifact_store,
)


@pytest.fixture
def copy_store(tmp_path: Path):
    store = LocalCopyStore(tmp_path / "durable")
    set_artifact_store(store)
    yield store
    set_artifact_store(None)


def _headers(client, user_id: uuid.UUID) -> dict:
    from tests.conftest import mint_token

    token = mint_token(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    client.get("/api/me", headers=headers)
    return headers


def _cleanup(path: Path) -> None:
    if path.is_dir() and path.name not in ("runs", "datasets", "durable"):
        shutil.rmtree(path)


def test_trainer_and_dataset_survive_restart(client, user_a, user_b, copy_store):
    headers_a = _headers(client, user_a)
    headers_b = _headers(client, user_b)
    dataset_id = "dset_durable_1"
    run_id = "durable_trainer_1"
    dataset_path = dataset_dir_for(dataset_id, str(user_a))
    images = dataset_path / "images"
    images.mkdir(parents=True, exist_ok=True)
    (images / "chart_label1.png").write_bytes(b"png-bytes")
    (dataset_path / "summary.json").write_text(
        """{
          "dataset_id": "dset_durable_1",
          "extracted_path": "images",
          "total_images": 1,
          "label_distribution": {"1": 1},
          "example_filenames": ["chart_label1.png"],
          "created_at": 1
        }""",
        encoding="utf-8",
    )
    record_user_dataset(dataset_id, str(user_a), source="uploaded", kind="training", path=str(dataset_path))
    ok, err = publish_dataset_dir(dataset_id, str(user_a), dataset_path)
    assert ok, err
    _cleanup(dataset_path)

    located = _locate_dataset_dir(dataset_id, str(user_a))
    assert located is not None
    assert Path(located, "images", "chart_label1.png").read_bytes() == b"png-bytes"
    assert client.get(f"/datasets/{dataset_id}", headers=headers_b).status_code == 404
    listed = client.get("/api/datasets", headers=headers_a)
    assert any(row["dataset_id"] == dataset_id for row in listed.json()["datasets"])

    run_dir = run_dir_for(run_id, str(user_a))
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "model.keras").write_bytes(b"weights-v1")
    (run_dir / "summary.json").write_text(
        '{"config": {"dataset_id": "dset_durable_1"}, "final_metrics": {"val_accuracy": 0.8}}',
        encoding="utf-8",
    )
    (run_dir / "history.json").write_text("[]", encoding="utf-8")
    record_pipeline_run(run_id, str(user_a), "trainer", status="running")
    all_runs.pop(run_id, None)
    update_run_progress(run_id, 1.0, "completed", "Training completed", "succeeded")
    all_runs.pop(run_id, None)
    _cleanup(run_dir)

    detail = client.get(f"/runs/{run_id}", headers=headers_a)
    assert detail.status_code == 200
    assert detail.json()["status"] == "succeeded"
    assert client.get(f"/runs/{run_id}", headers=headers_b).status_code == 404

    downloaded = client.get(f"/trainer/runs/{run_id}/download/model", headers=headers_a)
    assert downloaded.status_code == 200
    assert downloaded.content == b"weights-v1"
    assert client.get(f"/trainer/runs/{run_id}/download/model", headers=headers_b).status_code == 404

    models = client.get("/api/models", headers=headers_a)
    assert any(row["model_id"] == run_id for row in models.json()["models"])
    # Downstream training reads the restored dataset directory, not the deleted original.
    again = _locate_dataset_dir(dataset_id, str(user_a))
    assert again is not None and Path(again, "images", "chart_label1.png").is_file()

    state_key = next(iter(copy_store.root.rglob("model.keras")))
    assert f"users/{user_a}" in str(state_key)
    _cleanup(run_dir_for(run_id, str(user_a)))
    _cleanup(dataset_path)


def test_upload_failure_does_not_mark_succeeded(client, user_a, copy_store):
    _headers(client, user_a)

    class FailingStore(LocalCopyStore):
        def put_file(self, key: str, src: Path) -> str:
            raise OSError("upload failed")

    set_artifact_store(FailingStore(copy_store.root))
    run_id = "durable_fail_store"
    run_dir = run_dir_for(run_id, str(user_a))
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "model.keras").write_bytes(b"weights")
    (run_dir / "summary.json").write_text("{}", encoding="utf-8")
    record_pipeline_run(run_id, str(user_a), "trainer", status="running")
    all_runs.pop(run_id, None)
    update_run_progress(run_id, 1.0, "completed", "Training completed", "succeeded")
    detail = client.get(f"/runs/{run_id}", headers=_headers(client, user_a))
    assert detail.status_code == 200
    assert detail.json()["status"] == "failed"
    assert "could not be stored" in (detail.json()["message"] or "").lower()
    assert not any(copy_store.root.rglob("model.keras"))
    _cleanup(run_dir)


def test_missing_finals_are_not_succeeded(client, user_a, copy_store):
    _headers(client, user_a)
    run_id = "durable_missing_1"
    record_pipeline_run(run_id, str(user_a), "backtester", status="running")
    all_runs.pop(run_id, None)
    update_run_progress(run_id, 1.0, "done", "Backtest completed successfully!", "succeeded")
    detail = client.get(f"/runs/{run_id}", headers=_headers(client, user_a))
    assert detail.json()["status"] == "failed"
    assert "backtest_results.json" in (detail.json()["message"] or "")


def test_listing_does_not_download_artifacts(client, user_a, user_b, copy_store):
    """Library lists are metadata. Opening a dataset or model is what downloads files."""
    import time

    headers_a = _headers(client, user_a)
    headers_b = _headers(client, user_b)
    dataset_id = "dset_lazy_list"
    run_id = "lazy_trainer_1"
    image_count = 8
    dataset_path = dataset_dir_for(dataset_id, str(user_a))
    images = dataset_path / "images"
    images.mkdir(parents=True, exist_ok=True)
    for index in range(image_count):
        (images / f"chart_{index}_label1.png").write_bytes(b"png-bytes-%d" % index)
    (dataset_path / "summary.json").write_text(
        """{
          "dataset_id": "dset_lazy_list",
          "dataset_name": "Lazy set",
          "kind": "training",
          "symbols": "AAPL",
          "extracted_path": "images",
          "total_images": 8,
          "label_distribution": {"1": 8},
          "example_filenames": ["chart_0_label1.png"],
          "created_at": 1
        }""",
        encoding="utf-8",
    )
    record_user_dataset(dataset_id, str(user_a), source="uploaded", kind="training", path=str(dataset_path))
    ok, err = publish_dataset_dir(dataset_id, str(user_a), dataset_path)
    assert ok, err

    run_dir = run_dir_for(run_id, str(user_a))
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "model.keras").write_bytes(b"weights-lazy")
    (run_dir / "summary.json").write_text(
        '{"config": {"dataset_id": "dset_lazy_list"}, "final_metrics": {"val_accuracy": 0.8}, "epochs_trained": 1}',
        encoding="utf-8",
    )
    (run_dir / "history.json").write_text("[]", encoding="utf-8")
    record_pipeline_run(run_id, str(user_a), "trainer", status="running")
    all_runs.pop(run_id, None)
    update_run_progress(run_id, 1.0, "completed", "Training completed", "succeeded")
    all_runs.pop(run_id, None)

    record_pipeline_run("lazy_sparse_trainer", str(user_a), "trainer", status="succeeded")
    from app.ownership import record_user_model

    record_user_model(
        "lazy_upload_1",
        str(user_a),
        source="uploaded",
        storage_key=f"users/{user_a}/models/my_model.keras",
        extra={"original_filename": "my_model.keras"},
    )

    _cleanup(dataset_path)
    _cleanup(run_dir)
    assert not (images / "chart_0_label1.png").is_file()
    assert not (run_dir / "model.keras").is_file()

    class CountingStore(type(copy_store)):
        def materialize(self, uri, dest):
            self.downloads += 1
            if self.delay:
                time.sleep(self.delay)
            super().materialize(uri, dest)

    store = CountingStore(copy_store.root)
    store.downloads = 0
    store.delay = 0.03
    set_artifact_store(store)

    started = time.perf_counter()
    listed_datasets = client.get("/api/datasets", headers=headers_a)
    listed_models = client.get("/api/models", headers=headers_a)
    list_elapsed = time.perf_counter() - started
    list_downloads = store.downloads
    assert listed_datasets.status_code == 200
    assert listed_models.status_code == 200
    assert list_downloads == 0

    dataset_row = next(row for row in listed_datasets.json()["datasets"] if row["dataset_id"] == dataset_id)
    assert dataset_row["name"] == "Lazy set"
    assert dataset_row["kind"] == "training"
    assert dataset_row["total_images"] == 8
    assert dataset_row["symbols"] == "AAPL"
    model_row = next(row for row in listed_models.json()["models"] if row["model_id"] == run_id)
    assert model_row["kind"] == "trained"
    assert model_row["name"] == "model.keras"
    assert model_row["dataset_id"] == dataset_id
    assert model_row["metrics"]["val_accuracy"] == 0.8
    assert model_row["download_url"] == f"/trainer/runs/{run_id}/download/model"
    sparse = next(row for row in listed_models.json()["models"] if row["model_id"] == "lazy_sparse_trainer")
    assert sparse["metadata_available"] is False
    uploaded = next(row for row in listed_models.json()["models"] if row["model_id"] == "lazy_upload_1")
    assert uploaded["kind"] == "uploaded"
    assert uploaded["name"] == "my_model.keras"

    other_datasets = client.get("/api/datasets", headers=headers_b).json()["datasets"]
    other_models = client.get("/api/models", headers=headers_b).json()["models"]
    assert list_downloads == store.downloads  # the other user's lists download nothing either
    assert all(row["dataset_id"] != dataset_id for row in other_datasets)
    assert all(row["model_id"] not in {run_id, "lazy_sparse_trainer", "lazy_upload_1"} for row in other_models)
    assert client.get(f"/datasets/{dataset_id}", headers=headers_b).status_code == 404
    assert client.get(f"/trainer/runs/{run_id}/download/model", headers=headers_b).status_code == 404

    from app.services.durable_outputs import restore_completed_trainer_runs, restore_owned_datasets

    store.downloads = 0
    started = time.perf_counter()
    restore_owned_datasets(str(user_a))
    restore_completed_trainer_runs(str(user_a))
    eager_elapsed = time.perf_counter() - started
    eager_downloads = store.downloads
    print(
        f"LISTING_BENCH list_s={list_elapsed:.3f} list_downloads={list_downloads} "
        f"eager_s={eager_elapsed:.3f} eager_downloads={eager_downloads} delay_s={store.delay}"
    )
    # A dataset restores as summary.json plus one archive, however many images it has.
    assert (images / "chart_0_label1.png").read_bytes() == b"png-bytes-0"
    assert 2 <= eager_downloads < image_count
    assert eager_elapsed > list_elapsed
    assert eager_elapsed > store.delay * 2

    _cleanup(dataset_path)
    _cleanup(run_dir)
    store.downloads = 0
    store.delay = 0
    opened = client.get(f"/datasets/{dataset_id}", headers=headers_a)
    assert opened.status_code == 200
    assert opened.json()["total_images"] == image_count
    assert (images / "chart_0_label1.png").read_bytes() == b"png-bytes-0"
    downloaded = client.get(f"/trainer/runs/{run_id}/download/model", headers=headers_a)
    assert downloaded.status_code == 200
    assert downloaded.content == b"weights-lazy"
    assert store.downloads > 0
    _cleanup(dataset_path)
    _cleanup(run_dir)


def test_store_is_reset():
    assert not isinstance(get_artifact_store(), LocalCopyStore)
    merge_dataset_extra("does-not-exist", {"durable": {"published": True}})
