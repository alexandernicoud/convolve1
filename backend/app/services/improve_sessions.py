"""Improvement sessions: every Improve experiment is compared with one fixed original model (the anchor).

A session is identified by its anchor run: ``imp_<anchor_run_id>``. Experiments record the anchor
explicitly (experiment record version 2). Older records only know their direct parent; their anchor
is recovered by walking recorded ``parent_run_id`` links up to the first run that is not an
experiment. Nothing is guessed when a link is missing.

Verdicts are deliberately conservative. A variant is only "clearly improved" (or "worse") when its
difference from the anchor's configuration exceeds both the run-to-run noise measured by repeated
seeds and the sampling error of the validation metric. Without at least two controlled seed
replicates of the original configuration the run-to-run noise is unknown, and the verdict is
"no clear difference / insufficient evidence" whatever the raw difference.

Validation metrics measure classification quality on held-out charts. They never establish that a
model trades profitably.
"""

from __future__ import annotations

import json
import math
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

SESSION_PREFIX = "imp_"
MAX_CHAIN = 25

# Lifecycle of a trained model with respect to Improve.
LIFECYCLE_MODEL = "model"  # ordinary model (not created by Improve)
LIFECYCLE_CANDIDATE = "candidate"  # Improve experiment awaiting the user's decision
LIFECYCLE_KEPT = "kept"  # promoted into the library by the user
LIFECYCLE_ARCHIVED = "archived"  # discarded by the user (hidden, recoverable, never deleted)

DECISIONS = ("keep", "discard", "restore")
DECISION_KEY = "improve_decision"

VERDICT_IMPROVED = "clearly_improved"
VERDICT_NO_DIFF = "no_clear_difference"
VERDICT_INSUFFICIENT = "insufficient_evidence"
VERDICT_WORSE = "worse"
VERDICT_NOT_COMPARABLE = "not_comparable"
VERDICT_PENDING = "pending"

# Settings that define the training configuration (seed excluded: replicates differ only in seed).
_TRAINING_OPTION_KEYS = (
    "optimizer",
    "lr_schedule",
    "regularization",
    "early_stopping",
    "selection_metric",
    "class_weighting",
    "augmentation",
    "transfer",
)
# Settings that define which charts are used for training and validation.
_SPLIT_OPTION_KEYS = (
    "protocol",
    "validation_method",
    "test_fraction",
    "purge_chart_windows",
    "embargo_bars",
    "label_horizon_bars",
    "label_timeframe",
)

# Two-sided 95% Student-t critical values by degrees of freedom (df > 30 uses the normal value).
_T95 = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131, 16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093,
    20: 2.086, 21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060, 26: 2.056, 27: 2.052, 28: 2.048,
    29: 2.045, 30: 2.042,
}
Z95 = 1.96
MIN_BASELINE_RUNS = 3  # the original configuration trained with at least three seeds


def session_id_for(anchor_run_id: str) -> str:
    return f"{SESSION_PREFIX}{anchor_run_id}"


