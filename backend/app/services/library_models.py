"""Resolve a model the user already owns (trained run or uploaded model) to a local file.

Used by Deploy so a bot can be created from the library instead of a re-upload, with the
source recorded explicitly on the bot row.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Optional, Tuple

from fastapi import HTTPException

from app.config import AUTH_REQUIRED
from app.ownership import assert_model_owner, assert_run_owner, lookup_run_owner
from app.paths import find_backtest_dir, run_dir_for, validate_id
from app.services.model_paths import require_existing_model_file

logger = logging.getLogger(__name__)

_MODEL_SUFFIXES = (".keras", ".h5")


def _trained_model_file(run_dir: Path) -> Optional[Path]:
    try:
        for name in sorted(os.listdir(run_dir)):
            p = run_dir / name
            if name.endswith(_MODEL_SUFFIXES) and p.is_file():
                return p
    except OSError:
        return None
    return None


def resolve_library_model(
    owner_id: Optional[str],
    *,
    model_id: Optional[str] = None,
    training_run_id: Optional[str] = None,
) -> Tuple[Path, str]:
    """(local file, display filename) for an owned model. 404 for anything not owned or missing."""
    if bool(model_id) == bool(training_run_id):
        raise HTTPException(status_code=400, detail="Provide exactly one of source_model_id or source_training_run_id")
    if training_run_id:
        rid = validate_id(training_run_id, kind="run")
        if AUTH_REQUIRED:
            assert_run_owner(rid, str(owner_id))
        run_dir = run_dir_for(rid, lookup_run_owner(rid))
        try:
            from app.services.durable_outputs import maybe_restore_run

            maybe_restore_run(rid, run_dir)
        except Exception:  # noqa: BLE001 — restore is best effort; the file check below decides
            logger.exception("Could not restore trainer run %s for deploy", rid)
        path = _trained_model_file(run_dir)
        if path is None:
            raise HTTPException(status_code=404, detail="Model not found")
        return path, path.name
    mid = validate_id(str(model_id), kind="model")
    if AUTH_REQUIRED:
        assert_model_owner(mid, str(owner_id))
    try:
        resolved = require_existing_model_file(f"backend/models/{mid}.keras", user_id=owner_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Model not found") from exc
    return Path(resolved), f"{mid}.keras"


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
