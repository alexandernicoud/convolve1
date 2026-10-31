"""HTTP-facing billing gates for endpoints outside the charged-run path."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import HTTPException

from app.billing import BillingError, service


def require_feature(user_id: Any, feature: str, message: Optional[str] = None) -> None:
    """403 with a machine-readable code when billing is on and the caller's plan lacks ``feature``."""
    try:
        service.require(user_id, feature, message)
    except BillingError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail()) from exc
