"""Commercial catalogue: subscription tiers, their entitlements and quotas, and credit packs.

The single place commercial terms are defined. Every value can be overridden without a
code change through ``BILLING_CATALOG_OVERRIDES`` (a JSON object deep-merged over
``DEFAULTS``), so prices and allowances stay adjustable until they are approved.

Three independent controls (never mixed):
* features   - what a tier may use at all (e.g. advanced architectures);
* credits    - how much computation is consumed (``app.pricing``);
* quotas     - usage counts per billing period or at a time (backtests, deployments).
Bought credits never unlock features or raise quotas.

Adding a tier (e.g. Professional) means adding one entry with a higher ``rank``; no code
path checks a tier id directly. ``availability: "hidden"`` keeps a tier out of the public
catalogue and out of checkout.

Monetary amounts are integers in the currency's minor unit.
"""

from __future__ import annotations

import copy
import json
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

CATALOG_VERSION = "2026-10-28.1"

# Feature flags. Each gate in the code names one of these.
FEATURES = {
    "research.run": "Run research tools (generator, optimizer, trainer, analysis, backtests)",
    "trainer.advanced": "Advanced training options (optimizer, learning-rate schedule, augmentation, custom input size)",
    "trainer.transfer": "Transfer learning from pretrained weights",
    "optimizer.full": "Labeling Optimizer on long histories",
    "lab.basic": "Grad-CAM and saliency on single images",
    "lab.advanced": "Interventions, activation maximisation, feature atlases and representation analysis",
    "reports.advanced": "Advanced reports, model comparisons and exports",
    "uploads": "Upload datasets and models",
    "deploy": "Paper deployments",
}

DEFAULTS: Dict[str, Any] = {
    "currency": "USD",
    "tiers": [
        {
            "id": "starter",
            "name": "Starter",
            "rank": 10,
            "availability": "available",
            "price": {"amount_minor": 499, "currency": "USD", "interval": "month", "approved": True},
            # Exactly the cheapest end-to-end workflow under the current price list (app.pricing);
            # a retry needs extra credits.
            "monthly_credits": 15,
            "summary": "An inexpensive way to run one complete experiment: generate, train, analyse, backtest.",
            "features": ["research.run", "lab.basic", "uploads", "deploy"],
            "quotas": {"backtests_per_period": 3, "active_deployments": 1},
            "limits": {
                "architectures": ["convolve-cnn-v1", "convolve-cnn-compact-v1"],
                "max_training_images": 3000,
                "max_epochs": 30,
                "generator_max_symbols": 2,
                "generator_max_charts_per_label": 1000,
                "optimizer_max_history_days": 3 * 366,
            },
            "highlights": [
                "Credits each month for a small end-to-end experiment",
                "Dataset generation and label optimisation on shorter histories",
                "Standard and compact CNNs",
                "Essential model statistics",
                "Grad-CAM and saliency on single charts",
                "3 backtests per billing period",
                "1 active paper deployment",
                "Buy extra credits at any time",
            ],
        },
        {
            "id": "research",
            "name": "Research",
            "rank": 20,
            "availability": "available",
            "price": {"amount_minor": 2900, "currency": "USD", "interval": "month", "approved": True},
            "monthly_credits": 150,
            "summary": "The full research environment for regular experiments.",
            "features": [
                "research.run", "trainer.advanced", "trainer.transfer", "optimizer.full",
                "lab.basic", "lab.advanced", "reports.advanced", "uploads", "deploy",
            ],
            "quotas": {"backtests_per_period": 30, "active_deployments": 3},
            "limits": {
                "architectures": None,  # every supported architecture
                "max_training_images": None,  # operational default (TRAINER_MAX_TRAINING_IMAGES)
                "max_epochs": None,
                "generator_max_symbols": None,
                "generator_max_charts_per_label": None,
                "optimizer_max_history_days": None,
            },
            "highlights": [
                "Credits each month for regular research",
                "Every supported CNN architecture, including transfer learning",
                "Advanced training options",
                "Full Labeling Optimizer",
                "Advanced Grad-CAM, feature maps and representation analysis",
                "Detailed post-run evaluations, statistics and model comparisons",
                "30 backtests per billing period",
                "3 active paper deployments",
                "Advanced reports and exports",
                "Buy extra credits at any time",
            ],
        },
        {
            "id": "professional",
            "name": "Professional",
            "rank": 30,
            "availability": "available",
            "price": {"amount_minor": 9900, "currency": "USD", "interval": "month", "approved": True},
            # Margins and capacity: scripts/plan_economics.py. Deployments stay at 10 while paper
            # bots run on one serial job worker (bots-job.yaml); 20 halves the users it serves.
            "monthly_credits": 1200,
            "summary": "The same research environment with eight times the compute.",
            "features": [
                "research.run", "trainer.advanced", "trainer.transfer", "optimizer.full",
                "lab.basic", "lab.advanced", "reports.advanced", "uploads", "deploy",
            ],
            "quotas": {"backtests_per_period": 100, "active_deployments": 10},
            "limits": {
                "architectures": None,
                "max_training_images": None,
                "max_epochs": None,
                "generator_max_symbols": None,
                "generator_max_charts_per_label": None,
                "optimizer_max_history_days": None,
            },
            "highlights": [
                "Eight times the monthly credits of Research",
                "Everything in Research",
                "100 backtests per billing period",
                "10 active paper deployments",
                "Buy extra credits at any time",
            ],
        },
    ],
    "packs": [
        {"id": "extra", "name": "Extra", "credits": 100, "price": {"amount_minor": 900, "currency": "USD", "approved": True}},
        {"id": "research_pack", "name": "Research Pack", "credits": 400, "price": {"amount_minor": 2900, "currency": "USD", "approved": True}},
        {"id": "lab_pack", "name": "Lab Pack", "credits": 1500, "price": {"amount_minor": 8900, "currency": "USD", "approved": True}},
    ],
    "refunds": {
        # Voluntary share of the unused purchase value returned for unused purchased credits.
        "voluntary_rate_bps": 5000,
        # Withdrawal period for consumers in WITHDRAWAL_COUNTRIES (EU/EEA, UK): a purchase
        # left completely unused inside this period is refunded in full unless the consumer
        # expressly waived the right at checkout.
        "withdrawal_days": 14,
        # Countries where counsel confirms a full refund of unused prepaid credit is mandatory.
        "full_refund_countries": [],
    },
    "subscription": {
        # Monthly credits expire at the end of the period they were granted for.
        "credits_expire_at_period_end": True,
        # Days after a failed renewal during which research stays available (0 = none).
        "past_due_grace_days": 0,
    },
}

