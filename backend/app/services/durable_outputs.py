"""Store final outputs of completed runs.

In-progress work is not checkpointed. A run is marked succeeded only after the
files needed to reopen it, and to reuse its dataset or model, are in the
artifact store.

Local development records the existing filesystem paths. Cloud mode uploads
those same finals to MODEL_BUCKET under users/{user_id}/....
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import tempfile
import threading
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol, Tuple
from urllib.parse import unquote, urlparse

from app.config import APP_PROFILE, MODEL_BUCKET
from app.db import SessionLocal
from app.models import PipelineRun, UserDataset
from app.ownership import _load_extra, merge_dataset_extra, merge_run_extra, record_user_model
from app.paths import canonical_user_id, dataset_dir_for, is_user_uuid, run_dir_for

logger = logging.getLogger("app.durable_outputs")

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
MODEL_SUFFIXES = {".keras", ".h5", ".pkl", ".joblib"}
CHART_SUFFIXES = {".png", ".svg", ".json", ".csv"}
DATASET_ARCHIVE = "dataset.zip"
DATASET_ARCHIVE_FORMAT = "archive-v1"
_RESTORE_WORKERS = 8
_MANIFEST_CACHE: Dict[str, List[Dict[str, str]]] = {}


class ArtifactStore(Protocol):
    def put_file(self, key: str, src: Path) -> str:
        """Copy or upload src. Return a URI that materialize understands."""

    def materialize(self, uri: str, dest: Path) -> None:
        """Write the object to dest. No-op when dest is already that file."""


class LocalPassThroughStore:
    """Local dev: the filesystem is the store. URIs point at the original files."""

    # Nothing is transferred, so per-file references are free and need no extra copy.
    prefers_archives = False

    def put_file(self, key: str, src: Path) -> str:
        del key
        return src.resolve().as_uri()

    def materialize(self, uri: str, dest: Path) -> None:
        if not uri.startswith("file:"):
            raise FileNotFoundError(uri)
        src = Path(unquote(urlparse(uri).path))
        if not src.is_file():
            raise FileNotFoundError(uri)
        if dest.resolve() == src.resolve():
            return
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)


class LocalCopyStore:
    """Test double: copies finals into a separate root so the source dir can be removed."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def put_file(self, key: str, src: Path) -> str:
        key = _safe_key(key)
        dest = self.root / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        return f"durable://{key}"

    def materialize(self, uri: str, dest: Path) -> None:
        if not uri.startswith("durable://"):
            raise FileNotFoundError(uri)
        src = self.root / _safe_key(uri[len("durable://") :])
        if not src.is_file():
            raise FileNotFoundError(uri)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)


class GcsArtifactStore:
    """Completed files in MODEL_BUCKET. Not used for local development."""

    def __init__(self, bucket: str) -> None:
        bucket_name = (bucket or "").strip()
        if not bucket_name:
            raise RuntimeError(
                "MODEL_BUCKET is required to store completed experiments when APP_PROFILE=cloud"
            )
        self.bucket_name = bucket_name
        self._client = None
        self._lock = threading.Lock()

    def _get_client(self):
        with self._lock:
            if self._client is None:
                from google.cloud import storage

                self._client = storage.Client()
            return self._client

    def put_file(self, key: str, src: Path) -> str:
        from app.storage.gcs import build_gcs_uri

        key = _safe_key(key)
        blob = self._get_client().bucket(self.bucket_name).blob(key)
        blob.upload_from_filename(str(src))
        return build_gcs_uri(self.bucket_name, key)

    def materialize(self, uri: str, dest: Path) -> None:
        from app.storage.gcs import parse_gcs_uri

        parsed = parse_gcs_uri(uri)
        if not parsed:
            raise FileNotFoundError(uri)
        bucket_name, key = parsed
        dest.parent.mkdir(parents=True, exist_ok=True)
        self._get_client().bucket(bucket_name).blob(key).download_to_filename(str(dest))


_override: Optional[ArtifactStore] = None
_default: Optional[ArtifactStore] = None


