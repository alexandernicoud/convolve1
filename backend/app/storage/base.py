from typing import Protocol

from fastapi import UploadFile

from app.storage.types import StoredKerasModel


class KerasModelStorage(Protocol):
    """Pluggable persistence for uploaded Keras models (local FS now, GCS/S3 later)."""

    async def save_keras_upload(self, upload: UploadFile) -> StoredKerasModel: ...
