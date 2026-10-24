"""Model loading, preprocessing, dataset indexing and single-image attribution.

Preprocessing mirrors runners/trainer_runner.py `build_image_dataset` exactly (decode_png with 3
channels, AREA resize, /255) so every map is computed on the tensor the model was trained on.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

PREPROCESS_ID = "decode_png(rgb)|resize(area)|scale(1/255)"

FILENAME_RE = re.compile(
    r"^(?P<symbol>.+?)_(?P<start>\d{4}-\d{2}-\d{2})_to_(?P<end>\d{4}-\d{2}-\d{2})_label(?P<label>\d)"
)

MAX_INDEX_IMAGES = 20000
MODEL_CACHE_SIZE = 2


def _tf():
    import tensorflow as tf  # deferred: keeps API import light and tests fast

    return tf


# --------------------------------------------------------------------------- preprocessing


def load_model_input(path: str, size: Tuple[int, int]) -> np.ndarray:
    """One image as the model sees it: float32 HxWx3 in [0, 1]."""
    tf = _tf()
    raw = tf.io.read_file(path)
    image = tf.image.decode_png(raw, channels=3)
    image = tf.image.resize(image, [int(size[0]), int(size[1])], method=tf.image.ResizeMethod.AREA)
    return (tf.cast(image, tf.float32) / 255.0).numpy()


def load_batch(paths: Sequence[str], size: Tuple[int, int]) -> np.ndarray:
    return np.stack([load_model_input(p, size) for p in paths]).astype(np.float32)


def input_png_bytes(x: np.ndarray) -> bytes:
    """PNG of the exact model input (after resize), for display under overlays."""
    from PIL import Image

    arr = np.clip(np.round(x * 255.0), 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGB").save(buf, format="PNG")
    return buf.getvalue()


def display_png_bytes(path: str, size: Tuple[int, int]) -> bytes:
    """Model input (RGB, byte-identical to ``input_png_bytes``) plus the source chart's own alpha.

    The model decodes with ``channels=3``, which drops alpha and leaves the transparent chart
    background as white. Re-attaching the source alpha (resized with the same AREA method) lets
    the UI show transparent charts on a dark surface without thresholding any pixels. Sources
    without an alpha channel decode as fully opaque, so they are returned unchanged.
    """
    from PIL import Image

    tf = _tf()
    raw = tf.io.read_file(path)
    rgb = np.clip(np.round(load_model_input(path, size) * 255.0), 0, 255).astype(np.uint8)
    alpha = tf.image.decode_png(raw, channels=4)[..., 3:]
    alpha = tf.image.resize(alpha, [int(size[0]), int(size[1])], method=tf.image.ResizeMethod.AREA)
    a = np.clip(np.round(alpha.numpy()), 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(np.concatenate([rgb, a], axis=-1), mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


def foreground_mask(x: np.ndarray, thresh: float = 0.98) -> np.ndarray:
    """True where the pixel is not the white chart background (charts render on white after alpha drop)."""
    return np.any(x < thresh, axis=-1)


# --------------------------------------------------------------------------- map encoding


def encode_map(arr: np.ndarray, *, normalization: str, vmin: Optional[float] = None, vmax: Optional[float] = None) -> Dict[str, Any]:
    """2D float map → 8-bit grayscale PNG (base64) plus the scale needed to read it.

    ``normalization`` describes how values map to 0–255 and is shown to the user.
    """
    from PIL import Image

    a = np.asarray(arr, dtype=np.float32)
    finite = a[np.isfinite(a)]
    lo = float(vmin) if vmin is not None else (float(finite.min()) if finite.size else 0.0)
    hi = float(vmax) if vmax is not None else (float(finite.max()) if finite.size else 0.0)
    span = hi - lo
    scaled = np.zeros_like(a) if span <= 0 else np.clip((a - lo) / span, 0.0, 1.0)
    u8 = np.round(np.nan_to_num(scaled) * 255.0).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(u8, mode="L").save(buf, format="PNG")
    return {
        "png": base64.b64encode(buf.getvalue()).decode("ascii"),
        "shape": [int(a.shape[0]), int(a.shape[1])],
        "min": lo,
        "max": hi,
        "normalization": normalization,
    }


def resize_map(arr: np.ndarray, size: Tuple[int, int]) -> np.ndarray:
    tf = _tf()
    t = tf.convert_to_tensor(np.asarray(arr, dtype=np.float32)[None, ..., None])
    return tf.image.resize(t, [int(size[0]), int(size[1])], method="bilinear").numpy()[0, ..., 0]


# --------------------------------------------------------------------------- models


@dataclass
class LoadedModel:
    fingerprint: str
    model: Any
    graph: Any
    input_size: Tuple[int, int]
    conv_layers: List[Dict[str, Any]]
    head: str
    n_classes: int
    final_kernel: Any
    final_bias: Any
    penultimate_dim: int
    layers: List[Dict[str, Any]]
    lock: threading.Lock = field(default_factory=threading.Lock)
    predict_fn: Any = None
    # "chain": layers re-run one by one. "graph": residual/branched networks run as one
    # functional model exposing the listed feature maps and the classifier input.
    mode: str = "chain"
    preferred_layer: Optional[str] = None

    @property
    def last_conv(self) -> Optional[str]:
        names = [c["name"] for c in self.conv_layers]
        if self.preferred_layer in names:
            return self.preferred_layer
        return names[-1] if names else None

    def describe(self) -> Dict[str, Any]:
        return {
            "fingerprint": self.fingerprint,
            "input_size": list(self.input_size),
            "preprocessing": PREPROCESS_ID,
            "head": self.head,
            "n_classes": self.n_classes,
            "conv_layers": self.conv_layers,
            "default_layer": self.last_conv,
            "penultimate_dim": self.penultimate_dim,
            "layers": self.layers,
            "graph_mode": self.mode,
        }


class UnsupportedModel(Exception):
    pass


def model_fingerprint(path: str) -> str:
    st = os.stat(path)
    ident = f"{os.path.realpath(path)}|{st.st_mtime_ns}|{st.st_size}"
    return hashlib.sha1(ident.encode()).hexdigest()[:16]


def _shape(t: Any) -> List[Optional[int]]:
    return [None if d is None else int(d) for d in tuple(t.shape)[1:]]


def keras_input_layer() -> Any:
    import keras

    return keras.layers.InputLayer


def _is_4d(t: Any) -> bool:
    try:
        return len(tuple(t.shape)) == 4
    except Exception:  # noqa: BLE001
        return False


def _build_graph(model: Any, fingerprint: str, head: str, n_classes: int, h: int, w: int, hint: Optional[str]) -> LoadedModel:
    """Residual or branched functional networks (ResNet, EfficientNet): the last feature map at
    each spatial resolution (plus the manifest's Grad-CAM layer) and the classifier input."""
    import keras

    final = model.layers[-1]
    if any(isinstance(layer, keras.Model) for layer in model.layers):
        raise UnsupportedModel("Nested sub-models are not supported; save the network with flattened layers")
    try:
        penultimate = final.input
    except Exception as exc:  # noqa: BLE001
        raise UnsupportedModel("The classifier input is not reachable in this model graph") from exc
    if len(_shape(penultimate)) != 1:
        raise UnsupportedModel("The layer before the classifier must be a flat vector")
    feature: List[Any] = []
    for layer in model.layers[:-1]:
        try:
            out = layer.output
        except Exception:  # noqa: BLE001
            continue
        if isinstance(out, (list, tuple)) or not _is_4d(out) or isinstance(layer, keras.layers.InputLayer):
            continue
        if max(int(d or 0) for d in tuple(out.shape)[1:3]) <= 1:
            continue  # squeeze-and-excitation gates: no spatial extent to localize
        feature.append(layer)
    if not feature:
        raise UnsupportedModel("No convolutional feature maps found")
    chosen: List[Any] = []
    for i, layer in enumerate(feature):
        here = tuple(layer.output.shape)[1:3]
        nxt = tuple(feature[i + 1].output.shape)[1:3] if i + 1 < len(feature) else None
        if nxt != here or layer.name == hint:
            chosen.append(layer)
    graph = keras.Model(model.inputs, [layer.output for layer in chosen] + [penultimate])
    kernel, bias = final.get_weights()
    conv_layers = [{"name": layer.name, "output_shape": _shape(layer.output)} for layer in chosen]
    layers = [
        {
            "name": layer.name,
            "type": layer.__class__.__name__,
            "output_shape": _shape(layer.output) if not isinstance(layer.output, (list, tuple)) else None,
            "params": int(layer.count_params()),
        }
        for layer in model.layers
    ]
    return LoadedModel(
        fingerprint=fingerprint,
        model=model,
        graph=graph,
        input_size=(h, w),
        conv_layers=conv_layers,
        head=head,
        n_classes=n_classes,
        final_kernel=kernel.astype(np.float32),
        final_bias=bias.astype(np.float32),
        penultimate_dim=int(np.prod([d for d in _shape(penultimate) if d])),
        layers=layers,
        mode="graph",
        preferred_layer=hint,
    )


def _build(model: Any, fingerprint: str, hint: Optional[str] = None) -> LoadedModel:
    import keras

    if not model.layers:
        raise UnsupportedModel("Model has no layers")
    final = model.layers[-1]
    if not isinstance(final, keras.layers.Dense):
        raise UnsupportedModel("Only models ending in a Dense classification layer are supported")
    units = int(final.units)
    act = getattr(final.activation, "__name__", str(final.activation))
    if units == 1 and act == "sigmoid":
        head, n_classes = "sigmoid", 2
    elif units >= 2 and act == "softmax":
        head, n_classes = "softmax", units
    else:
        raise UnsupportedModel(f"Unsupported output layer ({units} unit(s), {act}); expected sigmoid(1) or softmax(k)")

    input_shape = model.input_shape
    if isinstance(input_shape, list):
        raise UnsupportedModel("Models with multiple inputs are not supported")
    if len(input_shape) != 4 or input_shape[-1] != 3:
        raise UnsupportedModel("Expected an RGB image input (H, W, 3)")
    h, w = int(input_shape[1]), int(input_shape[2])

    # Re-trace the layers on a fresh input so intermediate tensors are reachable for both
    # Sequential and simple functional (single-chain) models.
    if not _is_chain(model):
        return _build_graph(model, fingerprint, head, n_classes, h, w, hint)
    inp = keras.Input(shape=(h, w, 3))
    x = inp
    outputs: Dict[str, Any] = {}
    body = [l for l in model.layers[:-1] if not isinstance(l, keras.layers.InputLayer)]
    try:
        for layer in body:
            x = layer(x)
            outputs[layer.name] = x
    except Exception as exc:
        raise UnsupportedModel("Only single-chain (Sequential-style) models are supported") from exc
    penultimate = x
    conv_names = [
        l.name
        for l in body
        if isinstance(l, keras.layers.Conv2D) or (l.name == hint and _is_4d(outputs[l.name]))
    ]
    if not conv_names:
        raise UnsupportedModel("No Conv2D layers found")
    graph = keras.Model(inp, [outputs[n] for n in conv_names] + [penultimate])

    layers = []
    for layer in body + [final]:
        out = outputs.get(layer.name)
        layers.append(
            {
                "name": layer.name,
                "type": layer.__class__.__name__,
                "output_shape": _shape(out) if out is not None else [units],
                "params": int(layer.count_params()),
            }
        )
    conv_layers = [{"name": n, "output_shape": _shape(outputs[n])} for n in conv_names]
    kernel, bias = final.get_weights()
    pdim = int(np.prod([d for d in _shape(penultimate) if d]))
    if len(_shape(penultimate)) != 1:
        raise UnsupportedModel("The layer before the classifier must be a flat vector")
    return LoadedModel(
        fingerprint=fingerprint,
        model=model,
        graph=graph,
        input_size=(h, w),
        conv_layers=conv_layers,
        head=head,
        n_classes=n_classes,
        final_kernel=kernel.astype(np.float32),
        final_bias=bias.astype(np.float32),
        penultimate_dim=pdim,
        layers=layers,
        preferred_layer=hint,
    )


def _is_chain(model: Any) -> bool:
    """True when every layer consumes exactly the previous layer's output (Sequential-style)."""
    import keras

    if isinstance(model, keras.Sequential):
        return True
    layers = [l for l in model.layers if not isinstance(l, keras.layers.InputLayer)]
    try:
        for prev, layer in zip(layers, layers[1:]):
            inbound = layer.input
            if isinstance(inbound, (list, tuple)) or inbound is not prev.output:
                return False
    except Exception:  # noqa: BLE001
        return False
    return True


_cache: "OrderedDict[str, LoadedModel]" = OrderedDict()
_cache_lock = threading.Lock()


def get_model(path: str) -> LoadedModel:
    """Load once per (file, mtime, size); at most MODEL_CACHE_SIZE models stay in memory."""
    fp = model_fingerprint(path)
    with _cache_lock:
        hit = _cache.get(fp)
        if hit is not None:
            _cache.move_to_end(fp)
            return hit
    import keras

    from runners.model_manifest import read_embedded

    model = keras.models.load_model(path, compile=False)
    manifest = read_embedded(path) or {}
    hint = (manifest.get("architecture") or {}).get("gradcam_layer")
    lm = _build(model, fp, hint if isinstance(hint, str) else None)
    with _cache_lock:
        _cache[fp] = lm
        _cache.move_to_end(fp)
        while len(_cache) > MODEL_CACHE_SIZE:
            _cache.popitem(last=False)
    return lm


def clear_model_cache() -> None:
    with _cache_lock:
        _cache.clear()


# --------------------------------------------------------------------------- forward / scores


def _forward(lm: LoadedModel, x: Any):
    """Conv activations, penultimate vector and class logits (pre-activation) for a batch.

    Layers run eagerly one by one so a GradientTape (watching the input) can differentiate
    with respect to any intermediate activation.
    """
    tf = _tf()
    if lm.mode == "graph":
        outs = lm.graph(tf.convert_to_tensor(x), training=False)
        convs, h = list(outs[:-1]), outs[-1]
        return convs, h, tf.matmul(h, lm.final_kernel) + lm.final_bias
    conv_names = {c["name"] for c in lm.conv_layers}
    h = tf.convert_to_tensor(x)
    convs = []
    for layer in lm.model.layers[:-1]:
        if isinstance(layer, keras_input_layer()):
            continue
        h = layer(h, training=False)
        if layer.name in conv_names:
            convs.append(h)
    z = tf.matmul(h, lm.final_kernel) + lm.final_bias
    return convs, h, z


def class_scores(lm: LoadedModel, z: Any, target: Any):
    """Pre-activation evidence for ``target`` (per sample). Sigmoid: +z for class 1, −z for class 0."""
    tf = _tf()
    target = tf.convert_to_tensor(target, dtype=tf.int32)
    if lm.head == "sigmoid":
        sign = tf.where(target == 1, 1.0, -1.0)
        return z[:, 0] * sign
    return tf.gather(z, target, axis=1, batch_dims=1)


def probabilities(lm: LoadedModel, z: np.ndarray) -> np.ndarray:
    """(N, n_classes) probabilities from logits."""
    z = np.asarray(z, dtype=np.float64)
    if lm.head == "sigmoid":
        p1 = 1.0 / (1.0 + np.exp(-z[:, 0]))
        return np.stack([1.0 - p1, p1], axis=1)
    e = np.exp(z - z.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)


def _graph_predict(lm: LoadedModel):
    """``_forward`` as one compiled graph for tape-free prediction (same ops, ~2x eager on CPU).

    Gradient methods keep the eager path: a tape cannot see activations inside a tf.function.
    """
    if lm.predict_fn is None:
        def fwd(x):
            _, pen, z = _forward(lm, x)
            return pen, z

        lm.predict_fn = _tf().function(fwd, reduce_retracing=True)
    return lm.predict_fn


def predict(lm: LoadedModel, x: np.ndarray, batch: int = 32) -> Tuple[np.ndarray, np.ndarray]:
    """(probabilities (N, k), penultimate (N, d)) in batches."""
    probs, pens = [], []
    with lm.lock:
        fwd = _graph_predict(lm)
        for i in range(0, len(x), batch):
            pen, z = fwd(x[i : i + batch])
            probs.append(probabilities(lm, z.numpy()))
            pens.append(pen.numpy())
    return np.concatenate(probs), np.concatenate(pens)


def gradcam_batch(lm: LoadedModel, x: np.ndarray, targets: Sequence[int], layer: str) -> Tuple[np.ndarray, np.ndarray]:
    """Grad-CAM at the layer's native resolution, unnormalized. Returns (maps (N,h,w), probs (N,k))."""
    tf = _tf()
    idx = [c["name"] for c in lm.conv_layers].index(layer)
    xt = tf.convert_to_tensor(x)
    with lm.lock:
        with tf.GradientTape() as tape:
            tape.watch(xt)
            convs, _, z = _forward(lm, xt)
            act = convs[idx]
            total = tf.reduce_sum(class_scores(lm, z, list(targets)))
        grads = tape.gradient(total, act)
    weights = tf.reduce_mean(grads, axis=(1, 2), keepdims=True)
    cam = tf.nn.relu(tf.reduce_sum(weights * act, axis=-1)).numpy()
    return cam.astype(np.float32), probabilities(lm, z.numpy())


def input_gradients(lm: LoadedModel, x: np.ndarray, targets: Sequence[int]) -> np.ndarray:
    tf = _tf()
    xt = tf.convert_to_tensor(x)
    with lm.lock:
        with tf.GradientTape() as tape:
            tape.watch(xt)
            _, _, z = _forward(lm, xt)
            total = tf.reduce_sum(class_scores(lm, z, list(targets)))
        g = tape.gradient(total, xt)
    return g.numpy()


def conv_activations(lm: LoadedModel, x: np.ndarray, layer: str) -> np.ndarray:
    idx = [c["name"] for c in lm.conv_layers].index(layer)
    with lm.lock:
        convs, _, _ = _forward(lm, x)
    return convs[idx].numpy()


# --------------------------------------------------------------------------- dataset index


@dataclass
class ImageRecord:
    id: str
    label: Optional[int]
    symbol: Optional[str]
    start: Optional[str]
    end: Optional[str]

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "label": self.label, "symbol": self.symbol, "start": self.start, "end": self.end}


