"""Create or reuse the Stripe Products and Prices for the billing catalog.

    STRIPE_SECRET_KEY=sk_test_... python scripts/stripe_sync_catalog.py [--dry-run]

Live mode is a separate, explicitly authorised path. It is a dry run unless every one of
these is given, and prints LIVE on every line it would write:

    STRIPE_SECRET_KEY=sk_live_... CONVOLVE_STRIPE_LIVE_APPROVED=1 \\
        python scripts/stripe_sync_catalog.py --live --confirm-account acct_... [--apply]

``--confirm-account`` must equal the account the key belongs to, so a key for the wrong
account stops the run. Without ``--apply`` nothing is written. Test keys never reach live
mode and live keys never reach test mode.

Idempotent: products have deterministic ids (``convolve_<item id>``), prices are found by
their lookup key (``app.billing.catalog.stripe_lookup_key``) and reused when amount,
currency and interval match. A changed price gets a new Price that takes over the lookup
key; the old one is archived (Stripe prices are immutable). Also creates a customer-portal
configuration limited to payment methods and invoices, because plan changes and
cancellation go through Convolve so credits and refunds stay consistent.

The webhook endpoint is not created here; WEBHOOK_EVENTS lists what it must subscribe to.
"""
from __future__ import annotations

import argparse
import os
import sys
from typing import Any, Dict, List, Optional

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("CONVOLVE_TEST", "1")

from app.billing import catalog  # noqa: E402

API = "https://api.stripe.com/v1"
TEST_PREFIXES = ("sk_test_", "rk_test_")
LIVE_PREFIXES = ("sk_live_", "rk_live_")
# Events app.billing.providers.StripeProvider.normalise handles.
WEBHOOK_EVENTS = (
    "checkout.session.completed", "checkout.session.async_payment_succeeded", "invoice.paid",
    "invoice.payment_failed", "customer.subscription.updated", "customer.subscription.deleted",
    "refund.updated", "refund.failed", "charge.refunded", "charge.dispute.created",
)


def check_mode(key: str, live: bool, approved: bool, confirm_account: Optional[str], apply: bool) -> bool:
    """Validate the mode before any request. Returns whether the run is a dry run."""
    if not live:
        if not key.startswith(TEST_PREFIXES):
            raise SystemExit("Test mode needs a Stripe test-mode key (sk_test_ or rk_test_). Live keys need --live.")
        return False
    if not key.startswith(LIVE_PREFIXES):
        raise SystemExit("--live needs a live-mode key (sk_live_ or rk_live_).")
    if not approved:
        raise SystemExit("--live needs CONVOLVE_STRIPE_LIVE_APPROVED=1 (explicit approval of live provisioning).")
    if not (confirm_account or "").startswith("acct_"):
        raise SystemExit("--live needs --confirm-account acct_... (the Stripe account the key belongs to).")
    return not apply


class Stripe:
    def __init__(self, key: str, dry_run: bool, label: str = "test"):
        self.http = httpx.Client(base_url=API, auth=(key, ""), timeout=20.0)
        self.dry_run = dry_run
        self.label = label

    def get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        r = self.http.get(path, params=params)
        if r.status_code == 404:
            return {}
        r.raise_for_status()
        return r.json()

    def post(self, path: str, data: Dict[str, Any]) -> Dict[str, Any]:
        if self.dry_run:
            print(f"  ({self.label}, dry run) POST {path}")
            return {"id": "(dry-run)"}
        if self.label == "LIVE":
            print(f"  LIVE POST {path}")
        r = self.http.post(path, data=data)
        if r.status_code >= 400:
            raise SystemExit(f"Stripe refused POST {path}: {r.json().get('error', {}).get('message')}")
        return r.json()


def items() -> List[Dict[str, Any]]:
    cat = catalog.load("")
    out = []
    for t in cat["tiers"]:
        p = t.get("price") or {}
        if p.get("amount_minor") and p.get("approved"):
            out.append({"kind": "subscription", "item": t, "credits": t["monthly_credits"],
                        "description": f"{t['monthly_credits']} research credits each month"})
    for p in cat["packs"]:
        if p["price"].get("approved"):
            out.append({"kind": "topup", "item": p, "credits": p["credits"],
                        "description": f"{p['credits']} research credits (one-time top-up)"})
    return out


def sync_product(s: Stripe, entry: Dict[str, Any]) -> str:
    item = entry["item"]
    pid = f"convolve_{item['id']}"
    name = f"Convolve {item['name']}" + (" plan" if entry["kind"] == "subscription" else " credits")
    fields = {"name": name, "description": entry["description"],
              "metadata[convolve_kind]": entry["kind"], "metadata[convolve_item_id]": item["id"],
              "metadata[credits]": str(entry["credits"])}
    existing = s.get(f"/products/{pid}")
    if not existing:
        s.post("/products", {"id": pid, **fields})
        print(f"  product {pid}: created")
    elif (existing.get("name") != name or existing.get("description") != entry["description"]
          or not existing.get("active") or (existing.get("metadata") or {}).get("credits") != str(entry["credits"])):
        s.post(f"/products/{pid}", {**fields, "active": "true"})
        print(f"  product {pid}: updated")
    else:
        print(f"  product {pid}: reused")
    return pid


