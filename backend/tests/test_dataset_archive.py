"""Datasets are stored as one archive object, and older per-file datasets still restore."""

from __future__ import annotations

import io
import json
import shutil
import uuid
import zipfile
from pathlib import Path

import pytest

from app.db import SessionLocal
from app.models import UserDataset
from app.ownership import merge_dataset_extra, record_user_dataset
from app.paths import dataset_dir_for
from app.services import durable_outputs
from app.services.durable_outputs import (
    LocalCopyStore,
    LocalPassThroughStore,
    publish_dataset_dir,
    restore_dataset,
    set_artifact_store,
)
from app.services.trainer_jobs import dataset_is_stored


@pytest.fixture
def copy_store(tmp_path: Path):
    store = LocalCopyStore(tmp_path / "durable")
    set_artifact_store(store)
    yield store
    set_artifact_store(None)


@pytest.fixture
def owner(client, user_a) -> uuid.UUID:
    from tests.conftest import mint_token

    client.get("/api/me", headers={"Authorization": f"Bearer {mint_token(user_a)}"})
    return user_a


def _make_dataset(owner: uuid.UUID, n: int = 12) -> tuple[str, Path, dict]:
    dataset_id = f"arch{uuid.uuid4().hex[:8]}"
    root = dataset_dir_for(dataset_id, str(owner))
    images = {}
    for i in range(n):
        rel = f"images/{'sub/' if i % 3 == 0 else ''}chart_{i}_label{i % 2}.png"
        data = b"\x89PNG" + bytes([i]) * (100 + i)
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_bytes(data)
        images[rel] = data
    (root / "summary.json").write_text(json.dumps({"dataset_id": dataset_id, "total_images": n}), encoding="utf-8")
    (root / f"{dataset_id}.zip").write_bytes(b"PK\x03\x04original-upload")
    record_user_dataset(dataset_id, str(owner), source="uploaded", kind="uploaded", path=str(root))
    return dataset_id, root, images


def _durable(dataset_id: str) -> dict:
    with SessionLocal() as db:
        return json.loads(db.get(UserDataset, dataset_id).extra_json)["durable"]


def _stored_objects(store: LocalCopyStore) -> list:
    return sorted(p.relative_to(store.root).as_posix() for p in store.root.rglob("*") if p.is_file())


def _assert_restored(root: Path, images: dict) -> None:
    for rel, data in images.items():
        assert (root / rel).read_bytes() == data
    assert (root / "summary.json").is_file()


def test_publish_stores_one_archive_and_summary(owner, copy_store):
    dataset_id, root, images = _make_dataset(owner)
    ok, err = publish_dataset_dir(dataset_id, str(owner), root)
    assert ok, err

    prefix = f"users/{owner}/datasets/{dataset_id}"
    assert _stored_objects(copy_store) == [f"{prefix}/dataset.zip", f"{prefix}/summary.json"]
    durable = _durable(dataset_id)
    assert durable["format"] == "archive-v1"
    assert durable["archive"]["count"] == len(images)
    assert [f["rel"] for f in durable["files"]] == ["summary.json"]
    with zipfile.ZipFile(copy_store.root / durable["archive"]["key"]) as zf:
        assert sorted(zf.namelist()) == sorted(images)
        assert {i.compress_type for i in zf.infolist()} == {zipfile.ZIP_STORED}
    assert not (root / f"{dataset_id}.zip").exists()
    assert dataset_is_stored(dataset_id, str(owner))

    shutil.rmtree(root)
    assert restore_dataset(dataset_id, str(owner))
    _assert_restored(root, images)
    shutil.rmtree(root)


def test_restore_skips_download_when_images_present(owner, copy_store, monkeypatch):
    dataset_id, root, images = _make_dataset(owner, n=4)
    assert publish_dataset_dir(dataset_id, str(owner), root)[0]

    def fail(*_a, **_k):
        raise AssertionError("archive should not be downloaded again")

    monkeypatch.setattr(copy_store, "materialize", fail)
    assert restore_dataset(dataset_id, str(owner))
    shutil.rmtree(root)


def test_legacy_per_file_dataset_still_restores(owner, copy_store):
    dataset_id, root, images = _make_dataset(owner, n=9)
    files = []
    for rel in ["summary.json", *images]:
        key = f"users/{owner}/datasets/{dataset_id}/{rel}"
        files.append({"rel": rel, "key": key, "uri": copy_store.put_file(key, root / rel)})
    merge_dataset_extra(dataset_id, {"durable": {"published": True, "files": files, "summary": {}}})
    assert dataset_is_stored(dataset_id, str(owner))

    shutil.rmtree(root)
    assert restore_dataset(dataset_id, str(owner))
    _assert_restored(root, images)
    shutil.rmtree(root)


def test_checksum_mismatch_leaves_no_images(owner, copy_store):
    dataset_id, root, _ = _make_dataset(owner, n=3)
    assert publish_dataset_dir(dataset_id, str(owner), root)[0]
    archive = copy_store.root / _durable(dataset_id)["archive"]["key"]
    with zipfile.ZipFile(archive, "a") as zf:
        zf.writestr("images/extra_label1.png", b"tampered")

    shutil.rmtree(root)
    with pytest.raises(ValueError, match="checksum"):
        restore_dataset(dataset_id, str(owner))
    assert not (root / "images").exists()
    assert not list(root.parent.glob(f".{dataset_id}.*"))
    shutil.rmtree(root, ignore_errors=True)


@pytest.mark.parametrize("member", ["../escape.png", "images/../../escape.png", "summary.json", "/abs/escape.png"])
def test_unsafe_archive_members_are_rejected(owner, copy_store, member):
    dataset_id, root, _ = _make_dataset(owner, n=1)
    assert publish_dataset_dir(dataset_id, str(owner), root)[0]
    durable = _durable(dataset_id)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("images/ok_label1.png", b"ok")
        zf.writestr(member, b"evil")
    archive = copy_store.root / durable["archive"]["key"]
    archive.write_bytes(buf.getvalue())
    durable["archive"]["sha256"] = durable_outputs._sha256(archive)
    durable["archive"]["count"] = 2
    merge_dataset_extra(dataset_id, {"durable": durable})

    shutil.rmtree(root)
    with pytest.raises(ValueError):
        restore_dataset(dataset_id, str(owner))
    assert not (root / "images").exists()
    assert not (root.parent / "escape.png").exists()
    shutil.rmtree(root, ignore_errors=True)


def test_local_passthrough_keeps_per_file_manifest(owner, tmp_path):
    set_artifact_store(LocalPassThroughStore())
    try:
        dataset_id, root, images = _make_dataset(owner, n=3)
        assert publish_dataset_dir(dataset_id, str(owner), root)[0]
        durable = _durable(dataset_id)
        assert "archive" not in durable
        assert {f["rel"] for f in durable["files"]} == {"summary.json", f"{dataset_id}.zip", *images}
        assert (root / f"{dataset_id}.zip").exists()
        shutil.rmtree(root)
    finally:
        set_artifact_store(None)