def set_artifact_store(store: Optional[ArtifactStore]) -> None:
    """Tests inject a store. None restores the process default."""
    global _override
    _override = store


def get_artifact_store() -> ArtifactStore:
    global _default
    if _override is not None:
        return _override
    if _default is None:
        if APP_PROFILE == "cloud":
            _default = GcsArtifactStore(MODEL_BUCKET)
        else:
            _default = LocalPassThroughStore()
    return _default


def publish_completed_run(run_id: str) -> Tuple[bool, str]:
    """Upload finals and record their URIs. False means the run must not succeed."""
    try:
        return _publish_completed_run(run_id)
    except Exception as exc:
        logger.exception("Durable store failed for run %s", run_id)
        return False, f"Completed outputs could not be stored: {exc}"[:500]


def publish_dataset_dir(
    dataset_id: str,
    user_id: Optional[str],
    dataset_path: Path,
) -> Tuple[bool, str]:
    """Store summary.json and labeled images for a finished dataset."""
    try:
        return _publish_dataset_dir(dataset_id, user_id, dataset_path)
    except Exception as exc:
        logger.exception("Durable store failed for dataset %s", dataset_id)
        return False, f"Dataset could not be stored: {exc}"[:500]


def maybe_restore_run(run_id: str, dest: Optional[Path] = None) -> bool:
    """Copy stored finals back when the local run directory no longer has them."""
    manifest = _cached_run_manifest(run_id)
    if not manifest:
        return False
    if dest is None:
        owner = _run_owner(run_id)
        dest = run_dir_for(run_id, owner)
    wrote = False
    store = get_artifact_store()
    for item in manifest:
        rel = _safe_rel(item.get("rel") or "")
        target = _under(dest, rel)
        if target.is_file() and target.stat().st_size > 0:
            continue
        store.materialize(item["uri"], target)
        wrote = True
    return wrote


def restore_dataset(dataset_id: str, user_id: Optional[str] = None) -> bool:
    """Materialize a completed dataset into the owner's dataset directory."""
    db = SessionLocal()
    try:
        row = db.get(UserDataset, dataset_id)
        if row is None:
            return False
        owner = str(row.user_id)
        if user_id and is_user_uuid(user_id) and canonical_user_id(user_id) != canonical_user_id(owner):
            return False
        extra = _load_extra(row.extra_json)
    finally:
        db.close()
    durable = extra.get("durable") or {}
    files = durable.get("files") or []
    archive = durable.get("archive") if isinstance(durable.get("archive"), dict) else None
    if not files and archive is None:
        return False
    dest = dataset_dir_for(dataset_id, owner)
    store = get_artifact_store()
    _materialize_missing(store, dest, files)
    if archive is not None:
        _restore_archive(store, dest, archive)
    return True


def _materialize_missing(store: ArtifactStore, dest: Path, files: List[Dict[str, str]]) -> None:
    pending = []
    for item in files:
        target = _under(dest, _safe_rel(item.get("rel") or ""))
        if not (target.is_file() and target.stat().st_size > 0):
            pending.append((item["uri"], target))
    if len(pending) <= 1:
        for uri, target in pending:
            store.materialize(uri, target)
        return
    with ThreadPoolExecutor(max_workers=_RESTORE_WORKERS) as pool:
        for future in [pool.submit(store.materialize, uri, target) for uri, target in pending]:
            future.result()


def _count_images(images_dir: Path) -> int:
    if not images_dir.is_dir():
        return 0
    return sum(1 for p in images_dir.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES)


