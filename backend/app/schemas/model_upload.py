from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import BaseModel, ConfigDict, Field

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
    # True when original_filename matched a trained Convolve model name.
    metadata_matched: bool = False
    matched_training_run_id: Optional[str] = None
    matched_model_name: Optional[str] = None
    matched_metadata: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Training fields copied from the matched trainer run, when any.",
    )

    @classmethod
    def from_stored(
        cls,
        s: StoredKerasModel,
        *,
        match: Optional[Dict[str, Any]] = None,
    ) -> "ModelUploadResponse":
        matched = bool(match and match.get("training_run_id"))
        return cls(
            model_id=s.model_id,
            storage_key=s.storage_key,
            absolute_path=s.absolute_path,
            original_filename=s.original_filename,
            byte_size=s.byte_size,
            content_type=s.content_type,
            saved_at=s.saved_at,
            metadata_matched=matched,
            matched_training_run_id=str(match["training_run_id"]) if matched else None,
            matched_model_name=(
                str(match.get("model_name")) if matched and match.get("model_name") else None
            ),
            matched_metadata=match if matched else None,
        )
