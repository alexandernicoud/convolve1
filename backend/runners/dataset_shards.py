"""Sharded TFRecord datasets and the shared chart decoder.

A shard stores each chart's original PNG bytes untouched, plus its label and file name. Decoding
a record runs exactly the trainer's operations on exactly the same bytes, so pixels are
bit-identical to training from the PNG folder. A dataset of a million 2.6 KB charts is ~2.6 GB in
a few hundred shards: training streams a handful of large sequential files instead of opening
a million small ones, and memory stays bounded by the shuffle buffer, not the dataset size.

manifest.json records the format version, per-shard counts and SHA-256, label counts and the
split the shards were written for, so a reader can refuse shards that do not match its run.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import tensorflow as tf

SHARD_FORMAT = "convolve-chart-shards-v1"
DEFAULT_SHARD_IMAGES = 4096

_FEATURES = {
    "image_png": tf.io.FixedLenFeature([], tf.string),
    "label": tf.io.FixedLenFeature([], tf.int64),
    "name": tf.io.FixedLenFeature([], tf.string),
}


def decode_chart_png(raw: tf.Tensor, height: int, width: int) -> tf.Tensor:
    """The trainer's decode: RGB (alpha dropped), AREA resize, float32 in [0, 1]."""
    image = decode_chart_uint8(raw)
    return resize_to_model_input(image, height, width)


def decode_chart_uint8(raw: tf.Tensor) -> tf.Tensor:
    return tf.image.decode_png(raw, channels=3)


def resize_to_model_input(image: tf.Tensor, height: int, width: int) -> tf.Tensor:
    image = tf.image.resize(image, [height, width], method=tf.image.ResizeMethod.AREA)
    return tf.cast(image, tf.float32) / 255.0


def model_input_fn(height: int, width: int):
    """Map fn for a cache of decoded uint8 charts: the remaining decode_chart_png steps, so the
    values are the ones the uncached pipeline produces from the same PNG."""

    def fn(image: tf.Tensor, label: tf.Tensor) -> Tuple[tf.Tensor, tf.Tensor]:
        return resize_to_model_input(image, height, width), tf.cast(label, tf.float32)

    return fn


