from __future__ import annotations

import threading
import uuid

import pytest
from fastapi import HTTPException

from app import config
from app.db import SessionLocal
from app.main import all_runs, register_run
from app.models import CreditAccount, CreditLedgerEntry, PipelineRun
from app.ownership import update_pipeline_run_state
from app.plans import PLANS, run_cost
from app.services import credits
from tests.test_isolation import _auth

COST = run_cost("trainer")


@pytest.fixture
def enforce(monkeypatch):
    monkeypatch.setattr(config, "CREDITS_MODE", "enforce")


def _balance(user: uuid.UUID) -> int:
    db = SessionLocal()
    try:
        acct = db.get(CreditAccount, user)
        return acct.balance if acct else 0
    finally:
        db.close()


def _ledger(user: uuid.UUID) -> list[tuple[str, int]]:
    db = SessionLocal()
    try:
        rows = db.query(CreditLedgerEntry).filter(CreditLedgerEntry.user_id == user).order_by(CreditLedgerEntry.created_at)
        return [(r.reason, r.delta) for r in rows]
    finally:
        db.close()


def _run(user: uuid.UUID, tool: str = "trainer", status: str = "running") -> str:
    run_id = f"cr_{uuid.uuid4().hex[:12]}"
    register_run(run_id, tool, f"/x/{run_id}", user_id=str(user), status=status)
    return run_id


def test_plans_are_public_and_paid_terms_are_not_invented(client):
    body = client.get("/api/plans").json()
    assert body["billing_available"] is False
    by_id = {p["id"]: p for p in body["plans"]}
    assert by_id["free"]["price"]["amount"] == 0
    for pid in ("individual", "advanced", "professional"):
        assert by_id[pid]["price"] is None and by_id[pid]["credits"] is None
    assert {c["tool"] for c in body["run_costs"]} >= {"trainer", "backtester"}
    assert len(PLANS) == 4


def test_off_mode_never_charges(monkeypatch, client, user_a):
    monkeypatch.setattr(config, "CREDITS_MODE", "off")
    h = _auth(client, user_a)
    _run(user_a)
    assert _ledger(user_a) == []
    body = client.get("/api/credits", headers=h).json()
    assert body["mode"] == "off" and body["balance"] == 0
    assert client.get("/api/credits/quote?tool=trainer", headers=h).json()["sufficient"] is True


def test_initial_grant_once_and_charge(enforce, client, user_a):
    h = _auth(client, user_a)
    assert client.get("/api/credits", headers=h).json()["balance"] == 50
    assert client.get("/api/credits", headers=h).json()["balance"] == 50
    run_id = _run(user_a)
    assert _balance(user_a) == 50 - COST
    register_run(run_id, "trainer", "/x", user_id=str(user_a))  # same run again: not charged twice
    assert _ledger(user_a) == [("grant", 50), ("charge", -COST)]
    body = client.get("/api/credits", headers=h).json()
    assert body["totals"] == {"allocated": 50, "consumed": COST, "charged": COST, "refunded": 0}
    assert body["by_tool"][0]["tool"] == "trainer" and body["by_tool"][0]["runs"] == 1
    assert sum(d["credits"] for d in body["daily"]) == COST


def test_insufficient_credits_refuses_before_any_state(enforce, client, user_a):
    _auth(client, user_a)
    credits.ensure_allocations(user_a)
    credits.adjust(user_a, -(50 - COST + 1), "test", f"adj:{user_a}")
    run_id = f"cr_{uuid.uuid4().hex[:12]}"
    with pytest.raises(HTTPException) as exc:
        register_run(run_id, "trainer", "/x", user_id=str(user_a))
    assert exc.value.status_code == 402
    assert exc.value.detail["code"] == "insufficient_credits" and exc.value.detail["plans_url"] == "/pricing"
    assert run_id not in all_runs
    db = SessionLocal()
    try:
        assert db.get(PipelineRun, run_id) is None
    finally:
        db.close()
    assert _balance(user_a) == COST - 1


