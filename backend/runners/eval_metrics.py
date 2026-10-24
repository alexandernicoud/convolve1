"""Classification metrics for binary chart models (label 1 = the positive class).

Inputs are true labels and P(label 1) per sample; ``cnn_inference.positive_probability`` turns
sigmoid and two-unit softmax outputs into that probability. A metric that is undefined for the
data (for example ROC-AUC when only one class is present) is returned as None together with a
reason, never as 0 or 0.5.

These are classification metrics. They say nothing about trading profitability, which depends
on position sizing, costs and the size of wins and losses (see the Backtester).
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Sequence

import numpy as np

METRICS_VERSION = 1
EPS = 1e-7
HISTOGRAM_BINS = 10


def _ratio(num: float, den: float) -> Optional[float]:
    return float(num) / float(den) if den else None


def roc_auc(y: np.ndarray, p: np.ndarray) -> Optional[float]:
    """Probability that a random positive scores higher than a random negative (ties count 1/2)."""
    pos, neg = int(y.sum()), int(len(y) - y.sum())
    if pos == 0 or neg == 0:
        return None
    order = np.argsort(p, kind="mergesort")
    ranks = np.empty(len(p), dtype=np.float64)
    sorted_p = p[order]
    i = 0
    while i < len(p):
        j = i
        while j + 1 < len(p) and sorted_p[j + 1] == sorted_p[i]:
            j += 1
        ranks[order[i : j + 1]] = (i + j) / 2.0 + 1.0
        i = j + 1
    return float((ranks[y == 1].sum() - pos * (pos + 1) / 2.0) / (pos * neg))


def average_precision(y: np.ndarray, p: np.ndarray) -> Optional[float]:
    """Area under the precision-recall curve as the step sum over distinct thresholds."""
    pos = int(y.sum())
    if pos == 0:
        return None
    order = np.argsort(-p, kind="mergesort")
    ys, ps = y[order], p[order]
    tp = np.cumsum(ys)
    fp = np.cumsum(1 - ys)
    last = np.r_[np.where(np.diff(ps) != 0)[0], len(ps) - 1]
    precision = tp[last] / (tp[last] + fp[last])
    recall = tp[last] / pos
    prev = np.r_[0.0, recall[:-1]]
    return float(np.sum((recall - prev) * precision))


def binary_metrics(
    y_true: Sequence[int],
    p1: Sequence[float],
    *,
    threshold: float = 0.5,
    train_label_counts: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    y = np.asarray(y_true, dtype=np.int64).reshape(-1)
    p = np.asarray(p1, dtype=np.float64).reshape(-1)
    if len(y) != len(p):
        raise ValueError("labels and probabilities differ in length")
    if np.any((y != 0) & (y != 1)):
        raise ValueError("binary metrics need labels 0 and 1")
    n = int(len(y))
    out: Dict[str, Any] = {"metrics_version": METRICS_VERSION, "n": n, "threshold": threshold, "undefined": {}}
    if n == 0:
        out["undefined"]["all"] = "no samples"
        return out
    pred = (p >= threshold).astype(np.int64)
    tp = int(np.sum((pred == 1) & (y == 1)))
    tn = int(np.sum((pred == 0) & (y == 0)))
    fp = int(np.sum((pred == 1) & (y == 0)))
    fn = int(np.sum((pred == 0) & (y == 1)))
    pos, neg = tp + fn, tn + fp
    undefined = out["undefined"]

    per_class: Dict[str, Dict[str, Optional[float]]] = {}
    for cls, (c_tp, c_fp, c_fn) in (("1", (tp, fp, fn)), ("0", (tn, fn, fp))):
        precision = _ratio(c_tp, c_tp + c_fp)
        recall = _ratio(c_tp, c_tp + c_fn)
        f1 = (2 * precision * recall / (precision + recall)) if precision and recall else (0.0 if precision == 0 or recall == 0 else None)
        per_class[cls] = {"precision": precision, "recall": recall, "f1": f1, "support": c_tp + c_fn}
        if precision is None:
            undefined[f"precision_{cls}"] = f"the model never predicted label {cls}"
        if recall is None:
            undefined[f"recall_{cls}"] = f"no samples with label {cls}"
    recalls = [per_class[c]["recall"] for c in ("0", "1") if per_class[c]["recall"] is not None]
    balanced = float(np.mean(recalls)) if len(recalls) == 2 else None
    if balanced is None:
        undefined["balanced_accuracy"] = "needs samples of both labels"
    f1s = [per_class[c]["f1"] for c in ("0", "1")]
    macro_f1 = float(np.mean(f1s)) if all(v is not None for v in f1s) else None

    pc = np.clip(p, EPS, 1 - EPS)
    log_loss = float(-np.mean(y * np.log(pc) + (1 - y) * np.log(1 - pc)))
    brier = float(np.mean((p - y) ** 2))
    auc = roc_auc(y, p)
    ap = average_precision(y, p)
    if auc is None:
        undefined["roc_auc"] = "needs samples of both labels"
    if ap is None:
        undefined["pr_auc"] = "needs samples with label 1"

    edges = np.linspace(0.0, 1.0, HISTOGRAM_BINS + 1)
    hist = {
        "edges": [round(float(e), 2) for e in edges],
        "label_0": np.histogram(p[y == 0], bins=edges)[0].astype(int).tolist(),
        "label_1": np.histogram(p[y == 1], bins=edges)[0].astype(int).tolist(),
    }

    out.update(
        {
            "label_counts": {"0": neg, "1": pos},
            "predicted_counts": {"0": int(np.sum(pred == 0)), "1": int(np.sum(pred == 1))},
            "confusion_matrix": {"labels": [0, 1], "rows_true_cols_pred": [[tn, fp], [fn, tp]]},
            "accuracy": (tp + tn) / n,
            "balanced_accuracy": balanced,
            "precision": per_class["1"]["precision"],
            "recall": per_class["1"]["recall"],
            "f1": per_class["1"]["f1"],
            "macro_f1": macro_f1,
            "per_class": per_class,
            "roc_auc": auc,
            "pr_auc": ap,
            "pr_auc_no_skill": pos / n,
            "log_loss": log_loss,
            "brier": brier,
            "mean_probability": float(np.mean(p)),
            "probability_histogram": hist,
        }
    )
    out["baseline"] = majority_baseline(y, train_label_counts)
    return out


def majority_baseline(y: np.ndarray, train_label_counts: Optional[Dict[str, int]]) -> Dict[str, Any]:
    """Always predicting the training majority class, and always predicting the training share
    of label 1 as a probability. A model has to beat both to show any skill on this data."""
    counts = {str(k): int(v) for k, v in (train_label_counts or {}).items()}
    n0, n1 = counts.get("0", 0), counts.get("1", 0)
    source = "training labels"
    if n0 + n1 == 0:
        n0, n1 = int(np.sum(y == 0)), int(np.sum(y == 1))
        source = "evaluated labels"
    majority = 1 if n1 > n0 else 0
    prior = n1 / (n0 + n1) if n0 + n1 else 0.5
    n = len(y)
    if n == 0:
        return {"source": source}
    pc = min(max(prior, EPS), 1 - EPS)
    return {
        "source": source,
        "majority_label": majority,
        "tie": n0 == n1,
        "accuracy": float(np.mean(y == majority)),
        "balanced_accuracy": 0.5 if 0 < int(y.sum()) < n else None,
        "prior_label_1": prior,
        "log_loss": float(-np.mean(y * np.log(pc) + (1 - y) * np.log(1 - pc))),
        "brier": float(np.mean((prior - y) ** 2)),
    }


def epoch_scores(logs: Dict[str, Any], prefix: str = "val_") -> Dict[str, Optional[float]]:
    """Balanced accuracy, precision, recall and F1 for label 1 from Keras' confusion counts."""
    try:
        tp, tn, fp, fn = (float(logs[f"{prefix}{k}"]) for k in ("tp", "tn", "fp", "fn"))
    except (KeyError, TypeError, ValueError):
        return {}
    recall1 = _ratio(tp, tp + fn)
    recall0 = _ratio(tn, tn + fp)
    precision = _ratio(tp, tp + fp)
    f1 = (2 * precision * recall1 / (precision + recall1)) if precision and recall1 else None
    return {
        f"{prefix}balanced_accuracy": (recall0 + recall1) / 2 if recall0 is not None and recall1 is not None else None,
        f"{prefix}precision": precision,
        f"{prefix}recall": recall1,
        f"{prefix}f1": f1,
    }