def parse_filename(name: str) -> ImageRecord:
    label: Optional[int] = None
    if "label" in name:
        try:
            label = int(name.split("label")[1][0])  # trainer rule (runners/trainer_runner.py)
        except (ValueError, IndexError):
            label = None
    m = FILENAME_RE.match(name)
    return ImageRecord(
        id=name,
        label=label,
        symbol=m.group("symbol") if m else None,
        start=m.group("start") if m else None,
        end=m.group("end") if m else None,
    )


def images_dir_for(dataset_dir: str) -> str:
    sub = os.path.join(dataset_dir, "images")
    return sub if os.path.isdir(sub) else dataset_dir


_index_cache: Dict[str, Tuple[float, List[ImageRecord], List[str]]] = {}


def scan_images(images_dir: str) -> Tuple[List[ImageRecord], List[str]]:
    """Labeled PNGs in the folder (trainer rules), plus raw os.listdir order for split reconstruction."""
    mtime = os.stat(images_dir).st_mtime
    hit = _index_cache.get(images_dir)
    if hit and hit[0] == mtime:
        return hit[1], hit[2]
    order = [f for f in os.listdir(images_dir) if f.endswith(".png") and "label" in f]
    recs = [parse_filename(f) for f in sorted(order)[:MAX_INDEX_IMAGES]]
    _index_cache[images_dir] = (mtime, recs, order)
    return recs, order


