"""Billing operations: checkout, provider events, plan changes, cancellation and cash refunds.

Cash refunds of purchased credits
---------------------------------
Per purchase lot: refund = round_half_up(price paid x unused credits / credits bought x rate),
capped at what the payment still has unrefunded (succeeded plus pending refunds). The rate
is the voluntary 50 % unless a statutory basis requires 100 % (``money.refund_basis``).
Monthly subscription credits are never cash-refunded.

A refund runs in two steps so money and credits can never both be lost or both be kept:

1. One transaction removes the lot's unused credits (``credit_refund`` ledger entry) and
   writes a ``pending`` refund row with a stable idempotency key.
2. The provider is called with that same key (a retry can never pay twice).
   * succeeded -> the refund is final and the payment's refunded amount grows;
   * pending / transient error -> stays pending; ``reconcile`` polls or retries later;
   * refused -> the refund is marked failed and the credits are put back
     (``credit_refund_reversal``), so nothing is lost.

Credits held by queued or running jobs were already taken out of their lots when the job
was charged, so they are never refundable; if such a job later fails, its credits return to
the lot as usable credit, not as cash.
"""

from __future__ import annotations

import logging
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Mapping, Optional

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import config
from app.billing import (
    BillingConflict, BillingError, BillingUnavailable, CountryRestricted, PaymentFailed, SubscriptionRequired,
    beta, catalog, entitlements, founding, lots, money, providers,
)
from app.db import SessionLocal
from app.models import (
    BillingEvent, BillingPayment, BillingRefund, CreditAccount, CreditLedgerEntry, CreditLot, PipelineRun, UserPlan,
)

logger = logging.getLogger(__name__)

ACTIVE_RUN_STATUSES = ("queued", "running", "starting")


def enabled() -> bool:
    return entitlements.enabled()


def _now(now: Optional[datetime] = None) -> datetime:
    return now or datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _uuid(value: Any) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


@contextmanager
def _session() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _lock_account(db: Session, uid: uuid.UUID) -> None:
    """Serialise billing writes for one user (row lock on PostgreSQL; SQLite serialises writers)."""
    if db.get(CreditAccount, uid) is None:
        db.add(CreditAccount(user_id=uid, balance=0, version=1))
        db.flush()
    db.query(CreditAccount).filter(CreditAccount.user_id == uid).with_for_update().one()


def _require_enabled() -> None:
    if not enabled():
        raise BillingUnavailable("Paid plans are not available yet.")


def _check_country(country: Optional[str]) -> str:
    c = (country or "").strip().upper()
    if len(c) != 2 or not c.isalpha():
        raise BillingError("Select the country of your billing address.")
    if c in config.BILLING_BLOCKED_COUNTRIES:
        raise CountryRestricted(
            "Paid plans are not yet available in your country. Your account and existing work remain accessible."
        )
    return c


def _checkout_allowed(item: Mapping[str, Any]) -> None:
    if config.BILLING_MODE == "live" and not item["price"].get("approved"):
        raise BillingUnavailable("This price has not been approved for sale.")


# --------------------------------------------------------------------------- subscription lifecycle


def _subscription_lot_key(provider: str, sub_ref: str, period_start: datetime) -> str:
    return f"sub:{provider}:{sub_ref}:{_aware(period_start).isoformat()}"


def sync(db: Session, uid: uuid.UUID, now: Optional[datetime] = None) -> None:
    """Bring the subscription up to ``now``: simulated renewals, period ends, credit expiry. Caller commits."""
    now = _now(now)
    row = db.get(UserPlan, uid)
    cat = catalog.load()
    if row is not None and catalog.tier(row.plan_id, cat) and row.current_period_end is not None:
        guard = 0
        while _aware(row.current_period_end) <= now and guard < 24:
            guard += 1
            if row.status in ("active", "past_due") and not row.cancel_at_period_end and row.provider == "simulator":
                tier = catalog.tier(row.pending_plan_id or row.plan_id, cat)
                start = _aware(row.current_period_end)
                ev = providers.SimulatorProvider().renewal_event(
                    row.provider_subscription_id, str(uid), tier, row.billing_country or "", start, providers.add_month(start),
                )
                apply_event(db, ev, "simulator", now)
                db.refresh(row)
                continue
            if row.status in ("active", "canceled", "past_due") and row.provider in ("simulator", "grant", None):
                row.status = "expired"
                row.ended_at = _aware(row.current_period_end)
            break
        if row.status in ("canceled",) and _aware(row.current_period_end) <= now:
            row.status = "expired"
            row.ended_at = row.ended_at or _aware(row.current_period_end)
    if row is not None:
        beta.top_up(db, row, now)
    lots.expire_due(db, uid, now)
    db.flush()


def ensure_current(user_id: Any, now: Optional[datetime] = None) -> None:
    uid = _uuid(user_id)
    with _session() as db:
        try:
            _lock_account(db, uid)
            sync(db, uid, now)
            db.commit()
        except IntegrityError:
            db.rollback()


