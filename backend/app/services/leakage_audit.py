"""
Information-availability and label-interval audit for a (model, test dataset, threshold) evaluation.

Five categories are kept apart because they have different consequences:

1. ``future_in_image``      the chart image contains bars after the decision time          -> blocks
2. ``label_overlap``        a test sample's outcome interval overlaps the training label
                            period for the same symbol                                     -> purge those samples
3. ``lookback_overlap``     test chart lookbacks overlap training chart periods, but contain
                            only bars available at each decision time                      -> informational
4. ``dataset_reuse``        the same dataset / images are used for training and testing    -> blocks
5. ``selection_on_test``    threshold or hyperparameters chosen with final test outcomes    -> exploratory

The audit never declares an evaluation independent when the information to check it is missing; it
then classifies the run as ``exploratory`` and says what was missing.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

import pandas as pd

AUDIT_VERSION = 1

PASS, WARN, FAIL, UNKNOWN, INFO = "pass", "warn", "fail", "unknown", "info"

EVAL_INDEPENDENT = "independent_test"
EVAL_EXPLORATORY = "exploratory"
EVAL_BLOCKED = "blocked"

THRESHOLD_VALIDATION_LOCKED = "validation_locked"
THRESHOLD_USER_FIXED = "user_fixed"
THRESHOLD_TEST_SWEEP = "test_sweep"

_NAME_RE = re.compile(r"^(?P<sym>.+?)_(?P<start>\d{4}-\d{2}-\d{2})_to_(?P<end>\d{4}-\d{2}-\d{2})_label(?P<label>\d)\.png$")
_CAL_DAYS_PER_BAR_UPPER = {"1d": 7 / 5, "1wk": 7.0, "1mo": 31.0}


def parse_chart_name(name: str) -> Optional[Dict[str, Any]]:
    m = _NAME_RE.match(name)
    if not m:
        return None
    return {"symbol": m["sym"], "start": m["start"], "end": m["end"], "label": int(m["label"])}


@dataclass
class TrainingSide:
    """What is known about the model's training data. Every field may be missing."""

    dataset_id: Optional[str] = None
    image_names: Optional[Sequence[str]] = None
    horizon_bars: Optional[int] = None
    timeframe: Optional[str] = None
    reference_end: Optional[str] = None  # UI-recorded dataset end date (fallback only)
    threshold_source: Optional[str] = None
    validation_period: Optional[Dict[str, Any]] = None


@dataclass
class Check:
    id: str
    category: str
    status: str
    title: str
    detail: str
    n_affected: Optional[int] = None
    data: Dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "category": self.category,
            "status": self.status,
            "title": self.title,
            "detail": self.detail,
            "n_affected": self.n_affected,
            "data": self.data,
        }


def _ts(v: Any) -> Optional[pd.Timestamp]:
    if v is None:
        return None
    try:
        t = pd.Timestamp(v)
    except (ValueError, TypeError):
        return None
    return None if pd.isna(t) else t


def _naive_date(t: pd.Timestamp) -> pd.Timestamp:
    return pd.Timestamp(t.date())


def _training_label_end(
    last_decision: pd.Timestamp, horizon: int, bars: Optional[pd.DataFrame], timeframe: str
) -> tuple[pd.Timestamp, str]:
    """Date of the last bar inside the training label horizon after ``last_decision``.

    Uses stored bars when they cover the decision; otherwise an upper calendar bound.
    """
    if bars is not None and len(bars):
        dates = pd.DatetimeIndex([_naive_date(t) for t in bars.index])
        if dates[0] <= last_decision:
            after = dates[dates > last_decision]
            if len(after) >= horizon:
                return after[horizon - 1], "stored_bars"
    per_bar = _CAL_DAYS_PER_BAR_UPPER.get(timeframe, 7 / 5)
    return last_decision + pd.Timedelta(days=math.ceil(horizon * per_bar) + 4), "calendar_upper_bound"


