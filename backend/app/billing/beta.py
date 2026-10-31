"""Complimentary Research access for accounts that existed before paid plans started.

Existing beta accounts get ``DAYS`` days of Research from the commercial activation date,
free of charge: no payment provider subscription is created and nothing renews. The plan is a
``grant`` row (like the ambassador free month) with ``source = "beta"``; its credits come in
30-day slices so the monthly allowance and the backtest quota behave as on a paid plan.

``grant`` never touches an account with a paid subscription or an earlier beta grant, so it
is safe to run twice. ``scripts/grant_beta_access.py`` is the only caller that writes.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.billing import catalog, entitlements, lots
from app.models import UserPlan

TIER = "research"
DAYS = 60
SLICE_DAYS = 30
SOURCE = "beta"


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def eligibility(db: Session, uid: uuid.UUID, now: datetime) -> Optional[str]:
    """None if the account can get the beta grant, else why not."""
    row = db.get(UserPlan, uid)
    if row is None:
        return None
    if row.source == SOURCE:
        return "already_granted"
    st = entitlements.state(db, uid, now)
    if st["active"] and row.provider not in ("grant", None):
        return "paid_subscription"
    return None


def grant(db: Session, uid: uuid.UUID, activation: datetime, now: datetime) -> Optional[str]:
    """Give ``uid`` the complimentary period. Returns None on success, else why it was skipped. Caller commits."""
    reason = eligibility(db, uid, now)
    if reason:
        return reason
    tier = catalog.tier(TIER)
    if tier is None:
        return "tier_unavailable"
    start = _aware(activation)
    end = start + timedelta(days=DAYS)
    if end <= now:
        return "period_over"
    row = db.get(UserPlan, uid)
    if row is None:
        row = UserPlan(user_id=uid, plan_id=TIER)
        db.add(row)
    elif row.provider == "grant" and entitlements.state(db, uid, now)["active"]:
        # The rest of a running ambassador month is added on top of the beta period.
        end += max(timedelta(0), _aware(row.current_period_end) - max(now, start))
    row.plan_id = TIER
    row.pending_plan_id = None
    row.status = "active"
    row.source = SOURCE
    row.provider = "grant"
    row.provider_subscription_id = None
    row.cancel_at_period_end = False
    row.canceled_at = None
    row.ended_at = None
    row.current_period_start = start
    row.current_period_end = end
    db.flush()
    top_up(db, row, now)
    return None


def top_up(db: Session, row: UserPlan, now: datetime) -> None:
    """Add the credits of every 30-day slice that has started. Idempotent per slice."""
    if row.provider != "grant" or row.source != SOURCE or row.status != "active":
        return
    from app.models import CreditLot

    tier = catalog.tier(row.plan_id)
    end = _aware(row.current_period_end)
    if tier is None or end is None or now >= end:
        return
    # current_period_start is the start of the latest slice granted (so period quotas reset
    # every 30 days); the beta period began that many slices earlier.
    granted = db.query(CreditLot.id).filter(CreditLot.user_id == row.user_id,
                                            CreditLot.source_key.like(f"beta:{row.user_id}:%")).count()
    origin = _aware(row.current_period_start) - timedelta(days=SLICE_DAYS * max(0, granted - 1))
    # Slices cover the beta period only; an ambassador month added on top brings its own credits.
    beta_end = min(end, origin + timedelta(days=DAYS))
    k = 0
    while True:
        s = origin + timedelta(days=SLICE_DAYS * k)
        if s > now or s >= beta_end:
            break
        lots.add_lot(db, row.user_id, kind="subscription", source_key=f"beta:{row.user_id}:{k}",
                     credits=int(tier["monthly_credits"]), reason="grant",
                     note=f"Complimentary {tier['name']} access for beta users: monthly credits", item_id=tier["id"],
                     expires_at=min(s + timedelta(days=SLICE_DAYS), beta_end))
        row.current_period_start = s
        k += 1
    db.flush()