def test_launch_endpoint_returns_402(enforce, client, user_a):
    h = _auth(client, user_a)
    credits.ensure_allocations(user_a)
    credits.adjust(user_a, -50, "test", f"adj0:{user_a}")
    r = client.post(
        "/api/labeling-optimizer/run", json={"symbol": "MSFT", "start": "2024-01-01", "end": "2024-06-01"}, headers=h,
    )
    assert r.status_code == 402
    assert r.json()["detail"]["code"] == "insufficient_credits"


def test_concurrent_launches_cannot_overspend(enforce, client, user_a):
    _auth(client, user_a)
    credits.ensure_allocations(user_a)
    results: list[int] = []
    lock = threading.Lock()

    def launch():
        try:
            _run(user_a)
            code = 200
        except HTTPException as exc:
            code = exc.status_code
        with lock:
            results.append(code)

    threads = [threading.Thread(target=launch) for _ in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count(200) == 50 // COST
    assert results.count(402) == 12 - 50 // COST
    assert _balance(user_a) == 50 % COST


def test_refund_policy_and_idempotency(enforce, client, user_a):
    _auth(client, user_a)
    failed, cancelled_running, cancelled_queued, ok = _run(user_a), _run(user_a), _run(user_a, status="queued"), _run(user_a)
    assert _balance(user_a) == 50 - 4 * COST

    update_pipeline_run_state(failed, status="failed", message="boom")
    update_pipeline_run_state(failed, status="failed", message="boom again")
    update_pipeline_run_state(cancelled_running, status="cancelled")
    update_pipeline_run_state(cancelled_queued, status="cancelled")
    update_pipeline_run_state(ok, status="succeeded")
    assert credits.refund_run(failed, "retry") is False
    assert credits.sweep_refunds() == 0
    assert _balance(user_a) == 50 - 2 * COST
    assert [r for r in _ledger(user_a) if r[0] == "refund"] == [("refund", COST), ("refund", COST)]


def test_refund_survives_crash_via_sweep(enforce, client, user_a):
    _auth(client, user_a)
    run_id = _run(user_a)
    db = SessionLocal()
    try:  # status written without the hook, as if the process died right after
        db.get(PipelineRun, run_id).status = "interrupted"
        db.commit()
    finally:
        db.close()
    assert _balance(user_a) == 50 - COST
    assert credits.sweep_refunds() >= 1
    assert credits.sweep_refunds() == 0
    assert _balance(user_a) == 50


def test_credit_history_is_isolated(enforce, client, user_a, user_b):
    ha, hb = _auth(client, user_a), _auth(client, user_b)
    run_id = _run(user_a)
    a = client.get("/api/credits", headers=ha).json()
    b = client.get("/api/credits", headers=hb).json()
    assert any(t["run_id"] == run_id for t in a["transactions"])
    assert run_id not in repr(b) and b["balance"] == 50
    assert client.get("/api/credits").status_code == 401


def test_client_cannot_set_price(enforce, client, user_a):
    h = _auth(client, user_a)
    q = client.get("/api/credits/quote?tool=trainer&cost=0", headers=h).json()
    assert q["cost"] == COST and q["balance"] == 50
    assert client.get("/api/credits/quote?tool=not-a-tool", headers=h).json()["cost"] == 0


def test_monthly_allocation_once_per_period(monkeypatch, enforce, client, user_a):
    from datetime import datetime, timezone

    _auth(client, user_a)
    monkeypatch.setattr(credits, "plan_state", lambda db, uid: {"credits": {"amount": 100, "cadence": "monthly"}})
    oct_ = datetime(2026, 10, 3, tzinfo=timezone.utc)
    credits.ensure_allocations(user_a, now=oct_)
    credits.ensure_allocations(user_a, now=oct_)
    credits.ensure_allocations(user_a, now=datetime(2026, 11, 1, tzinfo=timezone.utc))
    assert _ledger(user_a) == [("allocation", 100), ("allocation", 100)]


def test_negative_adjustment_cannot_go_below_zero(enforce, client, user_a):
    _auth(client, user_a)
    with pytest.raises(ValueError):
        credits.adjust(user_a, -1, "too much", f"neg:{user_a}")
    assert credits.adjust(user_a, 5, "support credit", f"pos:{user_a}") == {"applied": True, "balance": 5}
    assert credits.adjust(user_a, 5, "support credit", f"pos:{user_a}") == {"applied": False}
