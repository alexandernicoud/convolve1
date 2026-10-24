from __future__ import annotations

import os
import subprocess
import sys
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import jwt

from app.db import SessionLocal
from app.models import Bot, BotTrade, DeletedAccount, PipelineRun, Profile, UserDataset, UserModel
from app.paths import dataset_dir_for, run_dir_for
from app.services import account as svc
from tests.conftest import AUDIENCE, JWT_SECRET
from tests.test_isolation import _auth, _seed_dataset, _seed_model, _seed_run

BACKEND = Path(__file__).resolve().parents[1]


def _token(user_id: uuid.UUID, *, signed_in_ago_s: float | None = 5) -> dict:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": f"{user_id.hex[:8]}@test.local",
        "aud": AUDIENCE,
        "role": "authenticated",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=1)).timestamp()),
    }
    if signed_in_ago_s is not None:
        payload["amr"] = [{"method": "password", "timestamp": int(time.time() - signed_in_ago_s)}]
    return {"Authorization": f"Bearer {jwt.encode(payload, JWT_SECRET, algorithm='HS256')}"}


def _seed_bot(user_id: uuid.UUID, bot_id: str) -> None:
    db = SessionLocal()
    try:
        db.add(Bot(id=bot_id, user_id=str(user_id), symbol="MSFT", model_path=f"/tmp/{bot_id}.keras"))
        db.add(
            BotTrade(
                bot_id=bot_id,
                entry_date=date(2026, 1, 2),
                entry_price=1.0,
                position_notional=100.0,
                horizon_days=5,
                expiry_date=date(2026, 1, 9),
                status="open",
            )
        )
        db.commit()
    finally:
        db.close()


def _seed_all(user: uuid.UUID, tag: str) -> None:
    _seed_run(user, f"run_{tag}")
    _seed_dataset(user, f"ds_{tag}")
    _seed_model(user, f"model_{tag}")
    _seed_bot(user, f"bot_{tag}")


def test_profile_is_own_and_editable(client, user_a, user_b):
    ha, hb = _auth(client, user_a), _auth(client, user_b)
    r = client.patch("/api/account", json={"display_name": "Ada"}, headers=ha)
    assert r.status_code == 200 and r.json()["display_name"] == "Ada"
    assert client.get("/api/account", headers=hb).json()["display_name"] != "Ada"
    assert client.patch("/api/account", json={"display_name": "  "}, headers=ha).status_code == 422
    assert client.get("/api/account").status_code == 401


def test_export_contains_only_callers_data(client, user_a, user_b):
    ha, _ = _auth(client, user_a), _auth(client, user_b)
    _seed_all(user_a, "exa")
    _seed_all(user_b, "exb")
    body = client.get("/api/account/export", headers=ha).json()
    text = repr(body)
    assert str(user_b) not in text and "exb" not in text
    assert [r["id"] for r in body["research_runs"]] == ["run_exa"]
    assert [b["id"] for b in body["bots"]] == ["bot_exa"]
    assert len(body["bot_trades"]) == 1
    assert all("storage_key" not in m and "path" not in m for m in body["models"])
    assert all("model_path" not in b for b in body["bots"])


def test_delete_requires_phrase_and_recent_sign_in(client, user_a):
    _auth(client, user_a)
    fresh = _token(user_a)
    assert client.request("DELETE", "/api/account", json={"confirm": "yes"}, headers=fresh).status_code == 422
    stale = _token(user_a, signed_in_ago_s=3600)
    assert client.request("DELETE", "/api/account", json={"confirm": "delete my account"}, headers=stale).status_code == 403
    no_amr = _token(user_a, signed_in_ago_s=None)
    assert client.request("DELETE", "/api/account", json={"confirm": "delete my account"}, headers=no_amr).status_code == 403


