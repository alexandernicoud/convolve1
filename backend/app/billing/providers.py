"""Payment-provider adapters behind one small interface.

The billing service only sees normalised events and results; nothing outside this module
knows a provider's API. Two adapters exist:

* ``SimulatorProvider`` - in-process, deterministic, moves no money. Used by tests and for
  local sandbox demos. Failures can be injected to exercise retry and reconciliation.
* ``StripeProvider`` - Stripe's REST API over HTTPS. Refuses live keys unless billing is
  explicitly approved for live use. Charges use the Stripe Prices created by
  ``scripts/stripe_sync_catalog.py`` (found by lookup key and checked against the catalogue
  amount, so a stale Stripe price can never charge a different amount). Webhook payloads are
  read in both the pre-2025 and the current API shapes.

Normalised event types: ``payment_succeeded`` | ``payment_failed`` | ``subscription_updated``
| ``subscription_deleted`` | ``refund_updated`` | ``dispute_opened``.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app import config


class ProviderError(Exception):
    def __init__(self, message: str, *, retryable: bool):
        super().__init__(message)
        self.retryable = retryable


class PaymentDeclined(ProviderError):
    """The customer's payment method was declined; nothing was changed."""

    def __init__(self, message: str):
        super().__init__(message, retryable=False)


class WebhookRejected(Exception):
    pass


@dataclass
class RefundResult:
    status: str  # succeeded | pending | failed
    provider_refund_id: Optional[str] = None
    reason: Optional[str] = None


@dataclass
class Checkout:
    session_id: str
    url: str


def add_month(value: datetime) -> datetime:
    """Same day next month, clamped to the month's last day (Jan 31 -> Feb 28/29)."""
    import calendar

    year, month = (value.year + 1, 1) if value.month == 12 else (value.year, value.month + 1)
    return value.replace(year=year, month=month, day=min(value.day, calendar.monthrange(year, month)[1]))


def _ts(value: Optional[int]) -> Optional[datetime]:
    return datetime.fromtimestamp(int(value), tz=timezone.utc) if value else None


class Provider:
    name = "base"

    def create_checkout(self, *, user_id: str, email: Optional[str], kind: str, item: Dict[str, Any],
                        country: str, withdrawal_waived: bool, customer_id: Optional[str],
                        idempotency_key: str, discount: Optional[Dict[str, Any]] = None) -> Checkout:
        """``discount`` (founding member offer): ``{"percent", "coupon"}`` applied to the first
        invoice only; other discount codes are then not accepted in that checkout."""
        raise NotImplementedError

    def cancel_at_period_end(self, subscription_id: str, *, cancel: bool, idempotency_key: str) -> None:
        raise NotImplementedError

    def change_subscription(self, subscription_id: str, *, item: Dict[str, Any], immediate: bool,
                            idempotency_key: str) -> None:
        """Switch the recurring price. ``immediate`` (upgrade) invoices the difference now;
        otherwise the new price applies from the next renewal."""
        raise NotImplementedError

    def cancel_now(self, subscription_id: str, *, idempotency_key: str) -> None:
        """End a subscription immediately, without proration or a final invoice."""
        raise NotImplementedError

    def refund(self, *, payment_ref: str, amount_minor: int, currency: str, idempotency_key: str) -> RefundResult:
        raise NotImplementedError

    def refund_status(self, provider_refund_id: str) -> RefundResult:
        raise NotImplementedError

    def credit_customer(self, customer_id: str, *, amount_minor: int, currency: str, description: str,
                        idempotency_key: str) -> None:
        """Credit the customer's account; the provider deducts it from their next invoices."""
        raise NotImplementedError

    def reverse_customer_credit(self, customer_id: str, *, amount_minor: int, currency: str, description: str,
                                idempotency_key: str) -> int:
        """Withdraw up to ``amount_minor`` of credit not yet applied to an invoice. Returns the amount withdrawn."""
        raise NotImplementedError

    def portal_url(self, customer_id: str) -> Optional[str]:
        return None

    def parse_webhook(self, payload: bytes, headers: Dict[str, str]) -> Optional[Dict[str, Any]]:
        raise NotImplementedError


