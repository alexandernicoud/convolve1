import gzip
import hashlib
import os
import re
import shutil
import sys
import time
import json
import resource
from pathlib import Path
from typing import Callable, Dict, Any, Optional, List, Tuple, Union

_import_t0 = time.perf_counter()
import numpy as np
import tensorflow as tf

TF_IMPORT_SECONDS = time.perf_counter() - _import_t0


class CancelledError(Exception):
    pass


# In-epoch progress interval. Each report is one database write in the Cloud Run job.
BATCH_REPORT_SECONDS = 5.0


def peak_rss_mb() -> float:
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(rss / (1024 * 1024 if sys.platform == "darwin" else 1024), 1)


def cpu_seconds() -> float:
    usage = resource.getrusage(resource.RUSAGE_SELF)
    return usage.ru_utime + usage.ru_stime


class StageTimings:
    """Wall seconds per training stage, plus process CPU time and peak RSS. Written to timings.json."""

    def __init__(self) -> None:
        self.started_at = time.time()
        self._t0 = time.perf_counter()
        self._cpu0 = cpu_seconds()
        self.stages: Dict[str, float] = {"tf_import_seconds": round(TF_IMPORT_SECONDS, 3)}
        self.epochs: List[Dict[str, Any]] = []

    def add(self, name: str, seconds: float) -> None:
        self.stages[name] = round(self.stages.get(name, 0.0) + seconds, 3)

    def as_dict(self) -> Dict[str, Any]:
        wall = time.perf_counter() - self._t0
        cpu = cpu_seconds() - self._cpu0
        full = [e for e in self.epochs if not e.get("partial")]
        train = [e["train_seconds"] for e in full if e.get("train_seconds") is not None]
        later = train[1:] if len(train) > 1 else train
        return {
            "timings_version": 1,
            "started_at": self.started_at,
            "stages": dict(self.stages),
            "epochs": self.epochs,
            "epoch_seconds_median": round(float(np.median([e["seconds"] for e in full])), 3) if full else None,
            "train_images_per_second": (
                round(self.stages["train_samples"] / float(np.median(later)), 1)
                if later and self.stages.get("train_samples")
                else None
            ),
            "total_wall_seconds": round(wall, 3),
            "cpu_seconds": round(cpu, 1),
            "cpu_utilization": round(cpu / wall, 2) if wall > 0 else None,
            "cpu_count": os.cpu_count(),
            "intra_op_threads": tf.config.threading.get_intra_op_parallelism_threads(),
            "inter_op_threads": tf.config.threading.get_inter_op_parallelism_threads(),
            "peak_rss_mb": peak_rss_mb(),
        }


# --- Helpers: scan + tf.data -------------------------------------------------


def scan_labeled_png_paths(
    folder_name: str,
    cancel_event: Optional[Any],
) -> Tuple[List[str], List[int]]:
    """Collect absolute file paths and labels from filenames (same rules as before)."""
    if not os.path.exists(folder_name):
        raise FileNotFoundError(f"Folder {folder_name} does not exist")

    paths: List[str] = []
    labels: List[int] = []

    for file in os.listdir(folder_name):
        if cancel_event is not None and cancel_event.is_set():
            raise CancelledError("Training cancelled by user")
        if not file.endswith(".png") or "label" not in file:
            continue
        label = int(file.split("label")[1][0])
        paths.append(os.path.abspath(os.path.join(folder_name, file)))
        labels.append(label)

    if not paths:
        raise ValueError(f"No labeled PNG images found in {folder_name}")

    print(f"✅ Scan found {len(paths)} labeled PNG files.")
    return paths, labels


def _decoded_element_bytes(height: int, width: int) -> int:
    return height * width * 3 * 4


def _maybe_memory_cache(ds: tf.data.Dataset, n: int, img_size: Tuple[int, int]) -> tf.data.Dataset:
    """
    Cache decoded+resized tensors in RAM only when total size is below a safe budget.
    Avoids OOM on large folders; larger jobs still benefit from parallel I/O + prefetch.
    """
    if n == 0:
        return ds
    est = n * _decoded_element_bytes(img_size[0], img_size[1])
    max_bytes = 280 * 1024 * 1024  # ~280 MiB cap for decoded cache
    if est <= max_bytes:
        return ds.cache()
    return ds


def build_image_dataset(
    paths: Union[List[str], np.ndarray],
    labels: Union[List[int], np.ndarray],
    img_size: Tuple[int, int],
    batch_size: int,
    shuffle: bool,
    shuffle_seed: Optional[int],
    augment: Optional[Callable] = None,
    cache_before_shuffle: bool = False,
) -> tf.data.Dataset:
    """Decode PNG in TensorFlow, resize, normalize [0,1]; optional RAM cache; optional
    augmentation (after the cache, so every epoch draws new variations); batch + prefetch.

    The original order (shuffle, decode, cache) caches the first epoch's shuffled order, so small
    cached datasets see that same order every epoch. cache_before_shuffle (protocol 2) shuffles
    paths only when the data is too large to cache, and otherwise caches decoded images first and
    reshuffles them every epoch."""
    path_arr = np.asarray(paths, dtype=str)
    label_arr = np.asarray(labels, dtype=np.int32)
    n = int(path_arr.shape[0])

    ds = tf.data.Dataset.from_tensor_slices((path_arr, label_arr))
    buf = max(min(n, 10_000), 2)
    cached = cache_before_shuffle and n and n * _decoded_element_bytes(img_size[0], img_size[1]) <= 280 * 1024 * 1024

    if shuffle and not cached:
        ds = ds.shuffle(buffer_size=buf, seed=shuffle_seed, reshuffle_each_iteration=True)

    h, w = int(img_size[0]), int(img_size[1])

    def load_image(path, label):
        raw = tf.io.read_file(path)
        # RGB only (drops alpha if present)
        image = tf.image.decode_png(raw, channels=3)
        image = tf.image.resize(image, [h, w], method=tf.image.ResizeMethod.AREA)
        image = tf.cast(image, tf.float32) / 255.0
        label_f = tf.cast(label, tf.float32)
        return image, label_f

    if cache_before_shuffle:
        ds = ds.map(load_image, num_parallel_calls=tf.data.AUTOTUNE, deterministic=True)
        if cached:
            ds = ds.cache()
            if shuffle:
                ds = ds.shuffle(buffer_size=buf, seed=shuffle_seed, reshuffle_each_iteration=True)
    else:
        ds = ds.map(load_image, num_parallel_calls=tf.data.AUTOTUNE)
        ds = _maybe_memory_cache(ds, int(path_arr.shape[0]), img_size)
    if augment is not None:
        from runners.trainer_v2 import with_augmentation

        ds = with_augmentation(ds, augment, int(shuffle_seed or 0))

    # Larger batch_size often improves GPU throughput; batch_size still comes from trainer config.
    ds = ds.batch(batch_size, drop_remainder=False)
    ds = ds.prefetch(tf.data.AUTOTUNE)
    return ds


