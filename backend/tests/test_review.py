"""Review workspace: provenance edges, inspector payloads, durable labels, bot provenance, isolation."""

from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path

import pytest

from app.config import BOT_DATA_DIR
from app.db import SessionLocal
from app.models import AssetLabel, Bot, PipelineRun, UserDataset
from app.paths import backtests_dir_for, dataset_dir_for, run_dir_for, runs_root, datasets_root
from tests.conftest import mint_token


def _auth(client, user_id: uuid.UUID) -> dict:
    headers = {"Authorization": f"Bearer {mint_token(user_id)}"}
    assert client.get("/api/me", headers=headers).status_code == 200
    return headers


@pytest.fixture
def cleanup_users():
    users: list[uuid.UUID] = []
    yield users
    for uid in users:
        for root in (runs_root(), datasets_root(), Path(BOT_DATA_DIR) / "models"):
            shutil.rmtree(root / str(uid), ignore_errors=True)


def _pipeline_run(user_id: uuid.UUID, run_id: str, tool: str, status: str = "succeeded") -> Path:
    db = SessionLocal()
    try:
        db.add(PipelineRun(id=run_id, user_id=user_id, tool=tool, status=status))
        db.commit()
    finally:
        db.close()
    run_dir = run_dir_for(run_id, str(user_id))
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "run_manifest.json").write_text(
        json.dumps(
            {"id": run_id, "tool": tool, "status": status, "user_id": str(user_id), "created_at": 100, "updated_at": 200}
        ),
        encoding="utf-8",
    )
    return run_dir


def _write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def _seed_research_chain(user_id: uuid.UUID) -> dict:
    """generator -> extracted dataset -> trainer -> model -> backtest, all recorded on disk."""
    sfx = uuid.uuid4().hex[:6]
    gen, trn, bt, ds = f"gen_{sfx}", f"trn_{sfx}", f"bt-{sfx}", f"ds{sfx}"

    gdir = _pipeline_run(user_id, gen, "training-chart-generator")
    _write(
        gdir / "generator_config.json",
        {"symbols": "AAPL", "timeframe": "1d", "takeProfitFraction": 0.02, "stopLossFraction": 0.01, "horizonBars": 7},
    )
    _write(gdir / "artifacts" / "dataset_stats.json", {"total_charts": 4, "label_counts": {"0": 2, "1": 2}})
    (gdir / f"training-dataset-{gen}.zip").write_bytes(b"PK\x05\x06" + b"\x00" * 18)

    db = SessionLocal()
    try:
        db.add(UserDataset(id=ds, user_id=user_id, source="uploaded", kind="training"))
        db.commit()
    finally:
        db.close()
    ddir = dataset_dir_for(ds, str(user_id))
    (ddir / "images").mkdir(parents=True, exist_ok=True)
    (ddir / "images" / "AAPL_2020-01-01_to_2020-02-01_label1.png").write_bytes(b"png")
    _write(
        ddir / "summary.json",
        {"dataset_id": ds, "total_images": 4, "label_distribution": {"0": 2, "1": 2}, "generator_run_id": gen},
    )

    tdir = _pipeline_run(user_id, trn, "trainer")
    _write(
        tdir / "summary.json",
        {
            "model_name": "cnn.keras",
            "config": {"dataset_id": ds, "folder_name": "/secret/abs/path/images", "epochs": 30, "random_seed": 7},
            "train_samples": 3,
            "val_samples": 1,
            "batch_size": 16,
            "epochs_trained": 2,
            "best_epoch": 1,
            "final_metrics": {"accuracy": 0.9, "val_accuracy": 0.6, "loss": 0.2, "val_loss": 0.7},
            "completed_at": 300,
        },
    )
    _write(tdir / "model_metadata.json", {"schema_version": 1, "dataset_id": ds, "generator_run_id": gen})
    _write(
        tdir / "history.json",
        [{"epoch": 1, "accuracy": 0.5, "val_accuracy": 0.5}, {"epoch": 2, "accuracy": 0.9, "val_accuracy": 0.6}],
    )
    (tdir / "cnn.keras").write_bytes(b"keras-bytes")

    db = SessionLocal()
    try:
        db.add(PipelineRun(id=bt, user_id=user_id, tool="backtester", status="succeeded"))
        db.commit()
    finally:
        db.close()
    bdir = backtests_dir_for(str(user_id)) / bt
    _write(
        bdir / "run_info.json",
        {
            "run_id": bt,
            "status": "succeeded",
            "started_at": 400,
            "updated_at": 500,
            "config": {
                "trainer_run_id": trn,
                "model_path": f"/abs/runs/{trn}/cnn.keras",
                "dataset_path": f"/abs/datasets/{ds}/images",
                "commission_pct": 0.1,
                "slippage_pct": 0.05,
                "tp_pct": 2.0,
                "sl_pct": 1.0,
            },
        },
    )
    _write(
        bdir / "output" / "backtest_results.json",
        {
            "kpis": {"return_pct": -1.5, "trades": 10, "win_rate": 40.0, "profit_factor": 0.9},
            "classification_metrics": {"accuracy": 0.47},
            "benchmark": {"phase_start": "2024-01-01", "phase_end": "2024-06-01", "underlying_symbol": "AAPL"},
            "series": {"equity": [{"as_of_date": "2024-01-01", "equity": 10000.0}]},
            "trades": [{}] * 10,
        },
    )
    return {"gen": gen, "trn": trn, "bt": bt, "ds": ds}


