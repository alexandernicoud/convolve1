"""Plan catalogue and run pricing. The single place to change commercial terms.

Nothing here is billed: payment processing is not implemented. ``price`` and paid-plan
credit amounts stay ``None`` until they are decided; the UI then shows "Coming soon".
Plan definitions, a user's plan (``user_plans``), the credit ledger and usage records
(``pipeline_runs``) are kept separate on purpose.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

DEFAULT_PLAN_ID = "free"

# Credits charged when a run is accepted. Only tools listed here are charged; every
# entry is a flat per-run price (the previous browser-only system charged 10 per run).
RUN_COSTS: Dict[str, int] = {
    "training-chart-generator": 10,
    "trainer": 10,
    "analysis": 10,
    "backtester": 10,
    "testdata": 10,
    "labeling-optimizer": 10,
}

TOOL_LABELS: Dict[str, str] = {
    "training-chart-generator": "Dataset generator",
    "trainer": "CNN training",
    "analysis": "Model analysis",
    "backtester": "Backtest",
    "testdata": "Test data",
    "labeling-optimizer": "Labeling optimizer",
}

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


def get_plan(plan_id: Optional[str]) -> Dict[str, Any]:
    for plan in PLANS:
        if plan["id"] == plan_id:
            return plan
    return next(p for p in PLANS if p["id"] == DEFAULT_PLAN_ID)


def run_cost(tool: str) -> int:
    return int(RUN_COSTS.get(tool, 0))


def public_catalogue() -> Dict[str, Any]:
    from app import config

    return {
        "charging_enabled": config.CREDITS_MODE == "enforce",
        "plans": PLANS,
        "default_plan_id": DEFAULT_PLAN_ID,
        "run_costs": [
            {"tool": tool, "label": TOOL_LABELS.get(tool, tool), "credits": cost} for tool, cost in RUN_COSTS.items()
        ],
        "billing_available": False,
    }
