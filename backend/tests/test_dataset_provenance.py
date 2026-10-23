"""Provenance storage and leakage audit."""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app.services import dataset_provenance as dp
from app.services import leakage_audit as la
from app.services import trade_outcomes as to


def _bars(n=40, start="2025-01-02", tz="America/New_York"):
    idx = pd.bdate_range(start, periods=n, tz=tz)
    rng = np.random.default_rng(1)
    close = 100 * np.cumprod(1 + rng.normal(0, 0.01, n))
    return pd.DataFrame(
        {"Open": close * 0.999, "High": close * 1.01, "Low": close * 0.99, "Close": close, "Volume": 1e6},
        index=idx,
    )


def test_ohlcv_roundtrip_is_exact_and_keeps_timezone(tmp_path):
    bars = _bars()
    w = dp.ProvenanceWriter(tmp_path, {"label_method": to.LABEL_METHOD_V2})
    w.add_history("MSFT", bars)
    w.add_sample({"image_id": "a.png", "symbol": "MSFT"})
    w.write()
    ds = tmp_path / "ds"
    (ds / "images").mkdir(parents=True)
    (ds / "images" / "a.png").write_bytes(b"x")
    man = dp.finalize_into_dataset(tmp_path / dp.STAGING_DIR, ds, "ds1")
    assert man["n_samples"] == 1 and man["samples_without_image"] == 0 and man["fingerprint"]
    back = dp.load_ohlcv(ds, "MSFT")
    assert str(back.index.tz) == "America/New_York"
    assert (back.index == bars.index).all()
    np.testing.assert_array_equal(back[["Open", "High", "Low", "Close"]].to_numpy(), bars[["Open", "High", "Low", "Close"]].to_numpy())


def test_outcomes_reproduce_from_stored_bars(tmp_path):
    bars = _bars(60)
    spec = to.OutcomeSpec(horizon_bars=5, tp_frac=0.02, sl_frac=0.01)
    w = dp.ProvenanceWriter(tmp_path, {})
    w.add_history("X", bars)
    w.write()
    ds = tmp_path / "ds"
    ds.mkdir()
    dp.finalize_into_dataset(tmp_path / dp.STAGING_DIR, ds, "d")
    back = dp.load_ohlcv(ds, "X")
    for ts in bars.index[:50]:
        a, b = to.resolve_outcome(bars, ts, spec), to.resolve_outcome(back, ts, spec)
        assert a.to_record() == b.to_record()


def test_tampered_market_data_is_rejected(tmp_path):
    w = dp.ProvenanceWriter(tmp_path, {})
    w.add_history("X", _bars())
    w.write()
    ds = tmp_path / "ds"
    ds.mkdir()
    dp.finalize_into_dataset(tmp_path / dp.STAGING_DIR, ds, "d")
    f = ds / dp.PROVENANCE_DIR / "ohlcv" / "X.csv"
    f.write_text(f.read_text().replace("\n2025-01-03", "\n2025-01-04", 1))
    with pytest.raises(ValueError):
        dp.load_ohlcv(ds, "X")


@pytest.mark.parametrize("sym", ["../evil", "a/b", "", "x" * 40])
def test_unsafe_symbols_are_not_written(tmp_path, sym):
    with pytest.raises(ValueError):
        dp.ProvenanceWriter(tmp_path, {}).add_history(sym, _bars())


def test_legacy_dataset_has_no_provenance(tmp_path):
    (tmp_path / "images").mkdir()
    assert dp.load_provenance(tmp_path) is None
    assert dp.load_samples(tmp_path) == []
    assert dp.load_ohlcv(tmp_path, "MSFT") is None


def test_fingerprint_changes_with_content(tmp_path):
    (tmp_path / "a.png").write_bytes(b"1")
    f1 = dp.dataset_fingerprint(tmp_path)
    (tmp_path / "a.png").write_bytes(b"2")
    assert dp.dataset_fingerprint(tmp_path) != f1


# --- leakage audit -------------------------------------------------------------------------------


def _sample(sym, dec, entry, obs_start="2025-01-01", image=None):
    return {
        "image_id": image or f"{sym}_{obs_start}_to_{dec[:10]}_label0.png",
        "symbol": sym,
        "observation_start": obs_start,
        "observation_end": dec,
        "decision_ts": dec,
        "earliest_entry_ts": entry,
    }


def test_independent_when_everything_is_known_and_clean():
    bars = _bars(80, start="2025-01-02")
    samples = [_sample("X", "2025-03-03T00:00:00-05:00", "2025-03-04T00:00:00-05:00", obs_start="2025-02-03")]
    tr = la.TrainingSide(
        dataset_id="train", image_names=["X_2024-07-01_to_2025-01-06_label1.png"], horizon_bars=5,
        timeframe="1d", threshold_source=la.THRESHOLD_VALIDATION_LOCKED,
    )
    r = la.run_audit(test_dataset_id="test", test_samples=samples, test_image_names=[samples[0]["image_id"]],
                     training=tr, test_bars={"X": bars})
    assert r["evaluation_class"] == la.EVAL_INDEPENDENT, r
    assert r["purged_sample_ids"] == []


