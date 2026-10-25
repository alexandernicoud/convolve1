"""A Library model resolves to its stored bytes for the Backtester, Deploy and bot runs.

LocalCopyStore stands in for the bucket: uploaded rows carry a durable:// object reference
exactly as production rows carry gcs://, and no local copy of the upload exists, which is the
state of every Cloud Run instance other than (briefly) the one that received the upload.
"""

from __future__ import annotations

import io
import shutil
import uuid
import zipfile
from pathlib import Path

import pytest

import app.main as main
from app.db import SessionLocal
from app.main import all_runs, update_run_progress
from app.models import Bot, UserModel
from app.ownership import record_pipeline_run, record_user_dataset, record_user_model
from app.paths import dataset_dir_for, run_dir_for
from app.services import library_models
from app.services.durable_outputs import LocalCopyStore, set_artifact_store
from app.services.model_paths import require_bot_model_file

KERAS_BYTES = b"PK\x03\x04" + b"tiny-model" * 64


@pytest.fixture
def store(tmp_path: Path, monkeypatch):
    s = LocalCopyStore(tmp_path / "bucket")
    set_artifact_store(s)
    monkeypatch.setattr(library_models, "MODEL_CACHE_DIR", str(tmp_path / "cache"), raising=False)
    monkeypatch.setattr(library_models, "MODEL_STORAGE_ROOT", tmp_path / "instance-disk", raising=False)
    yield s
    set_artifact_store(None)


@pytest.fixture
def captured(monkeypatch):
    calls: list = []
    monkeypatch.setattr(main, "run_backtester_realtime", lambda run_id, payload: calls.append(payload))
    return calls


def _headers(client, user_id: uuid.UUID) -> dict:
    from tests.conftest import mint_token

    headers = {"Authorization": f"Bearer {mint_token(user_id)}"}
    client.get("/api/me", headers=headers)
    return headers


def _uploaded(store: LocalCopyStore, user_id: uuid.UUID, data: bytes = KERAS_BYTES, name: str = "SPX1.keras") -> str:
    """What the cloud upload path leaves behind: an object in the bucket and a user_models row."""
    model_id = f"model_{uuid.uuid4().hex[:12]}"
    key = f"keras/{user_id}/{model_id}.keras"
    src = store.root.parent / f"{model_id}.src"
    src.write_bytes(data)
    uri = store.put_file(key, src)
    src.unlink()
    record_user_model(model_id, str(user_id), source="uploaded", storage_key=key, path=uri,
                      extra={"original_filename": name})
    return model_id


def _trained(user_id: uuid.UUID, data: bytes = KERAS_BYTES) -> str:
    """A trainer run published by the training job; the API instance has no run directory."""
    run_id = f"lifecycle_{uuid.uuid4().hex[:10]}"
    run_dir = run_dir_for(run_id, str(user_id))
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "SPX1.keras").write_bytes(data)
    (run_dir / "summary.json").write_text('{"final_metrics": {"val_accuracy": 0.6}}', encoding="utf-8")
    record_pipeline_run(run_id, str(user_id), "trainer", status="running")
    all_runs.pop(run_id, None)
    update_run_progress(run_id, 1.0, "completed", "Training completed", "succeeded")
    all_runs.pop(run_id, None)
    shutil.rmtree(run_dir)
    return run_id


def _dataset(user_id: uuid.UUID) -> str:
    dataset_id = f"ds_{uuid.uuid4().hex[:10]}"
    root = dataset_dir_for(dataset_id, str(user_id))
    (root / "images").mkdir(parents=True, exist_ok=True)
    (root / "images" / "AAPL_2024-01-02_to_2024-03-01_label1.png").write_bytes(b"\x89PNG-chart")
    (root / "summary.json").write_text('{"total_images": 1}', encoding="utf-8")
    record_user_dataset(dataset_id, str(user_id), source="uploaded", kind="test", path=str(root))
    return dataset_id


def _backtest(client, headers, dataset_id: str, **model_ref):
    body = {"dataset_path": f"backend/datasets/{dataset_id}/images", "engine": "v1", **model_ref}
    return client.post("/api/backtests/run", json=body, headers=headers)


def _fresh_instance(tmp_path: Path, monkeypatch) -> None:
    """A different API instance or job: empty model cache and empty local disk."""
    monkeypatch.setattr(library_models, "MODEL_CACHE_DIR", str(tmp_path / f"cache-{uuid.uuid4().hex[:6]}"), raising=False)


