"""Ambassador codes and referral rewards, the complimentary month, and the citation bonus."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app import config
from app.billing import BillingConflict, entitlements, lots, providers, service
from app.db import SessionLocal
from app.models import CitationClaim, CreditLot, Profile, Referral, UserPlan
from app.services import account, rewards
from tests.conftest import _profiled, mint_token

SIM = providers.SimulatorProvider
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


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


def _h(user: uuid.UUID, **claims) -> dict:
    return {"Authorization": f"Bearer {mint_token(user, **claims)}"}


def _new_user() -> uuid.UUID:
    return _profiled(uuid.uuid4())


def subscribe(user: uuid.UUID, tier: str = "starter") -> None:
    out = service.checkout(user, email=None, kind="subscription", item_id=tier, country="CH")
    service.complete_simulated_checkout(user, out["session_id"])


def _lots(user: uuid.UUID) -> list:
    db = SessionLocal()
    try:
        return sorted((l.kind, l.credits_total, l.source_key.split(":")[0]) for l in db.query(CreditLot).filter(CreditLot.user_id == user))
    finally:
        db.close()


def _plan(user: uuid.UUID) -> UserPlan | None:
    db = SessionLocal()
    try:
        return db.get(UserPlan, user)
    finally:
        db.close()


def _refused(fn, *args, **kwargs) -> dict:
    with pytest.raises(HTTPException) as exc:
        fn(*args, **kwargs)
    return {"status": exc.value.status_code, **exc.value.detail}


# --------------------------------------------------------------------------- codes and claims


def test_code_is_created_once_and_checkable_without_signing_in(client, user_a):
    r = client.post("/api/rewards/referral-code", headers=_h(user_a))
    assert r.status_code == 200
    code = r.json()["code"]
    assert len(code) == 8 and code.isalnum() and code.isupper()
    assert client.post("/api/rewards/referral-code", headers=_h(user_a)).json()["code"] == code
    assert client.get(f"/api/referrals/check?code={code.lower()}").json()["valid"] is True
    assert client.get("/api/referrals/check?code=NOPE1234").json()["valid"] is False


def test_claims_are_refused_for_own_code_unknown_code_old_accounts_and_twice(user_a, user_b):
    code = rewards.get_or_create_code(str(user_a))
    assert _refused(rewards.claim_referral, str(user_a), code)["code"] == "own_code"
    assert _refused(rewards.claim_referral, str(user_b), "ZZZZZZZZ")["code"] == "invalid_code"

    old = _new_user()
    db = SessionLocal()
    try:
        db.get(Profile, old).created_at = datetime.now(timezone.utc) - timedelta(days=30)
        db.commit()
    finally:
        db.close()
    assert _refused(rewards.claim_referral, str(old), code)["code"] == "not_new"

    claimed = rewards.claim_referral(str(user_b), code)
    assert claimed["status"] == "pending" and claimed["credits_on_subscribe"] == 20
    assert [(r["tier_id"], r["referee_credits"], r["referrer"], r["referrer_credits"]) for r in claimed["rewards"]] == [
        ("starter", 5, "credits", 10), ("research", 20, "free_month", 0), ("professional", 20, "free_month", 0)]
    assert rewards.claim_referral(str(user_b), code)["status"] == "pending"  # same code again is harmless
    other = rewards.get_or_create_code(str(_new_user()))
    assert _refused(rewards.claim_referral, str(user_b), other)["code"] == "already_referred"
    mutual = rewards.get_or_create_code(str(user_b))
    assert _refused(rewards.claim_referral, str(user_a), mutual)["code"] == "mutual"


# --------------------------------------------------------------------------- rewards


def test_first_paid_subscription_rewards_both_once_and_gives_a_free_research_month(billing, user_a, user_b):
    rewards.claim_referral(str(user_b), rewards.get_or_create_code(str(user_a)))
    subscribe(user_b, "research")
    assert ("grant", 20, "referral-welcome") in _lots(user_b)

    plan = _plan(user_a)
    assert plan.plan_id == "research" and plan.provider == "grant" and plan.status == "active"
    assert ("subscription", 150, "referral-month") in _lots(user_a)
    st = service.state(user_a)
    assert st["subscription"]["active"] and st["subscription"]["complimentary"] is True

    # A simulated renewal of the new member's plan pays nothing out again.
    db = SessionLocal()
    try:
        service.sync(db, user_b, datetime.now(timezone.utc) + timedelta(days=40))
        db.commit()
    finally:
        db.close()
    assert [k for k in _lots(user_b) if k[2] == "referral-welcome"] == [("grant", 20, "referral-welcome")]
    assert [k for k in _lots(user_a) if k[2] == "referral-month"] == [("subscription", 150, "referral-month")]
    status = rewards.status(str(user_a))["ambassador"]
    assert status["invited"] == 1 and status["subscribed"] == 1 and status["months_earned"] == 1


def test_free_month_cannot_be_cancelled_or_changed_but_a_paid_plan_can_start_and_it_expires(billing, user_a, user_b):
    rewards.claim_referral(str(user_b), rewards.get_or_create_code(str(user_a)))
    subscribe(user_b, "research")
    with pytest.raises(BillingConflict):
        service.set_cancel(user_a, True)
    with pytest.raises(BillingConflict):
        service.change_plan(user_a, "professional")

    later = datetime.now(timezone.utc) + timedelta(days=40)
    db = SessionLocal()
    try:
        service.sync(db, user_a, later)
        db.commit()
        assert entitlements.state(db, user_a, later)["active"] is False
    finally:
        db.close()

    subscribe(user_a, "research")  # a paid plan can start during or after the free month
    assert _plan(user_a).provider == "simulator"


def test_subscribed_ambassador_gets_the_month_as_an_invoice_credit(billing, user_a, user_b):
    subscribe(user_a, "professional")
    rewards.claim_referral(str(user_b), rewards.get_or_create_code(str(user_a)))
    subscribe(user_b, "professional")
    credits = list(SIM.state.customer_credits.values())
    assert len(credits) == 1 and credits[0]["amount_minor"] == 2900 and credits[0]["currency"] == "USD"
    assert _plan(user_a).plan_id == "professional"  # the paid plan is untouched


def test_unpaid_subscriptions_do_not_qualify(billing, user_a, user_b):
    rewards.claim_referral(str(user_b), rewards.get_or_create_code(str(user_a)))
    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        service.apply_event(db, {
            "type": "payment_succeeded", "event_id": f"evt_{uuid.uuid4().hex}", "user_id": str(user_b),
            "kind": "subscription", "item_id": "starter", "payment_ref": f"pi_{uuid.uuid4().hex}", "amount_minor": 0,
            "currency": "USD", "country": "CH", "subscription_ref": "sub_free", "period_start": now,
            "period_end": now + timedelta(days=30),
        }, "simulator", now)
        db.commit()
        assert db.query(Referral).filter(Referral.referee_id == user_b).one().status == "pending"
    finally:
        db.close()
    assert _plan(user_a) is None


def test_ambassador_rewards_are_capped_but_new_members_still_get_credits(billing, monkeypatch, user_a):
    monkeypatch.setattr(rewards, "MAX_REWARDS_PER_YEAR", 1)
    code = rewards.get_or_create_code(str(user_a))
    first, second = _new_user(), _new_user()
    for u in (first, second):
        rewards.claim_referral(str(u), code)
        subscribe(u, "research")
    assert ("grant", 20, "referral-welcome") in _lots(second)
    db = SessionLocal()
    try:
        assert db.query(Referral).filter(Referral.referee_id == second).one().referrer_reward == "limit_reached"
    finally:
        db.close()
    assert [k for k in _lots(user_a) if k[2] == "referral-month"] == [("subscription", 150, "referral-month")]


def test_a_starter_first_plan_earns_10_and_5_credits_and_no_month(billing, user_a, user_b):
    rewards.claim_referral(str(user_b), rewards.get_or_create_code(str(user_a)))
    subscribe(user_b, "starter")
    assert ("grant", 5, "referral-welcome") in _lots(user_b)
    assert ("grant", 10, "referral-credits") in _lots(user_a)
    assert _plan(user_a) is None and not SIM.state.customer_credits
    # A later upgrade of the same member pays nothing more: only the first paid plan counts.
    service.change_plan(user_b, "professional")
    assert [k for k in _lots(user_a) if k[2].startswith("referral")] == [("grant", 10, "referral-credits")]
    st = rewards.status(str(user_a))["ambassador"]
    assert st["credits_earned"] == 10 and st["months_earned"] == 0 and st["subscribed"] == 1
    assert rewards.status(str(user_b))["referred"]["credits"] == 5


def _payment(user: uuid.UUID):
    from app.models import BillingPayment

    db = SessionLocal()
    try:
        return db.query(BillingPayment).filter(BillingPayment.user_id == user, BillingPayment.kind == "subscription").one()
    finally:
        db.close()


def _event(etype: str, pay, **extra) -> str:
    db = SessionLocal()
    try:
        out = service.apply_event(db, {"type": etype, "event_id": extra.pop("event_id", f"evt_{uuid.uuid4().hex}"),
                                       "payment_ref": pay.provider_payment_id, **extra}, "simulator")
        db.commit()
        return out
    finally:
        db.close()


def _referral(user: uuid.UUID) -> Referral:
    db = SessionLocal()
    try:
        return db.query(Referral).filter(Referral.referee_id == user).one()
    finally:
        db.close()


def test_full_refund_of_the_qualifying_payment_withdraws_unused_rewards_once(billing, user_a, user_b):
    rewards.claim_referral(str(user_b), rewards.get_or_create_code(str(user_a)))
    subscribe(user_b, "research")
    pay = _payment(user_b)
    assert _referral(user_b).payment_id == pay.id

    assert _event("payment_refunded", pay, amount_refunded=1000) == "partially_refunded"
    assert _referral(user_b).status == "rewarded"  # a partial refund keeps the rewards

    assert _event("payment_refunded", pay, amount_refunded=pay.amount_minor, event_id="evt_full") == "refunded"
    assert _event("payment_refunded", pay, amount_refunded=pay.amount_minor, event_id="evt_full") == "duplicate"
    ref = _referral(user_b)
    assert ref.status == "reversed" and ref.reversed_at is not None
    db = SessionLocal()
    try:
        assert lots.breakdown(db, user_b)["total"] == 0  # welcome credits and monthly credits withdrawn
    finally:
        db.close()
    plan = _plan(user_a)
    assert plan.status == "expired"  # the complimentary month was the only reward
    st = rewards.status(str(user_a))["ambassador"]
    assert st["months_earned"] == 0 and st["subscribed"] == 0


def test_dispute_withdraws_starter_rewards_but_spent_credits_stay_spent(billing, user_a, user_b):
    rewards.claim_referral(str(user_b), rewards.get_or_create_code(str(user_a)))
    subscribe(user_b, "starter")
    db = SessionLocal()
    try:
        assert lots.debit_balance(db, user_a, 4) == 4
        lots.consume(db, user_a, 4, "charge:test", None, balance_before=10)
        db.commit()
    finally:
        db.close()
    assert _event("dispute_opened", _payment(user_b)) == "disputed"
    assert _referral(user_b).status == "reversed"
    db = SessionLocal()
    try:
        assert lots.breakdown(db, user_a)["total"] == 0  # the 6 unused credits withdrawn, nothing more
        assert lots.breakdown(db, user_b)["grant"] == 0
        from app.models import CreditLedgerEntry

        withdrawn = db.query(CreditLedgerEntry).filter(CreditLedgerEntry.user_id == user_a,
                                                       CreditLedgerEntry.reason == "referral_reversal").one()
        assert withdrawn.delta == -6
    finally:
        db.close()


def test_refund_withdraws_an_invoice_credit_only_while_unused(billing, user_a, user_b):
    subscribe(user_a, "professional")
    rewards.claim_referral(str(user_b), rewards.get_or_create_code(str(user_a)))
    subscribe(user_b, "research")
    pay = _payment(user_b)
    assert _event("payment_refunded", pay, amount_refunded=pay.amount_minor) == "refunded"
    assert list(SIM.state.customer_credit_reversals.values()) == [2900]
    assert _plan(user_a).plan_id == "professional" and _plan(user_a).status == "active"


def test_stripe_charge_refunded_is_normalised():
    ev = providers.StripeProvider.normalise({"id": "evt_1", "type": "charge.refunded", "data": {"object": {
        "payment_intent": "pi_1", "amount_refunded": 2900}}})
    assert ev == {"event_id": "evt_1", "type": "payment_refunded", "payment_ref": "pi_1", "amount_refunded": 2900}


# --------------------------------------------------------------------------- citation bonus


def test_citation_is_reviewed_by_an_admin_and_granted_once(client, monkeypatch, user_a, user_b):
    h = _h(user_a)
    r = client.post("/api/rewards/citation", data={"url": "https://example.org/paper", "note": "Section 3"},
                    files={"file": ("proof.png", PNG, "image/png")}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "pending"
    again = client.post("/api/rewards/citation", data={"url": "https://example.org/paper"}, headers=h)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "pending"

    claim_id = r.json()["id"]
    assert client.get("/api/admin/citations", headers=_h(user_b)).status_code == 404
    assert client.post(f"/api/admin/citations/{claim_id}/review", json={"approve": True}, headers=_h(user_b)).status_code == 404

    monkeypatch.setattr(config, "ADMIN_USER_IDS", frozenset({str(user_b)}))
    listed = client.get("/api/admin/citations?status=pending", headers=_h(user_b)).json()["claims"]
    assert any(c["id"] == claim_id and c["has_file"] for c in listed)
    f = client.get(f"/api/admin/citations/{claim_id}/file", headers=_h(user_b))
    assert f.status_code == 200 and f.content == PNG and "attachment" in f.headers["content-disposition"]

    ok = client.post(f"/api/admin/citations/{claim_id}/review", json={"approve": True}, headers=_h(user_b))
    assert ok.status_code == 200 and ok.json()["credits_granted"] == 50
    assert ("grant", 50, "citation") in _lots(user_a)
    twice = client.post(f"/api/admin/citations/{claim_id}/review", json={"approve": True}, headers=_h(user_b))
    assert twice.status_code == 409
    done = client.post("/api/rewards/citation", data={"url": "https://example.org/other"}, headers=h)
    assert done.status_code == 409 and done.json()["detail"]["code"] == "already_rewarded"
    assert client.get("/api/rewards", headers=h).json()["citation"]["status"] == "approved"


def test_rejected_citation_can_be_resubmitted(user_a, user_b):
    out = rewards.submit_citation(str(user_a), url="https://example.org", note=None, file_name=None, content_type=None, data=None)
    rewards.review_citation(str(user_b), out["id"], approve=False, note="No mention of Convolve found")
    assert _lots(user_a) == []
    assert rewards.submit_citation(str(user_a), url="https://example.org/v2", note=None, file_name=None,
                                   content_type=None, data=None)["status"] == "pending"


def test_citation_input_is_validated(client, user_a):
    h = _h(user_a)
    assert client.post("/api/rewards/citation", data={}, headers=h).json()["detail"]["code"] == "missing_proof"
    assert client.post("/api/rewards/citation", data={"url": "javascript:alert(1)"}, headers=h).json()["detail"]["code"] == "invalid_url"
    fake = client.post("/api/rewards/citation", files={"file": ("x.pdf", b"MZ\x90\x00", "application/pdf")}, headers=h)
    assert fake.status_code == 415
    big = client.post("/api/rewards/citation", files={"file": ("x.pdf", b"%PDF" + b"0" * (5 * 1024 * 1024), "application/pdf")}, headers=h)
    assert big.status_code == 413
    unverified = client.post("/api/rewards/citation", data={"url": "https://example.org"}, headers=_h(user_a, user_metadata={"email_verified": False}))
    assert unverified.status_code == 403


def test_export_includes_and_deletion_removes_rewards(user_a, user_b):
    code = rewards.get_or_create_code(str(user_a))
    rewards.claim_referral(str(user_b), code)
    rewards.submit_citation(str(user_a), url="https://example.org", note=None, file_name=None, content_type=None, data=None)
    out = account.export_account(str(user_a))["rewards"]
    assert out["ambassador_code"] == code and out["invited_accounts"] == 1 and len(out["citation_claims"]) == 1
    assert account.delete_account(str(user_a))["ok"]
    db = SessionLocal()
    try:
        assert db.query(Referral).filter(Referral.referee_id == user_b).count() == 0
        assert db.query(CitationClaim).filter(CitationClaim.user_id == user_a).count() == 0
    finally:
        db.close()
