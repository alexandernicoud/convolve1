"""
CNN analysis runner: TensorFlow interpretability with JSON-first artifacts for dashboard UI,
plus clean PNG fallbacks for download and legacy clients.
"""
from __future__ import annotations

import json
import os
import time
import zipfile
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import cv2
import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
import tensorflow as tf
from matplotlib.colors import LinearSegmentedColormap
from tensorflow.keras import Model

# ========= UNIFIED COLORMAP (fallback PNG + frontend reference) =========
CONVOLVE_CMAP = LinearSegmentedColormap.from_list(
    "convolve_cmap",
    [
        (0.00, "#05040D"),
        (0.18, "#1B1464"),
        (0.40, "#2E3AEE"),
        (0.62, "#8B5CF6"),
        (0.82, "#EC4899"),
        (1.00, "#FFD1F2"),
    ],
    N=256,
)

CONVOLVE_COLORSCALE_HEX = [
    "#05040D", "#1B1464", "#2E3AEE", "#8B5CF6", "#EC4899", "#FFD1F2",
]

# Max dimension for JSON matrix payloads (compact but usable in canvas)
JSON_MAX_DIM = 256
# Cap channel tiles embedded in JSON (full layer may have many maps)
MAX_JSON_ACTIVATION_MAPS_FIRST_LAYER = 32
MAX_JSON_ACTIVATION_MAPS_OTHER = 8

# ========= STYLING (matplotlib fallbacks only) =========
PALETTE = {
    "fg": "#E7E9FF",
    "muted": "#9AA3C7",
    "purple": "#8B5CF6",
    "blue": "#3B82F6",
    "pink": "#EC4899",
}


def apply_dark_style() -> None:
    plt.style.use("dark_background")
    mpl.rcParams.update(
        {
            "figure.facecolor": "none",
            "axes.facecolor": "none",
            "savefig.facecolor": "none",
            "text.color": PALETTE["fg"],
            "axes.labelcolor": PALETTE["muted"],
            "xtick.color": PALETTE["muted"],
            "ytick.color": PALETTE["muted"],
            "axes.edgecolor": "none",
            "font.family": "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial",
        }
    )


def save_fig_png(path_png: str, fig=None) -> None:
    if fig is None:
        fig = plt.gcf()
    fig.patch.set_alpha(0.0)
    for ax in fig.axes:
        ax.set_facecolor("none")
        ax.axis("off")
        for spine in ax.spines.values():
            spine.set_visible(False)
        ax.set_xticks([])
        ax.set_yticks([])
    plt.tight_layout(pad=0.05)
    fig.savefig(path_png, format="png", transparent=True, bbox_inches="tight", pad_inches=0.02, dpi=200)


# ========= SERIALIZATION HELPERS =========


def to_serializable_float_matrix(arr: np.ndarray, decimals: int = 5) -> List[List[float]]:
    """2D numpy → JSON-safe nested lists (rounded for size)."""
    if arr.ndim != 2:
        raise ValueError("Expected 2D array")
    a = np.asarray(arr, dtype=np.float64)
    if decimals >= 0:
        a = np.round(a, decimals)
    return a.tolist()


def downsample_2d(arr: np.ndarray, max_dim: int = JSON_MAX_DIM) -> np.ndarray:
    """Area downsample if larger than max_dim on longest side."""
    a = np.asarray(arr, dtype=np.float32)
    if a.ndim != 2:
        raise ValueError("Expected 2D array")
    h, w = a.shape
    if max(h, w) <= max_dim:
        return a
    scale = max_dim / float(max(h, w))
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    return cv2.resize(a, (nw, nh), interpolation=cv2.INTER_AREA).astype(np.float32)