def _bot_form(**extra) -> dict:
    return {"symbol": "AAPL", "tp_pct": "2", "sl_pct": "1", "run_time": "09:30", **extra}


# --------------------------------------------------------------------------- Backtester


def test_uploaded_library_model_backtests_from_storage(client, user_a, user_b, store, captured):
    headers = _headers(client, user_a)
    model_id = _uploaded(store, user_a)
    dataset_id = _dataset(user_a)

    res = _backtest(client, headers, dataset_id, model_id=model_id)
    assert res.status_code == 200, res.text
    assert Path(captured[-1]["model_path"]).read_bytes() == KERAS_BYTES
    assert captured[-1]["model_id"] == model_id

    other = _headers(client, user_b)
    assert _backtest(client, other, _dataset(user_b), model_id=model_id).status_code == 404


def test_trained_library_model_backtests_by_training_run_id(client, user_a, user_b, store, captured):
    headers = _headers(client, user_a)
    run_id = _trained(user_a)
    dataset_id = _dataset(user_a)

    res = _backtest(client, headers, dataset_id, trainer_run_id=run_id)
    assert res.status_code == 200, res.text
    assert Path(captured[-1]["model_path"]).read_bytes() == KERAS_BYTES
    assert _backtest(client, _headers(client, user_b), _dataset(user_b), trainer_run_id=run_id).status_code == 404


def test_trained_model_selected_by_library_model_id(client, user_a, store, captured):
    run_id = _trained(user_a)
    res = _backtest(client, _headers(client, user_a), _dataset(user_a), model_id=run_id)
    assert res.status_code == 200, res.text
    assert Path(captured[-1]["model_path"]).read_bytes() == KERAS_BYTES


def test_retrieval_after_restart_and_on_another_instance(client, user_a, store, captured, tmp_path, monkeypatch):
    headers = _headers(client, user_a)
    model_id = _uploaded(store, user_a)
    dataset_id = _dataset(user_a)
    assert _backtest(client, headers, dataset_id, model_id=model_id).status_code == 200
    first = Path(captured[-1]["model_path"])

    _fresh_instance(tmp_path, monkeypatch)
    assert _backtest(client, headers, dataset_id, model_id=model_id).status_code == 200
    second = Path(captured[-1]["model_path"])
    assert second != first and second.read_bytes() == KERAS_BYTES


def test_client_paths_are_never_trusted(client, user_a, user_b, store, captured):
    headers = _headers(client, user_a)
    foreign = _uploaded(store, user_b)
    dataset_id = _dataset(user_a)
    for ref in (
        {"model_path": f"backend/models/{foreign}.keras"},
        {"model_path": "/etc/passwd"},
        {"model_id": "../../etc/passwd"},
        {"model_id": foreign},
    ):
        res = _backtest(client, headers, dataset_id, **ref)
        assert res.status_code in (400, 404, 422), (ref, res.status_code)
    assert captured == []


# --------------------------------------------------------------------------- Deploy and bot runs


@pytest.mark.parametrize("source", ["uploaded", "trained"])
def test_deploy_from_library_survives_without_the_creating_instance(
    client, user_a, user_b, store, source, tmp_path, monkeypatch
):
    headers = _headers(client, user_a)
    if source == "uploaded":
        ref = {"source_model_id": _uploaded(store, user_a)}
    else:
        ref = {"source_training_run_id": _trained(user_a)}

    assert client.post("/api/bots", data=_bot_form(**ref), headers=_headers(client, user_b)).status_code == 404
    res = client.post("/api/bots", data=_bot_form(**ref), headers=headers)
    assert res.status_code in (200, 201), res.text
    bot_id = res.json()["id"]
    with SessionLocal() as db:
        bot = db.get(Bot, bot_id)
        stored_path, filename = bot.model_path, bot.model_filename
    assert filename == "SPX1.keras"

    # The bot owns its copy: the worker reads it with the Library cache and source gone.
    shutil.rmtree(Path(library_models.MODEL_CACHE_DIR), ignore_errors=True)
    _fresh_instance(tmp_path, monkeypatch)
    assert Path(require_bot_model_file(stored_path)).read_bytes() == KERAS_BYTES


# --------------------------------------------------------------------------- failure modes