def image_path(images_dir: str, image_id: str) -> Optional[str]:
    """Resolve an image id (a basename) inside the dataset folder; None if unsafe or missing."""
    if not image_id or image_id != os.path.basename(image_id) or ".." in image_id or not image_id.endswith(".png"):
        return None
    path = os.path.join(images_dir, image_id)
    root = os.path.realpath(images_dir)
    real = os.path.realpath(path)
    if not real.startswith(root + os.sep) or not os.path.isfile(real):
        return None
    return real


PARTITION_NAMES = {"train": "training", "val": "validation", "test": "test"}


def recorded_partitions(trainer_dir: str) -> Optional[Dict[str, str]]:
    """Image id -> training / validation / test / excluded from the run's split manifest
    (Trainer protocol 2). None for older runs."""
    import gzip

    path = os.path.join(trainer_dir, "split_manifest.json.gz")
    try:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            manifest = json.load(f)
    except (OSError, ValueError):
        return None
    out: Dict[str, str] = {}
    for part, ids in (manifest.get("ids") or {}).items():
        for i in ids or []:
            out[str(i)] = PARTITION_NAMES.get(part, part)
    for row in manifest.get("excluded") or []:
        if isinstance(row, dict) and row.get("id"):
            out[str(row["id"])] = "excluded"
    return out or None