_CHART_NAME = re.compile(r"_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})_label\d")

VALIDATION_METHODS = ("random", "chronological")
# Extra per-epoch values recorded for protocol-2 runs (train and validation).
V2_EPOCH_KEYS = (
    "auc",
    "pr_auc",
    "balanced_accuracy",
    "val_auc",
    "val_pr_auc",
    "val_balanced_accuracy",
    "val_precision",
    "val_recall",
    "val_f1",
    "learning_rate",
)
INPUT_PIPELINES = ("files", "shards")
PRECISIONS = ("float32", "mixed_float16", "mixed_bfloat16")
# Records held by the shard shuffle buffer (~2.7 KB each as encoded PNG): a full shuffle up to
# this many training images, a bounded-memory approximate shuffle beyond it.
SHARD_SHUFFLE_MAX = 200_000


def chart_window(path: str) -> Optional[Tuple[str, str]]:
    """(start, end) ISO dates from a generator file name, e.g. MSFT_2006-06-06_to_2006-12-06_label1.png."""
    m = _CHART_NAME.search(os.path.basename(path))
    return (m.group(1), m.group(2)) if m else None


def chronological_split(
    paths: List[str], labels: List[int], val_split: float, embargo_days: int = 0
) -> Tuple[List[str], List[int], List[str], List[int], Dict[str, Any]]:
    """Validation = the most recent windows; training = earlier windows that end before the first
    validation window starts (minus embargo_days). Overlapping windows are dropped from training,
    because a chart that shares candles with a validation chart leaks its future into training."""
    windows = [chart_window(p) for p in paths]
    if any(w is None for w in windows):
        raise ValueError(
            "Chronological validation needs dated chart names (SYMBOL_YYYY-MM-DD_to_YYYY-MM-DD_labelN.png)"
        )
    order = sorted(range(len(paths)), key=lambda i: (windows[i][1], windows[i][0], os.path.basename(paths[i])))
    split_index = int(len(order) * (1 - val_split))
    train_idx, val_idx = order[:split_index], order[split_index:]
    if not val_idx:
        raise ValueError("Chronological validation left no validation samples")
    first_val_start = min(windows[i][0] for i in val_idx)
    cutoff = first_val_start
    if embargo_days:
        cutoff = (np.datetime64(first_val_start) - np.timedelta64(int(embargo_days), "D")).astype(str)
    kept = [i for i in train_idx if windows[i][1] < cutoff]
    info = {
        "validation_method": "chronological",
        "train_period": [windows[kept[0]][0], windows[kept[-1]][1]] if kept else None,
        "val_period": [first_val_start, max(windows[i][1] for i in val_idx)],
        "purged_overlapping_train_samples": len(train_idx) - len(kept),
        "embargo_days": int(embargo_days),
    }
    return (
        [paths[i] for i in kept],
        [labels[i] for i in kept],
        [paths[i] for i in val_idx],
        [labels[i] for i in val_idx],
        info,
    )


def _metric_or_none(logs: Dict[str, Any], key: str) -> Optional[float]:
    """Keras omits keys it did not compute (e.g. val_* without a validation split); keep that as null, never 0."""
    value = logs.get(key)
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if np.isfinite(out) else None


def best_val_loss_epoch(history: List[Dict[str, Any]]) -> Optional[int]:
    """1-based epoch with the lowest val_loss; first occurrence wins, matching Keras EarlyStopping (strict <)."""
    best_epoch: Optional[int] = None
    best_value = float("inf")
    for row in history:
        value = row.get("val_loss")
        if value is None:
            continue
        if value < best_value:
            best_value = value
            best_epoch = int(row["epoch"])
    return best_epoch


def build_training_summary(
    *,
    history: List[Dict[str, Any]],
    model_name: str,
    config: Dict[str, Any],
    train_samples: int,
    val_samples: int,
    image_size: Tuple[int, int],
    batch_size: int,
    epochs_configured: int,
    early_stop: Any = None,
    monitor: str = "val_loss",
) -> Dict[str, Any]:
    """summary.json. Keras 3 EarlyStopping(restore_best_weights=True) restores the best weights
    (by ``monitor``) at train end whether or not it stopped early, so the saved model is the best epoch."""
    if monitor == "val_loss":
        best_epoch = best_val_loss_epoch(history)
    else:
        from runners.trainer_v2 import best_epoch as best_by

        best_epoch = best_by(history, monitor)
    stopped_epoch = int(getattr(early_stop, "stopped_epoch", 0) or 0) if early_stop is not None else 0
    restored = bool(
        early_stop is not None
        and getattr(early_stop, "restore_best_weights", False)
        and getattr(early_stop, "best_weights", None) is not None
    )
    if restored:
        keras_best = getattr(early_stop, "best_epoch", None)
        if keras_best is not None:
            best_epoch = int(keras_best) + 1
    last_epoch = int(history[-1]["epoch"]) if history else 0
    saved_epoch = best_epoch if (restored and best_epoch) else (last_epoch or None)
    by_epoch = {int(row["epoch"]): row for row in history}
    return {
        "model_name": model_name,
        "config": config,
        "train_samples": train_samples,
        "val_samples": val_samples,
        "image_size": list(image_size),
        "batch_size": batch_size,
        "epochs_configured": epochs_configured,
        "epochs_trained": len(history),
        "stopped_early": stopped_epoch > 0,
        "best_epoch": best_epoch,
        "best_epoch_monitor": monitor if best_epoch is not None else None,
        "best_metrics": by_epoch.get(best_epoch) if best_epoch else None,
        "saved_weights_epoch": saved_epoch,
        "saved_weights_metrics": by_epoch.get(saved_epoch) if saved_epoch else None,
        # Last epoch logged; kept for older readers. The saved model is saved_weights_epoch.
        "final_metrics": history[-1] if history else None,
        "summary_version": 2,
        "completed_at": time.time(),
    }