def _record_payment(db: Session, uid: uuid.UUID, provider: str, ev: Mapping[str, Any], kind: str) -> Optional[BillingPayment]:
    existing = db.query(BillingPayment).filter(
        BillingPayment.provider == provider, BillingPayment.provider_payment_id == ev["payment_ref"]
    ).first()
    if existing is not None:
        return None
    pay = BillingPayment(
        user_id=uid, provider=provider, provider_payment_id=ev["payment_ref"], kind=kind, item_id=ev["item_id"],
        amount_minor=int(ev["amount_minor"]), currency=(ev["currency"] or "").upper(), refunded_minor=0,
        status="succeeded", country=(ev.get("country") or None),
    )
    db.add(pay)
    db.flush()
    return pay


def _resolve_user(db: Session, ev: Mapping[str, Any]) -> Optional[uuid.UUID]:
    if ev.get("user_id"):
        try:
            return _uuid(ev["user_id"])
        except (ValueError, TypeError):
            return None
    if ev.get("subscription_ref"):
        row = db.query(UserPlan).filter(UserPlan.provider_subscription_id == ev["subscription_ref"]).first()
        return row.user_id if row else None
    return None


def apply_event(db: Session, ev: Mapping[str, Any], provider: str, now: Optional[datetime] = None) -> str:
    """Apply one normalised provider event exactly once. Caller commits."""
    now = _now(now)
    if db.query(BillingEvent.id).filter(BillingEvent.provider == provider, BillingEvent.event_id == ev["event_id"]).first():
        return "duplicate"
    uid = _resolve_user(db, ev)
    record = BillingEvent(provider=provider, event_id=ev["event_id"], type=ev["type"], user_id=uid)
    db.add(record)
    db.flush()
    outcome = _apply(db, uid, ev, provider, now) if uid is not None or ev["type"] in ("refund_updated", "dispute_opened", "payment_refunded") else "unknown_user"
    if uid is not None and ev["type"] == "payment_succeeded" and ev.get("kind") == "subscription":
        founding.mark_redeemed(db, uid, ev, now)
    record.outcome = outcome
    db.flush()
    return outcome


def _stale(row: UserPlan, ev: Mapping[str, Any]) -> bool:
    """An event about a subscription other than the user's current one (e.g. a late event for an ended one)."""
    ref = ev.get("subscription_ref")
    return bool(ref and ref != row.provider_subscription_id)


def _blocked_origin(ev: Mapping[str, Any]) -> Optional[str]:
    """A blocked country among the declared, billing-address and card-issuing countries of a payment."""
    for key in ("country", "billing_address_country", "card_country"):
        c = (ev.get(key) or "").strip().upper()
        if c and c in config.BILLING_BLOCKED_COUNTRIES:
            return c
    return None


def _refuse_blocked_payment(db: Session, uid: uuid.UUID, ev: Mapping[str, Any], provider: str, kind: str) -> str:
    """Grant nothing, refund the whole payment and end the subscription it started."""
    _lock_account(db, uid)
    pay = _record_payment(db, uid, provider, ev, kind)
    if pay is None:
        return "duplicate_payment"
    adapter = providers.get(provider)
    if kind == "subscription" and ev.get("subscription_ref"):
        adapter.cancel_now(ev["subscription_ref"], idempotency_key=f"blocked-cancel:{ev['subscription_ref']}")
    result = adapter.refund(payment_ref=pay.provider_payment_id, amount_minor=pay.amount_minor, currency=pay.currency,
                            idempotency_key=f"blocked:{pay.provider_payment_id}")
    if result.status == "failed":
        raise providers.ProviderError(f"Refund of a blocked-country payment failed: {result.reason}", retryable=True)
    pay.refunded_minor = pay.amount_minor
    pay.status = "refunded"
    logger.warning("Refused a %s payment from blocked country %s", kind, _blocked_origin(ev))
    return "country_blocked"


