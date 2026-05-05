from fastapi import APIRouter, File, UploadFile

from app.schemas.model_upload import ModelUploadResponse
from app.storage import get_keras_model_storage

router = APIRouter(tags=["models"])


@router.post("/models/upload", response_model=ModelUploadResponse)
async def upload_keras_model(file: UploadFile = File(...)) -> ModelUploadResponse:
    storage = get_keras_model_storage()
    artifact = await storage.save_keras_upload(file)
    return ModelUploadResponse.from_stored(artifact)
