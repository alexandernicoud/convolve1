"""Training / validation / test partitions with purging around time boundaries.

Chronological (default for new runs)
    Samples are ordered by decision date. The latest ``test_fraction`` becomes the test period
    (optional), the ``val_fraction`` before it the validation period, everything earlier the
    training period. Boundaries fall between dates, never inside one, so charts of several
    assets that share a decision date always land in the same partition.

Random (controlled experiments only)
    The development data (everything before the optional test period) is shuffled with the seed
    and split. Overlapping chart windows then sit on both sides of the split, so validation is
    not independent of training; the plan says so in its warnings.

Purging, applied to every sample in an earlier partition for each later partition, with all
assets together (prices of different assets move together, so an outcome window of one asset
that reaches into the validation period leaks information about other assets too):

    label_window   the sample's outcome window (plus the embargo) ends on or after the first
                   decision date of the later partition: its label uses prices from that period
    chart_window   (optional, on by default) the sample's decision bar falls inside a chart
                   window of the later partition: the two images share candles

A sample whose outcome window is unknown cannot be checked for label overlap. The plan then
records ``label_purge: "unverified"`` and a warning instead of presenting the split as clean.

No TensorFlow import: the API uses this module for the pre-run split preview.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from runners import sample_manifest as sm
from runners.sample_manifest import Sample

SPLIT_VERSION = 1
METHODS = ("chronological", "random")
PARTITIONS = ("train", "val", "test")
MIN_TRAIN = 2
MIN_EVAL = 1


class SplitError(ValueError):
    pass


@dataclass
class SplitPlan:
    method: str
    partitions: Dict[str, List[Sample]]
    excluded: List[Dict[str, str]] = field(default_factory=list)
    boundaries: Dict[str, Optional[str]] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)
    settings: Dict[str, Any] = field(default_factory=dict)
    sources: Dict[str, int] = field(default_factory=dict)
    label_purge: str = "not_applicable"
    manifest_digest: str = ""

    def ids(self, part: str) -> List[str]:
        return [s.id for s in self.partitions.get(part, [])]

    def labels(self, part: str) -> List[int]:
        return [s.label for s in self.partitions.get(part, [])]

    def summary(self) -> Dict[str, Any]:
        """JSON-safe description without the sample lists (those go to split_manifest.json)."""
        parts: Dict[str, Any] = {}
        for name in PARTITIONS:
            samples = self.partitions.get(name)
            if samples is None:
                continue
            counts: Dict[str, int] = {}
            for s in samples:
                counts[str(s.label)] = counts.get(str(s.label), 0) + 1
            dated = [s for s in samples if s.decision]
            parts[name] = {
                "samples": len(samples),
                "label_counts": dict(sorted(counts.items())),
                "period": [min(s.window_start or s.decision for s in dated), max(s.decision for s in dated)] if dated else None,
                "decision_period": [min(s.decision for s in dated), max(s.decision for s in dated)] if dated else None,
                "symbols": sorted({s.symbol for s in samples if s.symbol}),
                "ids_sha256": sm.ids_digest(s.id for s in samples),
            }
        reasons: Dict[str, int] = {}
        for e in self.excluded:
            reasons[e["reason"]] = reasons.get(e["reason"], 0) + 1
        return {
            "split_version": SPLIT_VERSION,
            "method": self.method,
            "partitions": parts,
            "boundaries": self.boundaries,
            "excluded_total": len(self.excluded),
            "excluded_by_reason": reasons,
            "label_purge": self.label_purge,
            "metadata_sources": self.sources,
            "settings": self.settings,
            "warnings": self.warnings,
            "manifest_sha256": self.manifest_digest,
        }

    def manifest(self) -> Dict[str, Any]:
        """Everything needed to reconstruct the partitions exactly, plus the exclusions."""
        return {
            **self.summary(),
            "ids": {name: self.ids(name) for name in PARTITIONS if name in self.partitions},
            "excluded": self.excluded,
        }


def _cut_by_date(ordered: List[Sample], n_later: int) -> int:
    """Index where the later block starts: n_later samples from the end, moved back to the start
    of that sample's decision date so a date is never split."""
    if n_later <= 0:
        return len(ordered)
    i = max(0, len(ordered) - n_later)
    day = ordered[i].decision
    while i > 0 and ordered[i - 1].decision == day:
        i -= 1
    return i


def _purge(
    earlier: List[Sample],
    later: List[Sample],
    *,
    later_name: str,
    chart_windows: bool,
    embargo_bars: int,
) -> Tuple[List[Sample], List[Dict[str, str]], bool]:
    """(kept, excluded, label_overlap_unverified) for samples of ``earlier`` against ``later``."""
    if not later:
        return earlier, [], False
    first_decision = min(s.decision for s in later if s.decision)
    first_window = min((s.window_start or s.decision) for s in later if s.decision)
    kept: List[Sample] = []
    excluded: List[Dict[str, str]] = []
    unverified = False
    for s in earlier:
        if not s.decision:
            kept.append(s)
            continue
        end = s.label_end
        if end and embargo_bars:
            end = sm.add_days(end, sm.calendar_days_for_bars(embargo_bars, s.timeframe or "1d"))
        if end is None:
            unverified = True
        elif end >= first_decision:
            excluded.append({"id": s.id, "reason": f"label_window_overlaps_{later_name}"})
            continue
        if chart_windows and s.decision >= first_window:
            excluded.append({"id": s.id, "reason": f"chart_window_overlaps_{later_name}"})
            continue
        kept.append(s)
    return kept, excluded, unverified


