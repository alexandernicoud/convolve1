"""Improve-model experiments: a trainer run derived from an earlier model with a controlled change.

The client sends a small request (parent run, preset, where the user came from, the settings it
changed). The server turns it into the stored record: it verifies the parent and the origin, and
records which test results were inspected before this model was designed (``selection_history``).

That history is inherited along the chain parent -> child -> grandchild. A backtest of a model whose
history contains an inspected test period overlapping the new test's decision dates cannot count as
an independent test: the model was chosen with knowledge of those outcomes.

Only selections made through Improve are recorded. A model trained by hand after looking at a
backtest carries no history; the audit says so instead of passing it.
"""

from __future__ import annotations

import re
import time
from typing import Any, Callable, Dict, List, Optional

PRESETS = ("smaller", "gap", "dense", "regularize", "dropout", "l2", "lr", "class_weight", "epochs", "seed")
VARIANT_KEYS = ("seed", "smaller", "gap", "dense", "regularize", "dropout", "l2", "lr_down", "lr_up", "class_weight", "epochs")
MAX_REPLICATE = 20
ORIGIN_KINDS = ("backtest", "analysis", "trainer", "model-health", "search-hub")
# Origins whose results include outcomes on a test set; the others use validation data only.
TEST_RESULT_ORIGINS = ("backtest",)
MAX_HISTORY = 50

_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


class ExperimentError(ValueError):
    pass


def parse_origin(origin: Optional[str]) -> Dict[str, Optional[str]]:
    """``backtest:<id>`` / ``analysis:<id>`` / ``trainer`` / ``model-health`` / ``search-hub``."""
    if not origin:
        return {"kind": None, "id": None}
    kind, _, oid = str(origin).partition(":")
    if kind not in ORIGIN_KINDS:
        return {"kind": "other", "id": None}
    if oid and not _ID_RE.match(oid):
        raise ExperimentError("Invalid experiment origin id")
    return {"kind": kind, "id": oid or None}


