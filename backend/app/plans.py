"""Plan catalogue and run pricing. The single place to change commercial terms.

Nothing here is billed: payment processing is not implemented. ``price`` and paid-plan
credit amounts stay ``None`` until they are decided; the UI then shows "Coming soon".
Plan definitions, a user's plan (``user_plans``), the credit ledger and usage records
(``pipeline_runs``) are kept separate on purpose.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

DEFAULT_PLAN_ID = "free"

# Run prices depend on the run's configuration and are defined in ``app.pricing``.
from app.pricing import PRICING_VERSION, TOOL_LABELS, catalogue as price_catalogue, default_cost  # noqa: E402

PLANS: List[Dict[str, Any]] = [
    {
        "id": "free",
        "name": "Free",
        "availability": "available",
        "summary": "Explore the full research workflow on a starter allocation.",
        "price": {"amount": 0, "currency": None, "interval": None},
        "credits": {"amount": 50, "cadence": "one_time"},
        "features": [
            "All research tools: dataset generation, CNN training, analysis, backtesting",
            "Paper-trading bots (simulated, no brokerage connection)",
            "Data export and account deletion at any time",
        ],
    },
    {
        "id": "individual",
        "name": "Individual",
        "availability": "coming_soon",
        "summary": "For independent researchers running experiments regularly.",
        "price": None,
        "credits": None,
        "features": ["Everything in Free", "A recurring credit allocation"],
    },
    {
        "id": "advanced",
        "name": "Advanced",
        "availability": "coming_soon",
        "summary": "For heavier training and backtesting workloads.",
        "price": None,
        "credits": None,
        "features": ["Everything in Individual", "A larger recurring credit allocation"],
    },
    {
        "id": "professional",
        "name": "Professional",
        "availability": "contact",
        "summary": "For teams and custom requirements.",
        "price": None,
        "credits": None,
        "features": ["Everything in Advanced", "Terms agreed individually"],
    },
]


# Per-plan compute limits. No commercial limits are decided, so no plan overrides anything yet
# and every plan gets the operational defaults from app.config (TRAINER_MAX_*).
PLAN_COMPUTE_LIMITS: Dict[str, Dict[str, Optional[int]]] = {plan["id"]: {} for plan in PLANS}


def compute_limits(plan_id: Optional[str]) -> Dict[str, int]:
    """Effective limits for a plan; 0 means unlimited."""
    from app import config

    limits = {
        "max_active_training_jobs": config.TRAINER_MAX_ACTIVE_JOBS_PER_USER,
        "max_queued_training_jobs": config.TRAINER_MAX_QUEUED_JOBS_PER_USER,
        "max_training_images": config.TRAINER_MAX_TRAINING_IMAGES,
        "max_epochs": config.TRAINER_MAX_EPOCHS,
    }
    overrides = PLAN_COMPUTE_LIMITS.get(get_plan(plan_id)["id"]) or {}
    limits.update({k: int(v) for k, v in overrides.items() if v is not None and k in limits})
    return limits


def get_plan(plan_id: Optional[str]) -> Dict[str, Any]:
    for plan in PLANS:
        if plan["id"] == plan_id:
            return plan
    return next(p for p in PLANS if p["id"] == DEFAULT_PLAN_ID)


def run_cost(tool: str) -> int:
    """Price of ``tool`` at its default configuration (used only when no quote is available)."""
    return default_cost(tool)


def public_catalogue() -> Dict[str, Any]:
    from app import config

    return {
        "charging_enabled": config.CREDITS_MODE == "enforce",
        "plans": PLANS,
        "default_plan_id": DEFAULT_PLAN_ID,
        "pricing_version": PRICING_VERSION,
        "run_costs": price_catalogue(),
        "billing_available": False,
    }
