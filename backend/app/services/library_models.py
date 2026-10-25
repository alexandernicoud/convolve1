"""Resolve a model the user already owns (trained run or uploaded model) to a local file.

The Library id is the model identity everywhere: an uploaded model's `user_models.id`, or a
trainer run id. The bytes are found through the stored reference on that row (a gcs:// or
durable:// object, or a local file in development), never through a path from the client.
Cloud objects are copied into MODEL_CACHE_DIR so any API instance or job can load them.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from urllib.parse import unquote, urlparse

from fastapi import HTTPException

from app.config import AUTH_REQUIRED, MODEL_CACHE_DIR, MODEL_STORAGE_ROOT
from app.db import SessionLocal
from app.models import PipelineRun, UserModel
from app.ownership import _load_extra, assert_model_owner, assert_run_owner, lookup_run_owner
from app.paths import (
    canonical_user_id,
    find_backtest_dir,
    find_keras_sidecar,
    find_local_keras_file,
    local_keras_path,
    run_dir_for,
    validate_id,
)
from app.services.model_paths import require_existing_model_file

logger = logging.getLogger(__name__)

_MODEL_SUFFIXES = (".keras", ".h5")
MISSING_DETAIL = "Model file is missing from storage"
# Upload provenance copied from a matched trainer run; anything else is not training metadata.
_PROVENANCE_KEYS = ("training_run_id", "generator_run_id", "dataset_id")


def _trained_model_file(run_dir: Path) -> Optional[Path]:
    try:
        for name in sorted(os.listdir(run_dir)):
            p = run_dir / name
            if name.endswith(_MODEL_SUFFIXES) and p.is_file():
                return p
    except OSError:
        return None
    return None


def _model_row(model_id: str) -> Optional[Dict[str, Any]]:
    db = SessionLocal()
    try:
        row = db.get(UserModel, model_id)
        if row is None:
            return None
        return {
            "id": row.id,
            "user_id": str(row.user_id),
            "source": row.source,
            "storage_key": row.storage_key,
            "path": row.path,
            "extra": _load_extra(row.extra_json),
        }
    finally:
        db.close()


def _is_trainer_run(run_id: str) -> bool:
    db = SessionLocal()
    try:
        row = db.get(PipelineRun, run_id)
        return row is not None and row.tool == "trainer"
    finally:
        db.close()


def _object_key(ref: str) -> Optional[str]:
    if ref.startswith("gcs://"):
        from app.storage.gcs import parse_gcs_uri

        parsed = parse_gcs_uri(ref)
        return parsed[1] if parsed else None
    if ref.startswith("durable://"):
        return ref[len("durable://") :]
    return None


def _key_belongs_to(key: str, owner_id: str) -> bool:
    parts = key.split("/")
    return len(parts) >= 3 and parts[0] in ("keras", "users") and parts[1] == canonical_user_id(owner_id)


def _cached_copy(uri: str, suffix: str) -> Optional[Path]:
    """Copy a stored object into the shared model cache. None when the object does not exist."""
    from app.services.durable_outputs import get_artifact_store

    cache = Path(MODEL_CACHE_DIR) / "library"
    cache.mkdir(parents=True, exist_ok=True)
    dest = cache / f"{hashlib.sha256(uri.encode()).hexdigest()[:32]}{suffix}"
    if dest.is_file() and dest.stat().st_size > 0:
        return dest
    tmp = cache / f".{dest.name}.{uuid.uuid4().hex[:8]}.part"
    try:
        get_artifact_store().materialize(uri, tmp)
        if not tmp.is_file() or tmp.stat().st_size == 0:
            return None
        os.replace(tmp, dest)
        return dest
    except FileNotFoundError:
        return None
    except Exception as exc:  # noqa: BLE001 - classify storage errors without importing google libs
        if type(exc).__name__ == "NotFound":
            return None
        logger.exception("Model storage read failed for %s", uri)
        raise HTTPException(status_code=503, detail="Model storage is unavailable; try again") from exc
    finally:
        tmp.unlink(missing_ok=True)


def _stored_artifact(row: Dict[str, Any]) -> Optional[Path]:
    ref = str(row.get("path") or "").strip()
    if not ref:
        return None
    if ref.startswith("file:"):
        p = Path(unquote(urlparse(ref).path))
        return p if p.is_file() else None
    key = _object_key(ref)
    if key is not None:
        if not _key_belongs_to(key, row["user_id"]):
            logger.warning("Model %s points outside its owner's storage prefix; refusing", row["id"])
            return None
        return _cached_copy(ref, Path(key).suffix or ".keras")
    p = Path(ref)
    return p if p.is_absolute() and p.is_file() else None


def _trained(owner_id: Optional[str], rid: str) -> Path:
    if AUTH_REQUIRED:
        assert_run_owner(rid, str(owner_id))
    run_dir = run_dir_for(rid, lookup_run_owner(rid))
    try:
        from app.services.durable_outputs import maybe_restore_run

        maybe_restore_run(rid, run_dir)
    except Exception:  # noqa: BLE001 — restore is best effort; the checks below decide
        logger.exception("Could not restore trainer run %s", rid)
    path = _trained_model_file(run_dir)
    if path is not None:
        return path
    row = _model_row(rid)
    stored = _stored_artifact(row) if row else None
    if stored is None:
        raise HTTPException(status_code=404, detail=MISSING_DETAIL)
    return stored


def owned_model_file(
    owner_id: Optional[str],
    *,
    model_id: Optional[str] = None,
    training_run_id: Optional[str] = None,
) -> Path:
    """Local file for an owned Library model. 404 when not owned or when the bytes are gone."""
    if bool(model_id) == bool(training_run_id):
        raise HTTPException(status_code=400, detail="Provide exactly one model id or training run id")
    if training_run_id:
        return _trained(owner_id, validate_id(training_run_id, kind="run"))
    mid = validate_id(str(model_id), kind="model")
    if AUTH_REQUIRED:
        assert_model_owner(mid, str(owner_id))
    row = _model_row(mid)
    if (row is None or row.get("source") == "trainer") and _is_trainer_run(mid):
        return _trained(owner_id, mid)
    if row is not None:
        stored = _stored_artifact(row)
        if stored is not None:
            return stored
    local = find_local_keras_file(Path(MODEL_STORAGE_ROOT), mid, owner_id)
    if local is not None:
        return local
    if not AUTH_REQUIRED:
        try:
            return Path(require_existing_model_file(f"backend/models/{mid}.keras", user_id=owner_id))
        except FileNotFoundError:
            pass
    raise HTTPException(status_code=404, detail=MISSING_DETAIL)


def uploaded_model_sidecar(model_id: str, owner_id: Optional[str]) -> Optional[Path]:
    """Metadata sidecar for an uploaded model, rebuilt from its database row when this disk lacks it.

    None when no training provenance was ever recorded; nothing is inferred.
    """
    root = Path(MODEL_STORAGE_ROOT)
    found = find_keras_sidecar(root, model_id, owner_id)
    if found is not None:
        return found
    try:
        mid = validate_id(model_id, kind="model")
    except HTTPException:
        return None
    row = _model_row(mid)
    if row is None or row.get("source") == "trainer":
        return None
    if AUTH_REQUIRED and owner_id and canonical_user_id(row["user_id"]) != canonical_user_id(owner_id):
        return None
    extra = row.get("extra") or {}
    if not any(extra.get(k) for k in _PROVENANCE_KEYS):
        return None
    dest = local_keras_path(root, mid, row["user_id"]).with_name(f"{mid}.metadata.json")
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(f".{dest.name}.{uuid.uuid4().hex[:8]}")
        tmp.write_text(json.dumps({**extra, "model_id": mid}, indent=2), encoding="utf-8")
        os.replace(tmp, dest)
    except OSError as exc:
        logger.warning("Could not rebuild metadata sidecar for %s: %s", mid, exc)
        return None
    return dest


def resolve_library_model(
    owner_id: Optional[str],
    *,
    model_id: Optional[str] = None,
    training_run_id: Optional[str] = None,
) -> Tuple[Path, str]:
    """(local file, display filename) for an owned model. 404 for anything not owned or missing."""
    path = owned_model_file(owner_id, model_id=model_id, training_run_id=training_run_id)
    if training_run_id:
        return path, path.name
    row = _model_row(str(model_id))
    original = (row or {}).get("extra", {}).get("original_filename") if row else None
    return path, str(original or f"{model_id}.keras")


def backtest_references_model(
    owner_id: Optional[str],
    backtest_run_id: str,
    *,
    model_id: Optional[str] = None,
    training_run_id: Optional[str] = None,
) -> bool:
    """True when the owned backtest's recorded config used this exact model."""
    rid = validate_id(backtest_run_id, kind="run")
    if AUTH_REQUIRED:
        assert_run_owner(rid, str(owner_id))
    bdir = find_backtest_dir(rid, owner_id)
    if bdir is None:
        raise HTTPException(status_code=404, detail="Backtest not found")
    try:
        info = json.loads((bdir / "run_info.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    cfg = info.get("config") if isinstance(info, dict) and isinstance(info.get("config"), dict) else {}
    model_path = str(cfg.get("model_path") or "").replace("\\", "/")
    if training_run_id:
        return cfg.get("trainer_run_id") == training_run_id or f"/{training_run_id}/" in model_path
    return cfg.get("model_id") == model_id or os.path.basename(model_path) == f"{model_id}.keras"
