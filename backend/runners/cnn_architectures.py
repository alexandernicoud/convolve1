"""Versioned CNN architectures for the Trainer.

``convolve-cnn-v1`` is the original model, layer for layer, and stays the default: a run
without an ``architecture`` key trains exactly what it trained before. Every other entry has its
own identifier, recorded in summary.json and the model manifest, so a saved model always says
which network produced it. Identifiers are never reused for a different network.

Contract shared by every architecture: RGB input scaled to [0, 1] (the shared inference
adapter's preprocessing), one sigmoid output = P(label 1), binary cross-entropy. Networks that
expect other input scaling (EfficientNet expects 0-255) convert inside the model, so the
Backtester, the paper bots and the Analysis Lab load every architecture the same way.

Two families:

    sequential   the original profiles: Conv(valid, relu) + MaxPool blocks, Flatten, Dense.
                 Flatten keeps "where" as well as "what" (the right-hand candles are the most
                 recent). Optional dropout and L2 are off by default; with defaults the model
                 is identical to the one these profiles always built.
    builder      newer networks built in code (functional Keras). They end in global average
                 pooling, which discards the horizontal position of a feature; their deeper
                 receptive fields carry some position information, but it is a real difference
                 for charts and one reason none of them is the default.

This module imports TensorFlow lazily so the API can list architectures without loading it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

DEFAULT_ARCHITECTURE = "convolve-cnn-v1"
OUTPUT_CONTRACT = "sigmoid_p_label1"


@dataclass(frozen=True)
class Architecture:
    id: str
    label: str
    description: str
    experimental: bool
    family: str = "sequential"
    # sequential family: (filters, kernel) per conv block; each block is Conv2D(relu, valid) + MaxPooling2D(2).
    conv_blocks: Tuple[Tuple[int, int], ...] = ()
    dense_units: int = 0
    # Options this architecture accepts (validated against the request).
    options: Tuple[str, ...] = ("dropout", "l2")
    default_dropout: float = 0.0
    min_input: int = 32
    supports_transfer: bool = False
    # Measured at 224 x 224 by tests/test_trainer2_architectures.py (builder family only).
    params_224: Optional[int] = None
    gflops_224: Optional[float] = None
    gradcam_layer: Optional[str] = None
    status_note: str = ""
    stages: Tuple[str, ...] = field(default_factory=tuple)


ARCHITECTURES: Dict[str, Architecture] = {
    a.id: a
    for a in (
        Architecture(
            id="convolve-cnn-v1",
            label="Original (v1)",
            description="The original Convolve CNN: 3 conv blocks (32-64-128) and a 128-unit dense layer.",
            conv_blocks=((32, 3), (64, 3), (128, 3)),
            dense_units=128,
            experimental=False,
            status_note="Compatibility baseline and default.",
        ),
        Architecture(
            id="convolve-cnn-compact-v1",
            label="Compact",
            description="4 narrow conv blocks (16-32-64-64) and a 64-unit dense layer: about 3x fewer "
            "operations and 17x fewer parameters than v1.",
            conv_blocks=((16, 3), (32, 3), (64, 3), (64, 3)),
            dense_units=64,
            experimental=False,
            status_note="Efficient baseline: on a later test period it ranked charts no better than chance, like v1, "
            "and trained about 2.3x faster (one dataset, one seed).",
        ),
        Architecture(
            id="convolve-cnn-balanced-v1",
            label="Balanced (experimental)",
            description="4 conv blocks (24-48-96-96) and a 96-unit dense layer: about 1.5x fewer "
            "operations and 8x fewer parameters than v1.",
            conv_blocks=((24, 3), (48, 3), (96, 3), (96, 3)),
            dense_units=96,
            experimental=True,
            status_note="Kept for existing runs; no measured advantage over Compact.",
        ),
        Architecture(
            id="convolve-cnn-deep-v1",
            label="Higher capacity (experimental)",
            description="5 conv blocks (32-64-128-128-256) and a 128-unit dense layer: a deeper "
            "network with more operations than v1 but fewer parameters.",
            conv_blocks=((32, 3), (64, 3), (128, 3), (128, 3), (256, 3)),
            dense_units=128,
            experimental=True,
            status_note="Kept for existing runs; collapsed to one class in the first comparison.",
        ),
        Architecture(
            id="convolve-cnn-gap-v1",
            label="Regularized GAP CNN (experimental)",
            description="5 conv blocks (16-32-64-128-256) with batch normalization, global average pooling "
            "and dropout 0.3 before the output. About half the operations of v1 and 28x fewer parameters; "
            "pooling discards horizontal position.",
            family="builder",
            experimental=True,
            default_dropout=0.3,
            params_224=394_353,
            gflops_224=0.506,
            gradcam_layer="block5_relu",
            stages=(
                "5 x [Conv 3x3 same, BatchNorm, ReLU, MaxPool 2x2] with 16-32-64-128-256 filters",
                "Global average pooling, Dropout 0.3, Dense 1 (sigmoid)",
            ),
        ),
        Architecture(
            id="convolve-resnet18-v1",
            label="ResNet18-style (experimental)",
            description="ResNet-18 layout (4 stages of 2 residual blocks, 64-128-256-512 filters) trained from "
            "scratch, global average pooling, sigmoid output. About 3.8x the operations of v1.",
            family="builder",
            experimental=True,
            min_input=64,
            params_224=11_186_625,
            gflops_224=3.627,
            gradcam_layer="stage4_block2_out",
            stages=(
                "Conv 7x7/2 64, BatchNorm, ReLU, MaxPool 3x3/2",
                "4 stages x 2 basic residual blocks (64, 128, 256, 512 filters)",
                "Global average pooling, optional Dropout, Dense 1 (sigmoid)",
            ),
        ),
        Architecture(
            id="convolve-efficientnet-b0-v1",
            label="EfficientNet-B0 (experimental)",
            description="Keras EfficientNet-B0 feature extractor with a sigmoid head. Can start from ImageNet "
            "weights (frozen or fine-tuned) or from scratch. Converts the [0, 1] input to the 0-255 range it "
            "expects inside the model.",
            family="builder",
            experimental=True,
            default_dropout=0.2,
            supports_transfer=True,
            params_224=4_050_852,
            gflops_224=0.769,
            gradcam_layer="top_activation",
            stages=(
                "Rescaling x255 (the network normalizes internally)",
                "EfficientNet-B0: stem + 16 MBConv blocks + 1x1 conv to 1280 channels",
                "Global average pooling, Dropout 0.2, Dense 1 (sigmoid)",
            ),
        ),
    )
}

# ImageNet weights for transfer learning (Keras applications release, file hash pinned by Keras).
IMAGENET_WEIGHTS = {
    "convolve-efficientnet-b0-v1": {
        "file": "efficientnetb0_notop.h5",
        "source": "keras.applications EfficientNetB0 imagenet (include_top=False)",
        "sha256": "0683edcf6151811fb3ddd6f098ac48df644d74592c4919a5acdee1c37554add2",
    }
}


def resolve(arch_id: Optional[str]) -> Architecture:
    key = (arch_id or DEFAULT_ARCHITECTURE).strip()
    if key not in ARCHITECTURES:
        raise ValueError(f"Unknown architecture '{key}'. Known: {', '.join(ARCHITECTURES)}")
    return ARCHITECTURES[key]


def check_input(arch: Architecture, img_size: Sequence[int]) -> None:
    h, w = int(img_size[0]), int(img_size[1])
    if min(h, w) < arch.min_input:
        raise ValueError(f"{arch.id}: input {h}x{w} is below its minimum of {arch.min_input} px")
    if arch.family == "sequential":
        complexity(arch, (h, w))


def public_catalog() -> List[Dict[str, Any]]:
    out = []
    for arch in ARCHITECTURES.values():
        if arch.family == "sequential":
            stats = complexity(arch, (224, 224))
            params, gflops = stats["parameters"], stats["forward_gflops"]
        else:
            params, gflops = arch.params_224, arch.gflops_224
        out.append(
            {
                "id": arch.id,
                "label": arch.label,
                "description": arch.description,
                "experimental": arch.experimental,
                "default": arch.id == DEFAULT_ARCHITECTURE,
                "family": arch.family,
                "parameters_224": params,
                "forward_gflops_224": gflops,
                "options": list(arch.options),
                "default_dropout": arch.default_dropout,
                "min_input": arch.min_input,
                "supports_transfer": arch.supports_transfer,
                "output": OUTPUT_CONTRACT,
                "status_note": arch.status_note,
                "stages": list(arch.stages),
                "gradcam_layer": arch.gradcam_layer,
            }
        )
    return out


def build_model(
    arch_id: Optional[str],
    img_size: Sequence[int],
    *,
    dropout: Optional[float] = None,
    l2: float = 0.0,
    transfer: Optional[Dict[str, Any]] = None,
):
    """Uncompiled Keras model. For a sequential profile with default options this is the same
    Sequential the trainer always built."""
    import tensorflow as tf

    arch = resolve(arch_id)
    check_input(arch, img_size)
    h, w = int(img_size[0]), int(img_size[1])
    rate = arch.default_dropout if dropout is None else float(dropout)
    reg = tf.keras.regularizers.L2(float(l2)) if l2 else None
    mode = (transfer or {}).get("mode", "scratch")
    if mode != "scratch" and not arch.supports_transfer:
        raise ValueError(f"{arch.id} has no pretrained weights; train it from scratch")

    if arch.family == "sequential":
        layers: List[Any] = [tf.keras.layers.Input(shape=(h, w, 3))]
        for filters, kernel in arch.conv_blocks:
            layers.append(tf.keras.layers.Conv2D(filters, (kernel, kernel), activation="relu", kernel_regularizer=reg))
            layers.append(tf.keras.layers.MaxPooling2D(2, 2))
        layers.append(tf.keras.layers.Flatten())
        layers.append(tf.keras.layers.Dense(arch.dense_units, activation="relu", kernel_regularizer=reg))
        if rate:
            layers.append(tf.keras.layers.Dropout(rate))
        # float32 output even under mixed precision: the sigmoid and the loss stay full precision.
        layers.append(tf.keras.layers.Dense(1, activation="sigmoid", dtype="float32", kernel_regularizer=reg))
        return tf.keras.Sequential(layers)

    if arch.id == "convolve-cnn-gap-v1":
        return _gap_cnn(tf, h, w, rate, reg)
    if arch.id == "convolve-resnet18-v1":
        return _resnet18(tf, h, w, rate, reg)
    if arch.id == "convolve-efficientnet-b0-v1":
        return _efficientnet_b0(tf, h, w, rate, reg, transfer or {"mode": "scratch"})
    raise ValueError(f"No builder for {arch.id}")


def _head(tf, x, rate: float, reg):
    x = tf.keras.layers.GlobalAveragePooling2D(name="gap")(x)
    if rate:
        x = tf.keras.layers.Dropout(rate, name="head_dropout")(x)
    return tf.keras.layers.Dense(1, activation="sigmoid", dtype="float32", kernel_regularizer=reg, name="output")(x)


def _gap_cnn(tf, h: int, w: int, rate: float, reg):
    L = tf.keras.layers
    inp = L.Input(shape=(h, w, 3), name="input")
    x = inp
    for i, filters in enumerate((16, 32, 64, 128, 256), start=1):
        x = L.Conv2D(filters, 3, padding="same", use_bias=False, kernel_regularizer=reg, name=f"block{i}_conv")(x)
        x = L.BatchNormalization(name=f"block{i}_bn")(x)
        x = L.Activation("relu", name=f"block{i}_relu")(x)
        if i < 5:
            x = L.MaxPooling2D(2, name=f"block{i}_pool")(x)
    return tf.keras.Model(inp, _head(tf, x, rate, reg), name="convolve_cnn_gap_v1")


def _resnet18(tf, h: int, w: int, rate: float, reg):
    L = tf.keras.layers

    def block(x, filters: int, stride: int, name: str):
        shortcut = x
        y = L.Conv2D(filters, 3, strides=stride, padding="same", use_bias=False, kernel_regularizer=reg, name=f"{name}_conv1")(x)
        y = L.BatchNormalization(name=f"{name}_bn1")(y)
        y = L.Activation("relu", name=f"{name}_relu1")(y)
        y = L.Conv2D(filters, 3, padding="same", use_bias=False, kernel_regularizer=reg, name=f"{name}_conv2")(y)
        y = L.BatchNormalization(name=f"{name}_bn2")(y)
        if stride != 1 or shortcut.shape[-1] != filters:
            shortcut = L.Conv2D(filters, 1, strides=stride, use_bias=False, kernel_regularizer=reg, name=f"{name}_proj")(shortcut)
            shortcut = L.BatchNormalization(name=f"{name}_proj_bn")(shortcut)
        y = L.Add(name=f"{name}_add")([y, shortcut])
        return L.Activation("relu", name=f"{name}_out")(y)

    inp = L.Input(shape=(h, w, 3), name="input")
    x = L.Conv2D(64, 7, strides=2, padding="same", use_bias=False, kernel_regularizer=reg, name="stem_conv")(inp)
    x = L.BatchNormalization(name="stem_bn")(x)
    x = L.Activation("relu", name="stem_relu")(x)
    x = L.MaxPooling2D(3, strides=2, padding="same", name="stem_pool")(x)
    for s, filters in enumerate((64, 128, 256, 512), start=1):
        for b in (1, 2):
            x = block(x, filters, 2 if (b == 1 and s > 1) else 1, f"stage{s}_block{b}")
    return tf.keras.Model(inp, _head(tf, x, rate, reg), name="convolve_resnet18_v1")


def _efficientnet_b0(tf, h: int, w: int, rate: float, reg, transfer: Dict[str, Any]):
    L = tf.keras.layers
    mode = transfer.get("mode", "scratch")
    inp = L.Input(shape=(h, w, 3), name="input")
    x = L.Rescaling(255.0, name="to_0_255")(inp)
    base = tf.keras.applications.EfficientNetB0(
        include_top=False,
        weights="imagenet" if mode != "scratch" else None,
        input_tensor=x,
    )
    if mode == "frozen":
        for layer in base.layers:
            layer.trainable = False
    elif mode == "fine_tune":
        n = int(transfer.get("trainable_layers", 20))
        trainable_from = max(0, len(base.layers) - n)
        for i, layer in enumerate(base.layers):
            # BatchNorm statistics stay frozen when fine-tuning a pretrained network: small batches
            # of charts would otherwise overwrite the ImageNet statistics.
            layer.trainable = i >= trainable_from and not isinstance(layer, L.BatchNormalization)
    if reg is not None:
        for layer in base.layers:
            if isinstance(layer, (L.Conv2D, L.DepthwiseConv2D)) and layer.trainable:
                attr = "depthwise_regularizer" if isinstance(layer, L.DepthwiseConv2D) else "kernel_regularizer"
                setattr(layer, attr, reg)
    return tf.keras.Model(inp, _head(tf, base.output, rate, reg), name="convolve_efficientnet_b0_v1")


def count_flops(model) -> float:
    """Forward GFLOPs (2 per multiply-accumulate) of Conv2D, DepthwiseConv2D and Dense layers."""
    import tensorflow as tf

    L = tf.keras.layers
    total = 0
    for layer in _all_layers(model):
        if isinstance(layer, L.DepthwiseConv2D):
            out = layer.output.shape
            kh, kw = layer.kernel_size
            total += 2 * out[1] * out[2] * kh * kw * out[3]
        elif isinstance(layer, L.Conv2D):
            out = layer.output.shape
            kh, kw = layer.kernel_size
            cin = layer.input.shape[-1]
            total += 2 * out[1] * out[2] * kh * kw * cin * out[3] // max(1, layer.groups)
        elif isinstance(layer, L.Dense):
            total += 2 * layer.input.shape[-1] * layer.units
    return total / 1e9


def _all_layers(model) -> List[Any]:
    out = []
    for layer in model.layers:
        if hasattr(layer, "layers") and layer.layers:
            out.extend(_all_layers(layer))
        else:
            out.append(layer)
    return out


def layer_summary(model) -> List[Dict[str, Any]]:
    """Name, type, output shape and parameter count per layer of a built model."""
    rows = []
    for layer in model.layers:
        try:
            shape = [d for d in tuple(layer.output.shape)[1:]]
        except Exception:  # noqa: BLE001
            shape = None
        rows.append(
            {
                "name": layer.name,
                "type": layer.__class__.__name__,
                "shape": shape,
                "params": int(layer.count_params()),
                "trainable": bool(layer.trainable),
            }
        )
    return rows


def complexity(arch: Architecture, img_size: Sequence[int]) -> Dict[str, Any]:
    """Analytic parameter count and multiply-accumulate FLOPs (2 per MAC) for one forward pass
    of a sequential profile."""
    if arch.family != "sequential":
        return {
            "architecture": arch.id,
            "image_size": [int(img_size[0]), int(img_size[1])],
            "parameters": arch.params_224,
            "forward_gflops": arch.gflops_224,
            "measured_at": [224, 224],
        }
    h, w, c = int(img_size[0]), int(img_size[1]), 3
    rows: List[Dict[str, Any]] = []
    for filters, k in arch.conv_blocks:
        oh, ow = h - k + 1, w - k + 1
        if oh < 2 or ow < 2:
            raise ValueError(f"{arch.id}: input {img_size} is too small for its conv blocks")
        params = (k * k * c + 1) * filters
        flops = 2 * oh * ow * filters * k * k * c
        rows.append({"layer": f"conv{k}x{k}x{filters}", "output": [oh, ow, filters], "params": params, "flops": flops})
        h, w, c = oh // 2, ow // 2, filters
        rows.append({"layer": "maxpool2", "output": [h, w, c], "params": 0, "flops": oh * ow * filters})
    flat = h * w * c
    for units, name in ((arch.dense_units, f"dense{arch.dense_units}"), (1, "dense1_sigmoid")):
        rows.append({"layer": name, "output": [units], "params": (flat + 1) * units, "flops": 2 * flat * units})
        flat = units
    params = sum(r["params"] for r in rows)
    flops = sum(r["flops"] for r in rows)
    return {
        "architecture": arch.id,
        "image_size": [int(img_size[0]), int(img_size[1])],
        "parameters": params,
        "forward_gflops": round(flops / 1e9, 3),
        # Backward pass costs about twice the forward pass.
        "train_gflops_per_image": round(3 * flops / 1e9, 3),
        "flatten_features": h * w * c,
        "layers": rows,
    }
