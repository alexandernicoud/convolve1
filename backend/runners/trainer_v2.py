"""Trainer 2.0 building blocks: optimizers, schedules, callbacks, augmentation, evaluation and
the model manifest. Used by runners/trainer_runner.py for protocol-2 runs only; protocol-1 runs
keep the original code path.
"""

from __future__ import annotations

import hashlib
import math
import platform
import sys
import time
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np
import tensorflow as tf

from runners import eval_metrics
from runners.trainer_options import SELECTION_METRICS

PREPROCESS_ID = "decode_png(rgb)|resize(area)|scale(1/255)|float32"
NOISE_SIGMA = 0.02
SHIFT_FRACTION = 0.03


# --- Optimizer and learning rate -------------------------------------------------


def learning_rate(opts: Dict[str, Any], steps_per_epoch: int, epochs: int):
    """A float (constant / reduce-on-plateau) or a per-step LearningRateSchedule."""
    base = float(opts["optimizer"]["learning_rate"])
    sched = opts["lr_schedule"]
    total = max(1, int(steps_per_epoch) * int(epochs))
    if sched["name"] == "cosine":
        return tf.keras.optimizers.schedules.CosineDecay(base, decay_steps=total, alpha=float(sched["alpha"]))
    if sched["name"] == "warmup_cosine":
        warm = min(total - 1, max(1, int(sched["warmup_epochs"]) * int(steps_per_epoch)))
        return tf.keras.optimizers.schedules.CosineDecay(
            0.0, decay_steps=max(1, total - warm), alpha=float(sched["alpha"]), warmup_target=base, warmup_steps=warm
        )
    return base


def build_optimizer(opts: Dict[str, Any], steps_per_epoch: int, epochs: int):
    o = opts["optimizer"]
    lr = learning_rate(opts, steps_per_epoch, epochs)
    extra = {"clipnorm": float(o["clipnorm"])} if o.get("clipnorm") else {}
    if o["name"] == "adamw":
        return tf.keras.optimizers.AdamW(learning_rate=lr, weight_decay=float(o["weight_decay"]), **extra)
    if o["name"] == "sgd":
        return tf.keras.optimizers.SGD(learning_rate=lr, momentum=float(o["momentum"]), nesterov=bool(o["nesterov"]), **extra)
    return tf.keras.optimizers.Adam(learning_rate=lr, **extra)


def compile_metrics() -> List[Any]:
    return [
        "accuracy",
        tf.keras.metrics.Recall(name="label_1_recall"),
        tf.keras.metrics.AUC(name="auc"),
        tf.keras.metrics.AUC(curve="PR", name="pr_auc"),
        tf.keras.metrics.TruePositives(name="tp"),
        tf.keras.metrics.TrueNegatives(name="tn"),
        tf.keras.metrics.FalsePositives(name="fp"),
        tf.keras.metrics.FalseNegatives(name="fn"),
    ]


def current_learning_rate(model) -> Optional[float]:
    try:
        return float(np.asarray(model.optimizer.learning_rate))
    except Exception:  # noqa: BLE001
        return None


def class_weights(labels: Sequence[int], mode: str) -> Optional[Dict[int, float]]:
    """'balanced': weight n / (2 * count) per class, so both classes contribute equally to the loss.
    Only the training loss changes; validation and test keep their natural distribution."""
    if mode != "balanced":
        return None
    arr = np.asarray(labels)
    n = len(arr)
    out = {}
    for cls in (0, 1):
        c = int(np.sum(arr == cls))
        out[cls] = n / (2.0 * c) if c else 0.0
    return out


# --- Callbacks ---------------------------------------------------------------------


class EpochScores(tf.keras.callbacks.Callback):
    """Adds balanced accuracy, precision, recall and F1 (from the confusion counts Keras just
    measured) and the learning rate to the epoch logs, before early stopping reads them."""

    def on_epoch_end(self, epoch, logs=None):
        if logs is None:
            return
        for prefix in ("", "val_"):
            for k, v in eval_metrics.epoch_scores(logs, prefix).items():
                if v is not None:
                    logs[k] = v
        lr = current_learning_rate(self.model)
        if lr is not None:
            logs["learning_rate"] = lr