# --------------------------------------------------------------------------- simulator


@dataclass
class _SimState:
    sessions: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    refunds: Dict[str, RefundResult] = field(default_factory=dict)
    refund_calls: List[Dict[str, Any]] = field(default_factory=list)
    # Injected outcomes for the next refund calls: "retryable" | "permanent" | "pending".
    fail_next: List[str] = field(default_factory=list)
    canceled: Dict[str, bool] = field(default_factory=dict)
    ended: List[str] = field(default_factory=list)
    customer_credits: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    customer_credit_reversals: Dict[str, int] = field(default_factory=dict)


class SimulatorProvider(Provider):
    """No network, no money. Same idempotency semantics as a real provider."""

    name = "simulator"
    state = _SimState()

    @classmethod
    def reset(cls) -> None:
        cls.state = _SimState()

    def create_checkout(self, *, user_id, email, kind, item, country, withdrawal_waived, customer_id,
                        idempotency_key, discount=None) -> Checkout:
        for sid, s in self.state.sessions.items():
            if s["idempotency_key"] == idempotency_key:
                return Checkout(sid, s["url"])
        sid = f"sim_cs_{uuid.uuid4().hex[:16]}"
        url = f"/account?tab=plan&simulated_checkout={sid}"
        self.state.sessions[sid] = {
            "idempotency_key": idempotency_key, "user_id": user_id, "kind": kind, "item": item,
            "country": country, "withdrawal_waived": withdrawal_waived, "url": url, "completed": False,
            "customer_id": customer_id or f"sim_cus_{user_id[:8]}", "discount": discount,
        }
        return Checkout(sid, url)

    def complete_checkout(self, session_id: str, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """What the provider's webhooks would deliver after a successful payment."""
        s = self.state.sessions.get(session_id)
        if s is None:
            raise ProviderError("Unknown checkout session", retryable=False)
        now = now or datetime.now(timezone.utc)
        item = s["item"]
        payment = {
            "type": "payment_succeeded", "event_id": f"sim_evt_{session_id}", "user_id": s["user_id"],
            "kind": s["kind"], "item_id": item["id"], "payment_ref": f"sim_pi_{session_id}",
            "amount_minor": item["price"]["amount_minor"], "currency": item["price"]["currency"],
            "country": s["country"], "withdrawal_waived": s["withdrawal_waived"], "customer_id": s["customer_id"],
        }
        if s["kind"] == "subscription":
            payment.update({
                "subscription_ref": f"sim_sub_{session_id}", "period_start": now, "period_end": add_month(now),
            })
            if s.get("discount"):
                # Like a Stripe coupon with duration=once: only this first invoice is reduced.
                full = int(item["price"]["amount_minor"])
                payment["amount_minor"] = full - full * int(s["discount"]["percent"]) // 100
                payment["founding_discount"] = True
        s["completed"] = True
        return [payment]

    def renewal_event(self, subscription_ref: str, user_id: str, item: Dict[str, Any], country: str,
                      period_start: datetime, period_end: datetime, *, failed: bool = False) -> Dict[str, Any]:
        key = f"{subscription_ref}:{period_start.isoformat()}"
        if failed:
            return {"type": "payment_failed", "event_id": f"sim_evt_fail_{key}", "user_id": user_id,
                    "subscription_ref": subscription_ref}
        return {
            "type": "payment_succeeded", "event_id": f"sim_evt_{key}", "user_id": user_id, "kind": "subscription",
            "item_id": item["id"], "payment_ref": f"sim_pi_{key}", "amount_minor": item["price"]["amount_minor"],
            "currency": item["price"]["currency"], "country": country, "withdrawal_waived": False,
            "subscription_ref": subscription_ref, "period_start": period_start, "period_end": period_end,
        }

    def cancel_at_period_end(self, subscription_id, *, cancel, idempotency_key) -> None:
        self.state.canceled[subscription_id] = cancel

    def change_subscription(self, subscription_id, *, item, immediate, idempotency_key) -> None:
        self.state.canceled[subscription_id] = False

    def cancel_now(self, subscription_id, *, idempotency_key) -> None:
        if subscription_id not in self.state.ended:
            self.state.ended.append(subscription_id)

    def refund(self, *, payment_ref, amount_minor, currency, idempotency_key) -> RefundResult:
        self.state.refund_calls.append({"payment_ref": payment_ref, "amount_minor": amount_minor,
                                        "currency": currency, "idempotency_key": idempotency_key})
        if idempotency_key in self.state.refunds:
            return self.state.refunds[idempotency_key]
        outcome = self.state.fail_next.pop(0) if self.state.fail_next else "succeeded"
        if outcome == "retryable":
            raise ProviderError("Simulated provider timeout", retryable=True)
        if outcome == "permanent":
            result = RefundResult("failed", None, "Simulated refusal by the card network")
        elif outcome == "pending":
            result = RefundResult("pending", f"sim_re_{uuid.uuid4().hex[:12]}")
        else:
            result = RefundResult("succeeded", f"sim_re_{uuid.uuid4().hex[:12]}")
        self.state.refunds[idempotency_key] = result
        return result

    def refund_status(self, provider_refund_id: str) -> RefundResult:
        for r in self.state.refunds.values():
            if r.provider_refund_id == provider_refund_id:
                return r
        return RefundResult("pending", provider_refund_id)

    def credit_customer(self, customer_id, *, amount_minor, currency, description, idempotency_key) -> None:
        self.state.customer_credits.setdefault(idempotency_key, {
            "customer_id": customer_id, "amount_minor": amount_minor, "currency": currency, "description": description,
        })

    def reverse_customer_credit(self, customer_id, *, amount_minor, currency, description, idempotency_key) -> int:
        if idempotency_key in self.state.customer_credit_reversals:
            return self.state.customer_credit_reversals[idempotency_key]
        unused = sum(c["amount_minor"] for c in self.state.customer_credits.values() if c["customer_id"] == customer_id)
        unused -= sum(self.state.customer_credit_reversals.values())
        n = max(0, min(int(amount_minor), unused))
        self.state.customer_credit_reversals[idempotency_key] = n
        return n

    def settle(self, provider_refund_id: str, status: str = "succeeded") -> None:
        for r in self.state.refunds.values():
            if r.provider_refund_id == provider_refund_id:
                r.status = status

    def parse_webhook(self, payload: bytes, headers: Dict[str, str]) -> Optional[Dict[str, Any]]:
        raise WebhookRejected("The simulator does not accept HTTP webhooks")


# --------------------------------------------------------------------------- Stripe


class StripeProvider(Provider):
    name = "stripe"
    API = "https://api.stripe.com/v1"
    TOLERANCE_SECONDS = 300

    def __init__(self, secret_key: Optional[str] = None, webhook_secret: Optional[str] = None):
        self.secret_key = secret_key if secret_key is not None else os.getenv("STRIPE_SECRET_KEY", "")
        self.webhook_secret = webhook_secret if webhook_secret is not None else os.getenv("STRIPE_WEBHOOK_SECRET", "")
        if self.secret_key.startswith(("sk_live_", "rk_live_")) and config.BILLING_MODE != "live":
            raise ProviderError("Live Stripe keys are refused outside approved live billing", retryable=False)
        self._prices: Dict[str, str] = {}
        self._portal_config: Optional[str] = None

    def _post(self, path: str, data: Dict[str, Any], idempotency_key: Optional[str] = None,
              method: str = "POST") -> Dict[str, Any]:
        import httpx

        if not self.secret_key:
            raise ProviderError("Stripe is not configured", retryable=False)
        headers = {"Idempotency-Key": idempotency_key} if idempotency_key else {}
        try:
            resp = httpx.request(method, f"{self.API}{path}", data=data or None, headers=headers,
                                 auth=(self.secret_key, ""), timeout=20)
        except httpx.HTTPError as exc:
            raise ProviderError(f"Stripe unreachable: {type(exc).__name__}", retryable=True) from exc
        if resp.status_code >= 500 or resp.status_code == 429:
            raise ProviderError(f"Stripe error {resp.status_code}", retryable=True)
        body = resp.json()
        if resp.status_code >= 400:
            err = body.get("error", {})
            if err.get("type") == "card_error":
                raise PaymentDeclined(err.get("message", "The payment was declined"))
            raise ProviderError(err.get("message", "Stripe request refused"), retryable=False)
        return body

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        import httpx

        if not self.secret_key:
            raise ProviderError("Stripe is not configured", retryable=False)
        try:
            resp = httpx.get(f"{self.API}{path}", params=params, auth=(self.secret_key, ""), timeout=20)
        except httpx.HTTPError as exc:
            raise ProviderError(f"Stripe unreachable: {type(exc).__name__}", retryable=True) from exc
        if resp.status_code >= 400:
            raise ProviderError(f"Stripe error {resp.status_code}", retryable=resp.status_code >= 500 or resp.status_code == 429)
        return resp.json()

    def price_id(self, kind: str, item: Dict[str, Any]) -> str:
        """The active Stripe Price for a catalogue item; refuses if its amount differs from the catalogue."""
        from app.billing import catalog

        key = catalog.stripe_lookup_key(kind, item)
        if key in self._prices:
            return self._prices[key]
        found = (self._get("/prices", {"lookup_keys[]": key, "active": "true", "limit": 1}).get("data") or [])
        if not found:
            raise ProviderError(f"No Stripe price for {key}; run scripts/stripe_sync_catalog.py", retryable=False)
        p = found[0]
        want = item["price"]
        recurring = (p.get("recurring") or {}).get("interval")
        if (p.get("unit_amount") != want["amount_minor"] or (p.get("currency") or "").upper() != want["currency"].upper()
                or recurring != (want.get("interval") if kind == "subscription" else None)):
            raise ProviderError(f"Stripe price {key} does not match the catalogue; re-run the catalogue sync", retryable=False)
        self._prices[key] = p["id"]
        return p["id"]

    def create_checkout(self, *, user_id, email, kind, item, country, withdrawal_waived, customer_id,
                        idempotency_key, discount=None) -> Checkout:
        meta = {"user_id": user_id, "kind": kind, "item_id": item["id"], "country": country,
                "withdrawal_waived": "1" if withdrawal_waived else "0"}
        data: Dict[str, Any] = {
            "mode": "subscription" if kind == "subscription" else "payment",
            "success_url": f"{config.BILLING_RETURN_URL}&checkout=success",
            "cancel_url": f"{config.BILLING_RETURN_URL}&checkout=cancel",
            "client_reference_id": user_id,
            "billing_address_collection": "required",
            "line_items[0][quantity]": 1,
            "line_items[0][price]": self.price_id(kind, item),
        }
        if discount and kind == "subscription":
            # Founding member coupon (duration=once). Stripe refuses discounts together with
            # allow_promotion_codes, so no other code can be stacked on it.
            data["discounts[0][coupon]"] = discount["coupon"]
            meta["founding_discount"] = "1"
        else:
            # Discount codes are Stripe promotion codes, created in the Stripe Dashboard.
            data["allow_promotion_codes"] = "true"
        if kind == "subscription":
            for k, v in meta.items():
                data[f"subscription_data[metadata][{k}]"] = v
        else:
            for k, v in meta.items():
                data[f"payment_intent_data[metadata][{k}]"] = v
        for k, v in meta.items():
            data[f"metadata[{k}]"] = v
        if customer_id:
            data["customer"] = customer_id
        elif email:
            data["customer_email"] = email
        body = self._post("/checkout/sessions", data, idempotency_key)
        return Checkout(body["id"], body["url"])

    def cancel_at_period_end(self, subscription_id, *, cancel, idempotency_key) -> None:
        self._post(f"/subscriptions/{subscription_id}", {"cancel_at_period_end": "true" if cancel else "false"},
                   idempotency_key)

    def change_subscription(self, subscription_id, *, item, immediate, idempotency_key) -> None:
        """Upgrade: switch now and invoice the prorated difference; if that payment does not
        succeed Stripe keeps the old price (``pending_if_incomplete``) and this raises.
        Downgrade: switch without proration, so the next renewal is billed at the new price."""
        sub = self._get(f"/subscriptions/{subscription_id}")
        sub_item = ((sub.get("items") or {}).get("data") or [{}])[0].get("id")
        if not sub_item:
            raise ProviderError("Stripe subscription has no item", retryable=False)
        items = {"items[0][id]": sub_item, "items[0][price]": self.price_id("subscription", item)}
        if immediate:
            body = self._post(f"/subscriptions/{subscription_id}", {
                **items, "proration_behavior": "always_invoice", "payment_behavior": "pending_if_incomplete",
            }, f"{idempotency_key}:items")
            if body.get("pending_update"):
                invoice = body.get("latest_invoice")
                invoice = invoice.get("id") if isinstance(invoice, dict) else invoice
                if invoice:
                    try:  # otherwise Stripe keeps trying to collect an upgrade that never happened
                        self._post(f"/invoices/{invoice}/void", {}, f"{idempotency_key}:void")
                    except ProviderError:
                        pass
                raise PaymentDeclined("The payment for the upgrade did not go through; the plan was not changed")
            self._post(f"/subscriptions/{subscription_id}", {
                "metadata[item_id]": item["id"], "cancel_at_period_end": "false",
            }, f"{idempotency_key}:meta")
        else:
            self._post(f"/subscriptions/{subscription_id}", {
                **items, "proration_behavior": "none", "metadata[item_id]": item["id"], "cancel_at_period_end": "false",
            }, idempotency_key)

    def cancel_now(self, subscription_id, *, idempotency_key) -> None:
        try:
            self._post(f"/subscriptions/{subscription_id}", {}, idempotency_key, method="DELETE")
        except ProviderError as exc:
            if "No such subscription" not in str(exc) and "canceled" not in str(exc):
                raise

    def _payment_origin(self, payment_intent: str) -> Dict[str, Optional[str]]:
        """Issuing country of the card and country of the billing address of a payment."""
        pi = self._get(f"/payment_intents/{payment_intent}", {"expand[]": "latest_charge"})
        charge = pi.get("latest_charge") if isinstance(pi.get("latest_charge"), dict) else {}
        card = (charge.get("payment_method_details") or {}).get("card") or {}
        address = (charge.get("billing_details") or {}).get("address") or {}
        return {"card_country": card.get("country"), "billing_address_country": address.get("country")}

    def _invoice_payment_intent(self, invoice_id: str) -> Optional[str]:
        """Current API versions no longer put the PaymentIntent on the invoice."""
        try:
            data = self._get("/invoice_payments", {"invoice": invoice_id, "limit": 1}).get("data") or []
        except ProviderError:
            return None
        payment = (data[0].get("payment") or {}) if data else {}
        return payment.get("payment_intent")

    @staticmethod
    def _refund_result(body: Dict[str, Any]) -> RefundResult:
        status = body.get("status")
        mapped = {"succeeded": "succeeded", "failed": "failed", "canceled": "failed"}.get(status, "pending")
        return RefundResult(mapped, body.get("id"), body.get("failure_reason"))

    def refund(self, *, payment_ref, amount_minor, currency, idempotency_key) -> RefundResult:
        body = self._post("/refunds", {"payment_intent": payment_ref, "amount": amount_minor,
                                       "metadata[convolve_key]": idempotency_key}, idempotency_key)
        return self._refund_result(body)

    def refund_status(self, provider_refund_id: str) -> RefundResult:
        return self._refund_result(self._get(f"/refunds/{provider_refund_id}"))

    def credit_customer(self, customer_id, *, amount_minor, currency, description, idempotency_key) -> None:
        # A negative balance transaction is a credit that Stripe applies to the next invoices.
        self._post(f"/customers/{customer_id}/balance_transactions", {
            "amount": -abs(int(amount_minor)), "currency": currency.lower(), "description": description,
        }, idempotency_key)

    def reverse_customer_credit(self, customer_id, *, amount_minor, currency, description, idempotency_key) -> int:
        # A negative customer balance is credit not yet applied; only that part can be withdrawn.
        balance = int(self._get(f"/customers/{customer_id}").get("balance") or 0)
        n = max(0, min(int(amount_minor), -balance))
        if n:
            self._post(f"/customers/{customer_id}/balance_transactions", {
                "amount": n, "currency": currency.lower(), "description": description,
            }, idempotency_key)
        return n

    def portal_url(self, customer_id: str) -> Optional[str]:
        """Uses the portal configuration from the catalogue sync (payment methods and invoices only;
        plan changes and cancellation must go through Convolve)."""
        if self._portal_config is None:
            configs = self._get("/billing_portal/configurations", {"active": "true", "limit": 20}).get("data") or []
            self._portal_config = next((c["id"] for c in configs if (c.get("metadata") or {}).get("convolve") == "1"), None)
        if not self._portal_config:
            raise ProviderError("No Convolve portal configuration; run scripts/stripe_sync_catalog.py", retryable=False)
        body = self._post("/billing_portal/sessions", {"customer": customer_id, "return_url": config.BILLING_RETURN_URL,
                                                       "configuration": self._portal_config})
        return body.get("url")

    def verify(self, payload: bytes, signature_header: str, now: Optional[float] = None) -> Dict[str, Any]:
        if not self.webhook_secret:
            raise WebhookRejected("Webhook secret not configured")
        parts: Dict[str, List[str]] = {}
        for item in (signature_header or "").split(","):
            k, _, v = item.strip().partition("=")
            parts.setdefault(k, []).append(v)
        try:
            ts = int(parts.get("t", [""])[0])
        except ValueError as exc:
            raise WebhookRejected("Malformed signature header") from exc
        if abs((now or time.time()) - ts) > self.TOLERANCE_SECONDS:
            raise WebhookRejected("Signature timestamp outside tolerance")
        expected = hmac.new(self.webhook_secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
        if not any(hmac.compare_digest(expected, sig) for sig in parts.get("v1", [])):
            raise WebhookRejected("Signature mismatch")
        return json.loads(payload)

    def parse_webhook(self, payload: bytes, headers: Dict[str, str]) -> Optional[Dict[str, Any]]:
        event = self.verify(payload, headers.get("stripe-signature", ""))
        ev = self.normalise(event)
        if ev and ev.get("payment_ref_is_invoice"):
            pi = self._invoice_payment_intent(ev["payment_ref"])
            if pi:
                ev["payment_ref"] = pi
        if ev:
            ev.pop("payment_ref_is_invoice", None)
        if ev and ev["type"] == "payment_succeeded" and str(ev.get("payment_ref") or "").startswith("pi_"):
            try:
                origin = self._payment_origin(ev["payment_ref"])
            except ProviderError as exc:
                if exc.retryable:
                    raise
                origin = {}
            for k, v in origin.items():
                if v and not ev.get(k):
                    ev[k] = v
        return ev

    @staticmethod
    def _invoice_subscription(obj: Dict[str, Any]) -> tuple:
        """(subscription id, subscription metadata) from an invoice in either API shape."""
        details = ((obj.get("parent") or {}).get("subscription_details")) or {}
        sub = details.get("subscription") or obj.get("subscription")
        meta = details.get("metadata") or (obj.get("subscription_details") or {}).get("metadata") or {}
        if isinstance(sub, dict):
            sub = sub.get("id")
        return sub, meta

    @staticmethod
    def normalise(event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        etype = event.get("type", "")
        obj = (event.get("data") or {}).get("object") or {}
        base = {"event_id": event.get("id")}
        if (etype in ("checkout.session.completed", "checkout.session.async_payment_succeeded")
                and obj.get("mode") == "payment" and obj.get("payment_status") == "paid"):
            meta = obj.get("metadata") or {}
            return {**base, "type": "payment_succeeded", "user_id": meta.get("user_id"), "kind": "topup",
                    "item_id": meta.get("item_id"), "payment_ref": obj.get("payment_intent"),
                    "amount_minor": obj.get("amount_total"), "currency": (obj.get("currency") or "").upper(),
                    "country": meta.get("country"), "withdrawal_waived": meta.get("withdrawal_waived") == "1",
                    "customer_id": obj.get("customer"),
                    "billing_address_country": ((obj.get("customer_details") or {}).get("address") or {}).get("country")}
        if etype == "invoice.paid":
            sub, meta = StripeProvider._invoice_subscription(obj)
            if not sub:
                return None
            line = ((obj.get("lines") or {}).get("data") or [{}])[0]
            period = line.get("period") or {}
            pi = obj.get("payment_intent")
            if isinstance(pi, dict):
                pi = pi.get("id")
            return {**base, "type": "payment_succeeded", "user_id": meta.get("user_id"), "kind": "subscription",
                    "item_id": meta.get("item_id"), "payment_ref": pi or obj.get("id"), "payment_ref_is_invoice": not pi,
                    "amount_minor": obj.get("amount_paid"), "currency": (obj.get("currency") or "").upper(),
                    "country": meta.get("country"), "withdrawal_waived": meta.get("withdrawal_waived") == "1",
                    "subscription_ref": sub, "customer_id": obj.get("customer"),
                    "billing_reason": obj.get("billing_reason"),
                    "founding_discount": meta.get("founding_discount") == "1"
                    and obj.get("billing_reason") == "subscription_create",
                    "period_start": _ts(period.get("start")), "period_end": _ts(period.get("end"))}
        if etype == "invoice.payment_failed":
            sub, meta = StripeProvider._invoice_subscription(obj)
            if not sub:
                return None
            return {**base, "type": "payment_failed", "subscription_ref": sub, "user_id": meta.get("user_id"),
                    "billing_reason": obj.get("billing_reason")}
        if etype in ("customer.subscription.updated", "customer.subscription.deleted"):
            item = ((obj.get("items") or {}).get("data") or [{}])[0]
            return {**base, "type": "subscription_deleted" if etype.endswith("deleted") else "subscription_updated",
                    "subscription_ref": obj.get("id"), "status": obj.get("status"),
                    "user_id": (obj.get("metadata") or {}).get("user_id"),
                    "cancel_at_period_end": bool(obj.get("cancel_at_period_end")),
                    "period_start": _ts(obj.get("current_period_start") or item.get("current_period_start")),
                    "period_end": _ts(obj.get("current_period_end") or item.get("current_period_end"))}
        if etype in ("refund.updated", "refund.failed"):
            return {**base, "type": "refund_updated", "provider_refund_id": obj.get("id"),
                    "status": StripeProvider._refund_result(obj).status, "reason": obj.get("failure_reason")}
        if etype == "charge.dispute.created":
            return {**base, "type": "dispute_opened", "payment_ref": obj.get("payment_intent")}
        if etype == "charge.refunded":
            return {**base, "type": "payment_refunded", "payment_ref": obj.get("payment_intent"),
                    "amount_refunded": int(obj.get("amount_refunded") or 0)}
        return None


_simulator = SimulatorProvider()


def get(name: Optional[str] = None) -> Provider:
    name = (name or config.BILLING_PROVIDER or "simulator").lower()
    if name == "stripe":
        return StripeProvider()
    return _simulator
