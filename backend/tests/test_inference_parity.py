"""The Backtester's model input equals the Trainer's (and the Analysis Lab's) for the same PNG."""

import numpy as np
import pytest
from PIL import Image

tf = pytest.importorskip("tensorflow")

from app.services import cnn_inference as ci  # noqa: E402
from app.services.cnn_lab import core as lab_core  # noqa: E402
from runners.trainer_runner import build_image_dataset  # noqa: E402


def _pngs(tmp_path, n=5):
    rng = np.random.default_rng(0)
    paths = []
    for i in range(n):
        h, w = (300 + 7 * i, 400 - 9 * i)
        arr = rng.integers(0, 256, size=(h, w, 4), dtype=np.uint8)  # RGBA, odd sizes
        p = tmp_path / f"S{i}_2025-01-01_to_2025-06-01_label{i % 2}.png"
        Image.fromarray(arr, mode="RGBA").save(p)
        paths.append(str(p))
    return paths


def test_backtester_input_equals_trainer_input(tmp_path):
    paths = _pngs(tmp_path)
    size = (96, 128)
    trainer = np.concatenate([x.numpy() for x, _ in build_image_dataset(paths, [0] * len(paths), size, 2, False, None)])
    bt = np.concatenate([b.numpy() for b in ci.build_inference_dataset(paths, size, batch_size=3)])
    assert bt.dtype == np.float32 and trainer.dtype == np.float32
    assert bt.shape == (len(paths), 96, 128, 3)
    np.testing.assert_array_equal(bt, trainer)


def test_backtester_input_equals_lab_input(tmp_path):
    paths = _pngs(tmp_path, 3)
    bt = np.concatenate([b.numpy() for b in ci.build_inference_dataset(paths, (64, 64))])
    lab = np.stack([lab_core.load_model_input(p, (64, 64)) for p in paths])
    np.testing.assert_array_equal(bt, lab)


def test_legacy_pil_preprocessing_differs(tmp_path):
    """Documents why v1 (PIL bilinear resize, float64) is not the training contract."""
    p = _pngs(tmp_path, 1)[0]
    legacy = np.array(Image.open(p).convert("RGB").resize((64, 64))) / 255.0
    contract = next(iter(ci.build_inference_dataset([p], (64, 64)))).numpy()[0]
    assert legacy.dtype == np.float64
    assert np.abs(legacy - contract).max() > 1e-3


def _model(units, act):
    import keras

    inp = keras.Input(shape=(32, 48, 3))
    x = keras.layers.Conv2D(2, 3)(inp)
    x = keras.layers.Flatten()(x)
    out = keras.layers.Dense(units, activation=act)(x)
    return keras.Model(inp, out)


@pytest.mark.parametrize("units,act,head", [(1, "sigmoid", "sigmoid"), (2, "softmax", "softmax2")])
def test_predictions_keep_order_and_use_model_input_size(tmp_path, units, act, head):
    keras = pytest.importorskip("keras")
    keras.utils.set_random_seed(3)
    m = _model(units, act)
    io = ci.model_io(m)
    assert io.input_size == (32, 48) and io.head == head
    paths = _pngs(tmp_path, 7)
    probs = ci.predict_paths(m, paths, batch_size=3)
    x = np.stack([lab_core.load_model_input(p, (32, 48)) for p in paths])
    ref = m.predict(x, verbose=0)
    ref = ref[:, 0] if units == 1 else ref[:, 1]
    np.testing.assert_allclose(probs, ref, rtol=1e-5, atol=1e-6)


@pytest.mark.parametrize("units,act", [(1, "sigmoid"), (2, "softmax")])
def test_graph_inference_is_bit_identical_to_eager(tmp_path, units, act):
    keras = pytest.importorskip("keras")
    keras.utils.set_random_seed(5)
    m = _model(units, act)
    io = ci.model_io(m)
    paths = _pngs(tmp_path, 7)  # batches of 3, 3, 1: the short last batch retraces
    probs = ci.predict_paths(m, paths, batch_size=3)
    eager = np.concatenate([ci.positive_probability(np.asarray(m(b, training=False)), io.head)
                            for b in ci.build_inference_dataset(paths, io.input_size, 3)])
    np.testing.assert_array_equal(probs, eager)


def test_unsupported_heads_are_rejected():
    with pytest.raises(ci.UnsupportedModelIO):
        ci.model_io(_model(3, "softmax"))
