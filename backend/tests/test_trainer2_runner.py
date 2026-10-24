"""Trainer 2.0 runs end to end: split, options, evaluation, manifests, reproducibility and resume."""

from __future__ import annotations

import gzip
import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pytest

tf = pytest.importorskip("tensorflow")


def _dataset(folder: Path, n: int = 48, size: int = 48) -> None:
    from PIL import Image

    folder.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(0)
    for i in range(n):
        label = int(rng.random() < 0.4)
        arr = np.full((size, size, 4), 0, dtype=np.uint8)
        arr[..., :3] = (rng.random((size, size, 3)) * 80).astype(np.uint8)
        arr[..., 3] = 255
        if label:
            arr[: size // 3, :, 1] = 200
        d = date(2021, 1, 1) + timedelta(days=i)
        Image.fromarray(arr, mode="RGBA").save(folder / f"SYM_{d.isoformat()}_to_{d.isoformat()}_label{label}.png")


def _config(data: Path, **over):
    return {
        "use_standard_config": False, "image_height": 48, "image_width": 48, "batch_size": 8, "epochs": 3,
        "val_split": 0.25, "random_seed": 5, "folder_name": str(data), "model_name": "m.keras",
        "architecture": "convolve-cnn-compact-v1", "trainer_protocol": 2, "label_horizon_bars": 2,
        "label_timeframe": "1d", **over,
    }


def _run(tmp_path, name, data, checkpoint=None, progress=None, **over):
    from runners.trainer_runner import run_trainer

    run_dir = tmp_path / name
    run_dir.mkdir(exist_ok=True)
    events = []

    def cb(phase, pct, d):
        events.append((phase, d))
        if progress:
            progress(phase, d)

    run_trainer(_config(data, **over), run_dir, cb, checkpoint=checkpoint)
    return run_dir, events


@pytest.fixture(scope="module")
def data(tmp_path_factory):
    folder = tmp_path_factory.mktemp("t2") / "images"
    _dataset(folder)
    return folder


def test_protocol_2_run_records_split_evaluation_and_lineage(tmp_path, data):
    run_dir, events = _run(
        tmp_path, "run", data, test_fraction=0.2, selection_metric="val_balanced_accuracy",
        optimizer={"name": "adamw", "learning_rate": 0.002}, lr_schedule={"name": "cosine"},
        class_weighting="balanced", augmentation=["vertical_shift"], regularization={"dropout": 0.2},
    )
    summary = json.loads((run_dir / "summary.json").read_text())
    assert summary["trainer_protocol"] == 2
    split = summary["training_setup"]["split"]
    assert split["method"] == "chronological" and split["label_purge"] == "applied"
    parts = split["partitions"]
    assert parts["train"]["decision_period"][1] < split["boundaries"]["val_start"] <= parts["val"]["decision_period"][0]
    assert parts["val"]["decision_period"][1] < split["boundaries"]["test_start"]
    # 2 daily bars = 7 calendar days: the 7 charts before each boundary are purged.
    assert split["excluded_by_reason"] == {"label_window_overlaps_val": 7, "label_window_overlaps_test": 7}

    # The test partition is reserved, never evaluated unless asked for.
    evaluation = json.loads((run_dir / "evaluation.json").read_text())
    assert evaluation["test"]["status"] == "reserved_not_evaluated"
    assert evaluation["test"]["n"] == parts["test"]["samples"]
    assert evaluation["validation"]["n"] == parts["val"]["samples"]
    assert set(evaluation["validation"]["baseline"]) >= {"accuracy", "majority_label", "log_loss"}

    # Best epoch is chosen on the selection metric (max of val_balanced_accuracy).
    history = json.loads((run_dir / "history.json").read_text())
    scores = [h.get("val_balanced_accuracy") for h in history]
    assert summary["stopping"]["monitor"] == "val_balanced_accuracy" and summary["stopping"]["mode"] == "max"
    finite = [s for s in scores if s is not None]
    if finite:
        assert scores[summary["best_epoch"] - 1] == max(finite)
    # Cosine decay: the learning rate falls every epoch from the base rate.
    lrs = [h["learning_rate"] for h in history]
    assert lrs == sorted(lrs, reverse=True) and lrs[0] < 0.002

    data_ready = next(d for p, d in events if d.get("train_samples") is not None)
    assert data_ready["test_samples"] == parts["test"]["samples"] and data_ready["trainer_protocol"] == 2
    state = json.loads((run_dir / "training_state.json").read_text())
    assert len(state["test_files"]) == parts["test"]["samples"]

    with gzip.open(run_dir / "split_manifest.json.gz", "rt") as f:
        manifest = json.load(f)
    assert len(manifest["ids"]["train"]) == parts["train"]["samples"]
    assert not set(manifest["ids"]["train"]) & set(manifest["ids"]["val"]) | set(manifest["ids"]["test"]) & set(manifest["ids"]["train"])

    from runners import model_manifest as mm

    embedded = mm.read_embedded(run_dir / "m.keras")
    sidecar = mm.read_sidecar(run_dir)
    assert embedded["run_id"] == run_dir.name and embedded["trainer_protocol"] == 2
    assert embedded["architecture"]["id"] == "convolve-cnn-compact-v1"
    assert embedded["input"]["preprocess"].startswith("decode_png")
    assert embedded["training"]["options"]["optimizer"]["name"] == "adamw"
    assert sidecar["model_file_sha256"] == mm.file_sha256(run_dir / "m.keras")
    model = tf.keras.models.load_model(run_dir / "m.keras")
    from runners.trainer_v2 import weights_digest

    assert weights_digest(model) == summary["reproducibility"]["weights_sha256"] == embedded["artifacts"]["weights_sha256"]
    assert summary["model"]["parameters"] == model.count_params()
    assert [l.__class__.__name__ for l in model.layers][-2:] == ["Dropout", "Dense"]


def test_test_partition_is_evaluated_only_when_requested(tmp_path, data):
    run_dir, _ = _run(tmp_path, "run", data, test_fraction=0.2, evaluate_test=True, epochs=1)
    evaluation = json.loads((run_dir / "evaluation.json").read_text())
    assert evaluation["test"]["n"] > 0 and "accuracy" in evaluation["test"]
    summary = json.loads((run_dir / "summary.json").read_text())
    assert summary["evaluation"]["test"]["n"] == evaluation["test"]["n"]


def test_repeated_runs_are_identical_and_seed_changes_them(tmp_path, data):
    common = dict(epochs=2, augmentation=["pixel_noise", "vertical_shift"], regularization={"dropout": 0.3})
    a, _ = _run(tmp_path, "a", data, **common)
    b, _ = _run(tmp_path, "b", data, **common)
    c, _ = _run(tmp_path, "c", data, random_seed=6, **common)
    sa, sb, sc = (json.loads((d / "summary.json").read_text()) for d in (a, b, c))
    assert sa["reproducibility"]["weights_sha256"] == sb["reproducibility"]["weights_sha256"]
    def measured(run_dir):
        return [{k: v for k, v in h.items() if k not in ("timestamp", "epoch_seconds")}
                for h in json.loads((run_dir / "history.json").read_text())]

    assert measured(a) == measured(b)
    assert sa["training_setup"]["split"]["manifest_sha256"] == sb["training_setup"]["split"]["manifest_sha256"]
    assert sa["reproducibility"]["weights_sha256"] != sc["reproducibility"]["weights_sha256"]
    # The chronological split does not depend on the seed.
    assert sa["training_setup"]["split"]["partitions"] == sc["training_setup"]["split"]["partitions"]


class _Crash(Exception):
    pass


@pytest.mark.parametrize(
    "schedule",
    [
        {"name": "reduce_on_plateau", "patience": 1, "factor": 0.5},
        {"name": "warmup_cosine", "warmup_epochs": 1},
    ],
)
def test_resume_restores_schedule_state_and_matches_an_uninterrupted_run(tmp_path, data, schedule):
    over = dict(epochs=4, input_pipeline="shards", lr_schedule=schedule, augmentation=["pixel_noise"],
                early_stopping={"enabled": False})
    full, _ = _run(tmp_path, "full", data, checkpoint={"dir": tmp_path / "ck_full", "run_id": "r", "user_id": "u"}, **over)

    def crash(phase, d):
        if phase == "training" and d.get("epoch") == 3:
            raise _Crash()

    ckpt = {"dir": tmp_path / "ck", "run_id": "r", "user_id": "u"}
    with pytest.raises(_Crash):
        _run(tmp_path, "crashed", data, checkpoint=ckpt, progress=crash, **over)
    state = json.loads((tmp_path / "ck" / "state.json").read_text())
    assert state["epochs_completed"] == 2
    if schedule["name"] == "reduce_on_plateau":
        assert set(state["callbacks"]["reduce_on_plateau"]) == {"wait", "cooldown_counter", "best"}

    resumed, events = _run(tmp_path, "crashed", data, checkpoint=ckpt, **over)
    assert any(d.get("resumed_from_epoch") == 2 for _, d in events)
    h_full = json.loads((full / "history.json").read_text())
    h_res = json.loads((resumed / "history.json").read_text())
    assert [h["epoch"] for h in h_full] == [h["epoch"] for h in h_res] == [1, 2, 3, 4]
    for x, y in zip(h_full, h_res):
        assert x["learning_rate"] == pytest.approx(y["learning_rate"], rel=1e-6)
        assert x["loss"] == pytest.approx(y["loss"], rel=1e-5, abs=1e-6)
        assert x["val_loss"] == pytest.approx(y["val_loss"], rel=1e-5, abs=1e-6)
    m_full = tf.keras.models.load_model(full / "m.keras")
    m_res = tf.keras.models.load_model(resumed / "m.keras")
    for x, y in zip(m_full.get_weights(), m_res.get_weights()):
        np.testing.assert_allclose(x, y, rtol=1e-5, atol=1e-6)


@pytest.mark.parametrize(
    "change",
    [{"optimizer": {"name": "adam", "learning_rate": 0.01}}, {"selection_metric": "val_auc"}, {"test_fraction": 0.2}],
)
def test_checkpoints_from_different_options_are_not_restored(tmp_path, data, change):
    over = dict(epochs=3, input_pipeline="shards")
    ckpt = {"dir": tmp_path / "ck", "run_id": "r", "user_id": "u"}

    def crash(phase, d):
        if phase == "training" and d.get("epoch") == 2:
            raise _Crash()

    with pytest.raises(_Crash):
        _run(tmp_path, "first", data, checkpoint=ckpt, progress=crash, **over)
    _, events = _run(tmp_path, "second", data, checkpoint=ckpt, **over, **change)
    assert not any("resumed_from_epoch" in d for _, d in events)


def test_legacy_protocol_keeps_the_original_behaviour(tmp_path, data):
    cfg_over = {"trainer_protocol": None, "label_horizon_bars": None, "label_timeframe": None, "epochs": 1}
    run_dir, _ = _run(tmp_path, "legacy", data, **cfg_over)
    summary = json.loads((run_dir / "summary.json").read_text())
    assert "trainer_protocol" not in summary and "evaluation" not in summary
    assert summary["training_setup"]["validation_method"] == "random"
    assert not (run_dir / "split_manifest.json.gz").exists()
    assert not (run_dir / "evaluation.json").exists()
    model = tf.keras.models.load_model(run_dir / "m.keras")
    assert model.optimizer.__class__.__name__ == "Adam"
    from runners.trainer_runner import V2_EPOCH_KEYS

    assert not set(json.loads((run_dir / "history.json").read_text())[0]) & set(V2_EPOCH_KEYS)


def test_augmentations_preserve_time_order_and_are_seeded():
    from runners.trainer_v2 import augment_fn

    img = np.zeros((40, 40, 3), np.float32)
    img[:, :20, 0] = 1.0  # left half (older bars) red
    seed = tf.constant([3, 4], tf.int64)
    fn = augment_fn(["vertical_shift", "pixel_noise"])
    a, _ = fn(tf.constant(img), 1, seed)
    b, _ = fn(tf.constant(img), 1, seed)
    assert np.array_equal(a.numpy(), b.numpy())
    a = a.numpy()
    # Still left-red / right-dark: no horizontal flip, crop or shift.
    assert a[:, :20, 0].mean() > 0.9 and a[:, 20:, 0].mean() < 0.1
    assert a.min() >= 0.0 and a.max() <= 1.0
    assert augment_fn([]) is None


def test_class_weights_balance_only_the_training_loss():
    from runners.trainer_v2 import class_weights

    assert class_weights([0, 0, 0, 1], "balanced") == {0: 4 / 6, 1: 2.0}
    assert class_weights([0, 1], "none") is None
