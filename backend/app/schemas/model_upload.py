from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.storage.types import StoredKerasModel


class ModelUploadResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    model_id: str
    storage_key: str
    absolute_path: str
    original_filename: str
    byte_size: int
    content_type: str
    saved_at: datetime

    @classmethod
    def from_stored(cls, s: StoredKerasModel) -> "ModelUploadResponse":
        return cls(
            model_id=s.model_id,
            storage_key=s.storage_key,
            absolute_path=s.absolute_path,
            original_filename=s.original_filename,
            byte_size=s.byte_size,
            content_type=s.content_type,
            saved_at=s.saved_at,
        )