EU_EEA = frozenset(
    "AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK IS LI NO".split()
)
WITHDRAWAL_COUNTRIES = EU_EEA | {"GB"}

# ISO 4217 minor-unit exponents that are not 2.
_CURRENCY_EXPONENT = {
    "BIF": 0, "CLP": 0, "DJF": 0, "GNF": 0, "ISK": 0, "JPY": 0, "KMF": 0, "KRW": 0, "PYG": 0,
    "RWF": 0, "UGX": 0, "VND": 0, "VUV": 0, "XAF": 0, "XOF": 0, "XPF": 0,
    "BHD": 3, "IQD": 3, "JOD": 3, "KWD": 3, "LYD": 3, "OMR": 3, "TND": 3,
}


def currency_exponent(currency: str) -> int:
    return _CURRENCY_EXPONENT.get((currency or "").upper(), 2)


def _merge(base: Any, over: Any) -> Any:
    if isinstance(base, dict) and isinstance(over, dict):
        out = dict(base)
        for k, v in over.items():
            out[k] = _merge(base.get(k), v) if k in base else v
        return out
    if isinstance(base, list) and isinstance(over, list) and all(isinstance(x, dict) and "id" in x for x in base + over):
        by_id = {x["id"]: x for x in base}
        merged = [_merge(by_id[x["id"]], x) if x["id"] in by_id else x for x in over]
        seen = {x["id"] for x in over}
        return [x for x in base if x["id"] not in seen] + merged
    return over


def load(overrides: Optional[str] = None) -> Dict[str, Any]:
    """Defaults merged with the JSON override (``BILLING_CATALOG_OVERRIDES`` unless given)."""
    from app import config

    raw = config.BILLING_CATALOG_OVERRIDES if overrides is None else overrides
    cat = copy.deepcopy(DEFAULTS)
    if raw:
        try:
            cat = _merge(cat, json.loads(raw))
        except (ValueError, TypeError):
            logger.error("BILLING_CATALOG_OVERRIDES is not valid JSON; using defaults")
    cat["tiers"] = sorted(cat["tiers"], key=lambda t: t.get("rank", 0))
    return cat


def tier(tier_id: Optional[str], cat: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    for t in (cat or load())["tiers"]:
        if t["id"] == tier_id:
            return t
    return None


def pack(pack_id: str, cat: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    for p in (cat or load())["packs"]:
        if p["id"] == pack_id:
            return p
    return None


def stripe_lookup_key(kind: str, item: Dict[str, Any]) -> str:
    """Stable Stripe price lookup key for a tier or pack in its currency."""
    return f"convolve_{kind}_{item['id']}_{item['price']['currency'].lower()}"


def lowest_tier_with(feature: str, cat: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    for t in (cat or load())["tiers"]:
        if t.get("availability") != "hidden" and feature in t.get("features", []):
            return t
    return None


def public(cat: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """What the pricing page and checkout may show. Hidden tiers are omitted."""
    cat = cat or load()
    tiers: List[Dict[str, Any]] = []
    for t in cat["tiers"]:
        if t.get("availability") == "hidden":
            continue
        tiers.append({k: t[k] for k in ("id", "name", "rank", "availability", "price", "monthly_credits", "summary",
                                         "features", "quotas", "limits", "highlights") if k in t})
    return {
        "version": CATALOG_VERSION,
        "currency": cat["currency"],
        "tiers": tiers,
        "packs": cat["packs"],
        "refunds": {
            "voluntary_rate_bps": cat["refunds"]["voluntary_rate_bps"],
            "withdrawal_days": cat["refunds"]["withdrawal_days"],
        },
        "subscription": cat["subscription"],
        "features": FEATURES,
    }
