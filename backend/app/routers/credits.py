"""Credit balance, history and run quotes for the caller; public plan catalogue."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Request

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


@router.get("/api/credits/quote")
def get_quote(tool: str, request: Request) -> Dict[str, Any]:
    return svc.quote(get_current_user_id(request), tool)
