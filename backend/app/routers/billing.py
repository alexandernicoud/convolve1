"""Subscriptions, credit packs, cancellation and refunds for the caller; provider webhooks.

Every amount is computed on the server. The browser never sends a price or a refund amount
it wants paid; it may send the refund total it showed the user, and a mismatch refuses the
request instead of refunding a different amount.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app import config
from app.auth import require_user_id
from app.billing import BillingError, catalog, providers, service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/billing", tags=["billing"])


def _call(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    try:
        return fn(*args, **kwargs)
    except BillingError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail()) from exc


@router.get("/catalog")
def get_catalog() -> Dict[str, Any]:
    out = catalog.public()
    out["mode"] = config.BILLING_MODE
    out["blocked_countries"] = sorted(config.BILLING_BLOCKED_COUNTRIES)
    return out


@router.get("/state")
def get_state(request: Request) -> Dict[str, Any]:
    return _call(service.state, require_user_id(request))


class CheckoutRequest(BaseModel):
    kind: str = Field(..., pattern="^(subscription|topup)$")
    item_id: str = Field(..., max_length=64)
    country: str = Field(..., min_length=2, max_length=2)
    # EU/EEA/UK: the consumer asked for immediate access and acknowledged losing the
    # withdrawal right once credits are used. Unchecked keeps the full statutory right.
    withdrawal_waived: bool = False


@router.post("/checkout")
def post_checkout(body: CheckoutRequest, request: Request) -> Dict[str, Any]:
    uid = require_user_id(request)
    email = (getattr(request.state, "auth_claims", None) or {}).get("email")
    return _call(service.checkout, uid, email=email, kind=body.kind, item_id=body.item_id, country=body.country,
                 withdrawal_waived=body.withdrawal_waived,
                 request_key=(request.headers.get("idempotency-key") or "").strip()[:80] or None)


class SimulatedCompletion(BaseModel):
    session_id: str = Field(..., max_length=64)


@router.post("/simulator/complete")
def post_simulator_complete(body: SimulatedCompletion, request: Request) -> Dict[str, Any]:
    """Sandbox only: stands in for the provider's hosted payment page."""
    return _call(service.complete_simulated_checkout, require_user_id(request), body.session_id)


class ChangePlanRequest(BaseModel):
    tier_id: str = Field(..., max_length=64)


@router.post("/change-plan")
def post_change_plan(body: ChangePlanRequest, request: Request) -> Dict[str, Any]:
    return _call(service.change_plan, require_user_id(request), body.tier_id)


class CancelRequest(BaseModel):
    cancel: bool = True


@router.post("/cancel")
def post_cancel(body: CancelRequest, request: Request) -> Dict[str, Any]:
    """Stop (``cancel: true``) or restart renewal. No reason or confirmation call is required."""
    return _call(service.set_cancel, require_user_id(request), body.cancel)


@router.get("/refund-quote")
def get_refund_quote(request: Request) -> Dict[str, Any]:
    return _call(service.refund_quote, require_user_id(request))


class CancelAndRefundRequest(BaseModel):
    request_id: str = Field(..., min_length=8, max_length=80)
    expected: Optional[Dict[str, int]] = None


@router.post("/cancel-and-refund")
def post_cancel_and_refund(body: CancelAndRefundRequest, request: Request) -> Dict[str, Any]:
    return _call(service.cancel_and_refund, require_user_id(request), request_id=body.request_id, expected=body.expected)


@router.get("/history")
def get_history(request: Request) -> Dict[str, Any]:
    return service.history(require_user_id(request))


@router.post("/portal")
def post_portal(request: Request) -> Dict[str, Any]:
    """Provider-hosted page for payment methods and invoices (Stripe only)."""
    uid = require_user_id(request)
    st = _call(service.state, uid)
    if config.BILLING_MODE == "off" or providers.get().name != "stripe":
        raise HTTPException(status_code=404, detail={"code": "portal_unavailable", "message": "Not available."})
    from app.db import SessionLocal
    from app.models import UserPlan
    import uuid as _uuid

    db = SessionLocal()
    try:
        row = db.get(UserPlan, _uuid.UUID(uid))
        customer = row.provider_customer_id if row else None
    finally:
        db.close()
    if not customer:
        raise HTTPException(status_code=404, detail={"code": "portal_unavailable", "message": "No billing account yet."})
    try:
        return {"url": providers.get().portal_url(customer), "subscription": st["subscription"]}
    except providers.ProviderError as exc:
        raise HTTPException(status_code=503, detail={"code": "billing_unavailable", "message": str(exc)}) from exc


@router.post("/webhook/{provider}")
async def post_webhook(provider: str, request: Request) -> Dict[str, Any]:
    if config.BILLING_MODE == "off" or provider != providers.get().name or provider == "simulator":
        raise HTTPException(status_code=404, detail="Not found")
    payload = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}
    try:
        event = providers.get().parse_webhook(payload, headers)
    except providers.WebhookRejected as exc:
        logger.warning("Rejected %s webhook: %s", provider, exc)
        raise HTTPException(status_code=400, detail="Invalid signature") from exc
    except providers.ProviderError as exc:
        logger.warning("Could not enrich %s webhook; the provider will retry: %s", provider, exc)
        raise HTTPException(status_code=503, detail="Try again") from exc
    if event is None:
        return {"received": True, "handled": False}
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        outcome = service.apply_event(db, event, provider)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Webhook %s could not be applied; the provider will retry", event.get("event_id"))
        raise HTTPException(status_code=500, detail="Not applied")
    finally:
        db.close()
    return {"received": True, "handled": True, "outcome": outcome}