def _edge(edges, source, target):
    return next((e for e in edges if e["source"] == source and e["target"] == target), None)


def test_overview_exposes_recorded_provenance_and_summaries(client, user_a, cleanup_users):
    cleanup_users.append(user_a)
    h = _auth(client, user_a)
    ids = _seed_research_chain(user_a)
    res = client.get("/api/review/overview", headers=h)
    assert res.status_code == 200
    body = res.json()
    edges = body["edges"]

    gen_ds = _edge(edges, f"run:{ids['gen']}", f"dataset:{ids['ds']}")
    assert gen_ds and gen_ds["provenance"] == "recorded"
    assert _edge(edges, f"dataset:{ids['ds']}", f"run:{ids['trn']}")["relation"] == "trained_on"
    assert _edge(edges, f"run:{ids['trn']}", f"model:{ids['trn']}")["relation"] == "produced"
    bt_edge = _edge(edges, f"model:{ids['trn']}", f"run:{ids['bt']}")
    assert bt_edge and bt_edge["provenance"] == "recorded"
    assert _edge(edges, f"dataset:{ids['ds']}", f"run:{ids['bt']}")["relation"] == "evaluated_on"

    model = next(m for m in body["models"] if m["id"] == ids["trn"])
    assert model["metrics"]["val_accuracy"] == 0.6
    assert model["metrics"]["accuracy"] == 0.9
    assert model["training"]["epochs"] == 30

    bt_row = next(r for r in body["runs"] if r["id"] == ids["bt"])
    perf = bt_row["backtest"]["performance"]
    assert perf["return_pct"] == -1.5 and perf["costs_included"] is True
    assert "sharpe_ratio" not in perf  # absent metrics stay absent, never zero
    assert bt_row["backtest"]["assumptions"]["commission_pct"] == 0.1
    assert bt_row["backtest"]["period"] == {"start": "2024-01-01", "end": "2024-06-01"}

    archive = next(d for d in body["datasets"] if d["id"] == f"generated:{ids['gen']}")
    assert archive["label_distribution"] == {"0": 2, "1": 2}
    extracted = next(d for d in body["datasets"] if d["id"] == ids["ds"])
    assert extracted["archive_key"] == f"generated:{ids['gen']}"
    assert extracted["generator_link"] == "recorded"
    assert ids["ds"] in archive["extracted_as"]


def test_recovered_generator_link_is_flagged(client, user_a, cleanup_users):
    cleanup_users.append(user_a)
    h = _auth(client, user_a)
    ids = _seed_research_chain(user_a)
    summary_path = dataset_dir_for(ids["ds"], str(user_a)) / "summary.json"
    data = json.loads(summary_path.read_text())
    data["generator_link_recovered_by"] = "filename_match"
    summary_path.write_text(json.dumps(data))
    edges = client.get("/api/review/overview", headers=h).json()["edges"]
    edge = _edge(edges, f"run:{ids['gen']}", f"dataset:{ids['ds']}")
    assert edge["provenance"] == "recovered"


def test_overview_is_isolated_between_users(client, user_a, user_b, cleanup_users):
    cleanup_users.extend([user_a, user_b])
    ha, hb = _auth(client, user_a), _auth(client, user_b)
    ids = _seed_research_chain(user_a)
    body = client.get("/api/review/overview", headers=hb).json()
    all_ids = {r["id"] for r in body["runs"]} | {m["id"] for m in body["models"]} | {d["id"] for d in body["datasets"]}
    assert not all_ids & set(ids.values())
    assert not any(ids["trn"] in (e["source"] + e["target"]) for e in body["edges"])
    assert client.get("/api/review/overview", headers=ha).status_code == 200


def test_inspector_payload_is_sanitized_and_owned(client, user_a, user_b, cleanup_users):
    cleanup_users.extend([user_a, user_b])
    ha, hb = _auth(client, user_a), _auth(client, user_b)
    ids = _seed_research_chain(user_a)

    model = client.get(f"/api/review/assets/model/{ids['trn']}", headers=ha)
    assert model.status_code == 200
    payload = model.json()
    assert [p["epoch"] for p in payload["history"]] == [1, 2]
    assert payload["training"]["metrics"]["val_accuracy"] == 0.6
    assert "/secret/abs/path" not in json.dumps(payload)

    bt = client.get(f"/api/review/assets/run/{ids['bt']}", headers=ha).json()
    assert bt["backtest"]["trade_count"] == 10
    assert bt["backtest"]["links"]["trainer_run_id"] == ids["trn"]
    assert "/abs/" not in json.dumps({k: v for k, v in bt["backtest"].items() if k != "links"})

    ds = client.get(f"/api/review/assets/dataset/{ids['ds']}", headers=ha).json()
    assert ds["summary"]["label_distribution"] == {"0": 2, "1": 2}
    assert ds["generator_link"] == "recorded"

    for path in (
        f"/api/review/assets/model/{ids['trn']}",
        f"/api/review/assets/run/{ids['bt']}",
        f"/api/review/assets/dataset/{ids['ds']}",
        f"/api/review/assets/dataset/generated:{ids['gen']}",
    ):
        assert client.get(path, headers=hb).status_code == 404, path
    assert client.get("/api/review/assets/run/..%2Fetc", headers=ha).status_code == 404
    assert client.get("/api/review/assets/bogus/x", headers=ha).status_code == 404


