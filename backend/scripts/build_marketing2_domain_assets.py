"""Build the "same filters, two domains" figure for the marketing site (Home, section 03).

An MRI template slice and a Convolve chart go through the same pretrained layer of EfficientNet-B0
(keras.applications, ImageNet weights) - the network the Trainer offers for transfer learning.

The MRI is the MNI ICBM152 2009a symmetric T1 template: a population average with no individual subject.
Its licence requires this notice in all copies:
    Copyright (C) 1993-2004 Louis Collins, McConnell Brain Imaging Centre,
    Montreal Neurological Institute, McGill University.

Usage (the template ships with nilearn, nilearn/datasets/data/):
    python backend/scripts/build_marketing2_domain_assets.py \
        --template mni_icbm152_t1_tal_nlin_sym_09a_converted.nii.gz
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2] / "src" / "features" / "marketing2"
LAYER = "block2b_expand_activation"
CHANNELS = [99, 7, 126]
SLICE_Z = 96
SIZE = 224
COPYRIGHT = (
    "Copyright (C) 1993-2004 Louis Collins, McConnell Brain Imaging Centre, "
    "Montreal Neurological Institute, McGill University."
)


def mri_slice(path: str) -> np.ndarray:
    import nibabel as nib

    data = np.asarray(nib.load(path).dataobj, dtype=np.float32)
    sl = np.rot90(data[:, :, SLICE_Z])
    ys, xs = np.where(sl > sl.max() * 0.05)
    pad = 4
    sl = sl[max(ys.min() - pad, 0): ys.max() + pad, max(xs.min() - pad, 0): xs.max() + pad]
    h, w = sl.shape
    side = max(h, w)
    sq = np.zeros((side, side), np.float32)
    sq[(side - h) // 2:(side - h) // 2 + h, (side - w) // 2:(side - w) // 2 + w] = sl
    sq = np.clip(sq / np.percentile(sq[sq > 0], 99.5), 0, 1)
    return np.array(Image.fromarray((sq * 255).astype(np.uint8)).resize((SIZE, SIZE), Image.LANCZOS))


def contrast(m: np.ndarray) -> np.ndarray:
    lo, hi = np.percentile(m, 1), np.percentile(m, 99.5)
    return np.clip((m - lo) / (hi - lo + 1e-8), 0, 1)


def inferno(v: np.ndarray) -> np.ndarray:
    stops = json.loads((ROOT / "data" / "labmaps.json").read_text())["colormaps"]["sequential"]["stops"]
    rgb = np.array([[int(s[i:i + 2], 16) for i in (1, 3, 5)] for s in stops], np.float32) / 255
    x = np.clip(v, 0, 1) * (len(rgb) - 1)
    lo = np.floor(x).astype(int).clip(0, len(rgb) - 2)
    t = (x - lo)[..., None]
    return rgb[lo] * (1 - t) + rgb[lo + 1] * t


def overlay(gray: np.ndarray, heat: np.ndarray, alpha: np.ndarray) -> Image.Image:
    """Heat map in the site's inferno scale over a dimmed grayscale image, as in the Analysis Lab view."""
    a = np.clip(alpha, 0, 1)[..., None] * 0.9
    out = (gray[..., None] / 255 * 0.35) * (1 - a) + inferno(heat) * a
    return Image.fromarray((out * 255).astype(np.uint8))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--template", required=True, help="MNI ICBM152 2009a sym T1 NIfTI")
    args = ap.parse_args()

    import tensorflow as tf

    assets, data_dir = ROOT / "assets", ROOT / "data"
    mri = mri_slice(args.template)
    # Decode like the Trainer decodes chart PNGs (dataset_shards.py): RGB, area resize.
    chart = tf.image.decode_png(tf.io.read_file(str(assets / "trace_input.png")), channels=3)
    chart = tf.image.resize(chart, (SIZE, SIZE), method="area").numpy().astype(np.float32)

    base = tf.keras.applications.EfficientNetB0(weights="imagenet", include_top=True, input_shape=(SIZE, SIZE, 3))
    probe = tf.keras.Model(base.input, base.get_layer(LAYER).output)
    mri_rgb = np.repeat(mri[..., None], 3, -1).astype(np.float32)
    # Keras EfficientNet takes 0-255 input and rescales internally.
    maps = probe.predict(np.stack([mri_rgb, chart]), verbose=0)

    # MRI Grad-CAM: EfficientNet-B0's own top ImageNet class (no medical model exists here; method only).
    cam_model = tf.keras.Model(base.input, [base.get_layer("top_activation").output, base.output])
    with tf.GradientTape() as tape:
        act, preds = cam_model(mri_rgb[None])
        score = preds[0, int(tf.argmax(preds[0]))]
    weights = tf.reduce_mean(tape.gradient(score, act), axis=(1, 2))
    cam = tf.nn.relu(tf.reduce_sum(act * weights[:, None, None, :], axis=-1))[0].numpy()
    cam = np.array(Image.fromarray(cam / (cam.max() + 1e-8)).resize((SIZE, SIZE), Image.BILINEAR))
    brain = (mri > 8).astype(np.float32)
    overlay(mri, cam * brain, cam * brain).save(assets / "domain_mri_gradcam.png", optimize=True)

    # Chart Grad-CAM: the Convolve CNN's real map for this exact chart (Analysis Lab, labmaps.json sample 3).
    lab = np.asarray(Image.open(assets / "lab_3_gradcam.png").convert("RGBA"), dtype=np.float32) / 255
    base_l = chart.mean(-1)
    out_rgb = (base_l[..., None] / 255 * 0.35) * (1 - lab[..., 3:]) + lab[..., :3] * lab[..., 3:]
    Image.fromarray((out_rgb * 255).astype(np.uint8)).save(assets / "domain_chart_gradcam.png", optimize=True)

    Image.fromarray(mri).save(assets / "domain_mri.png", optimize=True)
    Image.fromarray(chart.astype(np.uint8)).convert("L").save(assets / "domain_chart.png", optimize=True)
    files: dict[str, list[str]] = {"mri": [], "chart": []}
    for k in CHANNELS:
        for i, name in ((0, "mri"), (1, "chart")):
            f = f"domain_{name}_c{k:03d}.png"
            Image.fromarray((contrast(maps[i, :, :, k]) * 255).astype(np.uint8)).save(assets / f, optimize=True)
            files[name].append(f)

    out = {
        "provenance": "Both images passed through the same pretrained layer of EfficientNet-B0 (keras.applications, "
        "ImageNet weights), the network Convolve's Trainer offers for transfer learning. Same channels, per-map contrast stretch.",
        "layer": LAYER,
        "size": int(maps.shape[1]),
        "channels": CHANNELS,
        "mri": {
            "input": "domain_mri.png",
            "maps": files["mri"],
            "source": f"MNI ICBM152 2009a symmetric T1 template, axial slice z={SLICE_Z}. "
            "A population average of 152 adults; contains no individual subject.",
            "copyright": COPYRIGHT,
            "gradcam": "domain_mri_gradcam.png",
            "gradcam_source": "EfficientNet-B0 top ImageNet class, top_activation (7 x 7). Illustrates the method; not a diagnosis.",
        },
        "chart": {
            "input": "domain_chart.png",
            "maps": files["chart"],
            "source": "trace_input.png, decoded as the Trainer decodes chart PNGs (RGB).",
            "gradcam": "domain_chart_gradcam.png",
            "gradcam_source": "Convolve CNN trained on MSFT charts, conv2d_2 (52 x 52); lab_3_gradcam.png from the Analysis Lab.",
        },
    }
    (data_dir / "domain.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