def normalize_map(
    arr: np.ndarray, clip_percentile: Optional[float] = 99.0
) -> Tuple[np.ndarray, Dict[str, float]]:
    """Min–max normalize to [0,1], optional display clip metadata (on normalized values)."""
    a = np.asarray(arr, dtype=np.float32)
    lo = float(np.min(a))
    hi = float(np.max(a))
    if hi - lo < 1e-12:
        out = np.zeros_like(a, dtype=np.float32)
        meta = {"vmin": lo, "vmax": hi, "display_vmax": 1.0}
        return out, meta
    out = (a - lo) / (hi - lo + 1e-8)
    meta: Dict[str, float] = {"vmin": lo, "vmax": hi}
    if clip_percentile is not None:
        meta["display_vmax"] = float(np.percentile(out, clip_percentile))
    else:
        meta["display_vmax"] = 1.0
    meta["display_vmin"] = 0.0
    return out.astype(np.float32), meta


def save_matrix_json(
    out_dir: Path,
    filename: str,
    *,
    matrix: np.ndarray,
    type_name: str,
    title: str,
    subtitle: str,
    tags: List[str],
    layer_name: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
    max_dim: int = JSON_MAX_DIM,
) -> None:
    """Save a single 2D normalized matrix artifact."""
    m = downsample_2d(matrix, max_dim)
    norm, disp = normalize_map(m, clip_percentile=99.0)
    payload: Dict[str, Any] = {
        "type": type_name,
        "title": title,
        "subtitle": subtitle,
        "tags": tags,
        "width": int(norm.shape[1]),
        "height": int(norm.shape[0]),
        "values": to_serializable_float_matrix(norm),
        "display_range": {
            "vmin": disp.get("display_vmin", 0.0),
            "vmax": disp.get("display_vmax", 1.0),
        },
        "colorscale_hint": CONVOLVE_COLORSCALE_HEX,
    }
    if layer_name is not None:
        payload["layer_name"] = layer_name
    if extra:
        payload.update(extra)
    path = out_dir / filename
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))


def save_multi_map_json(
    out_dir: Path,
    filename: str,
    *,
    type_name: str,
    layer_name: str,
    title: str,
    subtitle: str,
    tags: List[str],
    selected_maps: List[Tuple[int, np.ndarray]],
    mean_map: Optional[np.ndarray] = None,
    max_dim: int = JSON_MAX_DIM,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    """Bundle multiple 2D maps (e.g. feature activations) in one JSON file."""
    items: List[Dict[str, Any]] = []
    for idx, arr in selected_maps:
        m = downsample_2d(arr, max_dim)
        norm, disp = normalize_map(m, clip_percentile=99.0)
        items.append(
            {
                "index": int(idx),
                "width": int(norm.shape[1]),
                "height": int(norm.shape[0]),
                "values": to_serializable_float_matrix(norm),
                "display_range": {
                    "vmin": disp.get("display_vmin", 0.0),
                    "vmax": disp.get("display_vmax", 1.0),
                },
            }
        )

    payload: Dict[str, Any] = {
        "type": type_name,
        "layer_name": layer_name,
        "title": title,
        "subtitle": subtitle,
        "tags": tags,
        "map_count": len(selected_maps),
        "selected_maps": items,
        "colorscale_hint": CONVOLVE_COLORSCALE_HEX,
    }
    if mean_map is not None:
        mm = downsample_2d(mean_map, max_dim)
        nmm, dmm = normalize_map(mm, clip_percentile=99.0)
        payload["mean_map"] = {
            "width": int(nmm.shape[1]),
            "height": int(nmm.shape[0]),
            "values": to_serializable_float_matrix(nmm),
            "display_range": {
                "vmin": dmm.get("display_vmin", 0.0),
                "vmax": dmm.get("display_vmax", 1.0),
            },
        }
    if extra:
        payload.update(extra)

    with open(out_dir / filename, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))


