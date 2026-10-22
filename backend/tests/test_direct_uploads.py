"""Uploads larger than Cloud Run's 32 MiB request limit go straight to storage.

LocalUploadStore stands in for the bucket; write() plays the browser's PUT to the
resumable session URL.
"""

from __future__ import annotations

import io
import json
import shutil
import uuid
import zipfile
from pathlib import Path

import pytest

from app.db import SessionLocal
from app.models import Bot, UserDataset
from app.paths import dataset_dir_for
from app.services import direct_uploads
from app.services.direct_uploads import LocalUploadStore, set_upload_store
from app.services.durable_outputs import LocalCopyStore, set_artifact_store

KERAS_BYTES = b"PK\x03\x04" + b"\x00" * 2048


@pytest.fixture
def upload_store(tmp_path: Path):
    store = LocalUploadStore(tmp_path / "bucket")
    set_upload_store(store)
    yield store
    set_upload_store(None)


@pytest.fixture
def copy_store(tmp_path: Path):
    store = LocalCopyStore(tmp_path / "durable")
    set_artifact_store(store)
    yield store
    set_artifact_store(None)


def _headers(client, user_id: uuid.UUID) -> dict:
    from tests.conftest import mint_token

    headers = {"Authorization": f"Bearer {mint_token(user_id)}"}
    client.get("/api/me", headers=headers)
    return headers


def _dataset_zip(n: int = 3) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for i in range(n):
            zf.writestr(f"chart_{i}_label{i % 2}.png", b"\x89PNG" + bytes([i]) * 64)
    return buf.getvalue()


def _init(client, headers, kind: str, filename: str, size: int):
    return client.post("/api/uploads", json={"kind": kind, "filename": filename, "size": size}, headers=headers)


def _stage(client, store: LocalUploadStore, headers, kind: str, filename: str, data: bytes) -> tuple[str, str]:
    res = _init(client, headers, kind, filename, len(data))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["mode"] == "direct" and body["method"] == "PUT"
    key = next(k for k in store.sessions if f"/{body['upload_id']}/" in k)
    store.write(key, data)
    return body["upload_id"], key


def _drop_dataset(dataset_id: str, owner: uuid.UUID) -> None:
    shutil.rmtree(dataset_dir_for(dataset_id, str(owner)), ignore_errors=True)


def test_local_profile_keeps_multipart(client, user_a):
    res = _init(client, _headers(client, user_a), "dataset", "d.zip", 10)
    assert res.status_code == 200
    assert res.json() == {"mode": "multipart"}


def test_init_requires_auth(client, upload_store):
    assert _init(client, {}, "dataset", "d.zip", 10).status_code == 401


def test_init_rejects_bad_requests(client, user_a, upload_store):
    headers = _headers(client, user_a)
    assert _init(client, headers, "dataset", "d.tar", 10).status_code == 400
    assert _init(client, headers, "weights", "m.keras", 10).status_code == 400
    assert _init(client, headers, "dataset", "d.zip", 0).status_code == 400
    too_big = direct_uploads.KINDS["dataset"]["max_bytes"] + 1
    assert _init(client, headers, "dataset", "d.zip", too_big).status_code == 413
    assert not upload_store.sessions


def test_session_is_scoped_to_user_with_kind_and_size(client, user_a, upload_store):
    res = _init(client, _headers(client, user_a), "dataset", "../../etc/My Data.zip", 1234)
    upload_id = res.json()["upload_id"]
    (key, session), = upload_store.sessions.items()
    assert key == f"uploads/{user_a}/{upload_id}/My_Data.zip"
    assert session["size"] == 1234
    assert session["metadata"] == {"convolve-kind": "dataset", "convolve-size": "1234"}