def split_membership(
    order: List[str],
    training_state: Dict[str, Any],
    summary: Dict[str, Any],
) -> Tuple[str, Optional[set]]:
    """Which images were held out for validation.

    ``recorded``: the trainer wrote the basenames. ``reconstructed``: re-derived from the seed and
    the current directory order — only valid if that order matches the one seen at training time,
    so it is flagged unverified. ``unknown`` otherwise.
    """
    val_files = training_state.get("val_files")
    if isinstance(val_files, list) and val_files:
        return "recorded", set(str(v) for v in val_files)
    cfg = summary.get("config") if isinstance(summary.get("config"), dict) else {}
    seed = cfg.get("random_seed")
    val_split = cfg.get("val_split")
    expected = summary.get("train_samples"), summary.get("val_samples")
    if seed is None or val_split is None or None in expected:
        return "unknown", None
    if len(order) != int(expected[0]) + int(expected[1]):
        return "unknown", None
    rng_state = np.random.get_state()
    try:
        np.random.seed(int(seed))
        idx = np.arange(len(order))
        np.random.shuffle(idx)
    finally:
        np.random.set_state(rng_state)
    shuffled = [order[i] for i in idx]
    cut = int(len(shuffled) * (1 - float(val_split)))
    val = set(shuffled[cut:])
    if len(val) != int(expected[1]):
        return "unknown", None
    return "reconstructed", val