def test_delete_removes_only_callers_data_and_blocks_token(client, user_a, user_b):
    _auth(client, user_a)
    hb = _auth(client, user_b)
    _seed_all(user_a, "dla")
    _seed_all(user_b, "dlb")
    a_run, a_ds = run_dir_for("run_dla", str(user_a)), dataset_dir_for("ds_dla", str(user_a))
    b_run, b_ds = run_dir_for("run_dlb", str(user_b)), dataset_dir_for("ds_dlb", str(user_b))
    assert a_run.is_dir() and a_ds.is_dir()

    ha = _token(user_a)
    r = client.request("DELETE", "/api/account", json={"confirm": "Delete my account"}, headers=ha)
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True

    db = SessionLocal()
    try:
        assert db.get(Profile, user_a) is None
        assert db.query(PipelineRun).filter(PipelineRun.user_id == user_a).count() == 0
        assert db.query(UserDataset).filter(UserDataset.user_id == user_a).count() == 0
        assert db.query(UserModel).filter(UserModel.user_id == user_a).count() == 0
        assert db.query(Bot).filter(Bot.user_id == str(user_a)).count() == 0
        assert db.query(BotTrade).filter(BotTrade.bot_id == "bot_dla").count() == 0
        assert db.get(Profile, user_b) is not None
        assert db.query(PipelineRun).filter(PipelineRun.user_id == user_b).count() == 1
        assert db.query(Bot).filter(Bot.user_id == str(user_b)).count() == 1
        assert db.query(BotTrade).filter(BotTrade.bot_id == "bot_dlb").count() == 1
    finally:
        db.close()
    assert not a_run.exists() and not a_ds.exists()
    assert b_run.is_dir() and b_ds.is_dir()

    assert client.get("/api/account", headers=ha).status_code == 401
    assert client.get("/api/account", headers=hb).status_code == 200


def test_cloud_deletion_addresses_only_callers_prefixes(monkeypatch, client, user_a):
    _auth(client, user_a)
    _seed_bot(user_a, "bot_cloud")
    db = SessionLocal()
    try:
        db.get(Bot, "bot_cloud").model_path = "gcs://bucket-x/models/bot_cloud.keras"
        db.commit()
    finally:
        db.close()
    monkeypatch.setattr(svc, "APP_PROFILE", "cloud")
    monkeypatch.setattr(svc, "MODEL_BUCKET", "bucket-x")
    seen_prefix, seen_keys = [], []
    result = svc.delete_account(
        str(user_a),
        gcs_prefix_delete=lambda uid: seen_prefix.append(uid) or 3,
        gcs_key_delete=lambda key: seen_keys.append(key) or 1,
    )
    assert result["ok"] is True
    assert seen_prefix == [str(user_a)]
    assert seen_keys == ["models/bot_cloud.keras"]
    assert [p.format(uid=str(user_a)) for p in svc.GCS_PREFIXES] == [
        f"users/{user_a}/",
        f"keras/{user_a}/",
        f"uploads/{user_a}/",
    ]


def test_failed_step_is_reported_and_keeps_login(monkeypatch, client, user_a):
    _auth(client, user_a)
    monkeypatch.setattr(svc, "APP_PROFILE", "cloud")
    monkeypatch.setattr(svc, "MODEL_BUCKET", "bucket-x")

    def boom(_uid):
        raise RuntimeError("bucket unavailable")

    r = svc.delete_account(str(user_a), gcs_prefix_delete=boom, gcs_key_delete=lambda k: 0)
    assert r["ok"] is False
    assert {s["step"]: s["ok"] for s in r["steps"]}["cloud_storage"] is False
    assert "auth_user" not in [s["step"] for s in r["steps"]]
    assert not svc.is_deleted_user(str(user_a))
    db = SessionLocal()
    try:
        assert db.get(DeletedAccount, user_a) is None
    finally:
        db.close()
    assert client.get("/api/account", headers=_token(user_a)).status_code == 200


def test_failed_auth_identity_deletion_restores_sign_in(monkeypatch, client, user_a):
    _auth(client, user_a)

    def auth_down(_uid):
        raise RuntimeError("auth schema unavailable")

    monkeypatch.setattr(svc, "_delete_auth_user", auth_down)
    r = svc.delete_account(str(user_a))
    steps = {s["step"]: s["ok"] for s in r["steps"]}
    assert r["ok"] is False and steps["auth_user"] is False and steps["restore_sign_in"] is True
    assert client.get("/api/account", headers=_token(user_a)).status_code == 200


