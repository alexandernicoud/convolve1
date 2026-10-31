"""Subscriptions, top-ups, entitlements, quotas, cancellation and cash refunds (sandbox simulator only)."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from fractions import Fraction

import pytest
from fastapi import HTTPException

from app import config
from app.billing import (
    BillingConflict, CountryRestricted, FeatureLocked, QuotaExceeded, SubscriptionRequired,
    catalog, entitlements, lots, money, providers, service,
)
from app.db import SessionLocal
from app.main import register_run
from app.models import (
    BillingPayment, BillingRefund, Bot, CreditAccount, CreditLedgerEntry, CreditLot, PipelineRun, UserPlan,
)
from app.ownership import update_pipeline_run_state
from app.services import credits
from tests.test_isolation import _auth

SIM = providers.SimulatorProvider


@pytest.fixture
def billing(monkeypatch):
    monkeypatch.setattr(config, "BILLING_MODE", "sandbox")
    monkeypatch.setattr(config, "BILLING_PROVIDER", "simulator")
    monkeypatch.setattr(config, "BILLING_CATALOG_OVERRIDES", "")
    monkeypatch.setattr(config, "BILLING_BLOCKED_COUNTRIES", frozenset({"US"}))
    monkeypatch.setattr(config, "CREDITS_MODE", "off")
    SIM.reset()
    yield
    SIM.reset()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def subscribe(user: uuid.UUID, tier: str = "starter", country: str = "CH") -> None:
    out = service.checkout(user, email=None, kind="subscription", item_id=tier, country=country)
    service.complete_simulated_checkout(user, out["session_id"])


def buy(user: uuid.UUID, pack: str = "research_pack", country: str = "CH", waived: bool = False) -> None:
    out = service.checkout(user, email=None, kind="topup", item_id=pack, country=country, withdrawal_waived=waived,
                           request_key=uuid.uuid4().hex)
    service.complete_simulated_checkout(user, out["session_id"])


def _buckets(user: uuid.UUID, now: datetime | None = None) -> dict:
    db = SessionLocal()
    try:
        return lots.breakdown(db, user, now)
    finally:
        db.close()


def _ledger(user: uuid.UUID) -> list[tuple[str, int]]:
    db = SessionLocal()
    try:
        rows = db.query(CreditLedgerEntry).filter(CreditLedgerEntry.user_id == user).order_by(CreditLedgerEntry.created_at)
        return [(r.reason, r.delta) for r in rows]
    finally:
        db.close()


def _run(user: uuid.UUID, tool: str = "trainer", status: str = "running", params: dict | None = None, price=None) -> str:
    run_id = f"bl_{uuid.uuid4().hex[:12]}"
    register_run(run_id, tool, f"/x/{run_id}", user_id=str(user), status=status, params=params, price=price)
    return run_id


def _charge(user: uuid.UUID, cost: int, status: str = "running") -> str:
    """A charged run of exactly ``cost`` credits (bypasses tier limits; tests the ledger only)."""
    run_id = f"bl_{uuid.uuid4().hex[:12]}"
    db = SessionLocal()
    try:
        credits.charge_for_run(db, user, run_id, "trainer", cost=cost)
        db.add(PipelineRun(id=run_id, user_id=user, tool="trainer", status=status))
        db.commit()
    finally:
        db.close()
    return run_id


def _refused(fn, *args, **kwargs) -> dict:
    with pytest.raises(HTTPException) as exc:
        fn(*args, **kwargs)
    return {"status": exc.value.status_code, **exc.value.detail}


def _purchase_lot(user: uuid.UUID) -> CreditLot:
    db = SessionLocal()
    try:
        return db.query(CreditLot).filter(CreditLot.user_id == user, CreditLot.kind == "purchase").one()
    finally:
        db.close()


# --------------------------------------------------------------------------- catalogue and modes


def test_off_mode_changes_nothing(monkeypatch, client, user_a):
    monkeypatch.setattr(config, "BILLING_MODE", "off")
    monkeypatch.setattr(config, "CREDITS_MODE", "off")
    _run(user_a)
    assert _ledger(user_a) == []
    body = client.get("/api/billing/catalog").json()
    assert body["mode"] == "off"
    h = _auth(client, user_a)
    r = client.post("/api/billing/checkout", json={"kind": "subscription", "item_id": "starter", "country": "CH"}, headers=h)
    assert r.status_code == 503


def test_live_mode_requires_explicit_approval():
    import importlib
    import os

    os.environ["BILLING_MODE"] = "live"
    os.environ.pop("BILLING_LIVE_APPROVED", None)
    try:
        importlib.reload(config)
        assert config.BILLING_MODE == "off"
    finally:
        os.environ.pop("BILLING_MODE", None)
        importlib.reload(config)


def test_catalog_defaults_and_overrides():
    cat = catalog.load("")
    starter, research = catalog.tier("starter", cat), catalog.tier("research", cat)
    assert starter["price"]["amount_minor"] == 499 and starter["monthly_credits"] == 15
    assert starter["quotas"] == {"backtests_per_period": 3, "active_deployments": 1}
    assert research["quotas"] == {"backtests_per_period": 30, "active_deployments": 3}
    assert (research["price"]["amount_minor"], research["monthly_credits"]) == (2900, 150)
    professional = catalog.tier("professional", cat)
    assert (professional["price"]["amount_minor"], professional["monthly_credits"]) == (9900, 1200)
    assert professional["quotas"] == {"backtests_per_period": 100, "active_deployments": 10}
    assert all(t["price"]["approved"] for t in cat["tiers"]) and all(p["price"]["approved"] for p in cat["packs"])
    assert [t["id"] for t in catalog.public(cat)["tiers"]] == ["starter", "research", "professional"]
    assert [(p["credits"], p["price"]["amount_minor"]) for p in cat["packs"]] == [(100, 900), (400, 2900), (1500, 8900)]
    over = catalog.load(json.dumps({
        "tiers": [{"id": "research", "price": {"amount_minor": 3500}},
                  {"id": "professional", "availability": "hidden"}],
        "packs": [{"id": "extra", "credits": 120}],
    }))
    assert catalog.tier("research", over)["price"]["amount_minor"] == 3500
    assert catalog.tier("research", over)["monthly_credits"] == 150
    assert catalog.tier("professional", over)["monthly_credits"] == 1200
    assert catalog.pack("extra", over)["credits"] == 120
    assert "professional" not in {t["id"] for t in catalog.public(over)["tiers"]}
    assert catalog.load("{not json")["tiers"][0]["id"] == "starter"


# --------------------------------------------------------------------------- paid-only access


def test_no_subscription_means_read_only(billing, client, user_a):
    h = _auth(client, user_a)
    d = _refused(_run, user_a)
    assert d["status"] == 403 and d["code"] == "subscription_required"
    assert client.post("/api/uploads", json={"kind": "model", "filename": "m.keras", "size": 10}, headers=h).status_code == 403
    r = client.post("/api/lab/explain", json={"model_kind": "trained", "model_id": "x"}, headers=h)
    assert r.status_code in (403, 422)
    q = client.post("/api/credits/quote", json={"tool": "trainer", "params": {}}, headers=h).json()
    assert q["blocked"]["code"] == "subscription_required"
    assert _ledger(user_a) == []


def test_anonymous_runs_are_refused_while_billing_is_on(billing):
    d = _refused(_run, "not-a-uuid")
    assert d["code"] == "subscription_required"


def test_starter_entitlements(billing, client, user_a):
    subscribe(user_a, "starter")
    assert _buckets(user_a)["subscription"] == 15
    _run(user_a, params={"architecture": "convolve-cnn-compact-v1"})
    d = _refused(_run, user_a, params={"architecture": "convolve-resnet18-v1"})
    assert d["code"] == "feature_locked" and d["required_tier"] == "research"
    d = _refused(_run, user_a, params={"optimizer": {"name": "adamw"}})
    assert d["code"] == "feature_locked" and d["feature"] == "trainer.advanced"
    d = _refused(_run, user_a, params={"transfer": {"weights": "imagenet"}})
    assert d["feature"] == "trainer.transfer"
    from app import pricing

    d = _refused(_run, user_a, "training-chart-generator",
                 price=pricing.quote("training-chart-generator", {"symbols": "AAPL", "charts_per_label": 5000}))
    assert d["code"] == "feature_locked" and d["required_tier"] == "research"
    d = _refused(_run, user_a, "labeling-optimizer", params={"start": "2010-01-01", "end": "2024-01-01"},
                 price=pricing.quote("labeling-optimizer", {"start": "2010-01-01", "end": "2024-01-01"}))
    assert d["feature"] == "optimizer_max_history_days"
    h = _auth(client, user_a)
    assert client.post("/api/uploads", json={"kind": "model", "filename": "m.keras", "size": 10}, headers=h).status_code != 403
    with pytest.raises(FeatureLocked):
        service.require(user_a, "lab.advanced")
    service.require(user_a, "lab.basic")


def test_starter_minimal_workflow_fits_the_allowance():
    """generate -> train -> analyse -> test set -> backtest on the smallest useful settings."""
    from app import pricing

    steps = [
        pricing.quote("training-chart-generator", {"symbols": "AAPL", "charts_per_label": 150}),
        pricing.quote("trainer", {"dataset_images": 300}),
        pricing.quote("analysis"),
        pricing.quote("testdata", {"symbols": "AAPL", "period_length_units": 60}),
        pricing.quote("backtester", {"dataset_images": 60}),
    ]
    total = sum(q.credits for q in steps)
    assert total <= catalog.tier("starter", catalog.load(""))["monthly_credits"]


def test_research_unlocks_advanced(billing, user_a):
    subscribe(user_a, "research")
    assert _buckets(user_a)["subscription"] == 150
    _run(user_a, params={"architecture": "convolve-resnet18-v1", "optimizer": {"name": "adamw"}})
    service.require(user_a, "lab.advanced")


def test_professional_entitlements(billing, user_a):
    subscribe(user_a, "professional")
    st = service.state(user_a)
    assert st["subscription"]["tier_id"] == "professional" and st["balances"]["subscription"] == 1200
    _run(user_a, params={"architecture": "convolve-resnet18-v1", "transfer": {"weights": "imagenet"}})
    service.require(user_a, "lab.advanced")
    for _ in range(30):
        _run(user_a, "backtester")
    _run(user_a, "backtester")  # past Research's 30
    db = SessionLocal()
    try:
        for i in range(9):
            db.add(Bot(id=str(uuid.uuid4()), user_id=str(user_a), name=f"p{i}", symbol="AAPL", model_path="x",
                       lifecycle_state="active", is_active=True, tp_pct=1, sl_pct=1, run_time="09:00"))
        db.commit()
        service.check_deployment(db, user_a)
        db.add(Bot(id=str(uuid.uuid4()), user_id=str(user_a), name="p9", symbol="AAPL", model_path="x",
                   lifecycle_state="active", is_active=True, tp_pct=1, sl_pct=1, run_time="09:00"))
        db.commit()
        with pytest.raises(QuotaExceeded):
            service.check_deployment(db, user_a)
    finally:
        db.close()


def test_upgrade_to_professional_adds_the_difference(billing, user_a):
    subscribe(user_a, "research")
    out = service.change_plan(user_a, "professional")
    assert out["change"] == "upgrade" and out["credits_added"] == 1050
    assert _buckets(user_a)["subscription"] == 1200


def test_cancelling_a_pending_downgrade_restores_the_plan(billing, user_a):
    subscribe(user_a, "research")
    assert service.change_plan(user_a, "starter")["change"] == "downgrade"
    assert service.change_plan(user_a, "research")["change"] == "none"
    st = service.state(user_a)["subscription"]
    assert st["tier_id"] == "research" and st["pending_tier_id"] is None


# --------------------------------------------------------------------------- top-ups and balances


def test_topups_need_a_subscription_and_never_unlock_features(billing, user_a):
    with pytest.raises(SubscriptionRequired):
        service.checkout(user_a, email=None, kind="topup", item_id="extra", country="CH")
    subscribe(user_a, "starter")
    buy(user_a, "lab_pack")
    b = _buckets(user_a)
    assert (b["subscription"], b["purchase"], b["total"]) == (15, 1500, 1515)
    d = _refused(_run, user_a, params={"architecture": "convolve-resnet18-v1"})
    assert d["code"] == "feature_locked"


def test_monthly_credits_are_consumed_first_and_refunds_return_to_the_same_lots(billing, user_a):
    subscribe(user_a, "starter")
    buy(user_a, "extra")
    run_id = _charge(user_a, 40)
    b = _buckets(user_a)
    assert b["subscription"] == 0 and b["purchase"] == 75
    update_pipeline_run_state(run_id, status="failed")
    b = _buckets(user_a)
    assert (b["subscription"], b["purchase"]) == (15, 100)


def test_purchased_credits_carry_over_and_monthly_credits_expire(billing, user_a):
    subscribe(user_a, "starter")
    buy(user_a, "extra")
    service.set_cancel(user_a, True)
    end = datetime.fromisoformat(service.state(user_a)["subscription"]["period_end"])
    later = end + timedelta(days=1)
    st = service.state(user_a, later)
    assert st["subscription"]["active"] is False and st["subscription"]["read_only"] is True
    b = st["balances"]
    assert (b["subscription"], b["purchase"], b["total"]) == (0, 100, 100)
    assert ("expiry", -15) in _ledger(user_a)


def test_simulated_renewal_grants_a_new_period(billing, user_a):
    subscribe(user_a, "starter")
    end = datetime.fromisoformat(service.state(user_a)["subscription"]["period_end"])
    st = service.state(user_a, end + timedelta(hours=1))
    assert st["subscription"]["active"] and st["balances"]["subscription"] == 15
    assert datetime.fromisoformat(st["subscription"]["period_end"]) > end
    assert [r for r in _ledger(user_a) if r[0] == "subscription"] == [("subscription", 15), ("subscription", 15)]


def test_upgrade_is_immediate_and_downgrade_waits_for_renewal(billing, user_a):
    subscribe(user_a, "starter")
    out = service.change_plan(user_a, "research")
    assert out["change"] == "upgrade" and out["credits_added"] == 135
    assert _buckets(user_a)["subscription"] == 150
    service.require(user_a, "lab.advanced")
    out = service.change_plan(user_a, "starter")
    assert out["change"] == "downgrade"
    st = service.state(user_a)
    assert st["subscription"]["tier_id"] == "research" and st["subscription"]["pending_tier_id"] == "starter"
    end = datetime.fromisoformat(st["subscription"]["period_end"])
    st = service.state(user_a, end + timedelta(hours=1))
    assert st["subscription"]["tier_id"] == "starter" and st["subscription"]["pending_tier_id"] is None


# --------------------------------------------------------------------------- quotas


def test_backtest_quota_counts_only_completed_backtests(billing, user_a):
    subscribe(user_a, "starter")
    buy(user_a, "extra")
    first = _run(user_a, "backtester")
    _run(user_a, "backtester")
    _run(user_a, "backtester")
    d = _refused(_run, user_a, "backtester")
    assert d["status"] == 409 and d["code"] == "quota_exceeded" and d["limit"] == 3 and d["upgrade_tier"] == "research"
    update_pipeline_run_state(first, status="failed")
    _run(user_a, "backtester")


def test_deployment_limit(billing, user_a):
    subscribe(user_a, "starter")
    db = SessionLocal()
    try:
        db.add(Bot(id=str(uuid.uuid4()), user_id=str(user_a), name="t", symbol="AAPL", model_path="x",
                   lifecycle_state="active", is_active=True, tp_pct=1, sl_pct=1, run_time="09:00"))
        db.commit()
        with pytest.raises(QuotaExceeded):
            service.check_deployment(db, user_a)
        db.rollback()
        paused = db.query(Bot).filter(Bot.user_id == str(user_a)).one()
        service.check_deployment(db, user_a, exclude_bot_id=paused.id)
    finally:
        db.close()


def test_scheduled_bots_of_unsubscribed_owners_are_skipped_not_deleted(billing, user_a, user_b):
    subscribe(user_a, "starter")
    db = SessionLocal()
    try:
        assert entitlements.owners_without_access(db, [str(user_a), str(user_b)]) == {str(user_b)}
    finally:
        db.close()


# --------------------------------------------------------------------------- cancellation and refunds


def test_cancel_keeps_access_until_period_end(billing, client, user_a):
    subscribe(user_a, "starter")
    h = _auth(client, user_a)
    r = client.post("/api/billing/cancel", json={"cancel": True}, headers=h)
    assert r.status_code == 200 and r.json()["cancel_at_period_end"] is True
    st = client.get("/api/billing/state", headers=h).json()["subscription"]
    assert st["active"] and st["status"] == "canceled"
    _run(user_a)
    r = client.post("/api/billing/cancel", json={"cancel": False}, headers=h)
    assert client.get("/api/billing/state", headers=h).json()["subscription"]["status"] == "active"


def test_fifty_percent_example_and_cancel_and_refund(billing, client, user_a):
    subscribe(user_a, "starter")
    buy(user_a, "research_pack")
    _charge(user_a, 115, status="succeeded")  # all 15 monthly credits + 100 from the pack
    assert _buckets(user_a)["purchase"] == 300
    h = _auth(client, user_a)
    quote = client.get("/api/billing/refund-quote", headers=h).json()
    line = quote["lots"][0]
    assert (line["credits_unused"], line["unused_value_minor"], line["rate_bps"], line["refund_minor"]) == (300, 2175, 5000, 1088)
    assert line["retained_minor"] == 1087 and line["basis"] == "voluntary"
    r = client.post("/api/billing/cancel-and-refund", json={"request_id": "req-0001-abc", "expected": {"USD": 1088}}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert [x["status"] for x in body["refunds"]] == ["succeeded"] and body["renewal_stopped"]
    st = client.get("/api/billing/state", headers=h).json()
    assert st["balances"]["purchase"] == 0 and st["subscription"]["active"] and st["subscription"]["cancel_at_period_end"]
    hist = client.get("/api/billing/history", headers=h).json()
    pay = next(p for p in hist["payments"] if p["kind"] == "topup")
    assert pay["refunded_minor"] == 1088 and pay["status"] == "partially_refunded"
    assert hist["refunds"][0]["status"] == "succeeded"
    assert ("credit_refund", -300) in _ledger(user_a)


def test_refund_uses_the_discounted_amount_paid_per_pack(billing, user_a):
    subscribe(user_a, "starter")
    db = SessionLocal()
    try:  # a Research Pack bought with a 50 % discount code: Stripe reports the amount actually charged
        assert service.apply_event(db, {
            "type": "payment_succeeded", "event_id": "evt_disc_1", "user_id": str(user_a), "kind": "topup",
            "item_id": "research_pack", "payment_ref": "pi_disc_1", "amount_minor": 1450, "currency": "USD", "country": "CH",
        }, "simulator") == "credits_added"
        db.commit()
    finally:
        db.close()
    buy(user_a, "extra")
    _charge(user_a, 115, status="succeeded")  # 15 monthly, then 100 from the oldest pack
    quote = service.refund_quote(user_a)
    lines = sorted((l["item_id"], l["credits_unused"], l["amount_paid_minor"], l["refund_minor"]) for l in quote["lots"])
    assert lines == [("extra", 100, 900, 450), ("research_pack", 300, 1450, 544)]
    assert quote["totals"][0]["refund_minor"] == 994
    out = service.cancel_and_refund(user_a, request_id="req-disc-0001", expected={"USD": 994})
    assert sorted(r["amount_minor"] for r in out["refunds"]) == [450, 544]
    assert _buckets(user_a)["purchase"] == 0


def test_refund_is_idempotent_and_never_doubles(billing, user_a):
    subscribe(user_a, "starter")
    buy(user_a, "extra")
    a = service.cancel_and_refund(user_a, request_id="req-same-0001")
    b = service.cancel_and_refund(user_a, request_id="req-same-0001")
    c = service.cancel_and_refund(user_a, request_id="req-other-0002")
    assert len(a["refunds"]) == 1 and b["replayed"] and b["refunds"][0]["id"] == a["refunds"][0]["id"]
    assert c["refunds"] == []
    assert len(SIM.state.refund_calls) == 1
    db = SessionLocal()
    try:
        assert db.query(BillingRefund).filter(BillingRefund.user_id == user_a).count() == 1
    finally:
        db.close()


def test_changed_amount_refuses_instead_of_surprising(billing, user_a):
    subscribe(user_a, "starter")
    buy(user_a, "extra")
    with pytest.raises(BillingConflict):
        service.cancel_and_refund(user_a, request_id="req-mismatch-1", expected={"USD": 1})
    assert _buckets(user_a)["purchase"] == 100


def test_credits_reserved_by_active_jobs_are_never_refunded(billing, user_a):
    subscribe(user_a, "starter")
    buy(user_a, "extra")
    run_id = _charge(user_a, 35, status="running")
    reserved_from_pack = 20
    q = service.refund_quote(user_a)
    assert q["lots"][0]["credits_unused"] == 100 - reserved_from_pack and q["reserved_credits"] == 35
    service.cancel_and_refund(user_a, request_id="req-reserved-1")
    lot = _purchase_lot(user_a)
    assert lot.credits_remaining == 0 and lot.credits_refunded == 100 - reserved_from_pack
    update_pipeline_run_state(run_id, status="failed")
    lot = _purchase_lot(user_a)
    assert lot.credits_remaining == reserved_from_pack
    assert lot.credits_remaining + lot.credits_refunded == lot.credits_total
    assert service.refund_quote(user_a)["lots"][0]["refund_minor"] > 0


def test_transient_provider_failure_is_retried_with_the_same_key(billing, user_a):
    subscribe(user_a, "starter")
    buy(user_a, "extra")
    SIM.state.fail_next = ["retryable"]
    out = service.cancel_and_refund(user_a, request_id="req-retry-0001")
    assert out["refunds"][0]["status"] == "pending"
    assert _buckets(user_a)["purchase"] == 0
    assert service.reconcile() == {"succeeded": 1}
    keys = {c["idempotency_key"] for c in SIM.state.refund_calls}
    assert len(SIM.state.refund_calls) == 2 and len(keys) == 1
    assert service.history(user_a)["refunds"][0]["status"] == "succeeded"


def test_provider_pending_then_settled(billing, user_a):
    subscribe(user_a, "starter")
    buy(user_a, "extra")
    SIM.state.fail_next = ["pending"]
    out = service.cancel_and_refund(user_a, request_id="req-pend-0001")
    assert out["refunds"][0]["status"] == "pending"
    ref_id = next(iter(SIM.state.refunds.values())).provider_refund_id
    SIM().settle(ref_id)
    service.reconcile()
    assert service.history(user_a)["refunds"][0]["status"] == "succeeded"


def test_permanent_refund_failure_restores_credits(billing, user_a):
    subscribe(user_a, "starter")
    buy(user_a, "extra")
    SIM.state.fail_next = ["permanent"]
    out = service.cancel_and_refund(user_a, request_id="req-fail-0001")
    assert out["refunds"][0]["status"] == "failed"
    assert _buckets(user_a)["purchase"] == 100
    assert ("credit_refund_reversal", 100) in _ledger(user_a)
    db = SessionLocal()
    try:
        pay = db.query(BillingPayment).filter(BillingPayment.user_id == user_a, BillingPayment.kind == "topup").one()
        assert pay.refunded_minor == 0
    finally:
        db.close()
    again = service.cancel_and_refund(user_a, request_id="req-fail-0002")
    assert again["refunds"][0]["status"] == "succeeded"


def test_statutory_withdrawal_overrides_the_deduction(billing, user_a, user_b):
    subscribe(user_a, "starter", country="DE")
    buy(user_a, "research_pack", country="DE")
    q = service.refund_quote(user_a)["lots"][0]
    assert (q["basis"], q["rate_bps"], q["refund_minor"]) == ("statutory_withdrawal", 10000, 2900)
    later = service.refund_quote(user_a, _now() + timedelta(days=15))["lots"][0]
    assert (later["basis"], later["refund_minor"]) == ("voluntary", 1450)

    subscribe(user_b, "starter", country="DE")
    buy(user_b, "research_pack", country="DE", waived=True)
    assert service.refund_quote(user_b)["lots"][0]["basis"] == "voluntary"


def test_full_refund_override_and_country_list(billing, monkeypatch, user_a):
    subscribe(user_a, "starter")
    buy(user_a, "extra")
    db = SessionLocal()
    try:
        lot = db.query(CreditLot).filter(CreditLot.user_id == user_a, CreditLot.kind == "purchase").one()
        lot.statutory_override = "full"
        db.commit()
    finally:
        db.close()
    q = service.refund_quote(user_a)["lots"][0]
    assert (q["basis"], q["refund_minor"]) == ("statutory_override", 900)


def test_partial_payment_refund_is_capped(billing, user_a):
    subscribe(user_a, "starter")
    buy(user_a, "research_pack")
    db = SessionLocal()
    try:
        pay = db.query(BillingPayment).filter(BillingPayment.user_id == user_a, BillingPayment.kind == "topup").one()
        pay.refunded_minor = 2000  # refunded earlier outside this flow (e.g. support)
        db.commit()
    finally:
        db.close()
    q = service.refund_quote(user_a)["lots"][0]
    assert q["refund_minor"] == 900 and q["capped"] is True


def test_refund_arithmetic_and_currency_rounding():
    assert money.refund_minor(2900, 400, 300, 7000) == 1523  # 1522.5 -> half up
    assert money.round_half_up(Fraction(5, 2)) == 3 and money.round_half_up(Fraction(49, 20)) == 2
    assert money.refund_minor(1000, 3, 1, 7000) == 233  # 233.33 -> 233
    assert money.refund_minor(1500, 1500, 1, 7000) == 1  # 0.7 -> 1
    assert money.refund_minor(2900, 400, 300, 7000, cap_minor=1000) == 1000
    assert catalog.currency_exponent("JPY") == 0 and catalog.currency_exponent("KWD") == 3
    assert money.format_minor(1523, "USD") == "15.23 USD" and money.format_minor(1523, "JPY") == "1523 JPY"
    assert money.format_minor(1523, "KWD") == "1.523 KWD"


def test_multiple_currencies_are_totalled_separately(billing, user_a, monkeypatch):
    subscribe(user_a, "starter")
    buy(user_a, "extra")
    monkeypatch.setattr(config, "BILLING_CATALOG_OVERRIDES", json.dumps(
        {"packs": [{"id": "extra", "price": {"amount_minor": 1300, "currency": "JPY"}}]}))
    buy(user_a, "extra")
    totals = {t["currency"]: t["refund_minor"] for t in service.refund_quote(user_a)["totals"]}
    assert totals == {"USD": 450, "JPY": 650}


# --------------------------------------------------------------------------- failures, disputes, countries


def test_failed_renewal_payment_marks_past_due(billing, user_a):
    subscribe(user_a, "starter")
    db = SessionLocal()
    try:
        row = db.get(UserPlan, user_a)
        service.apply_event(db, {"type": "payment_failed", "event_id": "evt_fail_1",
                                 "subscription_ref": row.provider_subscription_id}, "simulator")
        db.commit()
    finally:
        db.close()
    st = service.state(user_a)["subscription"]
    assert st["status"] == "past_due" and st["active"]  # until the paid period ends


def test_unpaid_renewal_does_not_extend_access(billing, user_a):
    subscribe(user_a, "starter")
    db = SessionLocal()
    try:
        row = db.get(UserPlan, user_a)
        paid_until = _aware_dt(row.current_period_end)
        ref = row.provider_subscription_id
        for i, status in enumerate(("active", "past_due")):  # the provider rolls the period over, then collection fails
            service.apply_event(db, {"type": "subscription_updated", "event_id": f"evt_roll_{i}", "subscription_ref": ref,
                                     "status": status, "period_start": paid_until,
                                     "period_end": paid_until + timedelta(days=31)}, "simulator")
        service.apply_event(db, {"type": "payment_failed", "event_id": "evt_roll_fail", "subscription_ref": ref}, "simulator")
        db.commit()
    finally:
        db.close()
    st = service.state(user_a, paid_until - timedelta(hours=1))["subscription"]
    assert st["status"] == "past_due" and st["active"]
    assert datetime.fromisoformat(st["period_end"]) == paid_until
    db = SessionLocal()
    try:
        assert entitlements.state(db, user_a, paid_until + timedelta(hours=1))["active"] is False
    finally:
        db.close()


def _aware_dt(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def test_chargeback_withdraws_credits_and_blocks_refunds(billing, user_a):
    subscribe(user_a, "starter")
    buy(user_a, "extra")
    db = SessionLocal()
    try:
        pay = db.query(BillingPayment).filter(BillingPayment.user_id == user_a, BillingPayment.kind == "topup").one()
        service.apply_event(db, {"type": "dispute_opened", "event_id": "evt_dp_1", "payment_ref": pay.provider_payment_id},
                            "simulator")
        db.commit()
    finally:
        db.close()
    assert _buckets(user_a)["purchase"] == 0
    assert ("chargeback", -100) in _ledger(user_a)
    assert service.refund_quote(user_a)["lots"] == []


@pytest.mark.parametrize("order", ["settled_first", "provider_event_first"])
def test_provider_refund_event_for_our_own_refund_is_not_counted_twice(billing, user_a, order):
    subscribe(user_a, "starter")
    buy(user_a, "extra")
    db = SessionLocal()
    try:
        pay = db.query(BillingPayment).filter(BillingPayment.user_id == user_a, BillingPayment.kind == "topup").one()
        ref_payment = pay.provider_payment_id
    finally:
        db.close()
    SIM.state.fail_next.append("pending")
    out = service.cancel_and_refund(user_a, request_id="req-order-0001")
    refund = out["refunds"][0]
    assert refund["amount_minor"] == 450 and refund["status"] == "pending"

    def provider_event():
        db = SessionLocal()
        try:
            assert service.apply_event(db, {"type": "payment_refunded", "event_id": f"evt_ch_{order}",
                                            "payment_ref": ref_payment, "amount_refunded": 450}, "simulator") == "partially_refunded"
            db.commit()
        finally:
            db.close()

    def settle():
        db = SessionLocal()
        try:
            row = db.get(BillingRefund, uuid.UUID(refund["id"]))
            service.apply_event(db, {"type": "refund_updated", "event_id": f"evt_re_{order}",
                                     "provider_refund_id": row.provider_refund_id, "status": "succeeded"}, "simulator")
            db.commit()
        finally:
            db.close()

    for step in ((settle, provider_event) if order == "settled_first" else (provider_event, settle)):
        step()
    db = SessionLocal()
    try:
        pay = db.query(BillingPayment).filter(BillingPayment.provider_payment_id == ref_payment).one()
        assert (pay.refunded_minor, pay.status) == (450, "partially_refunded")
    finally:
        db.close()
    assert not any(reason == "payment_refund" for reason, _ in _ledger(user_a))


def test_webhook_events_apply_once(billing, user_a):
    subscribe(user_a, "starter")
    ev = {"type": "payment_succeeded", "event_id": "evt_dup_1", "user_id": str(user_a), "kind": "topup",
          "item_id": "extra", "payment_ref": "pi_dup_1", "amount_minor": 900, "currency": "USD", "country": "CH"}
    db = SessionLocal()
    try:
        assert service.apply_event(db, ev, "simulator") == "credits_added"
        assert service.apply_event(db, ev, "simulator") == "duplicate"
        assert service.apply_event(db, {**ev, "event_id": "evt_dup_2"}, "simulator") == "duplicate_payment"
        db.commit()
    finally:
        db.close()
    assert _buckets(user_a)["purchase"] == 100


def test_country_restrictions(billing, client, user_a):
    with pytest.raises(CountryRestricted):
        service.checkout(user_a, email=None, kind="subscription", item_id="starter", country="US")
    h = _auth(client, user_a)
    r = client.post("/api/billing/checkout", json={"kind": "subscription", "item_id": "starter", "country": "US"}, headers=h)
    assert r.status_code == 451 and r.json()["detail"]["code"] == "country_restricted"


@pytest.mark.parametrize("origin", [{"card_country": "US"}, {"billing_address_country": "us"}, {"country": "US"}])
def test_payments_from_blocked_countries_are_refunded_not_granted(billing, user_a, origin):
    """A declared non-US country is not enough: the card and billing address are checked when the money arrives."""
    n = uuid.uuid4().hex[:8]
    sub = {"type": "payment_succeeded", "event_id": f"evt_us_s_{n}", "user_id": str(user_a),
           "kind": "subscription", "item_id": "research", "payment_ref": f"pi_us_sub_{n}", "amount_minor": 2900,
           "currency": "USD", "country": "CH", "subscription_ref": f"sub_us_{n}", **origin}
    top = {**sub, "event_id": f"evt_us_t_{n}", "kind": "topup", "item_id": "extra",
           "payment_ref": f"pi_us_top_{n}", "amount_minor": 900, "subscription_ref": None}
    db = SessionLocal()
    try:
        assert service.apply_event(db, sub, "simulator") == "country_blocked"
        assert service.apply_event(db, top, "simulator") == "country_blocked"
        assert service.apply_event(db, {**sub, "event_id": f"evt_us_again_{n}"}, "simulator") == "duplicate_payment"
        db.commit()
        pays = {p.provider_payment_id: (p.status, p.refunded_minor) for p in db.query(BillingPayment).filter(BillingPayment.user_id == user_a)}
    finally:
        db.close()
    assert pays == {f"pi_us_sub_{n}": ("refunded", 2900), f"pi_us_top_{n}": ("refunded", 900)}
    assert sorted((c["payment_ref"], c["amount_minor"]) for c in SIM.state.refund_calls) == [
        (f"pi_us_sub_{n}", 2900), (f"pi_us_top_{n}", 900)]
    assert SIM.state.ended == [f"sub_us_{n}"]
    assert sum(_buckets(user_a).values()) == 0
    assert entitlements.state(SessionLocal(), user_a)["tier"] is None


def test_stripe_checkout_collects_the_billing_address_and_webhooks_carry_the_card_country(monkeypatch):
    p = providers.StripeProvider(secret_key="sk_test_x", webhook_secret="whsec_test")
    posts = []
    monkeypatch.setattr(p, "price_id", lambda kind, item: "price_x")
    monkeypatch.setattr(p, "_post", lambda path, data, key=None, method="POST": posts.append(data) or {"id": "cs_1", "url": "u"})
    p.create_checkout(user_id="u", email=None, kind="topup", item=catalog.pack("extra", catalog.load("")), country="CH",
                      withdrawal_waived=False, customer_id=None, idempotency_key="k")
    assert posts[0]["billing_address_collection"] == "required"

    monkeypatch.setattr(p, "_get", lambda path, params=None: {"latest_charge": {
        "payment_method_details": {"card": {"country": "US"}}, "billing_details": {"address": {"country": "CA"}}}}
        if path == "/payment_intents/pi_9" else {})
    event = {"id": "evt_9", "type": "checkout.session.completed", "data": {"object": {
        "mode": "payment", "payment_status": "paid", "payment_intent": "pi_9", "amount_total": 900, "currency": "usd",
        "customer_details": {"address": {"country": "DE"}}, "metadata": {"user_id": "u", "item_id": "extra", "country": "CH"}}}}
    payload = json.dumps(event).encode()
    out = p.parse_webhook(payload, {"stripe-signature": _signed("whsec_test", payload, int(time.time()))})
    assert (out["country"], out["billing_address_country"], out["card_country"]) == ("CH", "DE", "US")


def test_checkout_passes_the_account_email_to_the_provider(billing, monkeypatch, client, user_a):
    seen = {}
    monkeypatch.setattr(service, "checkout", lambda uid, **kw: seen.update(kw) or {"url": "u"})
    h = _auth(client, user_a)
    r = client.post("/api/billing/checkout", json={"kind": "subscription", "item_id": "starter", "country": "CH"}, headers=h)
    assert r.status_code == 200
    assert seen["email"] == f"{user_a.hex[:8]}@test.local"


def test_unapproved_prices_cannot_be_sold_live(billing, monkeypatch, user_a):
    from app.billing import BillingUnavailable

    monkeypatch.setattr(config, "BILLING_MODE", "live")
    monkeypatch.setattr(config, "BILLING_CATALOG_OVERRIDES", json.dumps({"tiers": [{"id": "research", "price": {"approved": False}}]}))
    with pytest.raises(BillingUnavailable):
        service.checkout(user_a, email=None, kind="subscription", item_id="research", country="CH")


def test_cancellation_needs_no_reason(billing, client, user_a):
    subscribe(user_a, "starter")
    h = _auth(client, user_a)
    assert client.post("/api/billing/cancel", json={}, headers=h).status_code == 200


# --------------------------------------------------------------------------- Stripe adapter (offline)


def _signed(secret: str, payload: bytes, ts: int) -> str:
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return f"t={ts},v1={sig}"


def test_stripe_webhook_signature_and_normalisation(monkeypatch):
    p = providers.StripeProvider(secret_key="sk_test_x", webhook_secret="whsec_test")
    event = {"id": "evt_1", "type": "invoice.paid", "data": {"object": {
        "subscription": "sub_1", "customer": "cus_1", "payment_intent": "pi_1", "amount_paid": 499, "currency": "usd",
        "billing_reason": "subscription_cycle",
        "subscription_details": {"metadata": {"user_id": str(uuid.uuid4()), "item_id": "starter", "country": "CH"}},
        "lines": {"data": [{"period": {"start": 1767225600, "end": 1769904000}}]}}}}
    payload = json.dumps(event).encode()
    now = int(time.time())
    out = p.normalise(p.verify(payload, _signed("whsec_test", payload, now)))
    assert out["type"] == "payment_succeeded" and out["kind"] == "subscription" and out["amount_minor"] == 499
    assert out["currency"] == "USD" and out["period_end"] > out["period_start"]
    with pytest.raises(providers.WebhookRejected):
        p.verify(payload, _signed("wrong", payload, now))
    with pytest.raises(providers.WebhookRejected):
        p.verify(payload, _signed("whsec_test", payload, now - 3600))


def test_stripe_current_api_shapes_are_normalised(monkeypatch):
    """API versions from 2025 move the subscription onto invoice.parent and periods onto items."""
    p = providers.StripeProvider(secret_key="sk_test_x", webhook_secret="whsec_test")
    uid = str(uuid.uuid4())
    invoice = {"id": "evt_2", "type": "invoice.paid", "data": {"object": {
        "id": "in_1", "customer": "cus_1", "amount_paid": 2900, "currency": "usd", "billing_reason": "subscription_create",
        "parent": {"type": "subscription_details", "subscription_details": {
            "subscription": "sub_2", "metadata": {"user_id": uid, "item_id": "research", "country": "CH"}}},
        "lines": {"data": [{"period": {"start": 1767225600, "end": 1769904000}}]}}}}
    monkeypatch.setattr(p, "_get", lambda path, params=None: {"data": [{"payment": {"payment_intent": "pi_2"}}]}
                        if path == "/invoice_payments" and params == {"invoice": "in_1", "limit": 1} else {})
    payload = json.dumps(invoice).encode()
    out = p.parse_webhook(payload, {"stripe-signature": _signed("whsec_test", payload, int(time.time()))})
    assert (out["user_id"], out["item_id"], out["subscription_ref"], out["payment_ref"]) == (uid, "research", "sub_2", "pi_2")
    assert "payment_ref_is_invoice" not in out

    failed = p.normalise({"id": "evt_3", "type": "invoice.payment_failed", "data": {"object": {
        "parent": {"subscription_details": {"subscription": "sub_2", "metadata": {"user_id": uid}}}}}})
    assert (failed["type"], failed["subscription_ref"], failed["user_id"]) == ("payment_failed", "sub_2", uid)

    sub = p.normalise({"id": "evt_4", "type": "customer.subscription.updated", "data": {"object": {
        "id": "sub_2", "status": "active", "cancel_at_period_end": True, "metadata": {"user_id": uid},
        "items": {"data": [{"current_period_start": 1767225600, "current_period_end": 1769904000}]}}}})
    assert sub["cancel_at_period_end"] and sub["period_end"] > sub["period_start"] and sub["user_id"] == uid

    one_off = p.normalise({"id": "evt_5", "type": "invoice.paid", "data": {"object": {"id": "in_x", "amount_paid": 100}}})
    assert one_off is None


def test_stripe_prices_must_match_the_catalogue(monkeypatch):
    p = providers.StripeProvider(secret_key="sk_test_x", webhook_secret="w")
    starter = catalog.tier("starter", catalog.load(""))
    price = {"id": "price_1", "unit_amount": 499, "currency": "usd", "recurring": {"interval": "month"}}
    calls = []

    def fake_get(path, params=None):
        calls.append(params)
        return {"data": [price]}

    monkeypatch.setattr(p, "_get", fake_get)
    assert p.price_id("subscription", starter) == "price_1"
    assert calls[0]["lookup_keys[]"] == "convolve_subscription_starter_usd"
    p._prices.clear()
    price["unit_amount"] = 599
    with pytest.raises(providers.ProviderError):
        p.price_id("subscription", starter)
    p._prices.clear()
    price.update(unit_amount=499, recurring=None)
    with pytest.raises(providers.ProviderError):
        p.price_id("subscription", starter)


def test_stripe_upgrade_with_a_failed_payment_is_refused(monkeypatch):
    p = providers.StripeProvider(secret_key="sk_test_x", webhook_secret="w")
    research = catalog.tier("research", catalog.load(""))
    posts = []
    monkeypatch.setattr(p, "_get", lambda path, params=None: {"items": {"data": [{"id": "si_1"}]}})
    monkeypatch.setattr(p, "price_id", lambda kind, item: "price_r")
    monkeypatch.setattr(p, "_post", lambda path, data, key=None: posts.append((path, data))
                        or {"pending_update": {"expires_at": 1}, "latest_invoice": "in_up"})
    with pytest.raises(providers.PaymentDeclined):
        p.change_subscription("sub_1", item=research, immediate=True, idempotency_key="k")
    assert posts[0][1]["payment_behavior"] == "pending_if_incomplete"
    assert [path for path, _ in posts] == ["/subscriptions/sub_1", "/invoices/in_up/void"]


def test_declined_upgrade_keeps_the_plan_and_status(billing, monkeypatch, user_a):
    from app.billing import PaymentFailed

    subscribe(user_a, "starter")

    def declined(*args, **kwargs):
        raise providers.PaymentDeclined("declined")

    monkeypatch.setattr(SIM, "change_subscription", declined)
    with pytest.raises(PaymentFailed):
        service.change_plan(user_a, "research")
    db = SessionLocal()
    try:
        row = db.get(UserPlan, user_a)
        assert service.apply_event(db, {"type": "payment_failed", "event_id": "evt_up_fail", "billing_reason": "subscription_update",
                                        "subscription_ref": row.provider_subscription_id}, "simulator") == "upgrade_payment_failed"
        db.commit()
    finally:
        db.close()
    st = service.state(user_a)
    assert st["subscription"]["tier_id"] == "starter" and st["subscription"]["status"] == "active"
    assert st["balances"]["subscription"] == 15


def test_events_for_another_subscription_are_ignored(billing, user_a):
    subscribe(user_a, "starter")
    db = SessionLocal()
    try:
        assert service.apply_event(db, {"type": "payment_failed", "event_id": "evt_old_1", "user_id": str(user_a),
                                        "subscription_ref": "sub_old"}, "simulator") == "stale_subscription"
        assert service.apply_event(db, {"type": "subscription_deleted", "event_id": "evt_old_2", "user_id": str(user_a),
                                        "subscription_ref": "sub_old"}, "simulator") == "stale_subscription"
        db.commit()
    finally:
        db.close()
    st = service.state(user_a)["subscription"]
    assert st["active"] and st["status"] == "active"


def test_stripe_refuses_live_keys_outside_live_mode(monkeypatch):
    monkeypatch.setattr(config, "BILLING_MODE", "sandbox")
    with pytest.raises(providers.ProviderError):
        providers.StripeProvider(secret_key="sk_live_x", webhook_secret="w")


def test_webhook_endpoint_rejects_bad_signatures(billing, monkeypatch, client):
    monkeypatch.setattr(config, "BILLING_PROVIDER", "stripe")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
    r = client.post("/api/billing/webhook/stripe", content=b"{}", headers={"stripe-signature": "t=1,v1=bad"})
    assert r.status_code == 400


def test_stripe_sync_script_keeps_live_provisioning_behind_explicit_approval(monkeypatch):
    from scripts import stripe_sync_catalog as sync

    test_key, live_key = "sk_test_" + "x" * 8, "sk_live_" + "x" * 8
    assert sync.check_mode(test_key, False, False, None, False) is False
    for args in [(live_key, False, True, "acct_1", True),  # a live key without --live
                 (test_key, True, True, "acct_1", True),   # --live with a test key
                 (live_key, True, False, "acct_1", True),  # no approval
                 (live_key, True, True, None, True)]:      # no account confirmation
        with pytest.raises(SystemExit):
            sync.check_mode(*args)
    assert sync.check_mode(live_key, True, True, "acct_1", False) is True   # live is a dry run without --apply
    assert sync.check_mode(live_key, True, True, "acct_1", True) is False
    monkeypatch.setenv("STRIPE_SECRET_KEY", live_key)
    monkeypatch.setenv("CONVOLVE_STRIPE_LIVE_APPROVED", "1")
    monkeypatch.setenv("BILLING_RETURN_URL", "http://localhost:5173/account?tab=plan")
    with pytest.raises(SystemExit, match="https"):
        sync.main(["--live", "--confirm-account", "acct_1", "--apply"])  # refuses before any request


def test_every_webhook_event_the_sync_script_lists_is_handled():
    from scripts import stripe_sync_catalog as sync

    obj = {"mode": "payment", "payment_status": "paid", "metadata": {}, "parent": {"subscription_details": {"subscription": "sub_1"}}}
    for etype in sync.WEBHOOK_EVENTS:
        assert providers.StripeProvider.normalise({"id": "evt", "type": etype, "data": {"object": obj}}) is not None, etype
