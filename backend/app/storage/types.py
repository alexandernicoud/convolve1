from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class StoredKerasModel:
    """Metadata for a persisted .keras file (local path today; maps to object key later)."""

    model_id: str
    storage_key: str
    absolute_path: str
    original_filename: str
    byte_size: int
    content_type: str
    saved_at: datetime