def test_dataset_finalize_ingests_and_stores_archive(client, user_a, user_b, upload_store, copy_store):
    headers = _headers(client, user_a)
    upload_id, key = _stage(client, upload_store, headers, "dataset", "charts.zip", _dataset_zip(3))

    res = client.post(f"/api/uploads/{upload_id}/dataset", json={"source": None}, headers=headers)
    assert res.status_code == 200, res.text
    dataset_id = res.json()["dataset_id"]
    assert res.json()["summary"]["total_images"] == 3
    try:
        assert not (upload_store.root / key).exists()
        with SessionLocal() as db:
            row = db.get(UserDataset, dataset_id)
            durable = json.loads(row.extra_json)["durable"]
        assert str(row.user_id) == str(user_a)
        assert durable["format"] == "archive-v1"
        assert durable["archive"]["count"] == 3
        assert client.get(f"/datasets/{dataset_id}", headers=_headers(client, user_b)).status_code == 404
        assert client.post(f"/api/uploads/{upload_id}/dataset", headers=headers).status_code == 404
    finally:
        _drop_dataset(dataset_id, user_a)


def test_other_user_cannot_finalize(client, user_a, user_b, upload_store):
    upload_id, key = _stage(client, upload_store, _headers(client, user_a), "dataset", "d.zip", _dataset_zip())
    res = client.post(f"/api/uploads/{upload_id}/dataset", headers=_headers(client, user_b))
    assert res.status_code == 404
    assert (upload_store.root / key).exists()


@pytest.mark.parametrize("upload_id", ["not-hex", "../" + "0" * 32, "A" * 32, ""])
def test_malformed_upload_id_is_not_found(client, user_a, upload_store, upload_id):
    res = client.post(f"/api/uploads/{upload_id}/model", headers=_headers(client, user_a))
    assert res.status_code in (404, 405)


def test_kind_mismatch_is_rejected(client, user_a, upload_store):
    headers = _headers(client, user_a)
    res = _init(client, headers, "model", "m.keras", len(KERAS_BYTES))
    upload_id = res.json()["upload_id"]
    (key,) = upload_store.sessions
    upload_store.write(key.replace(".keras", ".zip"), KERAS_BYTES, upload_store.sessions[key]["metadata"])
    assert client.post(f"/api/uploads/{upload_id}/dataset", headers=headers).status_code == 409


