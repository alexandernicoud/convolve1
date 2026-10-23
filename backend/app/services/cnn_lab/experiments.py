"""Multi-image lab experiments: sampling, attention atlas, sensitivity, faithfulness, features, embedding.

Every experiment is bounded (sample caps, batched inference), seeded, and returns the sample ids it
used so a result can be reproduced and audited. Missing quantities are reported as None, never 0.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np

from . import core
from .stats import cohen_d, diff_ci, mean_ci, pearson, wilson

BATCH = 32
LIMITS = {"atlas": 400, "sensitivity": 200, "faithfulness": 150, "features": 300, "embedding": 1000}
MAX_SCAN = 3000

TIME_REGIONS = ("oldest", "middle", "recent")
PRICE_REGIONS = ("upper", "middle", "lower")


class JobCancelled(Exception):
    pass


@dataclass
class Ctx:
    """What every experiment needs: the model, the dataset index, split provenance and callbacks."""

    lm: core.LoadedModel
    images_dir: str
    records: List[core.ImageRecord]
    split_status: str
    val_set: Optional[set]
    layout: Dict[str, Any]
    report: Callable[[float, str], None] = lambda f, m: None
    cancelled: Callable[[], bool] = lambda: False

    def check(self) -> None:
        if self.cancelled():
            raise JobCancelled()

    def path(self, image_id: str) -> str:
        p = core.image_path(self.images_dir, image_id)
        if p is None:
            raise ValueError(f"image not found: {image_id}")
        return p

    def load(self, ids: Sequence[str]) -> np.ndarray:
        return core.load_batch([self.path(i) for i in ids], self.lm.input_size)


# --------------------------------------------------------------------------- sampling


def _split_of(ctx: Ctx, image_id: str) -> Optional[str]:
    if ctx.val_set is None:
        return None
    return "validation" if image_id in ctx.val_set else "training"


def filter_records(ctx: Ctx, filters: Dict[str, Any]) -> List[core.ImageRecord]:
    """Metadata filters (no inference): label, symbol, end-date range, split."""
    recs = ctx.records
    labels = filters.get("labels")
    if labels:
        allowed = {int(v) for v in labels}
        recs = [r for r in recs if r.label in allowed]
    symbols = filters.get("symbols")
    if symbols:
        allowed_s = {str(s) for s in symbols}
        recs = [r for r in recs if r.symbol in allowed_s]
    if filters.get("date_from"):
        recs = [r for r in recs if r.end and r.end >= str(filters["date_from"])]
    if filters.get("date_to"):
        recs = [r for r in recs if r.end and r.end <= str(filters["date_to"])]
    split = filters.get("split") or "all"
    if split != "all":
        if ctx.val_set is None:
            raise ValueError("Validation membership is unknown for this model and dataset, so a split filter cannot be applied")
        want_val = split == "validation"
        recs = [r for r in recs if (r.id in ctx.val_set) == want_val]
    return recs


def _accepts(rec: core.ImageRecord, probs: np.ndarray, f: Dict[str, Any]) -> bool:
    pred = int(np.argmax(probs))
    if f.get("predicted") and pred not in {int(v) for v in f["predicted"]}:
        return False
    outcome = f.get("outcome")
    if outcome in ("correct", "incorrect"):
        if rec.label is None:
            return False
        if (pred == rec.label) != (outcome == "correct"):
            return False
    conf = float(np.max(probs))
    if f.get("confidence_min") is not None and conf < float(f["confidence_min"]):
        return False
    if f.get("confidence_max") is not None and conf > float(f["confidence_max"]):
        return False
    return True


def draw_sample(ctx: Ctx, n: int, seed: int, filters: Dict[str, Any], *, progress_span: Tuple[float, float] = (0.0, 0.2)) -> Dict[str, Any]:
    """Seeded random sample satisfying metadata and prediction filters.

    Candidates are visited in a seeded permutation; prediction filters are applied after inference,
    scanning at most MAX_SCAN images. The returned dict records everything needed to reproduce it.
    """
    pool = filter_records(ctx, filters)
    rng = np.random.default_rng(int(seed))
    perm = rng.permutation(len(pool))
    needs_pred = any(filters.get(k) not in (None, [], "") for k in ("predicted", "outcome", "confidence_min", "confidence_max"))
    items: List[Dict[str, Any]] = []
    scanned = 0
    limit = len(perm) if not needs_pred else min(len(perm), MAX_SCAN)
    i = 0
    a, b = progress_span
    while i < limit and len(items) < n:
        ctx.check()
        chunk = [pool[j] for j in perm[i : i + (BATCH if needs_pred else max(1, n - len(items)))]]
        chunk = chunk[: max(1, limit - i)]
        i += len(chunk)
        for start in range(0, len(chunk), BATCH):
            part = chunk[start : start + BATCH]
            probs, _ = core.predict(ctx.lm, ctx.load([r.id for r in part]))
            scanned += len(part)
            for rec, p in zip(part, probs):
                if len(items) >= n:
                    break
                if needs_pred and not _accepts(rec, p, filters):
                    continue
                pred = int(np.argmax(p))
                items.append(
                    {
                        **rec.to_dict(),
                        "probs": [float(v) for v in p],
                        "pred": pred,
                        "confidence": float(np.max(p)),
                        "correct": None if rec.label is None else bool(pred == rec.label),
                        "split": _split_of(ctx, rec.id),
                    }
                )
            ctx.report(a + (b - a) * min(1.0, len(items) / max(1, n)), f"Sampling: {len(items)} of {n}")
    return {
        "items": items,
        "requested": int(n),
        "seed": int(seed),
        "filters": filters,
        "pool_size": len(pool),
        "scanned": scanned,
        "exhausted": len(items) < n,
    }


def sample_summary(ctx: Ctx, items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Descriptive context for a sample. Accuracy here is classification on the sample, not trading performance."""
    n = len(items)
    labeled = [it for it in items if it["label"] is not None]
    k_correct = sum(1 for it in labeled if it["correct"])
    conf = [it["confidence"] for it in items]
    by_pred: Dict[str, int] = {}
    by_label: Dict[str, int] = {}
    for it in items:
        by_pred[str(it["pred"])] = by_pred.get(str(it["pred"]), 0) + 1
        if it["label"] is not None:
            by_label[str(it["label"])] = by_label.get(str(it["label"]), 0) + 1
    near = sum(1 for c in conf if c < 0.55)
    return {
        "n": n,
        "by_predicted": by_pred,
        "by_label": by_label,
        "accuracy": wilson(k_correct, len(labeled)) if labeled else None,
        "confidence": mean_ci(conf),
        "near_chance": wilson(near, n) if n else None,
        "split_status": ctx.split_status,
        "splits": {s: sum(1 for it in items if it["split"] == s) for s in ("validation", "training")} if ctx.val_set is not None else None,
    }


