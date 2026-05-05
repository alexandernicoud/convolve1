"""
Pluggable Keras model storage backends.

Local mode (default; APP_PROFILE unset or "local") preserves the historical
behaviour: uploads are written to MODEL_STORAGE_ROOT and bot-owned copies to
BOT_DATA_DIR/models/{bot_id}.keras. DB rows persist absolute filesystem paths.

Cloud mode (APP_PROFILE="cloud") routes both anonymous and bot-owned uploads
through GCS (MODEL_BUCKET). DB rows persist a "gcs://{bucket}/{key}" reference;
download-on-demand happens in app.services.model_paths.
"""

from fastapi import UploadFile

from app.config import APP_PROFILE, MODEL_BUCKET, MODEL_STORAGE_ROOT
from app.storage.local import LocalKerasModelStorage
from app.storage.local import save_bot_keras_upload as _local_save_bot_keras_upload
from app.storage.protocol import KerasModelStorage
from app.storage.types import StoredKerasModel

_default_storage: KerasModelStorage | None = None


def _build_storage() -> KerasModelStorage:
    if APP_PROFILE == "cloud":
        # Imported lazily so local installs don't need google-cloud-storage on the
        # path until they actually opt into cloud mode.
        from app.storage.gcs import GcsKerasModelStorage

        return GcsKerasModelStorage(MODEL_BUCKET)
    return LocalKerasModelStorage(MODEL_STORAGE_ROOT)


def get_keras_model_storage() -> KerasModelStorage:
    """Return the storage backend for anonymous uploads (POST /models/upload).

    Cached per-process. APP_PROFILE is read once at startup.
    """
    global _default_storage
    if _default_storage is None:
        _default_storage = _build_storage()
    return _default_storage


async def save_bot_keras_upload(
    upload: UploadFile, bot_id: str
) -> StoredKerasModel:
    """
    Bot-owned upload entry point used by POST /api/bots.

    Local mode: identical to the legacy app.storage.local.save_bot_keras_upload —
    writes to BOT_DATA_DIR/models/{bot_id}.keras and returns the absolute path.

    Cloud mode: uploads to gs://{MODEL_BUCKET}/keras/{bot_id}.keras and returns
    a StoredKerasModel whose absolute_path is the canonical "gcs://..." URI.
    """
    if APP_PROFILE == "cloud":
        storage = get_keras_model_storage()
        # Concrete cloud storage exposes save_bot_upload for bot_id-keyed uploads.
        save_bot_upload = getattr(storage, "save_bot_upload", None)
        if save_bot_upload is None:
            raise RuntimeError(
                "Active cloud storage backend does not implement save_bot_upload"
            )
        return await save_bot_upload(upload, bot_id)
    return await _local_save_bot_keras_upload(upload, bot_id)
