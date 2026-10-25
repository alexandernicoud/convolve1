import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.config import BOT_DATA_DIR, MAX_KERAS_UPLOAD_BYTES, MODEL_STORAGE_ROOT
from app.paths import keras_storage_key, local_keras_path, is_user_uuid, canonical_user_id
from app.storage.types import StoredKerasModel

KERAS_ARCHIVE_MAGIC = b"PK\x03\x04"
NOT_KERAS_DETAIL = "Not a Keras model: a .keras file is a zip archive"


async def _stream_upload_to_path(upload: UploadFile, dest: Path) -> tuple[int, str, str]:
    """Returns (byte_size, original_filename, content_type)."""
    if not upload.filename or not upload.filename.lower().endswith(".keras"):
        raise HTTPException(status_code=400, detail="Only .keras files are supported")

    original = upload.filename
    ct = upload.content_type or "application/octet-stream"
    total = 0
    try:
        with open(dest, "wb") as buffer:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_KERAS_UPLOAD_BYTES:
                    dest.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File size exceeds {MAX_KERAS_UPLOAD_BYTES // (1024 * 1024)}MB limit",
                    )
                buffer.write(chunk)
    finally:
        await upload.close()

    with open(dest, "rb") as fh:
        head = fh.read(len(KERAS_ARCHIVE_MAGIC))
    if head != KERAS_ARCHIVE_MAGIC:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=NOT_KERAS_DETAIL)
    return total, original, ct


def _copy_keras_file(src: Path, dest: Path) -> int:
    size = src.stat().st_size
    if size > MAX_KERAS_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File size exceeds {MAX_KERAS_UPLOAD_BYTES // (1024 * 1024)}MB limit",
        )
    shutil.copyfile(src, dest)
    return size


def _new_model_id() -> str:
    return f"model_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"


class LocalKerasModelStorage:
    """
    Stores .keras files under a configurable root.

    Implements KerasModelStorage; storage_key is a logical path (e.g. keras/model_....keras)
    suitable for mapping to object keys without changing callers.
    """

    def __init__(self, root: Path | None = None) -> None:
        self._root = Path(root or MODEL_STORAGE_ROOT)
        self._root.mkdir(parents=True, exist_ok=True)

    async def save_keras_upload(self, upload: UploadFile, user_id: str | None = None) -> StoredKerasModel:
        model_id = _new_model_id()
        dest = local_keras_path(self._root, model_id, user_id)
        dest.parent.mkdir(parents=True, exist_ok=True)
        total, original, ct = await _stream_upload_to_path(upload, dest)
        return self._record(model_id, dest, user_id, total, original, ct)

    def save_keras_file(
        self,
        src: Path,
        original_filename: str,
        user_id: str | None = None,
        content_type: str = "application/octet-stream",
    ) -> StoredKerasModel:
        model_id = _new_model_id()
        dest = local_keras_path(self._root, model_id, user_id)
        dest.parent.mkdir(parents=True, exist_ok=True)
        total = _copy_keras_file(src, dest)
        return self._record(model_id, dest, user_id, total, original_filename, content_type)

    def _record(
        self, model_id: str, dest: Path, user_id: str | None, total: int, original: str, ct: str
    ) -> StoredKerasModel:
        storage_key = keras_storage_key(model_id, user_id)
        now = datetime.now(timezone.utc)

        # Honest sidecar metadata: anonymous uploads carry no training provenance,
        # so only upload facts are recorded (consumers must treat training info as unavailable).
        sidecar = dest.with_name(f"{model_id}.metadata.json")
        try:
            with open(sidecar, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "schema_version": 1,
                        "source": "uploaded",
                        "model_id": model_id,
                        "storage_key": storage_key,
                        "original_filename": original,
                        "byte_size": total,
                        "uploaded_at": now.isoformat(),
                    },
                    f,
                    indent=2,
                )
        except OSError:
            pass

        return StoredKerasModel(
            model_id=model_id,
            storage_key=storage_key,
            absolute_path=str(dest.resolve()),
            original_filename=original,
            byte_size=total,
            content_type=ct,
            saved_at=now,
        )


def _bot_model_dest(bot_id: str, user_id: str | None) -> tuple[Path, str]:
    dest_dir = Path(BOT_DATA_DIR) / "models"
    if is_user_uuid(user_id):
        dest_dir = dest_dir / canonical_user_id(user_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{bot_id}.keras"
    storage_key = (
        f"models/{canonical_user_id(user_id)}/{safe_name}"
        if is_user_uuid(user_id)
        else f"models/{safe_name}"
    )
    return dest_dir / safe_name, storage_key


def _bot_model(bot_id: str, dest: Path, storage_key: str, total: int, original: str, ct: str) -> StoredKerasModel:
    return StoredKerasModel(
        model_id=bot_id,
        storage_key=storage_key,
        absolute_path=str(dest.resolve()),
        original_filename=original,
        byte_size=total,
        content_type=ct,
        saved_at=datetime.now(timezone.utc),
    )


async def save_bot_keras_upload(
    upload: UploadFile, bot_id: str, user_id: str | None = None
) -> StoredKerasModel:
    """Store a bot-owned copy under BOT_DATA_DIR/models/[user_id/]{bot_id}.keras."""
    dest, storage_key = _bot_model_dest(bot_id, user_id)
    total, original, ct = await _stream_upload_to_path(upload, dest)
    return _bot_model(bot_id, dest, storage_key, total, original, ct)


def save_bot_keras_file(
    src: Path, original_filename: str, bot_id: str, user_id: str | None = None
) -> StoredKerasModel:
    dest, storage_key = _bot_model_dest(bot_id, user_id)
    total = _copy_keras_file(src, dest)
    return _bot_model(bot_id, dest, storage_key, total, original_filename, "application/octet-stream")
