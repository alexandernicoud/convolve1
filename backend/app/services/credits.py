"""Server-side credit ledger.

Rules:
- The balance lives in ``credit_accounts``; every change appends one ``credit_ledger`` row
  with a unique idempotency key, in the same transaction as the balance change.
- Charges use a conditional UPDATE (``balance >= cost``) so concurrent launches cannot
  overspend; the table also has a ``balance >= 0`` check.
- Costs come from ``app.pricing`` (computed from the run's configuration on the server);
  clients never send a price. A client may send the price it showed the user; a higher
  server price refuses the run (``PriceChanged``) instead of charging more than shown.
- A client request key (``Idempotency-Key``) makes the charge key per request, so a
  double-submitted form is charged once (``DuplicateSubmission``).
- Refund policy: a charged run that ends ``failed`` or ``interrupted`` is refunded in full;
  ``cancelled`` is refunded only if it was still queued. Refunds are keyed by run, so
  retries and the startup sweep can never refund twice.
- Browser-held balances from the old client-side system are never imported.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import config
from app.db import SessionLocal
from app.models import CreditAccount, CreditLedgerEntry, PipelineRun, UserPlan
from app.plans import DEFAULT_PLAN_ID, TOOL_LABELS, get_plan, run_cost

logger = logging.getLogger(__name__)

REFUNDABLE_STATUSES = frozenset({"failed", "interrupted"})


class InsufficientCredits(Exception):
    def __init__(self, balance: int, cost: int):
        super().__init__(f"Insufficient credits: {balance} available, {cost} required")
        self.balance = balance
        self.cost = cost


class PriceChanged(Exception):
    def __init__(self, expected: int, cost: int):
        super().__init__(f"Price changed: {expected} shown, {cost} required")
        self.expected = expected
        self.cost = cost


class DuplicateSubmission(Exception):
    def __init__(self, run_id: Optional[str]):
        super().__init__(f"Duplicate submission of run {run_id}")
        self.run_id = run_id


def enforced() -> bool:
    return config.CREDITS_MODE == "enforce"


def _uuid(user_id: Any) -> uuid.UUID:
    return user_id if isinstance(user_id, uuid.UUID) else uuid.UUID(str(user_id))


def charge_key(run_id: str) -> str:
    return f"charge:{run_id}"


def request_charge_key(uid: uuid.UUID, request_key: str) -> str:
    return f"charge:req:{uid}:{request_key[:120]}"


def refund_key(run_id: str) -> str:
    return f"refund:{run_id}"


# --------------------------------------------------------------------------- plan


def plan_state(db: Session, uid: uuid.UUID) -> Dict[str, Any]:
    row = db.get(UserPlan, uid)
    plan = get_plan(row.plan_id if row else DEFAULT_PLAN_ID)
    return {
        "plan_id": plan["id"],
        "name": plan["name"],
        "status": row.status if row else "active",
        "source": row.source if row else "default",
        "current_period_start": row.current_period_start.isoformat() if row and row.current_period_start else None,
        "current_period_end": row.current_period_end.isoformat() if row and row.current_period_end else None,
        "credits": plan.get("credits"),
    }


# --------------------------------------------------------------------------- ledger writes


def _account(db: Session, uid: uuid.UUID) -> CreditAccount:
    acct = db.get(CreditAccount, uid)
    if acct is None:
        acct = CreditAccount(user_id=uid, balance=0, version=1)
        db.add(acct)
        db.flush()
    return acct


def _credit(
    db: Session, uid: uuid.UUID, delta: int, reason: str, key: str, *,
    run_id: Optional[str] = None, tool: Optional[str] = None, note: Optional[str] = None,
) -> int:
    """Add ``delta`` (>0) and append the ledger row. Caller commits."""
    _account(db, uid)
    db.execute(
        update(CreditAccount)
        .where(CreditAccount.user_id == uid)
        .values(balance=CreditAccount.balance + delta, version=CreditAccount.version + 1)
    )
    balance = db.query(CreditAccount.balance).filter(CreditAccount.user_id == uid).scalar()
    db.add(CreditLedgerEntry(
        user_id=uid, delta=delta, balance_after=balance, reason=reason, idempotency_key=key,
        run_id=run_id, tool=tool, note=note,
    ))
    db.flush()
    return balance


def _apply_once(uid: uuid.UUID, delta: int, reason: str, key: str, note: Optional[str] = None) -> bool:
    db = SessionLocal()
    try:
        if db.query(CreditLedgerEntry.id).filter(CreditLedgerEntry.idempotency_key == key).first():
            return False
        _credit(db, uid, delta, reason, key, note=note)
        db.commit()
        return True
    except IntegrityError:
        db.rollback()
        return False
    finally:
        db.close()


def ensure_allocations(user_id: Any, now: Optional[datetime] = None) -> None:
    """Grant the plan's allocation for the current period, at most once per period."""
    uid = _uuid(user_id)
    db = SessionLocal()
    try:
        credits = plan_state(db, uid).get("credits") or {}
    finally:
        db.close()
    amount = int(credits.get("amount") or 0)
    if amount <= 0:
        return
    cadence = credits.get("cadence")
    if cadence == "one_time":
        _apply_once(uid, amount, "grant", f"grant:initial:{uid}", note="Starter allocation")
    elif cadence == "monthly":
        month = (now or datetime.now(timezone.utc)).strftime("%Y-%m")
        _apply_once(uid, amount, "allocation", f"allocation:{uid}:{month}", note=f"Allocation {month}")


