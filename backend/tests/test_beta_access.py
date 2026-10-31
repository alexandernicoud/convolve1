"""Complimentary Research for existing beta accounts from the commercial activation date."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app import config
from app.billing import beta, entitlements, lots, providers, service
from app.db import SessionLocal
from app.models import CreditLot, UserPlan
from tests.conftest import _profiled

SIM = providers.SimulatorProvider
T0 = datetime.now(timezone.utc).replace(microsecond=0)


@pytest.fixture
def billing(monkeypatch):
    monkeypatch.setattr(config, "BILLING_MODE", "sandbox")
    monkeypatch.setattr(config, "BILLING_PROVIDER", "simulator")
    monkeypatch.setattr(config, "BILLING_CATALOG_OVERRIDES", "")
    monkeypatch.setattr(config, "CREDITS_MODE", "off")
    SIM.reset()
    yield
    SIM.reset()


def _grant(uid, activation=T0, now=T0):
    db = SessionLocal()
    try:
        out = beta.grant(db, uid, activation, now)
        db.commit()
        return out
    finally:
        db.close()


def _at(uid, now):
    db = SessionLocal()
    try:
        service.sync(db, uid, now)
        db.commit()
        row = db.get(UserPlan, uid)
        st = entitlements.state(db, uid, now)
        beta_lots = sorted((l.source_key.rsplit(":", 1)[1], l.credits_total, l.expired_at is None)
                           for l in db.query(CreditLot).filter(CreditLot.user_id == uid, CreditLot.source_key.like("beta:%")))
        return st, row, lots.breakdown(db, uid, now), beta_lots
    finally:
        db.close()


def test_sixty_days_of_research_in_two_monthly_slices_then_read_only(billing):
    uid = _profiled(uuid.uuid4())
    assert _grant(uid) is None
    st, row, bal, slices = _at(uid, T0 + timedelta(hours=1))
    assert st["active"] and st["tier_id"] == "research" and row.provider == "grant" and row.source == "beta"
    assert _aware(row.current_period_end) == T0 + timedelta(days=60)
    assert bal["subscription"] == 150 and slices == [("0", 150, True)]
    assert service.state(uid, T0 + timedelta(hours=1))["subscription"]["complimentary"] is True

    st, row, bal, slices = _at(uid, T0 + timedelta(days=31))
    assert st["active"] and bal["subscription"] == 150  # first slice expired, second granted
    assert slices == [("0", 150, False), ("1", 150, True)]
    assert _aware(row.current_period_start) == T0 + timedelta(days=30)  # backtest quota resets per slice

    st, row, bal, slices = _at(uid, T0 + timedelta(days=61))
    assert not st["active"] and st["read_only"] and row.status == "expired" and bal["subscription"] == 0
    assert len(slices) == 2
    assert not SIM.state.sessions and not SIM.state.customer_credits  # no provider, nothing charged


def test_paid_subscribers_and_repeat_runs_are_skipped(billing):
    paid = _profiled(uuid.uuid4())
    out = service.checkout(paid, email=None, kind="subscription", item_id="professional", country="CH")
    service.complete_simulated_checkout(paid, out["session_id"])
    assert _grant(paid, now=datetime.now(timezone.utc)) == "paid_subscription"
    assert _at(paid, datetime.now(timezone.utc))[1].plan_id == "professional"

    uid = _profiled(uuid.uuid4())
    assert _grant(uid) is None
    assert _grant(uid) == "already_granted"
    assert _grant(_profiled(uuid.uuid4()), activation=T0 - timedelta(days=61)) == "period_over"


def test_a_paid_plan_can_start_during_the_beta_period(billing):
    uid = _profiled(uuid.uuid4())
    now = datetime.now(timezone.utc)
    assert _grant(uid, activation=now, now=now) is None
    out = service.checkout(uid, email=None, kind="subscription", item_id="professional", country="CH")
    service.complete_simulated_checkout(uid, out["session_id"])
    st, row, bal, _ = _at(uid, now + timedelta(minutes=1))
    assert row.provider == "simulator" and st["tier_id"] == "professional"
    assert bal["subscription"] == 150 + 1200  # beta credits keep their own expiry


def test_ambassador_month_during_beta_extends_access_without_extra_beta_slices(billing):
    from app.billing import catalog
    from app.services import rewards

    uid = _profiled(uuid.uuid4())
    assert _grant(uid) is None
    db = SessionLocal()
    try:
        rewards.grant_free_month(db, uid, catalog.tier("research"), T0 + timedelta(days=1), "referral-month:test")
        db.commit()
    finally:
        db.close()
    st, row, _, slices = _at(uid, T0 + timedelta(days=65))
    assert st["active"] and len(slices) == 2  # beyond 60 days only the ambassador month's own credits apply


def test_script_is_a_dry_run_unless_confirmed(billing, capsys):
    from scripts import grant_beta_access

    uid = _profiled(uuid.uuid4())
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    assert grant_beta_access.main(["--activation", future]) == 0
    assert "Dry run" in capsys.readouterr().out
    db = SessionLocal()
    try:
        assert db.get(UserPlan, uid) is None
    finally:
        db.close()
    assert grant_beta_access.main(["--activation", future, "--apply", "--confirm", "-1"]) == 2
    db = SessionLocal()
    try:
        assert db.get(UserPlan, uid) is None
    finally:
        db.close()


def _aware(v):
    return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
