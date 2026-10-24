"""Model file with and without optimizer state: size, save time, load time, prediction parity.

    .venv/bin/python -m scripts.perf.bench_model_file /tmp/convolve-bench/n2000_e30/run/model.keras IMAGES_DIR
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import time
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("images")
    ap.add_argument("--n", type=int, default=64)
    ap.add_argument("--repeats", type=int, default=3)
    args = ap.parse_args()

    import numpy as np
    import tensorflow as tf

    def export_inference_model(model):
        # from_config never compiles; clone_model copies the compile setup in Keras 3.
        clone = model.__class__.from_config(model.get_config())
        clone.build(model.input_shape)
        clone.set_weights(model.get_weights())
        return clone

    def load_batch(paths):
        out = []
        for p in paths:
            img = tf.image.decode_png(tf.io.read_file(str(p)), channels=3)
            img = tf.image.resize(img, (224, 224), method="area") / 255.0
            out.append(img.numpy())
        return np.stack(out).astype("float32")

    paths = sorted(Path(args.images).glob("*.png"))[: args.n]
    batch = load_batch(paths)

    def timed_load(path):
        best = None
        for _ in range(args.repeats):
            t = time.perf_counter()
            m = tf.keras.models.load_model(path)
            dt = time.perf_counter() - t
            best = dt if best is None else min(best, dt)
        return m, best

    full, full_load = timed_load(args.model)
    with tempfile.TemporaryDirectory() as tmp:
        slim_path = os.path.join(tmp, "slim.keras")
        t = time.perf_counter()
        export_inference_model(full).save(slim_path)
        slim_save = time.perf_counter() - t
        t = time.perf_counter()
        full.save(os.path.join(tmp, "full.keras"))
        full_save = time.perf_counter() - t
        slim, slim_load = timed_load(slim_path)
        slim_mb = os.path.getsize(slim_path) / 1e6

    p_full = full.predict(batch, verbose=0)
    p_slim = slim.predict(batch, verbose=0)
    report = {
        "full_mb": round(os.path.getsize(args.model) / 1e6, 1),
        "slim_mb": round(slim_mb, 1),
        "full_save_seconds": round(full_save, 3),
        "slim_save_seconds": round(slim_save, 3),
        "full_load_seconds_best": round(full_load, 3),
        "slim_load_seconds_best": round(slim_load, 3),
        "predictions_identical": bool(np.array_equal(p_full, p_slim)),
        "max_abs_diff": float(np.max(np.abs(p_full - p_slim))),
        "slim_compiled": slim.compiled,
        "n_predictions": int(p_full.shape[0]),
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
