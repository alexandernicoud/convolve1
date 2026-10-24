"""Match a re-uploaded .keras filename to a Convolve trainer run's model name."""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def normalize_model_filename(name: str | None) -> str:
    """Basename, lowercased — e.g. 'Foo/MyModel.Keras' → 'mymodel.keras'."""
    if not name:
        return ""
    return Path(str(name).strip()).name.lower()


def _name_matches(candidate: str | None, target_norm: str, target_stem: str) -> bool:
    if not candidate:
        return False
    c = normalize_model_filename(candidate)
    if not c:
        return False
    if c == target_norm:
        return True
    # Allow matching with/without .keras
    return Path(c).stem.lower() == target_stem


def _read_json(path: str) -> Dict[str, Any]:
    try:
        import json

        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def _find_model_file(run_dir: str) -> Optional[str]:
    try:
        for fn in sorted(os.listdir(run_dir)):
            if fn.endswith((".keras", ".h5")) and os.path.isfile(os.path.join(run_dir, fn)):
                return fn
    except OSError:
        pass
    return None


_COPIED_META_KEYS = (
    "dataset_id",
    "generator_run_id",
    "generator_config",
    "training_config",
    "symbols",
    "useCandles",
    "timeframe",
    "timespanUnit",
    "timespanCount",
    "chartsPerLabel",
    "horizonBars",
    "takeProfitFraction",
    "stopLossFraction",
    "imageDimension",
    "training_period_start",
    "training_period_end",
)


def find_trainer_match_by_manifest(model_path: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Lineage from the manifest the trainer embeds in the .keras archive.

    ``verified``: the named run belongs to the uploader and the uploaded file is byte-identical to
    the model that run produced (sha256 recorded at training time). ``claimed``: the manifest is
    present but cannot be confirmed; it is kept for display and never treated as lineage.
    Returns None when the file carries no manifest.
    """
    from app.config import AUTH_REQUIRED
    from app.ownership import owned_run_ids
    from app.paths import iter_run_dirs, is_user_uuid
    from runners import model_manifest as mm

    if not model_path or not os.path.isfile(model_path):
        return None
    manifest = mm.read_embedded(Path(model_path))
    if manifest is None:
        return None
    claimed = {
        "manifest_verification": "claimed",
        "embedded_manifest": {
            k: manifest.get(k)
            for k in ("run_id", "model_name", "trainer_protocol", "architecture", "input", "output", "dataset", "created_at")
        },
    }
    run_id = str(manifest.get("run_id") or "")
    if not run_id:
        return claimed
    owned: Optional[set] = None
    if AUTH_REQUIRED and user_id and is_user_uuid(user_id):
        owned = owned_run_ids(user_id)
    for name, run_dir_p, owner in iter_run_dirs():
        if name != run_id:
            continue
        if owned is not None and name not in owned and owner != user_id:
            return claimed
        sidecar = mm.read_sidecar(run_dir_p) or {}
        if not sidecar.get("model_file_sha256") or sidecar["model_file_sha256"] != mm.file_sha256(Path(model_path)):
            return claimed
        meta = _read_json(os.path.join(str(run_dir_p), "model_metadata.json"))
        out: Dict[str, Any] = {
            "schema_version": 1,
            "source": "uploaded_matched_trained",
            "matched_by_manifest": True,
            "manifest_verification": "verified",
            "matched_at": time.time(),
            "training_run_id": run_id,
            "model_name": meta.get("model_name") or manifest.get("model_name"),
            "embedded_manifest": claimed["embedded_manifest"],
        }
        for key in _COPIED_META_KEYS:
            if meta.get(key) is not None:
                out[key] = meta[key]
        return out
    return claimed


def find_trainer_match_by_filename(
    original_filename: str,
    runs_dir: str,
    user_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Find the most recently trained Convolve model whose saved name matches
    ``original_filename`` (the name the user downloaded / re-uploaded).

    When ``user_id`` is a UUID and AUTH_REQUIRED, only that user's trainer
    runs are considered. Returns a flat metadata dict suitable for an upload
    sidecar, or None.
    """
    from app.config import AUTH_REQUIRED
    from app.ownership import owned_run_ids
    from app.paths import iter_run_dirs, is_user_uuid

    target = normalize_model_filename(original_filename)
    if not target:
        return None
    target_stem = Path(target).stem.lower()

    matches: List[Tuple[float, str, Dict[str, Any], str]] = []

    owned: Optional[set] = None
    if AUTH_REQUIRED and user_id and is_user_uuid(user_id):
        owned = owned_run_ids(user_id)

    for name, run_dir_p, owner in iter_run_dirs():
        if owned is not None and name not in owned and owner != user_id:
            continue
        run_dir = str(run_dir_p)

        model_file = _find_model_file(run_dir)
        meta = _read_json(os.path.join(run_dir, "model_metadata.json"))
        summary = _read_json(os.path.join(run_dir, "summary.json"))
        manifest = _read_json(os.path.join(run_dir, "run_manifest.json"))

        # Skip dirs that are clearly not trainer runs unless they have a model + meta/summary
        if not model_file:
            continue
        if not (meta or summary or manifest.get("tool") == "trainer"):
            continue

        tconf = summary.get("config") if isinstance(summary.get("config"), dict) else {}
        candidates = [
            meta.get("model_name"),
            model_file,
            summary.get("model_name"),
            (tconf or {}).get("model_name"),
        ]
        if not any(_name_matches(c, target, target_stem) for c in candidates):
            continue

        try:
            created = os.path.getmtime(os.path.join(run_dir, model_file))
        except OSError:
            created = float(manifest.get("created_at") or meta.get("created_at") or 0)

        matches.append((created, name, meta, model_file))

    if not matches:
        return None

    matches.sort(key=lambda row: row[0], reverse=True)
    _created, run_id, meta, model_file = matches[0]

    # Build upload sidecar payload with training provenance (honest copy only).
    out: Dict[str, Any] = {
        "schema_version": 1,
        "source": "uploaded_matched_trained",
        "matched_by_filename": True,
        "matched_at": time.time(),
        "training_run_id": run_id,
        "model_name": meta.get("model_name") or model_file,
    }
    # Copy known training / generator fields when present
    for key in (
        "dataset_id",
        "generator_run_id",
        "generator_config",
        "training_config",
        "symbols",
        "useCandles",
        "timeframe",
        "timespanUnit",
        "timespanCount",
        "chartsPerLabel",
        "horizonBars",
        "takeProfitFraction",
        "stopLossFraction",
        "imageDimension",
        "training_period_start",
        "training_period_end",
    ):
        if meta.get(key) is not None:
            out[key] = meta[key]

    logger.info(
        "Matched upload filename %r to trainer run %s (model %s)",
        original_filename,
        run_id,
        out.get("model_name"),
    )
    return out
