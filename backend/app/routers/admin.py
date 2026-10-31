"""Administrator console: one read-only overview of accounts and activity."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Request

from app.auth import require_admin
from app.services import admin_overview

router = APIRouter(tags=["admin"])


@router.get("/api/admin/overview")
def get_overview(request: Request) -> Dict[str, Any]:
    require_admin(request)
    return admin_overview.overview()