def test_incomplete_upload_is_rejected(client, user_a, upload_store):
    headers = _headers(client, user_a)
    data = _dataset_zip()
    res = _init(client, headers, "dataset", "d.zip", len(data))
    (key,) = upload_store.sessions
    upload_store.write(key, data[: len(data) // 2])
    assert client.post(f"/api/uploads/{res.json()['upload_id']}/dataset", headers=headers).status_code == 409


def test_non_zip_content_is_rejected(client, user_a, upload_store):
    headers = _headers(client, user_a)
    upload_id, _ = _stage(client, upload_store, headers, "dataset", "d.zip", b"GIF89a" + b"\x00" * 100)
    assert client.post(f"/api/uploads/{upload_id}/dataset", headers=headers).status_code == 400


def test_model_finalize_saves_model(client, user_a, user_b, upload_store):
    headers = _headers(client, user_a)
    upload_id, key = _stage(client, upload_store, headers, "model", "my model.keras", KERAS_BYTES)
    assert client.post(f"/api/uploads/{upload_id}/model", headers=_headers(client, user_b)).status_code == 404

    res = client.post(f"/api/uploads/{upload_id}/model", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["byte_size"] == len(KERAS_BYTES)
    assert body["original_filename"] == "my_model.keras"
    assert Path(body["absolute_path"]).read_bytes() == KERAS_BYTES
    assert not (upload_store.root / key).exists()


def _bot_form(**extra) -> dict:
    form = {"symbol": "AAPL", "tp_pct": "2", "sl_pct": "1", "run_time": "09:30"}
    form.update(extra)
    return form


def test_bot_created_from_direct_upload(client, user_a, user_b, upload_store):
    headers = _headers(client, user_a)
    upload_id, key = _stage(client, upload_store, headers, "model", "bot.keras", KERAS_BYTES)
    denied = client.post("/api/bots", data=_bot_form(model_upload_id=upload_id), headers=_headers(client, user_b))
    assert denied.status_code == 404

    res = client.post("/api/bots", data=_bot_form(model_upload_id=upload_id), headers=headers)
    assert res.status_code in (200, 201), res.text
    bot_id = res.json()["id"]
    with SessionLocal() as db:
        bot = db.get(Bot, bot_id)
        assert str(bot.user_id) == str(user_a)
        assert Path(bot.model_path).read_bytes() == KERAS_BYTES
    assert not (upload_store.root / key).exists()


DEPLOY = Path(__file__).resolve().parents[1] / "deploy"


@pytest.mark.parametrize("kind,endpoint", [("dataset", "dataset"), ("model", "model"), ("model", "bot")])
def test_foreign_upload_is_invisible_on_every_finalize_path(client, user_a, user_b, upload_store, kind, endpoint):
    data = _dataset_zip() if kind == "dataset" else KERAS_BYTES
    upload_id, key = _stage(client, upload_store, _headers(client, user_a), kind, f"x.{'zip' if kind == 'dataset' else 'keras'}", data)
    assert key.startswith(f"uploads/{user_a}/{upload_id}/")
    other = _headers(client, user_b)
    if endpoint == "bot":
        res = client.post("/api/bots", data=_bot_form(model_upload_id=upload_id), headers=other)
    else:
        res = client.post(f"/api/uploads/{upload_id}/{endpoint}", headers=other)
    assert res.status_code == 404
    assert (upload_store.root / key).exists()
    assert upload_store.find(f"uploads/{user_b}/{upload_id}/") == []


def test_incomplete_upload_is_kept_until_lifecycle_expiry(client, user_a, upload_store):
    headers = _headers(client, user_a)
    data = _dataset_zip()
    res = _init(client, headers, "dataset", "d.zip", len(data))
    (key,) = upload_store.sessions
    upload_store.write(key, data[:10])
    assert client.post(f"/api/uploads/{res.json()['upload_id']}/dataset", headers=headers).status_code == 409
    assert (upload_store.root / key).exists()


def test_wrong_endpoint_keeps_upload_for_retry(client, user_a, upload_store):
    headers = _headers(client, user_a)
    upload_id, key = _stage(client, upload_store, headers, "model", "m.keras", KERAS_BYTES)
    assert client.post(f"/api/uploads/{upload_id}/dataset", headers=headers).status_code == 409
    assert (upload_store.root / key).exists()
    assert client.post(f"/api/uploads/{upload_id}/model", headers=headers).status_code == 200


def test_rejected_content_is_deleted(client, user_a, upload_store):
    headers = _headers(client, user_a)
    upload_id, key = _stage(client, upload_store, headers, "dataset", "d.zip", b"GIF89a" + b"\x00" * 100)
    assert client.post(f"/api/uploads/{upload_id}/dataset", headers=headers).status_code == 400
    assert not (upload_store.root / key).exists()


def test_oversize_staged_object_is_deleted(client, user_a, upload_store, monkeypatch):
    headers = _headers(client, user_a)
    upload_id, key = _stage(client, upload_store, headers, "model", "m.keras", KERAS_BYTES)
    monkeypatch.setitem(direct_uploads.KINDS["model"], "max_bytes", 16)
    assert client.post(f"/api/uploads/{upload_id}/model", headers=headers).status_code == 413
    assert not (upload_store.root / key).exists()


def test_failed_ingest_deletes_staged_object(client, user_a, upload_store):
    headers = _headers(client, user_a)
    broken = b"PK\x03\x04" + b"\xff" * 200
    upload_id, key = _stage(client, upload_store, headers, "dataset", "d.zip", broken)
    res = client.post(f"/api/uploads/{upload_id}/dataset", headers=headers)
    assert res.status_code == 400, res.text
    assert not (upload_store.root / key).exists()
    assert client.post(f"/api/uploads/{upload_id}/dataset", headers=headers).status_code == 404


def test_durable_paths_stay_outside_upload_prefix(client, user_a, upload_store, copy_store):
    headers = _headers(client, user_a)
    upload_id, _ = _stage(client, upload_store, headers, "model", "keep.keras", KERAS_BYTES)
    model = client.post(f"/api/uploads/{upload_id}/model", headers=headers).json()
    upload_id, _ = _stage(client, upload_store, headers, "dataset", "keep.zip", _dataset_zip())
    dataset_id = client.post(f"/api/uploads/{upload_id}/dataset", headers=headers).json()["dataset_id"]
    try:
        with SessionLocal() as db:
            durable = json.loads(db.get(UserDataset, dataset_id).extra_json)["durable"]
        assert durable["archive"]["key"].startswith(f"users/{user_a}/")
        assert copy_store.root in Path(copy_store.root / durable["archive"]["key"]).parents
        assert upload_store.root not in Path(model["absolute_path"]).parents
        assert Path(model["absolute_path"]).read_bytes() == KERAS_BYTES
        assert not any(upload_store.root.rglob("*.keras")) and not any(upload_store.root.rglob("*.zip"))
    finally:
        _drop_dataset(dataset_id, user_a)


def test_lifecycle_rule_only_expires_staged_uploads():
    rules = json.loads((DEPLOY / "upload-lifecycle.json").read_text())["rule"]
    assert len(rules) == 1
    rule = rules[0]
    assert rule["action"] == {"type": "Delete"}
    assert rule["condition"]["matchesPrefix"] == [direct_uploads.UPLOAD_PREFIX]
    assert set(rule["condition"]) == {"age", "matchesPrefix"}
    for durable in ("users/", "datasets/", "models/"):
        assert not durable.startswith(direct_uploads.UPLOAD_PREFIX)


def test_upload_cors_allows_only_browser_put_from_production_origins():
    (entry,) = json.loads((DEPLOY / "upload-cors.json").read_text())
    assert set(entry["method"]) == {"PUT", "OPTIONS"}
    assert all(o.startswith("https://") and o.endswith("we-convolve.com") for o in entry["origin"])


def test_bot_requires_exactly_one_model_source(client, user_a, upload_store):
    headers = _headers(client, user_a)
    assert client.post("/api/bots", data=_bot_form(), headers=headers).status_code == 400
    both = client.post(
        "/api/bots",
        data=_bot_form(model_upload_id="0" * 32),
        files={"model_file": ("m.keras", KERAS_BYTES, "application/octet-stream")},
        headers=headers,
    )
    assert both.status_code == 400


def _datasets_for(user_id: uuid.UUID) -> set:
    with SessionLocal() as db:
        return {r.id for r in db.query(UserDataset).filter(UserDataset.user_id == user_id)}


def test_multipart_dataset_rejects_zip_bomb(client, user_a, monkeypatch):
    import app.main as main

    headers = _headers(client, user_a)
    monkeypatch.setattr(main, "MAX_DATASET_EXTRACTED_BYTES", 100)
    before = _datasets_for(user_a)
    res = client.post(
        "/datasets/upload",
        files={"file": ("d.zip", _dataset_zip(5), "application/zip")},
        headers=headers,
    )
    assert res.status_code == 413
    assert _datasets_for(user_a) == before


def test_multipart_dataset_rejects_oversize_and_invalid(client, user_a, monkeypatch):
    import app.main as main

    headers = _headers(client, user_a)
    bad = client.post("/datasets/upload", files={"file": ("d.zip", b"not a zip", "application/zip")}, headers=headers)
    assert bad.status_code == 400
    monkeypatch.setattr(main, "MAX_DATASET_UPLOAD_BYTES", 64)
    big = client.post("/datasets/upload", files={"file": ("d.zip", _dataset_zip(5), "application/zip")}, headers=headers)
    assert big.status_code == 413


def test_multipart_dataset_upload_still_works(client, user_a, copy_store):
    res = client.post(
        "/datasets/upload",
        files={"file": ("d.zip", _dataset_zip(4), "application/zip")},
        headers=_headers(client, user_a),
    )
    assert res.status_code == 200, res.text
    _drop_dataset(res.json()["dataset_id"], user_a)
