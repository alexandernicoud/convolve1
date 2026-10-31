"""Exact refund arithmetic in integer minor units (no floats).

refund = round_half_up(amount_paid x unused_credits / credits_bought x rate)

computed as one rational number and rounded once, then capped at what the payment still
has unrefunded. Example (USD, cents): 2900 x 300/400 x 0.70 = 1522.5 -> 1523 ($15.23).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from fractions import Fraction
from typing import Any, Dict, Optional

from app.billing import catalog


def round_half_up(value: Fraction) -> int:
    if value < 0:
        return -round_half_up(-value)
    whole, rest = divmod(value.numerator, value.denominator)
    return whole + (1 if 2 * rest >= value.denominator else 0)


def unused_value_minor(amount_minor: int, credits_total: int, credits_unused: int) -> Fraction:
    if credits_total <= 0:
        return Fraction(0)
    return Fraction(amount_minor * credits_unused, credits_total)


def refund_minor(amount_minor: int, credits_total: int, credits_unused: int, rate_bps: int,
                 cap_minor: Optional[int] = None) -> int:
    value = round_half_up(unused_value_minor(amount_minor, credits_total, credits_unused) * Fraction(rate_bps, 10000))
    return max(0, min(value, cap_minor)) if cap_minor is not None else max(0, value)


def format_minor(amount_minor: int, currency: str) -> str:
    exp = catalog.currency_exponent(currency)
    if exp == 0:
        return f"{amount_minor} {currency.upper()}"
    sign = "-" if amount_minor < 0 else ""
    whole, frac = divmod(abs(amount_minor), 10 ** exp)
    return f"{sign}{whole}.{frac:0{exp}d} {currency.upper()}"


def refund_basis(lot: Any, country: Optional[str], refunds_cfg: Dict[str, Any],
                 now: Optional[datetime] = None) -> Dict[str, Any]:
    """Which rate applies to a purchase lot, and why.

    * ``statutory_override``: the lot is flagged for a full refund (an operator decision or a
      country where counsel confirmed full refunds of unused prepaid credit are mandatory).
    * ``statutory_withdrawal``: an EU/EEA/UK consumer, inside the withdrawal period, with the
      purchase completely unused and the right not expressly waived at checkout.
    * ``voluntary``: everything else; the configured voluntary share (50 %).
    """
    now = now or datetime.now(timezone.utc)
    country = (country or "").upper()
    if getattr(lot, "statutory_override", None) == "full" or country in {
        c.upper() for c in refunds_cfg.get("full_refund_countries", [])
    }:
        return {"basis": "statutory_override", "rate_bps": 10000}
    created = lot.created_at
    if created is not None and created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    untouched = lot.credits_remaining == lot.credits_total and lot.credits_refunded == 0
    within = created is not None and now - created <= timedelta(days=int(refunds_cfg.get("withdrawal_days", 14)))
    if country in catalog.WITHDRAWAL_COUNTRIES and untouched and within and not lot.withdrawal_waived:
        return {"basis": "statutory_withdrawal", "rate_bps": 10000}
    return {"basis": "voluntary", "rate_bps": int(refunds_cfg.get("voluntary_rate_bps", 5000))}
