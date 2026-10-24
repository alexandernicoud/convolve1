"""Controlled training-throughput matrix on real chart images.

    python -m scripts.perf.bench_training_matrix IMAGES_DIR [--n 512] [--steps 30]
        [--archs convolve-cnn-v1,convolve-cnn-compact-v1] [--batches 16,32,64] [--jit both]
        [--pipeline] [--out report.json]

Every cell trains the named architecture (Adam, binary cross-entropy, the trainer's metrics) on
the same decoded images with the same Keras seed, after a warm-up step that pays tracing. Images
are decoded exactly as the trainer decodes them. --pipeline additionally measures one epoch of
input-only throughput: PNG files, sharded TFRecords and a uint8 RAM cache. Nothing is written
except --out.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import resource
import sys
import tempfile
import time


def rss_mb() -> float:
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(rss / (1024 * 1024 if sys.platform == "darwin" else 1024), 1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("images")
    ap.add_argument("--n", type=int, default=512)
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--archs", default="convolve-cnn-v1")
    ap.add_argument("--batches", default="16")
    ap.add_argument("--jit", choices=["off", "on", "both"], default="off")
    ap.add_argument("--precision", choices=["float32", "mixed_float16", "mixed_bfloat16"], default="float32")
    ap.add_argument("--pipeline", action="store_true")
    ap.add_argument("--out")
    args = ap.parse_args()

    t = time.perf_counter()
    import numpy as np
    import tensorflow as tf

    import_s = time.perf_counter() - t
    sys.path.insert(0, os.getcwd())
    from runners import cnn_architectures as ca
    from runners import dataset_shards as shards
    from runners.trainer_runner import build_image_dataset, scan_labeled_png_paths

    paths, labels = scan_labeled_png_paths(args.images, None)
    order = sorted(range(len(paths)), key=lambda i: os.path.basename(paths[i]))
    paths = [paths[i] for i in order][: args.n]
    labels = [labels[i] for i in order][: args.n]
    n = len(paths)

    report = {
        "machine": {
            "platform": platform.platform(),
            "processor": platform.processor() or platform.machine(),
            "cpu_count": os.cpu_count(),
            "tensorflow": tf.__version__,
            "gpus": [d.name for d in tf.config.list_physical_devices("GPU")],
            "intra_op_threads": tf.config.threading.get_intra_op_parallelism_threads(),
        },
        "images": n,
        "tf_import_seconds": round(import_s, 2),
        "pipeline": {},
        "train": [],
    }

    if args.pipeline:
        ds = build_image_dataset(paths, labels, (224, 224), 64, shuffle=True, shuffle_seed=7)
        t = time.perf_counter()
        for _ in ds:
            pass
        report["pipeline"]["png_files_decode_img_s"] = round(n / (time.perf_counter() - t), 1)
        with tempfile.TemporaryDirectory() as tmp:
            t = time.perf_counter()
            manifest = shards.write_shards(paths, labels, tmp, shard_images=max(64, n // 8))
            report["pipeline"]["shard_write_img_s"] = round(n / (time.perf_counter() - t), 1)
            files = [os.path.join(tmp, s["file"]) for s in manifest["shards"]]
            sds = shards.shard_dataset(files, (224, 224), 64, shuffle_buffer=n, seed=7)
            t = time.perf_counter()
            for _ in sds:
                pass
            report["pipeline"]["shards_decode_img_s"] = round(n / (time.perf_counter() - t), 1)
        cached = shards.decoded_uint8_dataset(paths, labels, (224, 224)).cache()
        for _ in cached:
            pass
        t = time.perf_counter()
        for _ in cached.shuffle(n, seed=7).map(shards.model_input_fn(224, 224), num_parallel_calls=tf.data.AUTOTUNE).batch(64):
            pass
        report["pipeline"]["uint8_ram_cache_img_s"] = round(n / (time.perf_counter() - t), 1)
        print(json.dumps(report["pipeline"]), flush=True)

    x = np.stack([img.numpy() for img, _ in build_image_dataset(paths, labels, (224, 224), 64, False, None).unbatch()])
    y = np.asarray(labels, dtype=np.float32)
    if args.precision != "float32":
        tf.keras.mixed_precision.set_global_policy(args.precision)

    jits = {"off": [False], "on": [True], "both": [False, True]}[args.jit]
    for arch_id in args.archs.split(","):
        stats = ca.complexity(ca.resolve(arch_id), (224, 224))
        for batch in [int(b) for b in args.batches.split(",")]:
            for jit in jits:
                tf.keras.utils.clear_session()
                tf.keras.utils.set_random_seed(7)
                model = ca.build_model(arch_id, (224, 224))
                model.compile(
                    optimizer="adam",
                    loss="binary_crossentropy",
                    metrics=["accuracy", tf.keras.metrics.Recall(name="label_1_recall")],
                    jit_compile=jit,
                )
                steps = max(1, min(args.steps, n // batch))
                t = time.perf_counter()
                model.train_on_batch(x[:batch], y[:batch])
                first = time.perf_counter() - t
                t = time.perf_counter()
                losses = []
                for s in range(steps):
                    lo = (s * batch) % (n - batch + 1)
                    out = model.train_on_batch(x[lo : lo + batch], y[lo : lo + batch], return_dict=True)
                    losses.append(float(out["loss"]))
                per_step = (time.perf_counter() - t) / steps
                ev = x[: batch * max(1, min(8, n // batch))]
                model.predict(ev[:batch], verbose=0)
                t = time.perf_counter()
                model.predict(ev, batch_size=batch, verbose=0)
                eval_img_s = len(ev) / (time.perf_counter() - t)
                row = {
                    "architecture": arch_id,
                    "batch": batch,
                    "jit_compile": jit,
                    "precision": args.precision,
                    "train_gflops_per_image": stats["train_gflops_per_image"],
                    "first_step_seconds": round(first, 2),
                    "train_img_s": round(batch / per_step, 1),
                    "eval_img_s": round(eval_img_s, 1),
                    "achieved_gflops_s": round(batch / per_step * stats["train_gflops_per_image"], 1),
                    "loss_after_steps": round(losses[-1], 6),
                    "peak_rss_mb": rss_mb(),
                }
                report["train"].append(row)
                print(json.dumps(row), flush=True)

    if args.out:
        with open(args.out, "w") as f:
            json.dump(report, f, indent=2)


if __name__ == "__main__":
    main()
