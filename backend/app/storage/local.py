import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.config import BOT_DATA_DIR, MAX_KERAS_UPLOAD_BYTES, MODEL_STORAGE_ROOT
from app.storage.types import StoredKerasModel


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

    return total, original, ct


class LocalKerasModelStorage:
    """
    Stores .keras files under a configurable root.

    Implements KerasModelStorage; storage_key is a logical path (e.g. keras/model_....keras)
    suitable for mapping to object keys without changing callers.
    """

    def __init__(self, root: Path | None = None) -> None:
        self._root = Path(root or MODEL_STORAGE_ROOT)
        self._root.mkdir(parents=True, exist_ok=True)

    async def save_keras_upload(self, upload: UploadFile) -> StoredKerasModel:
        model_id = f"model_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
        safe_name = f"{model_id}.keras"
        storage_key = f"keras/{safe_name}"
        dest = self._root / safe_name

        total, original, ct = await _stream_upload_to_path(upload, dest)
        now = datetime.now(timezone.utc)
        return StoredKerasModel(
            model_id=model_id,
            storage_key=storage_key,
            absolute_path=str(dest.resolve()),
            original_filename=original,
            byte_size=total,
            content_type=ct,
            saved_at=now,
        )


async def save_bot_keras_upload(upload: UploadFile, bot_id: str) -> StoredKerasModel:
    """Store a bot-owned copy under BOT_DATA_DIR/models/{bot_id}.keras (existing layout)."""
    dest_dir = Path(BOT_DATA_DIR) / "models"
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{bot_id}.keras"
    dest = dest_dir / safe_name
    storage_key = f"models/{safe_name}"

    total, original, ct = await _stream_upload_to_path(upload, dest)
    now = datetime.now(timezone.utc)
    return StoredKerasModel(
        model_id=bot_id,
        storage_key=storage_key,
        absolute_path=str(dest.resolve()),
        original_filename=original,
        byte_size=total,
        content_type=ct,
        saved_at=now,
    )