# --------------------------------------------------------------------------- regions


def _thirds(size: int) -> List[np.ndarray]:
    """Boolean masks splitting [0, size) into thirds by cell centre."""
    centres = (np.arange(size) + 0.5) / size
    return [(centres >= k / 3) & (centres < (k + 1) / 3) for k in range(3)]


def region_shares(mass: np.ndarray) -> Dict[str, Dict[str, float]]:
    """Fraction of a (h, w) mass distribution in time thirds (columns) and price thirds (rows)."""
    h, w = mass.shape
    cols, rows = _thirds(w), _thirds(h)
    total = float(mass.sum())
    if total <= 0:
        return {"time": {k: math.nan for k in TIME_REGIONS}, "price": {k: math.nan for k in PRICE_REGIONS}}
    return {
        "time": {k: float(mass[:, m].sum() / total) for k, m in zip(TIME_REGIONS, cols)},
        "price": {k: float(mass[m, :].sum() / total) for k, m in zip(PRICE_REGIONS, rows)},
    }


def region_masks_pixels(h: int, w: int) -> Dict[str, np.ndarray]:
    cols, rows = _thirds(w), _thirds(h)
    out: Dict[str, np.ndarray] = {}
    for k, m in zip(TIME_REGIONS, cols):
        mask = np.zeros((h, w), dtype=bool)
        mask[:, m] = True
        out[f"time:{k}"] = mask
    for k, m in zip(PRICE_REGIONS, rows):
        mask = np.zeros((h, w), dtype=bool)
        mask[m, :] = True
        out[f"price:{k}"] = mask
    return out


def _area_downsample(a: np.ndarray, shape: Tuple[int, int]) -> np.ndarray:
    tf = core._tf()
    t = tf.convert_to_tensor(np.asarray(a, dtype=np.float32)[..., None])
    return tf.image.resize(t, list(shape), method="area").numpy()[..., 0]


REGION_NOTE_VERIFIED = (
    "Regions follow the Convolve chart format (verified from the generator): x is bar index with the oldest "
    "bar on the left and the most recent on the right; y is the window's price range (top = highest price). "
    "There is no volume panel or axis area, so none is measured."
)
REGION_NOTE_ASSUMED = (
    "Regions assume the Convolve chart format (oldest bar left, recent right; top = highest price). This dataset "
    "was not produced by the Convolve generator, so the time/price reading of regions is approximate."
)


def _target_for(item: Dict[str, Any], target: Any) -> int:
    return int(item["pred"]) if target in (None, "predicted") else int(target)


# --------------------------------------------------------------------------- atlas