def experiment_of_summary(summary: Optional[Dict[str, Any]], metadata: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """The stored experiment record of a run, from model_metadata.json or summary.json."""
    for source in ((metadata or {}).get("training_config"), (summary or {}).get("config")):
        exp = (source or {}).get("experiment") if isinstance(source, dict) else None
        if isinstance(exp, dict) and exp.get("parent_run_id"):
            return exp
    return None


def resolve_anchor(run_id: str, experiment_of: Callable[[str], Optional[Dict[str, Any]]]) -> Tuple[str, List[str]]:
    """``(anchor_run_id, chain)``; chain lists the runs from ``run_id`` up to (excluding) the anchor.

    ``experiment_of`` returns a run's experiment record (None for ordinary models or unknown runs)
    and must only return records of runs the caller owns.
    """
    chain: List[str] = []
    current = run_id
    seen = {run_id}
    for _ in range(MAX_CHAIN):
        exp = experiment_of(current)
        if not exp:
            return current, chain
        explicit = exp.get("anchor_run_id")
        if isinstance(explicit, str) and explicit and explicit != current:
            chain.append(current)
            return explicit, chain
        parent = exp.get("parent_run_id")
        if not isinstance(parent, str) or not parent or parent in seen:
            return current, chain
        chain.append(current)
        seen.add(parent)
        current = parent
    return current, chain


def _num(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None


def metrics_from_summary(summary: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Validation metrics of the saved weights. Missing values stay None."""
    s = summary or {}
    val = ((s.get("evaluation") or {}).get("validation") or {}) if isinstance(s.get("evaluation"), dict) else {}
    saved = s.get("saved_weights_metrics") if isinstance(s.get("saved_weights_metrics"), dict) else None
    if saved is None and isinstance(s.get("final_metrics"), dict):
        saved = s["final_metrics"]
    saved = saved or {}
    acc, vacc = _num(saved.get("accuracy")), _num(saved.get("val_accuracy"))
    model = s.get("model") if isinstance(s.get("model"), dict) else {}
    n_val = val.get("n") if isinstance(val.get("n"), int) else (s.get("val_samples") if isinstance(s.get("val_samples"), int) else None)
    return {
        "roc_auc": _num(val.get("roc_auc")),
        "pr_auc": _num(val.get("pr_auc")),
        "balanced_accuracy": _num(val.get("balanced_accuracy")),
        "log_loss": _num(val.get("log_loss")),
        "val_loss": _num(saved.get("val_loss")),
        "val_accuracy": vacc if vacc is not None else _num(val.get("accuracy")),
        "train_val_gap": (acc - vacc) if acc is not None and vacc is not None else None,
        "parameters": model.get("parameters") if isinstance(model.get("parameters"), int) else None,
        "saved_epoch": s.get("saved_weights_epoch") if isinstance(s.get("saved_weights_epoch"), int) else s.get("best_epoch"),
        "epochs_trained": s.get("epochs_trained") if isinstance(s.get("epochs_trained"), int) else None,
        "n_val": n_val,
        "majority_share": _num(val.get("baseline_accuracy")),
    }


def _canon(v: Any) -> str:
    return json.dumps(v, sort_keys=True, default=str)


def effective_config(summary: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Resolved settings a run actually trained with (from summary.json, not the raw request)."""
    s = summary or {}
    cfg = s.get("config") if isinstance(s.get("config"), dict) else {}
    opts = s.get("options") if isinstance(s.get("options"), dict) else {}
    model = s.get("model") if isinstance(s.get("model"), dict) else {}
    setup = s.get("training_setup") if isinstance(s.get("training_setup"), dict) else {}
    repro = s.get("reproducibility") if isinstance(s.get("reproducibility"), dict) else {}
    image = s.get("image_size")
    training = {
        "architecture": model.get("architecture") or setup.get("architecture") or cfg.get("architecture") or "convolve-cnn-v1",
        "image_size": list(image) if isinstance(image, (list, tuple)) else image,
        "batch_size": s.get("batch_size"),
        "epochs": s.get("epochs_configured"),
        **{k: opts.get(k) for k in _TRAINING_OPTION_KEYS},
    }
    split = {
        "dataset_id": cfg.get("dataset_id"),
        "val_split": 0.2 if cfg.get("use_standard_config") else cfg.get("val_split"),
        **{k: opts.get(k) for k in _SPLIT_OPTION_KEYS},
    }
    if split["protocol"] is None:
        split["protocol"] = s.get("trainer_protocol") or cfg.get("trainer_protocol") or 1
    seed = repro.get("random_seed", cfg.get("random_seed"))
    return {"training": training, "split": split, "seed": seed, "val_samples": s.get("val_samples")}


def training_signature(config: Dict[str, Any]) -> str:
    return _canon(config.get("training") or {})


_LABELS = {
    "architecture": "Architecture",
    "image_size": "Image size",
    "batch_size": "Batch size",
    "epochs": "Max epochs",
    "optimizer": "Optimizer",
    "lr_schedule": "Learning-rate schedule",
    "regularization": "Regularization",
    "early_stopping": "Early stopping",
    "selection_metric": "Checkpoint metric",
    "class_weighting": "Class weights",
    "augmentation": "Augmentation",
    "transfer": "Pretrained weights",
    "seed": "Seed",
}


def config_diff(anchor: Dict[str, Any], other: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """``(changed, unchanged)`` training settings of ``other`` relative to ``anchor``."""
    changed: List[Dict[str, Any]] = []
    unchanged: List[str] = []
    a, b = anchor.get("training") or {}, other.get("training") or {}
    for key in ("architecture", "image_size", "batch_size", "epochs", *_TRAINING_OPTION_KEYS):
        if _canon(a.get(key)) != _canon(b.get(key)):
            changed.append({"setting": key, "label": _LABELS[key], "from": a.get(key), "to": b.get(key)})
        else:
            unchanged.append(_LABELS[key])
    if anchor.get("seed") != other.get("seed"):
        changed.append({"setting": "seed", "label": "Seed", "from": anchor.get("seed"), "to": other.get("seed")})
    else:
        unchanged.append("Seed")
    return changed, unchanged


def split_mismatch(anchor: Dict[str, Any], other: Dict[str, Any]) -> List[str]:
    """Reasons the two runs did not train/validate on the same charts (empty when they did)."""
    out: List[str] = []
    a, b = anchor.get("split") or {}, other.get("split") or {}
    if a.get("dataset_id") != b.get("dataset_id"):
        out.append("Different dataset")
    if _num(a.get("val_split")) != _num(b.get("val_split")):
        out.append("Different validation share")
    if a.get("protocol") != b.get("protocol"):
        out.append("Different trainer protocol (validation split rules changed)")
    for key, label in (
        ("validation_method", "Different validation method"),
        ("test_fraction", "Different test reserve"),
        ("purge_chart_windows", "Different purging"),
        ("embargo_bars", "Different embargo"),
        ("label_horizon_bars", "Different label horizon"),
    ):
        if _canon(a.get(key)) != _canon(b.get(key)):
            out.append(label)
    va, vb = anchor.get("val_samples"), other.get("val_samples")
    if not out and isinstance(va, int) and isinstance(vb, int) and va != vb:
        out.append("Validation sample count differs, so the split is not identical")
    return out


def auc_standard_error(auc: Optional[float], n: Optional[int], majority_share: Optional[float]) -> Optional[float]:
    """Hanley & McNeil (1982) standard error of a ROC-AUC estimate."""
    if auc is None or not isinstance(n, int) or n < 4 or majority_share is None:
        return None
    n_major = int(round(majority_share * n))
    n_minor = n - n_major
    if n_major < 2 or n_minor < 2:
        return None
    a = min(max(auc, 1e-6), 1 - 1e-6)
    q1 = a / (2 - a)
    q2 = 2 * a * a / (1 + a)
    var = (a * (1 - a) + (n_minor - 1) * (q1 - a * a) + (n_major - 1) * (q2 - a * a)) / (n_minor * n_major)
    return math.sqrt(var) if var > 0 else None


def _mean(xs: Sequence[float]) -> float:
    return sum(xs) / len(xs)


def _sd(xs: Sequence[float]) -> Optional[float]:
    if len(xs) < 2:
        return None
    m = _mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def t_critical(df: int) -> float:
    if df <= 0:
        return float("inf")
    return _T95.get(df, Z95)


def verdict(
    baseline: Sequence[Dict[str, Any]],
    variant: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    """Compare a variant's runs with runs of the original configuration on validation ROC-AUC.

    ``baseline`` and ``variant`` are metric dicts (``metrics_from_summary``) of completed runs that
    share the anchor's dataset and split. The rule (all at 95%):

    * run-to-run noise: the sample SD of the baseline-configuration runs (pooled with the variant's
      own replicates when there are any); needs >= ``MIN_BASELINE_RUNS`` baseline runs,
    * sampling error: Hanley-McNeil standard errors of both AUCs, treated as independent (the
      validation charts are shared, so this overstates the error and keeps the verdict cautious),
    * the difference of means must exceed ``t * sqrt(noise_se^2 + sampling_se^2)``.
    """
    metric = "roc_auc"
    b_vals = [m[metric] for m in baseline if m.get(metric) is not None]
    v_vals = [m[metric] for m in variant if m.get(metric) is not None]
    if not v_vals or not b_vals:
        return {
            "verdict": VERDICT_PENDING if not v_vals else VERDICT_INSUFFICIENT,
            "metric": metric,
            "reason": "No validation ROC-AUC recorded yet." if not v_vals else "The original configuration has no recorded ROC-AUC.",
        }
    mb, mv = _mean(b_vals), _mean(v_vals)
    diff = mv - mb
    base_info = {
        "metric": metric,
        "difference": diff,
        "variant_mean": mv,
        "baseline_mean": mb,
        "variant_runs": len(v_vals),
        "baseline_runs": len(b_vals),
    }
    sampling = [
        auc_standard_error(m.get(metric), m.get("n_val"), m.get("majority_share"))
        for m in (variant[0], baseline[0])
    ]
    sampling_se = math.sqrt(sum(s * s for s in sampling)) if all(s is not None for s in sampling) else None
    if len(b_vals) < MIN_BASELINE_RUNS:
        return {
            **base_info,
            "verdict": VERDICT_INSUFFICIENT,
            "sampling_se": sampling_se,
            "reason": (
                f"Run-to-run noise is unknown: the original configuration has {len(b_vals)} completed run(s) "
                f"with this split; at least {MIN_BASELINE_RUNS} (the original plus two seed replicates) are needed "
                "before a difference can be called clear."
            ),
        }
    if sampling_se is None:
        return {
            **base_info,
            "verdict": VERDICT_INSUFFICIENT,
            "reason": "The validation class counts needed for the ROC-AUC sampling error are not recorded.",
        }
    sd_b = _sd(b_vals) or 0.0
    sd_v = _sd(v_vals)
    if sd_v is not None:
        df = len(b_vals) + len(v_vals) - 2
        pooled = math.sqrt(((len(b_vals) - 1) * sd_b**2 + (len(v_vals) - 1) * sd_v**2) / df)
    else:
        df = len(b_vals) - 1
        pooled = sd_b
    noise_se = pooled * math.sqrt(1 / len(b_vals) + 1 / len(v_vals))
    total_se = math.sqrt(noise_se**2 + sampling_se**2)
    t = t_critical(df)
    margin = t * total_se
    out = {**base_info, "seed_sd": pooled, "noise_se": noise_se, "sampling_se": sampling_se, "margin": margin, "df": df}
    if diff > margin:
        return {**out, "verdict": VERDICT_IMPROVED, "reason": (
            f"ROC-AUC is higher by {diff:+.3f}, more than the 95% margin of ±{margin:.3f} from seed noise and validation sampling."
        )}
    if diff < -margin:
        return {**out, "verdict": VERDICT_WORSE, "reason": (
            f"ROC-AUC is lower by {diff:+.3f}, beyond the 95% margin of ±{margin:.3f}."
        )}
    return {**out, "verdict": VERDICT_NO_DIFF, "reason": (
        f"The ROC-AUC difference ({diff:+.3f}) is within the 95% margin of ±{margin:.3f} from seed noise and validation sampling."
    )}


def efficiency_note(anchor: Dict[str, Any], variant_runs: Sequence[Dict[str, Any]], v: str) -> Optional[str]:
    """Size/time changes reported separately from predictive quality."""
    pa = anchor.get("parameters")
    pv = variant_runs[0].get("parameters") if variant_runs else None
    if not isinstance(pa, int) or not isinstance(pv, int) or pa <= 0 or v == VERDICT_WORSE:
        return None
    ratio = pv / pa
    if ratio <= 0.8:
        return f"{(1 - ratio) * 100:.0f}% fewer parameters than the original; this is a size reduction, not a predictive improvement."
    if ratio >= 1.25:
        return f"{(ratio - 1) * 100:.0f}% more parameters than the original."
    return None


def lifecycle_of(experiment: Optional[Dict[str, Any]], decision: Optional[Dict[str, Any]]) -> str:
    if not experiment:
        return LIFECYCLE_MODEL
    d = (decision or {}).get("decision")
    if d == "kept":
        return LIFECYCLE_KEPT
    if d == "discarded":
        return LIFECYCLE_ARCHIVED
    return LIFECYCLE_CANDIDATE


def apply_decision(previous: Optional[Dict[str, Any]], action: str, *, at: float, preferred: bool = False) -> Dict[str, Any]:
    """New decision record. History is appended, never rewritten."""
    if action not in DECISIONS:
        raise ValueError(f"decision must be one of {', '.join(DECISIONS)}")
    prev = dict(previous or {})
    history = list(prev.get("history") or [])[-49:]
    state = {"keep": "kept", "discard": "discarded", "restore": None}[action]
    history.append({"action": action, "at": at, **({"preferred": True} if preferred and action == "keep" else {})})
    return {
        "decision": state,
        "decided_at": at if state else None,
        "preferred": bool(preferred) if action == "keep" else False,
        "history": history,
    }


STATUS_GROUPS = ("queued", "running", "awaiting_decision", "kept", "archived", "failed")


def status_group(run_status: str, lifecycle: str) -> str:
    s = (run_status or "").lower()
    if s in ("queued", "pending"):
        return "queued"
    if s in ("running", "starting"):
        return "running"
    if s in ("failed", "cancelled", "interrupted", "error"):
        return "failed"
    if lifecycle == LIFECYCLE_KEPT:
        return "kept"
    if lifecycle == LIFECYCLE_ARCHIVED:
        return "archived"
    return "awaiting_decision"


def merge_histories(histories: Iterable[Iterable[Dict[str, Any]]], limit: int = 50) -> List[Dict[str, Any]]:
    """Union of selection histories, de-duplicated by inspected run, order preserved."""
    out: List[Dict[str, Any]] = []
    seen = set()
    for hist in histories:
        for h in hist or []:
            if not isinstance(h, dict):
                continue
            key = (h.get("kind"), h.get("run_id"), h.get("dataset_id"), h.get("first_decision"), h.get("last_decision"))
            if key in seen:
                continue
            seen.add(key)
            out.append(h)
    return out[-limit:]


def build_session(
    anchor: Dict[str, Any],
    members: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    """Assemble the workspace view.

    ``anchor``/``members``: ``{"id", "status", "created_at", "summary", "experiment", "decision",
    "name", "chain"}`` for the anchor run and every run whose resolved anchor is it.
    """
    a_cfg = effective_config(anchor.get("summary"))
    a_metrics = metrics_from_summary(anchor.get("summary"))
    a_done = anchor.get("status") == "succeeded" and anchor.get("summary") is not None
    a_sig = training_signature(a_cfg)

    prepared = []
    for m in members:
        summary = m.get("summary")
        cfg = effective_config(summary) if summary else None
        done = m.get("status") == "succeeded" and summary is not None
        mismatch = split_mismatch(a_cfg, cfg) if cfg and a_done else []
        prepared.append({**m, "cfg": cfg, "done": done, "mismatch": mismatch, "metrics": metrics_from_summary(summary) if summary else None})

    def same_split(p: Dict[str, Any]) -> bool:
        return bool(p["done"] and p["cfg"] and not p["mismatch"])

    baseline_runs: List[Dict[str, Any]] = [a_metrics] if a_done else []
    baseline_ids: List[str] = [anchor["id"]] if a_done else []
    for p in prepared:
        if same_split(p) and training_signature(p["cfg"]) == a_sig:
            baseline_runs.append(p["metrics"])
            baseline_ids.append(p["id"])

    by_sig: Dict[str, List[Dict[str, Any]]] = {}
    for p in prepared:
        if same_split(p):
            by_sig.setdefault(training_signature(p["cfg"]), []).append(p)

    experiments: List[Dict[str, Any]] = []
    for p in prepared:
        exp = p.get("experiment") or {}
        lifecycle = lifecycle_of(exp, p.get("decision"))
        group = status_group(p.get("status") or "", lifecycle)
        changed, unchanged = config_diff(a_cfg, p["cfg"]) if p["cfg"] else ([], [])
        is_replicate = bool(p["cfg"]) and training_signature(p["cfg"]) == a_sig
        if not p["done"]:
            v = {"verdict": VERDICT_PENDING, "reason": "Not completed yet." if group in ("queued", "running") else "The run did not complete."}
        elif not a_done:
            v = {"verdict": VERDICT_NOT_COMPARABLE, "reason": "The original model has no completed evaluation to compare with."}
        elif p["mismatch"]:
            v = {"verdict": VERDICT_NOT_COMPARABLE, "reason": "Not a controlled comparison: " + "; ".join(p["mismatch"]) + "."}
        elif is_replicate:
            v = {"verdict": "replicate", "reason": "Same settings as the original with a different seed: measures run-to-run noise."}
        else:
            replicates = by_sig.get(training_signature(p["cfg"]), [p])
            v = verdict(baseline_runs, [r["metrics"] for r in replicates])
            v["replicate_ids"] = [r["id"] for r in replicates]
            note = efficiency_note(a_metrics, [p["metrics"]], v["verdict"])
            if note:
                v["efficiency"] = note
        deltas = None
        if p["metrics"] and a_done:
            deltas = {
                k: (p["metrics"][k] - a_metrics[k]) if p["metrics"].get(k) is not None and a_metrics.get(k) is not None else None
                for k in ("roc_auc", "pr_auc", "balanced_accuracy", "log_loss", "val_loss", "train_val_gap")
            }
        experiments.append({
            "run_id": p["id"],
            "name": p.get("name"),
            "status": p.get("status"),
            "group": group,
            "lifecycle": lifecycle,
            "created_at": p.get("created_at"),
            "variant_key": exp.get("variant_key"),
            "replicate": exp.get("replicate"),
            "preset": exp.get("preset"),
            "origin": exp.get("origin"),
            "parent_run_id": exp.get("parent_run_id"),
            "direct": exp.get("parent_run_id") == anchor["id"],
            "chain": p.get("chain") or [],
            "recorded_changes": exp.get("changed") or [],
            "changed": changed,
            "unchanged": unchanged,
            "seed": (p["cfg"] or {}).get("seed"),
            "metrics": p["metrics"],
            "deltas": deltas,
            "verdict": v,
            "is_replicate": is_replicate,
            "decision": p.get("decision") or None,
            "selection": exp.get("selection"),
        })

    experiments.sort(key=lambda e: e.get("created_at") or 0, reverse=True)
    counts = {g: 0 for g in STATUS_GROUPS}
    for e in experiments:
        counts[e["group"]] = counts.get(e["group"], 0) + 1
    seed_values = [m["roc_auc"] for m in baseline_runs if m.get("roc_auc") is not None]
    return {
        "session_id": session_id_for(anchor["id"]),
        "anchor": {
            "run_id": anchor["id"],
            "name": anchor.get("name"),
            "status": anchor.get("status"),
            "created_at": anchor.get("created_at"),
            "metrics": a_metrics if a_done else None,
            "config": a_cfg,
            "experiment": anchor.get("experiment"),
        },
        "noise": {
            "baseline_run_ids": baseline_ids,
            "baseline_runs": len(baseline_runs),
            "required": MIN_BASELINE_RUNS,
            "seed_sd": _sd(seed_values),
            "sufficient": len(seed_values) >= MIN_BASELINE_RUNS,
        },
        "experiments": experiments,
        "counts": counts,
    }