def test_missing_artifact_is_reported_and_record_is_kept(client, user_a, store, captured):
    headers = _headers(client, user_a)
    model_id = _uploaded(store, user_a)
    for obj in store.root.rglob(f"{model_id}.keras"):
        obj.unlink()

    res = _backtest(client, headers, _dataset(user_a), model_id=model_id)
    assert res.status_code == 404
    assert res.json()["detail"] == library_models.MISSING_DETAIL
    deploy = client.post("/api/bots", data=_bot_form(source_model_id=model_id), headers=headers)
    assert deploy.status_code == 404
    with SessionLocal() as db:
        assert db.get(UserModel, model_id) is not None
    listed = client.get("/api/models", headers=headers).json()["models"]
    assert any(m["model_id"] == model_id for m in listed)


def test_reference_outside_owner_prefix_is_refused(client, user_a, user_b, store, captured):
    foreign = _uploaded(store, user_b)
    with SessionLocal() as db:
        foreign_path = db.get(UserModel, foreign).path
    mine = f"model_{uuid.uuid4().hex[:12]}"
    record_user_model(mine, str(user_a), source="uploaded", storage_key="x", path=foreign_path)
    res = _backtest(client, _headers(client, user_a), _dataset(user_a), model_id=mine)
    assert res.status_code == 404
    assert captured == []


def test_upload_without_training_metadata_is_not_given_any(client, user_a, store):
    headers = _headers(client, user_a)
    bare = _uploaded(store, user_a)
    assert client.get(f"/models/{bare}/metadata", headers=headers).status_code == 404
    row = next(m for m in client.get("/api/models", headers=headers).json()["models"] if m["model_id"] == bare)
    assert row["metadata_available"] is False and row["symbols"] is None and row["name"] == "SPX1.keras"


def test_matched_upload_metadata_survives_restart(client, user_a, user_b, store):
    headers = _headers(client, user_a)
    run_id = _trained(user_a)
    model_id = _uploaded(store, user_a)
    record_user_model(model_id, str(user_a), extra={
        "original_filename": "SPX1.keras", "training_run_id": run_id, "symbols": "SPX", "timeframe": "1d",
    })
    meta = client.get(f"/models/{model_id}/metadata", headers=headers)
    assert meta.status_code == 200, meta.text
    assert meta.json()["training_run_id"] == run_id and meta.json()["symbols"] == "SPX"
    assert client.get(f"/models/{model_id}/metadata", headers=_headers(client, user_b)).status_code == 404


def test_multipart_upload_rejects_non_keras_bytes(client, user_a):
    res = client.post(
        "/models/upload",
        files={"file": ("fake.keras", b"GIF89a" + b"\x00" * 64, "application/octet-stream")},
        headers=_headers(client, user_a),
    )
    assert res.status_code == 400


def test_local_upload_resolves_for_backtest(client, user_a, store, captured):
    """Development profile: the upload lands on local disk and is found through its row."""
    headers = _headers(client, user_a)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("config.json", "{}")
    up = client.post("/models/upload", files={"file": ("local.keras", buf.getvalue(), "application/octet-stream")},
                     headers=headers)
    assert up.status_code == 200, up.text
    model_id = up.json()["model_id"]
    saved = Path(up.json()["absolute_path"])
    try:
        res = _backtest(client, headers, _dataset(user_a), model_id=model_id)
        assert res.status_code == 200, res.text
        assert Path(captured[-1]["model_path"]).read_bytes() == buf.getvalue()
    finally:
        saved.unlink(missing_ok=True)
        saved.with_name(f"{model_id}.metadata.json").unlink(missing_ok=True)


def test_tiny_keras_model_loads_from_storage_copy(client, user_a, store, tmp_path, monkeypatch):
    keras = pytest.importorskip("keras")
    model = keras.Sequential([keras.Input(shape=(8, 8, 3)), keras.layers.Flatten(), keras.layers.Dense(1, activation="sigmoid")])
    src = tmp_path / "tiny.keras"
    model.save(src)
    model_id = _uploaded(store, user_a, data=src.read_bytes(), name="tiny.keras")
    src.unlink()

    _fresh_instance(tmp_path, monkeypatch)
    path = library_models.owned_model_file(str(user_a), model_id=model_id)
    loaded = keras.models.load_model(path)
    assert loaded.input_shape == (None, 8, 8, 3)
