"""Accounts exempt from beta limits, queue caps, the questionnaire gate and size limits.

Admins (ADMIN_USER_IDS, or the profile email listed in ADMIN_EMAILS). The email comes from the
Supabase token via ``ensure_profile``; Supabase keeps emails unique, so another account cannot
hold an admin address. Checked without a request because queue pumps run outside one.
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Dict, Optional, Tuple

from app import config

_TTL_SECONDS = 300.0
_cache: Dict[str, Tuple[float, bool]] = {}
_lock = threading.Lock()


def is_unlimited(user_id: Optional[object]) -> bool:
    if not user_id:
        return False
    key = str(user_id).lower()
    if key in config.ADMIN_USER_IDS:
        return True
    if not config.ADMIN_EMAILS:
        return False
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < _TTL_SECONDS:
            return hit[1]
    result = _email_is_admin(key)
    with _lock:
        _cache[key] = (now, result)
    return result


def _email_is_admin(user_id: str) -> bool:
    from app.db import SessionLocal
    from app.models import Profile

    try:
        uid = uuid.UUID(user_id)
    except (ValueError, TypeError):
        return False
    db = SessionLocal()
    try:
        row = db.get(Profile, uid)
        email = (row.email or "").strip().lower() if row else ""
        return bool(email) and email in config.ADMIN_EMAILS
    except Exception:
        return False
    finally:
        db.close()


def clear_cache() -> None:
    with _lock:
        _cache.clear()