def read_json(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


# --------------------------------------------------------------------------- single-image explain


METHOD_NOTES = {
    "gradcam": (
        "Grad-CAM: gradient of the target-class evidence (pre-activation logit) with respect to the selected "
        "convolutional layer, averaged per channel and used to weight that layer's activations; negative "
        "values are clipped. Resolution is the layer's grid, upsampled bilinearly for display. Shows where "
        "evidence for the target class is located at that layer, not why."
    ),
    "saliency": (
        "Saliency: absolute gradient of the target-class evidence with respect to each input pixel (max over "
        "RGB). Shows which pixels the score is locally most sensitive to; often noisy."
    ),
    "smoothgrad": (
        "SmoothGrad: saliency averaged over noisy copies of the input (Gaussian noise, σ = 0.1 of the [0, 1] "
        "range). Reduces gradient noise; still a local sensitivity measure."
    ),
    "occlusion": (
        "Occlusion: a square patch is replaced with the white background and the change in target-class "
        "probability is recorded at each position. Direct but coarse; depends on patch size and fill value."
    ),
    "activations": (
        "Feature maps: raw ReLU outputs of the selected layer for this image. Channels are numbered, not named; "
        "any meaning you read into a channel is an interpretation."
    ),
}


def resolve_target(lm: LoadedModel, probs: np.ndarray, target: Any) -> int:
    if target in (None, "predicted"):
        return int(np.argmax(probs))
    t = int(target)
    if t < 0 or t >= lm.n_classes:
        raise ValueError("target class out of range")
    return t


def occlusion_map(lm: LoadedModel, x: np.ndarray, target: int, patch: int = 32, stride: int = 16) -> Tuple[np.ndarray, Dict[str, Any]]:
    h, w = x.shape[:2]
    ys = list(range(0, max(1, h - patch + 1), stride))
    xs = list(range(0, max(1, w - patch + 1), stride))
    variants = []
    for y0 in ys:
        for x0 in xs:
            v = x.copy()
            v[y0 : y0 + patch, x0 : x0 + patch, :] = 1.0
            variants.append(v)
    base_p, _ = predict(lm, x[None])
    probs, _ = predict(lm, np.stack(variants))
    delta = (probs[:, target] - base_p[0, target]).reshape(len(ys), len(xs))
    return delta.astype(np.float32), {"patch": patch, "stride": stride, "fill": "white background (1.0)", "positions": len(variants)}


def explain_image(
    lm: LoadedModel,
    x: np.ndarray,
    *,
    target: Any = "predicted",
    layer: Optional[str] = None,
    methods: Sequence[str] = ("gradcam",),
    top_channels: int = 16,
    channels: Optional[Sequence[int]] = None,
) -> Dict[str, Any]:
    layer = layer or lm.last_conv
    if layer not in [c["name"] for c in lm.conv_layers]:
        raise ValueError("unknown layer")
    probs, _ = predict(lm, x[None])
    probs = probs[0]
    t = resolve_target(lm, probs, target)
    out: Dict[str, Any] = {
        "probabilities": [float(p) for p in probs],
        "predicted_class": int(np.argmax(probs)),
        "target_class": t,
        "layer": layer,
        "maps": {},
        "notes": {},
    }
    fg = foreground_mask(x)
    out["foreground_fraction"] = float(fg.mean())
    for m in methods:
        if m == "gradcam":
            cam, _ = gradcam_batch(lm, x[None], [t], layer)
            cam = cam[0]
            peak = float(cam.max())
            up = resize_map(cam, lm.input_size)
            enc = encode_map(cam, normalization="Divided by this image's maximum (0 = no positive evidence)", vmin=0.0, vmax=peak if peak > 0 else 1.0)
            enc["all_zero"] = peak <= 0
            enc["raw_max"] = peak
            enc["foreground_share"] = float((up * fg).sum() / up.sum()) if up.sum() > 0 else None
            out["maps"]["gradcam"] = enc
        elif m in ("saliency", "smoothgrad"):
            if m == "saliency":
                g = np.abs(input_gradients(lm, x[None], [t])[0]).max(axis=-1)
            else:
                rng = np.random.default_rng(0)
                noisy = np.clip(x[None] + rng.normal(0, 0.1, size=(16, *x.shape)).astype(np.float32), 0, 1)
                g = np.abs(input_gradients(lm, noisy, [t] * 16)).max(axis=-1).mean(axis=0)
            vmax = float(np.percentile(g, 99.5)) or float(g.max()) or 1.0
            enc = encode_map(g, normalization="Divided by this image's 99.5th percentile (top 0.5% clipped)", vmin=0.0, vmax=vmax)
            enc["foreground_share"] = float((g * fg).sum() / g.sum()) if g.sum() > 0 else None
            out["maps"][m] = enc
        elif m == "occlusion":
            delta, meta = occlusion_map(lm, x, t)
            lim = float(np.abs(delta).max()) or 1.0
            enc = encode_map(delta, normalization="Symmetric: mid-grey = no change; scale ±max |Δp|", vmin=-lim, vmax=lim)
            enc.update(meta)
            enc["min_delta"] = float(delta.min())
            enc["max_delta"] = float(delta.max())
            out["maps"]["occlusion"] = enc
        elif m == "activations":
            act = conv_activations(lm, x[None], layer)[0]
            means = act.mean(axis=(0, 1))
            maxes = act.max(axis=(0, 1))
            if channels:
                order = [int(c) for c in channels if 0 <= int(c) < act.shape[-1]][:64]
            else:
                order = np.argsort(-means)[: max(1, min(int(top_channels), act.shape[-1]))]
            vmax = float(act.max()) or 1.0
            out["maps"]["activations"] = {
                "layer_shape": [int(s) for s in act.shape],
                "normalization": "Shared across channels: divided by the layer's maximum for this image",
                "vmax": vmax,
                "active_channels": int((maxes > 0).sum()),
                "channels": [
                    {
                        "channel": int(c),
                        "mean": float(means[c]),
                        "max": float(maxes[c]),
                        "map": encode_map(act[..., c], normalization="shared layer max", vmin=0.0, vmax=vmax),
                    }
                    for c in order
                ],
            }
        else:
            raise ValueError(f"unknown method {m}")
        out["notes"][m] = METHOD_NOTES[m]
    return out
