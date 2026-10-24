"""Trainer 2.0 through the API: options, protocol, split preview, session view, provenance
plumbing and model-upload lineage. Training itself is dispatched to a fake job queue."""

from __future__ import annotations

import io
import json
import uuid
import zipfile
from datetime import date, timedelta
from pathlib import Path

import pytest

from app.ownership import record_pipeline_run, record_user_dataset
from app.paths import dataset_dir_for, run_dir_for
from app.services import trainer_session
from runners import model_manifest as mm
from tests.test_trainer_jobs import _headers, _row, cleanup, dispatcher, store  # noqa: F401


def _dated_dataset(user_id, cleanup, n: int = 40, *, provenance: bool = False) -> str:
    from PIL import Image

    dataset_id = f"dset_t2_{uuid.uuid4().hex[:8]}"
    root = dataset_dir_for(dataset_id, str(user_id))
    (root / "images").mkdir(parents=True, exist_ok=True)
    records = []
    for i in range(n):
        d = date(2022, 1, 3) + timedelta(days=i)
        name = f"AAA_{(d - timedelta(days=5)).isoformat()}_to_{d.isoformat()}_label{i % 2}.png"
        Image.new("RGB", (32, 32), (i * 5 % 255, 40, 90)).save(root / "images" / name)
        records.append({"image_id": name, "symbol": "AAA", "decision_ts": d.isoformat(), "horizon_end_ts": d.isoformat()})
    if provenance:
        (root / "provenance").mkdir()
        (root / "provenance" / "samples.jsonl").write_text("".join(json.dumps(r) + "\n" for r in records))
    (root / "summary.json").write_text(json.dumps({"dataset_id": dataset_id, "total_images": n, "created_at": 1}))
    record_user_dataset(dataset_id, str(user_id), source="uploaded", kind="training", path=str(root))
    cleanup.append(root)
    return dataset_id


def _request(dataset_id: str, **over):
    return {
        "dataset_id": dataset_id, "model_name": "m.keras", "use_standard_config": False, "image_height": 64,
        "image_width": 64, "batch_size": 4, "epochs": 2, "val_split": 0.25, "random_seed": 7, **over,
    }


def test_catalog_exposes_the_option_schema(client, user_a):
    body = client.get("/trainer/architectures", headers=_headers(client, user_a)).json()
    assert body["options"]["protocol"] == 2
    assert "warmup_cosine" in body["options"]["lr_schedules"]
    assert {a["id"] for a in body["architectures"]} >= {"convolve-cnn-v1", "convolve-resnet18-v1"}


