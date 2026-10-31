"""Server-side entitlements: what a user's subscription allows right now.

Only active while ``BILLING_MODE`` is not "off". Every run, Lab job, upload and deployment
path calls into here (via ``app.billing.service``), so the API, background jobs and legacy
endpoints share one decision. The frontend reads the same state to show locks; it never
decides access itself.

Without an active subscription an account stays signed in with read-only access to
everything it created (models, datasets, runs, bots); nothing is deleted.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

from sqlalchemy.orm import Session

from app import config
from app.billing import FeatureLocked, QuotaExceeded, SubscriptionRequired, catalog
from app.models import Bot, CreditLedgerEntry, UserPlan

ACTIVE_STATUSES = ("active", "canceled", "past_due")
ADVANCED_TRAINER_FIELDS = ("optimizer", "lr_schedule", "augmentation", "regularization")


def enabled() -> bool:
    return config.BILLING_MODE != "off"


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def state(db: Session, uid: uuid.UUID, now: Optional[datetime] = None,
          cat: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """The caller's subscription as entitlements see it."""
    now = now or datetime.now(timezone.utc)
    cat = cat or catalog.load()
    row = db.get(UserPlan, uid)
    tier = catalog.tier(row.plan_id, cat) if row else None
    end = _aware(row.current_period_end) if row else None
    grace = timedelta(days=int(cat["subscription"].get("past_due_grace_days", 0)))
    active = bool(
        row and tier and row.status in ACTIVE_STATUSES and end is not None
        and (now < end or (row.status == "past_due" and now < end + grace))
    )
    return {
        "tier": tier if active else None,
        "tier_id": tier["id"] if tier else None,
        "subscribed_tier_id": row.plan_id if row and tier else None,
        "status": "none" if not (row and tier) else row.status if active
        else ("expired" if row.status in ACTIVE_STATUSES else row.status),
        "active": active,
        "read_only": not active,
        "period_start": _aware(row.current_period_start) if row else None,
        "period_end": end,
        "cancel_at_period_end": bool(row.cancel_at_period_end) if row else False,
        "country": row.billing_country if row else None,
    }


def has_feature(st: Mapping[str, Any], feature: str) -> bool:
    return bool(st["tier"]) and feature in st["tier"].get("features", [])


def _locked(feature: str, message: str, cat: Dict[str, Any]) -> FeatureLocked:
    need = catalog.lowest_tier_with(feature, cat)
    return FeatureLocked(feature, need["id"] if need else None, need["name"] if need else None, message)


def require_active(st: Mapping[str, Any]) -> None:
    if not st["active"]:
        raise SubscriptionRequired(
            "Research tools need an active subscription. Your models, datasets and results stay available to view."
        )


def require_feature(st: Mapping[str, Any], feature: str, cat: Optional[Dict[str, Any]] = None,
                    message: Optional[str] = None) -> None:
    require_active(st)
    cat = cat or catalog.load()
    if not has_feature(st, feature):
        raise _locked(feature, message or f"{catalog.FEATURES.get(feature, feature)} is not included in your plan.", cat)


def _tier_allowing(cat: Dict[str, Any], limit: str, value: Any) -> Optional[Dict[str, Any]]:
    for t in cat["tiers"]:
        if t.get("availability") == "hidden":
            continue
        allowed = (t.get("limits") or {}).get(limit)
        if allowed is None or (isinstance(allowed, list) and value in allowed) or (
            isinstance(allowed, (int, float)) and not isinstance(allowed, bool) and value <= allowed
        ):
            return t
    return None


def _check_limit(st: Mapping[str, Any], cat: Dict[str, Any], limit: str, value: Any, message: str) -> None:
    if value is None:
        return
    allowed = (st["tier"].get("limits") or {}).get(limit)
    ok = allowed is None or (value in allowed if isinstance(allowed, list) else value <= allowed)
    if not ok:
        need = _tier_allowing(cat, limit, value)
        raise FeatureLocked(limit, need["id"] if need else None, need["name"] if need else None, message)


def run_requirements(tool: str, inputs: Mapping[str, Any], params: Mapping[str, Any]) -> Tuple[List[str], List[Tuple[str, Any, str]]]:
    """Features and limit checks a run needs. ``inputs`` are the pricing inputs; ``params`` the raw request."""
    features = ["research.run"]
    limits: List[Tuple[str, Any, str]] = []
    if tool == "trainer":
        arch = params.get("architecture") or "convolve-cnn-v1"
        limits.append(("architectures", arch, f"The {arch} architecture is not included in your plan."))
        if any(params.get(k) for k in ADVANCED_TRAINER_FIELDS):
            features.append("trainer.advanced")
        if params.get("transfer"):
            features.append("trainer.transfer")
        limits.append(("max_training_images", inputs.get("dataset_images"),
                       f"Your plan trains on up to {{limit}} images; this dataset has {inputs.get('dataset_images')}."))
        limits.append(("max_epochs", inputs.get("epochs"), f"Your plan trains for up to {{limit}} epochs."))
    elif tool == "training-chart-generator":
        limits.append(("generator_max_symbols", inputs.get("symbols"), "Your plan generates datasets for up to {limit} assets at a time."))
        limits.append(("generator_max_charts_per_label", inputs.get("charts_per_label"), "Your plan generates up to {limit} charts per label."))
    elif tool == "labeling-optimizer":
        from app.pricing import _date

        start, end = _date(params.get("start")), _date(params.get("end"))
        days = (end - start).days if start and end and end > start else 5 * 365
        limits.append(("optimizer_max_history_days", days,
                       "Your plan optimises labels on up to {limit} days of history."))
    return features, limits