def save_filter_bundle_json(
    out_dir: Path,
    layer_name: str,
    weights_4d: np.ndarray,
    n_show: int,
    global_vmin: float,
    global_vmax: float,
) -> str:
    """Export learned filters as 2D slices (mean over input depth), normalized per global range."""
    w = weights_4d
    n = min(n_show, w.shape[-1])
    selected: List[Tuple[int, np.ndarray]] = []
    for j in range(n):
        f2 = np.mean(w[:, :, :, j], axis=-1).astype(np.float32)
        if global_vmax - global_vmin > 1e-12:
            f2n = (f2 - global_vmin) / (global_vmax - global_vmin + 1e-8)
        else:
            f2n = np.zeros_like(f2)
        f2n = np.clip(f2n, 0.0, 1.0)
        f2n = downsample_2d(f2n, JSON_MAX_DIM)
        selected.append((j, f2n))

    fname = f"learned_filters_{layer_name}.json"
    payload: Dict[str, Any] = {
        "type": "learned_filters",
        "layer_name": layer_name,
        "title": "Kernel response field",
        "subtitle": "Learned convolutional patterns for this layer.",
        "tags": ["convolution", "weights", "pattern"],
        "map_count": n,
        "selected_maps": [
            {
                "index": int(idx),
                "width": int(arr.shape[1]),
                "height": int(arr.shape[0]),
                "values": to_serializable_float_matrix(arr),
                "display_range": {"vmin": 0.0, "vmax": 1.0},
            }
            for idx, arr in selected
        ],
        "colorscale_hint": CONVOLVE_COLORSCALE_HEX,
        "weight_range": {"vmin": float(global_vmin), "vmax": float(global_vmax)},
    }
    with open(out_dir / fname, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
    return fname


def _imshow_fallback_png(path: Path, data: np.ndarray, cmap=CONVOLVE_CMAP, vmin: float = 0.0, vmax: Optional[float] = None) -> None:
    """Single clean heatmap PNG, no title, no colorbar."""
    if vmax is None:
        vmax = float(np.percentile(data, 99)) if data.size else 1.0
    fig, ax = plt.subplots(figsize=(4, 4))
    ax.imshow(data, cmap=cmap, vmin=vmin, vmax=max(vmax, vmin + 1e-8), aspect="auto")
    save_fig_png(str(path), fig)
    plt.close(fig)


def _save_chart_reference_png(out_dir: Path, img_arr_chw: np.ndarray) -> str:
    """RGB uint8 chart image for frontend underlay (legacy path name)."""
    name = "analysis_input_rgb.png"
    rgb = np.clip(img_arr_chw * 255.0, 0, 255).astype(np.uint8)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    cv2.imwrite(str(out_dir / name), bgr)
    return name


def run_cnn_analysis(config: Dict[str, Any], run_dir: str, progress_cb: Callable):
    """Run CNN analysis; primary outputs are JSON matrices + manifest; PNGs are fallback."""

    model_path = config["model_path"]
    img_path = config.get("img_path", None)
    img_size = tuple(config.get("img_size", [224, 224]))
    analysis_id = config.get("analysis_id", "default")
    run_dir_path = Path(run_dir)
    out_dir = run_dir_path / "analysis" / analysis_id

    apply_dark_style()

    progress_cb("starting", 0, {"message": "Starting CNN analysis..."})

    manifest_artifacts: List[Dict[str, Any]] = []

    def add_manifest_entry(
        artifact_id: str,
        artifact_type: str,
        render_mode: str,
        title: str,
        subtitle: str,
        tags: List[str],
        json_file: Optional[str] = None,
        png_file: Optional[str] = None,
        layer_name: Optional[str] = None,
        legacy_keys: Optional[List[str]] = None,
    ) -> None:
        entry: Dict[str, Any] = {
            "id": artifact_id,
            "type": artifact_type,
            "render_mode": render_mode,
            "title": title,
            "subtitle": subtitle,
            "tags": tags,
        }
        if layer_name is not None:
            entry["layer_name"] = layer_name
        if json_file:
            entry["json_file"] = json_file
        if png_file:
            entry["png_file"] = png_file
        if legacy_keys:
            entry["legacy_compatibility"] = legacy_keys
        manifest_artifacts.append(entry)

    try:
        out_dir.mkdir(parents=True, exist_ok=True)

        progress_cb("loading", 10, {"message": "Loading trained model..."})
        model = tf.keras.models.load_model(model_path)

        def get_seq_or_inner(m):
            if isinstance(m, tf.keras.Sequential):
                return m
            try:
                return m.get_layer("sequential")
            except Exception:
                return m

        seq = get_seq_or_inner(model)

        if not img_path:
            trainer_folder = config.get("trainer_folder", "")
            if trainer_folder and os.path.exists(trainer_folder):
                png_files = [f for f in os.listdir(trainer_folder) if f.endswith(".png")]
                if png_files:
                    img_path = os.path.join(trainer_folder, png_files[0])
                else:
                    raise FileNotFoundError("No PNG images found in training folder")
            else:
                raise FileNotFoundError("No image path provided and no training folder available")

        progress_cb("loading", 20, {"message": "Loading and preprocessing image..."})
        img = tf.keras.utils.load_img(img_path, target_size=img_size)
        img_arr = tf.keras.utils.img_to_array(img)
        img_arr = np.expand_dims(img_arr, axis=0) / 255.0

        chart_file = _save_chart_reference_png(out_dir, img_arr[0])

        def list_conv_layers(sequence):
            return [lyr for lyr in sequence.layers if isinstance(lyr, tf.keras.layers.Conv2D)]

        conv_layers = list_conv_layers(seq)

        def build_forward_upto(sequence, target_layer_name, img_shape):
            inp = tf.keras.Input(shape=(img_shape[0], img_shape[1], 3))
            x = inp
            for lyr in sequence.layers:
                x = lyr(x)
                if lyr.name == target_layer_name:
                    break
            return Model(inputs=inp, outputs=x)

        # —— Filters: JSON bundle + minimal fallback PNG ——
        progress_cb("analyzing", 30, {"message": "Generating filter visualizations..."})
        all_w = []
        for L in conv_layers:
            w, _ = L.get_weights()
            all_w.append(w.flatten())
        all_w_flat = np.concatenate(all_w)
        global_wmin, global_wmax = float(all_w_flat.min()), float(all_w_flat.max())

        for L in conv_layers:
            w, _ = L.get_weights()
            n = min(w.shape[-1], 8)
            jname = save_filter_bundle_json(out_dir, L.name, w, n, global_wmin, global_wmax)
            add_manifest_entry(
                f"learned_filters_{L.name}",
                "learned_filters",
                "json",
                "Kernel response field",
                f"Convolutional basis for layer {L.name}.",
                ["convolution", "weights", "pattern"],
                json_file=jname,
                png_file=f"filter_{L.name}.png",
                layer_name=L.name,
                legacy_keys=[f"filter_{L.name}.png"],
            )

            # Fallback: montage without titles/colorbars (single axes composite)
            cols = min(4, n)
            rows = int(np.ceil(n / cols))
            fig, axes = plt.subplots(rows, cols, figsize=(2.2 * cols, 2.2 * rows))
            if n == 1:
                axes = [axes]
            else:
                axes = np.atleast_1d(axes).flatten()
            for j in range(n):
                f2 = np.mean(w[:, :, :, j], axis=-1)
                axes[j].imshow(f2, cmap=CONVOLVE_CMAP, vmin=global_wmin, vmax=global_wmax, aspect="auto")
            for j in range(n, len(axes)):
                axes[j].axis("off")
            save_fig_png(str(out_dir / f"filter_{L.name}.png"), fig)
            plt.close(fig)

        # —— Activations: JSON per layer + fallback PNG ——
        progress_cb("analyzing", 50, {"message": "Generating activation maps..."})
        for idx, L in enumerate(conv_layers):
            act_model = build_forward_upto(seq, L.name, img_size)
            acts = act_model.predict(img_arr, verbose=0)
            fmaps = acts.shape[-1]

            mean_act = np.mean(acts[0], axis=-1)
            mean_json = f"mean_activation_{L.name}.json"
            save_matrix_json(
                out_dir,
                mean_json,
                matrix=mean_act,
                type_name="mean_activation",
                title="Mean channel energy",
                subtitle="Average activation strength across channels at this depth.",
                tags=["activation", "aggregate", "layer"],
                layer_name=L.name,
            )
            add_manifest_entry(
                f"mean_activation_{L.name}",
                "mean_activation",
                "json",
                "Mean channel energy",
                "Spatial average of channel activations.",
                ["activation", "mean", "layer"],
                json_file=mean_json,
                png_file=f"mean_activation_{L.name}.png",
                layer_name=L.name,
                legacy_keys=[f"mean_activation_{L.name}.png"],
            )
            _imshow_fallback_png(out_dir / f"mean_activation_{L.name}.png", mean_act)

            if idx == 0:
                n_cap = min(fmaps, MAX_JSON_ACTIVATION_MAPS_FIRST_LAYER)
                indices = list(range(n_cap))
                indices_png = list(range(fmaps))
            else:
                n_show = min(fmaps, MAX_JSON_ACTIVATION_MAPS_OTHER)
                indices = list(range(n_show))
                indices_png = list(indices)

            selected = [(i, acts[0, :, :, i]) for i in indices]
            act_json = f"activations_{L.name}.json"
            save_multi_map_json(
                out_dir,
                act_json,
                type_name="feature_activations",
                layer_name=L.name,
                title="Feature map mosaic",
                subtitle="Selected channel responses for this layer.",
                tags=["activation", "channels", "spatial"],
                selected_maps=selected,
                mean_map=mean_act,
            )
            add_manifest_entry(
                f"feature_activations_{L.name}",
                "feature_activations",
                "json",
                "Feature map mosaic",
                "Individual channel activations and mean field.",
                ["activation", "maps", "layer"],
                json_file=act_json,
                png_file=f"activations_{L.name}.png",
                layer_name=L.name,
                legacy_keys=[f"activations_{L.name}.png"],
            )

            # Fallback PNG: grid, no titles/colorbars (may show more maps than JSON)
            n_plot = len(indices_png)
            cols = min(8, n_plot) if idx == 0 else min(4, max(n_plot, 1))
            rows = int(np.ceil(n_plot / max(cols, 1)))
            fig, axes = plt.subplots(rows, cols, figsize=(1.8 * cols, 1.8 * rows))
            axes = np.atleast_1d(axes).flatten()
            for ax_i, mi in enumerate(indices_png):
                a = acts[0, :, :, mi]
                vmax = float(np.percentile(a, 99))
                axes[ax_i].imshow(a, cmap=CONVOLVE_CMAP, vmin=0, vmax=max(vmax, 1e-8), aspect="auto")
            for ax_i in range(n_plot, len(axes)):
                axes[ax_i].axis("off")
            save_fig_png(str(out_dir / f"activations_{L.name}.png"), fig)
            plt.close(fig)

        # —— Grad-CAM ——
        progress_cb("analyzing", 70, {"message": "Generating Grad-CAM analysis..."})
        last_conv = conv_layers[-1].name

        inp_gc = tf.convert_to_tensor(img_arr, dtype=tf.float32)
        grad_model = build_forward_upto(seq, last_conv, img_size)

        with tf.GradientTape() as tape:
            tape.watch(inp_gc)
            conv_out = grad_model(inp_gc)
            x = conv_out
            passed = False
            for lyr in seq.layers:
                if lyr.name == last_conv:
                    passed = True
                    continue
                if passed:
                    x = lyr(x)
            preds = x
            loss = tf.reduce_sum(preds)

        grads = tape.gradient(loss, conv_out)
        pooled = tf.reduce_mean(grads, axis=(0, 1, 2))
        heat = tf.reduce_mean(conv_out * pooled, axis=-1)[0].numpy()
        heat = (heat - heat.min()) / (heat.max() - heat.min() + 1e-8)

        heat_full = tf.image.resize(heat[..., np.newaxis], img_size, method="bilinear").numpy().squeeze().astype(np.float32)

        white_thresh = config.get("white_mask_thresh", 0.96)
        if white_thresh is not None:
            mask_bg = (img_arr[0] > white_thresh).all(axis=-1).astype(np.float32)
        else:
            mask_bg = np.zeros(img_size, dtype=np.float32)

        # activation_field.json (product) + legacy naming alias file
        save_matrix_json(
            out_dir,
            "activation_field.json",
            matrix=heat_full,
            type_name="activation_field",
            title="Class activation field",
            subtitle="Normalized spatial importance before blending with the chart.",
            tags=["grad-cam", "heatmap", "spatial"],
            layer_name=last_conv,
            extra={"legacy_json_alias": "gradcam_raw.json"},
        )
        # Duplicate legacy filename for compatibility
        raw_payload = json.loads((out_dir / "activation_field.json").read_text(encoding="utf-8"))
        raw_payload["type"] = "gradcam_raw"
        with open(out_dir / "gradcam_raw.json", "w", encoding="utf-8") as f:
            json.dump(raw_payload, f, separators=(",", ":"))

        add_manifest_entry(
            "activation_field",
            "activation_field",
            "json",
            "Class activation field",
            "Spatial class activation (Grad-CAM) as a normalizable heatmap.",
            ["grad-cam", "heatmap", "core"],
            json_file="activation_field.json",
            png_file="gradcam_raw.png",
            layer_name=last_conv,
            legacy_keys=["gradcam_raw.png", "gradcam_raw.json"],
        )

        _imshow_fallback_png(out_dir / "gradcam_raw.png", heat_full)

        # Convolve colormap overlay for fallback PNG (not JET)
        h99 = float(np.percentile(heat_full, 99)) + 1e-8
        norm_h = np.clip(heat_full / h99, 0.0, 1.0)
        heat_rgba = (CONVOLVE_CMAP(norm_h)[:, :, :3] * 255.0).astype(np.uint8)
        heat_bgr = cv2.cvtColor(heat_rgba, cv2.COLOR_RGB2BGR)
        base_rgb = np.uint8(img_arr[0] * 255)
        base_bgr = cv2.cvtColor(base_rgb, cv2.COLOR_RGB2BGR)
        overlay_bgr = cv2.addWeighted(base_bgr, 0.62, heat_bgr, 0.38, 0)
        if white_thresh is not None:
            m3 = np.stack([mask_bg] * 3, axis=-1) > 0.5
            overlay_bgr = np.where(m3, base_bgr, overlay_bgr)

        overlay_rgb = cv2.cvtColor(overlay_bgr, cv2.COLOR_BGR2RGB)
        fig, ax = plt.subplots(figsize=(4.5, 4.5))
        ax.imshow(overlay_rgb, aspect="auto")
        save_fig_png(str(out_dir / "gradcam_overlay.png"), fig)
        plt.close(fig)

        heat_ds = downsample_2d(heat_full, JSON_MAX_DIM)
        mask_fg = (1.0 - mask_bg).astype(np.float32)
        mask_ds = downsample_2d(mask_fg, JSON_MAX_DIM) if float(np.max(mask_bg)) > 0 else None

        overlay_json: Dict[str, Any] = {
            "type": "attention_overlay",
            "layer_name": last_conv,
            "title": "Attention overlay",
            "subtitle": "Blend heatmap with the input chart in the product UI.",
            "tags": ["overlay", "interpretability", "chart"],
            "width": int(heat_ds.shape[1]),
            "height": int(heat_ds.shape[0]),
            "heatmap": {
                "width": int(heat_ds.shape[1]),
                "height": int(heat_ds.shape[0]),
                "values": to_serializable_float_matrix(heat_ds),
                "display_range": {"vmin": 0.0, "vmax": float(np.percentile(heat_ds, 99))},
            },
            "chart_image_file": chart_file,
            "mask_values": to_serializable_float_matrix(mask_ds) if mask_ds is not None else None,
            "mask_description": "1 = chart foreground, 0 = masked background (e.g. white sheet). Same grid as heatmap after resize.",
            "blend": {
                "heatmap_alpha": 0.38,
                "chart_alpha": 1.0,
                "mode": "normal",
                "note": "Frontend should apply Convolve colorscale to heatmap values before alpha blend.",
            },
            "colorscale_hint": CONVOLVE_COLORSCALE_HEX,
        }
        with open(out_dir / "attention_overlay.json", "w", encoding="utf-8") as f:
            json.dump(overlay_json, f, separators=(",", ":"))
        with open(out_dir / "gradcam_overlay.json", "w", encoding="utf-8") as f:
            json.dump({**overlay_json, "type": "gradcam_overlay"}, f, separators=(",", ":"))

        add_manifest_entry(
            "attention_overlay",
            "attention_overlay",
            "json",
            "Attention overlay",
            "Heatmap + chart reference for native blending.",
            ["overlay", "chart", "attention"],
            json_file="attention_overlay.json",
            png_file="gradcam_overlay.png",
            layer_name=last_conv,
            legacy_keys=["gradcam_overlay.png", "gradcam_overlay.json"],
        )

        # —— Saliency ——
        progress_cb("analyzing", 90, {"message": "Generating saliency map..."})
        inp_tensor = tf.convert_to_tensor(img_arr, dtype=tf.float32)
        with tf.GradientTape() as tape:
            tape.watch(inp_tensor)
            out = model(inp_tensor)
            loss = tf.reduce_sum(out)
        grads_in = tape.gradient(loss, inp_tensor)
        sal = tf.reduce_max(tf.abs(grads_in[0]), axis=-1).numpy()
        if sal.max() > 0:
            sal = sal / (sal.max() + 1e-8)
        sal = np.power(sal, 0.5).astype(np.float32)

        save_matrix_json(
            out_dir,
            "input_sensitivity.json",
            matrix=sal,
            type_name="input_sensitivity",
            title="Input sensitivity",
            subtitle="Where small input changes most affect the output.",
            tags=["saliency", "gradient", "pixels"],
        )
        sal_legacy = json.loads((out_dir / "input_sensitivity.json").read_text(encoding="utf-8"))
        sal_legacy["type"] = "saliency"
        with open(out_dir / "saliency.json", "w", encoding="utf-8") as f:
            json.dump(sal_legacy, f, separators=(",", ":"))

        add_manifest_entry(
            "input_sensitivity",
            "input_sensitivity",
            "json",
            "Input sensitivity",
            "Per-pixel influence of the input image.",
            ["saliency", "gradient"],
            json_file="input_sensitivity.json",
            png_file="saliency.png",
            legacy_keys=["saliency.png", "saliency.json"],
        )

        _imshow_fallback_png(out_dir / "saliency.png", sal)

        # —— Manifest & delivery summary ——
        manifest: Dict[str, Any] = {
            "version": 1,
            "analysis_id": analysis_id,
            "chart_reference_file": chart_file,
            "image_size": {"width": int(img_size[1]), "height": int(img_size[0])},
            "source_image_path": img_path,
            "artifacts": manifest_artifacts,
            "compatibility": {
                "png_naming": "legacy_trainer_ui",
                "primary_render": "json",
            },
        }
        manifest_name = "analysis_manifest.json"
        with open(out_dir / manifest_name, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)

        progress_cb("packaging", 95, {"message": "Creating analysis ZIP file..."})
        zip_path = run_dir_path / "cnn_analysis.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for file_name in os.listdir(out_dir):
                if file_name.endswith((".png", ".json")):
                    zip_file.write(out_dir / file_name, arcname=file_name)

        png_files = sorted(f for f in os.listdir(out_dir) if f.endswith(".png"))
        json_files = sorted(f for f in os.listdir(out_dir) if f.endswith(".json") and f != manifest_name)

        delivery = {
            "generated_files": png_files,
            "generated_json_files": json_files,
            "manifest_file": manifest_name,
            "artifact_count": len(manifest_artifacts),
            "artifacts_summary": manifest_artifacts,
        }
        with open(out_dir / "delivery_summary.json", "w", encoding="utf-8") as f:
            json.dump(delivery, f, indent=2)

        analysis_summary = {
            "model_path": model_path,
            "img_path": img_path,
            "img_size": list(img_size),
            "output_dir": str(out_dir),
            "analysis_id": analysis_id,
            "generated_files": png_files,
            "generated_json_files": json_files,
            "manifest_file": manifest_name,
            "manifest_path": str(out_dir / manifest_name),
            "artifact_metadata": manifest_artifacts,
            "completed_at": time.time(),
        }
        with open(run_dir_path / "analysis_summary.json", "w", encoding="utf-8") as f:
            json.dump(analysis_summary, f, indent=2)

        progress_cb(
            "done",
            100,
            {
                "message": "CNN analysis completed successfully!",
                "analysis_files": png_files,
                "generated_json_files": json_files,
                "manifest_file": manifest_name,
                "artifact_metadata": manifest_artifacts,
                "zip_path": str(zip_path),
            },
        )

    except Exception as e:
        error_msg = f"CNN analysis failed: {str(e)}"
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
