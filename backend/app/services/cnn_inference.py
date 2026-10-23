"""
Shared inference contract for chart CNNs (Trainer ↔ Backtester ↔ Analysis Lab).

Preprocessing is identical to ``runners/trainer_runner.build_image_dataset``:

    tf.io.read_file -> tf.image.decode_png(channels=3)  (RGB, alpha dropped, HWC channel order)
    -> tf.image.resize(method=AREA) to the model's own (H, W)
    -> float32 / 255.0

Output interpretation: a 1-unit sigmoid head gives P(label 1) directly; a 2-unit softmax head gives
P(label 1) = column 1. Other heads are rejected rather than guessed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterator, List, Optional, Sequence, Tuple

import numpy as np

PREPROCESS_ID = "decode_png(rgb)|resize(area)|scale(1/255)|float32"
INFERENCE_CONTRACT_VERSION = 1


def _tf():
    import tensorflow as tf

    return tf


def preprocess_tensor(path: Any, size: Tuple[int, int]):
    """tf graph op: one PNG path -> float32 (H, W, 3) in [0, 1]."""
    tf = _tf()
    raw = tf.io.read_file(path)
    image = tf.image.decode_png(raw, channels=3)
    image = tf.image.resize(image, [int(size[0]), int(size[1])], method=tf.image.ResizeMethod.AREA)
    return tf.cast(image, tf.float32) / 255.0


@dataclass(frozen=True)
class ModelIO:
    input_size: Tuple[int, int]
    channels: int
    head: str  # "sigmoid" | "softmax2"

    def as_dict(self) -> dict:
        return {
            "input_size": list(self.input_size),
            "channels": self.channels,
            "head": self.head,
            "preprocess": PREPROCESS_ID,
            "contract_version": INFERENCE_CONTRACT_VERSION,
        }


class UnsupportedModelIO(ValueError):
    pass


def model_io(model: Any) -> ModelIO:
    """Input size and output head from the model's own Keras specification."""
    shape = model.input_shape
    if isinstance(shape, list):
        raise UnsupportedModelIO("Models with multiple inputs are not supported")
    if len(shape) != 4 or shape[1] is None or shape[2] is None:
        raise UnsupportedModelIO(f"Expected a fixed-size image input (None, H, W, C), got {shape}")
    if shape[-1] != 3:
        raise UnsupportedModelIO(f"Expected 3 input channels (RGB), got {shape[-1]}")
    out = model.output_shape
    if isinstance(out, list):
        raise UnsupportedModelIO("Models with multiple outputs are not supported")
    units = out[-1]
    if units == 1:
        head = "sigmoid"
    elif units == 2:
        head = "softmax2"
    else:
        raise UnsupportedModelIO(f"Expected 1 (sigmoid) or 2 (softmax) output units, got {units}")
    return ModelIO(input_size=(int(shape[1]), int(shape[2])), channels=3, head=head)


def positive_probability(raw: np.ndarray, head: str) -> np.ndarray:
    raw = np.asarray(raw, dtype=np.float64)
    if head == "sigmoid":
        return raw.reshape(-1)
    if head == "softmax2":
        return raw[:, 1]
    raise UnsupportedModelIO(head)


def build_inference_dataset(paths: Sequence[str], size: Tuple[int, int], batch_size: int = 32):
    """Ordered (no shuffle), streaming, batched tf.data pipeline of model inputs."""
    tf = _tf()
    ds = tf.data.Dataset.from_tensor_slices(np.asarray(list(paths), dtype=str))
    ds = ds.map(lambda p: preprocess_tensor(p, size), num_parallel_calls=tf.data.AUTOTUNE, deterministic=True)
    return ds.batch(int(batch_size), drop_remainder=False).prefetch(tf.data.AUTOTUNE)


def iter_predictions(
    model: Any, paths: Sequence[str], batch_size: int = 32, io: Optional[ModelIO] = None
) -> Iterator[Tuple[int, np.ndarray]]:
    """Yield (n_done, P(label 1) for this batch) in input order."""
    io = io or model_io(model)
    done = 0
    for batch in build_inference_dataset(paths, io.input_size, batch_size):
        raw = model(batch, training=False)
        probs = positive_probability(np.asarray(raw), io.head)
        done += len(probs)
        yield done, probs


def predict_paths(model: Any, paths: Sequence[str], batch_size: int = 32) -> np.ndarray:
    out: List[np.ndarray] = [p for _, p in iter_predictions(model, paths, batch_size)]
    return np.concatenate(out) if out else np.zeros((0,), dtype=np.float64)
