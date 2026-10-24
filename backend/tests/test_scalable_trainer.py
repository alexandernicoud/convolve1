"""Architecture profiles, sharded input, chronological validation and checkpoint resume."""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pytest

tf = pytest.importorskip("tensorflow")


def _write_dated_dataset(folder: Path, n: int = 24, window_days: int = 20, size: int = 32) -> None:
    """Daily windows, each window_days long, so neighbours overlap like generator output."""
    from PIL import Image

    folder.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(0)
    start = date(2020, 1, 1)
    for i in range(n):
        label = i % 2
        arr = (rng.random((size, size, 4)) * 255).astype("uint8")
        if label:
            arr[:, size // 2 :, :3] = 255
        a = start + timedelta(days=i)
        b = a + timedelta(days=window_days)
        Image.fromarray(arr, mode="RGBA").save(folder / f"SYM_{a.isoformat()}_to_{b.isoformat()}_label{label}.png")


def _config(data: Path, **over):
    return {
        "use_standard_config": False, "image_height": 64, "image_width": 64, "batch_size": 4,
        "epochs": 4, "val_split": 0.25, "random_seed": 3, "folder_name": str(data), "model_name": "m.keras", **over,
    }


def test_v1_profile_is_the_original_network():
    from runners import cnn_architectures as ca

    def original():
        return tf.keras.Sequential([
            tf.keras.layers.Input(shape=(224, 224, 3)),
            tf.keras.layers.Conv2D(32, (3, 3), activation="relu"), tf.keras.layers.MaxPooling2D(2, 2),
            tf.keras.layers.Conv2D(64, (3, 3), activation="relu"), tf.keras.layers.MaxPooling2D(2, 2),
            tf.keras.layers.Conv2D(128, (3, 3), activation="relu"), tf.keras.layers.MaxPooling2D(2, 2),
            tf.keras.layers.Flatten(), tf.keras.layers.Dense(128, activation="relu"),
            tf.keras.layers.Dense(1, activation="sigmoid"),
        ])

    tf.keras.utils.clear_session()
    tf.keras.utils.set_random_seed(7)
    a = original()
    tf.keras.utils.clear_session()
    tf.keras.utils.set_random_seed(7)
    b = ca.build_model(None, (224, 224))
    assert json.dumps(a.get_config(), sort_keys=True) == json.dumps(b.get_config(), sort_keys=True)
    assert all(np.array_equal(x, y) for x, y in zip(a.get_weights(), b.get_weights()))
    assert ca.DEFAULT_ARCHITECTURE == "convolve-cnn-v1"
    for arch in ca.ARCHITECTURES.values():
        tf.keras.utils.clear_session()
        model = ca.build_model(arch.id, (224, 224))
        assert model.count_params() == ca.complexity(arch, (224, 224))["parameters"]
        assert model.output_shape == (None, 1)
    with pytest.raises(ValueError):
        ca.resolve("not-a-model")


def test_shards_decode_to_the_same_pixels_as_the_png_folder(tmp_path):
    from runners import dataset_shards
    from runners.trainer_runner import build_image_dataset, scan_labeled_png_paths

    data = tmp_path / "images"
    _write_dated_dataset(data, n=10)
    paths, labels = scan_labeled_png_paths(str(data), None)
    manifest = dataset_shards.write_shards(paths, labels, str(tmp_path / "s"), shard_images=4)
    assert manifest["count"] == 10 and len(manifest["shards"]) == 3
    dataset_shards.verify_shards(str(tmp_path / "s"), manifest)
    files = [str(tmp_path / "s" / s["file"]) for s in manifest["shards"]]
    a = np.concatenate([x.numpy() for x, _ in build_image_dataset(paths, labels, (32, 32), 4, False, None)])
    b = np.concatenate([x.numpy() for x, _ in dataset_shards.shard_dataset(files, (32, 32), 4)])
    assert a.dtype == b.dtype == np.float32
    assert np.array_equal(a, b)

    # A corrupted shard is refused instead of silently training on different bytes.
    with open(files[0], "ab") as f:
        f.write(b"x")
    with pytest.raises(ValueError):
        dataset_shards.verify_shards(str(tmp_path / "s"), manifest)


def test_chronological_split_holds_out_the_latest_windows_and_purges_overlap(tmp_path):
    from runners.trainer_runner import chronological_split, scan_labeled_png_paths

    data = tmp_path / "images"
    _write_dated_dataset(data, n=40, window_days=10)
    paths, labels = scan_labeled_png_paths(str(data), None)
    tr, _, va, _, info = chronological_split(paths, labels, 0.25)
    assert len(va) == 10
    val_start = min(Path(p).name.split("_")[1] for p in va)
    assert all(Path(p).name.split("_to_")[1][:10] < val_start for p in tr)
    # Windows are 10 days long and start daily: the 10 windows before the validation block overlap it.
    assert info["purged_overlapping_train_samples"] == 10
    assert len(tr) == 20
    with pytest.raises(ValueError):
        chronological_split(["/x/undated_label1.png"], [1], 0.25)


def test_default_run_records_the_original_setup(tmp_path):
    from runners.trainer_runner import run_trainer

    data = tmp_path / "images"
    _write_dated_dataset(data, n=12, size=64)
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    run_trainer(_config(data, epochs=1), run_dir, lambda *a: None)
    setup = json.loads((run_dir / "summary.json").read_text())["training_setup"]
    assert setup["architecture"] == "convolve-cnn-v1"
    assert setup["validation_method"] == "random"
    assert setup["input_pipeline"] == "files"
    assert setup["precision"] == "float32"
    assert setup["resumed_from_epoch"] is None
    assert not (run_dir / "checkpoint").exists()


class _Crash(Exception):
    pass


def _train(tmp_path, name, *, crash_at_epoch=None, ckpt_dir=None, run_id="run_a", user_id="u1", **over):
    from runners.trainer_runner import run_trainer

    data = tmp_path / "images"
    if not data.exists():
        _write_dated_dataset(data, n=24, size=64)
    run_dir = tmp_path / name
    run_dir.mkdir(exist_ok=True)
    events = []

    def progress(phase, pct, d):
        events.append((phase, d))
        if crash_at_epoch and phase == "training" and d.get("epoch") == crash_at_epoch:
            raise _Crash()

    cfg = _config(data, input_pipeline="shards", deterministic_init=True, architecture="convolve-cnn-compact-v1", **over)
    ckpt = {"dir": ckpt_dir or (run_dir / "checkpoint"), "run_id": run_id, "user_id": user_id}
    run_trainer(cfg, run_dir, progress, checkpoint=ckpt)
    return run_dir, events


def test_resume_after_a_crash_matches_an_uninterrupted_run(tmp_path):
    full_dir, _ = _train(tmp_path, "full")

    ckpt = tmp_path / "shared_ckpt"
    with pytest.raises(_Crash):
        _train(tmp_path, "crashed", crash_at_epoch=3, ckpt_dir=ckpt)
    state = json.loads((ckpt / "state.json").read_text())
    assert state["epochs_completed"] == 2 and state["run_id"] == "run_a" and state["user_id"] == "u1"

    resumed_dir, events = _train(tmp_path, "crashed", ckpt_dir=ckpt)
    assert any(d.get("resumed_from_epoch") == 2 for _, d in events)

    full = json.loads((full_dir / "summary.json").read_text())
    resumed = json.loads((resumed_dir / "summary.json").read_text())
    assert resumed["training_setup"]["resumed_from_epoch"] == 2
    assert resumed["training_setup"]["resume_exact"] is True
    assert resumed["epochs_trained"] == full["epochs_trained"] == 4
    assert resumed["best_epoch"] == full["best_epoch"]
    for a, b in zip(json.loads((full_dir / "history.json").read_text()), json.loads((resumed_dir / "history.json").read_text())):
        assert a["epoch"] == b["epoch"]
        assert a["loss"] == pytest.approx(b["loss"], rel=1e-5, abs=1e-6)
        assert a["val_loss"] == pytest.approx(b["val_loss"], rel=1e-5, abs=1e-6)
    m_full = tf.keras.models.load_model(str(full_dir / "m.keras"))
    m_res = tf.keras.models.load_model(str(resumed_dir / "m.keras"))
    for x, y in zip(m_full.get_weights(), m_res.get_weights()):
        np.testing.assert_allclose(x, y, rtol=1e-5, atol=1e-6)
    assert not (resumed_dir / "shards").exists()


@pytest.mark.parametrize("change", [{"run_id": "run_b"}, {"user_id": "u2"}, {"batch_size": 2}])
def test_checkpoints_of_another_run_user_or_experiment_are_ignored(tmp_path, change):
    ckpt = tmp_path / "ckpt"
    with pytest.raises(_Crash):
        _train(tmp_path, "first", crash_at_epoch=2, ckpt_dir=ckpt)
    assert json.loads((ckpt / "state.json").read_text())["epochs_completed"] == 1
    kwargs = {k: v for k, v in change.items() if k in ("run_id", "user_id")}
    over = {k: v for k, v in change.items() if k not in ("run_id", "user_id")}
    run_dir, events = _train(tmp_path, "second", ckpt_dir=ckpt, **kwargs, **over)
    assert not any("resumed_from_epoch" in d for _, d in events)
    summary = json.loads((run_dir / "summary.json").read_text())
    assert summary["training_setup"]["resumed_from_epoch"] is None
