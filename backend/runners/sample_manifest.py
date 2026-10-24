"""Deterministic sample manifest for a training dataset folder.

Every labeled PNG becomes one sample whose id is its file name. Samples are ordered by id, so
the order (and every split computed from it) is the same on any filesystem, operating system,
Cloud Run instance or archive extraction order. The manifest digest covers (id, label, size) of
every sample; two folders with the same digest present the same samples to the trainer.

Each sample also carries its time window when that is known:

    window_start   first bar shown in the chart
    decision       last bar shown in the chart (the decision bar)
    label_start    first bar of the outcome window (entry bar)
    label_end      last bar whose price can influence the label: the end of the maximum
                   evaluation horizon (conservative: a take-profit or stop-loss can end the
                   trade earlier, but the label is only fully determined by then)

Sources, best first:

    provenance             per-sample bars recorded by the generator (exact, any calendar)
    calendar_upper_bound   chart dates from the file name plus the generator's horizon in bars,
                           converted with an upper bound of calendar days per bar
    dates_only             chart dates from the file name; the outcome window is unknown
    undated                no dates at all

Dates are calendar dates in the exchange's time zone, which is exact for daily, weekly and
monthly bars (the only timeframes the generator produces). No TensorFlow import.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from typing import Any, Dict, Iterable, List, Optional

MANIFEST_VERSION = 1
_NAME_RE = re.compile(r"^(?P<sym>.+?)_(?P<start>\d{4}-\d{2}-\d{2})_to_(?P<end>\d{4}-\d{2}-\d{2})_label\d")
# Upper bound of calendar days per bar: 5 trading days per week, plus a holiday allowance below.
CALENDAR_DAYS_PER_BAR = {"1d": 7 / 5, "1wk": 7.0, "1mo": 31.0}
HOLIDAY_ALLOWANCE_DAYS = 4

SOURCE_PROVENANCE = "provenance"
SOURCE_CALENDAR = "calendar_upper_bound"
SOURCE_DATES_ONLY = "dates_only"
SOURCE_UNDATED = "undated"


@dataclass
class Sample:
    id: str
    label: int
    size: int
    symbol: Optional[str] = None
    timeframe: Optional[str] = None
    window_start: Optional[str] = None
    decision: Optional[str] = None
    label_start: Optional[str] = None
    label_end: Optional[str] = None
    source: str = SOURCE_UNDATED

    def as_dict(self) -> Dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}


def label_of(name: str) -> Optional[int]:
    """The trainer's label rule (unchanged): the digit after the first "label" in the name."""
    if not name.endswith(".png") or "label" not in name:
        return None
    try:
        return int(name.split("label")[1][0])
    except (IndexError, ValueError):
        return None


def _date(value: Any) -> Optional[str]:
    """ISO date of a timestamp string as written (its own time zone), e.g. '2021-03-22T00:00:00-04:00'."""
    if not value:
        return None
    text = str(value)
    if len(text) >= 10 and re.match(r"\d{4}-\d{2}-\d{2}", text):
        return text[:10]
    return None


def calendar_days_for_bars(bars: int, timeframe: Optional[str]) -> int:
    per_bar = CALENDAR_DAYS_PER_BAR.get(str(timeframe or ""), None)
    if per_bar is None:
        raise ValueError(f"Unknown timeframe '{timeframe}'")
    return int(math.ceil(int(bars) * per_bar)) + HOLIDAY_ALLOWANCE_DAYS


def add_days(iso: str, days: int) -> str:
    return (date.fromisoformat(iso) + timedelta(days=int(days))).isoformat()


def _from_provenance(sample: Sample, record: Dict[str, Any]) -> bool:
    outcome = record.get("outcome") if isinstance(record.get("outcome"), dict) else {}
    decision = _date(record.get("decision_ts") or record.get("observation_end"))
    end = _date(record.get("horizon_end_ts") or record.get("label_end_ts") or outcome.get("exit_ts"))
    if not decision or not end:
        return False
    sample.symbol = str(record.get("symbol") or sample.symbol or "") or None
    sample.timeframe = record.get("timeframe") or sample.timeframe
    sample.window_start = _date(record.get("observation_start")) or sample.window_start
    sample.decision = decision
    sample.label_start = _date(record.get("earliest_entry_ts") or outcome.get("entry_ts"))
    sample.label_end = end
    sample.source = SOURCE_PROVENANCE
    return True


def scan(images_dir: str, cancel: Any = None) -> List[Sample]:
    """Labeled PNGs in the folder (top level, the trainer's rule), sorted by name."""
    if not os.path.isdir(images_dir):
        raise FileNotFoundError(f"Folder {images_dir} does not exist")
    out: List[Sample] = []
    with os.scandir(images_dir) as it:
        for entry in it:
            if cancel is not None and cancel.is_set():
                raise InterruptedError("Training cancelled by user")
            label = label_of(entry.name)
            if label is None or not entry.is_file():
                continue
            out.append(Sample(id=entry.name, label=label, size=entry.stat().st_size))
    out.sort(key=lambda s: s.id)
    return out


def annotate(
    samples: List[Sample],
    *,
    provenance: Optional[Iterable[Dict[str, Any]]] = None,
    horizon_bars: Optional[int] = None,
    timeframe: Optional[str] = None,
) -> Dict[str, Any]:
    """Fill in time windows in place. Returns the count of samples per source."""
    by_id = {}
    for record in provenance or []:
        if isinstance(record, dict) and record.get("image_id"):
            by_id[str(record["image_id"])] = record
    horizon_days = calendar_days_for_bars(horizon_bars, timeframe) if horizon_bars and timeframe else None
    for s in samples:
        m = _NAME_RE.match(s.id)
        if m:
            s.symbol, s.window_start, s.decision = m["sym"], m["start"], m["end"]
            s.timeframe = timeframe
            s.source = SOURCE_DATES_ONLY
        record = by_id.get(s.id)
        if record is not None and _from_provenance(s, record):
            continue
        if s.decision and horizon_days is not None:
            s.label_start = add_days(s.decision, 1)
            s.label_end = add_days(s.decision, horizon_days)
            s.source = SOURCE_CALENDAR
    counts: Dict[str, int] = {}
    for s in samples:
        counts[s.source] = counts.get(s.source, 0) + 1
    return counts


def digest(samples: List[Sample]) -> str:
    h = hashlib.sha256()
    for s in samples:
        h.update(f"{s.id}\t{s.label}\t{s.size}\n".encode())
    return h.hexdigest()


def ids_digest(ids: Iterable[str]) -> str:
    h = hashlib.sha256()
    for i in ids:
        h.update(str(i).encode())
        h.update(b"\n")
    return h.hexdigest()


def load_provenance_samples(images_dir: str) -> List[Dict[str, Any]]:
    """samples.jsonl from <dataset>/provenance (or <images>/provenance); [] for legacy datasets."""
    root = os.path.dirname(os.path.abspath(images_dir))
    for cand in (os.path.join(root, "provenance"), os.path.join(images_dir, "provenance")):
        path = os.path.join(cand, "samples.jsonl")
        if os.path.isfile(path):
            out = []
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            out.append(json.loads(line))
                        except ValueError:
                            continue
            return out
    return []