def check_run(st: Mapping[str, Any], tool: str, inputs: Mapping[str, Any], params: Mapping[str, Any],
              cat: Optional[Dict[str, Any]] = None) -> None:
    cat = cat or catalog.load()
    require_active(st)
    features, limits = run_requirements(tool, inputs, params)
    for f in features:
        require_feature(st, f, cat)
    for name, value, message in limits:
        allowed = (st["tier"].get("limits") or {}).get(name)
        _check_limit(st, cat, name, value, message.replace("{limit}", str(allowed)))


def _quota(st: Mapping[str, Any], name: str) -> Optional[int]:
    value = (st["tier"].get("quotas") or {}).get(name) if st["tier"] else 0
    return None if value is None else int(value)


def backtests_used(db: Session, uid: uuid.UUID, since: Optional[datetime]) -> int:
    """Backtests charged this period that were not refunded (failed or cancelled-while-queued runs don't count)."""
    q = db.query(CreditLedgerEntry.run_id, CreditLedgerEntry.created_at).filter(
        CreditLedgerEntry.user_id == uid, CreditLedgerEntry.reason == "charge", CreditLedgerEntry.tool == "backtester",
    )
    # Compared in Python at whole seconds: server timestamps can be second-precision and naive.
    floor = _aware(since).replace(microsecond=0) if since is not None else None
    charged = {r for r, created in q if r and (floor is None or (_aware(created) or floor) >= floor)}
    if not charged:
        return 0
    refunded = {
        r for (r,) in db.query(CreditLedgerEntry.run_id).filter(
            CreditLedgerEntry.user_id == uid, CreditLedgerEntry.reason == "refund", CreditLedgerEntry.run_id.in_(charged)
        )
    }
    return len(charged - refunded)


def check_backtest_quota(db: Session, uid: uuid.UUID, st: Mapping[str, Any], cat: Optional[Dict[str, Any]] = None) -> None:
    limit = _quota(st, "backtests_per_period")
    if limit is None:
        return
    used = backtests_used(db, uid, st["period_start"])
    if used >= limit:
        cat = cat or catalog.load()
        higher = next((t for t in cat["tiers"] if t.get("availability") != "hidden" and t["rank"] > st["tier"]["rank"]), None)
        raise QuotaExceeded("backtests_per_period", limit, used, higher["id"] if higher else None,
                            higher["name"] if higher else None,
                            f"Your plan includes {limit} backtests per billing period and all are used. "
                            "The count resets when the period renews. Extra credits do not raise this limit.")


def active_deployments(db: Session, uid: uuid.UUID, exclude_bot_id: Optional[str] = None) -> int:
    q = db.query(Bot.id).filter(Bot.user_id == str(uid), Bot.lifecycle_state == "active")
    if exclude_bot_id:
        q = q.filter(Bot.id != exclude_bot_id)
    return q.count()


def check_deployment(db: Session, uid: uuid.UUID, st: Mapping[str, Any], cat: Optional[Dict[str, Any]] = None,
                     exclude_bot_id: Optional[str] = None) -> None:
    cat = cat or catalog.load()
    require_feature(st, "deploy", cat)
    limit = _quota(st, "active_deployments")
    if limit is None:
        return
    used = active_deployments(db, uid, exclude_bot_id)
    if used >= limit:
        higher = next((t for t in cat["tiers"] if t.get("availability") != "hidden" and t["rank"] > st["tier"]["rank"]), None)
        raise QuotaExceeded("active_deployments", limit, used, higher["id"] if higher else None,
                            higher["name"] if higher else None,
                            f"Your plan allows {limit} active paper deployment{'s' if limit != 1 else ''}. "
                            "Pause or close one first.")


def summary(db: Session, uid: uuid.UUID, st: Mapping[str, Any]) -> Dict[str, Any]:
    tier = st["tier"]
    quotas: Dict[str, Any] = {}
    if tier:
        quotas = {
            "backtests_per_period": {"limit": _quota(st, "backtests_per_period"),
                                     "used": backtests_used(db, uid, st["period_start"])},
            "active_deployments": {"limit": _quota(st, "active_deployments"), "used": active_deployments(db, uid)},
        }
    return {"features": list(tier.get("features", [])) if tier else [], "limits": tier.get("limits", {}) if tier else {},
            "quotas": quotas}


def owners_without_access(db: Session, owner_ids: Iterable[str], now: Optional[datetime] = None) -> set:
    """Owners whose scheduled bots must not run (no active subscription with deployments)."""
    cat = catalog.load()
    out = set()
    for oid in set(owner_ids):
        try:
            uid = uuid.UUID(str(oid))
        except (ValueError, TypeError):
            out.add(oid)
            continue
        st = state(db, uid, now, cat)
        if not has_feature(st, "deploy"):
            out.add(oid)
    return out
