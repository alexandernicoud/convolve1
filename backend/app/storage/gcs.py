"""
Google Cloud Storage backend for Keras model uploads.

Active only when APP_PROFILE == "cloud". Stores .keras files under
    keras/{model_id}.keras
inside MODEL_BUCKET, and returns a stable "gcs://{bucket}/{key}" reference
in StoredKerasModel.absolute_path so DB rows persist a portable URI rather
than a container-local filesystem path.

Local mode does not import this module: the factory in app.storage.__init__
only loads it when APP_PROFILE == "cloud".
"""

from __future__ import annotations

import logging
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

from fastapi import HTTPException, UploadFile

from app.config import MAX_KERAS_UPLOAD_BYTES, MODEL_BUCKET
from app.paths import keras_storage_key
from app.storage.types import StoredKerasModel

logger = logging.getLogger(__name__)

GCS_SCHEME = "gcs://"


def build_gcs_uri(bucket: str, key: str) -> str:
    return f"{GCS_SCHEME}{bucket}/{key}"


def is_gcs_uri(uri: str) -> bool:
    return bool(uri) and uri.startswith(GCS_SCHEME)


def _new_model_id() -> str:
    return f"model_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"


def parse_gcs_uri(uri: str) -> Optional[Tuple[str, str]]:
    """Return (bucket, object_key) for gcs://bucket/key, else None."""
    if not is_gcs_uri(uri):
        return None
    rest = uri[len(GCS_SCHEME):]
    bucket, _, key = rest.partition("/")
    if not bucket or not key:
        return None
    return bucket, key


class GcsKerasModelStorage:
    """
    KerasModelStorage implementation backed by a single GCS bucket.

    save_keras_upload  -> anonymous upload (auto-generated model_id)
    save_bot_upload    -> bot-owned upload (model_id == bot_id)

    Both return a StoredKerasModel whose `absolute_path` is the canonical
    gcs:// URI (so DB writers can persist artifact.absolute_path unchanged).
    """

    def __init__(self, bucket: Optional[str] = None) -> None:
        bucket_name = (bucket or MODEL_BUCKET or "").strip()
        if not bucket_name:
            raise RuntimeError(
                "GcsKerasModelStorage requires MODEL_BUCKET; "
                "set MODEL_BUCKET=<bucket-name> in the cloud environment."
            )
        self._bucket_name = bucket_name
        self._bucket = None  # lazy init so import is cheap and works in tests

    def _ensure_bucket(self):
        if self._bucket is None:
            from google.cloud import storage

            client = storage.Client()
            self._bucket = client.bucket(self._bucket_name)
        return self._bucket

    @property
    def bucket_name(self) -> str:
        return self._bucket_name

    async def save_keras_upload(self, upload: UploadFile, user_id: Optional[str] = None) -> StoredKerasModel:
        return await self._upload_with_id(upload, _new_model_id(), user_id=user_id)

    def save_keras_file(
        self,
        src: Path,
        original_filename: str,
        user_id: Optional[str] = None,
        content_type: str = "application/octet-stream",
    ) -> StoredKerasModel:
        return self._store_file(src, _new_model_id(), original_filename, user_id, content_type)

    def save_bot_file(
        self, src: Path, original_filename: str, bot_id: str, user_id: Optional[str] = None
    ) -> StoredKerasModel:
        if not bot_id:
            raise ValueError("bot_id is required")
        return self._store_file(src, bot_id, original_filename, user_id, "application/octet-stream")

    def _store_file(
        self, src: Path, model_id: str, original: str, user_id: Optional[str], ct: str
    ) -> StoredKerasModel:
        total = src.stat().st_size
        if total > MAX_KERAS_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File size exceeds {MAX_KERAS_UPLOAD_BYTES // (1024 * 1024)}MB limit",
            )
        key = keras_storage_key(model_id, user_id)
        self._ensure_bucket().blob(key).upload_from_filename(str(src), content_type=ct)
        return StoredKerasModel(
            model_id=model_id,
            storage_key=key,
            absolute_path=build_gcs_uri(self._bucket_name, key),
            original_filename=original,
            byte_size=total,
            content_type=ct,
            saved_at=datetime.now(timezone.utc),
        )

    async def save_bot_upload(
        self, upload: UploadFile, bot_id: str, user_id: Optional[str] = None
    ) -> StoredKerasModel:
        if not bot_id:
            raise ValueError("bot_id is required")
        return await self._upload_with_id(upload, bot_id, user_id=user_id)

    async def _upload_with_id(
        self, upload: UploadFile, model_id: str, user_id: Optional[str] = None
    ) -> StoredKerasModel:
        if not upload.filename or not upload.filename.lower().endswith(".keras"):
            raise HTTPException(
                status_code=400, detail="Only .keras files are supported"
            )

        original = upload.filename
        ct = upload.content_type or "application/octet-stream"
        key = keras_storage_key(model_id, user_id)

        # Stream upload to a SpooledTemporaryFile so we can both enforce the size
        # cap and hand a seekable file-like object to GCS without holding the whole
        # blob in RAM.
        total = 0
        try:
            with tempfile.SpooledTemporaryFile(
                max_size=64 * 1024 * 1024, suffix=".keras"
            ) as buf:
                while True:
                    chunk = await upload.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_KERAS_UPLOAD_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail=(
                                f"File size exceeds "
                                f"{MAX_KERAS_UPLOAD_BYTES // (1024 * 1024)}MB limit"
                            ),
                        )
                    buf.write(chunk)
                buf.seek(0)
                bucket = self._ensure_bucket()
                blob = bucket.blob(key)
                blob.upload_from_file(buf, content_type=ct, rewind=False)
        finally:
            await upload.close()

        gcs_uri = build_gcs_uri(self._bucket_name, key)
        logger.info(
            "GCS upload complete: gs://%s/%s (%d bytes, model_id=%s)",
            self._bucket_name,
            key,
            total,
            model_id,
        )
        return StoredKerasModel(
            model_id=model_id,
            storage_key=key,
            absolute_path=gcs_uri,
            original_filename=original,
            byte_size=total,
            content_type=ct,
            saved_at=datetime.now(timezone.utc),
        )
