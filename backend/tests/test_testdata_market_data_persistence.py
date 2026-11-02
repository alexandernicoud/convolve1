"""Test Data generation -> artifact store -> Backtester, across separate Cloud Run instances.

The research job generates a test dataset and publishes it; the API instance that later runs the
backtest has none of the job's files and restores the dataset from the store. LocalCopyStore stands
in for the bucket (it uses the archive path, like GCS). The stored bars under
provenance/ohlcv/<SYMBOL>.csv must survive that trip byte for byte, or the backtester refuses with
"Stored market data missing".
"""

from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import app.main as main
from app.db import SessionLocal
from app.models import PipelineRun
from app.ownership import record_user_dataset
from app.paths import dataset_dir_for, resolve_existing_dataset_dir, run_dir_for
from app.services import dataset_provenance as dp
from app.services import durable_outputs
from app.services import trade_outcomes as to
from app.services.durable_outputs import LocalCopyStore, publish_dataset_dir, set_artifact_store

SPEC = to.OutcomeSpec(horizon_bars=5, tp_frac=0.02, sl_frac=0.01)


@pytest.fixture
def bucket(tmp_path: Path):
    store = LocalCopyStore(tmp_path / "bucket")
    set_artifact_store(store)
    yield store
    set_artifact_store(None)


@pytest.fixture
def owner(client, user_a) -> uuid.UUID:
    from tests.conftest import mint_token

    client.get("/api/me", headers={"Authorization": f"Bearer {mint_token(user_a)}"})
    return user_a


def _bars(n: int = 60, seed: int = 1) -> pd.DataFrame:
    idx = pd.bdate_range("2025-01-02", periods=n, tz="America/New_York")
    close = 100 * np.cumprod(1 + np.random.default_rng(seed).normal(0, 0.012, n))
    return pd.DataFrame(
        {"Open": close * 0.999, "High": close * 1.01, "Low": close * 0.99, "Close": close, "Volume": 1e6}, index=idx
    )


def _generate_test_dataset(owner: uuid.UUID, kind: str = "test") -> tuple[str, Path, Path]:
    """What the Test Data Generator leaves on the research job's disk: images, provenance with bars."""
    dataset_id = f"dataset_{uuid.uuid4().hex[:10]}"
    run_id = f"td_{uuid.uuid4().hex[:8]}"
    run_dir = run_dir_for(run_id, str(owner))
    run_dir.mkdir(parents=True, exist_ok=True)
    root = dataset_dir_for(dataset_id, str(owner))
    (root / "images").mkdir(parents=True, exist_ok=True)

    bars = {"UNH": _bars(seed=1), "SPY": _bars(seed=2)}
    writer = dp.ProvenanceWriter(run_dir, {"kind": kind, "label_method": to.LABEL_METHOD_V2,
                                           "outcome": {"horizon_bars": SPEC.horizon_bars, "tp_frac": SPEC.tp_frac,
                                                       "sl_frac": SPEC.sl_frac, "timeframe": "1d"},
                                           "timeframe": "1d", "price_adjustment": dp.PRICE_ADJUSTMENT_YF})
    writer.add_history("UNH", bars["UNH"], role="sample")
    writer.add_history("SPY", bars["SPY"], role="benchmark")
    for i, ts in enumerate(bars["UNH"].index[10:40]):
        label = to.label_for_method(to.resolve_outcome(bars["UNH"], ts, SPEC), to.LABEL_METHOD_V2)
        if label is None:
            continue
        name = f"UNH_{i:03d}_label{label}.png"
        (root / "images" / name).write_bytes(b"\x89PNG" + bytes([i]) * 64)
        writer.add_sample({"image_id": name, "symbol": "UNH", "decision_ts": ts.isoformat(), "label": label})
    writer.write()
    (root / "summary.json").write_text(json.dumps({"dataset_id": dataset_id}), encoding="utf-8")
    dp.finalize_into_dataset(run_dir / dp.STAGING_DIR, root, dataset_id)
    (run_dir / "testdata_results.json").write_text(json.dumps({"dataset_id": dataset_id, "dataset_path": str(root / "images")}))
    record_user_dataset(dataset_id, str(owner), source="testdata", kind="test", path=str(root))
    return dataset_id, root, run_dir


def _verify_provenance_like_the_backtester(dataset_dir: Path) -> None:
    """Step 1 of the v2 engine: every sample symbol has bars and every stored label reproduces."""
    meta = dp.load_provenance(dataset_dir)
    samples = dp.load_samples(dataset_dir)
    bars = {s: dp.load_ohlcv(dataset_dir, s) for s in dp.iter_symbols(meta)}
    missing = sorted({s["symbol"] for s in samples if bars.get(s["symbol"]) is None})
    assert not missing, f"Stored market data missing for: {missing}"
    for s in samples:
        o = to.resolve_outcome(bars[s["symbol"]], pd.Timestamp(s["decision_ts"]), SPEC)
        assert to.label_for_method(o, to.LABEL_METHOD_V2) == s["label"]