def _apply(db: Session, uid: Optional[uuid.UUID], ev: Mapping[str, Any], provider: str, now: datetime) -> str:
    cat = catalog.load()
    t = ev["type"]
    if t == "payment_succeeded" and _blocked_origin(ev) and ev.get("kind") in ("topup", "subscription"):
        row = db.get(UserPlan, uid) if ev.get("kind") == "subscription" else None
        if row is not None and row.provider_subscription_id == ev.get("subscription_ref") and row.status != "expired":
            row.status = "expired"
            row.ended_at = now
        return _refuse_blocked_payment(db, uid, ev, provider, ev["kind"])
    if t == "payment_succeeded" and ev.get("kind") == "topup":
        pack = catalog.pack(ev["item_id"], cat)
        if pack is None:
            return "unknown_item"
        _lock_account(db, uid)
        pay = _record_payment(db, uid, provider, ev, "topup")
        if pay is None:
            return "duplicate_payment"
        lots.add_lot(
            db, uid, kind="purchase", source_key=f"payment:{provider}:{ev['payment_ref']}", credits=int(pack["credits"]),
            reason="purchase", note=f"{pack['name']}: {pack['credits']} credits", item_id=pack["id"], payment_id=pay.id,
            amount_minor=pay.amount_minor, currency=pay.currency, withdrawal_waived=bool(ev.get("withdrawal_waived")),
        )
        return "credits_added"

    if t == "payment_succeeded" and ev.get("kind") == "subscription":
        tier = catalog.tier(ev["item_id"], cat)
        if tier is None:
            return "unknown_item"
        _lock_account(db, uid)
        pay = _record_payment(db, uid, provider, ev, "subscription")
        if ev.get("billing_reason") == "subscription_update":
            return "proration_recorded"
        row = db.get(UserPlan, uid)
        if row is None:
            row = UserPlan(user_id=uid, plan_id=tier["id"])
            db.add(row)
        row.plan_id = tier["id"]
        row.pending_plan_id = None
        row.status = "active"
        row.source = provider
        row.provider = provider
        row.provider_subscription_id = ev.get("subscription_ref") or row.provider_subscription_id
        row.provider_customer_id = ev.get("customer_id") or row.provider_customer_id
        row.cancel_at_period_end = False
        row.canceled_at = None
        row.ended_at = None
        if ev.get("country"):
            row.billing_country = ev["country"].upper()
        row.current_period_start = ev.get("period_start") or now
        row.current_period_end = ev.get("period_end") or providers.add_month(row.current_period_start)
        db.flush()
        # The provider's period boundary ends the previous period's credits even if its clock
        # (e.g. a Stripe test clock) runs ahead of ours.
        lots.expire_due(db, uid, max(now, _aware(row.current_period_start)))
        lots.add_lot(
            db, uid, kind="subscription",
            source_key=_subscription_lot_key(provider, row.provider_subscription_id or "-", row.current_period_start),
            credits=int(tier["monthly_credits"]), reason="subscription",
            note=f"{tier['name']} monthly credits", item_id=tier["id"], payment_id=pay.id if pay else None,
            expires_at=_aware(row.current_period_end) if cat["subscription"].get("credits_expire_at_period_end", True) else None,
        )
        from app.services import rewards

        rewards.on_subscription_paid(db, uid, pay, now)
        return "subscription_active"

    if t == "payment_failed":
        row = db.get(UserPlan, uid)
        if row is None or _stale(row, ev):
            return "stale_subscription"
        if ev.get("billing_reason") == "subscription_update":
            return "upgrade_payment_failed"  # the upgrade was refused; the paid plan continues
        row.status = "past_due"
        return "past_due"

    if t in ("subscription_updated", "subscription_deleted"):
        row = db.get(UserPlan, uid)
        if row is None:
            return "unknown_subscription"
        if _stale(row, ev):
            return "stale_subscription"
        if t == "subscription_deleted":
            row.status = "expired"
            row.ended_at = now
            row.cancel_at_period_end = False
            for lot in db.query(CreditLot).filter(CreditLot.user_id == uid, CreditLot.kind == "subscription",
                                                  CreditLot.expired_at.is_(None)):
                if lot.expires_at is None or _aware(lot.expires_at) > now:
                    lot.expires_at = now
            lots.expire_due(db, uid, now)
            return "expired"
        status = {"active": "active", "trialing": "active", "past_due": "past_due", "unpaid": "past_due",
                  "incomplete": "incomplete", "canceled": "expired"}.get(ev.get("status") or "", row.status)
        row.cancel_at_period_end = bool(ev.get("cancel_at_period_end"))
        row.status = "canceled" if status == "active" and row.cancel_at_period_end else status
        # The period is only advanced by a paid invoice: providers roll the period over before
        # collecting, and access must end with the last period that was paid for.
        return row.status

    if t == "refund_updated":
        ref = db.query(BillingRefund).filter(BillingRefund.provider_refund_id == ev.get("provider_refund_id")).first()
        if ref is None:
            return "unknown_refund"
        _finish_refund(db, ref, providers.RefundResult(ev.get("status") or "pending", ref.provider_refund_id, ev.get("reason")))
        return ref.status

    if t == "dispute_opened":
        pay = db.query(BillingPayment).filter(BillingPayment.provider == provider,
                                              BillingPayment.provider_payment_id == ev.get("payment_ref")).first()
        if pay is None:
            return "unknown_payment"
        pay.status = "disputed"
        _lock_account(db, pay.user_id)
        _withdraw_payment_lots(db, pay, now, "chargeback", "Credits withdrawn: the payment was disputed")
        if pay.kind == "subscription":
            row = db.get(UserPlan, pay.user_id)
            if row is not None:
                row.status = "past_due"
        from app.services import rewards

        rewards.reverse_for_payment(db, pay, now)
        return "disputed"

    if t == "payment_refunded":
        # Refunds made outside Convolve (e.g. in the provider's dashboard). Refunds Convolve
        # started are counted by refund_updated; only the part beyond them is new here.
        pay = db.query(BillingPayment).filter(BillingPayment.provider == provider,
                                              BillingPayment.provider_payment_id == ev.get("payment_ref")).first()
        if pay is None:
            return "unknown_payment"
        ours = db.query(BillingRefund).filter(BillingRefund.payment_id == pay.id,
                                              BillingRefund.status.in_(("pending", "succeeded"))).all()
        settled = sum(r.amount_minor for r in ours if r.status == "succeeded")
        external = max(0, int(ev.get("amount_refunded") or 0) - sum(r.amount_minor for r in ours))
        pay.refunded_minor = min(pay.amount_minor, max(pay.refunded_minor, settled + external))
        if int(ev.get("amount_refunded") or 0) < pay.amount_minor:
            if pay.status != "disputed" and pay.refunded_minor:
                pay.status = "partially_refunded"
            return "partially_refunded"
        if pay.status != "disputed":
            pay.status = "refunded"
        _lock_account(db, pay.user_id)
        _withdraw_payment_lots(db, pay, now, "payment_refund", "Credits withdrawn: the payment was refunded")
        from app.services import rewards

        rewards.reverse_for_payment(db, pay, now)
        return "refunded"
    return "ignored"


