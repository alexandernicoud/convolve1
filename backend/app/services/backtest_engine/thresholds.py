"""
Threshold protocol.

``validation_locked``: the threshold is selected on predictions for the model's recorded validation
images (training_state.json ``val_files``) with a fixed rule, then locked before the test set is
touched. ``user_fixed``: a threshold entered by the user. The test-set sweep is a sensitivity
analysis only — it never selects or replaces the headline threshold.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Sequence

import numpy as np

from .metrics import wilson

SELECTION_RULE = "max_f1_label1"
SELECTION_GRID = [round(x, 2) for x in np.arange(0.30, 0.901, 0.01)]
MIN_PREDICTED_POSITIVES = 10
SWEEP_GRID = [round(x, 2) for x in np.arange(0.30, 0.901, 0.05)]
SWEEP_LABEL = "In-sample sensitivity — not independently validated."


def select_on_validation(labels: Sequence[int], probs: Sequence[float]) -> Dict[str, Any]:
    """Highest label-1 F1 over a fixed grid, requiring >= MIN_PREDICTED_POSITIVES; ties -> lowest threshold."""
    y = np.asarray(labels, dtype=int)
    p = np.asarray(probs, dtype=float)
    rows: List[Dict[str, Any]] = []
    best: Optional[Dict[str, Any]] = None
    for t in SELECTION_GRID:
        yhat = p >= t
        k = int(yhat.sum())
        tp = int((yhat & (y == 1)).sum())
        pos = int((y == 1).sum())
        prec = tp / k if k else None
        rec = tp / pos if pos else None
        f1 = (2 * prec * rec / (prec + rec)) if (prec and rec) else None
        row = {"threshold": t, "predicted_positives": k, "precision": prec, "recall": rec, "f1": f1}
        rows.append(row)
        if k >= MIN_PREDICTED_POSITIVES and f1 is not None and (best is None or f1 > best["f1"] + 1e-12):
            best = row
    out: Dict[str, Any] = {
        "rule": SELECTION_RULE,
        "grid": [SELECTION_GRID[0], SELECTION_GRID[-1], 0.01],
        "min_predicted_positives": MIN_PREDICTED_POSITIVES,
        "n_validation": int(len(y)),
        "validation_base_rate": float(y.mean()) if len(y) else None,
        "curve": rows,
    }
    if best is None:
        out["threshold"] = None
        out["unavailable"] = f"no grid threshold yields >= {MIN_PREDICTED_POSITIVES} predicted positives with defined F1"
    else:
        out["threshold"] = best["threshold"]
        out["selected"] = best
    return out


def sensitivity_sweep(
    run_at: Callable[[float], Dict[str, Any]],
    labels: Sequence[Optional[int]],
    probs: Sequence[float],
    headline_threshold: float,
) -> Dict[str, Any]:
    """Re-run the simulation at each grid threshold on the same test data. Exploratory only."""
    y = np.asarray([-1 if v is None else v for v in labels], dtype=int)
    p = np.asarray(probs, dtype=float)
    known = y >= 0
    base = float(y[known].mean()) if known.any() else None
    grid = sorted(set(SWEEP_GRID) | {round(float(headline_threshold), 4)})
    rows = []
    for t in grid:
        sel = (p >= t) & known
        k = int(sel.sum())
        hits = int((y[sel] == 1).sum())
        sim = run_at(t)
        rows.append({
            "threshold": t,
            "is_headline": abs(t - headline_threshold) < 1e-9,
            "signals": int((p >= t).sum()),
            "label1_precision": hits / k if k else None,
            "label1_precision_ci95": wilson(hits, k),
            "n_labelled_signals": k,
            **sim,
        })
    return {"label": SWEEP_LABEL, "in_sample": True, "base_rate": base, "rows": rows}
