"""Contact form: validate, filter spam, store, optionally notify by email.

Every accepted message is stored, so delivery never depends on an email provider; the
administrator reads them at ``GET /api/admin/contact``. Spam protection: a hidden honeypot
field, a minimum time between rendering and submitting the form, link and length limits,
and per-IP / per-address / global hourly limits. The IP address is kept only as a keyed hash.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException, Request

from app import config
from app.db import SessionLocal
from app.models import ContactMessage

logger = logging.getLogger(__name__)

MIN_FILL_MS = 2500
MAX_LINKS = 3
GLOBAL_MAX_PER_HOUR = 100
NAME_MAX, EMAIL_MAX, MESSAGE_MIN, MESSAGE_MAX = 200, 320, 10, 5000
TOPICS = ("team", "investing", "idea", "question", "criticism", "other")
_EMAIL = re.compile(r"^[^@\s<>\"']+@[^@\s<>\"']+\.[A-Za-z]{2,}$")
_LINK = re.compile(r"https?://|www\.", re.IGNORECASE)


def client_ip(request: Request) -> str:
    """The address added by the last proxy (Cloud Run's front end appends the real client)."""
    forwarded = [p.strip() for p in (request.headers.get("x-forwarded-for") or "").split(",") if p.strip()]
    if forwarded:
        return forwarded[-1]
    return request.client.host if request.client else ""


def _ip_hash(ip: str) -> Optional[str]:
    if not ip:
        return None
    key = (os.getenv("CONTACT_IP_SALT") or config.SUPABASE_JWT_SECRET or "convolve-contact").encode()
    return hmac.new(key, ip.encode(), hashlib.sha256).hexdigest()


def _bad(field: str, message: str) -> HTTPException:
    return HTTPException(status_code=422, detail={"code": "invalid_contact", "field": field, "message": message})


def submit(*, name: str, email: str, message: str, topic: Optional[str], website: str, elapsed_ms: int,
           ip: str, user_id: Optional[str]) -> Dict[str, Any]:
    """Returns ``{"ok": True, "id": ...}``; ``id`` is None when a bot was silently discarded."""
    if website.strip():
        logger.info("Contact honeypot triggered")
        return {"ok": True, "id": None}
    if elapsed_ms < MIN_FILL_MS:
        raise HTTPException(status_code=429, detail={"code": "too_fast",
                                                     "message": "That was quick. Please wait a moment and send again."})
    name, email, message = name.strip(), email.strip(), message.strip()
    if not name or len(name) > NAME_MAX:
        raise _bad("name", "Enter your name.")
    if len(email) > EMAIL_MAX or not _EMAIL.match(email):
        raise _bad("email", "Enter a valid email address.")
    if len(message) < MESSAGE_MIN:
        raise _bad("message", "Write a little more so I can help.")
    if len(message) > MESSAGE_MAX:
        raise _bad("message", f"Keep the message under {MESSAGE_MAX} characters.")
    if len(_LINK.findall(message)) > MAX_LINKS:
        raise _bad("message", f"Please include at most {MAX_LINKS} links.")
    topic = topic if topic in TOPICS else None

    ip_hash = _ip_hash(ip)
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    db = SessionLocal()
    try:
        recent = db.query(ContactMessage).filter(ContactMessage.created_at >= since)
        if (ip_hash and recent.filter(ContactMessage.ip_hash == ip_hash).count() >= config.CONTACT_MAX_PER_HOUR) \
                or recent.filter(ContactMessage.email == email.lower()).count() >= config.CONTACT_MAX_PER_HOUR \
                or recent.count() >= GLOBAL_MAX_PER_HOUR:
            raise HTTPException(status_code=429, detail={
                "code": "rate_limited", "message": "Too many messages. Please try again in an hour."})
        row = ContactMessage(name=name, email=email.lower(), topic=topic, message=message, ip_hash=ip_hash,
                             user_id=uuid.UUID(user_id) if user_id else None)
        db.add(row)
        db.commit()
        return {"ok": True, "id": str(row.id)}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def notify(message_id: Optional[str]) -> None:
    """Email the administrator about a stored message, if a provider is configured."""
    if not message_id or not (config.RESEND_API_KEY and config.CONTACT_NOTIFY_EMAIL and config.CONTACT_FROM_EMAIL):
        return
    import httpx

    db = SessionLocal()
    try:
        row = db.get(ContactMessage, uuid.UUID(message_id))
        if row is None or row.notified_at is not None:
            return
        text = f"From: {row.name} <{row.email}>\nTopic: {row.topic or '-'}\n\n{row.message}"
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {config.RESEND_API_KEY}"},
            json={"from": config.CONTACT_FROM_EMAIL, "to": [config.CONTACT_NOTIFY_EMAIL], "reply_to": row.email,
                  "subject": f"Convolve contact: {row.name}"[:120], "text": text},
            timeout=15,
        )
        if resp.status_code < 300:
            row.notified_at = datetime.now(timezone.utc)
            db.commit()
        else:
            logger.warning("Contact notification failed with status %s; the message is stored", resp.status_code)
    except Exception:
        db.rollback()
        logger.exception("Contact notification failed; the message is stored")
    finally:
        db.close()


def admin_list(limit: int = 200, offset: int = 0) -> Dict[str, Any]:
    db = SessionLocal()
    try:
        q = db.query(ContactMessage)
        rows = q.order_by(ContactMessage.created_at.desc()).offset(offset).limit(limit).all()
        return {
            "total": q.count(),
            "messages": [
                {"id": str(r.id), "name": r.name, "email": r.email, "topic": r.topic, "message": r.message,
                 "user_id": str(r.user_id) if r.user_id else None, "notified": r.notified_at is not None,
                 "created_at": r.created_at.isoformat() if r.created_at else None}
                for r in rows
            ],
        }
    finally:
        db.close()
