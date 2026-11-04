"""Improvement sessions: anchor resolution, conservative verdicts, lifecycle and decisions (pure logic)."""

from __future__ import annotations

import pytest

from app.services import improve_sessions as s


def _summary(auc, *, seed=1, lr=0.001, dataset="ds1", val_split=0.2, n=400, params=1000, experiment=None, val_samples=400):
    cfg = {"dataset_id": dataset, "val_split": val_split, "random_seed": seed}
    if experiment:
        cfg["experiment"] = experiment
    return {
        "config": cfg,
        "options": {"optimizer": {"name": "adam", "learning_rate": lr}, "protocol": 3, "validation_method": "chronological"},
        "evaluation": {"validation": {"n": n, "roc_auc": auc, "pr_auc": 0.5, "balanced_accuracy": 0.55, "log_loss": 0.68,
                                      "baseline_accuracy": 0.5}},
        "saved_weights_metrics": {"accuracy": 0.7, "val_accuracy": 0.6, "val_loss": 0.67},
        "model": {"parameters": params, "architecture": "convolve-cnn-v1"},
        "reproducibility": {"random_seed": seed},
        "saved_weights_epoch": 4,
        "val_samples": val_samples,
    }


def _exp(parent, anchor=None, key=None, replicate=0):
    e = {"parent_run_id": parent, "variant_key": key, "replicate": replicate, "version": 2 if anchor else 1}
    if anchor:
        e["anchor_run_id"] = anchor
    return e


def _member(rid, summary, experiment, status="succeeded", decision=None, created=1.0):
    return {"id": rid, "status": status, "created_at": created, "summary": summary, "experiment": experiment, "decision": decision, "name": rid}


# --------------------------------------------------------------------------- anchor resolution


def test_explicit_anchor_wins_and_legacy_chains_walk_to_the_original():
    records = {
        "v2": _exp("v1", anchor="A"),  # new record: explicit anchor
        "v1": _exp("A"),  # legacy record: parent only
        "c": _exp("b"),
        "b": _exp("A"),
    }
    assert s.resolve_anchor("v2", records.get) == ("A", ["v2"])
    assert s.resolve_anchor("c", records.get) == ("A", ["c", "b"])
    assert s.resolve_anchor("A", records.get) == ("A", [])


def test_resolution_never_invents_links_and_survives_cycles():
    assert s.resolve_anchor("orphan", {"orphan": _exp("gone")}.get) == ("gone", ["orphan"])
    loop = {"x": _exp("y"), "y": _exp("x")}
    anchor, chain = s.resolve_anchor("x", loop.get)
    assert anchor in ("x", "y") and len(chain) <= 2


# --------------------------------------------------------------------------- verdicts


def _m(auc, n=400):
    return s.metrics_from_summary(_summary(auc, n=n))


def test_fewer_than_three_original_runs_is_always_insufficient_evidence():
    big_gain = s.verdict([_m(0.55), _m(0.56)], [_m(0.80)])
    assert big_gain["verdict"] == s.VERDICT_INSUFFICIENT
    assert "at least 3" in big_gain["reason"]


def test_clear_improvement_needs_to_exceed_noise_and_sampling_error():
    baseline = [_m(0.550, n=20000), _m(0.552, n=20000), _m(0.548, n=20000)]
    assert s.verdict(baseline, [_m(0.60, n=20000)])["verdict"] == s.VERDICT_IMPROVED
    assert s.verdict(baseline, [_m(0.50, n=20000)])["verdict"] == s.VERDICT_WORSE
    out = s.verdict(baseline, [_m(0.553, n=20000)])
    assert out["verdict"] == s.VERDICT_NO_DIFF and out["metric"] == "roc_auc" and out["margin"] > 0.003


def test_small_validation_sets_keep_the_verdict_cautious():
    baseline = [_m(0.550, n=200), _m(0.552, n=200), _m(0.548, n=200)]
    assert s.verdict(baseline, [_m(0.60, n=200)])["verdict"] == s.VERDICT_NO_DIFF


def test_noisy_seeds_widen_the_margin():
    quiet = [_m(0.550, n=20000), _m(0.551, n=20000), _m(0.549, n=20000)]
    noisy = [_m(0.50, n=20000), _m(0.60, n=20000), _m(0.55, n=20000)]
    assert s.verdict(quiet, [_m(0.58, n=20000)])["verdict"] == s.VERDICT_IMPROVED
    assert s.verdict(noisy, [_m(0.58, n=20000)])["verdict"] == s.VERDICT_NO_DIFF


def test_missing_class_counts_never_produce_a_clear_verdict():
    m = _m(0.55)
    m["majority_share"] = None
    assert s.verdict([m, m, m], [_m(0.9)])["verdict"] == s.VERDICT_INSUFFICIENT


def test_efficiency_is_reported_separately_from_quality():
    note = s.efficiency_note({"parameters": 1000}, [{"parameters": 100}], s.VERDICT_NO_DIFF)
    assert note and "not a predictive improvement" in note
    assert s.efficiency_note({"parameters": 1000}, [{"parameters": 100}], s.VERDICT_WORSE) is None


# --------------------------------------------------------------------------- controlled comparisons