def test_labels_are_durable_per_user(client, user_a, user_b, cleanup_users):
    cleanup_users.extend([user_a, user_b])
    ha, hb = _auth(client, user_a), _auth(client, user_b)
    ids = _seed_research_chain(user_a)

    r = client.patch(
        f"/api/models/{ids['trn']}/label", headers=ha, json={"display_name": "AAPL baseline", "tags": ["baseline"]}
    )
    assert r.status_code == 200 and r.json()["display_name"] == "AAPL baseline"
    r = client.patch(f"/api/review/labels/run/{ids['bt']}", headers=ha, json={"notes": "costs too high", "favorite": True})
    assert r.status_code == 200 and r.json()["favorite"] is True

    db = SessionLocal()
    try:
        rows = db.query(AssetLabel).filter(AssetLabel.user_id == user_a).all()
        assert {(row.kind, row.asset_id) for row in rows} >= {("model", ids["trn"]), ("run", ids["bt"])}
    finally:
        db.close()

    body = client.get("/api/review/overview", headers=ha).json()
    model = next(m for m in body["models"] if m["id"] == ids["trn"])
    assert model["name"] == "AAPL baseline" and model["auto_name"] == "cnn.keras" and model["tags"] == ["baseline"]
    bt_row = next(x for x in body["runs"] if x["id"] == ids["bt"])
    assert bt_row["notes"] == "costs too high"

    assert client.patch(f"/api/models/{ids['trn']}/label", headers=hb, json={"favorite": True}).status_code == 404
    assert client.patch(f"/api/review/labels/run/{ids['bt']}", headers=hb, json={"favorite": True}).status_code == 404

    r = client.patch(f"/api/models/{ids['trn']}/label", headers=ha, json={"display_name": None, "tags": []})
    assert r.json()["display_name"] is None


def _bot_form(**extra) -> dict:
    base = {"symbol": "AAPL", "tp_pct": "2", "sl_pct": "1", "run_time": "22:00"}
    base.update(extra)
    return base


def test_bot_from_library_records_provenance(client, user_a, user_b, cleanup_users):
    cleanup_users.extend([user_a, user_b])
    ha, hb = _auth(client, user_a), _auth(client, user_b)
    ids = _seed_research_chain(user_a)

    r = client.post(
        "/api/bots",
        headers=ha,
        data=_bot_form(source_training_run_id=ids["trn"], source_backtest_run_id=ids["bt"]),
    )
    assert r.status_code == 200, r.text
    bot = r.json()
    assert bot["provenance"] == "library"
    assert bot["source_training_run_id"] == ids["trn"] and bot["source_backtest_run_id"] == ids["bt"]
    assert Path(bot["model_path"]).read_bytes() == b"keras-bytes"
    assert (run_dir_for(ids["trn"], str(user_a)) / "cnn.keras").read_bytes() == b"keras-bytes"

    edges = client.get("/api/review/overview", headers=ha).json()["edges"]
    assert _edge(edges, f"model:{ids['trn']}", f"bot:{bot['id']}")["provenance"] == "recorded"
    assert _edge(edges, f"run:{ids['bt']}", f"bot:{bot['id']}")["relation"] == "informed"

    # Another user's model is invisible; mismatched backtest and ambiguous input are rejected.
    assert client.post("/api/bots", headers=hb, data=_bot_form(source_training_run_id=ids["trn"])).status_code == 404
    other = _seed_research_chain(user_a)
    r = client.post(
        "/api/bots", headers=ha, data=_bot_form(source_training_run_id=other["trn"], source_backtest_run_id=ids["bt"])
    )
    assert r.status_code == 400
    r = client.post(
        "/api/bots", headers=ha, data=_bot_form(source_training_run_id=ids["trn"], source_model_id="model_x")
    )
    assert r.status_code == 400


def test_legacy_bot_without_provenance_is_unknown(client, user_a, cleanup_users):
    cleanup_users.append(user_a)
    h = _auth(client, user_a)
    db = SessionLocal()
    bot_id = str(uuid.uuid4())
    try:
        db.add(Bot(id=bot_id, user_id=str(user_a), symbol="MSFT", model_path="/tmp/legacy.keras"))
        db.commit()
    finally:
        db.close()
    body = client.get("/api/review/overview", headers=h).json()
    bot = next(b for b in body["bots"] if b["id"] == bot_id)
    assert bot["provenance"] == "unknown"
    assert not any(e["target"] == f"bot:{bot_id}" for e in body["edges"])