def test_overlapping_label_intervals_are_purged_not_blocked():
    bars = _bars(80, start="2025-01-02")
    near = _sample("X", "2025-01-07T00:00:00-05:00", "2025-01-08T00:00:00-05:00")
    far = _sample("X", "2025-03-03T00:00:00-05:00", "2025-03-04T00:00:00-05:00")
    tr = la.TrainingSide(dataset_id="train", image_names=["X_2024-07-01_to_2025-01-06_label1.png"],
                         horizon_bars=5, timeframe="1d", threshold_source=la.THRESHOLD_VALIDATION_LOCKED)
    r = la.run_audit(test_dataset_id="test", test_samples=[near, far], test_image_names=[], training=tr,
                     test_bars={"X": bars})
    assert r["purged_sample_ids"] == [near["image_id"]]
    assert not r["blocked"]


def test_lookback_overlap_alone_is_informational():
    bars = _bars(80, start="2025-01-02")
    s = _sample("X", "2025-03-03T00:00:00-05:00", "2025-03-04T00:00:00-05:00", obs_start="2024-09-01")
    tr = la.TrainingSide(dataset_id="train", image_names=["X_2024-07-01_to_2025-01-06_label1.png"],
                         horizon_bars=5, timeframe="1d", threshold_source=la.THRESHOLD_VALIDATION_LOCKED)
    r = la.run_audit(test_dataset_id="test", test_samples=[s], test_image_names=[], training=tr, test_bars={"X": bars})
    look = next(c for c in r["checks"] if c["id"] == "lookback_overlap")
    assert look["status"] == la.INFO and look["n_affected"] == 1
    assert r["evaluation_class"] == la.EVAL_INDEPENDENT


def test_dataset_reuse_blocks_by_default():
    tr = la.TrainingSide(dataset_id="same", threshold_source=la.THRESHOLD_VALIDATION_LOCKED)
    r = la.run_audit(test_dataset_id="same", test_samples=[], test_image_names=["a.png"], training=tr)
    assert r["blocked"] and r["evaluation_class"] == la.EVAL_BLOCKED
    r2 = la.run_audit(test_dataset_id="same", test_samples=[], test_image_names=["a.png"], training=tr,
                      allow_reuse_override=True)
    assert not r2["blocked"] and r2["evaluation_class"] == la.EVAL_EXPLORATORY


def test_shared_chart_files_block():
    tr = la.TrainingSide(dataset_id="a", image_names=["X_2024-01-01_to_2024-06-01_label1.png"])
    r = la.run_audit(test_dataset_id="b", test_samples=[], test_image_names=["X_2024-01-01_to_2024-06-01_label1.png"],
                     training=tr)
    assert r["blocked"]


def test_future_bar_in_image_blocks():
    s = _sample("X", "2025-03-03T00:00:00-05:00", "2025-03-03T00:00:00-05:00")
    r = la.run_audit(test_dataset_id="t", test_samples=[s], test_image_names=[], training=la.TrainingSide())
    assert r["blocked"]


def test_manual_or_test_sweep_threshold_is_never_independent():
    bars = _bars(80, start="2025-01-02")
    s = _sample("X", "2025-03-03T00:00:00-05:00", "2025-03-04T00:00:00-05:00", obs_start="2025-02-03")
    base = dict(dataset_id="train", image_names=["X_2024-07-01_to_2025-01-06_label1.png"], horizon_bars=5, timeframe="1d")
    for src in (la.THRESHOLD_USER_FIXED, la.THRESHOLD_TEST_SWEEP, None):
        r = la.run_audit(test_dataset_id="t", test_samples=[s], test_image_names=[],
                         training=la.TrainingSide(threshold_source=src, **base), test_bars={"X": bars})
        assert r["evaluation_class"] == la.EVAL_EXPLORATORY
    r = la.run_audit(test_dataset_id="t", test_samples=[s], test_image_names=[],
                     training=la.TrainingSide(threshold_source=la.THRESHOLD_VALIDATION_LOCKED, **base),
                     test_bars={"X": bars}, prior_runs_same_pair=2)
    assert r["evaluation_class"] == la.EVAL_EXPLORATORY


def test_legacy_inputs_are_unknown_not_pass():
    r = la.run_audit(test_dataset_id="t", test_samples=[], test_image_names=["a.png"], training=la.TrainingSide())
    statuses = {c["id"]: c["status"] for c in r["checks"]}
    assert statuses["future_in_image"] == la.UNKNOWN
    assert statuses["label_overlap"] == la.UNKNOWN
    assert statuses["dataset_reuse"] == la.UNKNOWN
    assert r["evaluation_class"] == la.EVAL_EXPLORATORY
