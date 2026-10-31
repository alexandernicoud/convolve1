"""Founding beta member offer: eligibility by account creation date, first subscription invoice only."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app import config
from app.billing import BillingUnavailable, founding, providers, service
from app.db import SessionLocal
from app.models import BillingPayment, Profile
from tests.test_isolation import _auth

SIM = providers.SimulatorProvider


def _iso(dt: datetime) -> str:
    return dt.isoformat()


@pytest.fixture
def billing(monkeypatch):
    monkeypatch.setattr(config, "BILLING_MODE", "sandbox")
    monkeypatch.setattr(config, "BILLING_PROVIDER", "simulator")
    monkeypatch.setattr(config, "BILLING_CATALOG_OVERRIDES", "")
    monkeypatch.setattr(config, "BILLING_BLOCKED_COUNTRIES", frozenset({"US"}))
    monkeypatch.setattr(config, "CREDITS_MODE", "off")
    monkeypatch.setattr(config, "FOUNDING_DISCOUNT_PERCENT", 20)
    monkeypatch.setattr(config, "BETA_WINDOW_START", _iso(datetime.now(timezone.utc) - timedelta(days=1)))
    monkeypatch.setattr(config, "BETA_WINDOW_END", "")
    SIM.reset()
    yield
    SIM.reset()


def _state(uid: uuid.UUID) -> dict:
    with SessionLocal() as db:
        return founding.state(db, uid)


def _payments(uid: uuid.UUID) -> list:
    with SessionLocal() as db:
        return [(p.kind, p.amount_minor) for p in db.query(BillingPayment).filter(BillingPayment.user_id == uid)]


def _created(uid: uuid.UUID, when: datetime) -> None:
    with SessionLocal() as db:
        db.get(Profile, uid).created_at = when
        db.commit()


def test_no_offer_until_the_window_is_configured(billing, monkeypatch, user_a):
    monkeypatch.setattr(config, "BETA_WINDOW_START", "")
    assert _state(user_a)["status"] == "not_eligible"
    assert founding.public_offer()["open"] is False


def test_first_subscription_invoice_is_discounted_once(billing, user_a):
    assert _state(user_a)["status"] == "available"
    out = service.checkout(user_a, email=None, kind="subscription", item_id="starter", country="CH")
    assert out["discount_percent"] == 20
    service.complete_simulated_checkout(user_a, out["session_id"])
    full = next(t for t in service.catalog.public()["tiers"] if t["id"] == "starter")["price"]["amount_minor"]
    assert _payments(user_a) == [("subscription", full - full * 20 // 100)]
    st = _state(user_a)
    assert st["status"] == "redeemed" and st["redeemed_at"]
    with SessionLocal() as db:
        assert founding.offer_for_checkout(db, user_a, "subscription", {"id": "research"}) is None


def test_topups_never_get_the_discount(billing, user_a):
    out = service.checkout(user_a, email=None, kind="subscription", item_id="starter", country="CH")
    with SessionLocal() as db:
        assert founding.offer_for_checkout(db, user_a, "topup", {"id": "research_pack"}) is None
    assert out["discount_percent"] == 20


def test_accounts_outside_the_window_are_not_eligible(billing, monkeypatch, user_a, user_b):
    now = datetime.now(timezone.utc)
    _created(user_a, now - timedelta(days=30))
    assert _state(user_a)["reason"] == "outside_beta_window"
    monkeypatch.setattr(config, "BETA_WINDOW_END", _iso(now - timedelta(hours=1)))
    assert _state(user_b)["reason"] == "outside_beta_window"
    out = service.checkout(user_b, email=None, kind="subscription", item_id="starter", country="CH")
    assert out["discount_percent"] is None


def test_an_earlier_paid_subscription_ends_eligibility(billing, monkeypatch, user_a):
    monkeypatch.setattr(config, "FOUNDING_DISCOUNT_PERCENT", 0)
    out = service.checkout(user_a, email=None, kind="subscription", item_id="starter", country="CH")
    service.complete_simulated_checkout(user_a, out["session_id"])
    monkeypatch.setattr(config, "FOUNDING_DISCOUNT_PERCENT", 20)
    assert _state(user_a)["reason"] == "not_first_subscription"


def test_stripe_checkout_uses_the_coupon_and_disables_other_codes(billing, monkeypatch):
    sent = []
    p = providers.StripeProvider(secret_key="sk_test_unit", webhook_secret="")
    monkeypatch.setattr(p, "price_id", lambda kind, item: "price_x")
    monkeypatch.setattr(p, "_post", lambda path, data, key=None, method="POST": sent.append(data) or {"id": "cs", "url": "u"})
    item = {"id": "starter"}
    common = dict(user_id="u", email=None, kind="subscription", item=item, country="CH", withdrawal_waived=False,
                  customer_id=None, idempotency_key="k")
    p.create_checkout(**common, discount={"percent": 20, "coupon": "convolve_founding_20"})
    p.create_checkout(**common)
    with_offer, without = sent
    assert with_offer["discounts[0][coupon]"] == "convolve_founding_20"
    assert "allow_promotion_codes" not in with_offer
    assert with_offer["subscription_data[metadata][founding_discount]"] == "1"
    assert without["allow_promotion_codes"] == "true" and "discounts[0][coupon]" not in without


def test_stripe_refuses_an_eligible_checkout_without_a_coupon(billing, monkeypatch, user_a):
    monkeypatch.setattr(config, "BILLING_PROVIDER", "stripe")
    monkeypatch.delenv("STRIPE_FOUNDING_COUPON", raising=False)
    with pytest.raises(BillingUnavailable):
        service.checkout(user_a, email=None, kind="subscription", item_id="starter", country="CH")


def test_only_the_first_invoice_is_flagged():
    def ev(reason):
        return {"id": "evt", "type": "invoice.paid", "data": {"object": {
            "subscription": "sub_1", "billing_reason": reason, "amount_paid": 1520, "currency": "chf",
            "subscription_details": {"metadata": {"user_id": "u", "item_id": "starter", "founding_discount": "1"}},
        }}}
    assert providers.StripeProvider.normalise(ev("subscription_create"))["founding_discount"] is True
    assert providers.StripeProvider.normalise(ev("subscription_cycle"))["founding_discount"] is False


def test_status_endpoint(billing, client, user_a):
    r = client.get("/api/rewards/founding-discount", headers=_auth(client, user_a))
    assert r.status_code == 200 and r.json()["status"] == "available" and r.json()["percent"] == 20
    assert client.get("/api/rewards/founding-discount").status_code == 401
    assert client.get("/api/plans").json()["founding_offer"]["open"] is True
