"""Who may start work that downloads market prices.

Generator (runs, estimates, previews, symbol search), Labeling Optimizer, test data, Backtester
(benchmark prices) and paper bots fetch from Yahoo Finance. Until a data licence covers public
use, MARKET_DATA_ACCESS=cohort limits these to the account ids in MARKET_DATA_COHORT. Saved
results, downloads, training on existing datasets and model analysis are never restricted.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import HTTPException

from app import config

MARKET_DATA_TOOLS = frozenset({"training-chart-generator", "labeling-optimizer", "testdata", "backtester", "bots"})

MESSAGE = (
    "Tools that download market prices are open to an invited test group while market-data "
    "licensing is finalised. Training on your saved datasets and analysing your models remain available."
)


def restricted() -> bool:
    return config.MARKET_DATA_ACCESS == "cohort"


def allowed(user_id: Optional[str]) -> bool:
    if not restricted():
        return True
    return bool(user_id) and str(user_id).strip().lower() in config.MARKET_DATA_COHORT


def check(user_id: Optional[str], tool: str = "training-chart-generator") -> None:
    if tool not in MARKET_DATA_TOOLS or allowed(user_id):
        return
    raise HTTPException(status_code=403, detail={
        "code": "market_data_restricted",
        "message": MESSAGE,
        "contact_url": "/contact",
    })


def public_state() -> Dict[str, Any]:
    return {"access": config.MARKET_DATA_ACCESS, "tools": sorted(MARKET_DATA_TOOLS)}
