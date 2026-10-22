from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.auth import get_current_user_id
from app.services import direct_uploads

router = APIRouter(tags=["uploads"])


class UploadInitRequest(BaseModel):
    kind: str
    filename: str
    size: int
    content_type: Optional[str] = None


@router.post("/api/uploads")
def init_direct_upload(body: UploadInitRequest, request: Request) -> dict:
    """Start a direct-to-storage upload, or answer mode "multipart" when unavailable."""
    return direct_uploads.init_upload(
        get_current_user_id(request),
        body.kind,
        body.filename,
        body.size,
        body.content_type,
        request.headers.get("origin"),
    )
