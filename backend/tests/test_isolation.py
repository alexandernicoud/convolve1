from __future__ import annotations

import uuid
from datetime import date
from pathlib import Path

from app.db import SessionLocal
from app.models import Bot, BotTrade, PipelineRun, UserDataset, UserModel
from app.paths import dataset_dir_for, run_dir_for, validate_id


def _auth(client, user_id: uuid.UUID) -> dict:
    from tests.conftest import mint_token

    token = mint_token(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    client.get("/api/me", headers=headers)
    return headers


def _seed_run(user_id: uuid.UUID, run_id: str, tool: str = "training-chart-generator") -> Path:
    validate_id(run_id, kind="run")
    db = SessionLocal()
    try:
        db.add(PipelineRun(id=run_id, user_id=user_id, tool=tool, status="succeeded"))
        db.commit()
    finally:
        db.close()
    run_dir = run_dir_for(run_id, str(user_id))
    artifacts = run_dir / "artifacts"
    artifacts.mkdir(parents=True, exist_ok=True)
    (artifacts / "metrics.json").write_text('{"ok": true}', encoding="utf-8")
    (run_dir / f"training-dataset-{run_id}.zip").write_bytes(b"PK\x05\x06" + b"\x00" * 18)
    (run_dir / "run_manifest.json").write_text(
        f'{{"id": "{run_id}", "tool": "{tool}", "status": "succeeded", '
        f'"user_id": "{user_id}", "created_at": 1, "updated_at": 1}}',
        encoding="utf-8",
    )
    return run_dir


def _seed_dataset(user_id: uuid.UUID, dataset_id: str) -> Path:
    db = SessionLocal()
    try:
        db.add(
            UserDataset(
                id=dataset_id,
                user_id=user_id,
                source="uploaded",
                kind="training",
            )
        )
        db.commit()
    finally:
        db.close()
    ddir = dataset_dir_for(dataset_id, str(user_id))
    images = ddir / "images"
    images.mkdir(parents=True, exist_ok=True)
    (images / "AAPL_2020-01-01_to_2020-01-02_label1.png").write_bytes(b"png")
    (ddir / "summary.json").write_text(
        f'{{"dataset_id": "{dataset_id}", "total_images": 1}}', encoding="utf-8"
    )
    return ddir


def _seed_model(user_id: uuid.UUID, model_id: str) -> None:
    db = SessionLocal()
    try:
        db.add(
            UserModel(
                id=model_id,
                user_id=user_id,
                source="uploaded",
                storage_key=f"keras/{user_id}/{model_id}.keras",
            )
        )
        db.commit()
    finally:
        db.close()


def _seed_bot(user_id: uuid.UUID, bot_id: str, *, with_trade: bool = False) -> None:
    db = SessionLocal()
    try:
        db.add(
            Bot(
                id=bot_id,
                user_id=str(user_id),
                name=f"bot-{bot_id}",
                symbol="AAPL",
                model_path=f"/tmp/{bot_id}.keras",
                tp_pct=1.0,
                sl_pct=1.0,
            )
        )
        if with_trade:
            db.add(
                BotTrade(
                    id=f"trade-{bot_id}",
                    bot_id=bot_id,
                    entry_date=date(2026, 1, 1),
                    entry_price=100.0,
                    position_notional=1000.0,
                    horizon_days=5,
                    expiry_date=date(2026, 1, 6),
                    status="open",
                )
            )
        db.commit()
    finally:
        db.close()


def test_unauthenticated_protected_requests_fail(client):
    assert client.get("/runs").status_code == 401
    assert client.get("/api/models").status_code == 401
    assert client.get("/api/datasets").status_code == 401
    assert client.get("/api/bots").status_code == 401
    assert client.get("/api/dashboard/bundle").status_code == 401
    assert client.get("/api/review/overview").status_code == 401


def test_run_listings_are_isolated(client, user_a, user_b):
    headers_a = _auth(client, user_a)
    headers_b = _auth(client, user_b)
    _seed_run(user_a, "runA_list_1")
    _seed_run(user_b, "runB_list_1")

    list_a = client.get("/runs", headers=headers_a)
    list_b = client.get("/runs", headers=headers_b)
    assert list_a.status_code == 200
    assert list_b.status_code == 200
    ids_a = {r["id"] for r in list_a.json()["runs"]}
    ids_b = {r["id"] for r in list_b.json()["runs"]}
    assert "runA_list_1" in ids_a
    assert "runB_list_1" not in ids_a
    assert "runB_list_1" in ids_b
    assert "runA_list_1" not in ids_b


def test_user_cannot_fetch_or_download_or_cancel_other_users_run(client, user_a, user_b):
    headers_a = _auth(client, user_a)
    headers_b = _auth(client, user_b)
    _seed_run(user_b, "runB_secret_1")
    _seed_run(user_a, "runA_own_1")

    assert client.get("/runs/runB_secret_1", headers=headers_a).status_code == 404
    assert client.get(
        "/api/labeling-optimizer/artifacts/runB_secret_1/metrics",
        headers=headers_a,
    ).status_code == 404
    assert client.get(
        "/api/training-chart-generator/download/runB_secret_1",
        headers=headers_a,
    ).status_code == 404
    assert client.post("/api/runs/runB_secret_1/cancel", headers=headers_a).status_code == 404

    own = client.get("/runs/runA_own_1", headers=headers_a)
    assert own.status_code == 200
    assert own.json()["id"] == "runA_own_1"
    artifact = client.get(
        "/api/labeling-optimizer/artifacts/runA_own_1/metrics",
        headers=headers_a,
    )
    assert artifact.status_code == 200
    download = client.get(
        "/api/training-chart-generator/download/runA_own_1",
        headers=headers_a,
    )
    assert download.status_code == 200
    cancel = client.post("/api/runs/runA_own_1/cancel", headers=headers_a)
    assert cancel.status_code == 200

    assert client.get("/runs/runB_secret_1", headers=headers_b).status_code == 200


def test_user_cannot_use_other_users_dataset(client, user_a, user_b):
    headers_a = _auth(client, user_a)
    _auth(client, user_b)
    _seed_dataset(user_b, "dsBown01")
    _seed_dataset(user_a, "dsAown01")

    denied = client.post(
        "/trainer/runs",
        headers=headers_a,
        json={"dataset_id": "dsBown01", "model_name": "iso", "epochs": 1},
    )
    assert denied.status_code == 404

    listed = client.get("/api/datasets", headers=headers_a)
    assert listed.status_code == 200
    ids = {d.get("dataset_id") or d.get("id") for d in listed.json()["datasets"]}
    assert "dsAown01" in ids
    assert "dsBown01" not in ids


def test_user_cannot_use_or_analyse_or_backtest_other_users_model(client, user_a, user_b):
    headers_a = _auth(client, user_a)
    _auth(client, user_b)
    _seed_model(user_b, "model_B_iso")
    _seed_model(user_a, "model_A_iso")
    _seed_dataset(user_a, "dsAmod01")

    denied_bt = client.post(
        "/runs/backtester/start",
        headers=headers_a,
        json={"model_id": "model_B_iso", "dataset_id": "dsAmod01"},
    )
    assert denied_bt.status_code == 404

    denied_an = client.post(
        "/trainer/analysis/standalone",
        headers=headers_a,
        json={"model_id": "model_B_iso", "dataset_id": "dsAmod01"},
    )
    assert denied_an.status_code == 404

    listed = client.get("/api/models", headers=headers_a)
    assert listed.status_code == 200
    ids = {m.get("model_id") or m.get("id") for m in listed.json()["models"]}
    assert "model_B_iso" not in ids


def test_user_cannot_deploy_other_users_model_via_analysis(client, user_a, user_b):
    """Deploy/use of another user's model_id must 404 (no existence leak)."""
    headers_a = _auth(client, user_a)
    _auth(client, user_b)
    _seed_model(user_b, "model_B_deploy")
    denied = client.get("/models/model_B_deploy/metadata", headers=headers_a)
    assert denied.status_code == 404


def test_bot_listings_and_child_data_are_isolated(client, user_a, user_b):
    headers_a = _auth(client, user_a)
    headers_b = _auth(client, user_b)
    _seed_bot(user_a, "bot-aaa-1", with_trade=True)
    _seed_bot(user_b, "bot-bbb-1", with_trade=True)

    list_a = client.get("/api/bots", headers=headers_a)
    list_b = client.get("/api/bots", headers=headers_b)
    assert list_a.status_code == 200
    assert list_b.status_code == 200
    ids_a = {b["id"] for b in list_a.json()}
    ids_b = {b["id"] for b in list_b.json()}
    assert "bot-aaa-1" in ids_a
    assert "bot-bbb-1" not in ids_a
    assert "bot-bbb-1" in ids_b
    assert "bot-aaa-1" not in ids_b

    assert client.get("/api/bots/bot-bbb-1", headers=headers_a).status_code == 404
    assert client.delete("/api/bots/bot-bbb-1", headers=headers_a).status_code == 404
    assert client.get("/api/bots/bot-aaa-1", headers=headers_a).status_code == 200

    trades_a = client.get("/api/dashboard/trades", headers=headers_a)
    assert trades_a.status_code == 200
    trade_bot_ids = {t.get("bot_id") for t in trades_a.json()}
    assert "bot-bbb-1" not in trade_bot_ids
    assert "bot-aaa-1" in trade_bot_ids

    bundle = client.get("/api/dashboard/bundle", headers=headers_a)
    assert bundle.status_code == 200


def test_traversal_and_injected_user_id_are_rejected(client, user_a, user_b):
    headers_a = _auth(client, user_a)
    _seed_run(user_a, "runA_trav_1")

    trav = client.get(
        "/api/labeling-optimizer/artifacts/runA_trav_1/../../secret",
        headers=headers_a,
    )
    assert trav.status_code in (400, 404)

    me = client.get(f"/api/me?user_id={user_b}", headers=headers_a)
    assert me.status_code == 200
    assert me.json()["user_id"] == str(user_a)

    overview = client.get("/api/review/overview", headers=headers_a)
    assert overview.status_code == 200
    run_ids = {r["id"] for r in overview.json().get("runs") or overview.json().get("recentRuns") or []}
    if run_ids:
        assert "runB_secret_1" not in run_ids