def test_bars_survive_job_to_api_instance_and_verify(owner, bucket):
    dataset_id, root, run_dir = _generate_test_dataset(owner)
    originals = {p.name: p.read_bytes() for p in (root / "provenance" / "ohlcv").iterdir()}

    ok, err = durable_outputs._publish_testdata_dataset(run_dir, str(owner))
    assert ok, err
    stored = {p.relative_to(bucket.root).as_posix().split(f"datasets/{dataset_id}/", 1)[1] for p in bucket.root.rglob("*") if p.is_file()}
    assert {"provenance/ohlcv/UNH.csv", "provenance/ohlcv/SPY.csv", "provenance/provenance.json"} <= stored

    # The job's container is gone; a different API instance has no copy of the dataset.
    shutil.rmtree(root)
    shutil.rmtree(run_dir)
    restored = resolve_existing_dataset_dir(dataset_id, str(owner))
    assert restored is not None
    for name, data in originals.items():
        assert (restored / "provenance" / "ohlcv" / name).read_bytes() == data
    assert dp.missing_market_data(restored) == []
    _verify_provenance_like_the_backtester(restored)


def test_instance_with_images_but_no_bars_fetches_them(owner, bucket):
    """An instance restored the dataset before the bars were stored: images present, ohlcv absent."""
    dataset_id, root, run_dir = _generate_test_dataset(owner)
    assert durable_outputs._publish_testdata_dataset(run_dir, str(owner))[0]
    shutil.rmtree(root / "provenance" / "ohlcv")
    assert dp.missing_market_data(root) == ["SPY", "UNH"]

    restored = resolve_existing_dataset_dir(dataset_id, str(owner))
    assert dp.missing_market_data(restored) == []
    _verify_provenance_like_the_backtester(restored)


def test_test_dataset_without_its_bars_is_not_marked_stored(owner, bucket):
    dataset_id, root, run_dir = _generate_test_dataset(owner)
    (root / "provenance" / "ohlcv" / "UNH.csv").unlink()
    ok, err = durable_outputs._publish_testdata_dataset(run_dir, str(owner))
    assert not ok and "UNH" in err


def test_training_zip_provenance_without_bars_still_stores(owner, bucket):
    """Training-generator ZIPs carry provenance.json and samples but not the bars, by design."""
    dataset_id, root, _ = _generate_test_dataset(owner, kind="train")
    shutil.rmtree(root / "provenance" / "ohlcv")
    ok, err = publish_dataset_dir(dataset_id, str(owner), root)
    assert ok, err


def test_backtest_without_bars_is_refused_before_a_run_is_recorded(client, owner, bucket, monkeypatch):
    from tests.conftest import mint_token
    from tests.test_model_lifecycle import _trained

    started: list = []
    monkeypatch.setattr(main, "run_backtester_realtime", lambda run_id, payload: started.append(run_id))
    headers = {"Authorization": f"Bearer {mint_token(owner)}"}
    run_id = _trained(owner)
    dataset_id, root, run_dir = _generate_test_dataset(owner)
    assert durable_outputs._publish_testdata_dataset(run_dir, str(owner))[0]
    body = {"dataset_path": f"backend/datasets/{dataset_id}/images", "engine": "v2", "trainer_run_id": run_id}

    # Stored bars lost everywhere (the production state of datasets published before the fix).
    for p in bucket.root.rglob("ohlcv/*.csv"):
        p.unlink()
    shutil.rmtree(root / "provenance" / "ohlcv")
    with SessionLocal() as db:
        before = db.query(PipelineRun).filter(PipelineRun.tool == "backtester").count()

    caps = client.get(f"/api/backtests/dataset-capabilities/{dataset_id}", headers=headers).json()
    assert caps["market_data_missing"] == ["UNH"] and "Generate the test dataset again" in caps["reason"]
    res = client.post("/api/backtests/run", json=body, headers=headers)
    assert res.status_code == 422 and res.json()["detail"]["code"] == "market_data_missing"
    with SessionLocal() as db:
        assert db.query(PipelineRun).filter(PipelineRun.tool == "backtester").count() == before
    assert started == []


def test_backtest_starts_when_bars_are_in_the_store(client, owner, bucket, monkeypatch):
    from tests.conftest import mint_token
    from tests.test_model_lifecycle import _trained

    started: list = []
    monkeypatch.setattr(main, "run_backtester_realtime", lambda run_id, payload: started.append(payload))
    headers = {"Authorization": f"Bearer {mint_token(owner)}"}
    run_id = _trained(owner)
    dataset_id, root, run_dir = _generate_test_dataset(owner)
    assert durable_outputs._publish_testdata_dataset(run_dir, str(owner))[0]
    shutil.rmtree(root)

    res = client.post("/api/backtests/run", json={"dataset_path": f"backend/datasets/{dataset_id}/images",
                                                  "engine": "v2", "trainer_run_id": run_id,
                                                  "tp_pct": SPEC.tp_frac * 100, "sl_pct": SPEC.sl_frac * 100},
                      headers=headers)
    assert res.status_code == 200, res.text
    dataset_dir = Path(started[-1]["dataset_path"]).parent
    _verify_provenance_like_the_backtester(dataset_dir)