def test_new_runs_are_protocol_2_with_validated_options(client, user_a, store, dispatcher, cleanup):  # noqa: F811
    headers = _headers(client, user_a)
    dataset_id = _dated_dataset(user_a, cleanup, provenance=True)
    resp = client.post(
        "/trainer/runs",
        json=_request(dataset_id, optimizer={"name": "sgd", "learning_rate": 0.02}, selection_metric="val_auc",
                      test_fraction=0.2, label_horizon_bars=3, label_timeframe="1d"),
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    run_id = resp.json()["run_id"]
    cleanup.append(run_dir_for(run_id, str(user_a)))
    cfg = json.loads(_row(run_id).extra_json)["trainer_job"]["config"]
    assert cfg["trainer_protocol"] == 2
    assert cfg["optimizer"] == {"name": "sgd", "learning_rate": 0.02}
    assert cfg["label_horizon_bars"] == 3 and cfg["label_horizon_source"] == "user"
    assert cfg["selection_metric"] == "val_auc" and cfg["test_fraction"] == 0.2


@pytest.mark.parametrize(
    "over, status",
    [
        ({"augmentation": ["horizontal_flip"]}, 400),
        ({"selection_metric": "test_accuracy"}, 400),
        ({"optimizer": {"name": "adamw"}, "regularization": {"l2": 0.001}}, 400),
        ({"architecture": "convolve-resnet18-v1", "transfer": {"mode": "frozen"}}, 400),
        ({"architecture": "convolve-resnet18-v1", "image_height": 32, "image_width": 32}, 400),
        ({"trainer_protocol": 1}, "ignored"),
    ],
)
def test_invalid_options_are_refused_before_anything_is_charged(client, user_a, store, dispatcher, cleanup, over, status):  # noqa: F811
    headers = _headers(client, user_a)
    dataset_id = _dated_dataset(user_a, cleanup)
    resp = client.post("/trainer/runs", json=_request(dataset_id, **over), headers=headers)
    if status == "ignored":
        # The protocol is not a client setting: the server always records the current one.
        assert resp.status_code == 200, resp.text
        run_id = resp.json()["run_id"]
        cleanup.append(run_dir_for(run_id, str(user_a)))
        assert json.loads(_row(run_id).extra_json)["trainer_job"]["config"]["trainer_protocol"] == 2
        return
    assert resp.status_code == status, resp.text
    assert dispatcher.runs == []


def test_label_horizon_comes_from_the_generator_settings(client, user_a, store, dispatcher, cleanup, monkeypatch):  # noqa: F811
    import app.main as main

    headers = _headers(client, user_a)
    dataset_id = _dated_dataset(user_a, cleanup)
    monkeypatch.setattr(main, "_resolve_generator_run_id_for_dataset", lambda did, uid=None, **k: "gen123")
    monkeypatch.setattr(main, "_load_generator_config_from_disk", lambda gid: {"horizonBars": 7, "timeframe": "1wk"})
    resp = client.post("/trainer/runs", json=_request(dataset_id), headers=headers)
    assert resp.status_code == 200, resp.text
    cleanup.append(run_dir_for(resp.json()["run_id"], str(user_a)))
    cfg = json.loads(_row(resp.json()["run_id"]).extra_json)["trainer_job"]["config"]
    assert (cfg["label_horizon_bars"], cfg["label_timeframe"], cfg["label_horizon_source"]) == (7, "1wk", "generator_config")


def test_split_preview_matches_the_training_split_and_is_owner_only(client, user_a, user_b, cleanup):  # noqa: F811
    from runners import data_split

    dataset_id = _dated_dataset(user_a, cleanup, provenance=True)
    body = {"dataset_id": dataset_id, "val_split": 0.25, "test_fraction": 0.2, "label_horizon_bars": 2}
    resp = client.post("/trainer/split-preview", json=body, headers=_headers(client, user_a))
    assert resp.status_code == 200
    out = resp.json()
    assert out["ok"] is True and out["label_window"]["label_horizon_source"] == "user"
    plan = out["plan"]
    assert plan["method"] == "chronological" and plan["metadata_sources"] == {"provenance": 40}
    images = dataset_dir_for(dataset_id, str(user_a)) / "images"
    direct = data_split.plan_from_folder(str(images), horizon_bars=2, timeframe="1d", val_fraction=0.25, test_fraction=0.2)
    assert plan["partitions"] == direct.summary()["partitions"]

    too_much = client.post(
        "/trainer/split-preview", json={**body, "val_split": 0.05, "test_fraction": 0.02}, headers=_headers(client, user_a)
    ).json()
    assert too_much["ok"] is False and "validation" in too_much["error"]

    other = client.post("/trainer/split-preview", json=body, headers=_headers(client, user_b))
    assert other.status_code in (403, 404)


# ---------------------------------------------------------------- session view


def _write_run(tmp_path: Path, *, protocol: int) -> Path:
    run = tmp_path / "run"
    run.mkdir()
    history = [
        {"epoch": 1, "epochs": 3, "loss": 0.7, "val_loss": 0.69, "val_accuracy": 0.5, "val_auc": 0.52, "learning_rate": 0.001},
        {"epoch": 2, "epochs": 3, "loss": 0.6, "val_loss": 0.68, "val_accuracy": 0.55, "val_auc": 0.58, "learning_rate": 0.0005},
        {"epoch": 3, "epochs": 3, "loss": 0.5, "val_loss": 0.66, "val_accuracy": 0.52, "val_auc": 0.55, "learning_rate": 0.0},
    ]
    (run / "history.json").write_text(json.dumps(history))
    summary = {"config": {"model_name": "m.keras", "use_standard_config": True}, "val_samples": 10}
    if protocol == 2:
        summary["config"]["trainer_protocol"] = 2
        summary["trainer_protocol"] = 2
        summary["options"] = {"selection_metric": "val_auc", "optimizer": {"name": "adam", "learning_rate": 0.001},
                              "lr_schedule": {"name": "cosine"}, "early_stopping": {"patience": 5}}
        summary["stopping"] = {"reason": "max_epochs", "monitor": "val_auc", "mode": "max"}
        summary["model"] = {"architecture": "convolve-cnn-v1", "parameters": 123}
        (run / "evaluation.json").write_text(json.dumps({"validation": {"n": 10, "accuracy": 0.5}}))
    (run / "summary.json").write_text(json.dumps(summary))
    return run


def test_session_uses_the_runs_selection_metric_and_exposes_evaluation(tmp_path):
    run = _write_run(tmp_path, protocol=2)
    s = trainer_session.build_session("r", str(run), status="done", progress={})
    assert s["trainer_protocol"] == 2 and s["config"]["validation_method"] == "chronological"
    assert s["selection_metric"] == {"name": "val_auc", "mode": "max"}
    assert s["best_epoch"] == 2  # highest val_auc, although val_loss is lowest at epoch 3
    assert s["evaluation"]["validation"]["n"] == 10
    assert s["history"][2]["learning_rate"] == 0.0
    assert s["architecture"]["optimizer"]["name"] == "adam"


def test_legacy_sessions_read_as_protocol_1_random_split(tmp_path):
    run = _write_run(tmp_path, protocol=1)
    s = trainer_session.build_session("r", str(run), status="done", progress={})
    assert s["trainer_protocol"] == 1 and s["config"]["validation_method"] == "random"
    assert s["best_epoch"] == 3 and s["evaluation"] is None and s["options"] is None
    assert s["architecture"]["optimizer"] == "adam (Keras default learning rate)"


# ---------------------------------------------------------------- provenance plumbing


def test_generator_zip_carries_sample_times_for_kept_charts_and_ingest_places_them(tmp_path, user_a, cleanup):  # noqa: F811
    import app.main as main

    out = tmp_path / "gen"
    (out / "_provenance").mkdir(parents=True)
    rows = [{"image_id": f"A_2020-01-0{i}_to_2020-02-0{i}_label{i % 2}.png", "decision_ts": f"2020-02-0{i}"} for i in range(1, 5)]
    (out / "_provenance" / "samples.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    (out / "_provenance" / "provenance.json").write_text("{}")
    kept = {rows[0]["image_id"], rows[2]["image_id"]}
    members = main._training_sample_times(out, kept)
    lines = [json.loads(l) for l in members["provenance/samples.jsonl"].splitlines()]
    assert {l["image_id"] for l in lines} == kept

    from PIL import Image

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name in kept:
            img = io.BytesIO()
            Image.new("RGB", (8, 8)).save(img, format="PNG")
            z.writestr(name, img.getvalue())
        for member, payload in members.items():
            z.writestr(member, payload)
    staged = tmp_path / "upload.zip"
    staged.write_bytes(buf.getvalue())
    resp = main._ingest_dataset_zip(staged, None, "generator", None)
    root = Path(resp.extracted_path).parent
    cleanup.append(root)
    assert (root / "provenance" / "samples.jsonl").is_file()
    assert not (root / "images" / "provenance").exists()
    assert resp.summary["total_images"] == 2


def test_trainer_outputs_published_include_evaluation_and_manifests(tmp_path):
    from app.services.durable_outputs import _trainer_files

    for name in ("m.keras", "summary.json", "evaluation.json", "model_manifest.json", "split_manifest.json.gz", "training_state.json"):
        (tmp_path / name).write_bytes(b"{}")
    names = {p.name for p in _trainer_files(tmp_path)}
    assert {"evaluation.json", "model_manifest.json", "split_manifest.json.gz", "training_state.json"} <= names


# ---------------------------------------------------------------- uploaded model lineage


def _trained_run(user_id, cleanup):  # noqa: F811
    run_id = f"20260101_000000_{uuid.uuid4().hex[:6]}"
    record_pipeline_run(run_id, str(user_id), "trainer", status="succeeded")
    run_dir = run_dir_for(run_id, str(user_id))
    run_dir.mkdir(parents=True, exist_ok=True)
    cleanup.append(run_dir)
    model = run_dir / "m.keras"
    with zipfile.ZipFile(model, "w") as z:
        z.writestr("config.json", "{}")
    manifest = {"kind": mm.MANIFEST_KIND, "run_id": run_id, "model_name": "m.keras", "architecture": {"id": "convolve-cnn-v1"}}
    mm.embed(model, manifest)
    (run_dir / mm.SIDECAR).write_text(json.dumps({**manifest, "model_file_sha256": mm.file_sha256(model)}))
    (run_dir / "model_metadata.json").write_text(json.dumps({"model_name": "m.keras", "dataset_id": "d1"}))
    return run_id, model


def test_uploaded_model_lineage_is_verified_only_for_the_owner_and_exact_file(tmp_path, user_a, user_b, cleanup):  # noqa: F811
    from app.services.model_name_match import find_trainer_match_by_manifest

    run_id, model = _trained_run(user_a, cleanup)
    copy = tmp_path / "renamed-by-user.keras"
    copy.write_bytes(model.read_bytes())
    ok = find_trainer_match_by_manifest(str(copy), user_id=str(user_a))
    assert ok["manifest_verification"] == "verified" and ok["training_run_id"] == run_id and ok["dataset_id"] == "d1"

    assert find_trainer_match_by_manifest(str(copy), user_id=str(user_b))["manifest_verification"] == "claimed"
    with zipfile.ZipFile(copy, "a") as z:
        z.writestr("extra.bin", b"changed")
    claimed = find_trainer_match_by_manifest(str(copy), user_id=str(user_a))
    assert claimed["manifest_verification"] == "claimed" and "training_run_id" not in claimed

    plain = tmp_path / "plain.keras"
    with zipfile.ZipFile(plain, "w") as z:
        z.writestr("config.json", "{}")
    assert find_trainer_match_by_manifest(str(plain), user_id=str(user_a)) is None