def test_deleted_account_stays_blocked_after_restart(client, user_a):
    _auth(client, user_a)
    ha = _token(user_a)
    assert client.request("DELETE", "/api/account", json={"confirm": "delete my account"}, headers=ha).json()["ok"]

    svc.forget_deleted_in_memory()  # what a process restart does to the cache
    assert client.get("/api/account", headers=ha).status_code == 401
    assert client.get("/api/me", headers=ha).status_code == 401
    db = SessionLocal()
    try:
        assert db.get(Profile, user_a) is None
        assert db.get(DeletedAccount, user_a) is not None
    finally:
        db.close()


def test_deleted_account_blocked_in_fresh_process(client, user_a):
    """A brand-new interpreter on the same database must still refuse the token."""
    _auth(client, user_a)
    ha = _token(user_a)
    assert client.request("DELETE", "/api/account", json={"confirm": "delete my account"}, headers=ha).json()["ok"]
    code = (
        "import sys\n"
        "from fastapi.testclient import TestClient\n"
        "from app.main import app\n"
        "from app.db import SessionLocal\n"
        "from app.models import Profile\n"
        "import uuid\n"
        "c = TestClient(app)\n"
        f"r = c.get('/api/account', headers={{'Authorization': {ha['Authorization']!r}}})\n"
        "db = SessionLocal()\n"
        f"recreated = db.get(Profile, uuid.UUID({str(user_a)!r})) is not None\n"
        "print(r.status_code, recreated)\n"
    )
    proc = subprocess.run(
        [sys.executable, "-c", code], cwd=BACKEND, env=dict(os.environ), capture_output=True, text=True, timeout=180,
    )
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert proc.stdout.strip().splitlines()[-1] == "401 False"


def test_terms_acceptance_is_stored_server_side(client, user_a, user_b):
    ha, hb = _auth(client, user_a), _auth(client, user_b)
    assert client.get("/api/account", headers=ha).json()["terms"]["accepted_at"] is None
    stale = client.post("/api/account/terms", json={"terms_version": "2000-01-01", "privacy_version": "2000-01-01"}, headers=ha)
    assert stale.status_code == 422
    current = {"terms_version": svc.TERMS_VERSION, "privacy_version": svc.PRIVACY_VERSION}
    terms = client.post("/api/account/terms", json=current, headers=ha).json()["terms"]
    assert terms["terms_version"] == svc.TERMS_VERSION and terms["accepted_at"]
    assert client.get("/api/account", headers=hb).json()["terms"]["accepted_at"] is None
    assert client.post("/api/account/terms", json=current).status_code == 401


def test_terms_versions_match_frontend():
    meta = (BACKEND.parent / "src/features/legal/meta.ts").read_text(encoding="utf-8")
    assert f'TERMS_VERSION = "{svc.TERMS_VERSION}"' in meta
    assert f'PRIVACY_VERSION = "{svc.PRIVACY_VERSION}"' in meta


def test_usage_is_own_and_counts_statuses(client, user_a, user_b):
    ha, hb = _auth(client, user_a), _auth(client, user_b)
    _seed_run(user_a, "run_usage_ok")
    _seed_run(user_b, "run_usage_other")
    db = SessionLocal()
    try:
        db.add(PipelineRun(id="run_usage_bad", user_id=user_a, tool="trainer", status="failed", error_summary="x"))
        db.commit()
    finally:
        db.close()
    body = client.get("/api/account/usage", headers=ha).json()
    assert body["totals"]["runs"] == 2 and body["totals"]["failed"] == 1 and body["totals"]["succeeded"] == 1
    assert {r["id"] for r in body["recent"]} == {"run_usage_ok", "run_usage_bad"}
    assert sum(w["runs"] for w in body["weekly"]) == 2
    assert "run_usage_other" not in repr(body)
    assert client.get("/api/account/usage", headers=hb).json()["totals"]["runs"] == 1
    assert client.get("/api/account/usage").status_code == 401
