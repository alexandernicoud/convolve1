"""
Build the Home 2 / About 2 marketing assets from real local artifacts.

Reads (never writes) runs, datasets, the MSFT model and the fleet fixture, and writes
monochrome PNGs + compact JSON into ``src/features/marketing2/{assets,data}``.

Nothing written here may contain absolute paths, user ids, e-mails or tokens: every output
is assembled from explicit fields, and a final scan fails the build if a forbidden string
appears in any emitted file.

Usage (from backend/):
    MPLCONFIGDIR=/tmp/mpl .venv/bin/python scripts/build_marketing2_assets.py --user <uuid>
"""

from __future__ import annotations

import argparse
import csv
import getpass
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path

import numpy as np
from PIL import Image

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
OUT_ASSETS = REPO / "src/features/marketing2/assets"
OUT_DATA = REPO / "src/features/marketing2/data"

sys.path.insert(0, str(BACKEND))

TRAINING_RUN = "20261022_114349_8b4c43"
BACKTEST_RUN = "982d2b6b-b86c-4d65-b334-681efe252dd6"
LAB_SESSION = "lab_20261022_120557_630ba9"
FLEET_FIXTURE = REPO / "src/features/fleet/fixtures/fleet12.1M.json"

INK_UP = (236, 239, 243)
INK_DOWN = (112, 118, 128)
INK_WICK = (188, 194, 202)


def r(x: float, n: int = 4) -> float:
    return float(round(float(x), n))


# --------------------------------------------------------------------------- images


def mono_chart(src: Path, dst: Path) -> None:
    """Candlestick PNG on white -> monochrome ink on transparent (up light, down grey)."""
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.int16)
    rr, gg, bb = im[..., 0], im[..., 1], im[..., 2]
    out = np.zeros((*im.shape[:2], 4), dtype=np.uint8)
    bg = (rr > 228) & (gg > 228) & (bb > 228)
    up = (gg > rr + 25) & ~bg
    down = (rr > gg + 25) & ~bg
    wick = ~bg & ~up & ~down
    for mask, ink in ((up, INK_UP), (down, INK_DOWN), (wick, INK_WICK)):
        out[mask, :3] = ink
        out[mask, 3] = 255
    Image.fromarray(out, "RGBA").save(dst, optimize=True)


def ramp(v: np.ndarray) -> np.ndarray:
    """[0,1] -> cool monochrome ramp: black -> slate -> silver -> white."""
    stops = np.array([[4, 5, 7], [26, 33, 44], [118, 136, 158], [214, 224, 236], [255, 255, 255]], dtype=np.float32)
    pos = np.array([0.0, 0.25, 0.6, 0.85, 1.0], dtype=np.float32)
    v = np.clip(v, 0, 1)
    out = np.empty((*v.shape, 3), dtype=np.float32)
    for c in range(3):
        out[..., c] = np.interp(v, pos, stops[:, c])
    return out.astype(np.uint8)


def save_map(arr: np.ndarray, dst: Path, vmax: float | None = None) -> None:
    a = np.asarray(arr, dtype=np.float32)
    top = vmax if vmax else (np.percentile(a, 98) or a.max() or 1.0)
    v = np.clip(a / max(top, 1e-6), 0, 1) ** 0.7
    Image.fromarray(ramp(v), "RGB").save(dst, optimize=True)


def save_heat_overlay(cam: np.ndarray, dst: Path) -> None:
    """Grad-CAM -> ice-white RGBA overlay; alpha carries the evidence."""
    a = np.asarray(cam, dtype=np.float32)
    a = a / max(float(a.max()), 1e-6)
    out = np.zeros((*a.shape, 4), dtype=np.uint8)
    out[..., 0], out[..., 1], out[..., 2] = 196, 222, 255
    out[..., 3] = (np.power(a, 0.75) * 230).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(dst, optimize=True)


# --------------------------------------------------------------------------- data


