"""Trainer 2.0 scientific validation: sample manifest, chronological splits, purging, metrics and
option validation. No TensorFlow."""

from __future__ import annotations

import json
import math
import os
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pytest

from runners import data_split, eval_metrics, sample_manifest as sm, trainer_options


def _name(sym: str, start: date, end: date, label: int) -> str:
    return f"{sym}_{start.isoformat()}_to_{end.isoformat()}_label{label}.png"


def _daily(n: int, *, sym: str = "AAA", window: int = 10, start: date = date(2020, 1, 1), step: int = 1, labels=None):
    out = []
    for i in range(n):
        end = start + timedelta(days=i * step)
        out.append(_name(sym, end - timedelta(days=window), end, (labels[i] if labels else i % 2)))
    return out


def _samples(names, *, horizon=None, tf="1d", provenance=None):
    samples = [sm.Sample(id=n, label=sm.label_of(n), size=100) for n in sorted(names)]
    sources = sm.annotate(samples, provenance=provenance, horizon_bars=horizon, timeframe=tf)
    return samples, sources


def _touch(folder: Path, names):
    folder.mkdir(parents=True, exist_ok=True)
    for n in names:
        (folder / n).write_bytes(b"x" * 10)


# ---------------------------------------------------------------- manifest


def test_manifest_order_and_digest_do_not_depend_on_the_filesystem(tmp_path):
    names = _daily(30)
    _touch(tmp_path / "a", names)
    _touch(tmp_path / "b", list(reversed(names)))
    a, b = sm.scan(str(tmp_path / "a")), sm.scan(str(tmp_path / "b"))
    assert [s.id for s in a] == sorted(names) == [s.id for s in b]
    assert sm.digest(a) == sm.digest(b)
    # A changed file (size) or label changes the digest.
    (tmp_path / "b" / names[0]).write_bytes(b"y" * 11)
    assert sm.digest(sm.scan(str(tmp_path / "b"))) != sm.digest(a)


def test_metadata_sources_best_first():
    names = _daily(3) + ["chart_label1.png"]
    samples, sources = _samples(names, horizon=5)
    assert sources == {sm.SOURCE_CALENDAR: 3, sm.SOURCE_UNDATED: 1}
    s = next(x for x in samples if x.source == sm.SOURCE_CALENDAR)
    # 5 daily bars: ceil(5 * 7/5) = 7 calendar days, plus the 4-day holiday allowance.
    assert sm.calendar_days_for_bars(5, "1d") == 11
    assert s.label_start == sm.add_days(s.decision, 1) and s.label_end == sm.add_days(s.decision, 11)

    _, sources = _samples(names)
    assert sources == {sm.SOURCE_DATES_ONLY: 3, sm.SOURCE_UNDATED: 1}

    prov = [{"image_id": names[0], "symbol": "AAA", "decision_ts": "2020-01-01T00:00:00-05:00",
             "earliest_entry_ts": "2020-01-02T00:00:00-05:00", "horizon_end_ts": "2020-01-03T00:00:00-05:00"}]
    samples, sources = _samples(names, horizon=5, provenance=prov)
    assert sources[sm.SOURCE_PROVENANCE] == 1
    exact = next(x for x in samples if x.id == names[0])
    assert (exact.decision, exact.label_start, exact.label_end) == ("2020-01-01", "2020-01-02", "2020-01-03")


@pytest.mark.parametrize("tf_, bars, days", [("1d", 7, 14), ("1wk", 2, 18), ("1mo", 1, 35)])
def test_calendar_upper_bound_per_timeframe(tf_, bars, days):
    assert sm.calendar_days_for_bars(bars, tf_) == days
    with pytest.raises(ValueError):
        sm.calendar_days_for_bars(1, "1h")


# ---------------------------------------------------------------- splits