def sanitize(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise ExperimentError("experiment must be an object")
    parent = raw.get("parent_run_id")
    if not isinstance(parent, str) or not _ID_RE.match(parent):
        raise ExperimentError("experiment.parent_run_id is required")
    preset = raw.get("preset")
    if preset is not None and preset not in PRESETS:
        raise ExperimentError(f"experiment.preset must be one of {', '.join(PRESETS)}")
    changed = raw.get("changed") or []
    if not isinstance(changed, list) or len(changed) > 20 or not all(isinstance(c, str) and len(c) <= 200 for c in changed):
        raise ExperimentError("experiment.changed must be a short list of strings")
    origin = raw.get("origin")
    if origin is not None and (not isinstance(origin, str) or len(origin) > 160):
        raise ExperimentError("experiment.origin must be a string")
    anchor = raw.get("anchor_run_id")
    if anchor is not None and (not isinstance(anchor, str) or not _ID_RE.match(anchor)):
        raise ExperimentError("experiment.anchor_run_id is invalid")
    variant_key = raw.get("variant_key")
    if variant_key is not None and variant_key not in VARIANT_KEYS:
        raise ExperimentError(f"experiment.variant_key must be one of {', '.join(VARIANT_KEYS)}")
    replicate = raw.get("replicate", 0)
    if not isinstance(replicate, int) or isinstance(replicate, bool) or not 0 <= replicate <= MAX_REPLICATE:
        raise ExperimentError(f"experiment.replicate must be an integer from 0 to {MAX_REPLICATE}")
    return {
        "parent_run_id": parent,
        "preset": preset,
        "origin": origin,
        "changed": list(changed),
        "anchor_run_id": anchor,
        "variant_key": variant_key,
        "replicate": replicate,
    }


def history_of(model_metadata: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    exp = ((model_metadata or {}).get("training_config") or {}).get("experiment") or {}
    hist = exp.get("selection_history") if isinstance(exp, dict) else None
    return [h for h in hist if isinstance(h, dict)] if isinstance(hist, list) else []


def inspection_from_backtest(backtest_id: str, results: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    ds = (results or {}).get("dataset") or {}
    return {
        "kind": "backtest",
        "run_id": backtest_id,
        "dataset_id": ds.get("dataset_id"),
        "dataset_fingerprint": ds.get("fingerprint"),
        "first_decision": ds.get("first_decision"),
        "last_decision": ds.get("last_decision"),
        "symbols": list(ds.get("symbols") or [])[:50],
        "evaluation_class": (results or {}).get("evaluation_class"),
        "recorded": bool(results),
    }


def build_record(
    req: Dict[str, Any],
    parent_metadata: Optional[Dict[str, Any]],
    load_backtest_results: Callable[[str], Optional[Dict[str, Any]]],
    *,
    anchor_run_id: Optional[str] = None,
    session_histories: Optional[List[List[Dict[str, Any]]]] = None,
) -> Dict[str, Any]:
    """The stored experiment record. ``load_backtest_results`` must enforce ownership.

    ``session_histories``: selection histories of the other runs in the same improvement session.
    Everything designed in one workspace was designed with the same knowledge, so the union is
    inherited, not only the direct parent's history.
    """
    from app.services.improve_sessions import merge_histories, session_id_for

    origin = parse_origin(req.get("origin"))
    history = merge_histories([history_of(parent_metadata), *(session_histories or [])], limit=MAX_HISTORY)
    if origin["kind"] in TEST_RESULT_ORIGINS and origin["id"]:
        history = history + [inspection_from_backtest(origin["id"], load_backtest_results(origin["id"]))]
    selection = "test_results" if any(h.get("kind") == "backtest" for h in history) else "validation_only"
    anchor = anchor_run_id or req.get("anchor_run_id") or req["parent_run_id"]
    return {
        "version": 2,
        "anchor_run_id": anchor,
        "session_id": session_id_for(anchor),
        "variant_key": req.get("variant_key"),
        "replicate": req.get("replicate") or 0,
        "parent_run_id": req["parent_run_id"],
        "parent_dataset_id": (parent_metadata or {}).get("dataset_id"),
        "preset": req.get("preset"),
        "origin": req.get("origin"),
        "origin_kind": origin["kind"],
        "changed": req.get("changed") or [],
        "selection": selection,
        "selection_history": history[-MAX_HISTORY:],
        "created_at": time.time(),
    }


def _day(v: Any) -> Optional[str]:
    return str(v)[:10] if v else None


def selection_check(history: Optional[List[Dict[str, Any]]], test_dataset_id: Optional[str],
                    test_first: Optional[str], test_last: Optional[str]) -> Dict[str, Any]:
    """Status and detail for the audit's ``selection_history`` check (``pass``/``fail``/``info``)."""
    inspected = [h for h in (history or []) if h.get("kind") == "backtest"]
    if history is None:
        return {"status": "info", "detail": "No experiment history is recorded for this model. Only models created "
                "with Improve record which test results were inspected before they were designed.", "overlaps": []}
    if not inspected:
        return {"status": "pass", "detail": "This model was created with Improve from validation results only; no test "
                "result was inspected before it was designed.", "overlaps": []}
    t0, t1 = _day(test_first), _day(test_last)
    overlaps = []
    for h in inspected:
        same = bool(test_dataset_id and h.get("dataset_id") == test_dataset_id)
        h0, h1 = _day(h.get("first_decision")), _day(h.get("last_decision"))
        dated = bool(t0 and t1 and h0 and h1)
        if same or (dated and h0 <= t1 and t0 <= h1) or (not dated and not h.get("dataset_id")):
            overlaps.append({"run_id": h.get("run_id"), "dataset_id": h.get("dataset_id"), "first_decision": h0, "last_decision": h1})
    if overlaps:
        spans = "; ".join(f"{o['first_decision'] or '?'} to {o['last_decision'] or '?'}" for o in overlaps[:3])
        return {"status": "fail", "overlaps": overlaps, "detail": (
            f"This model was designed after inspecting backtest results on dates that overlap this test ({spans}). "
            "Its result here is research evaluation, not independent confirmation; confirm on a later period.")}
    return {"status": "pass", "overlaps": [], "detail": (
        f"This model was designed after inspecting {len(inspected)} backtest result(s); none overlaps this test's "
        "decision dates.")}