def decoded_uint8_dataset(paths: Sequence[str], labels: Sequence[int], img_size: Tuple[int, int]) -> tf.data.Dataset:
    del img_size
    ds = tf.data.Dataset.from_tensor_slices((list(paths), [int(v) for v in labels]))
    return ds.map(lambda p, y: (decode_chart_uint8(tf.io.read_file(p)), y), num_parallel_calls=tf.data.AUTOTUNE)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_shards(
    paths: Sequence[str],
    labels: Sequence[int],
    out_dir: str,
    *,
    shard_images: int = DEFAULT_SHARD_IMAGES,
    prefix: str = "data",
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Write records in the given order. Each shard is written to a temp name and renamed, so a
    crash never leaves a truncated shard under its final name; rerunning rewrites the same files."""
    if len(paths) != len(labels):
        raise ValueError("paths and labels differ in length")
    if not paths:
        raise ValueError("No images to shard")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    per = max(1, int(shard_images))
    total = (len(paths) + per - 1) // per
    shards: List[Dict[str, Any]] = []
    counts: Dict[str, int] = {}
    for idx in range(total):
        name = f"{prefix}-{idx:05d}-of-{total:05d}.tfrecord"
        final = out / name
        tmp = out / f".{name}.tmp"
        chunk = range(idx * per, min(len(paths), (idx + 1) * per))
        with tf.io.TFRecordWriter(str(tmp)) as writer:
            for i in chunk:
                with open(paths[i], "rb") as f:
                    raw = f.read()
                label = int(labels[i])
                counts[str(label)] = counts.get(str(label), 0) + 1
                example = tf.train.Example(
                    features=tf.train.Features(
                        feature={
                            "image_png": tf.train.Feature(bytes_list=tf.train.BytesList(value=[raw])),
                            "label": tf.train.Feature(int64_list=tf.train.Int64List(value=[label])),
                            "name": tf.train.Feature(
                                bytes_list=tf.train.BytesList(value=[os.path.basename(paths[i]).encode()])
                            ),
                        }
                    )
                )
                writer.write(example.SerializeToString())
        os.replace(tmp, final)
        shards.append({"file": name, "count": len(chunk), "sha256": _sha256(final), "bytes": final.stat().st_size})
    manifest = {
        "format": SHARD_FORMAT,
        "prefix": prefix,
        "count": len(paths),
        "label_counts": counts,
        "shards": shards,
        "created_at": time.time(),
        **(extra or {}),
    }
    tmp_manifest = out / f".{prefix}-manifest.json.tmp"
    tmp_manifest.write_text(json.dumps(manifest, indent=2))
    os.replace(tmp_manifest, out / f"{prefix}-manifest.json")
    return manifest


def read_manifest(out_dir: str, prefix: str = "data") -> Dict[str, Any]:
    manifest = json.loads((Path(out_dir) / f"{prefix}-manifest.json").read_text())
    if manifest.get("format") != SHARD_FORMAT:
        raise ValueError(f"Unsupported shard format {manifest.get('format')!r}")
    return manifest


def verify_shards(out_dir: str, manifest: Dict[str, Any]) -> None:
    for shard in manifest["shards"]:
        path = Path(out_dir) / shard["file"]
        if not path.is_file() or _sha256(path) != shard["sha256"]:
            raise ValueError(f"Shard {shard['file']} is missing or does not match its manifest")


def _parse(serialized: tf.Tensor, height: int, width: int) -> Tuple[tf.Tensor, tf.Tensor]:
    rec = tf.io.parse_single_example(serialized, _FEATURES)
    return decode_chart_png(rec["image_png"], height, width), tf.cast(rec["label"], tf.float32)


def shard_dataset(
    files: Sequence[str],
    img_size: Tuple[int, int],
    batch_size: int,
    *,
    shuffle_buffer: int = 0,
    seed: Optional[int] = None,
) -> tf.data.Dataset:
    """One pass over the shards. With shuffle_buffer > 0 the shard order and the records are
    shuffled deterministically from ``seed``; a buffer at least the record count is a full shuffle."""
    h, w = int(img_size[0]), int(img_size[1])
    ds = tf.data.Dataset.from_tensor_slices(list(files))
    if shuffle_buffer > 0:
        ds = ds.shuffle(len(files), seed=seed)
    # Unshuffled reads keep the written record order (one shard after another).
    ds = ds.interleave(
        tf.data.TFRecordDataset,
        cycle_length=max(1, min(len(files), 8)) if shuffle_buffer > 0 else 1,
        num_parallel_calls=tf.data.AUTOTUNE,
        deterministic=True,
    )
    if shuffle_buffer > 0:
        ds = ds.shuffle(shuffle_buffer, seed=seed)
    ds = ds.map(lambda s: _parse(s, h, w), num_parallel_calls=tf.data.AUTOTUNE)
    return ds.batch(batch_size).prefetch(tf.data.AUTOTUNE)


def epoch_indexed_shard_dataset(
    files: Sequence[str],
    img_size: Tuple[int, int],
    batch_size: int,
    *,
    shuffle_buffer: int,
    seed: int,
    initial_epoch: int,
    epochs: int,
    augment=None,
) -> tf.data.Dataset:
    """Epochs initial_epoch..epochs-1 back to back, epoch e shuffled from seed + e. Resuming at
    epoch k therefore sees exactly the batches an uninterrupted run would have seen from epoch k.
    ``augment(image, label, seed_pair)`` draws its randomness from seed + e as well, so resumed
    runs also see the same augmented images. Use with steps_per_epoch = ceil(records / batch_size)."""
    h, w = int(img_size[0]), int(img_size[1])
    file_list = tf.constant(list(files))
    n_files = len(files)
    cycle = max(1, min(n_files, 8))

    def one_epoch(epoch: tf.Tensor) -> tf.data.Dataset:
        epoch_seed = tf.cast(seed, tf.int64) + epoch
        ds = tf.data.Dataset.from_tensor_slices(file_list).shuffle(n_files, seed=epoch_seed)
        ds = ds.interleave(tf.data.TFRecordDataset, cycle_length=cycle, deterministic=True)
        ds = ds.shuffle(shuffle_buffer, seed=epoch_seed)
        ds = ds.map(lambda s: _parse(s, h, w), num_parallel_calls=tf.data.AUTOTUNE, deterministic=True)
        if augment is not None:
            ds = ds.enumerate().map(
                lambda i, pair: augment(pair[0], pair[1], tf.stack([epoch_seed, i])),
                num_parallel_calls=tf.data.AUTOTUNE,
                deterministic=True,
            )
        return ds.batch(batch_size)

    ds = tf.data.Dataset.range(int(initial_epoch), int(epochs)).flat_map(one_epoch)
    return ds.prefetch(tf.data.AUTOTUNE)
