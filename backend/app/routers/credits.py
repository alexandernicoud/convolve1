"""Credit balance, history and run quotes for the caller; public plan catalogue."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.auth import get_current_user_id, require_user_id
from app.plans import public_catalogue
from app.services import credits as svc

router = APIRouter(tags=["credits"])


@router.get("/api/plans")
def get_plans() -> Dict[str, Any]:
    return public_catalogue()


@router.get("/api/credits")
def get_credits(request: Request) -> Dict[str, Any]:
    return svc.summary(require_user_id(request))


class QuoteRequest(BaseModel):
    tool: str = Field(..., max_length=64)
    params: Dict[str, Any] = Field(default_factory=dict)


@router.get("/api/credits/quote")
def get_quote(tool: str, request: Request) -> Dict[str, Any]:
    """Price of ``tool`` at its default configuration."""
    return svc.quote(get_current_user_id(request), tool)


@router.post("/api/credits/quote")
def post_quote(body: QuoteRequest, request: Request) -> Dict[str, Any]:
    """Price of one run with this configuration. Informational: the run is re-priced on submit."""
    return svc.quote(get_current_user_id(request), body.tool, body.params)
