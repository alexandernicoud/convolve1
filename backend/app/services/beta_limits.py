"""Per-run size limits of the free beta (FREE_BETA=1). No effect otherwise.

Checked server-side before a run is registered, so an oversized request is refused (HTTP 422,
code "beta_limit") without starting or queueing anything. Concurrency, queue depth and runs per
day are capped separately (RESEARCH_* in app.config, app.services.research_jobs).
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, Optional

from fastapi import HTTPException

from app import config


def _symbols(raw: str) -> int:
    return len([s for s in str(raw or "").split(",") if s.strip()])


def _refuse(message: str, limit: Any) -> None:
    raise HTTPException(status_code=422, detail={"code": "beta_limit", "message": message, "limit": limit})


def _check_symbols(raw: str) -> None:
    cap = config.BETA_MAX_SYMBOLS
    if cap and _symbols(raw) > cap:
        _refuse(f"The free beta allows up to {cap} symbols per run.", cap)


def _check_image(dim: Optional[int]) -> None:
    cap = config.BETA_MAX_IMAGE_DIMENSION
    if cap and dim and int(dim) > cap:
        _refuse(f"The free beta allows images up to {cap} px.", cap)


def check_generator(symbols: str, charts_per_label: int, image_dimension: int) -> None:
    if not config.FREE_BETA:
        return
    _check_symbols(symbols)
    cap = config.BETA_MAX_CHARTS_PER_LABEL
    if cap and charts_per_label and int(charts_per_label) > cap:
        _refuse(f"The free beta allows up to {cap:,} charts per label and symbol.", cap)
    _check_image(image_dimension)


def check_testdata(symbols: str, img_dim: int) -> None:
    if not config.FREE_BETA:
        return
    _check_symbols(symbols)
    _check_image(img_dim)


def check_optimizer(start: str, end: str) -> None:
    if not config.FREE_BETA or not config.BETA_MAX_OPTIMIZER_YEARS:
        return
    try:
        days = (date.fromisoformat(str(end)[:10]) - date.fromisoformat(str(start)[:10])).days
    except ValueError:
        return  # the request model reports malformed dates
    cap = config.BETA_MAX_OPTIMIZER_YEARS
    if days > cap * 366:
        _refuse(f"The free beta allows optimizer periods up to {cap} years.", cap)


def public_limits() -> Dict[str, Any]:
    """What the pricing / account pages show about the beta. Empty when the beta is off."""
    if not config.FREE_BETA:
        return {}
    return {
        "free_beta": True,
        "max_symbols": config.BETA_MAX_SYMBOLS,
        "max_charts_per_label": config.BETA_MAX_CHARTS_PER_LABEL,
        "max_image_dimension": config.BETA_MAX_IMAGE_DIMENSION,
        "max_optimizer_years": config.BETA_MAX_OPTIMIZER_YEARS,
        "max_active_runs": config.RESEARCH_MAX_ACTIVE_JOBS_PER_USER,
        "max_queued_runs": config.RESEARCH_MAX_QUEUED_JOBS_PER_USER,
        "max_runs_per_day": config.RESEARCH_MAX_RUNS_PER_DAY,
        "max_active_inprocess_runs": config.INPROCESS_MAX_ACTIVE_RUNS_PER_USER,
        "max_active_training_jobs": config.TRAINER_MAX_ACTIVE_JOBS_PER_USER,
        "max_epochs": config.TRAINER_MAX_EPOCHS,
        "max_training_images": config.TRAINER_MAX_TRAINING_IMAGES,
    }
