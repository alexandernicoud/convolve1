"""Credit lots: where each credit in ``credit_accounts.balance`` came from.

``credit_accounts.balance`` stays the single authoritative total that charges debit with a
conditional UPDATE. Lots record its composition so that:

* monthly subscription credits are used first and expire at the end of their period;
* purchased credits are used last, carry over, and can be refunded per purchase;
* a refunded run returns its credits to the exact lots it consumed.

Credit in the balance that no lot covers is untracked legacy credit (granted before
billing existed). It is consumed after subscription and grant lots and before purchased
lots, and it is never cash-refundable.

Every function runs inside the caller's transaction, after the account row is locked by
the balance UPDATE (PostgreSQL row lock; SQLite serialises writers), so lot updates for one
user never race.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy import func, update
from sqlalchemy.orm import Session

from app.models import CreditAccount, CreditLedgerEntry, CreditLot, CreditLotMove

# Order in which a charge consumes lots; "legacy" is the untracked remainder.
CONSUMPTION_ORDER = ("subscription", "grant", "legacy", "purchase")


def _now(now: Optional[datetime]) -> datetime:
    return now or datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def live_lots(db: Session, uid: uuid.UUID, now: Optional[datetime] = None) -> List[CreditLot]:
    """Lots that still hold credit and have not expired, in consumption order."""
    now = _now(now)
    rows = (
        db.query(CreditLot)
        .filter(CreditLot.user_id == uid, CreditLot.credits_remaining > 0, CreditLot.expired_at.is_(None))
        .all()
    )
    rows = [r for r in rows if not (_aware(r.expires_at) and _aware(r.expires_at) <= now)]
    rank = {k: i for i, k in enumerate(CONSUMPTION_ORDER)}
    far = datetime.max.replace(tzinfo=timezone.utc)
    return sorted(rows, key=lambda r: (rank.get(r.kind, 9), _aware(r.expires_at) or far, _aware(r.created_at) or far))


def tracked_total(db: Session, uid: uuid.UUID) -> int:
    return int(
        db.query(func.coalesce(func.sum(CreditLot.credits_remaining), 0))
        .filter(CreditLot.user_id == uid, CreditLot.expired_at.is_(None))
        .scalar() or 0
    )


def consume(db: Session, uid: uuid.UUID, amount: int, ledger_key: str, run_id: Optional[str],
            balance_before: int, now: Optional[datetime] = None) -> Dict[str, int]:
    """Take ``amount`` (already debited from the balance) out of lots. Returns credits per bucket."""
    taken: Dict[str, int] = {}
    left = amount
    legacy = max(0, balance_before - tracked_total(db, uid))
    lots = live_lots(db, uid, now)
    for bucket in CONSUMPTION_ORDER:
        if left <= 0:
            break
        if bucket == "legacy":
            n = min(left, legacy)
            if n:
                taken["legacy"] = taken.get("legacy", 0) + n
                left -= n
            continue
        for lot in (l for l in lots if l.kind == bucket):
            if left <= 0:
                break
            n = min(left, lot.credits_remaining)
            if n <= 0:
                continue
            lot.credits_remaining -= n
            db.add(CreditLotMove(lot_id=lot.id, ledger_key=ledger_key, run_id=run_id, delta=-n))
            taken[bucket] = taken.get(bucket, 0) + n
            left -= n
    # Any shortfall means lots over-cover the balance (should not happen); the balance
    # UPDATE already succeeded, so the remainder is attributed to legacy.
    if left > 0:
        taken["legacy"] = taken.get("legacy", 0) + left
    db.flush()
    return taken


def restore(db: Session, charge_key: str, refund_key: str, run_id: Optional[str]) -> int:
    """Return a refunded charge to the lots it came from. Returns credits put back into expired lots.

    Credits returned to a lot that expired in the meantime stay expired; the caller writes an
    ``expiry`` ledger entry for that amount so the balance never revives expired credit.
    """
    expired_back = 0
    for move in db.query(CreditLotMove).filter(CreditLotMove.ledger_key == charge_key, CreditLotMove.delta < 0).all():
        lot = db.get(CreditLot, move.lot_id)
        if lot is None:
            continue
        n = -move.delta
        db.add(CreditLotMove(lot_id=lot.id, ledger_key=refund_key, run_id=run_id, delta=n))
        if lot.expired_at is not None:
            expired_back += n
        else:
            lot.credits_remaining += n
    db.flush()
    return expired_back


def debit_balance(db: Session, uid: uuid.UUID, amount: int) -> int:
    """Remove up to ``amount`` from the balance without going negative. Returns the amount removed."""
    if amount <= 0:
        return 0
    balance = int(db.query(CreditAccount.balance).filter(CreditAccount.user_id == uid).scalar() or 0)
    n = min(amount, balance)
    if n > 0:
        db.execute(
            update(CreditAccount).where(CreditAccount.user_id == uid, CreditAccount.balance >= n)
            .values(balance=CreditAccount.balance - n, version=CreditAccount.version + 1)
        )
    return n


def write_entry(db: Session, uid: uuid.UUID, delta: int, reason: str, key: str, note: Optional[str] = None,
                run_id: Optional[str] = None) -> None:
    balance = int(db.query(CreditAccount.balance).filter(CreditAccount.user_id == uid).scalar() or 0)
    db.add(CreditLedgerEntry(user_id=uid, delta=delta, balance_after=balance, reason=reason,
                             idempotency_key=key, run_id=run_id, note=note))
    db.flush()


def expire_due(db: Session, uid: uuid.UUID, now: Optional[datetime] = None) -> int:
    """Expire subscription lots whose period ended. Caller commits. Returns credits expired."""
    now = _now(now)
    total = 0
    for lot in db.query(CreditLot).filter(
        CreditLot.user_id == uid, CreditLot.expired_at.is_(None), CreditLot.expires_at.isnot(None)
    ).all():
        if _aware(lot.expires_at) > now:
            continue
        n = debit_balance(db, uid, lot.credits_remaining)
        lot.credits_remaining = 0
        lot.expired_at = now
        if n:
            write_entry(db, uid, -n, "expiry", f"expiry:{lot.id}", note="Monthly credits expired at period end")
            total += n
    db.flush()
    return total


def breakdown(db: Session, uid: uuid.UUID, now: Optional[datetime] = None) -> Dict[str, int]:
    """Current balance split by bucket. ``legacy`` is the untracked remainder."""
    balance = int(db.query(CreditAccount.balance).filter(CreditAccount.user_id == uid).scalar() or 0)
    out = {"subscription": 0, "grant": 0, "purchase": 0}
    for lot in live_lots(db, uid, now):
        out[lot.kind] = out.get(lot.kind, 0) + lot.credits_remaining
    out["legacy"] = max(0, balance - sum(out.values()))
    out["total"] = balance
    return out


def add_lot(db: Session, uid: uuid.UUID, *, kind: str, source_key: str, credits: int, reason: str, note: str,
            item_id: Optional[str] = None, payment_id: Optional[uuid.UUID] = None,
            amount_minor: Optional[int] = None, currency: Optional[str] = None,
            expires_at: Optional[datetime] = None, withdrawal_waived: bool = False,
            statutory_override: Optional[str] = None) -> Optional[CreditLot]:
    """Credit the balance and create the lot once per ``source_key``. Caller commits. None if it exists."""
    if db.query(CreditLot.id).filter(CreditLot.source_key == source_key).first():
        return None
    acct = db.get(CreditAccount, uid)
    if acct is None:
        db.add(CreditAccount(user_id=uid, balance=0, version=1))
        db.flush()
    db.execute(
        update(CreditAccount).where(CreditAccount.user_id == uid)
        .values(balance=CreditAccount.balance + credits, version=CreditAccount.version + 1)
    )
    lot = CreditLot(
        user_id=uid, kind=kind, source_key=source_key, item_id=item_id, credits_total=credits,
        credits_remaining=credits, credits_refunded=0, payment_id=payment_id, amount_minor=amount_minor,
        currency=currency, expires_at=expires_at, withdrawal_waived=withdrawal_waived,
        statutory_override=statutory_override,
    )
    db.add(lot)
    db.flush()
    write_entry(db, uid, credits, reason, f"lot:{source_key}", note=note)
    return lot