def test_chronological_split_orders_partitions_and_never_splits_a_date():
    names = _daily(100, window=0)
    # Two charts on one date at the would-be boundary must land on the same side.
    names.append(_name("BBB", date(2020, 1, 1) + timedelta(days=80), date(2020, 1, 1) + timedelta(days=80), 1))
    samples, src = _samples(names, horizon=1)
    plan = data_split.plan_split(samples, val_fraction=0.2, test_fraction=0.1, purge_chart_windows=False, sources=src)
    tr, va, te = (plan.partitions[k] for k in ("train", "val", "test"))
    assert max(s.decision for s in tr) < min(s.decision for s in va)
    assert max(s.decision for s in va) < min(s.decision for s in te)
    for a, b in ((tr, va), (va, te)):
        assert not {s.decision for s in a} & {s.decision for s in b}
    assert plan.boundaries == {"test_start": te[0].decision, "val_start": va[0].decision}
    summary = plan.summary()
    assert summary["label_purge"] == "applied"
    assert set(summary["partitions"]) == {"train", "val", "test"}
    assert summary["partitions"]["test"]["label_counts"] == {"0": sum(1 for s in te if s.label == 0), "1": sum(1 for s in te if s.label == 1)}
    ids = plan.manifest()["ids"]
    assert sorted(ids["train"] + ids["val"] + ids["test"] + [e["id"] for e in plan.excluded]) == sorted(names)


def test_label_windows_that_reach_a_later_partition_are_purged_with_reasons():
    names = _daily(50, window=0)
    samples, src = _samples(names, horizon=5)  # 11 calendar days
    plan = data_split.plan_split(samples, val_fraction=0.2, purge_chart_windows=False, sources=src)
    val_start = plan.boundaries["val_start"]
    reasons = plan.summary()["excluded_by_reason"]
    assert reasons == {"label_window_overlaps_val": 11}
    for s in plan.partitions["train"]:
        assert s.label_end < val_start
    excluded = {e["id"] for e in plan.excluded}
    for s in samples:
        if s.id in excluded:
            assert s.label_end >= val_start and s.decision < val_start


def test_chart_window_purge_and_embargo():
    names = _daily(60, window=10)
    samples, src = _samples(names, horizon=1)
    plan = data_split.plan_split(samples, val_fraction=0.25, purge_chart_windows=True, sources=src)
    first_window = min(s.window_start for s in plan.partitions["val"])
    assert all(s.decision < first_window for s in plan.partitions["train"])
    assert plan.summary()["excluded_by_reason"].get("chart_window_overlaps_val", 0) > 0

    base = data_split.plan_split(samples, val_fraction=0.25, purge_chart_windows=False, sources=src)
    embargo = data_split.plan_split(samples, val_fraction=0.25, purge_chart_windows=False, embargo_bars=5, sources=src)
    assert len(embargo.partitions["train"]) < len(base.partitions["train"])


def test_purge_pools_all_assets_and_timeframes():
    a = _daily(40, sym="AAA", window=0)
    b = _daily(40, sym="BBB", window=0, start=date(2020, 1, 1))
    samples, src = _samples(a + b, horizon=3)
    plan = data_split.plan_split(samples, val_fraction=0.25, purge_chart_windows=False, sources=src)
    val_start = plan.boundaries["val_start"]
    assert plan.summary()["partitions"]["val"]["symbols"] == ["AAA", "BBB"]
    # No training sample of either asset has an outcome window reaching the shared validation start.
    assert all(s.label_end < val_start for s in plan.partitions["train"])

    weekly, src = _samples(_daily(40, window=0, step=7), horizon=2, tf="1wk")
    plan = data_split.plan_split(weekly, val_fraction=0.25, purge_chart_windows=False, sources=src)
    # 2 weekly bars = 18 calendar days: the 2 weekly charts before the boundary are purged.
    assert plan.summary()["excluded_by_reason"] == {"label_window_overlaps_val": 2}


def test_irregular_calendars_use_exact_per_sample_provenance():
    # Daily bars with a 10-day market closure shortly before the validation period. The outcome
    # window of the last training charts (4 bars) spans the closure and reaches into validation.
    days, d = [], date(2020, 1, 1)
    for i in range(44):
        if i == 28:
            d += timedelta(days=10)
        days.append(d)
        d += timedelta(days=1)
    names = [_name("AAA", days[i], days[i], i % 2) for i in range(40)]
    prov = [
        {"image_id": names[i], "symbol": "AAA", "decision_ts": days[i].isoformat(),
         "earliest_entry_ts": days[i + 1].isoformat(), "horizon_end_ts": days[i + 4].isoformat()}
        for i in range(40)
    ]
    exact, src = _samples(names, horizon=4, provenance=prov)
    bound, src_b = _samples(names, horizon=4)
    plan_exact = data_split.plan_split(exact, val_fraction=0.25, purge_chart_windows=False, sources=src)
    plan_bound = data_split.plan_split(bound, val_fraction=0.25, purge_chart_windows=False, sources=src_b)
    assert plan_exact.sources == {sm.SOURCE_PROVENANCE: 40}
    val_start = plan_exact.boundaries["val_start"]
    assert all(s.label_end < val_start for s in plan_exact.partitions["train"])
    # The calendar estimate (4 bars = 10 days) assumes closures of at most 4 extra days and misses
    # the closure; recorded bars catch it. This is why per-chart records are preferred.
    assert plan_exact.summary()["excluded_total"] > plan_bound.summary()["excluded_total"]


