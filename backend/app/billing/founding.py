"""Founding beta member offer: FOUNDING_DISCOUNT_PERCENT off the first subscription invoice.

Eligible: an account whose server-recorded ``profiles.created_at`` falls in the beta window
[BETA_WINDOW_START, BETA_WINDOW_END) and that has never paid for a subscription. The window has
no default start, so nobody is eligible until it is configured; an unset end means the beta is
still open (no deadline is shown).

Redemption: when such an account starts a subscription checkout (Starter, Research or
Professional; never a credit pack), the server attaches the discount itself. With Stripe that
is the coupon STRIPE_FOUNDING_COUPON (``duration=once``, so only the first invoice is reduced)
and promotion-code entry is switched off for that session, so it cannot be combined with other
codes. The offer is marked redeemed when the discounted first payment arrives; an account that
has paid for any subscription is no longer eligible. Nothing is enrolled or charged
automatically, and the offer belongs to the account (it is never a shareable code).
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Mapping, Optional

from sqlalchemy.orm import Session

from app import config
from app.models import BillingPayment, FoundingDiscount, Profile

TIERS = ("starter", "research", "professional")


def _parse(value: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def window() -> Dict[str, Optional[datetime]]:
    return {"start": _parse(config.BETA_WINDOW_START), "end": _parse(config.BETA_WINDOW_END)}


def coupon_id() -> str:
    return os.getenv("STRIPE_FOUNDING_COUPON", "").strip()


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def ineligibility(db: Session, uid: uuid.UUID) -> Optional[str]:
    """None when the account can use the offer now, else why not."""
    percent = config.FOUNDING_DISCOUNT_PERCENT
    w = window()
    if not percent or w["start"] is None:
        return "no_offer"
    profile = db.get(Profile, uid)
    created = _aware(profile.created_at) if profile is not None else None
    if created is None or created < w["start"] or (w["end"] is not None and created >= w["end"]):
        return "outside_beta_window"
    row = db.get(FoundingDiscount, uid)
    if row is not None and row.redeemed_at is not None:
        return "redeemed"
    if db.query(BillingPayment.id).filter(BillingPayment.user_id == uid, BillingPayment.kind == "subscription").first():
        return "not_first_subscription"
    return None


def state(db: Session, uid: uuid.UUID) -> Dict[str, Any]:
    reason = ineligibility(db, uid)
    row = db.get(FoundingDiscount, uid)
    if reason is None:
        status = "available"
    elif reason == "redeemed":
        status = "redeemed"
    else:
        status = "not_eligible"
    return {
        "status": status,
        "reason": reason,
        "percent": config.FOUNDING_DISCOUNT_PERCENT,
        "applies_to": list(TIERS),
        "first_invoice_only": True,
        "redeemed_at": row.redeemed_at.isoformat() if row is not None and row.redeemed_at else None,
    }


def public_offer() -> Dict[str, Any]:
    """For public pages: whether accounts created now qualify. No deadline unless one is set."""
    w = window()
    now = datetime.now(timezone.utc)
    open_now = (
        bool(config.FOUNDING_DISCOUNT_PERCENT) and w["start"] is not None and w["start"] <= now
        and (w["end"] is None or now < w["end"])
    )
    return {
        "open": open_now,
        "percent": config.FOUNDING_DISCOUNT_PERCENT,
        "applies_to": list(TIERS),
        "ends_at": w["end"].isoformat() if open_now and w["end"] is not None else None,
    }


def offer_for_checkout(db: Session, uid: uuid.UUID, kind: str, item: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    """The discount to attach to this checkout, or None. Caller commits."""
    if kind != "subscription" or item.get("id") not in TIERS or ineligibility(db, uid) is not None:
        return None
    row = db.get(FoundingDiscount, uid)
    if row is None:
        row = FoundingDiscount(user_id=uid, percent=config.FOUNDING_DISCOUNT_PERCENT)
        db.add(row)
    row.offered_at = datetime.now(timezone.utc)
    db.flush()
    return {"percent": row.percent, "coupon": coupon_id()}


def record_session(db: Session, uid: uuid.UUID, session_id: str) -> None:
    row = db.get(FoundingDiscount, uid)
    if row is not None and row.redeemed_at is None:
        row.checkout_session_id = session_id


def mark_redeemed(db: Session, uid: uuid.UUID, ev: Mapping[str, Any], now: datetime) -> bool:
    """On the discounted first subscription payment. Idempotent; never un-redeems."""
    if not ev.get("founding_discount"):
        return False
    row = db.get(FoundingDiscount, uid)
    if row is None:
        row = FoundingDiscount(user_id=uid, percent=config.FOUNDING_DISCOUNT_PERCENT)
        db.add(row)
    if row.redeemed_at is not None:
        return False
    row.redeemed_at = now
    row.subscription_ref = ev.get("subscription_ref")
    row.payment_ref = ev.get("payment_ref")
    db.flush()
    return True
