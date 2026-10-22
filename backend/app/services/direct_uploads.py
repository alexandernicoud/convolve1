"""Large uploads that bypass Cloud Run's 32 MiB request limit.

The API opens a GCS resumable upload session; the browser sends the file straight
to GCS; a finalize call then ingests the object. Staged objects live under
uploads/{uid}/{upload_id}/, and every lookup derives that prefix from the
authenticated user, so one user can never finalize another user's upload.

Everything under UPLOAD_PREFIX is temporary: the bucket lifecycle rule in
deploy/upload-lifecycle.json deletes abandoned objects, and must never match the
durable users/{uid}/... artifacts.

Local development has no bucket: init answers mode "multipart" and clients keep
using the existing multipart endpoints.
"""

from __future__ import annotations

import json
import re
import shutil
import tempfile
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Protocol, Tuple

from fastapi import HTTPException

from app.config import APP_PROFILE, MAX_DATASET_UPLOAD_BYTES, MAX_KERAS_UPLOAD_BYTES, MODEL_BUCKET
from app.paths import canonical_user_id, is_user_uuid

UPLOAD_PREFIX = "uploads/"
TERMINAL_STATUSES = frozenset({400, 413})
KIND_META = "convolve-kind"
SIZE_META = "convolve-size"
KINDS: Dict[str, Dict[str, Any]] = {
    "dataset": {"suffix": ".zip", "max_bytes": MAX_DATASET_UPLOAD_BYTES},
    "model": {"suffix": ".keras", "max_bytes": MAX_KERAS_UPLOAD_BYTES},
}
_UPLOAD_ID = re.compile(r"^[0-9a-f]{32}$")
_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


@dataclass(frozen=True)
class StagedObject:
    key: str
    size: int
    metadata: Dict[str, str]


@dataclass(frozen=True)
class StagedUpload:
    upload_id: str
    key: str
    filename: str
    size: int
    kind: str


class UploadStore(Protocol):
    def create_session(self, key: str, *, content_type: str, size: int, origin: Optional[str],
                       metadata: Dict[str, str]) -> str: ...

    def find(self, prefix: str) -> List[StagedObject]: ...

    def read_head(self, key: str, length: int) -> bytes: ...

    def download(self, key: str, dest: Path) -> None: ...

    def delete(self, key: str) -> None: ...


class GcsUploadStore:
    def __init__(self, bucket: str) -> None:
        self.bucket_name = bucket
        self._bucket = None

    def _get_bucket(self):
        if self._bucket is None:
            from google.cloud import storage

            self._bucket = storage.Client().bucket(self.bucket_name)
        return self._bucket

    def create_session(self, key, *, content_type, size, origin, metadata):
        blob = self._get_bucket().blob(key)
        blob.metadata = metadata
        return blob.create_resumable_upload_session(content_type=content_type, size=size, origin=origin)

    def find(self, prefix):
        return [
            StagedObject(key=b.name, size=int(b.size or 0), metadata=dict(b.metadata or {}))
            for b in self._get_bucket().list_blobs(prefix=prefix, max_results=5)
        ]

    def read_head(self, key, length):
        return self._get_bucket().blob(key).download_as_bytes(start=0, end=length - 1)

    def download(self, key, dest):
        dest.parent.mkdir(parents=True, exist_ok=True)
        self._get_bucket().blob(key).download_to_filename(str(dest))

    def delete(self, key):
        self._get_bucket().blob(key).delete()


