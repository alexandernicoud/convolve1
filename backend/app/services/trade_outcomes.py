"""
Shared trade-outcome contract: how a long TP/SL/horizon trade resolves on OHLC bars.

Convention ``next_open_tp_sl_v1`` (matches the Generator's labelling walk in
``scripts/1.3_Adj_TrL.py`` / ``scripts/1.4_Adj_testL.py``):

- The signal is formed after the decision bar closes. Entry is the next bar's open.
- The horizon is ``horizon_bars`` bars counted from the entry bar (the entry bar is bar 1),
  i.e. the ``horizon_bars`` rows after the decision bar.
- TP = entry * (1 + tp_frac), SL = entry * (1 - sl_frac), fixed at entry.
- Every horizon bar is checked, the entry bar included. SL is checked before TP: when both
  levels fall inside one bar the intrabar order is unknown and the conservative SL exit is
  taken (flag ``ambiguous_tp_sl_same_bar``).
- After the entry bar, an open at or below SL fills at that open (flag ``gap_through_stop``).
  An open at or above TP fills at the TP price (no price improvement is assumed).
- If neither level is touched within ``horizon_bars`` bars the trade times out at the close
  of the last horizon bar.
- If fewer than ``horizon_bars`` bars exist and no level was touched, the outcome is
  ``incomplete``: no target label and no realized return.

Prices are used as given. Both the decision and the outcome must come from one price series
with one adjustment convention (see ``assert_same_adjustment``). Costs are not applied here;
the portfolio simulation applies commission and slippage to the gross fills.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

OUTCOME_CONVENTION = "next_open_tp_sl_v1"
OUTCOME_CONTRACT_VERSION = 1

# Labelling methods (what the binary target in the filename means).
# v1: Generator before provenance: timeout -> 0 and *incomplete horizon -> 0* (silently).
# v2: same TP/SL walk, but incomplete horizons are excluded instead of labelled 0.
LABEL_METHOD_LEGACY = "tp_first_else_zero_v1"
LABEL_METHOD_V2 = "tp_first_else_zero_v2"

EXIT_TP = "tp"
EXIT_SL = "sl"
EXIT_TIMEOUT = "timeout"
EXIT_INCOMPLETE = "incomplete"

STATUS_RESOLVED = "resolved"
STATUS_INCOMPLETE = "incomplete"
STATUS_INVALID = "invalid"

FLAG_AMBIGUOUS = "ambiguous_tp_sl_same_bar"
FLAG_GAP_STOP = "gap_through_stop"
FLAG_GAP_TARGET = "gap_through_target"
FLAG_IRREGULAR_GAP = "irregular_bar_gap"

# Calendar-day gap between consecutive bars above which a bar is probably missing.
_MAX_EXPECTED_GAP_DAYS = {"1d": 5, "1wk": 10, "1mo": 35}

OHLC = ("Open", "High", "Low", "Close")


@dataclass(frozen=True)
class OutcomeSpec:
    horizon_bars: int
    tp_frac: float
    sl_frac: float
    timeframe: str = "1d"

    def __post_init__(self) -> None:
        if int(self.horizon_bars) < 1:
            raise ValueError("horizon_bars must be >= 1")
        if not (self.tp_frac > 0 and self.sl_frac > 0 and self.sl_frac < 1):
            raise ValueError("tp_frac must be > 0 and 0 < sl_frac < 1")

    def as_dict(self) -> Dict[str, Any]:
        return {
            "convention": OUTCOME_CONVENTION,
            "contract_version": OUTCOME_CONTRACT_VERSION,
            "horizon_bars": int(self.horizon_bars),
            "horizon_unit": f"bars ({self.timeframe})",
            "entry_bar_counts_as_bar": 1,
            "tp_frac": float(self.tp_frac),
            "sl_frac": float(self.sl_frac),
            "entry": "open of the first bar after the decision bar",
            "intrabar_tie": "sl_first",
            "gap_through_stop": "fill at open",
            "gap_through_target": "fill at target (no price improvement)",
            "timeout_exit": "close of the last horizon bar",
            "incomplete": "fewer horizon bars than required and no level touched: no label, no return",
        }


@dataclass
class Outcome:
    status: str
    exit_reason: Optional[str]
    target_label: Optional[int]
    decision_ts: Optional[pd.Timestamp]
    entry_ts: Optional[pd.Timestamp] = None
    entry_price: Optional[float] = None
    tp_price: Optional[float] = None
    sl_price: Optional[float] = None
    exit_ts: Optional[pd.Timestamp] = None
    exit_price: Optional[float] = None
    bars_held: Optional[int] = None
    bars_available: int = 0
    gross_return: Optional[float] = None
    flags: List[str] = field(default_factory=list)
    invalid_reason: Optional[str] = None

    def to_record(self) -> Dict[str, Any]:
        d = asdict(self)
        for k in ("decision_ts", "entry_ts", "exit_ts"):
            d[k] = _iso(d[k])
        d["flags"] = list(self.flags)
        return d


def _iso(ts: Any) -> Optional[str]:
    if ts is None:
        return None
    return pd.Timestamp(ts).isoformat()


def _finite_pos(v: Any) -> bool:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return False
    return math.isfinite(f) and f > 0


def validate_bars(bars: pd.DataFrame) -> Optional[str]:
    """Structural problems that make a price series unusable for outcomes; None when fine."""
    if not isinstance(bars, pd.DataFrame) or bars.empty:
        return "no_bars"
    if not isinstance(bars.index, pd.DatetimeIndex):
        return "index_not_datetime"
    missing = [c for c in OHLC if c not in bars.columns]
    if missing:
        return f"missing_columns:{','.join(missing)}"
    if bars.index.has_duplicates:
        return "duplicate_timestamps"
    if not bars.index.is_monotonic_increasing:
        return "unsorted_timestamps"
    return None


def resolve_outcome(bars: pd.DataFrame, decision_ts: Any, spec: OutcomeSpec) -> Outcome:
    """Resolve one long trade decided at the close of ``decision_ts``."""
    problem = validate_bars(bars)
    dts = pd.Timestamp(decision_ts) if decision_ts is not None else None
    if problem:
        return Outcome(STATUS_INVALID, None, None, dts, invalid_reason=problem)
    if dts is not None and bars.index.tz is not None and dts.tzinfo is None:
        dts = dts.tz_localize(bars.index.tz)
    if dts is None or dts not in bars.index:
        return Outcome(STATUS_INVALID, None, None, dts, invalid_reason="decision_bar_missing")

    w = int(spec.horizon_bars)
    pos = int(bars.index.get_loc(dts))
    future = bars.iloc[pos + 1 : pos + 1 + w]
    if future.empty:
        return Outcome(STATUS_INCOMPLETE, EXIT_INCOMPLETE, None, dts, bars_available=0)

    vals = future[list(OHLC)].to_numpy(dtype=float)
    if not np.all(np.isfinite(vals)) or np.any(vals <= 0):
        return Outcome(STATUS_INVALID, None, None, dts, bars_available=len(future), invalid_reason="nonfinite_or_nonpositive_price")

    entry_ts = future.index[0]
    entry = float(vals[0, 0])
    tp = entry * (1.0 + float(spec.tp_frac))
    sl = entry * (1.0 - float(spec.sl_frac))
    flags: List[str] = []

    max_gap = _MAX_EXPECTED_GAP_DAYS.get(spec.timeframe)
    if max_gap is not None:
        span = bars.index[pos : pos + 1 + len(future)]
        gaps = (span[1:] - span[:-1]).total_seconds().to_numpy() / 86_400.0 if len(span) > 1 else np.array([])
        if gaps.size and float(gaps.max()) > max_gap:
            flags.append(FLAG_IRREGULAR_GAP)

    base = Outcome(
        STATUS_RESOLVED, None, None, dts,
        entry_ts=entry_ts, entry_price=entry, tp_price=tp, sl_price=sl,
        bars_available=len(future), flags=flags,
    )

    for k in range(len(future)):
        o, h, l, _c = vals[k]
        hit_sl = l <= sl
        hit_tp = h >= tp
        if hit_sl:
            if hit_tp:
                flags.append(FLAG_AMBIGUOUS)
            exit_px = sl
            if k > 0 and o <= sl:
                exit_px = o
                flags.append(FLAG_GAP_STOP)
            return _close(base, EXIT_SL, 0, future.index[k], exit_px, k + 1)
        if hit_tp:
            if k > 0 and o >= tp:
                flags.append(FLAG_GAP_TARGET)
            return _close(base, EXIT_TP, 1, future.index[k], tp, k + 1)

    if len(future) >= w:
        return _close(base, EXIT_TIMEOUT, 0, future.index[-1], float(vals[-1, 3]), len(future))

    base.status = STATUS_INCOMPLETE
    base.exit_reason = EXIT_INCOMPLETE
    return base


def _close(base: Outcome, reason: str, label: int, ts: pd.Timestamp, price: float, bars_held: int) -> Outcome:
    base.exit_reason = reason
    base.target_label = label
    base.exit_ts = ts
    base.exit_price = float(price)
    base.bars_held = int(bars_held)
    base.gross_return = float(price) / float(base.entry_price) - 1.0
    return base


def label_for_method(outcome: Outcome, method: str) -> Optional[int]:
    """Binary target under a labelling method. Legacy v1 labelled incomplete horizons 0."""
    if outcome.status == STATUS_INVALID:
        return None
    if outcome.status == STATUS_INCOMPLETE:
        return 0 if method == LABEL_METHOD_LEGACY else None
    return outcome.target_label


def assert_same_adjustment(a: Optional[str], b: Optional[str]) -> None:
    """Decisions and outcomes must use one price-adjustment convention."""
    if a and b and a != b:
        raise ValueError(f"Price adjustment mismatch: {a!r} vs {b!r}")


def bars_from_records(rows: List[Dict[str, Any]], tz: Optional[str] = None) -> pd.DataFrame:
    """Rebuild an OHLCV frame from stored rows with ISO timestamps (offsets preserved)."""
    if not rows:
        return pd.DataFrame(columns=list(OHLC) + ["Volume"])
    df = pd.DataFrame(rows)
    idx = pd.to_datetime(df.pop("timestamp"), utc=True)
    if tz:
        idx = idx.tz_convert(tz)
    df.index = pd.DatetimeIndex(idx, name="timestamp")
    for c in list(OHLC) + ["Volume"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df
