import json
import logging
from pathlib import Path

from fastapi import APIRouter, File, UploadFile

from app.config import MODEL_STORAGE_ROOT
from app.schemas.model_upload import ModelUploadResponse
from app.services.model_name_match import find_trainer_match_by_filename
from app.storage import get_keras_model_storage

logger = logging.getLogger(__name__)

router = APIRouter(tags=["models"])

# Trainer run dirs live next to the app package: backend/runs
_RUNS_DIR = Path(__file__).resolve().parents[2] / "runs"


def _merge_upload_sidecar(model_id: str, original_filename: str, match: dict) -> None:
    """Enrich (or create) the upload metadata sidecar with matched trainer provenance."""
    root = Path(MODEL_STORAGE_ROOT)
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{model_id}.metadata.json"
    existing: dict = {}
    if path.is_file():
        try:
            with open(path, "r", encoding="utf-8") as f:
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
        "source": "uploaded_matched_trained",
    }
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(merged, f, indent=2)
    except OSError as exc:
        logger.warning("Could not write matched metadata sidecar for %s: %s", model_id, exc)


@router.post("/models/upload", response_model=ModelUploadResponse)
async def upload_keras_model(file: UploadFile = File(...)) -> ModelUploadResponse:
    storage = get_keras_model_storage()
    artifact = await storage.save_keras_upload(file)

    match = find_trainer_match_by_filename(artifact.original_filename, str(_RUNS_DIR))
    if match:
        _merge_upload_sidecar(artifact.model_id, artifact.original_filename, match)

    return ModelUploadResponse.from_stored(artifact, match=match)