def sync_price(s: Stripe, entry: Dict[str, Any], product: str) -> str:
    item, kind = entry["item"], entry["kind"]
    key = catalog.stripe_lookup_key(kind, item)
    amount, currency = item["price"]["amount_minor"], item["price"]["currency"].lower()
    interval = item["price"].get("interval") if kind == "subscription" else None
    found = (s.get("/prices", {"lookup_keys[]": key, "limit": 1}).get("data") or [None])[0]
    if found and found.get("active") and found.get("product") == product and found.get("unit_amount") == amount \
            and found.get("currency") == currency and ((found.get("recurring") or {}).get("interval") if found.get("recurring") else None) == interval:
        print(f"  price {key}: reused {found['id']}")
        return found["id"]
    data = {"product": product, "unit_amount": str(amount), "currency": currency, "lookup_key": key,
            "transfer_lookup_key": "true", "tax_behavior": "unspecified",
            "metadata[convolve_kind]": kind, "metadata[convolve_item_id]": item["id"],
            "metadata[credits]": str(entry["credits"])}
    if interval:
        data["recurring[interval]"] = interval
    created = s.post("/prices", data)
    print(f"  price {key}: created {created['id']}" + (f" (replaces {found['id']})" if found else ""))
    if found and found.get("active"):
        s.post(f"/prices/{found['id']}", {"active": "false"})
    return created["id"]


def sync_founding_coupon(s: Stripe, products: List[str]) -> Optional[str]:
    """Founding beta member coupon: FOUNDING_DISCOUNT_PERCENT off the first subscription invoice.

    Never shared as a promotion code: the API attaches it at checkout for eligible accounts only.
    Coupons are immutable, so the id carries the percentage.
    """
    from app import config

    percent = config.FOUNDING_DISCOUNT_PERCENT
    if not percent or not products:
        return None
    cid = f"convolve_founding_{percent}"
    existing = s.get(f"/coupons/{cid}")
    if existing and existing.get("valid") and existing.get("percent_off") == percent and existing.get("duration") == "once" \
            and sorted((existing.get("applies_to") or {}).get("products") or []) == sorted(products):
        print(f"  coupon {cid}: reused")
        return cid
    if existing:
        raise SystemExit(f"Coupon {cid} exists with different terms. Delete it in the Stripe Dashboard first.")
    data: Dict[str, Any] = {"id": cid, "name": f"Founding beta member {percent}%", "percent_off": str(percent),
                            "duration": "once", "metadata[convolve]": "founding_discount"}
    for i, pid in enumerate(products):
        data[f"applies_to[products][{i}]"] = pid
    s.post("/coupons", data)
    print(f"  coupon {cid}: created")
    return cid


def sync_portal(s: Stripe) -> None:
    configs = s.get("/billing_portal/configurations", {"limit": 10}).get("data") or []
    if any((c.get("metadata") or {}).get("convolve") == "1" and c.get("active") for c in configs):
        print("  customer portal configuration: reused")
        return
    s.post("/billing_portal/configurations", {
        "default_return_url": os.getenv("BILLING_RETURN_URL", "http://localhost:5173/account?tab=plan"),
        "features[payment_method_update][enabled]": "true",
        "features[invoice_history][enabled]": "true",
        "features[customer_update][enabled]": "false",
        "features[subscription_cancel][enabled]": "false",
        "features[subscription_update][enabled]": "false",
        "metadata[convolve]": "1",
    })
    print("  customer portal configuration: created")


def main(argv: Optional[List[str]] = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="Test mode: print what would change")
    ap.add_argument("--live", action="store_true", help="Live mode (needs approval; dry run unless --apply)")
    ap.add_argument("--confirm-account", help="Live mode: the Stripe account id the key must belong to")
    ap.add_argument("--apply", action="store_true", help="Live mode: actually write")
    args = ap.parse_args(argv)
    key = os.getenv("STRIPE_SECRET_KEY", "")
    live_dry = check_mode(key, args.live, os.getenv("CONVOLVE_STRIPE_LIVE_APPROVED") == "1", args.confirm_account, args.apply)
    label = "LIVE" if args.live else "test"
    if args.live and os.getenv("BILLING_RETURN_URL", "").split("://")[0] != "https":
        raise SystemExit("--live needs BILLING_RETURN_URL set to the production https address of the plan page.")
    s = Stripe(key, args.dry_run or live_dry, label)
    acct = s.get("/account")
    if args.live and acct.get("id") != args.confirm_account:
        raise SystemExit(f"The key belongs to {acct.get('id')}, not {args.confirm_account}. Nothing was changed.")
    name = (acct.get("settings") or {}).get("dashboard", {}).get("display_name") or "-"
    print(f"Stripe account {acct.get('id')} ({name}), {label} mode{' - DRY RUN, nothing is written' if s.dry_run else ''}")
    subscription_products = []
    for entry in items():
        product = sync_product(s, entry)
        sync_price(s, entry, product)
        if entry["kind"] == "subscription":
            subscription_products.append(product)
    coupon = sync_founding_coupon(s, subscription_products)
    sync_portal(s)
    if coupon:
        print(f"Set STRIPE_FOUNDING_COUPON={coupon} on the API service.")
    print("Webhook endpoint (create or check in the Stripe dashboard): POST <API>/api/billing/webhook/stripe, events:")
    print("  " + ", ".join(WEBHOOK_EVENTS))


if __name__ == "__main__":
    main()