def _restore_archive(store: ArtifactStore, dest: Path, archive: Dict[str, Any]) -> None:
    """Download one archive and unpack it. Files appear in place only after the checksum passes."""
    if _count_images(dest / "images") >= int(archive.get("count") or 0) > 0:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex[:8]
    tmp_zip = dest.parent / f".{dest.name}.{token}.zip"
    staging = dest.parent / f".{dest.name}.{token}.d"
    try:
        store.materialize(archive["uri"], tmp_zip)
        if archive.get("sha256") and _sha256(tmp_zip) != archive["sha256"]:
            raise ValueError(f"Dataset archive checksum mismatch for {archive.get('key')}")
        moved: List[Tuple[Path, Path]] = []
        with zipfile.ZipFile(tmp_zip) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                rel = _safe_rel(info.filename)
                if not rel.startswith("images/"):
                    raise ValueError(f"Unexpected dataset archive member: {rel!r}")
                staged = _under(staging, rel)
                staged.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(staged, "wb") as out:
                    shutil.copyfileobj(src, out, 1024 * 1024)
                moved.append((staged, _under(dest, rel)))
        for staged, target in moved:
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(staged, target)
    finally:
        tmp_zip.unlink(missing_ok=True)
        shutil.rmtree(staging, ignore_errors=True)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _build_dataset_archive(root: Path, images: List[Path], dest: Path) -> Dict[str, Any]:
    # Chart PNGs are already compressed; storing avoids spending CPU for no gain.
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_STORED) as zf:
        for path in sorted(images):
            zf.write(path, _safe_rel(path.relative_to(root).as_posix()))
    return {"sha256": _sha256(dest), "bytes": dest.stat().st_size, "count": len(images)}


def restore_owned_datasets(user_id: str) -> None:
    """Download every dataset this user owns. Not used by list endpoints."""
    if not user_id:
        return
    db = SessionLocal()
    try:
        rows = db.query(UserDataset.id).filter(UserDataset.user_id == _uuid(user_id)).all()
        ids = [r[0] for r in rows]
    finally:
        db.close()
    for dataset_id in ids:
        try:
            restore_dataset(dataset_id, user_id)
        except Exception:
            logger.exception("Could not restore dataset %s", dataset_id)


def restore_completed_trainer_runs(user_id: str) -> None:
    """Download every succeeded trainer run. Not used by list endpoints."""
    if not user_id:
        return
    db = SessionLocal()
    try:
        rows = (
            db.query(PipelineRun.id)
            .filter(
                PipelineRun.user_id == _uuid(user_id),
                PipelineRun.tool == "trainer",
                PipelineRun.status == "succeeded",
            )
            .all()
        )
        ids = [r[0] for r in rows]
    finally:
        db.close()
    for run_id in ids:
        try:
            maybe_restore_run(run_id)
        except Exception:
            logger.exception("Could not restore trainer run %s", run_id)


class _RunView:
    def __init__(self, row: PipelineRun) -> None:
        self.id = row.id
        self.user_id = row.user_id
        self.tool = row.tool
        self.status = row.status
        self.parent_run_id = row.parent_run_id
        self.extra_json = row.extra_json


def _publish_completed_run(run_id: str) -> Tuple[bool, str]:
    row = _load_run(run_id)
    if row is None:
        # No ownership row (legacy, auth off). The caller already wrote local files.
        return True, ""
    if row.status == "succeeded" and _already_published(row):
        return True, ""
    if row.status in ("failed", "cancelled", "interrupted"):
        return False, "run already finished"
    if row.status == "succeeded" and not _already_published(row):
        try:
            _store_run_files(row)
        except Exception:
            logger.exception("Best-effort store skipped for legacy succeeded run %s", run_id)
        return True, ""

    stored = _store_run_files(row)
    if stored is None:
        return False, _missing_message(row.tool)
    return True, ""


def _store_run_files(row: _RunView) -> Optional[List[Dict[str, str]]]:
    user_id = str(row.user_id)
    content_id, root = _content_root(row, user_id)
    files = _collect(row, row.tool, root)
    if files is None:
        return None
    stored = _put_tree(user_id, f"runs/{content_id}", root, files)
    metadata = _metadata_for(files)
    _write_run_manifest(content_id, stored, metadata)
    if content_id != row.id:
        _write_run_manifest(row.id, stored, metadata)
    if row.tool == "testdata":
        ok, err = _publish_testdata_dataset(root, user_id)
        if not ok:
            raise RuntimeError(err or "Test dataset could not be stored")
    if row.tool == "trainer":
        _record_trained_model(row.id, user_id, stored)
    _MANIFEST_CACHE.pop(content_id, None)
    _MANIFEST_CACHE.pop(row.id, None)
    return stored