def test_missing_horizon_is_reported_not_assumed_safe():
    samples, src = _samples(_daily(40, window=0))
    plan = data_split.plan_split(samples, val_fraction=0.25, purge_chart_windows=True, sources=src)
    assert plan.label_purge == "unverified"
    assert any("horizon" in w for w in plan.warnings)


def test_undated_data_refuses_chronological_and_warns_for_random():
    names = [f"c{i:02d}_label{i % 2}.png" for i in range(20)]
    samples, src = _samples(names)
    with pytest.raises(data_split.SplitError, match="dated charts"):
        data_split.plan_split(samples, method="chronological", sources=src)
    plan = data_split.plan_split(samples, method="random", val_fraction=0.25, seed=3, sources=src)
    again = data_split.plan_split(list(reversed(samples)), method="random", val_fraction=0.25, seed=3, sources=src)
    assert plan.ids("val") == again.ids("val") and len(plan.ids("val")) == 5
    assert any("Random split" in w for w in plan.warnings)
    assert plan.label_purge == "not_applicable"
    other = data_split.plan_split(samples, method="random", val_fraction=0.25, seed=4, sources=src)
    assert other.ids("val") != plan.ids("val")


def test_random_validation_keeps_a_chronological_purged_test_period():
    samples, src = _samples(_daily(80, window=0), horizon=2)
    plan = data_split.plan_split(samples, method="random", val_fraction=0.2, test_fraction=0.2, purge_chart_windows=False, sources=src)
    test_start = plan.boundaries["test_start"]
    assert all(s.decision >= test_start for s in plan.partitions["test"])
    assert all(s.label_end < test_start for s in plan.partitions["train"] + plan.partitions["val"])


def test_empty_partitions_explain_why():
    # 30-day chart windows against a ~6-day validation period: purging empties training.
    samples, src = _samples(_daily(24, window=30), horizon=1)
    with pytest.raises(data_split.SplitError) as exc:
        data_split.plan_split(samples, val_fraction=0.25, purge_chart_windows=True, sources=src)
    assert "chart window overlaps val" in str(exc.value)
    with pytest.raises(data_split.SplitError):
        data_split.plan_split(samples, val_fraction=0.6, test_fraction=0.35)
    with pytest.raises(data_split.SplitError):
        data_split.plan_split([], val_fraction=0.2)


def test_single_class_partition_is_flagged():
    names = _daily(40, window=0, labels=[0] * 30 + [1] * 10)
    samples, src = _samples(names, horizon=1)
    plan = data_split.plan_split(samples, val_fraction=0.25, purge_chart_windows=False, sources=src)
    assert any("only label 1" in w for w in plan.warnings)


def test_plan_from_folder_reads_dataset_provenance(tmp_path):
    names = _daily(30, window=0)
    _touch(tmp_path / "images", names)
    (tmp_path / "provenance").mkdir()
    with open(tmp_path / "provenance" / "samples.jsonl", "w") as f:
        for n in names:
            d = n.split("_to_")[1][:10]
            f.write(json.dumps({"image_id": n, "symbol": "AAA", "decision_ts": d, "horizon_end_ts": d}) + "\n")
    plan = data_split.plan_from_folder(str(tmp_path / "images"), horizon_bars=50, timeframe="1d", val_fraction=0.2)
    assert plan.sources == {sm.SOURCE_PROVENANCE: 30}
    assert plan.summary()["excluded_total"] == 0


# ---------------------------------------------------------------- metrics


