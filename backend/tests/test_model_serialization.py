"""Trained .keras files must load wherever models are used (API, bot runner, analysis).

Keras 3.14 cannot load models saved by 3.15 (GlorotUniform `input_axes`), so the
pinned versions must be installed everywhere. Fixtures use the unchanged trainer
architecture at a small input size, saved by each Keras version that has produced
models: 3.14.0 (before the pin) and 3.15.1 (production API and cloud worker).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "keras"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text())


def _pins() -> dict:
    pins = {}
    for line in (BACKEND / "requirements.txt").read_text().splitlines():
        match = re.match(r"^(tensorflow|keras)==([\w.]+)\s*$", line.strip())
        if match:
            pins[match.group(1)] = match.group(2)
    return pins


def test_requirements_pin_tensorflow_and_keras():
    assert set(_pins()) == {"tensorflow", "keras"}


def test_installed_versions_match_pins():
    import keras
    import tensorflow as tf

    pins = _pins()
    assert tf.__version__ == pins["tensorflow"]
    assert keras.__version__ == pins["keras"]


def test_pinned_keras_is_not_older_than_any_fixture():
    """A model saved by a newer Keras than the pin would not load in deployed images."""
    pinned = tuple(int(p) for p in _pins()["keras"].split("."))
    for meta in EXPECTED.values():
        assert tuple(int(p) for p in meta["keras"].split(".")) <= pinned


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_saved_model_loads_and_predicts_through_inference_path(name):
    import tensorflow as tf

    from app.bot_runner import run_model_inference

    meta = EXPECTED[name]
    model = tf.keras.models.load_model(FIXTURES / name)
    assert [layer.__class__.__name__ for layer in model.layers] == [
        "Conv2D", "MaxPooling2D", "Conv2D", "MaxPooling2D", "Conv2D", "MaxPooling2D", "Flatten", "Dense", "Dense",
    ]
    assert model.optimizer.__class__.__name__ == "Adam"
    confidence = run_model_inference(model, str(FIXTURES / "chart_label1.png"), meta["img_size"])
    assert confidence == pytest.approx(meta["confidence"], abs=1e-5)


def test_resave_with_pinned_keras_round_trips(tmp_path):
    import tensorflow as tf

    from app.bot_runner import run_model_inference

    name = sorted(EXPECTED)[0]
    model = tf.keras.models.load_model(FIXTURES / name)
    out = tmp_path / "resaved.keras"
    model.save(out)
    again = tf.keras.models.load_model(out)
    chart = str(FIXTURES / "chart_label1.png")
    size = EXPECTED[name]["img_size"]
    assert run_model_inference(again, chart, size) == pytest.approx(run_model_inference(model, chart, size), abs=1e-6)
