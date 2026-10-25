import json
import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Request, UploadFile

from app.auth import get_current_user_id
from app.config import MODEL_STORAGE_ROOT
from app.ownership import record_user_model
from app.paths import find_keras_sidecar, local_keras_path, runs_root
from app.schemas.model_upload import ModelUploadResponse
from app.services import direct_uploads
from app.services.model_name_match import find_trainer_match_by_filename, find_trainer_match_by_manifest
from app.storage import get_keras_model_storage

logger = logging.getLogger(__name__)

router = APIRouter(tags=["models"])


def _merge_upload_sidecar(
    model_id: str, original_filename: str, match: dict, user_id: str | None = None
) -> None:
    """Enrich (or create) the upload metadata sidecar with matched trainer provenance."""
    root = Path(MODEL_STORAGE_ROOT)
    existing_path = find_keras_sidecar(root, model_id, user_id)
    dest = existing_path if existing_path is not None else local_keras_path(root, model_id, user_id).with_name(
        f"{model_id}.metadata.json"
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    existing: dict = {}
    if dest.is_file():
        try:
            with open(dest, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                existing = data
        except (OSError, json.JSONDecodeError):
            existing = {}

    merged = {
        **existing,
        **match,
        "model_id": model_id,
        "original_filename": original_filename or existing.get("original_filename"),
        "source": "uploaded_matched_trained" if match.get("training_run_id") else existing.get("source", "uploaded"),
    }
    try:
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(merged, f, indent=2)
    except OSError as exc:
        logger.warning("Could not write matched metadata sidecar for %s: %s", model_id, exc)


@router.post("/models/upload", response_model=ModelUploadResponse)
async def upload_keras_model(
    request: Request, file: UploadFile = File(...)
) -> ModelUploadResponse:
    uid = get_current_user_id(request)
    storage = get_keras_model_storage()
    artifact = await storage.save_keras_upload(file, user_id=uid)
    return _finish_model_upload(artifact, uid)


@router.post("/api/uploads/{upload_id}/model", response_model=ModelUploadResponse)
def finalize_model_upload(upload_id: str, request: Request) -> ModelUploadResponse:
    """Adopt a finished direct upload as the caller's model (same result as /models/upload)."""
    uid = get_current_user_id(request)
    with direct_uploads.adopt_upload(uid, upload_id, "model") as (staged, local):
        artifact = get_keras_model_storage().save_keras_file(local, staged.filename, user_id=uid)
        by_manifest = _manifest_match(str(local), artifact.model_id, uid)
    return _finish_model_upload(artifact, uid, by_manifest=by_manifest)


def _manifest_match(path: str, model_id: str, uid):
    try:
        return find_trainer_match_by_manifest(path, user_id=uid)
    except Exception as exc:  # noqa: BLE001 - lineage is optional; the upload itself succeeded
        logger.warning("Embedded manifest check failed for %s: %s", model_id, exc)
        return None


_UNSET = object()


def _finish_model_upload(artifact, uid, by_manifest=_UNSET) -> ModelUploadResponse:
    record_user_model(
        artifact.model_id,
        uid,
        source="uploaded",
        storage_key=artifact.storage_key,
        path=artifact.absolute_path,
        extra={"original_filename": artifact.original_filename},
    )

    if by_manifest is _UNSET:
        by_manifest = _manifest_match(str(artifact.absolute_path or ""), artifact.model_id, uid)
    if by_manifest and by_manifest.get("manifest_verification") == "verified":
        match = by_manifest
    else:
        match = find_trainer_match_by_filename(
            artifact.original_filename, str(runs_root()), user_id=uid
        )
        if by_manifest:
            match = {**(match or {}), **by_manifest}
    if match:
        _merge_upload_sidecar(artifact.model_id, artifact.original_filename, match, user_id=uid)
        record_user_model(
            artifact.model_id,
            uid,
            extra={
                **match,
                "original_filename": artifact.original_filename,
                "source": "uploaded_matched_trained" if match.get("training_run_id") else "uploaded",
            },
        )

    return ModelUploadResponse.from_stored(artifact, match=match)