def test_binary_metrics_match_hand_computed_values():
    y = [0, 0, 0, 1, 1, 1, 1, 0]
    p = [0.1, 0.6, 0.3, 0.8, 0.4, 0.9, 0.7, 0.2]
    m = eval_metrics.binary_metrics(y, p, train_label_counts={"0": 30, "1": 70})
    # threshold 0.5: preds 0 1 0 1 0 1 1 0 -> tn 3, fp 1, fn 1, tp 3
    assert m["confusion_matrix"]["rows_true_cols_pred"] == [[3, 1], [1, 3]]
    assert m["accuracy"] == 0.75 and m["balanced_accuracy"] == 0.75
    assert m["precision"] == 0.75 and m["recall"] == 0.75 and m["f1"] == 0.75
    # AUC: 16 positive/negative pairs; only (0.6 vs 0.4) is mis-ordered -> 15/16.
    assert m["roc_auc"] == pytest.approx(15 / 16)
    # Ranking 0.9(1) 0.8(1) 0.7(1) 0.6(0) 0.4(1): AP = (1 + 1 + 1 + 4/5) / 4.
    assert m["pr_auc"] == pytest.approx((3 + 0.8) / 4)
    pa = np.clip(np.array(p), 1e-7, 1 - 1e-7)
    ya = np.array(y)
    assert m["log_loss"] == pytest.approx(float(-np.mean(ya * np.log(pa) + (1 - ya) * np.log(1 - pa))))
    assert m["brier"] == pytest.approx(float(np.mean((np.array(p) - ya) ** 2)))
    base = m["baseline"]
    assert base["source"] == "training labels" and base["majority_label"] == 1
    assert base["accuracy"] == 0.5 and base["prior_label_1"] == 0.7
    assert base["log_loss"] == pytest.approx(-(4 * math.log(0.7) + 4 * math.log(0.3)) / 8)
    hist = m["probability_histogram"]
    assert sum(hist["label_0"]) == 4 and sum(hist["label_1"]) == 4


def test_auc_ties_count_half():
    assert eval_metrics.roc_auc(np.array([0, 1]), np.array([0.5, 0.5])) == 0.5
    assert eval_metrics.roc_auc(np.array([0, 0, 1, 1]), np.array([0.2, 0.6, 0.6, 0.9])) == pytest.approx(0.875)


def test_absent_classes_are_undefined_not_zero():
    m = eval_metrics.binary_metrics([1, 1, 1], [0.9, 0.8, 0.4])
    assert m["roc_auc"] is None and "roc_auc" in m["undefined"]
    assert m["balanced_accuracy"] is None and "balanced_accuracy" in m["undefined"]
    assert m["per_class"]["0"]["recall"] is None
    m = eval_metrics.binary_metrics([0, 1, 0, 1], [0.1, 0.2, 0.3, 0.4])
    assert m["precision"] is None and "precision_1" in m["undefined"]
    m = eval_metrics.binary_metrics([], [])
    assert m["n"] == 0 and m["undefined"]["all"] == "no samples"
    with pytest.raises(ValueError):
        eval_metrics.binary_metrics([0, 2], [0.1, 0.2])


def test_constant_majority_prediction_has_no_skill():
    y = [1] * 60 + [0] * 40
    m = eval_metrics.binary_metrics(y, [0.9] * 100, train_label_counts={"0": 40, "1": 60})
    assert m["accuracy"] == 0.6 == m["baseline"]["accuracy"]
    assert m["balanced_accuracy"] == 0.5 and m["roc_auc"] == 0.5


def test_epoch_scores_from_confusion_counts():
    s = eval_metrics.epoch_scores({"val_tp": 3, "val_tn": 3, "val_fp": 1, "val_fn": 1})
    assert s == {"val_balanced_accuracy": 0.75, "val_precision": 0.75, "val_recall": 0.75, "val_f1": 0.75}
    assert eval_metrics.epoch_scores({"val_tp": 0, "val_tn": 4, "val_fp": 0, "val_fn": 0})["val_balanced_accuracy"] is None
    assert eval_metrics.epoch_scores({}) == {}


# ---------------------------------------------------------------- options


