"""Feedback questionnaire, contact form and the administrator's read-only views of both."""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Query, Request, Response
from pydantic import BaseModel, Field

from app.auth import require_admin, require_user_id, require_verified_user
from app.services import contact, feedback

router = APIRouter(tags=["feedback"])


class FeedbackBody(BaseModel):
    answers: Dict[str, Any]


@router.get("/api/feedback")
def get_feedback(request: Request) -> Dict[str, Any]:
    return feedback.status(require_user_id(request))


@router.post("/api/feedback")
def post_feedback(body: FeedbackBody, request: Request) -> Dict[str, Any]:
    return feedback.submit(require_verified_user(request), body.answers)


class ContactBody(BaseModel):
    name: str = Field("", max_length=1000)
    email: str = Field("", max_length=1000)
    message: str = Field("", max_length=20000)
    topic: Optional[str] = Field(None, max_length=64)
    website: str = Field("", max_length=1000)  # honeypot: hidden from people, filled by bots
    elapsed_ms: int = Field(0, ge=0)


@router.post("/api/contact")
def post_contact(body: ContactBody, request: Request, background: BackgroundTasks) -> Dict[str, Any]:
    out = contact.submit(name=body.name, email=body.email, message=body.message, topic=body.topic,
                         website=body.website, elapsed_ms=body.elapsed_ms, ip=contact.client_ip(request), user_id=None)
    background.add_task(contact.notify, out["id"])
    return {"ok": True}


@router.get("/api/admin/feedback")
def admin_feedback(request: Request, limit: int = Query(200, ge=1, le=1000), offset: int = Query(0, ge=0)) -> Dict[str, Any]:
    require_admin(request)
    return feedback.admin_list(limit, offset)


@router.get("/api/admin/feedback.csv")
def admin_feedback_csv(request: Request) -> Response:
    require_admin(request)
    return Response(
        feedback.admin_csv(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="convolve-feedback.csv"', "Cache-Control": "no-store"},
    )


@router.get("/api/admin/contact")
def admin_contact(request: Request, limit: int = Query(200, ge=1, le=1000), offset: int = Query(0, ge=0)) -> Dict[str, Any]:
    require_admin(request)
    return contact.admin_list(limit, offset)