def plan_split(
    samples: Sequence[Sample],
    *,
    method: str = "chronological",
    val_fraction: float = 0.2,
    test_fraction: float = 0.0,
    seed: int = 7,
    purge_chart_windows: bool = True,
    embargo_bars: int = 0,
    manifest_digest: str = "",
    sources: Optional[Dict[str, int]] = None,
) -> SplitPlan:
    if method not in METHODS:
        raise SplitError(f"Validation method must be one of {', '.join(METHODS)}")
    if not 0 < val_fraction < 1 or not 0 <= test_fraction < 1 or val_fraction + test_fraction >= 0.9:
        raise SplitError("Validation and test shares must be positive and leave at least 10% for training")
    samples = sorted(samples, key=lambda s: s.id)
    if not samples:
        raise SplitError("The dataset has no labeled images")
    plan = SplitPlan(
        method=method,
        partitions={},
        settings={
            "val_fraction": val_fraction,
            "test_fraction": test_fraction,
            "seed": int(seed),
            "purge_label_windows": True,
            "purge_chart_windows": bool(purge_chart_windows),
            "embargo_bars": int(embargo_bars),
            "assets": "pooled",
        },
        sources=dict(sources or {}),
        manifest_digest=manifest_digest,
    )
    needs_dates = method == "chronological" or test_fraction > 0
    dated = [s for s in samples if s.decision]
    undated = [s for s in samples if not s.decision]
    if needs_dates:
        if not dated:
            raise SplitError(
                "A chronological split needs dated charts (SYMBOL_YYYY-MM-DD_to_YYYY-MM-DD_labelN.png, as the "
                "chart generator writes them). This dataset has none; use a random split for a controlled experiment."
            )
        for s in undated:
            plan.excluded.append({"id": s.id, "reason": "no_date"})
        if undated:
            plan.warnings.append(f"{len(undated)} chart(s) without dates in their file name were left out.")
        pool = sorted(dated, key=lambda s: (s.decision, s.symbol or "", s.id))
    else:
        pool = list(samples)

    test: List[Sample] = []
    if test_fraction > 0:
        cut = _cut_by_date(pool, int(round(len(pool) * test_fraction)))
        pool, test = pool[:cut], pool[cut:]
        if len(test) < MIN_EVAL:
            raise SplitError("The test share leaves no test charts; lower it or add data")
        plan.boundaries["test_start"] = test[0].decision

    if method == "chronological":
        cut = _cut_by_date(pool, int(round(len(pool) * val_fraction)))
        train, val = pool[:cut], pool[cut:]
        plan.boundaries["val_start"] = val[0].decision if val else None
    else:
        order = sorted(pool, key=lambda s: s.id)
        perm = np.random.RandomState(int(seed)).permutation(len(order))
        shuffled = [order[i] for i in perm]
        cut = int(len(shuffled) * (1 - val_fraction))
        train, val = shuffled[:cut], shuffled[cut:]
        plan.warnings.append(
            "Random split: neighbouring charts share most of their price window, so validation charts are "
            "near-copies of training charts and validation scores overstate performance on unseen periods."
        )

    unverified = False
    if method == "chronological":
        train, ex, u = _purge(train, val, later_name="val", chart_windows=purge_chart_windows, embargo_bars=embargo_bars)
        plan.excluded.extend(ex)
        unverified |= u
    if test:
        for name, part in (("train", train), ("val", val)):
            kept, ex, u = _purge(part, test, later_name="test", chart_windows=purge_chart_windows, embargo_bars=embargo_bars)
            plan.excluded.extend(ex)
            unverified |= u
            if name == "train":
                train = kept
            else:
                val = kept

    if method == "chronological" or test:
        plan.label_purge = "unverified" if unverified else "applied"
        if unverified:
            plan.warnings.append(
                "The outcome horizon of some charts is unknown (no generator settings or per-sample records), so "
                "overlap between training labels and later periods could not be checked. Only chart windows were "
                "purged. Set the label horizon to check it."
            )

    def _why(part: str) -> str:
        counts: Dict[str, int] = {}
        for e in plan.excluded:
            if e["reason"] != "no_date":
                counts[e["reason"]] = counts.get(e["reason"], 0) + 1
        detail = ", ".join(f"{n} {r.replace('_', ' ')}" for r, n in sorted(counts.items()))
        return (
            f"Too few {part} charts remain after the split and purging"
            + (f" (excluded: {detail})" if detail else "")
            + ". The chart windows or outcome horizons are long compared with the periods; increase the "
            "validation share, lower the test share, or turn off chart-window purging."
        )

    if len(train) < MIN_TRAIN:
        raise SplitError(_why("training"))
    if len(val) < MIN_EVAL:
        raise SplitError(_why("validation"))
    plan.partitions = {"train": train, "val": val}
    if test_fraction > 0:
        plan.partitions["test"] = test
    for name, part in plan.partitions.items():
        present = {s.label for s in part}
        if len(present) < 2:
            plan.warnings.append(f"The {name} partition contains only label {sorted(present)[0]}.")
    return plan


def plan_from_folder(
    images_dir: str,
    *,
    horizon_bars: Optional[int] = None,
    timeframe: Optional[str] = None,
    cancel: Any = None,
    **kwargs: Any,
) -> SplitPlan:
    samples = sm.scan(images_dir, cancel)
    sources = sm.annotate(
        samples,
        provenance=sm.load_provenance_samples(images_dir),
        horizon_bars=horizon_bars,
        timeframe=timeframe,
    )
    return plan_split(samples, manifest_digest=sm.digest(samples), sources=sources, **kwargs)
