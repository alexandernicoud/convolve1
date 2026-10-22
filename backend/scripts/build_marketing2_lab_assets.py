"""Colour interpretability assets for the Home 2 marketing page.

Runs the Analysis Lab's own explain code (Grad-CAM, saliency, SmoothGrad, occlusion,
activations) on the six real MSFT test windows already used by build_marketing2_assets.py,
with the model used in the marketing backtest, and writes colour-mapped PNGs plus
src/features/marketing2/data/labmaps.json. Read-only with respect to runs and models.

    .venv/bin/python scripts/build_marketing2_lab_assets.py --user <owner-id>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", "/tmp/mpl-m2")

import numpy as np
from matplotlib import colormaps
from PIL import Image

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
OUT_ASSETS = REPO / "src/features/marketing2/assets"
OUT_DATA = REPO / "src/features/marketing2/data"
sys.path.insert(0, str(BACKEND))

BACKTEST_RUN = "982d2b6b-b86c-4d65-b334-681efe252dd6"
SEQ = "inferno"
DIV = "berlin"
FEAT = "viridis"


def r(x: float, n: int = 4) -> float:
    return float(round(float(x), n))


def overlay(v: np.ndarray, cmap: str, dst: Path, gamma: float = 0.8) -> None:
    """[0,1] map -> RGBA, colour from cmap, alpha rising with the value (for overlays on the chart)."""
    v = np.clip(v, 0, 1)
    rgba = (colormaps[cmap](v) * 255).astype(np.uint8)
    rgba[..., 3] = (np.power(v, gamma) * 235).astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(dst, optimize=True)


def opaque(v: np.ndarray, cmap: str, dst: Path) -> None:
    rgb = (colormaps[cmap](np.clip(v, 0, 1))[..., :3] * 255).astype(np.uint8)
    Image.fromarray(rgb, "RGB").save(dst, optimize=True)


def stops(cmap: str, n: int = 9) -> list[str]:
    return ["#%02x%02x%02x" % tuple(int(c * 255) for c in colormaps[cmap](i / (n - 1))[:3]) for i in range(n)]


def occlusion_pixels(delta: np.ndarray, patch: int, stride: int, size: int) -> np.ndarray:
    """Nearest patch-centre value for every pixel, so each value sits over the region it occluded."""
    n_y, n_x = delta.shape
    idx = np.arange(size)
    iy = np.clip(np.rint((idx - patch / 2) / stride), 0, n_y - 1).astype(int)
    ix = np.clip(np.rint((idx - patch / 2) / stride), 0, n_x - 1).astype(int)
    return delta[iy][:, ix]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True)
    args = ap.parse_args()

    from app.services.cnn_lab import core

    bt_dir = BACKEND / "runs" / args.user / "backtests" / BACKTEST_RUN
    v2 = json.loads((bt_dir / "v2_config.json").read_text())
    model_path = BACKEND / "bot_data/models/keras" / args.user / Path(v2["model_path"]).name
    test_images = Path(v2["dataset_path"])
    hero = json.loads((OUT_DATA / "hero.json").read_text())

    lm = core.get_model(str(model_path))
    layer = lm.last_conv
    conv_names = [c["name"] for c in lm.conv_layers]
    samples = []
    notes = {}
    for i, s in enumerate(hero["samples"]):
        src = next(n for n in os.listdir(test_images) if n.startswith(f"MSFT_{s['start']}_to_{s['date']}"))
        x = core.load_batch([str(test_images / src)], lm.input_size)[0]
        res = core.explain_image(lm, x, target=1, layer=layer, methods=("gradcam", "saliency", "smoothgrad", "occlusion"))
        size = lm.input_size[0]

        cam, _ = core.gradcam_batch(lm, x[None], [1], layer)
        cam = core.resize_map(cam[0], lm.input_size)
        peak = float(cam.max())
        overlay(cam / peak if peak > 0 else cam, SEQ, OUT_ASSETS / f"lab_{i}_gradcam.png", gamma=0.45)

        sal = np.abs(core.input_gradients(lm, x[None], [1])[0]).max(axis=-1)
        overlay(sal / (np.percentile(sal, 99.5) or sal.max() or 1.0), SEQ, OUT_ASSETS / f"lab_{i}_saliency.png", gamma=0.6)

        rng = np.random.default_rng(0)
        noisy = np.clip(x[None] + rng.normal(0, 0.1, size=(16, *x.shape)).astype(np.float32), 0, 1)
        sg = np.abs(core.input_gradients(lm, noisy, [1] * 16)).max(axis=-1).mean(axis=0)
        overlay(sg / (np.percentile(sg, 99.5) or sg.max() or 1.0), SEQ, OUT_ASSETS / f"lab_{i}_smoothgrad.png", gamma=0.6)

        delta, meta = core.occlusion_map(lm, x, 1)
        lim = float(np.abs(delta).max()) or 1.0
        occ = occlusion_pixels(delta, meta["patch"], meta["stride"], size)
        opaque((occ / lim + 1) / 2, DIV, OUT_ASSETS / f"lab_{i}_occlusion.png")

        maps = res["maps"]
        samples.append(
            {
                "date": s["date"],
                "start": s["start"],
                "label": s["label"],
                "p": r(res["probabilities"][1], 3),
                "input": s["file"],
                "gradcam": f"lab_{i}_gradcam.png",
                "saliency": f"lab_{i}_saliency.png",
                "smoothgrad": f"lab_{i}_smoothgrad.png",
                "occlusion": f"lab_{i}_occlusion.png",
                "gradcam_all_zero": bool(maps["gradcam"]["all_zero"]),
                "gradcam_on_candles": r(maps["gradcam"]["foreground_share"] or 0, 3),
                "saliency_on_candles": r(maps["saliency"]["foreground_share"] or 0, 3),
                "occlusion_range": [r(maps["occlusion"]["min_delta"]), r(maps["occlusion"]["max_delta"])],
                "foreground": r(res["foreground_fraction"], 3),
            }
        )
        if not notes:
            notes = {m: maps[m]["normalization"] for m in maps}
            notes["occlusion_patch"] = f"{meta['patch']} px patch, stride {meta['stride']}, filled with {meta['fill']}"

    # Feature maps of the trace sample (index 3), coloured, same channel choice as the trace script.
    trace = json.loads((OUT_DATA / "trace.json").read_text())
    k = next(i for i, s in enumerate(hero["samples"]) if s["date"] == trace["sample"]["date"])
    src = next(n for n in os.listdir(test_images) if n.startswith(f"MSFT_{hero['samples'][k]['start']}_to_"))
    x = core.load_batch([str(test_images / src)], lm.input_size)
    fg_full = core.foreground_mask(x[0])
    feats = []
    for li, name in enumerate(conv_names):
        act = core.conv_activations(lm, x, name)[0]
        flat = act.reshape(-1, act.shape[-1])
        fg = core.resize_map(fg_full.astype(np.float32), act.shape[:2]) > 0.5
        sc = flat.max(axis=0) + 1e-6
        contrast = (act[fg].mean(axis=0) - act[~fg].mean(axis=0)) / sc
        take = 16 if li == 0 else 12
        structure = [int(c) for c in np.argsort(-contrast) if contrast[c] > 0 and flat[:, c].max() > 0][: take - 2]
        background = [int(c) for c in np.argsort(contrast) if c not in structure][:2]
        files = []
        for j, ch in enumerate((structure + background)[:take]):
            a = act[..., ch]
            top = np.percentile(a, 98) or a.max() or 1.0
            fn = f"feat_l{li + 1}_{j:02d}.png"
            opaque(np.clip(a / max(top, 1e-6), 0, 1) ** 0.7, FEAT, OUT_ASSETS / fn)
            files.append(fn)
        feats.append({"name": name, "h": int(act.shape[0]), "channels": int(act.shape[-1]), "files": files})

    out = {
        "provenance": "Computed locally with the Analysis Lab's explain code on the MSFT model used in the marketing backtest. Target class 1 (take-profit first).",
        "model": model_path.name,
        "layer": layer,
        "samples": samples,
        "trace_index": k,
        "features": feats,
        "notes": notes,
        "colormaps": {"sequential": {"name": SEQ, "stops": stops(SEQ)}, "diverging": {"name": DIV, "stops": stops(DIV)}, "features": {"name": FEAT, "stops": stops(FEAT)}},
    }
    (OUT_DATA / "labmaps.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({k2: v for k2, v in out.items() if k2 not in ("samples", "features")}, indent=1))
    for s in samples:
        print(s["date"], s["p"], s["gradcam_on_candles"], s["occlusion_range"], s["gradcam_all_zero"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
