"""Stage timings recovered from timestamps that completed local trainer runs already wrote.

    python -m scripts.perf.mine_trainer_runs [runs_dir]

Uses run_manifest.json / training_state.json / metrics.jsonl / summary.json only. Prints one row
per run: samples, image size, epochs, time to data ready, first epoch, mean later epoch, save.
"""

from __future__ import annotations

import json
import statistics
import sys
from datetime import datetime
from pathlib import Path


def _run_started(run_dir: Path) -> float | None:
    manifest = run_dir / "run_manifest.json"
    if manifest.is_file():
        try:
            data = json.loads(manifest.read_text())
            for key in ("created_at", "started_at"):
                if isinstance(data.get(key), (int, float)):
                    return float(data[key])
        except (OSError, ValueError):
            pass
    try:
        return datetime.strptime(run_dir.name[:15], "%Y%m%d_%H%M%S").timestamp()
    except ValueError:
        return None


def main(root: Path) -> None:
    rows = []
    for summary_path in root.rglob("summary.json"):
        try:
            summary = json.loads(summary_path.read_text())
        except (OSError, ValueError):
            continue
        if "epochs_trained" not in summary:
            continue
        run_dir = summary_path.parent
        metrics = []
        mpath = run_dir / "metrics.jsonl"
        if mpath.is_file():
            for line in mpath.read_text().splitlines():
                try:
                    metrics.append(json.loads(line))
                except ValueError:
                    pass
        stamps = [m["timestamp"] for m in metrics if isinstance(m.get("timestamp"), (int, float))]
        if not stamps:
            continue
        started = _run_started(run_dir)
        state = {}
        if (run_dir / "training_state.json").is_file():
            state = json.loads((run_dir / "training_state.json").read_text())
        ready = state.get("data_ready_at")
        epochs = [b - a for a, b in zip(stamps, stamps[1:])]
        rows.append(
            {
                "run": run_dir.name[:24],
                "train": summary.get("train_samples"),
                "val": summary.get("val_samples"),
                "img": "x".join(str(v) for v in summary.get("image_size") or []),
                "batch": summary.get("batch_size"),
                "epochs": summary.get("epochs_trained"),
                "start_to_ready": round(ready - started, 1) if ready and started else None,
                "start_to_epoch1": round(stamps[0] - started, 1) if started else None,
                "ready_to_epoch1": round(stamps[0] - ready, 1) if ready else None,
                "epoch_median": round(statistics.median(epochs), 1) if epochs else None,
                "save": round(summary["completed_at"] - stamps[-1], 1) if summary.get("completed_at") else None,
                "total": round(summary["completed_at"] - started, 1) if summary.get("completed_at") and started else None,
                "model_mb": round(sum(p.stat().st_size for p in run_dir.glob("*.keras")) / 1e6, 1),
            }
        )
    rows.sort(key=lambda r: (r["train"] or 0))
    keys = list(rows[0]) if rows else []
    print("\t".join(keys))
    for row in rows:
        print("\t".join("" if row[k] is None else str(row[k]) for k in keys))


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "runs"))
