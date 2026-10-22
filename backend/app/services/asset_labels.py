"""Durable per-user asset labels (rename, tags, favorite, archive, notes) in ``asset_labels``."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, Optional

from app.db import SessionLocal
from app.models import AssetLabel

logger = logging.getLogger(__name__)

LABEL_KINDS = ("model", "dataset", "run")


def _uuid_or_none(user_id: Optional[str]) -> Optional[uuid.UUID]:
    if not user_id:
        return None
    try:
        return uuid.UUID(str(user_id))
    except (ValueError, TypeError):
        return None


def supports_db_labels(user_id: Optional[str]) -> bool:
    return _uuid_or_none(user_id) is not None


def _row_entry(row: AssetLabel) -> Dict[str, Any]:
    tags = []
    if row.tags_json:
        try:
            parsed = json.loads(row.tags_json)
            tags = [str(t) for t in parsed] if isinstance(parsed, list) else []
        except (TypeError, ValueError):
            tags = []
    entry: Dict[str, Any] = {
        "display_name": row.display_name,
        "tags": tags,
        "favorite": bool(row.favorite),
        "archived": bool(row.archived),
        "notes": row.notes,
    }
    return {k: v for k, v in entry.items() if v not in (None, [], "", False)}


def load_user_labels(user_id: Optional[str]) -> Dict[str, Dict[str, Any]]:
    """``{"<user_id>:<kind>:<asset_id>": entry}`` for one user. Empty when the DB is unavailable."""
    uid = _uuid_or_none(user_id)
    if uid is None:
        return {}
    db = SessionLocal()
    try:
        rows = db.query(AssetLabel).filter(AssetLabel.user_id == uid).all()
        return {f"{user_id}:{r.kind}:{r.asset_id}": _row_entry(r) for r in rows}
    except Exception:  # noqa: BLE001 — labels are an overlay; listings must still load
        logger.exception("Could not load asset labels for %s", user_id)
        return {}
    finally:
        db.close()


def save_user_label(user_id: str, kind: str, asset_id: str, entry: Dict[str, Any]) -> None:
    """Upsert one label row; an empty entry deletes it."""
    uid = _uuid_or_none(user_id)
    if uid is None:
        raise ValueError("asset labels require a UUID user id")
    if kind not in LABEL_KINDS:
        raise ValueError(f"kind must be one of {LABEL_KINDS}")
    db = SessionLocal()
    try:
        row = (
            db.query(AssetLabel)
            .filter(AssetLabel.user_id == uid, AssetLabel.kind == kind, AssetLabel.asset_id == asset_id)
            .first()
        )
        if not entry:
            if row is not None:
                db.delete(row)
                db.commit()
            return
        if row is None:
            row = AssetLabel(user_id=uid, kind=kind, asset_id=asset_id)
        row.display_name = entry.get("display_name")
        row.tags_json = json.dumps(entry.get("tags") or []) if entry.get("tags") else None
        row.favorite = bool(entry.get("favorite"))
        row.archived = bool(entry.get("archived"))
        row.notes = entry.get("notes")
        db.add(row)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
