"""Ways to earn promotional credits besides the feedback questionnaire (``app.services.feedback``).

Citation bonus
    An account cites Convolve on a website or in a project and sends the address and/or a file.
    An administrator reviews it; approval grants 50 credits, once per account.

Ambassador programme
    An account creates one personal invite code. A new account that signs up with it is linked
    to the ambassador. The first paid subscription payment of that account decides the reward:

    * Starter: the ambassador gets 10 promotional credits, the new member 5;
    * Research or higher: the new member gets 20 promotional credits and the ambassador one
      free month of Research - without an active paid subscription a complimentary month
      (nothing is charged, nothing renews); with one, a credit of the Research monthly price at
      the payment provider, deducted from the ambassador's next invoices. At most 12 per year.

    If that payment is later refunded in full or disputed, whatever of both rewards is still
    unused is withdrawn: remaining credits, the complimentary month, an invoice credit not yet
    applied.

Every grant is a credit lot with a unique source key and every reward is recorded on the
referral row inside the payment's transaction, so a redelivered webhook never pays twice.
Promotional credits are ``grant`` lots: never cash-refundable, not transferable.
"""

from __future__ import annotations

import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import PurePath
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import config
from app.billing import catalog, entitlements, lots, providers
from app.db import SessionLocal
from app.models import (
    BillingPayment, CitationClaim, CreditAccount, CreditLot, FeedbackResponse, Profile, Referral, ReferralCode, UserPlan,
)

logger = logging.getLogger(__name__)