def _setup_options(config: Dict[str, Any], img_size: Tuple[int, int], opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Opt-in training options. Absent keys mean the original behaviour (protocol 1)."""
    from runners import trainer_options
    from runners.cnn_architectures import check_input, resolve

    opts = opts or trainer_options.resolve(config)
    # Fails with a clear message when the image is too small for the architecture.
    check_input(resolve(config.get("architecture")), img_size)

    validation_method = str(opts["validation_method"])
    input_pipeline = str(config.get("input_pipeline") or "files")
    precision = str(config.get("precision") or "float32")
    if validation_method not in VALIDATION_METHODS:
        raise ValueError(f"validation_method must be one of {', '.join(VALIDATION_METHODS)}")
    if input_pipeline not in INPUT_PIPELINES:
        raise ValueError(f"input_pipeline must be one of {', '.join(INPUT_PIPELINES)}")
    if precision not in PRECISIONS:
        raise ValueError(f"precision must be one of {', '.join(PRECISIONS)}")
    gpus = tf.config.list_physical_devices("GPU")
    # TensorFlow uses TF32 (10-bit mantissa) for float32 convs/matmuls on Ampere+ GPUs such as the
    # L4 by default. Keep true float32 unless reduced precision was asked for explicitly.
    tf32 = bool(gpus) and precision != "float32"
    tf.config.experimental.enable_tensor_float_32_execution(tf32)
    return {
        "architecture": resolve(config.get("architecture")).id,
        "tf32": tf32,
        "validation_method": validation_method,
        "embargo_days": int(config.get("embargo_days") or 0),
        "input_pipeline": input_pipeline,
        # Reduced precision only pays off on GPU tensor cores; on CPU it is slower, so it is ignored.
        "precision": precision if gpus else "float32",
        "precision_requested": precision,
        "jit_compile": bool(config.get("jit_compile", False)),
        "deterministic_init": bool(config.get("deterministic_init", False)) or opts["protocol"] >= 2,
        "device": "GPU" if gpus else "CPU",
        "gpus": [g.name for g in gpus],
        "protocol": opts["protocol"],
    }


def run_trainer(
    config: Dict[str, Any],
    run_dir: Path,
    progress_cb: Callable,
    cancel_event: Optional[Any] = None,
    checkpoint: Optional[Dict[str, Any]] = None,
):
    """Run CNN training with provided configuration.

    checkpoint (optional): {"dir", "run_id", "user_id", "on_saved"} enables epoch checkpoints and
    resuming from a compatible one in "dir".
    """

    use_standard = config.get("use_standard_config", True)
    if use_standard:
        IMG_SIZE = (224, 224)
        BATCH_SIZE = 16
        EPOCHS = 30
        VAL_SPLIT = 0.2
        RANDOM_SEED = 7
    else:
        IMG_SIZE = (config["image_height"], config["image_width"])
        BATCH_SIZE = config["batch_size"]
        EPOCHS = config["epochs"]
        VAL_SPLIT = config["val_split"]
        RANDOM_SEED = config.get("random_seed", 7)

    folder_name = config["folder_name"]
    model_name = config["model_name"]

    model_path = run_dir / model_name
    metrics_file = run_dir / "metrics.jsonl"
    summary_file = run_dir / "summary.json"
    history_file = run_dir / "history.json"

    progress_cb("starting", 0, {"message": "Initializing training..."})

    timings = StageTimings()
    timings_file = run_dir / "timings.json"

    def write_timings() -> Dict[str, Any]:
        data = timings.as_dict()
        try:
            timings_file.write_text(json.dumps(data, indent=2))
        except OSError:
            pass
        return data

    restore_policy = False
    try:
        t0 = time.perf_counter()
        progress_cb("loading", 5, {"message": "Scanning dataset folder..."})

        from runners import trainer_options

        opts = trainer_options.resolve(config)
        v2 = opts["protocol"] >= 2
        setup = _setup_options(config, IMG_SIZE, opts)
        split_extra: Dict[str, Any] = {}
        test_paths: List[str] = []
        test_labels: List[int] = []
        plan = None
        if v2:
            from runners import data_split

            # Python, NumPy and TensorFlow seeds (initial weights, dropout, shuffling, augmentation).
            tf.keras.utils.set_random_seed(RANDOM_SEED)
            if opts["deterministic_ops"]:
                tf.config.experimental.enable_op_determinism()
            try:
                plan = data_split.plan_from_folder(
                    folder_name,
                    horizon_bars=opts["label_horizon_bars"],
                    timeframe=opts["label_timeframe"],
                    cancel=cancel_event,
                    method=opts["validation_method"],
                    val_fraction=VAL_SPLIT,
                    test_fraction=opts["test_fraction"],
                    seed=RANDOM_SEED,
                    purge_chart_windows=opts["purge_chart_windows"],
                    embargo_bars=opts["embargo_bars"],
                )
            except InterruptedError as exc:
                raise CancelledError(str(exc)) from exc
            root = os.path.abspath(folder_name)
            train_paths = [os.path.join(root, i) for i in plan.ids("train")]
            val_paths = [os.path.join(root, i) for i in plan.ids("val")]
            test_paths = [os.path.join(root, i) for i in plan.ids("test")]
            train_labels, val_labels, test_labels = plan.labels("train"), plan.labels("val"), plan.labels("test")
            split_extra["split"] = plan.summary()
            with gzip.open(run_dir / "split_manifest.json.gz", "wt", encoding="utf-8") as f:
                json.dump(plan.manifest(), f)
            t_scan = time.perf_counter()
            timings.add("scan_seconds", t_scan - t0)
        else:
            all_paths, all_labels = scan_labeled_png_paths(folder_name, cancel_event)
            t_scan = time.perf_counter()
            timings.add("scan_seconds", t_scan - t0)

        if v2:
            pass
        elif setup["validation_method"] == "chronological":
            train_paths, train_labels, val_paths, val_labels, split_extra = chronological_split(
                all_paths, all_labels, VAL_SPLIT, setup["embargo_days"]
            )
        else:
            np.random.seed(RANDOM_SEED)
            indices = np.arange(len(all_paths))
            np.random.shuffle(indices)
            paths = [all_paths[i] for i in indices]
            labels = [all_labels[i] for i in indices]

            split_index = int(len(paths) * (1 - VAL_SPLIT))
            train_paths, val_paths = paths[:split_index], paths[split_index:]
            train_labels, val_labels = labels[:split_index], labels[split_index:]

        train_samples = len(train_paths)
        val_samples = len(val_paths)

        if train_samples == 0:
            raise ValueError("No training samples after train/validation split.")

        if not v2:
            tf.random.set_seed(RANDOM_SEED)

        # Checkpoint identity: everything that changes what an epoch computes.
        fp = None
        resume_state: Optional[Dict[str, Any]] = None
        if checkpoint:
            from runners import trainer_checkpoint as tc

            spec = {
                **{k: setup[k] for k in ("architecture", "validation_method", "embargo_days", "input_pipeline", "precision", "jit_compile")},
                "image_size": list(IMG_SIZE),
                "batch_size": BATCH_SIZE,
                "epochs": EPOCHS,
                "val_split": VAL_SPLIT,
                "random_seed": RANDOM_SEED,
            }
            if v2:
                spec["options"] = opts
                spec["test_ids_sha256"] = (split_extra["split"]["partitions"].get("test") or {}).get("ids_sha256")
            fp = tc.fingerprint(
                spec, [os.path.basename(p) for p in train_paths], [os.path.basename(p) for p in val_paths]
            )
            resume_state = tc.compatible_state(
                Path(checkpoint["dir"]), run_id=checkpoint["run_id"], user_id=checkpoint.get("user_id"), fp=fp
            )
        initial_epoch = int(resume_state["epochs_completed"]) if resume_state else 0

        progress_cb("loading", 10, {"message": "Building tf.data input pipelines..."})
        t_before_ds = time.perf_counter()

        steps_per_epoch = None
        augment = None
        if v2:
            from runners import trainer_v2 as tv2

            augment = tv2.augment_fn(opts["augmentation"])
        if setup["input_pipeline"] == "shards":
            from runners import dataset_shards

            shard_dir = run_dir / "shards"
            per_shard = max(256, min(dataset_shards.DEFAULT_SHARD_IMAGES, (train_samples + 7) // 8))
            train_manifest = _ensure_shards(dataset_shards, shard_dir, "train", train_paths, train_labels, per_shard)
            val_manifest = (
                _ensure_shards(dataset_shards, shard_dir, "val", val_paths, val_labels, per_shard) if val_paths else None
            )
            train_files = [str(shard_dir / s["file"]) for s in train_manifest["shards"]]
            shuffle_buffer = min(train_samples, SHARD_SHUFFLE_MAX)
            steps_per_epoch = (train_samples + BATCH_SIZE - 1) // BATCH_SIZE
            train_ds = dataset_shards.epoch_indexed_shard_dataset(
                train_files,
                IMG_SIZE,
                BATCH_SIZE,
                shuffle_buffer=shuffle_buffer,
                seed=RANDOM_SEED,
                initial_epoch=initial_epoch,
                epochs=EPOCHS,
                augment=augment,
            )
            val_ds = (
                dataset_shards.shard_dataset(
                    [str(shard_dir / s["file"]) for s in val_manifest["shards"]], IMG_SIZE, BATCH_SIZE
                )
                if val_manifest
                else None
            )
            split_extra["shard_shuffle_buffer"] = shuffle_buffer
            split_extra["full_shuffle"] = shuffle_buffer >= train_samples
        else:
            train_ds = build_image_dataset(
                train_paths,
                train_labels,
                IMG_SIZE,
                BATCH_SIZE,
                shuffle=True,
                shuffle_seed=RANDOM_SEED,
                augment=augment,
                cache_before_shuffle=v2,
            )
            val_ds = build_image_dataset(
                val_paths,
                val_labels,
                IMG_SIZE,
                BATCH_SIZE,
                shuffle=False,
                shuffle_seed=None,
                cache_before_shuffle=v2,
            )
        t_ds = time.perf_counter()
        timings.add("split_seconds", t_before_ds - t_scan)
        timings.add("pipeline_build_seconds", t_ds - t_before_ds)
        timings.stages["train_samples"] = train_samples
        timings.stages["val_samples"] = val_samples

        print(
            f"[trainer] timings: scan+split={t_scan - t0:.2f}s, "
            f"dataset_build={t_ds - t_before_ds:.2f}s, "
            f"train={train_samples} val={val_samples} batch={BATCH_SIZE}"
        )

        split_info = {
            "train_samples": train_samples,
            "val_samples": val_samples,
            "image_size": list(IMG_SIZE),
            "batch_size": BATCH_SIZE,
            "epochs": EPOCHS,
            "val_split": VAL_SPLIT,
            "random_seed": RANDOM_SEED,
            "train_label_counts": {str(k): int(v) for k, v in zip(*np.unique(train_labels, return_counts=True))},
            "val_label_counts": {str(k): int(v) for k, v in zip(*np.unique(val_labels, return_counts=True))}
            if val_labels
            else {},
            **split_extra,
        }
        if v2:
            split_info["trainer_protocol"] = opts["protocol"]
            split_info["validation_method"] = opts["validation_method"]
            if test_paths:
                split_info["test_samples"] = len(test_paths)
                split_info["test_label_counts"] = {
                    str(k): int(v) for k, v in zip(*np.unique(test_labels, return_counts=True))
                }
        try:
            with open(run_dir / "training_state.json", "w") as f:
                # Basenames of held-out images: os.listdir order is filesystem-dependent, so the
                # split cannot be reliably reconstructed later from the seed alone.
                json.dump(
                    {
                        **split_info,
                        "data_ready_at": time.time(),
                        "val_files": sorted(os.path.basename(p) for p in val_paths),
                        **({"test_files": sorted(os.path.basename(p) for p in test_paths)} if test_paths else {}),
                    },
                    f,
                    indent=2,
                )
        except OSError:
            pass

        progress_cb(
            "loading",
            15,
            {
                "message": f"Data ready: {train_samples} train, {val_samples} validation samples (tf.data)",
                **split_info,
            },
        )

        progress_cb("building", 20, {"message": "Building CNN model..."})
        t_build = time.perf_counter()

        from runners.cnn_architectures import build_model

        if setup["precision"] != "float32":
            tf.keras.mixed_precision.set_global_policy(setup["precision"])
            restore_policy = True
        if setup["deterministic_init"]:
            tf.keras.utils.set_random_seed(RANDOM_SEED)

        steps_for_schedule = steps_per_epoch or max(1, (train_samples + BATCH_SIZE - 1) // BATCH_SIZE)
        compile_kwargs: Dict[str, Any] = {"jit_compile": True} if setup["jit_compile"] else {}
        if resume_state:
            # Weights, optimizer moments and iteration count exactly as saved after the last epoch.
            model = tf.keras.models.load_model(str(Path(checkpoint["dir"]) / resume_state["model_file"]))
        elif v2:
            model = build_model(
                setup["architecture"],
                IMG_SIZE,
                dropout=opts["regularization"]["dropout"],
                l2=opts["regularization"]["l2"],
                transfer=opts["transfer"],
            )
            model.compile(
                optimizer=tv2.build_optimizer(opts, steps_for_schedule, EPOCHS),
                loss="binary_crossentropy",
                metrics=tv2.compile_metrics(),
                **compile_kwargs,
            )
        else:
            model = build_model(setup["architecture"], IMG_SIZE)

            # Recall on the positive class (label 1) — standard read for binary chart models
            model.compile(
                optimizer="adam",
                loss="binary_crossentropy",
                metrics=[
                    "accuracy",
                    tf.keras.metrics.Recall(name="label_1_recall"),
                ],
                **compile_kwargs,
            )

        timings.add("model_build_seconds", time.perf_counter() - t_build)
        print(f"[trainer] model build wall time: {time.perf_counter() - t_build:.2f}s")

        monitor = opts["selection_metric"] if v2 else "val_loss"
        es_kwargs: Dict[str, Any] = {"monitor": monitor, "patience": 5, "restore_best_weights": True}
        if v2:
            es = opts["early_stopping"]
            es_kwargs.update(
                mode=tv2.monitor_mode(monitor),
                min_delta=es["min_delta"],
                # Disabled early stopping still restores the best epoch by the selection metric.
                patience=es["patience"] if es["enabled"] else EPOCHS + 1,
            )
        if checkpoint:
            early_stop = tc.ResumableEarlyStopping(
                **es_kwargs,
                restore_state=(resume_state or {}).get("early_stopping"),
                restore_best_weights_list=tc.load_best_weights(Path(checkpoint["dir"]), resume_state)
                if resume_state
                else None,
            )
        else:
            early_stop = tf.keras.callbacks.EarlyStopping(**es_kwargs)
        plateau = None
        if v2 and opts["lr_schedule"]["name"] == "reduce_on_plateau":
            s = opts["lr_schedule"]
            plateau = tv2.ResumableReduceLROnPlateau(
                monitor=monitor,
                mode=tv2.monitor_mode(monitor),
                factor=s["factor"],
                patience=s["patience"],
                min_lr=s["min_learning_rate"],
                verbose=0,
                restore_state=((resume_state or {}).get("callbacks") or {}).get("reduce_on_plateau"),
            )

        class ProgressCallback(tf.keras.callbacks.Callback):
            def __init__(self, progress_cb_inner, metrics_file_inner, cancel_event_inner):
                super().__init__()
                self.progress_cb = progress_cb_inner
                self.metrics_file = metrics_file_inner
                self.cancel_event = cancel_event_inner
                self.history_data = []

            def on_train_begin(self, logs=None):
                self.progress_cb("training", 25, {"message": "Starting training..."})
                self._fit_t0 = time.perf_counter()
                self._first_batch_t0: Optional[float] = None
                self._last_batch_report = self._fit_t0

            def on_epoch_begin(self, epoch, logs=None):
                self._epoch_t0 = time.perf_counter()
                self._val_seconds = 0.0

            def on_train_batch_begin(self, batch, logs=None):
                if len(timings.epochs) == initial_epoch and batch == 0 and self._first_batch_t0 is None:
                    self._first_batch_t0 = time.perf_counter()

            def on_train_batch_end(self, batch, logs=None):
                # Stop within one batch of a cancel, not at the end of a ~1 minute epoch.
                if self.cancel_event is not None and self.cancel_event.is_set():
                    self.model.stop_training = True
                now = time.perf_counter()
                first = self._first_batch_t0 is not None and "first_batch_seconds" not in timings.stages
                if first:
                    # Includes tf.function tracing and graph build, which only the first step pays.
                    timings.add("first_batch_seconds", now - self._first_batch_t0)
                    timings.add("fit_start_to_first_batch_end_seconds", now - self._fit_t0)
                if first or now - self._last_batch_report >= BATCH_REPORT_SECONDS:
                    self._last_batch_report = now
                    self._report_batch(batch, now)

            def _report_batch(self, batch, now):
                """Measured position inside the current epoch; the epoch's metrics come at its end."""
                epoch = len(timings.epochs) + 1
                epochs = int(self.params["epochs"])
                steps = self.params.get("steps")
                done = batch + 1
                images = min(done * BATCH_SIZE, train_samples)
                epoch_elapsed = now - self._epoch_t0
                data = {
                    "message": f"Epoch {epoch}/{epochs}" + (f" · batch {done}/{steps}" if steps else f" · batch {done}"),
                    "epoch_in_progress": epoch,
                    "epochs": epochs,
                    "batch": done,
                    "batches": steps,
                    "images_per_second": round(images / epoch_elapsed, 1) if epoch_elapsed > 0 else None,
                    "elapsed_seconds": round(now - self._fit_t0, 1),
                }
                fraction = (epoch - 1 + (done / steps if steps else 0.0)) / epochs
                self.progress_cb("training", 25 + int(fraction * 70), data)

            def on_test_begin(self, logs=None):
                self._val_t0 = time.perf_counter()
                steps = self.params.get("steps")
                epoch = len(timings.epochs) + 1
                epochs = int(self.params["epochs"])
                # Reporting only: the next batch or epoch report replaces this one.
                self.progress_cb(
                    "training",
                    25 + int(epoch / epochs * 70),
                    {
                        "message": f"Epoch {epoch}/{epochs} · scoring the validation images",
                        "epoch_in_progress": epoch,
                        "epochs": epochs,
                        "batch": steps,
                        "batches": steps,
                        "validating": True,
                        "elapsed_seconds": round(time.perf_counter() - self._fit_t0, 1),
                    },
                )

            def on_test_end(self, logs=None):
                if hasattr(self, "_val_t0"):
                    self._val_seconds += time.perf_counter() - self._val_t0

            def on_epoch_end(self, epoch, logs=None):
                cancelled = self.cancel_event is not None and self.cancel_event.is_set()
                epoch_seconds = time.perf_counter() - getattr(self, "_epoch_t0", time.perf_counter())
                timings.epochs.append(
                    {
                        "epoch": epoch + 1,
                        "seconds": round(epoch_seconds, 3),
                        "train_seconds": round(epoch_seconds - self._val_seconds, 3),
                        "val_seconds": round(self._val_seconds, 3),
                        **({"partial": True} if cancelled else {}),
                    }
                )
                # A cancel can stop an epoch part-way; its metrics are not a real epoch.
                if logs and not cancelled:
                    logs = dict(logs)
                    epoch_data = {
                        "epoch": epoch + 1,
                        "epochs": self.params["epochs"],
                        "loss": _metric_or_none(logs, "loss"),
                        "accuracy": _metric_or_none(logs, "accuracy"),
                        "val_loss": _metric_or_none(logs, "val_loss"),
                        "val_accuracy": _metric_or_none(logs, "val_accuracy"),
                        "label_1_recall": _metric_or_none(logs, "label_1_recall"),
                        "val_label_1_recall": _metric_or_none(logs, "val_label_1_recall"),
                        # Binary classifier: accuracy on true label-1 samples equals positive-class recall.
                        "val_label_1_accuracy": _metric_or_none(logs, "val_label_1_recall"),
                        "timestamp": time.time(),
                    }
                    if v2:
                        for key in V2_EPOCH_KEYS:
                            epoch_data[key] = _metric_or_none(logs, key)
                        epoch_data["epoch_seconds"] = round(epoch_seconds, 3)

                    with open(self.metrics_file, "a") as f:
                        f.write(json.dumps(epoch_data) + "\n")

                    self.history_data.append(epoch_data)

                    progress_pct = 25 + int((epoch + 1) / self.params["epochs"] * 70)

                    self.progress_cb(
                        "training",
                        progress_pct,
                        {
                            "message": f"Epoch {epoch + 1}/{self.params['epochs']}",
                            "epoch": epoch + 1,
                            "epochs": self.params["epochs"],
                            "loss": epoch_data["loss"],
                            "accuracy": epoch_data["accuracy"],
                            "val_loss": epoch_data["val_loss"],
                            "val_accuracy": epoch_data["val_accuracy"],
                            "val_label_1_recall": epoch_data.get("val_label_1_recall"),
                            "label_1_recall": epoch_data.get("label_1_recall"),
                            "timestamp": epoch_data["timestamp"],
                            "epoch_seconds": round(epoch_seconds, 2),
                            "elapsed_seconds": round(time.perf_counter() - self._fit_t0, 1),
                            **({k: epoch_data.get(k) for k in V2_EPOCH_KEYS} if v2 else {}),
                        },
                    )
                if cancelled:
                    self.model.stop_training = True
                    self.progress_cb("cancelled", 0, {"message": "Training cancelled"})

            def on_train_end(self, logs=None):
                if self.cancel_event is not None and self.cancel_event.is_set():
                    self.progress_cb("cancelled", 0, {"message": "Training cancelled"})
                    return
                if hasattr(self, "_fit_t0"):
                    print(f"[trainer] model.fit wall time: {time.perf_counter() - self._fit_t0:.2f}s")
                self.progress_cb("saving", 95, {"message": "Training completed, saving model..."})

                with open(history_file, "w") as f:
                    json.dump(self.history_data, f, indent=2)

        progress_callback = ProgressCallback(progress_cb, metrics_file, cancel_event)
        # Order matters: scores are added to the logs before the plateau schedule and early
        # stopping read them; the checkpoint runs last so it saves their updated counters.
        callbacks: List[Any] = [early_stop, progress_callback]
        if v2:
            callbacks = [tv2.EpochScores()] + ([plateau] if plateau is not None else []) + callbacks
        if resume_state:
            progress_callback.history_data = list(resume_state.get("history") or [])
            timings.epochs = list(resume_state.get("epoch_timings") or [])
            with open(metrics_file, "w") as f:
                for row in progress_callback.history_data:
                    f.write(json.dumps(row) + "\n")
            progress_cb(
                "loading",
                18,
                {
                    "message": f"Resuming from the checkpoint after epoch {initial_epoch}",
                    "resumed_from_epoch": initial_epoch,
                },
            )
        checkpoint_cb = None
        if checkpoint:
            checkpoint_cb = tc.EpochCheckpoint(
                Path(checkpoint["dir"]),
                run_id=checkpoint["run_id"],
                user_id=checkpoint.get("user_id"),
                fp=fp,
                early_stop=early_stop,
                history=lambda: list(progress_callback.history_data),
                epoch_timings=lambda: list(timings.epochs),
                is_cancelled=lambda: cancel_event is not None and cancel_event.is_set(),
                on_saved=checkpoint.get("on_saved"),
                callback_states=(lambda: {"reduce_on_plateau": plateau.snapshot()}) if plateau is not None else None,
            )
            callbacks.append(checkpoint_cb)

        t_fit = time.perf_counter()
        fit_kwargs: Dict[str, Any] = {}
        if steps_per_epoch is not None:
            fit_kwargs["steps_per_epoch"] = steps_per_epoch
        if initial_epoch:
            fit_kwargs["initial_epoch"] = initial_epoch
        weights = tv2.class_weights(train_labels, opts["class_weighting"]) if v2 else None
        if weights:
            fit_kwargs["class_weight"] = weights
        model.fit(
            train_ds,
            epochs=EPOCHS,
            validation_data=val_ds,
            callbacks=callbacks,
            verbose=0,
            **fit_kwargs,
        )
        timings.add("fit_seconds", time.perf_counter() - t_fit)
        if checkpoint_cb is not None:
            timings.add("checkpoint_seconds", checkpoint_cb.save_seconds)
        print(f"[trainer] model.fit ended (wall): {time.perf_counter() - t_fit:.2f}s")

        if cancel_event is not None and cancel_event.is_set():
            raise CancelledError("Training cancelled by user")

        evaluation = None
        if v2:
            progress_cb("saving", 93, {"message": "Evaluating the selected model on the validation set..."})
            train_counts = split_info["train_label_counts"]
            parts = {
                "validation": (
                    build_image_dataset(val_paths, val_labels, IMG_SIZE, BATCH_SIZE, shuffle=False, shuffle_seed=None),
                    val_labels,
                )
            }
            if opts["evaluate_test"] and test_paths:
                parts["test"] = (
                    build_image_dataset(test_paths, test_labels, IMG_SIZE, BATCH_SIZE, shuffle=False, shuffle_seed=None),
                    test_labels,
                )
            t_eval = time.perf_counter()
            evaluation = tv2.evaluate(model, parts, train_counts)
            timings.add("evaluation_seconds", time.perf_counter() - t_eval)
            if test_paths and "test" not in evaluation:
                evaluation["test"] = {"status": "reserved_not_evaluated", "n": len(test_paths)}
            elif "test" in evaluation:
                evaluation["test"]["status"] = "evaluated_once_at_end"
            evaluation["threshold_note"] = (
                "Classification metrics use a fixed 0.5 probability threshold; no threshold was tuned on any partition."
            )
            evaluation["selection_metric"] = monitor
            with open(run_dir / "evaluation.json", "w") as f:
                json.dump(evaluation, f, indent=2)

        t_save = time.perf_counter()
        model.save(str(model_path))
        timings.add("model_save_seconds", time.perf_counter() - t_save)
        try:
            timings.stages["model_file_mb"] = round(model_path.stat().st_size / 1e6, 1)
        except OSError:
            pass
        print(f"✅ Model saved as {model_path}")

        summary_data = build_training_summary(
            history=progress_callback.history_data,
            model_name=model_name,
            config=config,
            train_samples=train_samples,
            val_samples=val_samples,
            image_size=IMG_SIZE,
            batch_size=BATCH_SIZE,
            epochs_configured=EPOCHS,
            early_stop=early_stop,
            monitor=monitor,
        )
        summary_data["training_setup"] = {
            **setup,
            **split_extra,
            "resumed_from_epoch": initial_epoch or None,
            # Only the shard pipeline replays the exact batch order of an uninterrupted run.
            "resume_exact": bool(initial_epoch) and setup["input_pipeline"] == "shards",
        }
        if v2:
            summary_data["trainer_protocol"] = opts["protocol"]
            summary_data["options"] = opts
            summary_data["test_samples"] = len(test_paths)
            summary_data["evaluation"] = {
                name: (tv2.compact(m) if "accuracy" in m else {"status": m.get("status"), "n": m.get("n")})
                for name, m in evaluation.items()
                if isinstance(m, dict)
            }
            stopped = summary_data["stopped_early"]
            summary_data["stopping"] = {
                "reason": "early_stopping" if stopped else "max_epochs",
                "detail": (
                    f"No improvement of {monitor} by more than {opts['early_stopping']['min_delta']} for "
                    f"{opts['early_stopping']['patience']} epochs"
                    if stopped
                    else f"Reached the configured {EPOCHS} epochs"
                ),
                "monitor": monitor,
                "mode": tv2.monitor_mode(monitor),
                "early_stopping_enabled": opts["early_stopping"]["enabled"],
            }
            from runners.cnn_architectures import count_flops, layer_summary, resolve

            arch = resolve(setup["architecture"])
            trainable = int(sum(int(np.prod(w.shape)) for w in model.trainable_weights))
            summary_data["model"] = {
                "architecture": arch.id,
                "family": arch.family,
                "parameters": int(model.count_params()),
                "trainable_parameters": trainable,
                "forward_gflops": round(count_flops(model), 3),
                "layers": layer_summary(model) if len(model.layers) <= 80 else None,
                "layer_count": len(model.layers),
                "gradcam_layer": arch.gradcam_layer,
            }
            if opts["transfer"]["mode"] != "scratch":
                from runners.cnn_architectures import IMAGENET_WEIGHTS

                summary_data["model"]["pretrained_weights"] = {**IMAGENET_WEIGHTS[arch.id], **opts["transfer"]}
            summary_data["reproducibility"] = {
                "random_seed": RANDOM_SEED,
                "seeded": ["python", "numpy", "tensorflow (keras.utils.set_random_seed)"],
                "op_determinism": opts["deterministic_ops"],
                "sample_order": "sorted by file name (filesystem independent)",
                "split_manifest": "split_manifest.json.gz",
                "environment": tv2.environment(),
                "weights_sha256": tv2.weights_digest(model),
            }
            manifest = _model_manifest(
                run_dir, config, summary_data, opts, setup, split_extra.get("split") or {}, IMG_SIZE, BATCH_SIZE
            )
            from runners import model_manifest as mm

            with open(run_dir / mm.SIDECAR, "w") as f:
                json.dump(manifest, f, indent=2, default=str)
            mm.embed(model_path, manifest)
            manifest["model_file_sha256"] = mm.file_sha256(model_path)
            with open(run_dir / mm.SIDECAR, "w") as f:
                json.dump(manifest, f, indent=2, default=str)

        with open(summary_file, "w") as f:
            json.dump(summary_data, f, indent=2)
        # Derived from the dataset; the finished model no longer needs them.
        shutil.rmtree(run_dir / "shards", ignore_errors=True)

        timing_data = write_timings()
        progress_cb(
            "done",
            100,
            {
                "message": "Training completed successfully!",
                "model_path": str(model_path),
                "summary": summary_data,
                "timings": timing_data,
            },
        )

    except CancelledError:
        write_timings()
        progress_cb("cancelled", 0, {"message": "Training cancelled"})
        raise
    except Exception as e:
        write_timings()
        error_msg = f"Training failed: {str(e)}"
        print(f"❌ {error_msg}")
        progress_cb(
            "error",
            0,
            {
                "message": error_msg,
                "error": str(e),
                "error_type": type(e).__name__,
            },
        )
        raise
    finally:
        # The in-process API trains in a shared process: later models must not inherit the policy.
        if restore_policy:
            tf.keras.mixed_precision.set_global_policy("float32")


def _model_manifest(
    run_dir: Path,
    config: Dict[str, Any],
    summary: Dict[str, Any],
    opts: Dict[str, Any],
    setup: Dict[str, Any],
    split: Dict[str, Any],
    img_size: Tuple[int, int],
    batch_size: int,
) -> Dict[str, Any]:
    """Lineage and contract of the trained model (runners/model_manifest.py)."""
    from runners import model_manifest as mm
    from runners.cnn_architectures import OUTPUT_CONTRACT
    from runners.trainer_v2 import PREPROCESS_ID

    model = summary.get("model") or {}
    repro = summary.get("reproducibility") or {}
    split_light = {k: v for k, v in split.items() if k not in ("settings",)}
    return {
        "kind": mm.MANIFEST_KIND,
        "manifest_version": mm.MANIFEST_VERSION,
        "created_at": time.time(),
        "run_id": run_dir.name,
        "model_name": summary.get("model_name"),
        "trainer_protocol": opts["protocol"],
        "architecture": {
            "id": model.get("architecture"),
            "family": model.get("family"),
            "parameters": model.get("parameters"),
            "trainable_parameters": model.get("trainable_parameters"),
            "forward_gflops": model.get("forward_gflops"),
            "gradcam_layer": model.get("gradcam_layer"),
        },
        "input": {"height": int(img_size[0]), "width": int(img_size[1]), "channels": 3, "preprocess": PREPROCESS_ID},
        "output": {"contract": OUTPUT_CONTRACT, "head": "sigmoid", "positive_label": 1, "threshold": 0.5},
        "dataset": {
            "dataset_id": config.get("dataset_id"),
            "generator_run_id": config.get("generator_run_id"),
            "manifest_sha256": split.get("manifest_sha256"),
            "label_horizon_bars": opts.get("label_horizon_bars"),
            "label_timeframe": opts.get("label_timeframe"),
            "metadata_sources": split.get("metadata_sources"),
        },
        "split": {**split_light, "settings": split.get("settings")},
        "training": {
            "image_size": list(img_size),
            "batch_size": batch_size,
            "epochs_configured": summary.get("epochs_configured"),
            "epochs_trained": summary.get("epochs_trained"),
            "best_epoch": summary.get("best_epoch"),
            "stopping": summary.get("stopping"),
            "options": opts,
            "random_seed": repro.get("random_seed"),
            "input_pipeline": setup.get("input_pipeline"),
            "precision": setup.get("precision"),
            "device": setup.get("device"),
            "resumed_from_epoch": (summary.get("training_setup") or {}).get("resumed_from_epoch"),
        },
        "environment": repro.get("environment"),
        "evaluation": summary.get("evaluation"),
        "artifacts": {"weights_sha256": repro.get("weights_sha256")},
    }


def _ensure_shards(dataset_shards, shard_dir: Path, prefix: str, paths: List[str], labels: List[int], per_shard: int):
    """Reuse shards written earlier for exactly these files (a resumed run), else write them."""
    names = [os.path.basename(p) for p in paths]
    digest = hashlib.sha256("\n".join(names).encode()).hexdigest()
    try:
        manifest = dataset_shards.read_manifest(str(shard_dir), prefix)
        if manifest.get("files_sha256") == digest and manifest.get("count") == len(paths):
            dataset_shards.verify_shards(str(shard_dir), manifest)
            return manifest
    except (OSError, ValueError):
        pass
    return dataset_shards.write_shards(
        paths, labels, str(shard_dir), shard_images=per_shard, prefix=prefix, extra={"files_sha256": digest}
    )
