"""Supabase JWT verification. Canonical user id is JWT ``sub`` only."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, Optional

import jwt
from fastapi import HTTPException, Request
from jwt import PyJWKClient
from sqlalchemy.exc import IntegrityError

from app.config import (
    AUTH_REQUIRED,
    SUPABASE_JWT_AUDIENCE,
    SUPABASE_JWT_SECRET,
    SUPABASE_URL,
)
from app.db import SessionLocal
from app.models import CreditAccount, Profile

logger = logging.getLogger("app.auth")

_jwks_client: Optional[PyJWKClient] = None

PUBLIC_PATHS = frozenset(
    {
        "/",
        "/docs",
        "/redoc",
        "/openapi.json",
        "/favicon.ico",
    }
)
PUBLIC_PREFIXES = ("/docs",)


def _is_public(request: Request) -> bool:
    if request.method == "OPTIONS":
        return True
    path = request.url.path
    if path in PUBLIC_PATHS:
        return True
    return any(path.startswith(p) for p in PUBLIC_PREFIXES)


def _jwks() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        if not SUPABASE_URL:
            raise HTTPException(status_code=503, detail="Auth is not configured")
        _jwks_client = PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json")
    return _jwks_client


def decode_supabase_token(token: str) -> Dict[str, Any]:
    """Verify a Supabase access token (HS256 secret and/or JWKS ES256)."""
    options = {"require": ["sub", "exp"]}
    issuer = f"{SUPABASE_URL}/auth/v1" if SUPABASE_URL else None
    decode_kwargs: Dict[str, Any] = {
        "audience": SUPABASE_JWT_AUDIENCE,
        "options": options,
        "leeway": 10,
    }
    if issuer:
        decode_kwargs["issuer"] = issuer

    last_err: Optional[Exception] = None
    if SUPABASE_JWT_SECRET:
        try:
            return jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                **decode_kwargs,
            )
        except jwt.PyJWTError as exc:
            last_err = exc

    if SUPABASE_URL:
        try:
            signing_key = _jwks().get_signing_key_from_jwt(token)
            return jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "RS256"],
                **decode_kwargs,
            )
        except jwt.PyJWTError as exc:
            last_err = exc
        except Exception as exc:  # JWKS network / parse
            last_err = exc

    if last_err is None and not SUPABASE_JWT_SECRET and not SUPABASE_URL:
        raise HTTPException(status_code=503, detail="Auth is not configured")

    logger.info("JWT rejected: %s", last_err)
    raise HTTPException(status_code=401, detail="Invalid or expired token")


def bearer_token_from_request(request: Request) -> str:
    header = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    if not header:
        raise HTTPException(status_code=401, detail="Not authenticated")
    parts = header.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401, detail="Not authenticated")
    return parts[1].strip()


def parse_user_uuid(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(raw))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid token subject") from exc


def ensure_profile(user_id: uuid.UUID, email: Optional[str] = None, display_name: Optional[str] = None) -> None:
    """Idempotent profile + empty credit account so later charging can attach to a row."""
    db = SessionLocal()
    try:
        existing = db.get(Profile, user_id)
        if existing is None:
            db.add(
                Profile(
                    id=user_id,
                    email=email,
                    display_name=display_name or (email.split("@")[0] if email else None),
                )
            )
            db.add(CreditAccount(user_id=user_id, balance=0, version=1))
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
            return
        changed = False
        if email and existing.email != email:
            existing.email = email
            changed = True
        if display_name and existing.display_name != display_name:
            existing.display_name = display_name
            changed = True
        if changed:
            db.add(existing)
            db.commit()
    except Exception:
        db.rollback()
        logger.exception("ensure_profile failed for %s", user_id)
    finally:
        db.close()


def authenticate_request(request: Request) -> str:
    """Return canonical user UUID string from the Bearer token. Never reads body/query."""
    token = bearer_token_from_request(request)
    claims = decode_supabase_token(token)
    sub = claims.get("sub")
    user_uuid = parse_user_uuid(str(sub) if sub is not None else "")
    email = claims.get("email")
    name = claims.get("user_metadata", {}).get("display_name") if isinstance(claims.get("user_metadata"), dict) else None
    ensure_profile(user_uuid, email=email if isinstance(email, str) else None, display_name=name if isinstance(name, str) else None)
    return str(user_uuid)


def get_current_user_id(request: Request) -> Optional[str]:
    """FastAPI dependency. 401 when AUTH_REQUIRED and the token is missing/invalid."""
    if not AUTH_REQUIRED:
        return None
    cached = getattr(request.state, "user_id", None)
    if cached:
        return str(cached)
    user_id = authenticate_request(request)
    request.state.user_id = user_id
    return user_id


def require_user_id(request: Request) -> str:
    user_id = get_current_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user_id