def charge_for_run(
    db: Session, user_id: Any, run_id: str, tool: str, *,
    cost: Optional[int] = None, expected: Optional[int] = None, request_key: Optional[str] = None,
    note: Optional[str] = None,
) -> int:
    """Debit the run's cost inside the caller's transaction. Returns the cost charged.

    ``cost`` is the server-computed price (``app.pricing``); without it the tool's
    default-configuration price applies.
    """
    if not enforced():
        return 0
    cost = run_cost(tool) if cost is None else int(cost)
    if cost <= 0:
        return 0
    if expected is not None and cost > expected:
        raise PriceChanged(expected, cost)
    uid = _uuid(user_id)
    if request_key:
        key = request_charge_key(uid, request_key)
        prior = db.query(CreditLedgerEntry.run_id).filter(CreditLedgerEntry.idempotency_key == key).first()
        if prior is not None:
            raise DuplicateSubmission(prior[0])
    else:
        key = charge_key(run_id)
    if db.query(CreditLedgerEntry.id).filter(
        CreditLedgerEntry.run_id == run_id, CreditLedgerEntry.reason == "charge"
    ).first():
        return 0
    _account(db, uid)
    result = db.execute(
        update(CreditAccount)
        .where(CreditAccount.user_id == uid, CreditAccount.balance >= cost)
        .values(balance=CreditAccount.balance - cost, version=CreditAccount.version + 1)
    )
    balance = db.query(CreditAccount.balance).filter(CreditAccount.user_id == uid).scalar() or 0
    if result.rowcount != 1:
        raise InsufficientCredits(int(balance), cost)
    db.add(CreditLedgerEntry(
        user_id=uid, delta=-cost, balance_after=balance, reason="charge", idempotency_key=key,
        run_id=run_id, tool=tool, note=note,
    ))
    try:
        db.flush()
    except IntegrityError as exc:
        # A concurrent submission with the same request key won the unique index.
        raise DuplicateSubmission(None) from exc
    return cost


def refund_run(run_id: str, note: str) -> bool:
    """Return a run's charge. Safe to call repeatedly and concurrently."""
    db = SessionLocal()
    try:
        charge = (
            db.query(CreditLedgerEntry)
            .filter(CreditLedgerEntry.run_id == run_id, CreditLedgerEntry.reason == "charge")
            .first()
        )
        if charge is None:
            return False
        key = refund_key(run_id)
        if db.query(CreditLedgerEntry.id).filter(CreditLedgerEntry.idempotency_key == key).first():
            return False
        _credit(db, charge.user_id, -charge.delta, "refund", key, run_id=run_id, tool=charge.tool, note=note)
        db.commit()
        return True
    except IntegrityError:
        db.rollback()
        return False
    except Exception:
        db.rollback()
        logger.exception("Refund failed for run %s; the startup sweep will retry", run_id)
        return False
    finally:
        db.close()


def refund_for_transition(run_id: str, previous: Optional[str], status: Optional[str]) -> bool:
    if status in REFUNDABLE_STATUSES:
        return refund_run(run_id, f"Run {status}")
    if status == "cancelled" and previous == "queued":
        return refund_run(run_id, "Cancelled before it started")
    return False


def sweep_refunds() -> int:
    """Refund charged runs that ended failed/interrupted but were never refunded."""
    db = SessionLocal()
    try:
        refunded = {
            k for (k,) in db.query(CreditLedgerEntry.idempotency_key).filter(CreditLedgerEntry.reason == "refund")
        }
        pending = [
            run_id
            for run_id, status in (
                db.query(CreditLedgerEntry.run_id, PipelineRun.status)
                .join(PipelineRun, PipelineRun.id == CreditLedgerEntry.run_id)
                .filter(CreditLedgerEntry.reason == "charge")
            )
            if status in REFUNDABLE_STATUSES and refund_key(run_id) not in refunded
        ]
    finally:
        db.close()
    return sum(1 for run_id in pending if refund_run(run_id, "Run did not complete"))


def adjust(user_id: Any, delta: int, note: str, key: str) -> Dict[str, Any]:
    """Operator adjustment (support credit or correction). Never exposed over HTTP."""
    if not note.strip():
        raise ValueError("An adjustment needs a note")
    uid = _uuid(user_id)
    db = SessionLocal()
    try:
        if db.query(CreditLedgerEntry.id).filter(CreditLedgerEntry.idempotency_key == key).first():
            return {"applied": False}
        if delta >= 0:
            balance = _credit(db, uid, delta, "adjustment", key, note=note)
        else:
            _account(db, uid)
            result = db.execute(
                update(CreditAccount)
                .where(CreditAccount.user_id == uid, CreditAccount.balance >= -delta)
                .values(balance=CreditAccount.balance + delta, version=CreditAccount.version + 1)
            )
            if result.rowcount != 1:
                raise ValueError("Adjustment would make the balance negative")
            balance = db.query(CreditAccount.balance).filter(CreditAccount.user_id == uid).scalar()
            db.add(CreditLedgerEntry(
                user_id=uid, delta=delta, balance_after=balance, reason="adjustment", idempotency_key=key, note=note,
            ))
        db.commit()
        return {"applied": True, "balance": balance}
    except IntegrityError:
        db.rollback()
        return {"applied": False}
    finally:
        db.close()