def _withdraw_payment_lots(db: Session, pay: BillingPayment, now: datetime, reason: str, note: str) -> None:
    for lot in db.query(CreditLot).filter(CreditLot.payment_id == pay.id, CreditLot.credits_remaining > 0):
        n = lots.debit_balance(db, pay.user_id, lot.credits_remaining)
        lot.credits_remaining = 0
        lot.expired_at = lot.expired_at or now
        if n:
            lots.write_entry(db, pay.user_id, -n, reason, f"{reason}:{lot.id}", note=note)


# --------------------------------------------------------------------------- checkout and plan changes


def checkout(user_id: Any, *, email: Optional[str], kind: str, item_id: str, country: Optional[str],
             withdrawal_waived: bool = False, request_key: Optional[str] = None) -> Dict[str, Any]:
    _require_enabled()
    uid = _uuid(user_id)
    country = _check_country(country)
    cat = catalog.load()
    with _session() as db:
        sync(db, uid)
        db.commit()
        st = entitlements.state(db, uid, cat=cat)
        row = db.get(UserPlan, uid)
        if kind == "subscription":
            item = catalog.tier(item_id, cat)
            if item is None or item.get("availability") != "available":
                raise BillingError("This plan is not available.")
            if st["active"] and not (row is not None and row.provider == "grant"):
                raise BillingConflict("You already have an active subscription. Change plan instead.")
        elif kind == "topup":
            item = catalog.pack(item_id, cat)
            if item is None:
                raise BillingError("This credit pack is not available.")
            if not st["active"]:
                raise SubscriptionRequired("Extra credits can be bought with an active subscription.")
        else:
            raise BillingError("Unknown purchase type.")
        _checkout_allowed(item)
        customer = row.provider_customer_id if row else None
        discount = founding.offer_for_checkout(db, uid, kind, item)
        if discount and providers.get().name == "stripe" and not discount["coupon"]:
            # Never let an eligible member pay the undiscounted price because of configuration.
            raise BillingUnavailable("The founding member discount is not configured yet. Please try again later.")
        db.commit()
    key = f"checkout:{uid}:{kind}:{item_id}:{'fd' if discount else 'std'}:{request_key or uuid.uuid4().hex}"
    try:
        session = providers.get().create_checkout(
            user_id=str(uid), email=email, kind=kind, item=item, country=country,
            withdrawal_waived=withdrawal_waived, customer_id=customer, idempotency_key=key, discount=discount,
        )
    except providers.ProviderError as exc:
        raise BillingUnavailable(f"The payment provider is unavailable: {exc}") from exc
    if discount:
        with _session() as db:
            founding.record_session(db, uid, session.session_id)
            db.commit()
    return {"provider": providers.get().name, "session_id": session.session_id, "url": session.url,
            "discount_percent": discount["percent"] if discount else None}


