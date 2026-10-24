"""Separate input-pipeline cost from model compute for the standard trainer configuration.

    python -m scripts.perf.bench_trainer_parts DATASET_IMAGES_DIR [--n 2000] [--threads 8] [--steps 40] [--jit]

Measures on the real images: one uncached pass of the trainer's tf.data pipeline (decode + resize),
the same pass from a uint8 cache, and train-step / eval-step throughput of the unchanged standard
model on in-memory batches. Nothing is written.
"""

from __future__ import annotations

import argparse
import os
import resource
import sys
import time


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("images")
    ap.add_argument("--n", type=int, default=2000)
    ap.add_argument("--threads", type=int, default=0)
    ap.add_argument("--steps", type=int, default=40)
    ap.add_argument("--jit", action="store_true")
    args = ap.parse_args()
    if args.threads:
        for key in ("OMP_NUM_THREADS", "TF_NUM_INTRAOP_THREADS", "TF_NUM_INTEROP_THREADS"):
            os.environ[key] = str(args.threads)

    t = time.perf_counter()
    import numpy as np
    import tensorflow as tf

    if args.threads:
        tf.config.threading.set_intra_op_parallelism_threads(args.threads)
        tf.config.threading.set_inter_op_parallelism_threads(args.threads)
    print(f"import_tensorflow_s={time.perf_counter() - t:.2f}")

    sys.path.insert(0, os.getcwd())
    from runners.trainer_runner import build_image_dataset, scan_labeled_png_paths

    paths, labels = scan_labeled_png_paths(args.images, None)
    paths, labels = paths[: args.n], labels[: args.n]
    n = len(paths)

    ds = build_image_dataset(paths, labels, (224, 224), 16, shuffle=True, shuffle_seed=7)
    t = time.perf_counter()
    for _ in ds:
        pass
    decode_pass = time.perf_counter() - t
    print(f"pipeline_pass_uncached_s={decode_pass:.2f} ({n / decode_pass:.0f} img/s)")

    model = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(224, 224, 3)),
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
    model.compile(
        optimizer="adam",
        loss="binary_crossentropy",
        metrics=["accuracy", tf.keras.metrics.Recall(name="label_1_recall")],
        jit_compile=bool(args.jit),
    )
    rng = np.random.default_rng(0)
    x = rng.random((16, 224, 224, 3), dtype=np.float32)
    y = rng.integers(0, 2, 16).astype(np.float32)
    t = time.perf_counter()
    model.train_on_batch(x, y)
    print(f"first_train_step_s={time.perf_counter() - t:.2f}")
    t = time.perf_counter()
    for _ in range(args.steps):
        model.train_on_batch(x, y)
    per_step = (time.perf_counter() - t) / args.steps
    print(f"train_step_s={per_step:.3f} ({16 / per_step:.0f} img/s)")
    model.predict_on_batch(x)
    t = time.perf_counter()
    for _ in range(args.steps):
        model.predict_on_batch(x)
    per_eval = (time.perf_counter() - t) / args.steps
    print(f"eval_step_s={per_eval:.3f} ({16 / per_eval:.0f} img/s)")
    train_n = int(n * 0.8)
    est = train_n / 16 * per_step + (n - train_n) / 16 * per_eval
    print(f"compute_only_epoch_estimate_s={est:.1f} (train={train_n}, val={n - train_n})")
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    print(f"peak_rss_mb={rss / (1024 * 1024 if sys.platform == 'darwin' else 1024):.0f}")


if __name__ == "__main__":
    main()