def run_atlas(ctx: Ctx, params: Dict[str, Any]) -> Dict[str, Any]:
    lm = ctx.lm
    layer = params.get("layer") or lm.last_conv
    if layer not in [c["name"] for c in lm.conv_layers]:
        raise ValueError("unknown layer")
    n = max(4, min(int(params.get("n") or 200), LIMITS["atlas"]))
    seed = int(params.get("seed") or 0)
    target = params.get("target", "predicted")
    filters = params.get("filters") or {}

    sample = draw_sample(ctx, n, seed, filters, progress_span=(0.0, 0.2))
    items = sample["items"]
    if len(items) < 4:
        raise ValueError(f"Only {len(items)} images matched the filters; at least 4 are needed")

    grid: Optional[Tuple[int, int]] = None
    agg_shape: Optional[Tuple[int, int]] = None
    maps: List[np.ndarray] = []
    rows: List[Dict[str, Any]] = []
    for start in range(0, len(items), BATCH):
        ctx.check()
        part = items[start : start + BATCH]
        x = ctx.load([it["id"] for it in part])
        cams, _ = core.gradcam_batch(lm, x, [_target_for(it, target) for it in part], layer)
        if grid is None:
            grid = (int(cams.shape[1]), int(cams.shape[2]))
            agg_shape = (min(grid[0], 56), min(grid[1], 56))
        for it, cam, xi in zip(part, cams, x):
            fg = core.foreground_mask(xi).astype(np.float32)
            fgc = _area_downsample(fg, grid)
            peak = float(cam.max())
            row: Dict[str, Any] = {"id": it["id"], "target": _target_for(it, target), "all_zero": peak <= 0}
            if peak <= 0:
                rows.append(row)
                continue
            mass = cam / cam.sum()
            att = region_shares(mass)
            ink = region_shares(fgc) if fgc.sum() > 0 else None
            row.update(
                {
                    "time": att["time"],
                    "price": att["price"],
                    "ink_time": ink["time"] if ink else None,
                    "ink_price": ink["price"] if ink else None,
                    "foreground_share": float((mass * fgc).sum() / max(float(mass.sum()), 1e-12)),
                    "foreground_area": float(fgc.mean()),
                    "col_profile": (mass.sum(axis=0) * grid[1]).astype(np.float32),
                    "row_profile": (mass.sum(axis=1) * grid[0]).astype(np.float32),
                }
            )
            norm = cam / peak
            maps.append(_area_downsample(norm, agg_shape) if agg_shape != grid else norm.astype(np.float32))
            row["map_index"] = len(maps) - 1
            rows.append(row)
        ctx.report(0.2 + 0.7 * min(1.0, (start + len(part)) / len(items)), f"Grad-CAM: {start + len(part)} of {len(items)}")

    by_id = {it["id"]: it for it in items}
    valid = [r for r in rows if not r["all_zero"]]
    if not valid:
        raise ValueError("Grad-CAM was zero for every sampled image at this layer; try an earlier layer")
    stack = np.stack(maps)
    mean_map = stack.mean(axis=0)
    std_map = stack.std(axis=0)
    # Group comparisons use mean-normalized maps so a group with more diffuse maps does not look "hotter" everywhere.
    density = stack / stack.mean(axis=(1, 2), keepdims=True)

    def corr(a: np.ndarray, b: np.ndarray) -> Optional[float]:
        a, b = a.ravel() - a.mean(), b.ravel() - b.mean()
        den = float(np.sqrt((a * a).sum() * (b * b).sum()))
        return float((a * b).sum() / den) if den > 0 else None

    for r in valid:
        r["typicality"] = corr(stack[r["map_index"]], mean_map)

    def profile_stats(subset: List[Dict[str, Any]], seed_off: int) -> Dict[str, Any]:
        out: Dict[str, Any] = {"n": len(subset)}
        for axis, names in (("time", TIME_REGIONS), ("price", PRICE_REGIONS)):
            out[axis] = {}
            for k in names:
                att = [r[axis][k] for r in subset]
                ink = [r[f"ink_{axis}"][k] for r in subset if r.get(f"ink_{axis}")]
                excess = [r[axis][k] - r[f"ink_{axis}"][k] for r in subset if r.get(f"ink_{axis}")]
                out[axis][k] = {
                    "attention": mean_ci(att, seed=seed + seed_off),
                    "ink": mean_ci(ink, seed=seed + seed_off + 1),
                    "excess_over_ink": mean_ci(excess, seed=seed + seed_off + 2),
                }
        out["foreground_share"] = mean_ci([r["foreground_share"] for r in subset], seed=seed + seed_off + 3)
        out["foreground_area"] = mean_ci([r["foreground_area"] for r in subset], seed=seed + seed_off + 4)
        cols = np.stack([r["col_profile"] for r in subset])
        rws = np.stack([r["row_profile"] for r in subset])
        out["col_profile"] = {"mean": cols.mean(axis=0).round(4).tolist(), "sd": cols.std(axis=0).round(4).tolist()}
        out["row_profile"] = {"mean": rws.mean(axis=0).round(4).tolist(), "sd": rws.std(axis=0).round(4).tolist()}
        return out

    def examples(subset: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        ranked = sorted([r for r in subset if r.get("typicality") is not None], key=lambda r: -r["typicality"])

        def ex(r: Dict[str, Any]) -> Dict[str, Any]:
            it = by_id[r["id"]]
            return {
                "id": r["id"],
                "label": it["label"],
                "pred": it["pred"],
                "probs": it["probs"],
                "typicality": r["typicality"],
                "map": core.encode_map(stack[r["map_index"]], normalization="per-image max", vmin=0.0, vmax=1.0),
            }

        return {"typical": [ex(r) for r in ranked[:4]], "atypical": [ex(r) for r in ranked[-3:][::-1]] if len(ranked) > 4 else []}

    shared_max = float(mean_map.max()) or 1.0
    groups_out: Dict[str, Any] = {}
    group_defs = {
        "predicted": lambda it: f"pred {it['pred']}",
        "label": lambda it: None if it["label"] is None else f"label {it['label']}",
        "outcome": lambda it: None if it["correct"] is None else ("correct" if it["correct"] else "incorrect"),
    }
    for gi, (gname, keyfn) in enumerate(group_defs.items()):
        buckets: Dict[str, List[Dict[str, Any]]] = {}
        for r in valid:
            key = keyfn(by_id[r["id"]])
            if key is not None:
                buckets.setdefault(key, []).append(r)
        if len(buckets) < 2:
            continue
        gmaps = {k: density[[r["map_index"] for r in v]].mean(axis=0) for k, v in buckets.items()}
        # Densities have long tails (a few sharply focused maps), so colour limits use the 99th percentile.
        gmax = max(float(np.percentile(m, 99)) for m in gmaps.values()) or 1.0
        entry: Dict[str, Any] = {
            "groups": {
                k: {
                    "n": len(v),
                    "map": core.encode_map(gmaps[k], normalization="Mean relative density (each map divided by its own mean; 1 = uniform); shared scale across groups, colours saturate at the 99th percentile", vmin=0.0, vmax=gmax),
                    "profile": profile_stats(v, 10 * (gi + 1)),
                    "examples": examples(v),
                }
                for k, v in sorted(buckets.items())
            }
        }
        keys = sorted(buckets)
        if len(keys) == 2:
            a, b = keys
            diff = gmaps[a] - gmaps[b]
            max_abs = float(np.abs(diff).max())
            lim = float(np.percentile(np.abs(diff), 99)) or max_abs or 1.0
            entry["difference"] = {
                "a": a,
                "b": b,
                "map": core.encode_map(
                    diff,
                    normalization=f"{a} minus {b} in relative density (where each group places its attention, independent of how spread out it is); symmetric, colours saturate at the 99th percentile of |difference| (max {max_abs:.2f})",
                    vmin=-lim,
                    vmax=lim,
                ),
                "max_abs": max_abs,
                "regions": {
                    axis: {
                        k: diff_ci([r[axis][k] for r in buckets[a]], [r[axis][k] for r in buckets[b]], seed=seed + 100 + gi)
                        for k in names
                    }
                    for axis, names in (("time", TIME_REGIONS), ("price", PRICE_REGIONS))
                },
                "foreground_share": diff_ci([r["foreground_share"] for r in buckets[a]], [r["foreground_share"] for r in buckets[b]], seed=seed + 200 + gi),
            }
        groups_out[gname] = entry

    typ = [r["typicality"] for r in valid if r.get("typicality") is not None]
    return {
        "kind": "atlas",
        "layer": layer,
        "grid": list(grid) if grid else None,
        "aggregate_grid": list(agg_shape) if agg_shape else None,
        "target": target,
        "sample": {k: v for k, v in sample.items() if k != "items"},
        "summary": sample_summary(ctx, items),
        "n_used": len(valid),
        "n_all_zero": len(rows) - len(valid),
        "normalization": (
            "Each image's Grad-CAM is divided by its own maximum before averaging, so every image contributes "
            "equally regardless of gradient magnitude. Region shares use the unnormalized map's mass distribution "
            "and are independent of that scaling. Images with an all-zero map are excluded and counted."
        ),
        "mean_map": core.encode_map(mean_map, normalization="Mean of per-image max-normalized maps (0 to this map's max)", vmin=0.0, vmax=shared_max),
        "std_map": core.encode_map(std_map, normalization="Standard deviation across images (0 to its max)", vmin=0.0, vmax=float(std_map.max()) or 1.0),
        "typicality": {"summary": mean_ci(typ, seed=seed + 7), "quartiles": np.percentile(typ, [25, 50, 75]).round(4).tolist() if typ else None},
        "profile": profile_stats(valid, 0),
        "examples": examples(valid),
        "groups": groups_out,
        "layout": ctx.layout,
        "region_note": REGION_NOTE_VERIFIED if ctx.layout.get("verified") else REGION_NOTE_ASSUMED,
        "items": [
            {
                **{k: by_id[r["id"]][k] for k in ("id", "label", "symbol", "end", "pred", "confidence", "correct", "split")},
                "all_zero": r["all_zero"],
                "time": r.get("time"),
                "price": r.get("price"),
                "foreground_share": r.get("foreground_share"),
                "typicality": r.get("typicality"),
            }
            for r in rows
        ],
        "method": core.METHOD_NOTES["gradcam"],
    }


# --------------------------------------------------------------------------- interventions


BASELINE_NOTES = {
    "white": "Replace with the white chart background. Removes candles in the region; background pixels are unchanged.",
    "black": "Replace with black. Out-of-distribution for these charts; large effects can reflect novelty, not reliance.",
    "blur": "Gaussian-blurred copy of the image (σ = 6 px). Removes fine shape but keeps coarse colour and position.",
    "mean": "Per-pixel mean of the sampled images. Removes image-specific content while keeping typical layout.",
}


def blur_images(x: np.ndarray, sigma: float = 6.0) -> np.ndarray:
    from PIL import Image, ImageFilter

    out = np.empty_like(x)
    for i in range(len(x)):
        img = Image.fromarray(np.clip(np.round(x[i] * 255), 0, 255).astype(np.uint8))
        out[i] = np.asarray(img.filter(ImageFilter.GaussianBlur(radius=sigma)), dtype=np.float32) / 255.0
    return out


def apply_baseline(x: np.ndarray, mask: np.ndarray, baseline: str, *, blurred: Optional[np.ndarray] = None, mean_img: Optional[np.ndarray] = None) -> np.ndarray:
    """x (H,W,3) with ``mask`` (H,W) replaced by the baseline."""
    out = x.copy()
    if baseline == "white":
        out[mask] = 1.0
    elif baseline == "black":
        out[mask] = 0.0
    elif baseline == "blur":
        src = blurred if blurred is not None else blur_images(x[None])[0]
        out[mask] = src[mask]
    elif baseline == "mean":
        if mean_img is None:
            raise ValueError("mean baseline needs a sample mean image")
        out[mask] = mean_img[mask]
    else:
        raise ValueError(f"unknown baseline {baseline}")
    return out


def intervene_single(lm: core.LoadedModel, x: np.ndarray, rect: Tuple[float, float, float, float], baseline: str, target: Any = "predicted") -> Dict[str, Any]:
    """Mask one rectangle (fractions x0, y0, x1, y1 of the image) and report the output change."""
    if baseline not in ("white", "black", "blur"):
        raise ValueError("baseline must be white, black or blur for single-image interventions")
    h, w = x.shape[:2]
    x0, y0, x1, y1 = [min(1.0, max(0.0, float(v))) for v in rect]
    if x1 <= x0 or y1 <= y0:
        raise ValueError("empty rectangle")
    mask = np.zeros((h, w), dtype=bool)
    mask[int(round(y0 * h)) : max(int(round(y1 * h)), int(round(y0 * h)) + 1), int(round(x0 * w)) : max(int(round(x1 * w)), int(round(x0 * w)) + 1)] = True
    mod = apply_baseline(x, mask, baseline)
    probs, _ = core.predict(lm, np.stack([x, mod]))
    t = core.resolve_target(lm, probs[0], target)
    fg = core.foreground_mask(x)
    return {
        "rect": [x0, y0, x1, y1],
        "baseline": baseline,
        "baseline_note": BASELINE_NOTES[baseline],
        "target_class": t,
        "original": [float(v) for v in probs[0]],
        "modified": [float(v) for v in probs[1]],
        "delta_target": float(probs[1, t] - probs[0, t]),
        "flipped": bool(int(np.argmax(probs[1])) != int(np.argmax(probs[0]))),
        "masked_area": float(mask.mean()),
        "masked_foreground": float((mask & fg).sum() / max(1, fg.sum())),
        "modified_png": core.input_png_bytes(mod),
    }


def _summ_deltas(orig: np.ndarray, mod: np.ndarray, flips: np.ndarray, seed: int) -> Dict[str, Any]:
    d = mod - orig
    return {
        "delta": mean_ci(d.tolist(), seed=seed),
        "abs_delta": mean_ci(np.abs(d).tolist(), seed=seed + 1),
        "flip_rate": wilson(int(flips.sum()), int(flips.size)),
    }


def run_sensitivity(ctx: Ctx, params: Dict[str, Any]) -> Dict[str, Any]:
    lm = ctx.lm
    n = max(4, min(int(params.get("n") or 100), LIMITS["sensitivity"]))
    seed = int(params.get("seed") or 0)
    filters = params.get("filters") or {}
    baselines = [b for b in (params.get("baselines") or ["white", "blur", "mean", "black"]) if b in BASELINE_NOTES]
    if not baselines:
        raise ValueError("choose at least one baseline")
    window = float(params.get("window") or 0.25)
    stride = float(params.get("stride") or 0.125)
    occ_patch = int(params.get("occlusion_patch") or 32)
    do_occ = bool(params.get("occlusion", True))

    sample = draw_sample(ctx, n, seed, filters, progress_span=(0.0, 0.15))
    items = sample["items"]
    if len(items) < 4:
        raise ValueError(f"Only {len(items)} images matched the filters; at least 4 are needed")
    h, w = lm.input_size
    ids = [it["id"] for it in items]
    targets = np.array([it["pred"] for it in items])

    mean_img: Optional[np.ndarray] = None
    if "mean" in baselines:
        acc = np.zeros((h, w, 3), dtype=np.float64)
        for start in range(0, len(ids), BATCH):
            ctx.check()
            acc += ctx.load(ids[start : start + BATCH]).sum(axis=0)
        mean_img = (acc / len(ids)).astype(np.float32)

    regions = region_masks_pixels(h, w)
    starts = np.arange(0.0, 1.0 - window + 1e-9, stride)
    windows = []
    for s0 in starts:
        m = np.zeros((h, w), dtype=bool)
        m[:, int(round(s0 * w)) : int(round((s0 + window) * w))] = True
        windows.append((float(s0), m))
    occ_pos = [(y0, x0) for y0 in range(0, h - occ_patch + 1, occ_patch) for x0 in range(0, w - occ_patch + 1, occ_patch)] if do_occ else []
    occ_n = min(len(items), 50) if do_occ else 0

    conditions = [(f"{r}|{b}", mask, b) for r, mask in regions.items() for b in baselines]
    win_base = baselines[0]
    p_orig = np.zeros(len(items))
    res = {key: np.zeros(len(items)) for key, _, _ in conditions}
    flips = {key: np.zeros(len(items), dtype=bool) for key, _, _ in conditions}
    wres = np.zeros((len(windows), len(items)))
    occ = np.full((len(occ_pos), occ_n), np.nan) if occ_n else None

    sub = 8
    for start in range(0, len(items), sub):
        ctx.check()
        x = ctx.load(ids[start : start + sub])
        blurred = blur_images(x) if "blur" in baselines else None
        variants, index = [], []
        for i in range(len(x)):
            gi = start + i
            variants.append(x[i])
            index.append(("orig", gi, None))
            for key, mask, b in conditions:
                variants.append(apply_baseline(x[i], mask, b, blurred=None if blurred is None else blurred[i], mean_img=mean_img))
                index.append(("cond", gi, key))
            for wi, (_, mask) in enumerate(windows):
                variants.append(apply_baseline(x[i], mask, win_base, blurred=None if blurred is None else blurred[i], mean_img=mean_img))
                index.append(("win", gi, wi))
            if occ is not None and gi < occ_n:
                for oi, (y0, x0) in enumerate(occ_pos):
                    v = x[i].copy()
                    v[y0 : y0 + occ_patch, x0 : x0 + occ_patch] = 1.0
                    variants.append(v)
                    index.append(("occ", gi, oi))
        probs = np.concatenate([core.predict(lm, np.stack(variants[k : k + 64]))[0] for k in range(0, len(variants), 64)])
        for (kind, gi, key), p in zip(index, probs):
            t = targets[gi]
            if kind == "orig":
                p_orig[gi] = p[t]
        for (kind, gi, key), p in zip(index, probs):
            t = targets[gi]
            if kind == "cond":
                res[key][gi] = p[t]
                flips[key][gi] = int(np.argmax(p)) != t
            elif kind == "win":
                wres[key, gi] = p[t]
            elif kind == "occ":
                occ[key, gi] = p[t] - p_orig[gi]
        ctx.report(0.15 + 0.8 * min(1.0, (start + len(x)) / len(items)), f"Interventions: {start + len(x)} of {len(items)}")

    table = []
    for ci, (key, mask, b) in enumerate(conditions):
        region = key.split("|")[0]
        table.append({"region": region, "baseline": b, **_summ_deltas(p_orig, res[key], flips[key], seed + ci)})

    paired = {}
    for b in baselines:
        recent = res[f"time:recent|{b}"] - p_orig
        oldest = res[f"time:oldest|{b}"] - p_orig
        upper = res[f"price:upper|{b}"] - p_orig
        lower = res[f"price:lower|{b}"] - p_orig
        paired[b] = {
            "recent_minus_oldest": mean_ci((recent - oldest).tolist(), seed=seed + 300),
            "upper_minus_lower": mean_ci((upper - lower).tolist(), seed=seed + 301),
        }

    sliding = [
        {"start": s0, "end": s0 + window, **_summ_deltas(p_orig, wres[wi], np.zeros(len(items), dtype=bool), seed + 400 + wi)}
        for wi, (s0, _) in enumerate(windows)
    ]
    for row in sliding:
        row.pop("flip_rate", None)

    occ_out = None
    if occ is not None:
        mean_occ = np.nanmean(occ, axis=1).reshape(len(range(0, h - occ_patch + 1, occ_patch)), -1)
        lim = float(np.abs(mean_occ).max()) or 1.0
        occ_out = {
            "n": occ_n,
            "patch": occ_patch,
            "fill": "white",
            "grid": list(mean_occ.shape),
            "map": core.encode_map(mean_occ, normalization="Mean Δ target probability; centre colour = no change; symmetric ±max", vmin=-lim, vmax=lim),
            "values": mean_occ.round(5).tolist(),
        }

    per_image = [
        {
            "id": ids[i],
            "target": int(targets[i]),
            "p_target": float(p_orig[i]),
            "delta": {key: float(res[key][i] - p_orig[i]) for key, _, _ in conditions if key.endswith(f"|{baselines[0]}")},
        }
        for i in range(len(items))
    ]
    return {
        "kind": "sensitivity",
        "sample": {k: v for k, v in sample.items() if k != "items"},
        "summary": sample_summary(ctx, items),
        "target": "Each image's originally predicted class; Δ = modified − original probability of that class.",
        "baselines": {b: BASELINE_NOTES[b] for b in baselines},
        "regions": table,
        "paired": paired,
        "sliding": {"window": window, "stride": stride, "baseline": win_base, "rows": sliding},
        "occlusion": occ_out,
        "per_image": per_image,
        "layout": ctx.layout,
        "region_note": REGION_NOTE_VERIFIED if ctx.layout.get("verified") else REGION_NOTE_ASSUMED,
        "limitations": [
            "Masking changes the input distribution; a probability change shows the model responds to the edit, not that a human-meaningful feature was removed.",
            "With the white baseline, background pixels are unaffected, so a region with few candles changes little by construction.",
            "Baselines disagree in general; conclusions that hold for only one baseline are weak.",
        ],
    }


# --------------------------------------------------------------------------- faithfulness


FG_BINS = np.array([0.0, 0.02, 0.08, 0.2, 1.01])


def run_faithfulness(ctx: Ctx, params: Dict[str, Any]) -> Dict[str, Any]:
    lm = ctx.lm
    layer = params.get("layer") or lm.last_conv
    if layer not in [c["name"] for c in lm.conv_layers]:
        raise ValueError("unknown layer")
    n = max(4, min(int(params.get("n") or 100), LIMITS["faithfulness"]))
    seed = int(params.get("seed") or 0)
    filters = params.get("filters") or {}
    cells = int(params.get("grid") or 8)
    repeats = max(1, min(int(params.get("repeats") or 10), 20))
    ks = [k for k in (params.get("ks") or [2, 4, 8]) if 0 < int(k) < cells * cells // 2]
    baseline = params.get("baseline") or "white"
    if baseline not in ("white", "blur"):
        raise ValueError("baseline must be white or blur")

    sample = draw_sample(ctx, n, seed, filters, progress_span=(0.0, 0.15))
    items = sample["items"]
    if len(items) < 4:
        raise ValueError(f"Only {len(items)} images matched the filters; at least 4 are needed")
    h, w = lm.input_size
    ch, cw = h // cells, w // cells
    rng = np.random.default_rng(seed + 1)

    def cell_mask(cell_ids: Sequence[int]) -> np.ndarray:
        m = np.zeros((h, w), dtype=bool)
        for c in cell_ids:
            r, q = divmod(int(c), cells)
            m[r * ch : (r + 1) * ch, q * cw : (q + 1) * cw] = True
        return m

    drops = {k: {"top": [], "random": [], "bottom": [], "match_gap": []} for k in ks}
    skipped = 0
    for start in range(0, len(items), 8):
        ctx.check()
        part = items[start : start + 8]
        x = ctx.load([it["id"] for it in part])
        targets = [it["pred"] for it in part]
        cams, probs0 = core.gradcam_batch(lm, x, targets, layer)
        blurred = blur_images(x) if baseline == "blur" else None
        variants, index = [], []
        for i, it in enumerate(part):
            if cams[i].max() <= 0:
                skipped += 1
                continue
            up = core.resize_map(cams[i], (h, w))
            fg = core.foreground_mask(x[i]).astype(np.float32)
            imp = up[: ch * cells, : cw * cells].reshape(cells, ch, cells, cw).mean(axis=(1, 3)).ravel()
            fgc = fg[: ch * cells, : cw * cells].reshape(cells, ch, cells, cw).mean(axis=(1, 3)).ravel()
            bins = np.digitize(fgc, FG_BINS) - 1
            order = np.argsort(-imp)
            for k in ks:
                top = order[:k]
                rest = np.setdiff1d(np.arange(cells * cells), top)
                inked = [c for c in order[::-1] if fgc[c] > 0 and c not in set(top)]
                bottom = inked[:k] if len(inked) >= k else None
                for kind, cid in (("top", top), ("bottom", bottom)):
                    if cid is None:
                        continue
                    variants.append(apply_baseline(x[i], cell_mask(cid), baseline, blurred=None if blurred is None else blurred[i]))
                    index.append((i, k, kind, None))
                for r in range(repeats):
                    picked, gaps = [], []
                    for c in top:
                        pool = [q for q in rest if bins[q] == bins[c] and q not in picked]
                        if not pool:
                            pool = sorted((q for q in rest if q not in picked), key=lambda q: abs(fgc[q] - fgc[c]))[:3]
                        q = int(rng.choice(pool))
                        picked.append(q)
                        gaps.append(abs(float(fgc[q] - fgc[c])))
                    variants.append(apply_baseline(x[i], cell_mask(picked), baseline, blurred=None if blurred is None else blurred[i]))
                    index.append((i, k, "random", float(np.mean(gaps))))
        if not variants:
            continue
        probs = np.concatenate([core.predict(lm, np.stack(variants[q : q + 64]))[0] for q in range(0, len(variants), 64)])
        acc: Dict[Tuple[int, int], Dict[str, List[float]]] = {}
        for (i, k, kind, gap), p in zip(index, probs):
            t = targets[i]
            slot = acc.setdefault((i, k), {"top": [], "random": [], "bottom": [], "gap": []})
            slot[kind].append(float(probs0[i, t] - p[t]))
            if gap is not None:
                slot["gap"].append(gap)
        for (i, k), slot in acc.items():
            drops[k]["top"].append(slot["top"][0])
            drops[k]["random"].append(float(np.mean(slot["random"])))
            drops[k]["bottom"].append(slot["bottom"][0] if slot["bottom"] else math.nan)
            drops[k]["match_gap"].append(float(np.mean(slot["gap"])))
        ctx.report(0.15 + 0.8 * min(1.0, (start + len(part)) / len(items)), f"Masking: {start + len(part)} of {len(items)}")

    rows = []
    for k in ks:
        d = drops[k]
        top, rand = np.array(d["top"]), np.array(d["random"])
        bottom = np.array(d["bottom"])
        wins = int((top > rand).sum())
        rows.append(
            {
                "k": k,
                "masked_fraction": k / (cells * cells),
                "drop_top": mean_ci(top.tolist(), seed=seed + k),
                "drop_random": mean_ci(rand.tolist(), seed=seed + k + 1),
                "drop_bottom": mean_ci(bottom.tolist(), seed=seed + k + 2),
                "top_minus_random": mean_ci((top - rand).tolist(), seed=seed + k + 3),
                "win_rate": wilson(wins, int(top.size)),
                "match_gap": mean_ci(d["match_gap"], seed=seed + k + 4),
            }
        )
    return {
        "kind": "faithfulness",
        "layer": layer,
        "sample": {k: v for k, v in sample.items() if k != "items"},
        "summary": sample_summary(ctx, items),
        "n_used": len(items) - skipped,
        "n_all_zero": skipped,
        "grid": cells,
        "repeats": repeats,
        "baseline": baseline,
        "baseline_note": BASELINE_NOTES[baseline],
        "rows": rows,
        "design": (
            f"The image is divided into a {cells}×{cells} grid. For each image the k cells with the highest mean Grad-CAM "
            f"(target = predicted class) are masked, and the drop in that class's probability is recorded. The control "
            f"masks k random cells matched to the top cells by candle coverage (bins {FG_BINS[1:-1].tolist()}), repeated "
            f"{repeats} times and averaged. A second control masks the k lowest-attribution cells that contain candles. "
            "If Grad-CAM is faithful, masking its top cells should hurt more than the matched random control."
        ),
        "limitations": [
            "Masking is an out-of-distribution edit; drops measure sensitivity to that edit.",
            "Coverage matching is coarse; the reported match gap shows how closely candle coverage was matched.",
            "Grad-CAM resolution is the layer grid; fine detail inside a cell is not distinguished.",
        ],
    }


# --------------------------------------------------------------------------- features


def run_features(ctx: Ctx, params: Dict[str, Any]) -> Dict[str, Any]:
    lm = ctx.lm
    layer = params.get("layer") or lm.last_conv
    names = [c["name"] for c in lm.conv_layers]
    if layer not in names:
        raise ValueError("unknown layer")
    n = max(8, min(int(params.get("n") or 200), LIMITS["features"]))
    seed = int(params.get("seed") or 0)
    filters = params.get("filters") or {}
    top_k = max(1, min(int(params.get("top_images") or 6), 12))

    sample = draw_sample(ctx, n, seed, filters, progress_span=(0.0, 0.2))
    items = sample["items"]
    if len(items) < 8:
        raise ValueError(f"Only {len(items)} images matched the filters; at least 8 are needed")
    means, maxes = [], []
    shape = None
    for start in range(0, len(items), BATCH):
        ctx.check()
        part = items[start : start + BATCH]
        act = core.conv_activations(lm, ctx.load([it["id"] for it in part]), layer)
        shape = [int(s) for s in act.shape[1:]]
        means.append(act.mean(axis=(1, 2)))
        maxes.append(act.max(axis=(1, 2)))
        ctx.report(0.2 + 0.75 * min(1.0, (start + len(part)) / len(items)), f"Activations: {start + len(part)} of {len(items)}")
    M, X = np.concatenate(means), np.concatenate(maxes)
    labels = np.array([np.nan if it["label"] is None else it["label"] for it in items], dtype=np.float64)
    preds = np.array([it["pred"] for it in items])
    p1 = np.array([it["probs"][-1] for it in items])
    logit = np.log(np.clip(p1, 1e-7, 1 - 1e-7) / np.clip(1 - p1, 1e-7, 1)) if lm.head == "sigmoid" else None
    channels = []
    for c in range(M.shape[1]):
        col = M[:, c]
        entry: Dict[str, Any] = {
            "channel": c,
            "mean": float(col.mean()),
            "sd": float(col.std()),
            "active_rate": float((X[:, c] > 0).mean()),
            "peak": float(X[:, c].max()),
            "top_images": [{"id": items[i]["id"], "value": float(col[i]), "label": items[i]["label"], "pred": items[i]["pred"]} for i in np.argsort(-col)[:top_k]],
        }
        if lm.n_classes == 2:
            entry["d_label"] = cohen_d(col[labels == 1], col[labels == 0])
            entry["d_pred"] = cohen_d(col[preds == 1], col[preds == 0])
        if logit is not None:
            entry["r_logit"] = pearson(col, logit)
        channels.append(entry)
    dead = sum(1 for ch in channels if ch["active_rate"] == 0)
    sig = [ch for ch in channels if ch.get("d_label") and ch["d_label"]["lo"] is not None and (ch["d_label"]["lo"] > 0 or ch["d_label"]["hi"] < 0)]
    return {
        "kind": "features",
        "layer": layer,
        "tensor_shape": shape,
        "sample": {k: v for k, v in sample.items() if k != "items"},
        "summary": sample_summary(ctx, items),
        "channels": channels,
        "dead_channels": dead,
        "label_separating": {"count": len(sig), "expected_by_chance": round(0.05 * len(channels), 1), "of": len(channels)},
        "notes": [
            "Channel intensity is the spatial mean of the ReLU output for each image.",
            "Cohen's d compares mean intensity on label-1 vs label-0 images (pooled SD, 95% normal-approximation interval). With many channels, about 5% will exclude zero by chance.",
            "Channels are numbered, not named. A channel that separates labels is correlated with the label in this sample; it is not shown to cause the prediction.",
        ],
    }


def activation_maximization(lm: core.LoadedModel, layer: str, channel: int, *, steps: int = 96, lr: float = 0.05, seed: int = 0) -> Dict[str, Any]:
    """Exploratory: synthesize an input that increases one channel's mean activation."""
    tf = core._tf()
    names = [c["name"] for c in lm.conv_layers]
    if layer not in names:
        raise ValueError("unknown layer")
    idx = names.index(layer)
    h, w = lm.input_size
    rng = np.random.default_rng(seed)
    start = np.clip(1.0 - np.abs(rng.normal(0, 0.05, size=(1, h, w, 3))), 0, 1).astype(np.float32)
    img = tf.Variable(start)
    trace = []
    with lm.lock:
        for step in range(max(8, min(int(steps), 200))):
            with tf.GradientTape() as tape:
                convs, _, _ = core._forward(lm, img)
                act = convs[idx][..., int(channel)]
                tv = tf.reduce_mean(tf.abs(img[:, 1:, :, :] - img[:, :-1, :, :])) + tf.reduce_mean(tf.abs(img[:, :, 1:, :] - img[:, :, :-1, :]))
                obj = tf.reduce_mean(act) - 0.5 * tv
            g = tape.gradient(obj, img)
            g = g / (tf.math.reduce_std(g) + 1e-8)
            img.assign(tf.clip_by_value(img + lr * g, 0.0, 1.0))
            if step % 16 == 0:
                trace.append(float(tf.reduce_mean(act)))
    final = img.numpy()[0]
    return {
        "layer": layer,
        "channel": int(channel),
        "steps": int(steps),
        "objective_trace": trace,
        "stalled": bool(max(trace, default=0.0) <= 0.0),
        "png": core.input_png_bytes(final),
        "note": (
            "Exploratory. Gradient ascent from a near-white image with a smoothness penalty. The pattern shows what can "
            "increase this channel, not what the channel 'means'; results depend on the start point and regularization."
        ),
    }


# --------------------------------------------------------------------------- embedding


def run_embedding(ctx: Ctx, params: Dict[str, Any]) -> Dict[str, Any]:
    lm = ctx.lm
    n = max(10, min(int(params.get("n") or 500), LIMITS["embedding"]))
    seed = int(params.get("seed") or 0)
    filters = params.get("filters") or {}
    sample = draw_sample(ctx, n, seed, filters, progress_span=(0.0, 0.3))
    items = sample["items"]
    if len(items) < 10:
        raise ValueError(f"Only {len(items)} images matched the filters; at least 10 are needed")
    pens = []
    for start in range(0, len(items), BATCH):
        ctx.check()
        part = items[start : start + BATCH]
        _, pen = core.predict(lm, ctx.load([it["id"] for it in part]))
        pens.append(pen)
        ctx.report(0.3 + 0.6 * min(1.0, (start + len(part)) / len(items)), f"Embeddings: {start + len(part)} of {len(items)}")
    P = np.concatenate(pens).astype(np.float64)
    centred = P - P.mean(axis=0)
    _, s, vt = np.linalg.svd(centred, full_matrices=False)
    var = s ** 2
    ratio = (var / var.sum()) if var.sum() > 0 else np.zeros_like(var)
    coords = centred @ vt[:2].T
    wdir = lm.final_kernel[:, 0] if lm.head == "sigmoid" else (lm.final_kernel[:, -1] - lm.final_kernel[:, 0])
    wdir = np.asarray(wdir, dtype=np.float64)
    wn = np.linalg.norm(wdir)
    align = [float(abs(vt[i] @ wdir) / wn) if wn > 0 else None for i in range(min(2, len(vt)))]
    dead_units = int((P.max(axis=0) <= 0).sum())
    return {
        "kind": "embedding",
        "sample": {k: v for k, v in sample.items() if k != "items"},
        "summary": sample_summary(ctx, items),
        "dim": int(P.shape[1]),
        "inactive_units": dead_units,
        "explained_variance": ratio[:10].round(5).tolist(),
        "classifier_alignment": align,
        "points": [
            {
                "id": it["id"],
                "x": float(coords[i, 0]),
                "y": float(coords[i, 1]) if coords.shape[1] > 1 else 0.0,
                "label": it["label"],
                "pred": it["pred"],
                "confidence": it["confidence"],
                "p1": it["probs"][-1],
                "symbol": it["symbol"],
                "correct": it["correct"],
            }
            for i, it in enumerate(items)
        ],
        "caveats": [
            "PCA of the penultimate layer (the vector the classifier reads). Two components keep only the explained-variance share shown; distances in the plot are distorted accordingly.",
            "Classifier alignment is |cos| between each component and the output layer's weight direction: near 1 means that axis is the one the classifier uses.",
            "Clusters or separation here describe this sample's representation, not generalization.",
        ],
    }


EXPERIMENTS = {
    "atlas": run_atlas,
    "sensitivity": run_sensitivity,
    "faithfulness": run_faithfulness,
    "features": run_features,
    "embedding": run_embedding,
}

# Bump when an experiment's computation changes so stored results are not reused across versions.
METHOD_VERSION = {"atlas": 3, "sensitivity": 1, "faithfulness": 1, "features": 1, "embedding": 1}
