"""Earning promotional credits: ambassador codes, invite claims, the citation bonus and its review."""

from __future__ import annotations

import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, Query, Request, Response, UploadFile
from pydantic import BaseModel, Field

from app.auth import require_admin, require_user_id, require_verified_user
from app.services import rewards

router = APIRouter(tags=["rewards"])


@router.get("/api/rewards")
def get_rewards(request: Request) -> Dict[str, Any]:
    return rewards.status(require_user_id(request))


@router.get("/api/rewards/founding-discount")
def get_founding_discount(request: Request) -> Dict[str, Any]:
    from app.billing import founding
    from app.db import SessionLocal

    uid = uuid.UUID(require_user_id(request))
    with SessionLocal() as db:
        return founding.state(db, uid)


@router.post("/api/rewards/referral-code")
def post_referral_code(request: Request) -> Dict[str, Any]:
    return {"code": rewards.get_or_create_code(require_verified_user(request))}


@router.get("/api/referrals/check")
def check_referral_code(code: str = Query("", max_length=32)) -> Dict[str, Any]:
    """Public: whether an invite code exists. Reveals nothing about its owner."""
    return {"valid": rewards.check_code(code), "credits_on_subscribe": rewards.REFEREE_CREDITS,
            "rewards": rewards.reward_table()}


class ClaimBody(BaseModel):
    code: str = Field(..., max_length=32)


@router.post("/api/referrals/claim")
def post_referral_claim(body: ClaimBody, request: Request) -> Dict[str, Any]:
    return rewards.claim_referral(require_user_id(request), body.code)


@router.post("/api/rewards/citation")
async def post_citation(
    request: Request,
    background: BackgroundTasks,
    url: str = Form("", max_length=1000),
    note: str = Form("", max_length=5000),
    file: Optional[UploadFile] = File(None),
) -> Dict[str, Any]:
    uid = require_verified_user(request)
    data = None
    if file is not None:
        data = await file.read(rewards.CITATION_MAX_BYTES + 1)
    out = rewards.submit_citation(uid, url=url, note=note, file_name=file.filename if file else None,
                                  content_type=file.content_type if file else None, data=data)
    background.add_task(rewards.notify_citation, out["id"])
    return out


@router.get("/api/admin/citations")
def admin_citations(request: Request, status: Optional[str] = Query(None, pattern="^(pending|approved|rejected)$"),
                    limit: int = Query(200, ge=1, le=1000), offset: int = Query(0, ge=0)) -> Dict[str, Any]:
    require_admin(request)
    return rewards.admin_citations(status, limit, offset)


@router.get("/api/admin/citations/{claim_id}/file")
def admin_citation_file(claim_id: str, request: Request) -> Response:
    require_admin(request)
    data, ctype, name = rewards.admin_citation_file(claim_id)
    safe = "".join(ch for ch in name if ch.isalnum() or ch in "._-") or "citation"
    return Response(content=data, media_type=ctype, headers={
        "Content-Disposition": f'attachment; filename="{safe}"', "X-Content-Type-Options": "nosniff",
    })


class ReviewBody(BaseModel):
    approve: bool
    note: Optional[str] = Field(None, max_length=2000)


@router.post("/api/admin/citations/{claim_id}/review")
def admin_review_citation(claim_id: str, body: ReviewBody, request: Request) -> Dict[str, Any]:
    admin = require_admin(request)
    return rewards.review_citation(admin, claim_id, approve=body.approve, note=body.note)
