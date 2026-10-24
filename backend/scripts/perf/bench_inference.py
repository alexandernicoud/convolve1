"""Inference call styles on the shared preprocessing: speed and exact equality with eager model().

    .venv/bin/python -m scripts.perf.bench_inference MODEL IMAGES_DIR [--n 1024] [--batch 32]
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("images")
    ap.add_argument("--n", type=int, default=1024)
    ap.add_argument("--batch", type=int, default=32)
    args = ap.parse_args()

    import numpy as np
    import keras
    import tensorflow as tf

    from app.services import cnn_inference as ci

    model = keras.models.load_model(args.model, compile=False)
    io = ci.model_io(model)
    paths = [str(p) for p in sorted(Path(args.images).glob("*.png"))[: args.n]]

    t = time.perf_counter()
    batches = [b for b in ci.build_inference_dataset(paths, io.input_size, args.batch)]
    decode_s = time.perf_counter() - t

    graph_call = tf.function(lambda x: model(x, training=False), reduce_retracing=True)
    styles = {
        "eager_call": lambda b: model(b, training=False),
        "tf_function": graph_call,
        "predict_on_batch": lambda b: model.predict_on_batch(b),
    }
    outputs, timings = {}, {}
    for name, fn in styles.items():
        fn(batches[0])  # warm-up / trace
        best = None
        for _ in range(2):
            t = time.perf_counter()
            out = [np.asarray(fn(b)) for b in batches]
            dt = time.perf_counter() - t
            best = dt if best is None else min(best, dt)
        outputs[name] = np.concatenate(out)
        timings[name] = best

    ref = outputs["eager_call"]
    report = {
        "n": len(paths),
        "batch": args.batch,
        "decode_resize_seconds": round(decode_s, 2),
        "images_per_second": {k: round(len(paths) / v, 1) for k, v in timings.items()},
        "identical_to_eager": {k: bool(np.array_equal(v, ref)) for k, v in outputs.items()},
        "max_abs_diff_vs_eager": {k: float(np.max(np.abs(v - ref))) for k, v in outputs.items()},
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
