"""Every architecture in the registry: measured size, serialization, the shared inference adapter,
the Analysis Lab (Grad-CAM per architecture) and the paper-bot heatmap."""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pytest

tf = pytest.importorskip("tensorflow")

from runners import cnn_architectures as ca  # noqa: E402
from runners import model_manifest as mm  # noqa: E402

BUILDERS = [a.id for a in ca.ARCHITECTURES.values() if a.family == "builder"]


@pytest.mark.parametrize("arch_id", BUILDERS)
def test_builder_sizes_match_the_registry(arch_id):
    arch = ca.ARCHITECTURES[arch_id]
    tf.keras.utils.clear_session()
    model = ca.build_model(arch_id, (224, 224))
    assert model.count_params() == arch.params_224
    assert round(ca.count_flops(model), 3) == pytest.approx(arch.gflops_224, abs=1e-3)
    assert model.output_shape == (None, 1)
    assert len(model.get_layer(arch.gradcam_layer).output.shape) == 4


def test_registry_keeps_every_profile_and_the_original_default():
    ids = set(ca.ARCHITECTURES)
    assert {"convolve-cnn-v1", "convolve-cnn-compact-v1", "convolve-cnn-balanced-v1", "convolve-cnn-deep-v1"} <= ids
    assert {"convolve-cnn-gap-v1", "convolve-resnet18-v1", "convolve-efficientnet-b0-v1"} <= ids
    assert ca.DEFAULT_ARCHITECTURE == "convolve-cnn-v1"
    catalog = {a["id"]: a for a in ca.public_catalog()}
    assert catalog["convolve-cnn-deep-v1"]["experimental"] is True
    assert catalog["convolve-efficientnet-b0-v1"]["supports_transfer"] is True
    with pytest.raises(ValueError):
        ca.check_input(ca.ARCHITECTURES["convolve-resnet18-v1"], (32, 32))


def test_dropout_and_l2_change_only_regularization():
    tf.keras.utils.clear_session()
    tf.keras.utils.set_random_seed(1)
    plain = ca.build_model("convolve-cnn-compact-v1", (64, 64))
    tf.keras.utils.clear_session()
    tf.keras.utils.set_random_seed(1)
    reg = ca.build_model("convolve-cnn-compact-v1", (64, 64), dropout=0.3, l2=1e-4)
    assert plain.count_params() == reg.count_params()
    assert [l.__class__.__name__ for l in reg.layers][-2] == "Dropout"
    assert any(getattr(l, "kernel_regularizer", None) is not None for l in reg.layers)


@pytest.fixture(scope="module")
def saved_models(tmp_path_factory):
    root = tmp_path_factory.mktemp("arch")
    out = {}
    for arch in ca.ARCHITECTURES.values():
        size = 224 if arch.id == "convolve-cnn-deep-v1" else 96
        tf.keras.utils.clear_session()
        tf.keras.utils.set_random_seed(3)
        model = ca.build_model(arch.id, (size, size))
        path = root / f"{arch.id}.keras"
        model.save(path)
        mm.embed(path, {"kind": mm.MANIFEST_KIND, "architecture": {"id": arch.id, "gradcam_layer": arch.gradcam_layer}})
        out[arch.id] = (path, size, model)
    return out


@pytest.fixture(scope="module")
def charts(tmp_path_factory):
    from PIL import Image

    root = tmp_path_factory.mktemp("charts")
    rng = np.random.default_rng(0)
    paths = []
    for i in range(4):
        arr = np.zeros((120, 120, 4), np.uint8)
        arr[..., :3] = (rng.random((120, 120, 3)) * 255).astype(np.uint8)
        arr[..., 3] = 255 if i % 2 else 0
        p = root / f"SYM_2020-01-0{i + 1}_to_2020-02-0{i + 1}_label{i % 2}.png"
        Image.fromarray(arr, mode="RGBA").save(p)
        paths.append(str(p))
    return paths


