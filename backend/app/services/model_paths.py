"""Canonical filesystem resolution for Keras models (uploads, bots, backtests).

All server-side consumers should use these helpers instead of hardcoding backend/models/...
or touching BOT_DATA_DIR / MODEL_STORAGE_ROOT directly.

Local mode (APP_PROFILE unset or "local"): behaviour is unchanged from the
historical resolver — input strings are matched against on-disk locations
(absolute, repo-relative, MODEL_STORAGE_ROOT, BOT_DATA_DIR/models/).

Cloud mode (APP_PROFILE == "cloud"): inputs may also be "gcs://{bucket}/{key}"
URIs. These are downloaded on demand into MODEL_CACHE_DIR (default /tmp/convolve_models)
and the local cache path is returned. Subsequent requests on the same instance
reuse the cache. Callers (bot inference, FastAPI routes) keep receiving a normal
local file path and need no changes.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from app.config import APP_PROFILE, BOT_DATA_DIR, MODEL_CACHE_DIR, MODEL_STORAGE_ROOT

logger = logging.getLogger(__name__)


def _workspace_root() -> Path:
    # backend/app/services/model_paths.py -> repo root
    return Path(__file__).resolve().parents[3]


# ---------------------------------------------------------------------------
# Cloud-mode helpers (no-ops in local mode)
# ---------------------------------------------------------------------------


def _looks_like_gcs_uri(value: str) -> bool:
    return bool(value) and value.startswith("gcs://")


def _materialise_gcs_uri(uri: str) -> str:
    """
    Download gcs://{bucket}/{key} into MODEL_CACHE_DIR and return the cached path.
    Reuses an existing non-empty cache file. Cloud-mode only; raises if invoked
    outside cloud mode or with a malformed URI (callers should pre-check).
    """
    if APP_PROFILE != "cloud":
        raise RuntimeError("GCS resolution requested but APP_PROFILE != 'cloud'")

    from app.storage.gcs import parse_gcs_uri  # lazy: avoid GCS import in local mode

    parsed = parse_gcs_uri(uri)
    if not parsed:
        raise FileNotFoundError(f"Malformed GCS URI: {uri!r}")
    bucket_name, key = parsed

    cache_dir = Path(MODEL_CACHE_DIR)
    cache_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(key).name  # e.g. keras/<bot_id>.keras -> <bot_id>.keras
    if not safe_name:
        raise FileNotFoundError(f"Could not derive cache filename from {uri!r}")
    local_path = cache_dir / safe_name

    if local_path.is_file() and local_path.stat().st_size > 0:
        return str(local_path.resolve())

    from google.cloud import storage  # lazy import

    client = storage.Client()
    blob = client.bucket(bucket_name).blob(key)
    tmp = local_path.with_suffix(local_path.suffix + ".part")
    logger.info("Downloading model from gs://%s/%s -> %s", bucket_name, key, local_path)
    blob.download_to_filename(str(tmp))
    tmp.replace(local_path)
    return str(local_path.resolve())


def _resolve_cloud_reference(model_path: str) -> Optional[str]:
    """If cloud mode and `model_path` is a gcs:// URI, return the materialised local path; else None."""
    if APP_PROFILE != "cloud":
        return None
    if not _looks_like_gcs_uri(model_path):
        return None
    return _materialise_gcs_uri(model_path)


# ---------------------------------------------------------------------------
# Local resolution (unchanged behaviour)
# ---------------------------------------------------------------------------


def resolve_model_path_for_runner(model_path: str) -> str:
    """
    Map a client or config string to a filesystem path string.

    Tries in order:
    - Absolute path that exists on disk
    - Repo-relative path (e.g. backend/models/x.keras) from workspace root
    - Same filename under MODEL_STORAGE_ROOT (anonymous uploads)
    - Same filename under BOT_DATA_DIR/models/ (bot-owned copies)

    If nothing matches, returns the input unchanged (callers must validate existence).
    """
    raw = (model_path or "").strip()
    if not raw:
        return raw

    p = Path(raw)
    if p.is_absolute() and p.exists():
        return str(p.resolve())

    workspace = _workspace_root()
    legacy = workspace / raw
    if legacy.exists():
        return str(legacy.resolve())

    name = Path(raw).name
    if name.endswith(".keras"):
        candidate = MODEL_STORAGE_ROOT / name
        if candidate.exists():
            return str(candidate.resolve())

        bot_models = Path(BOT_DATA_DIR) / "models" / name
        if bot_models.exists():
            return str(bot_models.resolve())

    return raw


def resolve_for_bot_inference(model_path: str) -> str:
    """Prefer stored absolute path if still valid; otherwise apply the same resolution as uploads."""
    if not model_path:
        return model_path
    p = Path(model_path)
    if p.is_file():
        return str(p.resolve())
    return resolve_model_path_for_runner(model_path)


def require_existing_model_file(model_path: str) -> str:
    """
    Resolve then require a readable file. Raises FileNotFoundError with a clear message.
    Use from FastAPI routes: map to HTTP 404.

    Cloud mode: gcs:// URIs are downloaded into MODEL_CACHE_DIR and the cached
    local path is returned (same contract for callers).
    """
    cloud = _resolve_cloud_reference(model_path)
    if cloud is not None:
        return cloud

    resolved = resolve_model_path_for_runner(model_path)
    p = Path(resolved)
    if not p.is_file():
        raise FileNotFoundError(
            f"Model file not found (input={model_path!r}, resolved={resolved!r})"
        )
    return str(p.resolve())


def require_bot_model_file(stored_model_path: str) -> str:
    """
    For Bot.model_path: prefer resolve_for_bot_inference (absolute-first), then require file exists.
    Used by the bot inference pipeline (not the generic backtest upload resolver).

    Cloud mode: a gcs:// URI stored in Bot.model_path is materialised into
    MODEL_CACHE_DIR and the cached local path is returned. Bot inference keeps
    receiving a normal local path.
    """
    cloud = _resolve_cloud_reference(stored_model_path)
    if cloud is not None:
        return cloud

    resolved = resolve_for_bot_inference(stored_model_path)
    p = Path(resolved)
    if not p.is_file():
        raise FileNotFoundError(
            f"Model file not found (stored={stored_model_path!r}, resolved={resolved!r})"
        )
    return str(p.resolve())
