"""Cost and wall time per training job by dataset size and machine. PROJECTIONS, not measurements.

Every input is listed in OPTIONS / ASSUMPTIONS with its source. Replace a range with a measured
number (scripts/perf/cloud_bench.py) as soon as one exists.

    python scripts/perf/cost_model.py [--json out.json]

Model: one run trains on 80% of N images and validates on 20% for E epochs (30 = the standard
cap, an upper bound because early stopping usually ends earlier):
    seconds = fixed + E * (0.8 N / train_rate + 0.2 N / eval_rate)
    cost    = seconds * price_per_second           (billing minimum 60 s on Cloud Run)
"""

from __future__ import annotations

import argparse
import json

SIZES = (500, 2_000, 10_000, 100_000, 1_000_000)
EPOCHS = 30
# Measured on M1 (8 cores): v1 eval/train throughput ratio 176/44.9 = 3.9; compact 376/122.9 = 3.1.
EVAL_OVER_TRAIN = 3.5

ZRH_VCPU_S = 0.0000216  # Cloud Run jobs, europe-west6 (Tier 2), from the earlier pricing review; verify SKU
ZRH_GIB_S = 0.0000024
T1_VCPU_S = 0.000018  # cloud.google.com/run/pricing, jobs, Tier 1 (europe-west1/-west4), read 2026-10-24
T1_GIB_S = 0.000002
L4_S = 0.0001867  # Cloud Run L4 without zonal redundancy, same page

OPTIONS = [
    {
        "id": "cpu-zrh-v1",
        "label": "Cloud Run CPU, Zurich, 8 vCPU / 8 GiB, original network (today)",
        "region": "europe-west6 (CH)",
        "usd_per_s": 8 * ZRH_VCPU_S + 8 * ZRH_GIB_S,
        # 2,000 images x 30 epochs in ~7-15 min on staging (trainer-job.yaml note) => ~55-110 img/s.
        "train_rate": (55, 110),
        "fixed_s": (40, 90),  # container start + TF import + dataset restore + save (staging timings)
        "basis": "train rate from staging runs (range); price from earlier review",
    },
    {
        "id": "cpu-zrh-compact",
        "label": "Cloud Run CPU, Zurich, 8 vCPU / 8 GiB, compact network (experimental)",
        "region": "europe-west6 (CH)",
        "usd_per_s": 8 * ZRH_VCPU_S + 8 * ZRH_GIB_S,
        # Measured 2.7x the v1 step rate on the same machine (M1 matrix); applied to the v1 range.
        "train_rate": (55 * 2.7, 110 * 2.7),
        "fixed_s": (40, 90),
        "basis": "v1 staging range x measured 2.7x speed-up (local M1)",
    },
    {
        "id": "l4-cloudrun-eu",
        "label": "Cloud Run L4, Netherlands/Belgium, 4 vCPU / 16 GiB",
        "region": "europe-west4 / europe-west1 (EU, outside CH)",
        "usd_per_s": 4 * T1_VCPU_S + 16 * T1_GIB_S + L4_S,
        # FLOP bound: v1 needs 2.84 GFLOP per training image; L4 ~30 TFLOPS FP32 (TF32 off) at
        # 30-40% => ~3,000-4,000 img/s. PNG decode on 4 vCPU (~1.2-1.6k img/s, scaled from the
        # 8-core 3.2k measured) caps it unless the decoded cache fits. Range: 800-2,000 img/s.
        "train_rate": (800, 2_000),
        "fixed_s": (60, 150),  # ~5 s GPU instance start + multi-GB image pull + CUDA/TF init: unmeasured
        "basis": "projection from FLOPs and measured CPU decode rate; not measured on an L4",
    },
    {
        "id": "l4-batch-zrh",
        "label": "Cloud Batch G2 (L4), Zurich, g2-standard-8, on demand",
        "region": "europe-west6 (CH)",
        "usd_per_s": 1.168 / 3600,  # third-party list price (DevZero); verify in the GCP calculator
        "train_rate": (900, 2_200),  # same GPU, 8 vCPU for decoding
        "fixed_s": (180, 420),  # VM boot + GPU driver install + image pull: unmeasured
        "basis": "projection; VM price unverified; Batch start-up unmeasured",
    },
    {
        "id": "l4-batch-zrh-spot",
        "label": "Cloud Batch G2 (L4), Zurich, spot",
        "region": "europe-west6 (CH)",
        "usd_per_s": 0.699 / 3600,  # third-party; spot prices change and VMs can be preempted
        "train_rate": (900, 2_200),
        "fixed_s": (180, 420),
        "basis": "projection; preemption resumes from the epoch checkpoint",
    },
]


def project(option: dict, n: int, epochs: int = EPOCHS) -> dict:
    out = {}
    for label, rate, fixed in (("fast", option["train_rate"][1], option["fixed_s"][0]),
                               ("slow", option["train_rate"][0], option["fixed_s"][1])):
        work = epochs * (0.8 * n / rate + 0.2 * n / (rate * EVAL_OVER_TRAIN))
        seconds = max(60.0, fixed + work)
        out[label] = {"seconds": round(seconds), "usd": round(seconds * option["usd_per_s"], 4)}
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    ap.add_argument("--epochs", type=int, default=EPOCHS)
    args = ap.parse_args()
    rows = []
    for opt in OPTIONS:
        for n in SIZES:
            p = project(opt, n, args.epochs)
            rows.append({"option": opt["id"], "region": opt["region"], "images": n, **p,
                         "usd_per_hour": round(opt["usd_per_s"] * 3600, 3), "basis": opt["basis"]})

    def fmt_t(s):
        return f"{s / 60:.0f} min" if s < 5400 else f"{s / 3600:.1f} h"

    print(f"PROJECTION, {args.epochs} epochs (upper bound; early stopping usually ends sooner)")
    print(f"{'option':<20}{'images':>10}  {'time (fast-slow)':<22}{'USD (fast-slow)':<18}")
    for r in rows:
        t = f"{fmt_t(r['fast']['seconds'])} - {fmt_t(r['slow']['seconds'])}"
        c = f"{r['fast']['usd']:.2f} - {r['slow']['usd']:.2f}"
        print(f"{r['option']:<20}{r['images']:>10,}  {t:<22}{c:<18}")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({"epochs": args.epochs, "options": OPTIONS, "rows": rows}, fh, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