def _publish_dataset_dir(
    dataset_id: str,
    user_id: Optional[str],
    dataset_path: Path,
) -> Tuple[bool, str]:
    summary = dataset_path / "summary.json"
    if not summary.is_file():
        return False, "Dataset summary.json is missing, so it was not stored"
    images_dir = dataset_path / "images"
    images = (
        [p for p in images_dir.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES]
        if images_dir.is_dir()
        else []
    )
    if not images:
        return False, "Dataset images are missing, so it was not stored"
    if not user_id or not is_user_uuid(user_id):
        return True, ""
    meta = _read_json(summary)
    prefix = f"datasets/{dataset_id}"
    store = get_artifact_store()
    # Per-chart event times; the trainer purges overlapping samples from them.
    provenance_dir = dataset_path / "provenance"
    provenance = sorted(p for p in provenance_dir.iterdir() if p.is_file()) if provenance_dir.is_dir() else []
    if not getattr(store, "prefers_archives", True):
        files = [summary] + provenance + images
        zip_path = dataset_path / f"{dataset_id}.zip"
        if zip_path.is_file():
            files.append(zip_path)
        stored = _put_tree(user_id, prefix, dataset_path, files)
        merge_dataset_extra(dataset_id, {"durable": {"published": True, "files": stored, "summary": meta}})
        return True, ""

    # The extracted images are the dataset; the uploaded ZIP is only an ingest input.
    # On Cloud Run disk is memory, so drop it before building the archive.
    (dataset_path / f"{dataset_id}.zip").unlink(missing_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        archive_path = Path(tmp) / DATASET_ARCHIVE
        facts = _build_dataset_archive(dataset_path, images, archive_path)
        key = f"users/{canonical_user_id(user_id)}/{prefix}/{DATASET_ARCHIVE}"
        archive = {"rel": DATASET_ARCHIVE, "key": key, "uri": store.put_file(key, archive_path), **facts}
    stored = _put_tree(user_id, prefix, dataset_path, [summary] + provenance)
    merge_dataset_extra(
        dataset_id,
        {
            "durable": {
                "published": True,
                "format": DATASET_ARCHIVE_FORMAT,
                "files": stored,
                "archive": archive,
                "summary": meta,
            }
        },
    )
    return True, ""


def _publish_testdata_dataset(run_dir: Path, user_id: str) -> Tuple[bool, str]:
    results = _read_json(run_dir / "testdata_results.json")
    if not isinstance(results, dict) or not results.get("dataset_id"):
        return False, "Test dataset id is missing, so the run was not marked succeeded"
    dataset_id = str(results["dataset_id"])
    path = dataset_dir_for(dataset_id, user_id)
    if not (path / "summary.json").is_file():
        raw = results.get("dataset_path")
        if raw:
            candidate = Path(str(raw))
            path = candidate.parent if candidate.name == "images" else candidate
    return _publish_dataset_dir(dataset_id, user_id, path)


def _content_root(row: _RunView, user_id: str) -> Tuple[str, Path]:
    extra = _load_extra(row.extra_json)
    if row.tool == "analysis":
        parent = row.parent_run_id or extra.get("trainer_run_id")
        if parent:
            parent_dir = run_dir_for(str(parent), user_id)
            if (parent_dir / "analysis").is_dir() or (parent_dir / "cnn_analysis.zip").is_file():
                return str(parent), parent_dir
    return row.id, run_dir_for(row.id, user_id)


def _collect(row: Optional[PipelineRun], tool: str, root: Path) -> Optional[List[Path]]:
    del row
    collector = {
        "trainer": _trainer_files,
        "training-chart-generator": _generator_files,
        "labeling-optimizer": _labeling_files,
        "backtester": _backtester_files,
        "testdata": _testdata_files,
        "analysis": _analysis_files,
    }.get(tool)
    if collector is None:
        return []
    return collector(root)


def _trainer_files(root: Path) -> Optional[List[Path]]:
    models = [p for p in root.iterdir() if p.is_file() and p.suffix.lower() in MODEL_SUFFIXES] if root.is_dir() else []
    summary = root / "summary.json"
    if not models or not summary.is_file():
        return None
    files = list(models) + [summary]
    for name in (
        "history.json",
        "model_metadata.json",
        "timings.json",
        "training_state.json",
        "evaluation.json",
        "model_manifest.json",
        "split_manifest.json.gz",
    ):
        path = root / name
        if path.is_file():
            files.append(path)
    return files


def _generator_files(root: Path) -> Optional[List[Path]]:
    if not root.is_dir():
        return None
    zips = sorted(p for p in root.glob("training-dataset-*.zip") if p.is_file())
    if not zips:
        return None
    files = list(zips)
    stats = root / "artifacts" / "dataset_stats.json"
    if stats.is_file():
        files.append(stats)
    return files


def _labeling_files(root: Path) -> Optional[List[Path]]:
    art = root / "artifacts"
    if not art.is_dir():
        return None
    files = [
        p
        for p in art.iterdir()
        if p.is_file() and p.suffix.lower() in {".png", ".svg", ".json"}
    ]
    return files or None


def _backtester_files(root: Path) -> Optional[List[Path]]:
    results = root / "backtest_output" / "backtest_results.json"
    if not results.is_file():
        return None
    files: List[Path] = []
    out = root / "backtest_output"
    for path in out.rglob("*"):
        if path.is_file() and path.suffix.lower() in CHART_SUFFIXES:
            files.append(path)
    return files


def _testdata_files(root: Path) -> Optional[List[Path]]:
    results = root / "testdata_results.json"
    if not results.is_file():
        return None
    files = [results]
    for name in ("testdata_config.json", "testdata.zip"):
        path = root / name
        if path.is_file():
            files.append(path)
    return files


def _analysis_files(root: Path) -> Optional[List[Path]]:
    files: List[Path] = []
    analysis = root / "analysis"
    if analysis.is_dir():
        for sub in analysis.iterdir():
            if not sub.is_dir() or not (sub / "delivery_summary.json").is_file():
                continue
            for path in sub.iterdir():
                if path.is_file() and path.suffix.lower() in {".png", ".json", ".svg"}:
                    files.append(path)
    for name in ("cnn_analysis.zip", "analysis_context.json", "analysis_summary.json"):
        path = root / name
        if path.is_file():
            files.append(path)
    lab = root / "lab"
    for name in ("session.json", "findings.json"):
        if (lab / name).is_file():
            files.append(lab / name)
    jobs_root = lab / "jobs"
    if jobs_root.is_dir():
        for job in sorted(jobs_root.iterdir()):
            if job.is_dir() and (job / "result.json").is_file():
                files.extend(job / n for n in ("params.json", "status.json", "result.json") if (job / n).is_file())
    if not files:
        return None
    return files


def _put_tree(user_id: str, prefix: str, root: Path, files: List[Path]) -> List[Dict[str, str]]:
    store = get_artifact_store()
    uid = canonical_user_id(user_id)
    stored: List[Dict[str, str]] = []
    for path in files:
        rel = _safe_rel(str(path.relative_to(root)))
        key = f"users/{uid}/{prefix}/{rel}"
        uri = store.put_file(key, path)
        stored.append({"rel": rel, "key": key, "uri": uri})
    return stored


def _write_run_manifest(run_id: str, files: List[Dict[str, str]], metadata: Optional[Dict[str, Any]]) -> None:
    db = SessionLocal()
    try:
        row = db.get(PipelineRun, run_id)
        extra = _load_extra(row.extra_json) if row is not None else {}
    finally:
        db.close()
    durable = extra.get("durable") if isinstance(extra.get("durable"), dict) else {}
    by_rel = {item["rel"]: item for item in (durable.get("files") or []) if item.get("rel")}
    for item in files:
        by_rel[item["rel"]] = item
    payload: Dict[str, Any] = {"published": True, "files": list(by_rel.values())}
    if metadata:
        payload["metadata"] = metadata
    elif isinstance(durable.get("metadata"), dict):
        payload["metadata"] = durable["metadata"]
    merge_run_extra(run_id, {"durable": payload})


def _record_trained_model(run_id: str, user_id: str, stored: List[Dict[str, str]]) -> None:
    model = next((item for item in stored if Path(item["rel"]).suffix.lower() in MODEL_SUFFIXES), None)
    if model is None:
        return
    try:
        record_user_model(
            run_id,
            user_id,
            source="trainer",
            storage_key=model["key"],
            path=model["uri"],
            extra={"run_id": run_id},
        )
    except Exception:
        logger.exception("Trained model row was not recorded for %s", run_id)


def _metadata_for(files: List[Path]) -> Optional[Dict[str, Any]]:
    preferred = (
        "summary.json",
        "testdata_results.json",
        "delivery_summary.json",
        "metrics.json",
        "dataset_stats.json",
        "backtest_results.json",
    )
    by_name = {p.name: p for p in files}
    for name in preferred:
        path = by_name.get(name)
        if path is None:
            continue
        data = _read_json(path)
        if not isinstance(data, dict):
            continue
        if name == "backtest_results.json":
            kpis = data.get("kpis")
            return {"kpis": kpis} if isinstance(kpis, dict) else None
        if path.stat().st_size > 64_000:
            continue
        return data
    return None


def _cached_run_manifest(run_id: str) -> List[Dict[str, str]]:
    if run_id in _MANIFEST_CACHE:
        return _MANIFEST_CACHE[run_id]
    row = _load_run(run_id)
    files: List[Dict[str, str]] = []
    if row is not None:
        extra = _load_extra(row.extra_json)
        raw = (extra.get("durable") or {}).get("files") or []
        if isinstance(raw, list):
            files = [item for item in raw if isinstance(item, dict) and item.get("uri") and item.get("rel")]
    # Another process (the training job) may publish later, so only cache what exists.
    if files:
        _MANIFEST_CACHE[run_id] = files
    return files


def _already_published(row: _RunView) -> bool:
    extra = _load_extra(row.extra_json)
    durable = extra.get("durable") if isinstance(extra.get("durable"), dict) else {}
    return bool(durable.get("published"))


def _load_run(run_id: str) -> Optional[_RunView]:
    db = SessionLocal()
    try:
        row = db.get(PipelineRun, run_id)
        return _RunView(row) if row is not None else None
    finally:
        db.close()


def _run_owner(run_id: str) -> Optional[str]:
    row = _load_run(run_id)
    return str(row.user_id) if row is not None else None


def _missing_message(tool: str) -> str:
    return {
        "trainer": "Trained model or summary.json is missing, so the run was not marked succeeded",
        "training-chart-generator": "Training dataset ZIP is missing, so the run was not marked succeeded",
        "labeling-optimizer": "Optimizer charts are missing, so the run was not marked succeeded",
        "backtester": "backtest_results.json is missing, so the run was not marked succeeded",
        "testdata": "testdata_results.json is missing, so the run was not marked succeeded",
        "analysis": "Analysis delivery files are missing, so the run was not marked succeeded",
    }.get(tool, "Required artifacts are missing, so the run was not marked succeeded")


def _read_json(path: Path) -> Optional[Dict[str, Any]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def _uuid(user_id: str):
    import uuid

    return uuid.UUID(str(user_id))


def _safe_rel(rel: str) -> str:
    rel = rel.replace("\\", "/").lstrip("/")
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        raise ValueError(f"Unsafe artifact path: {rel!r}")
    return "/".join(parts)


def _safe_key(key: str) -> str:
    return _safe_rel(key)


def _under(root: Path, rel: str) -> Path:
    target = (root / rel).resolve()
    root_resolved = root.resolve()
    try:
        target.relative_to(root_resolved)
    except ValueError as exc:
        raise ValueError(f"Artifact path escapes {root}") from exc
    return target