@pytest.mark.parametrize("arch_id", list(ca.ARCHITECTURES))
def test_saved_models_load_and_predict_identically_everywhere(arch_id, saved_models, charts):
    from app.services import cnn_inference
    from app.services.cnn_lab import core

    path, size, built = saved_models[arch_id]
    assert mm.read_embedded(path)["architecture"]["id"] == arch_id
    loaded = tf.keras.models.load_model(path, compile=False)
    for a, b in zip(built.get_weights(), loaded.get_weights()):
        assert np.array_equal(a, b)

    # Shared inference adapter (Backtester, Deploy, paper bots).
    probs = cnn_inference.predict_paths(loaded, charts, batch_size=3)
    assert probs.shape == (len(charts),) and np.all((probs >= 0) & (probs <= 1))
    x = np.stack([cnn_inference.preprocess_tensor(p, (size, size)).numpy() for p in charts])
    np.testing.assert_allclose(probs, loaded.predict(x, verbose=0)[:, 0], atol=1e-6)

    # Analysis Lab: same probabilities, Grad-CAM at the registry's layer.
    core.clear_model_cache()
    lm = core.get_model(str(path))
    lab_probs, pen = core.predict(lm, x)
    np.testing.assert_allclose(lab_probs[:, 1], probs, atol=1e-5)
    assert lm.last_conv == ca.ARCHITECTURES[arch_id].gradcam_layer or ca.ARCHITECTURES[arch_id].gradcam_layer is None
    cam, cam_probs = core.gradcam_batch(lm, x[:2], [1, 0], lm.last_conv)
    assert cam.ndim == 3 and np.all(np.isfinite(cam))
    sal = core.input_gradients(lm, x[:1], [1])
    assert sal.shape == x[:1].shape and np.any(sal != 0)


@pytest.mark.parametrize("arch_id", ["convolve-cnn-v1", "convolve-resnet18-v1", "convolve-efficientnet-b0-v1"])
def test_paper_bot_heatmap_works_for_each_family(arch_id, saved_models, charts, tmp_path):
    from app.bot_runner import generate_gradcam_heatmap

    path, _, _ = saved_models[arch_id]
    model = tf.keras.models.load_model(path, compile=False)
    out = tmp_path / "heat.png"
    generate_gradcam_heatmap(model, charts[0], 0, str(out))
    assert out.is_file() and out.stat().st_size > 0


def test_old_models_without_a_manifest_still_load_in_the_lab(saved_models, tmp_path):
    from app.services.cnn_lab import core

    path, size, built = saved_models["convolve-cnn-v1"]
    plain = tmp_path / "old.keras"
    built.save(plain)
    assert mm.read_embedded(plain) is None
    core.clear_model_cache()
    lm = core.get_model(str(plain))
    assert lm.mode == "chain" and lm.last_conv == [c["name"] for c in lm.conv_layers][-1]


@pytest.mark.skipif(
    not (Path(os.environ.get("KERAS_HOME", Path.home() / ".keras")) / "models" / "efficientnetb0_notop.h5").is_file(),
    reason="ImageNet weights not cached (downloaded on first pretrained run)",
)
def test_pretrained_efficientnet_freezes_and_fine_tunes():
    tf.keras.utils.clear_session()
    frozen = ca.build_model("convolve-efficientnet-b0-v1", (96, 96), transfer={"mode": "frozen"})
    trainable = sum(int(np.prod(w.shape)) for w in frozen.trainable_weights)
    assert trainable == 1281  # 1280 features + bias: only the new head learns
    tf.keras.utils.clear_session()
    tuned = ca.build_model("convolve-efficientnet-b0-v1", (96, 96), transfer={"mode": "fine_tune", "trainable_layers": 20})
    bn = [l for l in tuned.layers if isinstance(l, tf.keras.layers.BatchNormalization)]
    assert all(not l.trainable for l in bn)
    assert sum(int(np.prod(w.shape)) for w in tuned.trainable_weights) > trainable
    with pytest.raises(ValueError):
        ca.build_model("convolve-resnet18-v1", (96, 96), transfer={"mode": "frozen"})