# --------------------------------------------------------------------------- reads


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _day(value: datetime) -> str:
    return value.date().isoformat()


def summary(user_id: str, days: int = 30) -> Dict[str, Any]:
    """Balance, plan and ledger history for the caller only."""
    uid = _uuid(user_id)
    if enforced():
        ensure_allocations(uid)
    db = SessionLocal()
    try:
        acct = db.get(CreditAccount, uid)
        q = db.query(CreditLedgerEntry).filter(CreditLedgerEntry.user_id == uid)
        recent = q.order_by(CreditLedgerEntry.created_at.desc(), CreditLedgerEntry.id).limit(50).all()

        def total(*reasons: str) -> int:
            return int(
                db.query(func.coalesce(func.sum(CreditLedgerEntry.delta), 0))
                .filter(CreditLedgerEntry.user_id == uid, CreditLedgerEntry.reason.in_(reasons))
                .scalar()
                or 0
            )

        allocated = total("grant", "allocation", "adjustment")
        charged = -total("charge")
        refunded = total("refund")

        by_tool: Dict[str, Dict[str, Any]] = {}
        for tool, reason, delta in (
            db.query(CreditLedgerEntry.tool, CreditLedgerEntry.reason, CreditLedgerEntry.delta)
            .filter(CreditLedgerEntry.user_id == uid, CreditLedgerEntry.reason.in_(("charge", "refund")))
        ):
            key = tool or "other"
            item = by_tool.setdefault(key, {"tool": key, "label": TOOL_LABELS.get(key, key), "credits": 0, "runs": 0})
            item["credits"] += -delta
            if reason == "charge":
                item["runs"] += 1

        since = datetime.now(timezone.utc) - timedelta(days=days - 1)
        start = since.date()
        daily = {(start + timedelta(days=i)).isoformat(): 0 for i in range(days)}
        for created, delta in (
            db.query(CreditLedgerEntry.created_at, CreditLedgerEntry.delta)
            .filter(
                CreditLedgerEntry.user_id == uid,
                CreditLedgerEntry.reason.in_(("charge", "refund")),
                CreditLedgerEntry.created_at >= datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
            )
        ):
            d = _day(created)
            if d in daily:
                daily[d] += -delta

        return {
            "mode": config.CREDITS_MODE,
            "balance": int(acct.balance) if acct else 0,
            "plan": plan_state(db, uid),
            "totals": {"allocated": allocated, "consumed": charged - refunded, "charged": charged, "refunded": refunded},
            "by_tool": sorted(by_tool.values(), key=lambda x: -x["credits"]),
            "daily": [{"date": d, "credits": v} for d, v in daily.items()],
            "transactions": [
                {
                    "id": str(e.id),
                    "created_at": _iso(e.created_at),
                    "reason": e.reason,
                    "delta": e.delta,
                    "balance_after": e.balance_after,
                    "tool": e.tool,
                    "tool_label": TOOL_LABELS.get(e.tool or "", e.tool),
                    "run_id": e.run_id,
                    "note": e.note,
                }
                for e in recent
            ],
        }
    finally:
        db.close()


def quote(user_id: Optional[str], tool: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    from app import pricing

    priced = pricing.quote(tool, params)
    cost = priced.credits
    out: Dict[str, Any] = {
        "tool": tool, "cost": cost, "mode": config.CREDITS_MODE, "balance": None, "pricing": priced.as_dict(),
    }
    if user_id and enforced():
        ensure_allocations(user_id)
        db = SessionLocal()
        try:
            acct = db.get(CreditAccount, _uuid(user_id))
            out["balance"] = int(acct.balance) if acct else 0
        finally:
            db.close()
        out["sufficient"] = out["balance"] >= cost
    else:
        out["sufficient"] = True
    # Ask for confirmation on large runs, or on runs that would use most of the balance.
    out["confirm"] = cost >= pricing.CONFIRM_ABOVE or (
        out["balance"] is not None and cost > 0 and cost * 2 > out["balance"]
    )
    return out


def ledger_rows_for_export(db: Session, uid: uuid.UUID) -> List[Dict[str, Any]]:
    return [
        {
            "created_at": _iso(e.created_at),
            "reason": e.reason,
            "delta": e.delta,
            "balance_after": e.balance_after,
            "tool": e.tool,
            "run_id": e.run_id,
            "note": e.note,
        }
        for e in db.query(CreditLedgerEntry).filter(CreditLedgerEntry.user_id == uid).order_by(CreditLedgerEntry.created_at)
    ]