def test_new_runs_default_to_the_scientific_protocol():
    o = trainer_options.resolve({"trainer_protocol": 2})
    assert o["validation_method"] == "chronological"
    assert o["test_fraction"] == 0.0 and o["evaluate_test"] is False
    assert o["purge_chart_windows"] is True and o["deterministic_ops"] is True
    assert o["optimizer"] == {"name": "adam", "learning_rate": 1e-3, "clipnorm": None}
    assert o["lr_schedule"] == {"name": "constant"}
    assert o["early_stopping"] == {"enabled": True, "patience": 5, "min_delta": 0.0}
    assert o["selection_metric"] == "val_loss" and o["class_weighting"] == "none"
    assert o["augmentation"] == [] and o["transfer"] == {"mode": "scratch"}


def test_api_request_without_options_gets_the_same_defaults():
    from app.main import TrainerRequest, _trainer_config

    o = trainer_options.resolve(_trainer_config(TrainerRequest(model_name="m")))
    assert o == trainer_options.resolve({"trainer_protocol": 2})
    assert o["purge_chart_windows"] is True
    off = _trainer_config(TrainerRequest(model_name="m", purge_chart_windows=False))
    assert trainer_options.resolve(off)["purge_chart_windows"] is False


def test_legacy_runs_keep_their_meaning():
    o = trainer_options.resolve({})
    assert o["protocol"] == 1 and o["validation_method"] == "random" and o["deterministic_ops"] is False
    assert trainer_options.resolve({"validation_method": "chronological"})["validation_method"] == "chronological"
    with pytest.raises(trainer_options.OptionsError, match="protocol 1"):
        trainer_options.resolve({"optimizer": {"name": "sgd"}})


@pytest.mark.parametrize(
    "bad, match",
    [
        ({"optimizer": {"name": "rmsprop"}}, "optimizer"),
        ({"optimizer": {"name": "adam", "momentum": 0.9}}, "Unknown"),
        ({"optimizer": {"name": "adam", "learning_rate": 5}}, "Learning rate"),
        ({"optimizer": {"name": "adamw"}, "regularization": {"l2": 1e-4}}, "AdamW"),
        ({"lr_schedule": {"name": "cosine", "patience": 2}}, "Unknown"),
        ({"regularization": {"dropout": 0.95}}, "Dropout"),
        ({"selection_metric": "test_accuracy"}, "selection_metric"),
        ({"selection_metric": "backtest_profit"}, "selection_metric"),
        ({"augmentation": ["horizontal_flip"]}, "not offered"),
        ({"augmentation": ["vertical_flip"]}, "not offered"),
        ({"test_fraction": 0.6}, "Test share"),
        ({"early_stopping": {"patience": 0}}, "Patience"),
        ({"transfer": {"mode": "magic"}}, "transfer"),
        ({"label_timeframe": "1h"}, "label_timeframe"),
    ],
)
def test_invalid_options_are_rejected(bad, match):
    with pytest.raises(trainer_options.OptionsError, match=match):
        trainer_options.resolve({"trainer_protocol": 2, **bad})


def test_options_round_trip_and_evaluate_test_needs_a_test_partition():
    cfg = {
        "trainer_protocol": 2,
        "optimizer": {"name": "sgd", "learning_rate": 0.05, "momentum": 0.8, "clipnorm": 1.0},
        "lr_schedule": {"name": "warmup_cosine", "warmup_epochs": 2, "alpha": 0.1},
        "regularization": {"dropout": 0.3, "l2": 1e-4},
        "selection_metric": "val_auc",
        "class_weighting": "balanced",
        "augmentation": ["vertical_shift", "pixel_noise", "pixel_noise"],
        "transfer": {"mode": "fine_tune", "trainable_layers": 10},
        "evaluate_test": True,
    }
    o = trainer_options.resolve(cfg)
    assert o["augmentation"] == ["pixel_noise", "vertical_shift"]
    assert o["evaluate_test"] is False  # no test partition requested
    assert trainer_options.resolve(json.loads(json.dumps({**cfg, **{k: o[k] for k in ("optimizer", "lr_schedule")}})))["optimizer"] == o["optimizer"]
    schema = trainer_options.public_schema()
    assert schema["protocol"] == 2 and "val_loss" in schema["selection_metrics"]
    assert {a["id"]: a["allowed"] for a in schema["augmentations"]}["horizontal_flip"] is False


def test_preprocessing_contract_is_shared():
    from app.services import cnn_inference

    text = Path(os.path.dirname(data_split.__file__), "trainer_v2.py").read_text()
    assert f'PREPROCESS_ID = "{cnn_inference.PREPROCESS_ID}"' in text