class ResumableReduceLROnPlateau(tf.keras.callbacks.ReduceLROnPlateau):
    """ReduceLROnPlateau whose counters survive a restart (the learning rate itself is an
    optimizer variable and is restored with the checkpointed model)."""

    def __init__(self, *args, restore_state: Optional[Dict[str, Any]] = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._restore_state = restore_state

    def on_train_begin(self, logs=None):
        super().on_train_begin(logs)
        if self._restore_state:
            self.wait = int(self._restore_state.get("wait", 0))
            self.cooldown_counter = int(self._restore_state.get("cooldown_counter", 0))
            best = self._restore_state.get("best")
            if best is not None:
                self.best = float(best)

    def snapshot(self) -> Dict[str, Any]:
        best = float(self.best) if self.best is not None and np.isfinite(self.best) else None
        return {"wait": int(self.wait), "cooldown_counter": int(self.cooldown_counter), "best": best}


def monitor_mode(metric: str) -> str:
    return SELECTION_METRICS[metric]


def best_epoch(history: List[Dict[str, Any]], metric: str) -> Optional[int]:
    """1-based epoch with the best value of ``metric``; first occurrence wins (EarlyStopping's rule)."""
    mode = monitor_mode(metric)
    best, best_value = None, None
    for row in history:
        v = row.get(metric)
        if v is None:
            continue
        if best_value is None or (v < best_value if mode == "min" else v > best_value):
            best, best_value = int(row["epoch"]), v
    return best


# --- Augmentation --------------------------------------------------------------------


def augment_fn(names: Sequence[str]) -> Optional[Callable]:
    """Per-image augmentation from a stateless seed (two int64s). None when nothing is enabled."""
    names = list(names or [])
    if not names:
        return None

    def apply(image, label, seed):
        seed = tf.cast(seed, tf.int64)
        if "vertical_shift" in names:
            h = tf.shape(image)[0]
            max_px = tf.maximum(1, tf.cast(tf.round(tf.cast(h, tf.float32) * SHIFT_FRACTION), tf.int32))
            dy = tf.random.stateless_uniform([], seed=seed, minval=-max_px, maxval=max_px + 1, dtype=tf.int32)
            fill = image[0:1, 0:1, :]
            rolled = tf.roll(image, shift=dy, axis=0)
            rows = tf.range(h)
            vacated = tf.where(dy >= 0, rows < dy, rows >= h + dy)
            image = tf.where(vacated[:, None, None], fill, rolled)
        if "pixel_noise" in names:
            noise = tf.random.stateless_normal(tf.shape(image), seed=seed[::-1], stddev=NOISE_SIGMA)
            image = tf.clip_by_value(image + noise, 0.0, 1.0)
        return image, label

    return apply


def with_augmentation(ds: tf.data.Dataset, fn: Optional[Callable], seed: int) -> tf.data.Dataset:
    """Unbatched (image, label) dataset -> augmented, with fresh deterministic seeds every epoch."""
    if fn is None:
        return ds
    seeds = tf.data.Dataset.random(seed=int(seed), rerandomize_each_iteration=True).batch(2)
    return tf.data.Dataset.zip((ds, seeds)).map(
        lambda pair, s: fn(pair[0], pair[1], s), num_parallel_calls=tf.data.AUTOTUNE, deterministic=True
    )


# --- Evaluation ----------------------------------------------------------------------


def predict(model, ds: tf.data.Dataset) -> np.ndarray:
    forward = tf.function(lambda x: model(x, training=False), reduce_retracing=True)
    out = [np.asarray(forward(x), dtype=np.float64).reshape(len(x), -1) for x, _ in ds]
    if not out:
        return np.zeros((0,), dtype=np.float64)
    raw = np.concatenate(out)
    return raw[:, 1] if raw.shape[1] == 2 else raw[:, 0]


def evaluate(
    model,
    partitions: Dict[str, Tuple[tf.data.Dataset, List[int]]],
    train_label_counts: Dict[str, int],
) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for name, (ds, labels) in partitions.items():
        t0 = time.perf_counter()
        probs = predict(model, ds)
        out[name] = eval_metrics.binary_metrics(labels, probs, train_label_counts=train_label_counts)
        out[name]["seconds"] = round(time.perf_counter() - t0, 2)
    return out


KEY_METRICS = ("n", "accuracy", "balanced_accuracy", "precision", "recall", "f1", "roc_auc", "pr_auc", "log_loss", "brier")


def compact(metrics: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: metrics.get(k) for k in KEY_METRICS}
    base = metrics.get("baseline") or {}
    out["baseline_accuracy"] = base.get("accuracy")
    out["baseline_log_loss"] = base.get("log_loss")
    return out


# --- Reproducibility and manifest ----------------------------------------------------


def environment() -> Dict[str, Any]:
    import keras

    gpus = tf.config.list_physical_devices("GPU")
    return {
        "python": sys.version.split()[0],
        "tensorflow": tf.__version__,
        "keras": keras.__version__,
        "numpy": np.__version__,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "device": "GPU" if gpus else "CPU",
        "intra_op_threads": tf.config.threading.get_intra_op_parallelism_threads(),
        "inter_op_threads": tf.config.threading.get_inter_op_parallelism_threads(),
    }


def weights_digest(model) -> str:
    """sha256 over every weight array (dtype, shape, bytes) in model order. Independent of the
    file container, so it identifies the trained weights across downloads and re-uploads."""
    h = hashlib.sha256()
    for w in model.weights:
        arr = np.ascontiguousarray(np.asarray(w))
        h.update(f"{arr.dtype}{arr.shape}".encode())
        h.update(arr.tobytes())
    return h.hexdigest()


def steps_for(n: int, batch: int) -> int:
    return max(1, int(math.ceil(int(n) / int(batch))))
