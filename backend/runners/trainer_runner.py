import os
import time
import json
from pathlib import Path
from typing import Callable, Dict, Any, Optional, List, Tuple, Union

import numpy as np
import tensorflow as tf


class CancelledError(Exception):
    pass


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
) -> tf.data.Dataset:
    """Decode PNG in TensorFlow, resize, normalize [0,1]; optional RAM cache; batch + prefetch."""
    path_arr = np.asarray(paths, dtype=str)
    label_arr = np.asarray(labels, dtype=np.int32)

    ds = tf.data.Dataset.from_tensor_slices((path_arr, label_arr))

    if shuffle:
        n = int(path_arr.shape[0])
        buf = min(n, 10_000)
        buf = max(buf, 2)
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

    ds = ds.map(load_image, num_parallel_calls=tf.data.AUTOTUNE)
    ds = _maybe_memory_cache(ds, int(path_arr.shape[0]), img_size)

    # Larger batch_size often improves GPU throughput; batch_size still comes from trainer config.
    ds = ds.batch(batch_size, drop_remainder=False)
    ds = ds.prefetch(tf.data.AUTOTUNE)
    return ds


def run_trainer(
    config: Dict[str, Any],
    run_dir: Path,
    progress_cb: Callable,
    cancel_event: Optional[Any] = None,
):
    """Run CNN training with provided configuration"""

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

    try:
        t0 = time.perf_counter()
        progress_cb("loading", 5, {"message": "Scanning dataset folder..."})

        all_paths, all_labels = scan_labeled_png_paths(folder_name, cancel_event)
        t_scan = time.perf_counter()

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

        tf.random.set_seed(RANDOM_SEED)

        progress_cb("loading", 10, {"message": "Building tf.data input pipelines..."})
        t_before_ds = time.perf_counter()

        train_ds = build_image_dataset(
            train_paths,
            train_labels,
            IMG_SIZE,
            BATCH_SIZE,
            shuffle=True,
            shuffle_seed=RANDOM_SEED,
        )
        val_ds = build_image_dataset(
            val_paths,
            val_labels,
            IMG_SIZE,
            BATCH_SIZE,
            shuffle=False,
            shuffle_seed=None,
        )
        t_ds = time.perf_counter()

        print(
            f"[trainer] timings: scan+split={t_scan - t0:.2f}s, "
            f"dataset_build={t_ds - t_before_ds:.2f}s, "
            f"train={train_samples} val={val_samples} batch={BATCH_SIZE}"
        )

        progress_cb(
            "loading",
            15,
            {
                "message": f"Data ready: {train_samples} train, {val_samples} validation samples (tf.data)"
            },
        )

        progress_cb("building", 20, {"message": "Building CNN model..."})
        t_build = time.perf_counter()

        model = tf.keras.Sequential(
            [
                tf.keras.layers.Input(shape=(*IMG_SIZE, 3)),
                tf.keras.layers.Conv2D(32, (3, 3), activation="relu"),
                tf.keras.layers.MaxPooling2D(2, 2),
                tf.keras.layers.Conv2D(64, (3, 3), activation="relu"),
                tf.keras.layers.MaxPooling2D(2, 2),
                tf.keras.layers.Conv2D(128, (3, 3), activation="relu"),
                tf.keras.layers.MaxPooling2D(2, 2),
                tf.keras.layers.Flatten(),
                tf.keras.layers.Dense(128, activation="relu"),
                tf.keras.layers.Dense(1, activation="sigmoid"),
            ]
        )

        # Recall on the positive class (label 1) — standard read for binary chart models
        model.compile(
            optimizer="adam",
            loss="binary_crossentropy",
            metrics=[
                "accuracy",
                tf.keras.metrics.Recall(name="label_1_recall"),
            ],
        )

        print(f"[trainer] model build wall time: {time.perf_counter() - t_build:.2f}s")

        early_stop = tf.keras.callbacks.EarlyStopping(
            monitor="val_loss", patience=5, restore_best_weights=True
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

            def on_epoch_end(self, epoch, logs=None):
                if self.cancel_event is not None and self.cancel_event.is_set():
                    self.model.stop_training = True
                    self.progress_cb("cancelled", 0, {"message": "Training cancelled"})
                    return
                if logs:
                    epoch_data = {
                        "epoch": epoch + 1,
                        "epochs": self.params["epochs"],
                        "loss": float(logs.get("loss", 0)),
                        "accuracy": float(logs.get("accuracy", 0)),
                        "val_loss": float(logs.get("val_loss", 0)),
                        "val_accuracy": float(logs.get("val_accuracy", 0)),
                        "label_1_recall": float(logs.get("label_1_recall", 0)),
                        "val_label_1_recall": float(logs.get("val_label_1_recall", 0)),
                        # Binary classifier: accuracy on true label-1 samples equals positive-class recall.
                        "val_label_1_accuracy": float(logs.get("val_label_1_recall", 0)),
                        "timestamp": time.time(),
                    }

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
                        },
                    )

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

        t_fit = time.perf_counter()
        model.fit(
            train_ds,
            epochs=EPOCHS,
            validation_data=val_ds,
            callbacks=[early_stop, progress_callback],
            verbose=0,
        )
        print(f"[trainer] model.fit ended (wall): {time.perf_counter() - t_fit:.2f}s")

        if cancel_event is not None and cancel_event.is_set():
            raise CancelledError("Training cancelled by user")

        model.save(str(model_path))
        print(f"✅ Model saved as {model_path}")

        summary_data = {
            "model_name": model_name,
            "config": config,
            "train_samples": train_samples,
            "val_samples": val_samples,
            "image_size": IMG_SIZE,
            "batch_size": BATCH_SIZE,
            "epochs_trained": len(progress_callback.history_data),
            "best_epoch": len(progress_callback.history_data) - 5
            if len(progress_callback.history_data) > 5
            else len(progress_callback.history_data),
            "final_metrics": progress_callback.history_data[-1]
            if progress_callback.history_data
            else None,
            "completed_at": time.time(),
        }

        with open(summary_file, "w") as f:
            json.dump(summary_data, f, indent=2)

        progress_cb(
            "done",
            100,
            {
                "message": "Training completed successfully!",
                "model_path": str(model_path),
                "summary": summary_data,
            },
        )

    except CancelledError:
        progress_cb("cancelled", 0, {"message": "Training cancelled"})
        raise
    except Exception as e:
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