def read_csv(path: Path) -> list[dict]:
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def weekly_ohlc(rows: list[dict]) -> list[dict]:
    weeks: dict[tuple, dict] = {}
    for row in rows:
        d = datetime.fromisoformat(row["timestamp"]).date()
        key = d.isocalendar()[:2]
        o, h, l, c = (float(row[k]) for k in ("Open", "High", "Low", "Close"))
        w = weeks.get(key)
        if w is None:
            weeks[key] = {"d": d.isoformat(), "o": o, "h": h, "l": l, "c": c}
        else:
            w["h"], w["l"], w["c"] = max(w["h"], h), min(w["l"], l), c
    return [{k: (r(v, 2) if k != "d" else v) for k, v in w.items()} for w in weeks.values()]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True, help="owner folder of the runs/datasets to read")
    args = ap.parse_args()
    user = args.user

    runs = BACKEND / "runs" / user
    datasets = BACKEND / "datasets" / user
    bt_dir = runs / "backtests" / BACKTEST_RUN
    v2 = json.loads((bt_dir / "v2_config.json").read_text())
    model_path = BACKEND / "bot_data/models/keras" / user / Path(v2["model_path"]).name
    test_images = Path(v2["dataset_path"])
    test_root = test_images.parent
    train_images = datasets / "bdef3136" / "images"

    OUT_ASSETS.mkdir(parents=True, exist_ok=True)
    OUT_DATA.mkdir(parents=True, exist_ok=True)

    # ---- prices + predictions (hero) -------------------------------------------------
    ohlcv = read_csv(test_root / "provenance/ohlcv/MSFT.csv")
    preds = read_csv(bt_dir / "output/predictions.csv")
    pred_rows = [
        {
            "d": p["decision_ts"][:10],
            "p": r(p["prob"], 3),
            "label": int(p["label"]),
            "id": p["sample_id"],
        }
        for p in preds
    ]
    threshold = json.loads((bt_dir / "output/backtest_results.json").read_text())["threshold"]

    # Hero samples: spread across the test period, mixed outcomes.
    picks_at = [0.08, 0.27, 0.46, 0.63, 0.81, 0.97]
    hero_samples = []
    for frac in picks_at:
        row = pred_rows[int(frac * (len(pred_rows) - 1))]
        name = row["id"]
        start = name.split("_")[1]
        out_name = f"hero_input_{row['d']}.png"
        mono_chart(test_images / name, OUT_ASSETS / out_name)
        hero_samples.append({"date": row["d"], "start": start, "p": row["p"], "label": row["label"], "file": out_name, "src": name})

    # ---- real model trace via the Lab's own code -------------------------------------
    from app.services.cnn_lab import core

    lm = core.get_model(str(model_path))
    conv_names = [c["name"] for c in lm.conv_layers]
    trace_src = hero_samples[3]["src"]
    x = core.load_batch([str(test_images / trace_src)], lm.input_size)
    probs, _ = core.predict(lm, x)
    p1 = float(probs[0, 1])

    fg_full = core.foreground_mask(x[0])
    layers_out = []
    for li, name in enumerate(conv_names):
        act = core.conv_activations(lm, x, name)[0]  # (h, w, c)
        flat = act.reshape(-1, act.shape[-1])
        alive = int((flat.max(axis=0) > 0).sum())
        fg = core.resize_map(fg_full.astype(np.float32), act.shape[:2]) > 0.5
        scale = flat.max(axis=0) + 1e-6
        contrast = (act[fg].mean(axis=0) - act[~fg].mean(axis=0)) / scale
        take = 16 if li == 0 else 12
        structure = [int(c) for c in np.argsort(-contrast) if contrast[c] > 0 and flat[:, c].max() > 0][: take - 2]
        background = [int(c) for c in np.argsort(contrast) if c not in structure][:2]
        order = structure + background
        files = []
        for k, ch in enumerate(order[:take]):
            fn = f"trace_l{li + 1}_{k:02d}.png"
            save_map(act[..., ch], OUT_ASSETS / fn)
            files.append(fn)
        layers_out.append(
            {"name": name, "h": int(act.shape[0]), "w": int(act.shape[1]), "channels": int(act.shape[-1]), "active": alive, "files": files}
        )

    cam, _ = core.gradcam_batch(lm, x, [1], conv_names[-1])
    cam224 = core.resize_map(cam[0], lm.input_size)
    save_heat_overlay(cam224, OUT_ASSETS / "trace_gradcam.png")
    save_map(cam224, OUT_ASSETS / "trace_gradcam_field.png", vmax=float(cam224.max()))
    mono_chart(test_images / trace_src, OUT_ASSETS / "trace_input.png")

    arch = []
    for layer in lm.model.layers:
        shape = getattr(layer, "output", None)
        try:
            out_shape = [int(s) for s in layer.output.shape[1:]]
        except Exception:
            out_shape = []
        cfg = layer.get_config()
        arch.append(
            {
                "name": layer.name,
                "kind": type(layer).__name__,
                "out": out_shape,
                "filters": cfg.get("filters"),
                "kernel": cfg.get("kernel_size"),
                "params": int(layer.count_params()),
            }
        )

    trace = {
        "provenance": "Computed locally with Convolve's Analysis Lab code on the MSFT model used in the backtest below.",
        "sample": {"date": hero_samples[3]["date"], "start": hero_samples[3]["start"], "label": hero_samples[3]["label"]},
        "p_label1": r(p1, 3),
        "layers": layers_out,
        "gradcam_layer": conv_names[-1],
        "input": "trace_input.png",
        "gradcam": "trace_gradcam.png",
    }

    # ---- dataset grid ------------------------------------------------------------------
    names = sorted(os.listdir(train_images))
    step = max(1, len(names) // 36)
    grid = []
    for i, name in enumerate(names[::step][:36]):
        fn = f"grid_{i:02d}.png"
        mono_chart(train_images / name, OUT_ASSETS / fn)
        parts = name[:-4].split("_")
        grid.append({"file": fn, "start": parts[1], "end": parts[3], "label": int(parts[-1][-1])})

    # ---- training curves -----------------------------------------------------------------
    tr_dir = runs / TRAINING_RUN
    epochs = [json.loads(l) for l in (tr_dir / "metrics.jsonl").read_text().splitlines() if l.strip()]
    summary = json.loads((tr_dir / "summary.json").read_text())
    meta = json.loads((tr_dir / "model_metadata.json").read_text())
    training = {
        "run": TRAINING_RUN,
        "dataset_id": meta.get("dataset_id"),
        "generator_run_id": meta.get("generator_run_id"),
        "symbol": "MSFT",
        "train_samples": summary["train_samples"],
        "val_samples": summary["val_samples"],
        "epochs_configured": summary["epochs_configured"],
        "epochs_trained": summary["epochs_trained"],
        "best_epoch": summary["best_epoch"],
        "monitor": summary["best_epoch_monitor"],
        "params": int(lm.model.count_params()),
        "epochs": [
            {
                "e": int(m["epoch"]),
                "loss": r(m["loss"]),
                "val_loss": r(m["val_loss"]),
                "acc": r(m["accuracy"]),
                "val_acc": r(m["val_accuracy"]),
            }
            for m in epochs
        ],
        "arch": arch,
    }

    # ---- backtest ----------------------------------------------------------------------
    res = json.loads((bt_dir / "output/backtest_results.json").read_text())
    eq = read_csv(bt_dir / "output/equity_daily.csv")
    bm = {row["date"]: row for row in read_csv(bt_dir / "output/benchmarks_daily.csv")}
    series = []
    for i, row in enumerate(eq):
        if i % 3 and i != len(eq) - 1:
            continue
        b = bm.get(row["date"])
        if not b:
            continue
        series.append(
            {
                "d": row["date"],
                "s": r(float(row["equity"]) / 10000, 4),
                "spy": r(float(b["spy"]) / 10000, 4),
                "und": r(float(b["underlying"]) / 10000, 4),
                "mix": r(float(b["exposure_matched"]) / 10000, 4),
            }
        )
    tm = res["trading_metrics"]
    curve = [
        {"t": r(c["threshold"], 2), "precision": r(c["precision"] or 0, 3), "recall": r(c["recall"] or 0, 3), "f1": r(c["f1"] or 0, 3)}
        for c in res["threshold"]["selection"]["curve"]
        if c.get("f1") is not None
    ]
    backtest = {
        "run": BACKTEST_RUN[:8],
        "label": "Price simulation v2",
        "symbol": "MSFT",
        "period": [eq[0]["date"], eq[-1]["date"]],
        "threshold": threshold["value"],
        "threshold_source": threshold["source"],
        "validation_n": threshold["selection"]["n_validation"],
        "costs": {"commission": v2.get("commission_pct"), "slippage": v2.get("slippage_pct")},
        "series": series,
        "threshold_curve": curve,
        "metrics": {
            k: (tm[k]["value"] if isinstance(tm.get(k), dict) else tm.get(k))
            for k in ("total_return", "max_drawdown", "executed_trades", "win_rate", "sharpe")
        },
        "benchmark_returns": {
            k: r(v["total_return"]["value"], 6)
            for k, v in res.get("benchmarks", {}).get("benchmarks", {}).items()
            if isinstance(v, dict) and isinstance(v.get("total_return"), dict)
        },
        "test_n": len(pred_rows),
        "model": Path(v2["model_path"]).stem.split("_")[-1],
        "findings": [
            {"severity": f.get("severity"), "title": f.get("title"), "interpretation": f.get("interpretation")}
            for f in res.get("findings", [])
        ][:6],
    }

    # ---- lab findings --------------------------------------------------------------------
    lab = json.loads((runs / LAB_SESSION / "lab" / "findings.json").read_text())["findings"]
    findings = [
        {"status": f.get("status"), "module": f.get("module"), "title": f.get("title"), "observation": (f.get("observation") or "")[:260]}
        for f in lab
    ]

    # ---- fleet (illustrative) --------------------------------------------------------------
    fx = json.loads(FLEET_FIXTURE.read_text())
    fs = fx["series"]
    fleet = {
        "illustrative": True,
        "source": "Synthetic development fixture (fleet12), generated by scripts/make_fleet_fixtures.py.",
        "t": [t[:16] for t in fs["t"]],
        "net_pnl": [None if v is None else r(v, 2) for v in fs["net_pnl"]],
        "bots": [
            {
                "name": b["name"],
                "symbol": b["symbol"],
                "status": b["status"],
                "ret": r(b["return"] or 0, 4),
                "spark": [None if v is None else r(v, 2) for v in fs["bots_net_pnl"].get(b["id"], [])[::6]],
            }
            for b in fx["bots"]
        ],
        "counts": fx["health"]["counts"],
        "runs_24h": fx["health"]["runs_24h"],
    }

    outputs = {
        "hero.json": {
            "symbol": "MSFT",
            "weekly": weekly_ohlc([row for row in ohlcv if row["timestamp"][:10] >= "2023-10-01"]),
            "predictions": [{"d": p["d"], "p": p["p"]} for p in pred_rows],
            "threshold": threshold["value"],
            "samples": [{k: v for k, v in s.items() if k != "src"} for s in hero_samples],
        },
        "trace.json": trace,
        "grid.json": {"symbol": "MSFT", "count": len(names), "tp": 0.02, "sl": 0.01, "horizon": 7, "size": 224, "tiles": grid},
        "training.json": training,
        "backtest.json": backtest,
        "lab.json": {"findings": findings},
        "fleet.json": fleet,
    }
    for name, payload in outputs.items():
        (OUT_DATA / name).write_text(json.dumps(payload, separators=(",", ":")))

    forbidden = [user, getpass.getuser(), "/Users/", "@"]
    for path in list(OUT_DATA.iterdir()):
        text = path.read_text()
        for word in forbidden:
            if word and word in text:
                raise SystemExit(f"forbidden token {word!r} leaked into {path.name}")
    print(f"ok: {len(list(OUT_ASSETS.iterdir()))} images, {len(outputs)} data files, p(label1) trace={p1:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