def test_split_mismatch_detects_uncontrolled_comparisons():
    a = s.effective_config(_summary(0.5))
    assert s.split_mismatch(a, s.effective_config(_summary(0.5, seed=9))) == []
    assert "Different dataset" in s.split_mismatch(a, s.effective_config(_summary(0.5, dataset="other")))
    assert "Different validation share" in s.split_mismatch(a, s.effective_config(_summary(0.5, val_split=0.3)))
    assert s.split_mismatch(a, s.effective_config(_summary(0.5, val_samples=350)))


def test_config_diff_names_changed_and_unchanged_settings():
    changed, unchanged = s.config_diff(s.effective_config(_summary(0.5)), s.effective_config(_summary(0.5, lr=0.01, seed=2)))
    assert {c["setting"] for c in changed} == {"optimizer", "seed"}
    assert "Architecture" in unchanged and "Seed" not in unchanged


# --------------------------------------------------------------------------- lifecycle and decisions


def test_lifecycle_and_decision_history():
    assert s.lifecycle_of(None, None) == s.LIFECYCLE_MODEL
    exp = _exp("A", anchor="A")
    assert s.lifecycle_of(exp, None) == s.LIFECYCLE_CANDIDATE
    kept = s.apply_decision(None, "keep", at=1.0, preferred=True)
    assert s.lifecycle_of(exp, kept) == s.LIFECYCLE_KEPT and kept["preferred"]
    archived = s.apply_decision(kept, "discard", at=2.0)
    assert s.lifecycle_of(exp, archived) == s.LIFECYCLE_ARCHIVED and not archived["preferred"]
    restored = s.apply_decision(archived, "restore", at=3.0)
    assert s.lifecycle_of(exp, restored) == s.LIFECYCLE_CANDIDATE
    assert [h["action"] for h in restored["history"]] == ["keep", "discard", "restore"]
    with pytest.raises(ValueError):
        s.apply_decision(None, "delete", at=4.0)


def test_status_groups():
    assert s.status_group("queued", s.LIFECYCLE_CANDIDATE) == "queued"
    assert s.status_group("running", s.LIFECYCLE_CANDIDATE) == "running"
    assert s.status_group("cancelled", s.LIFECYCLE_CANDIDATE) == "failed"
    assert s.status_group("succeeded", s.LIFECYCLE_CANDIDATE) == "awaiting_decision"
    assert s.status_group("succeeded", s.LIFECYCLE_KEPT) == "kept"
    assert s.status_group("succeeded", s.LIFECYCLE_ARCHIVED) == "archived"


def test_merge_histories_dedupes_and_keeps_order():
    h1 = [{"kind": "backtest", "run_id": "b1"}]
    h2 = [{"kind": "backtest", "run_id": "b1"}, {"kind": "backtest", "run_id": "b2"}]
    assert [h["run_id"] for h in s.merge_histories([h1, h2])] == ["b1", "b2"]


# --------------------------------------------------------------------------- session assembly


def test_session_compares_every_experiment_with_the_fixed_anchor():
    anchor = {"id": "A", "status": "succeeded", "created_at": 0, "summary": _summary(0.55, n=20000), "experiment": None, "name": "A"}
    members = [
        _member("r1", _summary(0.552, seed=2, n=20000), _exp("A", "A", "seed", 0), created=1),
        _member("r2", _summary(0.548, seed=3, n=20000), _exp("A", "A", "seed", 1), created=2),
        _member("v", _summary(0.62, lr=0.01, n=20000), _exp("A", "A", "lr_low"), created=3),
        # Chained from the variant but anchored to A: still compared with A, not with "v".
        _member("v2", _summary(0.50, lr=0.0001, seed=5, n=20000), _exp("v", "A", "lr_high"), created=4),
        _member("q", None, _exp("A", "A", "smaller"), status="queued", created=5),
        _member("x", None, _exp("A", "A", "gap"), status="cancelled", created=6),
        _member("other", _summary(0.9, dataset="different", n=20000), _exp("A", "A", "transfer"), created=7),
    ]
    out = s.build_session(anchor, members)
    by = {e["run_id"]: e for e in out["experiments"]}
    assert out["session_id"] == "imp_A"
    assert out["noise"]["baseline_runs"] == 3 and out["noise"]["sufficient"]
    assert by["r1"]["verdict"]["verdict"] == "replicate"
    assert by["v"]["verdict"]["verdict"] == s.VERDICT_IMPROVED
    assert by["v2"]["verdict"]["verdict"] == s.VERDICT_WORSE and by["v2"]["direct"] is False
    assert by["q"]["group"] == "queued" and by["q"]["verdict"]["verdict"] == s.VERDICT_PENDING
    assert by["x"]["group"] == "failed"
    assert by["other"]["verdict"]["verdict"] == s.VERDICT_NOT_COMPARABLE
    assert by["v"]["deltas"]["roc_auc"] == pytest.approx(0.07)
    assert out["counts"]["awaiting_decision"] == 5


def test_session_without_replicates_never_declares_a_winner():
    anchor = {"id": "A", "status": "succeeded", "created_at": 0, "summary": _summary(0.55, n=20000), "experiment": None, "name": "A"}
    out = s.build_session(anchor, [_member("v", _summary(0.75, lr=0.01, n=20000), _exp("A", "A", "lr_low"))])
    assert not out["noise"]["sufficient"]
    assert out["experiments"][0]["verdict"]["verdict"] == s.VERDICT_INSUFFICIENT