def run_audit(
    *,
    test_dataset_id: Optional[str],
    test_samples: Sequence[Dict[str, Any]],
    test_image_names: Iterable[str],
    training: TrainingSide,
    test_bars: Optional[Dict[str, pd.DataFrame]] = None,
    embargo_bars: int = 0,
    prior_runs_same_pair: int = 0,
    allow_reuse_override: bool = False,
) -> Dict[str, Any]:
    """Run all checks. ``test_samples`` are provenance records (empty for legacy datasets)."""
    checks: List[Check] = []
    purged: List[str] = []
    missing: List[str] = []
    test_names = sorted(set(test_image_names))
    has_prov = bool(test_samples)

    # 1. Future information inside the image -----------------------------------------------------
    if has_prov:
        bad = []
        for s in test_samples:
            obs_end, dec, entry = _ts(s.get("observation_end")), _ts(s.get("decision_ts")), _ts(s.get("earliest_entry_ts"))
            if obs_end is None or dec is None or obs_end > dec or (entry is not None and entry <= dec):
                bad.append(s.get("image_id"))
        checks.append(Check(
            "future_in_image", "future_in_image", FAIL if bad else PASS,
            "Chart content ends at the decision time",
            (f"{len(bad)} sample(s) have chart bars after the decision time or an entry not after it."
             if bad else "Every chart's last bar is the decision bar; entries are on the following bar's open."),
            n_affected=len(bad), data={"examples": bad[:10]},
        ))
    else:
        missing.append("per-sample provenance (decision and observation timestamps)")
        checks.append(Check(
            "future_in_image", "future_in_image", UNKNOWN,
            "Chart content ends at the decision time",
            "Legacy dataset: no per-sample timestamps. The file name's end date is the chart's last bar by "
            "generator design, but this cannot be verified from stored data.",
        ))

    # 4. Dataset reuse across training and testing -------------------------------------------------
    train_names = set(training.image_names or [])
    reuse_fail = False
    if training.dataset_id and test_dataset_id and training.dataset_id == test_dataset_id:
        reuse_fail = True
        checks.append(Check(
            "dataset_reuse", "dataset_reuse", FAIL, "Test data is separate from training data",
            "The model was trained on this same dataset. Its results are in-sample.",
            n_affected=len(test_names),
        ))
    elif training.image_names is not None:
        shared = sorted(train_names.intersection(test_names))
        reuse_fail = bool(shared)
        checks.append(Check(
            "dataset_reuse", "dataset_reuse", FAIL if shared else PASS, "Test data is separate from training data",
            (f"{len(shared)} test chart(s) also appear in the training dataset." if shared
             else "No test chart file appears in the training dataset."),
            n_affected=len(shared), data={"examples": shared[:10]},
        ))
    else:
        missing.append("training dataset image list")
        checks.append(Check(
            "dataset_reuse", "dataset_reuse", UNKNOWN, "Test data is separate from training data",
            "The model's training dataset is not available locally, so chart reuse cannot be checked.",
        ))

    # 2. Label-interval overlap (purge) and 3. lookback overlap ---------------------------------
    train_parsed = [p for p in (parse_chart_name(n) for n in train_names) if p]
    last_train_decision: Dict[str, pd.Timestamp] = {}
    first_train_start: Dict[str, pd.Timestamp] = {}
    for p in train_parsed:
        end, start = pd.Timestamp(p["end"]), pd.Timestamp(p["start"])
        sym = p["symbol"]
        if sym not in last_train_decision or end > last_train_decision[sym]:
            last_train_decision[sym] = end
        if sym not in first_train_start or start < first_train_start[sym]:
            first_train_start[sym] = start

    horizon = training.horizon_bars
    timeframe = training.timeframe or "1d"
    if not train_parsed and training.reference_end:
        ref = _ts(training.reference_end)
        if ref is not None:
            ref = _naive_date(ref)
            for s in {str(x.get("symbol")) for x in test_samples}:
                last_train_decision[s] = ref

    if not has_prov:
        checks.append(Check(
            "label_overlap", "label_overlap", UNKNOWN, "Test outcomes do not overlap training labels",
            "Legacy dataset: test outcome intervals are not recorded, so overlap cannot be measured.",
        ))
    elif not last_train_decision or not horizon:
        missing.append("training chart end dates and label horizon")
        checks.append(Check(
            "label_overlap", "label_overlap", UNKNOWN, "Test outcomes do not overlap training labels",
            "The training period end or label horizon is not recorded for this model.",
        ))
    else:
        label_end: Dict[str, Dict[str, Any]] = {}
        for sym, last in last_train_decision.items():
            end, how = _training_label_end(last, int(horizon) + int(embargo_bars), (test_bars or {}).get(sym), timeframe)
            label_end[sym] = {"last_training_decision": str(last.date()), "label_end": str(end.date()), "method": how}
        for s in test_samples:
            sym = str(s.get("symbol"))
            info = label_end.get(sym)
            entry = _ts(s.get("earliest_entry_ts")) or _ts(s.get("decision_ts"))
            if info is None or entry is None:
                continue
            if _naive_date(entry) <= pd.Timestamp(info["label_end"]):
                purged.append(str(s.get("image_id")))
        source = "training chart file names" if train_parsed else "the dataset end date recorded by the generator UI"
        checks.append(Check(
            "label_overlap", "label_overlap", WARN if purged else PASS, "Test outcomes do not overlap training labels",
            (f"{len(purged)} test sample(s) enter before the training labels' horizon ends; they are purged from "
             f"evaluation (horizon {horizon} bars, embargo {embargo_bars} bars, training end from {source})."
             if purged else f"All test entries fall after the training labels' horizon (from {source})."),
            n_affected=len(purged), data={"by_symbol": label_end, "embargo_bars": embargo_bars},
        ))

    if has_prov and first_train_start:
        overlapping = 0
        for s in test_samples:
            sym = str(s.get("symbol"))
            obs_start = _ts(s.get("observation_start"))
            last = last_train_decision.get(sym)
            if obs_start is not None and last is not None and _naive_date(obs_start) <= last:
                overlapping += 1
        checks.append(Check(
            "lookback_overlap", "lookback_overlap", INFO, "Chart lookbacks overlap the training period",
            (f"{overlapping} test chart(s) show bars that also appear in training charts. Each chart only contains "
             "bars available at its decision time, so this is not leakage by itself." if overlapping
             else "No test chart lookback reaches into the training period."),
            n_affected=overlapping,
        ))

    # 5. Selection on final test outcomes --------------------------------------------------------
    src = training.threshold_source or THRESHOLD_USER_FIXED
    if src == THRESHOLD_VALIDATION_LOCKED:
        sel = Check("selection_on_test", "selection_on_test", PASS, "Threshold chosen without test outcomes",
                    "The threshold was selected on validation predictions and locked before this test.",
                    data={"threshold_source": src, "validation_period": training.validation_period})
    elif src == THRESHOLD_TEST_SWEEP:
        sel = Check("selection_on_test", "selection_on_test", FAIL, "Threshold chosen without test outcomes",
                    "The threshold was chosen from a sweep on this test set; results are in-sample.",
                    data={"threshold_source": src})
    else:
        sel = Check("selection_on_test", "selection_on_test", WARN, "Threshold chosen without test outcomes",
                    "The threshold was entered manually. It is not validation-selected, and it may have been tuned on "
                    "this test set in earlier runs.", data={"threshold_source": src})
    if prior_runs_same_pair > 0:
        sel.detail += f" This model has been evaluated on this dataset {prior_runs_same_pair} time(s) before."
        sel.data["prior_runs_same_pair"] = prior_runs_same_pair
        if sel.status == PASS:
            sel.status = WARN
    checks.append(sel)

    # Classification ---------------------------------------------------------------------------
    future_fail = any(c.id == "future_in_image" and c.status == FAIL for c in checks)
    blocking_reasons = []
    if future_fail:
        blocking_reasons.append("Chart images include information after the decision time.")
    if reuse_fail and not allow_reuse_override:
        blocking_reasons.append("Training data is reused as test data.")
    if blocking_reasons:
        eval_class = EVAL_BLOCKED
    elif (
        reuse_fail
        or any(c.status in (FAIL, UNKNOWN) for c in checks)
        or src != THRESHOLD_VALIDATION_LOCKED
        or prior_runs_same_pair > 0
    ):
        eval_class = EVAL_EXPLORATORY
    else:
        eval_class = EVAL_INDEPENDENT

    return {
        "audit_version": AUDIT_VERSION,
        "evaluation_class": eval_class,
        "blocked": bool(blocking_reasons),
        "blocking_reasons": blocking_reasons,
        "purged_sample_ids": purged,
        "missing_information": missing,
        "checks": [c.as_dict() for c in checks],
    }


def training_side_from_metadata(
    metadata: Optional[Dict[str, Any]], training_images_dir: Optional[Path], threshold_source: Optional[str]
) -> TrainingSide:
    md = metadata or {}
    names: Optional[List[str]] = None
    if training_images_dir is not None and training_images_dir.is_dir():
        names = sorted(p.name for p in training_images_dir.rglob("*.png") if not p.name.startswith("._"))
    horizon = md.get("horizonBars")
    try:
        horizon = int(horizon) if horizon is not None else None
    except (TypeError, ValueError):
        horizon = None
    return TrainingSide(
        dataset_id=md.get("dataset_id"),
        image_names=names,
        horizon_bars=horizon,
        timeframe=md.get("timeframe"),
        reference_end=md.get("training_period_end"),
        threshold_source=threshold_source,
        validation_period=(md.get("validation") or {}).get("period") if isinstance(md.get("validation"), dict) else None,
    )
