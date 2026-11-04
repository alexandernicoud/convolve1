"""Improve-model experiment records and the leakage audit's selection-history check."""

from __future__ import annotations

import json
import os

import pytest
from fastapi import HTTPException

from app.services import experiments as ex
from app.services import leakage_audit as la

BT = {"dataset": {"dataset_id": "ds_test_2024", "fingerprint": "f1", "first_decision": "2024-01-02", "last_decision": "2024-12-30",
                  "symbols": ["COST"]}, "evaluation_class": "independent_test"}


def _meta(experiment=None):
    cfg = {"model_name": "m.keras"}
    if experiment is not None:
        cfg["experiment"] = experiment
    return {"dataset_id": "ds_train", "training_config": cfg}


def test_sanitize_rejects_malformed_requests():
    assert ex.sanitize({"parent_run_id": "r1", "preset": "gap", "origin": "backtest:b1", "changed": ["Architecture: a → b"]})["preset"] == "gap"
    for bad in ({}, {"parent_run_id": "../x"}, {"parent_run_id": "r1", "preset": "magic"}, {"parent_run_id": "r1", "changed": "x"}):
        with pytest.raises(ex.ExperimentError):
            ex.sanitize(bad)


def test_backtest_origin_records_the_inspected_test_and_is_inherited():
    req = ex.sanitize({"parent_run_id": "r1", "preset": "regularize", "origin": "backtest:b1"})
    rec = ex.build_record(req, _meta(), lambda bid: BT if bid == "b1" else None)
    assert rec["selection"] == "test_results"
    assert rec["selection_history"][0]["dataset_id"] == "ds_test_2024"
    assert rec["parent_dataset_id"] == "ds_train"

    # A grandchild created from validation results keeps the parent's history.
    child = ex.build_record(ex.sanitize({"parent_run_id": "r2", "preset": "seed", "origin": "model-health"}), _meta(rec), lambda _: None)
    assert child["selection"] == "test_results"
    assert [h["run_id"] for h in child["selection_history"]] == ["b1"]


def test_validation_only_experiments_have_no_test_history():
    rec = ex.build_record(ex.sanitize({"parent_run_id": "r1", "origin": "model-health"}), _meta(), lambda _: BT)
    assert rec["selection"] == "validation_only"
    assert rec["selection_history"] == []


def test_selection_check_flags_overlap_and_same_dataset():
    hist = [ex.inspection_from_backtest("b1", BT)]
    assert ex.selection_check(hist, "other", "2024-06-01", "2025-03-01")["status"] == "fail"
    assert ex.selection_check(hist, "ds_test_2024", "2026-01-01", "2026-06-01")["status"] == "fail"
    assert ex.selection_check(hist, "other", "2025-01-02", "2025-06-30")["status"] == "pass"
    assert ex.selection_check([], "other", "2024-06-01", "2025-03-01")["status"] == "pass"
    assert ex.selection_check(None, "other", "2024-06-01", "2025-03-01")["status"] == "info"
    # An inspection whose dates and dataset are unknown is treated as overlapping.
    assert ex.selection_check([{"kind": "backtest", "run_id": "b9"}], "x", "2025-01-02", "2025-06-30")["status"] == "fail"


def _audit(selection_history):
    samples = [{"image_id": f"COST_{d}", "symbol": "COST", "observation_start": "2023-01-01", "observation_end": d, "decision_ts": d,
                "earliest_entry_ts": d + "T01:00"} for d in ("2024-03-01", "2024-09-02")]
    training = la.TrainingSide(dataset_id="ds_train", image_names=[], horizon_bars=4, timeframe="1d", threshold_source=la.THRESHOLD_VALIDATION_LOCKED)
    return la.run_audit(test_dataset_id="ds_new", test_samples=samples, test_image_names=[s["image_id"] for s in samples],
                        training=training, selection_history=selection_history)


def test_audit_downgrades_a_test_informed_model_on_overlapping_dates():
    informed = _audit([ex.inspection_from_backtest("b1", BT)])
    check = next(c for c in informed["checks"] if c["id"] == "selection_history")
    assert check["status"] == "fail" and check["n_affected"] == 1
    assert informed["evaluation_class"] == la.EVAL_EXPLORATORY
    assert not informed["blocked"]

    original = _audit(None)
    assert next(c for c in original["checks"] if c["id"] == "selection_history")["status"] == "info"
    later = _audit([ex.inspection_from_backtest("b0", {"dataset": {"dataset_id": "old", "first_decision": "2022-01-03", "last_decision": "2022-12-30"}})])
    assert next(c for c in later["checks"] if c["id"] == "selection_history")["status"] == "pass"


def test_server_builds_the_record_from_the_parent_metadata():
    from app.main import _experiment_record, get_run_dir

    parent = "20991231_000000_exprnt"
    os.makedirs(get_run_dir(parent), exist_ok=True)
    with open(os.path.join(get_run_dir(parent), "model_metadata.json"), "w") as f:
        json.dump(_meta(), f)
    rec = _experiment_record({"parent_run_id": parent, "preset": "gap", "origin": "search-hub", "changed": ["x"]}, None)
    assert rec["parent_run_id"] == parent and rec["selection"] == "validation_only" and rec["version"] == 2
    assert rec["anchor_run_id"] == parent and rec["session_id"] == f"imp_{parent}"
    with pytest.raises(HTTPException) as missing:
        _experiment_record({"parent_run_id": "20991231_000000_nonexi"}, None)
    assert missing.value.status_code == 404
    with pytest.raises(HTTPException) as bad:
        _experiment_record({"parent_run_id": parent, "origin": "backtest:"}, None)
    assert bad.value.status_code == 400
