"""
Abstract Keras upload storage for swapping local disk vs object storage later.

Implementations must return StoredKerasModel with a stable storage_key (e.g. object key).
Routes and services should depend on get_keras_model_storage() / this protocol, not LocalKerasModelStorage.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from fastapi import UploadFile

from app.storage.types import StoredKerasModel


@runtime_checkable
class KerasModelStorage(Protocol):
    async def save_keras_upload(self, upload: UploadFile) -> StoredKerasModel:
        """Persist an uploaded .keras file and return metadata including storage_key."""