CITATION_CREDITS = 50
# The free month is of this tier; new members on it or a higher tier earn the ambassador one.
REFERRAL_TIER = "research"
REFEREE_CREDITS = 20
# New members whose first plan ranks below REFERRAL_TIER (Starter).
ENTRY_REFEREE_CREDITS = 5
ENTRY_REFERRER_CREDITS = 10
# Free months (or invoice credits) per rolling year; further invites still give the new member their credits.
MAX_REWARDS_PER_YEAR = 12
# An invite code can be added only by an account this young that has never paid for a subscription.
CLAIM_WINDOW_DAYS = 14
MAX_CLAIMS_PER_ACCOUNT = 5
CITATION_MAX_BYTES = 5 * 1024 * 1024
NOTE_MAX = 2000
CITATION_TYPES = {"application/pdf": b"%PDF", "image/png": b"\x89PNG", "image/jpeg": b"\xff\xd8\xff", "image/webp": b"RIFF"}
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 8
_CODE_RE = re.compile(r"^[A-Z0-9]{4,16}$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _iso(value: Optional[datetime]) -> Optional[str]:
    return _aware(value).isoformat() if value is not None else None


def _err(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _lock(db: Session, uid: uuid.UUID) -> None:
    if db.get(CreditAccount, uid) is None:
        db.add(CreditAccount(user_id=uid, balance=0, version=1))
        db.flush()
    db.query(CreditAccount).filter(CreditAccount.user_id == uid).with_for_update().one()


def normalise_code(code: Optional[str]) -> Optional[str]:
    c = re.sub(r"[\s-]", "", code or "").upper()
    return c if _CODE_RE.match(c) else None


# --------------------------------------------------------------------------- ambassador codes


def get_or_create_code(user_id: str) -> str:
    uid = uuid.UUID(user_id)
    db = SessionLocal()
    try:
        row = db.get(ReferralCode, uid)
        if row is not None:
            return row.code
        for _ in range(8):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            db.add(ReferralCode(user_id=uid, code=code))
            try:
                db.commit()
                return code
            except IntegrityError:
                db.rollback()
                row = db.get(ReferralCode, uid)
                if row is not None:
                    return row.code
        raise _err(503, "code_unavailable", "Your code could not be created. Try again.")
    finally:
        db.close()


def check_code(code: Optional[str]) -> bool:
    norm = normalise_code(code)
    if norm is None:
        return False
    db = SessionLocal()
    try:
        return db.query(ReferralCode.user_id).filter(ReferralCode.code == norm).first() is not None
    finally:
        db.close()


def claim_referral(user_id: str, code: Optional[str], now: Optional[datetime] = None) -> Dict[str, Any]:
    """Link a new account to the ambassador whose code it signed up with."""
    now = now or _now()
    uid = uuid.UUID(user_id)
    norm = normalise_code(code)
    invalid = _err(404, "invalid_code", "This invite code is not valid.")
    if norm is None:
        raise invalid
    db = SessionLocal()
    try:
        owner = db.query(ReferralCode).filter(ReferralCode.code == norm).first()
        if owner is None:
            raise invalid
        if owner.user_id == uid:
            raise _err(409, "own_code", "You cannot use your own invite code.")
        existing = db.query(Referral).filter(Referral.referee_id == uid).first()
        if existing is not None:
            if existing.code == norm:
                return {"status": existing.status, "credits_on_subscribe": REFEREE_CREDITS, "rewards": reward_table()}
            raise _err(409, "already_referred", "This account has already used an invite code.")
        profile = db.get(Profile, uid)
        created = _aware(profile.created_at) if profile is not None else None
        paid_before = db.query(BillingPayment.id).filter(
            BillingPayment.user_id == uid, BillingPayment.kind == "subscription").first() is not None
        if profile is None or paid_before or (created is not None and now - created > timedelta(days=CLAIM_WINDOW_DAYS)):
            raise _err(409, "not_new", "Invite codes can only be used by new accounts.")
        if db.query(Referral.id).filter(Referral.referrer_id == uid, Referral.referee_id == owner.user_id).first():
            raise _err(409, "mutual", "Two accounts cannot invite each other.")
        db.add(Referral(referrer_id=owner.user_id, referee_id=uid, code=norm, status="pending"))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise _err(409, "already_referred", "This account has already used an invite code.")
        return {"status": "pending", "credits_on_subscribe": REFEREE_CREDITS, "rewards": reward_table()}
    finally:
        db.close()


def reward_for(tier: Dict[str, Any], cat: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """What an invite earns when the new member's first paid plan is ``tier``."""
    month_tier = catalog.tier(REFERRAL_TIER, cat)
    if month_tier is not None and int(tier.get("rank", 0)) >= int(month_tier.get("rank", 0)):
        return {"referee_credits": REFEREE_CREDITS, "referrer": "free_month", "referrer_credits": 0}
    return {"referee_credits": ENTRY_REFEREE_CREDITS, "referrer": "credits", "referrer_credits": ENTRY_REFERRER_CREDITS}


def reward_table(cat: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    cat = cat or catalog.load()
    month_tier = catalog.tier(REFERRAL_TIER, cat)
    out = []
    for t in catalog.public(cat)["tiers"]:
        r = reward_for(t, cat)
        out.append({"tier_id": t["id"], "tier_name": t["name"], **r,
                    "free_month_tier": month_tier["name"] if r["referrer"] == "free_month" and month_tier else None,
                    "invoice_credit": dict(month_tier["price"]) if r["referrer"] == "free_month" and month_tier else None})
    return out


def grant_free_month(db: Session, uid: uuid.UUID, tier: Dict[str, Any], now: datetime, source_key: str) -> None:
    """A complimentary month of ``tier``: starts now, or extends a complimentary month already running."""
    row = db.get(UserPlan, uid)
    st = entitlements.state(db, uid, now)
    if row is not None and st["active"] and row.provider == "grant":
        end = providers.add_month(_aware(row.current_period_end))
        row.current_period_end = end
    else:
        if row is None:
            row = UserPlan(user_id=uid, plan_id=tier["id"])
            db.add(row)
        end = providers.add_month(now)
        row.plan_id = tier["id"]
        row.pending_plan_id = None
        row.status = "active"
        row.source = "referral"
        row.provider = "grant"
        row.provider_subscription_id = None
        row.cancel_at_period_end = False
        row.canceled_at = None
        row.ended_at = None
        row.current_period_start = now
        row.current_period_end = end
    db.flush()
    lots.add_lot(db, uid, kind="subscription", source_key=source_key, credits=int(tier["monthly_credits"]),
                 reason="grant", note=f"Ambassador reward: one free month of {tier['name']}", item_id=tier["id"],
                 expires_at=end)


def _rewards_this_year(db: Session, referrer: uuid.UUID, now: datetime) -> int:
    since = now - timedelta(days=365)
    rows = db.query(Referral.rewarded_at).filter(
        Referral.referrer_id == referrer, Referral.status == "rewarded",
        Referral.referrer_reward.in_(("free_month", "invoice_credit")),
    )
    return sum(1 for (at,) in rows if at is not None and _aware(at) >= since)


def _reward_referrer(db: Session, ref: Referral, now: datetime) -> str:
    if _rewards_this_year(db, ref.referrer_id, now) >= MAX_REWARDS_PER_YEAR:
        return "limit_reached"
    cat = catalog.load()
    tier = catalog.tier(REFERRAL_TIER, cat)
    if tier is None:
        return "unavailable"
    rid = ref.referrer_id
    _lock(db, rid)
    st = entitlements.state(db, rid, now, cat)
    row = db.get(UserPlan, rid)
    if st["active"] and row is not None and row.provider not in (None, "grant") and row.provider_customer_id:
        providers.get(row.provider).credit_customer(
            row.provider_customer_id, amount_minor=int(tier["price"]["amount_minor"]), currency=tier["price"]["currency"],
            description=f"Convolve ambassador reward: one free month of {tier['name']}",
            idempotency_key=f"referral-credit:{ref.id}",
        )
        return "invoice_credit"
    grant_free_month(db, rid, tier, now, f"referral-month:{ref.id}")
    return "free_month"


def on_subscription_paid(db: Session, uid: uuid.UUID, pay: Optional[BillingPayment], now: datetime) -> Optional[str]:
    """Called inside the payment's transaction. Rewards a pending referral on its first paid subscription payment."""
    if pay is None or pay.kind != "subscription" or int(pay.amount_minor or 0) <= 0:
        return None
    ref = db.query(Referral).filter(Referral.referee_id == uid, Referral.status == "pending").first()
    if ref is None:
        return None
    cat = catalog.load()
    tier = catalog.tier(pay.item_id, cat)
    if tier is None:
        return None
    reward = reward_for(tier, cat)
    n = int(reward["referee_credits"])
    lots.add_lot(db, uid, kind="grant", source_key=f"referral-welcome:{ref.id}", credits=n, reason="grant",
                 note=f"Invited by a Convolve ambassador: {n} promotional credits (non-refundable)")
    ref.referee_credits = n
    ref.referee_tier = tier["id"]
    ref.payment_id = pay.id
    if reward["referrer"] == "credits":
        m = int(reward["referrer_credits"])
        _lock(db, ref.referrer_id)
        lots.add_lot(db, ref.referrer_id, kind="grant", source_key=f"referral-credits:{ref.id}", credits=m,
                     reason="grant", note=f"Ambassador reward: {m} promotional credits (non-refundable)")
        ref.referrer_credits = m
        ref.referrer_reward = "credits"
    else:
        ref.referrer_reward = _reward_referrer(db, ref, now)
    ref.status = "rewarded"
    ref.rewarded_at = now
    db.flush()
    return ref.referrer_reward


def _minus_month(value: datetime) -> datetime:
    import calendar

    year, month = (value.year - 1, 12) if value.month == 1 else (value.year, value.month - 1)
    return value.replace(year=year, month=month, day=min(value.day, calendar.monthrange(year, month)[1]))


def _withdraw_lot(db: Session, uid: uuid.UUID, source_key: str, now: datetime) -> int:
    lot = db.query(CreditLot).filter(CreditLot.source_key == source_key).first()
    if lot is None or lot.credits_remaining <= 0:
        return 0
    _lock(db, uid)
    n = lots.debit_balance(db, uid, lot.credits_remaining)
    lot.credits_remaining = 0
    lot.expired_at = lot.expired_at or now
    if n:
        lots.write_entry(db, uid, -n, "referral_reversal", f"referral_reversal:{lot.id}",
                         note="Invite reward withdrawn: the invited account's payment was refunded or disputed")
    return n


def reverse_for_payment(db: Session, pay: BillingPayment, now: datetime) -> Optional[str]:
    """The payment that earned an invite reward was refunded in full or disputed: withdraw what is still unused."""
    ref = db.query(Referral).filter(Referral.payment_id == pay.id, Referral.status == "rewarded").first()
    if ref is None:
        return None
    _withdraw_lot(db, ref.referee_id, f"referral-welcome:{ref.id}", now)
    rid = ref.referrer_id
    if ref.referrer_reward == "credits":
        _withdraw_lot(db, rid, f"referral-credits:{ref.id}", now)
    elif ref.referrer_reward == "free_month":
        _withdraw_lot(db, rid, f"referral-month:{ref.id}", now)
        row = db.get(UserPlan, rid)
        if row is not None and row.provider == "grant" and row.current_period_end is not None and row.status == "active":
            end = _minus_month(_aware(row.current_period_end))
            if end <= now:
                end = now
                row.status = "expired"
                row.ended_at = now
            row.current_period_end = end
            for lot in db.query(CreditLot).filter(CreditLot.user_id == rid, CreditLot.kind == "subscription",
                                                  CreditLot.expired_at.is_(None), CreditLot.expires_at.isnot(None)):
                if _aware(lot.expires_at) > end:
                    lot.expires_at = end
            lots.expire_due(db, rid, now)
    elif ref.referrer_reward == "invoice_credit":
        row = db.get(UserPlan, rid)
        tier = catalog.tier(REFERRAL_TIER)
        if row is not None and row.provider_customer_id and row.provider not in (None, "grant") and tier is not None:
            providers.get(row.provider).reverse_customer_credit(
                row.provider_customer_id, amount_minor=int(tier["price"]["amount_minor"]),
                currency=tier["price"]["currency"], idempotency_key=f"referral-credit-reversal:{ref.id}",
                description="Convolve ambassador reward withdrawn: the invited account's payment was refunded",
            )
    ref.status = "reversed"
    ref.reversed_at = now
    db.flush()
    return ref.referrer_reward


# --------------------------------------------------------------------------- citation bonus


def _sniff_ok(data: bytes, ctype: str) -> bool:
    magic = CITATION_TYPES.get(ctype)
    if magic is None or not data.startswith(magic):
        return False
    return ctype != "image/webp" or data[8:12] == b"WEBP"


def submit_citation(user_id: str, *, url: Optional[str], note: Optional[str], file_name: Optional[str],
                    content_type: Optional[str], data: Optional[bytes]) -> Dict[str, Any]:
    uid = uuid.UUID(user_id)
    url = (url or "").strip()
    note = (note or "").strip()
    if url:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc or len(url) > 500:
            raise _err(422, "invalid_url", "Enter the full address of the page, starting with https://.")
    if not data:
        data = None
    if not url and data is None:
        raise _err(422, "missing_proof", "Add the address where you cite Convolve, or attach a file.")
    if len(note) > NOTE_MAX:
        raise _err(422, "note_too_long", f"Keep the note under {NOTE_MAX} characters.")
    ctype = None
    if data is not None:
        if len(data) > CITATION_MAX_BYTES:
            raise _err(413, "file_too_large", "Files can be up to 5 MB.")
        ctype = (content_type or "").split(";")[0].strip().lower()
        if not _sniff_ok(data, ctype):
            raise _err(415, "unsupported_file", "Attach a PDF, PNG, JPEG or WebP file.")
    db = SessionLocal()
    try:
        _lock(db, uid)
        claims = db.query(CitationClaim).filter(CitationClaim.user_id == uid).all()
        if any(c.status == "approved" for c in claims):
            raise _err(409, "already_rewarded", "You have already received the citation bonus. Thank you!")
        if any(c.status == "pending" for c in claims):
            raise _err(409, "pending", "Your citation is being reviewed. You will get the credits within 24 hours of approval.")
        if len(claims) >= MAX_CLAIMS_PER_ACCOUNT:
            raise _err(409, "too_many", "Please contact us about your citation.")
        row = CitationClaim(
            user_id=uid, url=url or None, note=note or None,
            file_name=(PurePath(file_name or "").name[:200] or "citation") if data is not None else None,
            content_type=ctype, file_bytes=data, status="pending",
        )
        db.add(row)
        db.commit()
        return {"id": str(row.id), "status": "pending"}
    finally:
        db.close()


def notify_citation(claim_id: Optional[str]) -> None:
    """Email the administrator that a citation waits for review, if an email provider is configured."""
    if not claim_id or not (config.RESEND_API_KEY and config.CONTACT_NOTIFY_EMAIL and config.CONTACT_FROM_EMAIL):
        return
    import httpx

    db = SessionLocal()
    try:
        row = db.get(CitationClaim, uuid.UUID(claim_id))
        if row is None:
            return
        email = (db.get(Profile, row.user_id).email if db.get(Profile, row.user_id) else None) or str(row.user_id)
        text = (f"Account: {email}\nAddress: {row.url or '-'}\nFile: {row.file_name or '-'}\n\n{row.note or ''}\n\n"
                "Review it in Convolve under /dashboard/admin/citations (administrator accounts only).")
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {config.RESEND_API_KEY}"},
            json={"from": config.CONTACT_FROM_EMAIL, "to": [config.CONTACT_NOTIFY_EMAIL],
                  "subject": "Convolve: citation bonus to review", "text": text},
            timeout=15,
        )
        if resp.status_code >= 300:
            logger.warning("Citation notification failed with status %s; the claim is stored", resp.status_code)
    except Exception:
        logger.exception("Citation notification failed; the claim is stored")
    finally:
        db.close()


def _claim_out(c: CitationClaim, email: Optional[str] = None) -> Dict[str, Any]:
    out = {
        "id": str(c.id), "url": c.url, "note": c.note, "file_name": c.file_name, "has_file": c.file_bytes is not None,
        "status": c.status, "review_note": c.review_note, "credits_granted": c.credits_granted,
        "created_at": _iso(c.created_at), "reviewed_at": _iso(c.reviewed_at),
    }
    if email is not None:
        out.update({"user_id": str(c.user_id), "email": email})
    return out


def admin_citations(status: Optional[str] = None, limit: int = 200, offset: int = 0) -> Dict[str, Any]:
    db = SessionLocal()
    try:
        q = db.query(CitationClaim, Profile.email).outerjoin(Profile, Profile.id == CitationClaim.user_id)
        if status:
            q = q.filter(CitationClaim.status == status)
        total = q.count()
        rows = q.order_by(CitationClaim.created_at.desc()).offset(offset).limit(limit).all()
        return {"total": total, "claims": [_claim_out(c, email or "") for c, email in rows]}
    finally:
        db.close()


def admin_citation_file(claim_id: str) -> Tuple[bytes, str, str]:
    db = SessionLocal()
    try:
        row = db.get(CitationClaim, _parse_id(claim_id))
        if row is None or row.file_bytes is None:
            raise HTTPException(status_code=404, detail="Not found")
        return row.file_bytes, row.content_type or "application/octet-stream", row.file_name or "citation"
    finally:
        db.close()


def _parse_id(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Not found") from None


def review_citation(admin_id: str, claim_id: str, *, approve: bool, note: Optional[str] = None,
                    now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or _now()
    db = SessionLocal()
    try:
        row = db.get(CitationClaim, _parse_id(claim_id))
        if row is None:
            raise HTTPException(status_code=404, detail="Not found")
        _lock(db, row.user_id)
        db.refresh(row)
        if row.status != "pending":
            raise _err(409, "already_reviewed", f"This claim was already {row.status}.")
        if approve:
            lot = lots.add_lot(db, row.user_id, kind="grant", source_key=f"citation:{row.user_id}",
                               credits=CITATION_CREDITS, reason="grant",
                               note=f"Citation bonus: {CITATION_CREDITS} promotional credits (non-refundable)")
            if lot is None:
                raise _err(409, "already_rewarded", "This account already received the citation bonus.")
            row.credits_granted = CITATION_CREDITS
        row.status = "approved" if approve else "rejected"
        row.review_note = (note or "").strip()[:NOTE_MAX] or None
        row.reviewed_by = uuid.UUID(admin_id)
        row.reviewed_at = now
        db.commit()
        return _claim_out(row)
    except IntegrityError:
        db.rollback()
        raise _err(409, "already_rewarded", "This account already received the citation bonus.")
    finally:
        db.close()


# --------------------------------------------------------------------------- account view


def status(user_id: str) -> Dict[str, Any]:
    from app.services.feedback import BONUS_CREDITS

    uid = uuid.UUID(user_id)
    db = SessionLocal()
    try:
        code = db.get(ReferralCode, uid)
        invited: List[Referral] = db.query(Referral).filter(Referral.referrer_id == uid).all()
        referred = db.query(Referral).filter(Referral.referee_id == uid).first()
        claims = db.query(CitationClaim).filter(CitationClaim.user_id == uid).order_by(CitationClaim.created_at.desc()).all()
        questionnaire = db.query(FeedbackResponse.id).filter(FeedbackResponse.user_id == uid).first() is not None
        plan = db.get(UserPlan, uid)
        tier = catalog.tier(REFERRAL_TIER)
        latest = claims[0] if claims else None
        return {
            "questionnaire": {"credits": BONUS_CREDITS, "completed": questionnaire},
            "citation": {
                "credits": CITATION_CREDITS,
                "status": "approved" if any(c.status == "approved" for c in claims) else (latest.status if latest else "none"),
                "claims": [_claim_out(c) for c in claims],
                "max_file_bytes": CITATION_MAX_BYTES,
            },
            "ambassador": {
                "code": code.code if code else None,
                "referee_credits": REFEREE_CREDITS,
                "reward_tier": tier["name"] if tier else None,
                "rewards": reward_table(),
                "invited": len(invited),
                "subscribed": sum(1 for r in invited if r.status == "rewarded"),
                "months_earned": sum(1 for r in invited if r.status == "rewarded"
                                     and r.referrer_reward in ("free_month", "invoice_credit")),
                "credits_earned": sum(int(r.referrer_credits or 0) for r in invited if r.status == "rewarded"),
                "max_rewards_per_year": MAX_REWARDS_PER_YEAR,
                "free_month_until": _iso(plan.current_period_end) if plan is not None and plan.provider == "grant"
                and entitlements.state(db, uid)["active"] else None,
            },
            "referred": {
                "status": referred.status,
                "credits": int(referred.referee_credits or 0) if referred.status != "pending" else None,
                "rewards": reward_table(),
            } if referred else None,
        }
    finally:
        db.close()


def export_for(db: Session, uid: uuid.UUID) -> Dict[str, Any]:
    code = db.get(ReferralCode, uid)
    return {
        "ambassador_code": code.code if code else None,
        "invited_accounts": db.query(Referral).filter(Referral.referrer_id == uid).count(),
        "referred_by_ambassador": db.query(Referral.id).filter(Referral.referee_id == uid).first() is not None,
        "citation_claims": [_claim_out(c) for c in db.query(CitationClaim).filter(CitationClaim.user_id == uid)],
    }