class LocalUploadStore:
    """Test double: session URLs are fake; tests call write() to simulate the browser PUT."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.sessions: Dict[str, Dict[str, Any]] = {}

    def create_session(self, key, *, content_type, size, origin, metadata):
        self.sessions[key] = {"content_type": content_type, "size": size, "origin": origin, "metadata": metadata}
        return f"https://storage.test/upload/{key}"

    def write(self, key: str, data: bytes, metadata: Optional[Dict[str, str]] = None) -> None:
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        meta = metadata if metadata is not None else self.sessions[key]["metadata"]
        path.with_name(path.name + ".meta.json").write_text(json.dumps(meta))

    def find(self, prefix):
        base = self.root / prefix
        if not base.is_dir():
            return []
        out = []
        for path in sorted(base.iterdir()):
            if path.name.endswith(".meta.json") or not path.is_file():
                continue
            meta_path = path.with_name(path.name + ".meta.json")
            meta = json.loads(meta_path.read_text()) if meta_path.is_file() else {}
            out.append(StagedObject(key=f"{prefix}{path.name}", size=path.stat().st_size, metadata=meta))
        return out

    def read_head(self, key, length):
        with open(self.root / key, "rb") as fh:
            return fh.read(length)

    def download(self, key, dest):
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(self.root / key, dest)

    def delete(self, key):
        path = self.root / key
        path.unlink(missing_ok=True)
        path.with_name(path.name + ".meta.json").unlink(missing_ok=True)


_override: Optional[UploadStore] = None
_default: Optional[UploadStore] = None


def set_upload_store(store: Optional[UploadStore]) -> None:
    global _override
    _override = store


def get_upload_store() -> Optional[UploadStore]:
    """None means direct uploads are off (local development)."""
    global _default
    if _override is not None:
        return _override
    if APP_PROFILE != "cloud" or not MODEL_BUCKET:
        return None
    if _default is None:
        _default = GcsUploadStore(MODEL_BUCKET)
    return _default


def safe_filename(filename: str, suffix: str) -> str:
    name = Path(str(filename or "").replace("\\", "/")).name
    stem = _UNSAFE.sub("_", name[: -len(suffix)] if name.lower().endswith(suffix) else name).strip("._")
    if not name.lower().endswith(suffix) or not stem:
        raise HTTPException(status_code=400, detail=f"Only {suffix} files are supported")
    return f"{stem[:120]}{suffix}"


def _prefix(user_id: str, upload_id: str) -> str:
    return f"{UPLOAD_PREFIX}{canonical_user_id(user_id)}/{upload_id}/"


def _require_user(user_id: Optional[str]) -> str:
    if not user_id or not is_user_uuid(user_id):
        raise HTTPException(status_code=401, detail="Direct uploads require a signed-in user")
    return user_id


def init_upload(
    user_id: Optional[str],
    kind: str,
    filename: str,
    size: int,
    content_type: Optional[str],
    origin: Optional[str],
) -> Dict[str, Any]:
    store = get_upload_store()
    if store is None:
        return {"mode": "multipart"}
    user_id = _require_user(user_id)
    spec = KINDS.get(kind)
    if spec is None:
        raise HTTPException(status_code=400, detail=f"Unknown upload kind {kind!r}")
    name = safe_filename(filename, spec["suffix"])
    if size <= 0:
        raise HTTPException(status_code=400, detail="File is empty")
    if size > spec["max_bytes"]:
        raise HTTPException(status_code=413, detail=f"File size exceeds {spec['max_bytes'] // (1024 * 1024)}MB limit")
    upload_id = uuid.uuid4().hex
    key = _prefix(user_id, upload_id) + name
    url = store.create_session(
        key,
        content_type=content_type or "application/octet-stream",
        size=size,
        origin=origin,
        metadata={KIND_META: kind, SIZE_META: str(size)},
    )
    return {"mode": "direct", "upload_id": upload_id, "upload_url": url, "method": "PUT", "size": size}


def claim_upload(user_id: Optional[str], upload_id: str, kind: str) -> StagedUpload:
    """Return the caller's completed staged object. 404 for unknown or foreign uploads."""
    store = get_upload_store()
    if store is None:
        raise HTTPException(status_code=404, detail="Upload not found")
    user_id = _require_user(user_id)
    if not _UPLOAD_ID.match(str(upload_id or "")):
        raise HTTPException(status_code=404, detail="Upload not found")
    objects = store.find(_prefix(user_id, upload_id))
    if len(objects) != 1:
        raise HTTPException(status_code=404, detail="Upload not found or not finished")
    obj = objects[0]
    spec = KINDS[kind]
    if obj.metadata.get(KIND_META) != kind:
        raise HTTPException(status_code=409, detail=f"Upload is not a {kind} upload")
    declared = obj.metadata.get(SIZE_META)
    if declared is None or int(declared) != obj.size:
        raise HTTPException(status_code=409, detail="Upload is incomplete")
    staged = StagedUpload(upload_id=upload_id, key=obj.key, filename=obj.key.rsplit("/", 1)[-1],
                          size=obj.size, kind=kind)
    if obj.size > spec["max_bytes"]:
        _reject(staged, 413, f"File size exceeds {spec['max_bytes'] // (1024 * 1024)}MB limit")
    if not staged.filename.lower().endswith(spec["suffix"]):
        _reject(staged, 400, f"Only {spec['suffix']} files are supported")
    if store.read_head(obj.key, 4) != b"PK\x03\x04":
        _reject(staged, 400, f"Upload is not a valid {spec['suffix']} archive")
    return staged


def _reject(staged: StagedUpload, status: int, detail: str) -> None:
    discard_upload(staged)
    raise HTTPException(status_code=status, detail=detail)


@contextmanager
def adopt_upload(user_id: Optional[str], upload_id: str, kind: str) -> Iterator[Tuple[StagedUpload, Path]]:
    """Claim and download the caller's staged upload; delete it once ingested or rejected for good.

    404/409 keep the object (wrong user, still uploading, wrong endpoint) so the owner can retry.
    """
    staged = claim_upload(user_id, upload_id, kind)
    with tempfile.TemporaryDirectory() as tmp:
        local = fetch_upload(staged, Path(tmp) / staged.filename)
        try:
            yield staged, local
        except HTTPException as exc:
            if exc.status_code in TERMINAL_STATUSES:
                discard_upload(staged)
            raise
    discard_upload(staged)


def fetch_upload(staged: StagedUpload, dest: Path) -> Path:
    get_upload_store().download(staged.key, dest)
    return dest


def discard_upload(staged: StagedUpload) -> None:
    store = get_upload_store()
    if store is not None:
        try:
            store.delete(staged.key)
        except Exception:
            pass