def complete_simulated_checkout(user_id: Any, session_id: str, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Sandbox only: deliver the simulator's payment events for a checkout the caller started."""
    if config.BILLING_MODE != "sandbox" or providers.get().name != "simulator":
        raise BillingUnavailable("Simulated payments are only available in sandbox mode.")
    sim = providers.get()
    s = sim.state.sessions.get(session_id)  # type: ignore[attr-defined]
    if s is None or s["user_id"] != str(_uuid(user_id)):
        raise BillingError("Unknown checkout session.")
    outcomes = []
    with _session() as db:
        for ev in sim.complete_checkout(session_id, now):  # type: ignore[attr-defined]
            outcomes.append(apply_event(db, ev, "simulator", now))
        db.commit()
    return {"outcomes": outcomes}


def change_plan(user_id: Any, tier_id: str, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Upgrade now (difference in monthly credits granted for the rest of the period) or downgrade at renewal."""
    _require_enabled()
    uid = _uuid(user_id)
    now = _now(now)
    cat = catalog.load()
    with _session() as db:
        _lock_account(db, uid)
        sync(db, uid, now)
        st = entitlements.state(db, uid, now, cat)
        new = catalog.tier(tier_id, cat)
        if not st["active"]:
            raise SubscriptionRequired("Start a subscription first.")
        if new is None or new.get("availability") != "available":
            raise BillingError("This plan is not available.")
        _checkout_allowed(new)
        row = db.get(UserPlan, uid)
        if row.provider == "grant":
            raise BillingConflict("Your free month is not a paid subscription. Choose a plan to subscribe instead.")
        cur = catalog.tier(row.plan_id, cat)
        if new["id"] == cur["id"]:
            if row.pending_plan_id:
                # A scheduled downgrade already switched the provider's renewal price; switch it back.
                try:
                    providers.get(row.provider).change_subscription(
                        row.provider_subscription_id, item=cur, immediate=False,
                        idempotency_key=f"revert:{row.provider_subscription_id}:{cur['id']}:{uuid.uuid4().hex[:12]}",
                    )
                except providers.ProviderError as exc:
                    raise BillingUnavailable(f"The payment provider is unavailable: {exc}") from exc
            row.pending_plan_id = None
            db.commit()
            return {"change": "none", "tier_id": cur["id"]}
        upgrade = new["rank"] > cur["rank"]
        try:
            providers.get(row.provider).change_subscription(
                row.provider_subscription_id, item=new, immediate=upgrade,
                idempotency_key=f"change:{row.provider_subscription_id}:{new['id']}:{uuid.uuid4().hex[:12]}",
            )
        except providers.PaymentDeclined as exc:
            raise PaymentFailed("The payment for the upgrade was declined, so your plan has not changed. "
                                "Update your payment method and try again.") from exc
        except providers.ProviderError as exc:
            raise BillingUnavailable(f"The payment provider is unavailable: {exc}") from exc
        if upgrade:
            row.plan_id = new["id"]
            row.pending_plan_id = None
            row.cancel_at_period_end = False
            row.status = "active"
            extra = int(new["monthly_credits"]) - int(cur["monthly_credits"])
            if extra > 0:
                lots.add_lot(
                    db, uid, kind="subscription",
                    source_key=f"upgrade:{row.provider_subscription_id}:{_aware(row.current_period_start).isoformat()}:{new['id']}",
                    credits=extra, reason="subscription", note=f"Upgrade to {new['name']}: additional monthly credits",
                    item_id=new["id"], expires_at=_aware(row.current_period_end),
                )
            db.commit()
            return {"change": "upgrade", "tier_id": new["id"], "effective": "now", "credits_added": max(0, extra)}
        row.pending_plan_id = new["id"]
        row.cancel_at_period_end = False
        if row.status == "canceled":
            row.status = "active"
        db.commit()
        return {"change": "downgrade", "tier_id": new["id"], "effective": _aware(row.current_period_end).isoformat()}


def set_cancel(user_id: Any, cancel: bool, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Stop (or resume) renewal. Access continues until the paid period ends."""
    _require_enabled()
    uid = _uuid(user_id)
    with _session() as db:
        _lock_account(db, uid)
        sync(db, uid, now)
        row = db.get(UserPlan, uid)
        st = entitlements.state(db, uid, now)
        if row is None or not st["active"]:
            raise BillingConflict("There is no active subscription.")
        if row.provider == "grant":
            raise BillingConflict("Your free month ends by itself and does not renew, so there is nothing to cancel.")
        if row.cancel_at_period_end != cancel:
            try:
                providers.get(row.provider).cancel_at_period_end(
                    row.provider_subscription_id, cancel=cancel,
                    idempotency_key=f"cancel:{row.provider_subscription_id}:{int(cancel)}:{uuid.uuid4().hex[:12]}",
                )
            except providers.ProviderError as exc:
                raise BillingUnavailable(f"The payment provider is unavailable: {exc}") from exc
            row.cancel_at_period_end = cancel
            row.canceled_at = _now(now) if cancel else None
            if row.status in ("active", "canceled"):
                row.status = "canceled" if cancel else "active"
            if cancel:
                row.pending_plan_id = None
        db.commit()
        return {"cancel_at_period_end": cancel, "access_until": _aware(row.current_period_end).isoformat()}


# --------------------------------------------------------------------------- cash refunds


def _payment_headroom(db: Session, pay: BillingPayment) -> int:
    pending = sum(r.amount_minor for r in db.query(BillingRefund).filter(
        BillingRefund.payment_id == pay.id, BillingRefund.status == "pending"))
    return max(0, pay.amount_minor - pay.refunded_minor - pending)


def reserved_credits(db: Session, uid: uuid.UUID) -> int:
    """Credits held by charged jobs that are still queued or running."""
    refunded = {r for (r,) in db.query(CreditLedgerEntry.run_id).filter(
        CreditLedgerEntry.user_id == uid, CreditLedgerEntry.reason == "refund")}
    held = 0
    for run_id, delta in (
        db.query(CreditLedgerEntry.run_id, CreditLedgerEntry.delta)
        .join(PipelineRun, PipelineRun.id == CreditLedgerEntry.run_id)
        .filter(CreditLedgerEntry.user_id == uid, CreditLedgerEntry.reason == "charge",
                PipelineRun.status.in_(ACTIVE_RUN_STATUSES))
    ):
        if run_id not in refunded:
            held += -delta
    return held


def _quote(db: Session, uid: uuid.UUID, now: datetime) -> Dict[str, Any]:
    cat = catalog.load()
    refunds_cfg = cat["refunds"]
    plan = db.get(UserPlan, uid)
    lines: List[Dict[str, Any]] = []
    totals: Dict[str, Dict[str, int]] = {}
    for lot in lots.live_lots(db, uid, now):
        if lot.kind != "purchase" or lot.payment_id is None or not lot.amount_minor:
            continue
        pay = db.get(BillingPayment, lot.payment_id)
        if pay is None or pay.status == "disputed":
            continue
        basis = money.refund_basis(lot, pay.country or (plan.billing_country if plan else None), refunds_cfg, now)
        unused = money.unused_value_minor(lot.amount_minor, lot.credits_total, lot.credits_remaining)
        headroom = _payment_headroom(db, pay)
        amount = money.refund_minor(lot.amount_minor, lot.credits_total, lot.credits_remaining, basis["rate_bps"], headroom)
        unused_minor = money.round_half_up(unused)
        lines.append({
            "lot_id": str(lot.id), "item_id": lot.item_id, "purchased_at": _aware(lot.created_at).isoformat() if lot.created_at else None,
            "credits_total": lot.credits_total, "credits_unused": lot.credits_remaining,
            "amount_paid_minor": lot.amount_minor, "currency": lot.currency,
            "unused_value_minor": unused_minor, "rate_bps": basis["rate_bps"], "basis": basis["basis"],
            "refund_minor": amount, "retained_minor": max(0, unused_minor - amount),
            "capped": amount < money.round_half_up(unused * basis["rate_bps"] / 10000),
            "formula": (f"{money.format_minor(lot.amount_minor, lot.currency)} x {lot.credits_remaining}/{lot.credits_total}"
                        f" = {money.format_minor(unused_minor, lot.currency)}; x {basis['rate_bps'] / 100:g}%"
                        f" = {money.format_minor(amount, lot.currency)}"),
        })
        t = totals.setdefault(lot.currency, {"refund_minor": 0, "retained_minor": 0, "unused_value_minor": 0, "credits": 0})
        t["refund_minor"] += amount
        t["retained_minor"] += max(0, unused_minor - amount)
        t["unused_value_minor"] += unused_minor
        t["credits"] += lot.credits_remaining
    st = entitlements.state(db, uid, now, cat)
    return {
        "lots": lines,
        "totals": [{"currency": c, **v} for c, v in sorted(totals.items())],
        "reserved_credits": reserved_credits(db, uid),
        "voluntary_rate_bps": refunds_cfg["voluntary_rate_bps"],
        "subscription": {
            "active": st["active"], "tier_id": st["tier_id"],
            "access_until": st["period_end"].isoformat() if st["period_end"] else None,
        },
    }


def refund_quote(user_id: Any, now: Optional[datetime] = None) -> Dict[str, Any]:
    _require_enabled()
    uid = _uuid(user_id)
    now = _now(now)
    with _session() as db:
        sync(db, uid, now)
        db.commit()
        return _quote(db, uid, now)


def cancel_and_refund(user_id: Any, *, request_id: str, expected: Optional[Mapping[str, int]] = None,
                      now: Optional[datetime] = None) -> Dict[str, Any]:
    """Stop renewal and refund unused purchased credits. Idempotent per ``request_id``.

    ``expected`` maps currency -> refund amount the user confirmed; if the amount changed in
    the meantime (credits used, another refund) nothing happens and the user sees the new figure.
    """
    _require_enabled()
    uid = _uuid(user_id)
    now = _now(now)
    request_id = (request_id or "").strip()[:80]
    if not request_id:
        raise BillingError("A request id is required.")
    with _session() as db:
        prior = db.query(BillingRefund).filter(BillingRefund.user_id == uid, BillingRefund.request_id == request_id).all()
        if prior:
            return {"request_id": request_id, "refunds": [_refund_out(r) for r in prior], "replayed": True}
        _lock_account(db, uid)
        sync(db, uid, now)
        quote = _quote(db, uid, now)
        if expected is not None:
            actual = {t["currency"]: t["refund_minor"] for t in quote["totals"]}
            if {k.upper(): int(v) for k, v in expected.items() if int(v) > 0} != {k: v for k, v in actual.items() if v > 0}:
                raise BillingConflict("The refundable amount changed. Review the new amount and confirm again.")
        created: List[BillingRefund] = []
        for line in quote["lots"]:
            if line["refund_minor"] <= 0 or line["credits_unused"] <= 0:
                continue
            lot = db.get(CreditLot, uuid.UUID(line["lot_id"]))
            n = lot.credits_remaining
            removed = lots.debit_balance(db, uid, n)
            if removed != n:
                raise BillingConflict("Your balance changed during the refund. Try again.")
            lot.credits_remaining -= n
            lot.credits_refunded += n
            ref = BillingRefund(
                user_id=uid, request_id=request_id, payment_id=lot.payment_id, lot_id=lot.id, credits=n,
                unused_value_minor=line["unused_value_minor"], rate_bps=line["rate_bps"], amount_minor=line["refund_minor"],
                currency=lot.currency, basis=line["basis"], status="pending",
                provider=db.get(BillingPayment, lot.payment_id).provider,
                idempotency_key=f"cashrefund:{lot.id}:{request_id}", attempts=0,
            )
            db.add(ref)
            db.flush()
            lots.write_entry(db, uid, -n, "credit_refund", f"credit_refund:{ref.id}",
                             note=f"{n} purchased credits refunded ({line['rate_bps'] / 100:g}%)")
            created.append(ref)
        row = db.get(UserPlan, uid)
        cancel_needed = bool(row and row.provider != "grant" and entitlements.state(db, uid, now)["active"]
                             and not row.cancel_at_period_end)
        db.commit()
        ids = [r.id for r in created]
    if cancel_needed:
        try:
            set_cancel(uid, True, now)
        except BillingError:
            logger.warning("Renewal could not be stopped during cancel-and-refund for %s; refund continues", uid)
    for rid in ids:
        execute_refund(rid)
    with _session() as db:
        rows = db.query(BillingRefund).filter(BillingRefund.id.in_(ids)).all() if ids else []
        return {"request_id": request_id, "refunds": [_refund_out(r) for r in rows], "replayed": False,
                "renewal_stopped": cancel_needed or bool(db.get(UserPlan, uid) and db.get(UserPlan, uid).cancel_at_period_end)}


def _finish_refund(db: Session, ref: BillingRefund, result: providers.RefundResult) -> None:
    if ref.status != "pending":
        return
    ref.provider_refund_id = result.provider_refund_id or ref.provider_refund_id
    ref.updated_at = _now()
    if result.status == "succeeded":
        pay = db.get(BillingPayment, ref.payment_id) if ref.payment_id else None
        if pay is not None:
            pay.refunded_minor = min(pay.amount_minor, pay.refunded_minor + ref.amount_minor)
            if pay.status != "disputed":
                pay.status = "refunded" if pay.refunded_minor >= pay.amount_minor else "partially_refunded"
        ref.status = "succeeded"
        ref.failure_reason = None
    elif result.status == "failed":
        ref.status = "failed"
        ref.failure_reason = result.reason or "Refused by the payment provider"
        _lock_account(db, ref.user_id)
        lot = db.get(CreditLot, ref.lot_id) if ref.lot_id else None
        if lot is not None:
            lot.credits_refunded -= ref.credits
            lot.credits_remaining += ref.credits
        db.execute(update(CreditAccount).where(CreditAccount.user_id == ref.user_id)
                   .values(balance=CreditAccount.balance + ref.credits, version=CreditAccount.version + 1))
        lots.write_entry(db, ref.user_id, ref.credits, "credit_refund_reversal", f"credit_refund_reversal:{ref.id}",
                         note="Refund failed; credits restored")
    db.flush()


def execute_refund(refund_id: uuid.UUID) -> str:
    """Call the provider for one pending refund (same idempotency key on every attempt)."""
    with _session() as db:
        ref = db.get(BillingRefund, refund_id)
        if ref is None or ref.status != "pending":
            return ref.status if ref else "missing"
        pay = db.get(BillingPayment, ref.payment_id) if ref.payment_id else None
        ref.attempts += 1
        db.commit()
        prov = providers.get(ref.provider)
        try:
            if ref.provider_refund_id:
                result = prov.refund_status(ref.provider_refund_id)
            else:
                result = prov.refund(payment_ref=pay.provider_payment_id, amount_minor=ref.amount_minor,
                                     currency=ref.currency, idempotency_key=ref.idempotency_key)
        except providers.ProviderError as exc:
            if exc.retryable:
                ref.failure_reason = f"Will retry: {exc}"
                db.commit()
                return "pending"
            result = providers.RefundResult("failed", None, str(exc))
        _finish_refund(db, ref, result)
        db.commit()
        return ref.status


def reconcile(limit: int = 100) -> Dict[str, int]:
    """Retry or poll pending refunds. Safe to run repeatedly (startup sweep or scheduled job)."""
    with _session() as db:
        ids = [r for (r,) in db.query(BillingRefund.id).filter(BillingRefund.status == "pending")
               .order_by(BillingRefund.created_at).limit(limit)]
    out: Dict[str, int] = {}
    for rid in ids:
        status = execute_refund(rid)
        out[status] = out.get(status, 0) + 1
    return out


def _refund_out(r: BillingRefund) -> Dict[str, Any]:
    return {
        "id": str(r.id), "request_id": r.request_id, "status": r.status, "credits": r.credits,
        "unused_value_minor": r.unused_value_minor, "rate_bps": r.rate_bps, "amount_minor": r.amount_minor,
        "currency": r.currency, "basis": r.basis, "attempts": r.attempts, "failure_reason": r.failure_reason,
        "created_at": _aware(r.created_at).isoformat() if r.created_at else None,
        "updated_at": _aware(r.updated_at).isoformat() if r.updated_at else None,
    }


# --------------------------------------------------------------------------- reads


def state(user_id: Any, now: Optional[datetime] = None) -> Dict[str, Any]:
    uid = _uuid(user_id)
    now = _now(now)
    cat = catalog.load()
    with _session() as db:
        if enabled():
            try:
                _lock_account(db, uid)
                sync(db, uid, now)
                db.commit()
            except IntegrityError:
                db.rollback()
        st = entitlements.state(db, uid, now, cat)
        row = db.get(UserPlan, uid)
        purchase = [
            {"id": str(l.id), "item_id": l.item_id, "credits_total": l.credits_total, "credits_remaining": l.credits_remaining,
             "credits_refunded": l.credits_refunded, "amount_minor": l.amount_minor, "currency": l.currency,
             "created_at": _aware(l.created_at).isoformat() if l.created_at else None}
            for l in db.query(CreditLot).filter(CreditLot.user_id == uid, CreditLot.kind == "purchase")
            .order_by(CreditLot.created_at.desc()).limit(50)
        ]
        sub_lot = next((l for l in lots.live_lots(db, uid, now) if l.kind == "subscription"), None)
        return {
            "mode": config.BILLING_MODE,
            "provider": providers.get().name if enabled() else None,
            "blocked_countries": sorted(config.BILLING_BLOCKED_COUNTRIES),
            "subscription": {
                "active": st["active"], "status": st["status"], "tier_id": st["tier_id"],
                "subscribed_tier_id": st["subscribed_tier_id"],
                "pending_tier_id": row.pending_plan_id if row else None,
                "period_start": st["period_start"].isoformat() if st["period_start"] else None,
                "period_end": st["period_end"].isoformat() if st["period_end"] else None,
                "cancel_at_period_end": st["cancel_at_period_end"], "country": st["country"],
                "read_only": st["read_only"], "complimentary": bool(row is not None and row.provider == "grant"),
            },
            "balances": {**lots.breakdown(db, uid, now), "reserved": reserved_credits(db, uid),
                         "subscription_expires_at": _aware(sub_lot.expires_at).isoformat() if sub_lot and sub_lot.expires_at else None},
            "entitlements": entitlements.summary(db, uid, st),
            "purchases": purchase,
        }


def history(user_id: Any) -> Dict[str, Any]:
    uid = _uuid(user_id)
    with _session() as db:
        payments = [
            {"id": str(p.id), "kind": p.kind, "item_id": p.item_id, "amount_minor": p.amount_minor, "currency": p.currency,
             "refunded_minor": p.refunded_minor, "status": p.status,
             "created_at": _aware(p.created_at).isoformat() if p.created_at else None}
            for p in db.query(BillingPayment).filter(BillingPayment.user_id == uid).order_by(BillingPayment.created_at.desc()).limit(100)
        ]
        refunds = [_refund_out(r) for r in db.query(BillingRefund).filter(BillingRefund.user_id == uid)
                   .order_by(BillingRefund.created_at.desc()).limit(100)]
        return {"payments": payments, "refunds": refunds}


# --------------------------------------------------------------------------- enforcement hooks


def authorize_run(db: Session, uid: uuid.UUID, tool: str, inputs: Mapping[str, Any], params: Mapping[str, Any],
                  now: Optional[datetime] = None) -> None:
    """Inside the run's charge transaction: lock, bring the subscription current, then check access and quotas."""
    _lock_account(db, uid)
    sync(db, uid, now)
    cat = catalog.load()
    st = entitlements.state(db, uid, now, cat)
    entitlements.check_run(st, tool, inputs, params, cat)
    if tool == "backtester":
        entitlements.check_backtest_quota(db, uid, st, cat)


def _signed_in(user_id: Any) -> uuid.UUID:
    try:
        return _uuid(user_id)
    except (ValueError, TypeError, AttributeError):
        raise SubscriptionRequired("Sign in with a subscribed account to use this.") from None


def require(user_id: Any, feature: str, message: Optional[str] = None) -> None:
    """Feature gate for endpoints that are not credit-charged runs (Lab jobs, uploads)."""
    if not enabled():
        return
    uid = _signed_in(user_id)
    with _session() as db:
        sync(db, uid)
        db.commit()
        entitlements.require_feature(entitlements.state(db, uid), feature, message=message)


def check_deployment(db: Session, user_id: Any, exclude_bot_id: Optional[str] = None) -> None:
    if not enabled():
        return
    uid = _signed_in(user_id)
    _lock_account(db, uid)
    sync(db, uid)
    entitlements.check_deployment(db, uid, entitlements.state(db, uid), exclude_bot_id=exclude_bot_id)
