"""Self-service account endpoints. The account is always the caller's; no user id is accepted."""

from __future__ import annotations

import time
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.auth import bearer_token_from_request, decode_supabase_token, require_user_id
from app.services import account as svc

router = APIRouter(prefix="/api/account", tags=["account"])

DELETE_PHRASE = "delete my account"
REAUTH_MAX_AGE_S = 10 * 60


class ProfileUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)


class DeleteRequest(BaseModel):
    confirm: str


class TermsAcceptance(BaseModel):
    terms_version: str = Field(max_length=40)
    privacy_version: str = Field(max_length=40)


def _last_sign_in(claims: Dict[str, Any]) -> float:
    """Most recent authentication time from Supabase's ``amr`` claim (not token refreshes)."""
    stamps = [
        float(entry["timestamp"])
        for entry in claims.get("amr") or []
        if isinstance(entry, dict) and isinstance(entry.get("timestamp"), (int, float))
    ]
    return max(stamps, default=0.0)


@router.get("")
def get_account(request: Request) -> Dict[str, Any]:
    return svc.get_profile(require_user_id(request))


@router.patch("")
def patch_account(body: ProfileUpdate, request: Request) -> Dict[str, Any]:
    name = body.display_name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Display name cannot be empty")
    return svc.update_display_name(require_user_id(request), name)


@router.post("/terms")
def accept_terms(body: TermsAcceptance, request: Request) -> Dict[str, Any]:
    try:
        return svc.accept_terms(require_user_id(request), body.terms_version, body.privacy_version)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class OnboardingUpdate(BaseModel):
    status: str = Field(max_length=20)
    step: int = Field(ge=0, le=20)
    welcome_seen: bool = True


@router.get("/onboarding")
def get_onboarding(request: Request) -> Dict[str, Any]:
    return svc.get_onboarding(require_user_id(request))


@router.put("/onboarding")
def put_onboarding(body: OnboardingUpdate, request: Request) -> Dict[str, Any]:
    try:
        return svc.save_onboarding(require_user_id(request), body.status, body.step, body.welcome_seen)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/usage")
def get_usage(request: Request) -> Dict[str, Any]:
    return svc.get_usage(require_user_id(request))


@router.get("/export")
def export_account(request: Request) -> JSONResponse:
    user_id = require_user_id(request)
    return JSONResponse(
        svc.export_account(user_id),
        headers={"Content-Disposition": 'attachment; filename="convolve-account-export.json"', "Cache-Control": "no-store"},
    )


@router.delete("")
def delete_account(body: DeleteRequest, request: Request) -> JSONResponse:
    user_id = require_user_id(request)
    if body.confirm.strip().lower() != DELETE_PHRASE:
        raise HTTPException(status_code=422, detail=f'Type "{DELETE_PHRASE}" to confirm')
    claims = decode_supabase_token(bearer_token_from_request(request))
    if time.time() - _last_sign_in(claims) > REAUTH_MAX_AGE_S:
        raise HTTPException(status_code=403, detail="Please sign in again to confirm it is you")
    result = svc.delete_account(user_id)
    return JSONResponse(result, status_code=200 if result["ok"] else 500)
