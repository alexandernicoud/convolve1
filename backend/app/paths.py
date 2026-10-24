"""Filesystem helpers: id validation, user namespacing, containment checks."""

from __future__ import annotations

import os
import re
import uuid
from pathlib import Path
from typing import Iterator, Optional, Tuple

from fastapi import HTTPException

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def backend_root() -> Path:
    return _BACKEND_ROOT


def runs_root() -> Path:
    override = os.getenv("CONVOLVE_RUNS_ROOT")
    return Path(override) if override else _BACKEND_ROOT / "runs"


def datasets_root() -> Path:
    override = os.getenv("CONVOLVE_DATASETS_ROOT")
    return Path(override) if override else _BACKEND_ROOT / "datasets"


def validate_id(raw: str, *, kind: str = "id") -> str:
    """Reject path injection. Unknown/unsafe ids look like missing resources (404)."""
    s = str(raw or "").strip()
    if not s or ".." in s or "/" in s or "\\" in s or not _SAFE_ID.fullmatch(s):
        raise HTTPException(status_code=404, detail=f"{kind} not found")
    return s


def is_user_uuid(raw: Optional[str]) -> bool:
    if not raw:
        return False
    try:
        uuid.UUID(str(raw))
        return True
    except (ValueError, TypeError):
        return False


def canonical_user_id(raw: str) -> str:
    return str(uuid.UUID(str(raw)))


def safe_resolve_under(root: Path, relative: str) -> Optional[Path]:
    """Return the resolved file path if it stays inside ``root``, else None.

    Rejects ``..`` traversal and absolute inputs that escape the output directory.
    """
    if relative is None:
        return None
    rel = str(relative).strip()
    if not rel or rel.startswith("/") or (len(rel) >= 2 and rel[1] == ":"):
        return None
    try:
        root_resolved = root.resolve()
        candidate = (root_resolved / rel).resolve()
    except (OSError, RuntimeError):
        return None
    try:
        candidate.relative_to(root_resolved)
    except ValueError:
        return None
    return candidate


def _namespaced_run_dir(run_id: str, user_id: str) -> Path:
    return runs_root() / canonical_user_id(user_id) / run_id


def run_dir_for(run_id: str, user_id: Optional[str] = None) -> Path:
    """Preferred write path: runs/<user_uuid>/<run_id> when user_id is a UUID.

    Reads fall back to the legacy flat runs/<run_id> layout so existing artifacts
    keep working until an explicit cutover moves them.
    """
    rid = validate_id(run_id, kind="run")
    legacy = runs_root() / rid
    if is_user_uuid(user_id):
        namespaced = _namespaced_run_dir(rid, user_id)
        if namespaced.is_dir():
            return namespaced
        if legacy.is_dir():
            return legacy
        return namespaced
    return legacy


def backtests_dir_for(user_id: Optional[str] = None) -> Path:
    if is_user_uuid(user_id):
        return runs_root() / canonical_user_id(user_id) / "backtests"
    return runs_root() / "backtests"


def backtest_run_dir(run_id: str, user_id: Optional[str] = None) -> Path:
    rid = validate_id(run_id, kind="run")
    namespaced = backtests_dir_for(user_id) / rid if is_user_uuid(user_id) else None
    legacy = runs_root() / "backtests" / rid
    if namespaced and namespaced.is_dir():
        return namespaced
    if legacy.is_dir():
        return legacy
    if namespaced is not None:
        return namespaced
    return legacy


def find_backtest_dir(run_id: str, user_id: Optional[str] = None) -> Optional[Path]:
    try:
        rid = validate_id(run_id, kind="run")
    except HTTPException:
        return None
    candidate = backtest_run_dir(rid, user_id)
    if candidate.is_dir():
        return candidate
    for name, path, _owner in iter_backtest_dirs():
        if name == rid:
            return path
    return None


def iter_run_dirs() -> Iterator[Tuple[str, Path, Optional[str]]]:
    """Yield (run_id, path, owner_uuid_or_none) under the runs root."""
    root = runs_root()
    if not root.is_dir():
        return
    try:
        names = list(root.iterdir())
    except OSError:
        return
    for child in names:
        if not child.is_dir():
            continue
        name = child.name
        if name == "backtests":
            continue
        if is_user_uuid(name):
            try:
                nested = list(child.iterdir())
            except OSError:
                continue
            for run_child in nested:
                if not run_child.is_dir() or run_child.name == "backtests":
                    continue
                if not _SAFE_ID.fullmatch(run_child.name):
                    continue
                yield run_child.name, run_child, name
        else:
            if _SAFE_ID.fullmatch(name):
                yield name, child, None


def iter_backtest_dirs() -> Iterator[Tuple[str, Path, Optional[str]]]:
    root = runs_root()
    legacy = root / "backtests"
    if legacy.is_dir():
        try:
            for child in legacy.iterdir():
                if child.is_dir() and _SAFE_ID.fullmatch(child.name):
                    yield child.name, child, None
        except OSError:
            pass
    if not root.is_dir():
        return
    try:
        for child in root.iterdir():
            if not child.is_dir() or not is_user_uuid(child.name):
                continue
            bt = child / "backtests"
            if not bt.is_dir():
                continue
            for run_child in bt.iterdir():
                if run_child.is_dir() and _SAFE_ID.fullmatch(run_child.name):
                    yield run_child.name, run_child, child.name
    except OSError:
        return


def dataset_dir_for(dataset_id: str, user_id: Optional[str] = None) -> Path:
    did = validate_id(dataset_id, kind="dataset")
    legacy = datasets_root() / did
    if is_user_uuid(user_id):
        namespaced = datasets_root() / canonical_user_id(user_id) / did
        if namespaced.is_dir():
            return namespaced
        if legacy.is_dir():
            return legacy
        return namespaced
    return legacy


def _search_dataset_dir(dataset_id: str, user_id: Optional[str] = None) -> Optional[Path]:
    try:
        did = validate_id(dataset_id, kind="dataset")
    except HTTPException:
        return None
    candidates = []
    if is_user_uuid(user_id):
        candidates.append(datasets_root() / canonical_user_id(user_id) / did)
    candidates.append(datasets_root() / did)
    for c in candidates:
        if c.is_dir():
            return c
    return None


def _dataset_has_images(path: Optional[Path]) -> bool:
    if path is None:
        return False
    images = path / "images"
    if not images.is_dir():
        return False
    try:
        return any(p.is_file() for p in images.iterdir())
    except OSError:
        return False


def resolve_existing_dataset_dir(
    dataset_id: str,
    user_id: Optional[str] = None,
    *,
    restore: bool = True,
) -> Optional[Path]:
    found = _search_dataset_dir(dataset_id, user_id)
    if _dataset_has_images(found):
        return found
    if not restore:
        return found
    try:
        from app.services.durable_outputs import restore_dataset

        if restore_dataset(dataset_id, user_id):
            restored = _search_dataset_dir(dataset_id, user_id)
            if restored is not None:
                return restored
    except Exception:
        pass
    return found


def iter_dataset_dirs() -> Iterator[Tuple[str, Path, Optional[str]]]:
    root = datasets_root()
    if not root.is_dir():
        return
    try:
        children = list(root.iterdir())
    except OSError:
        return
    for child in children:
        if not child.is_dir():
            continue
        name = child.name
        if is_user_uuid(name):
            try:
                for nested in child.iterdir():
                    if nested.is_dir() and (nested / "images").is_dir() and _SAFE_ID.fullmatch(nested.name):
                        yield nested.name, nested, name
            except OSError:
                continue
        elif (child / "images").is_dir() and _SAFE_ID.fullmatch(name):
            yield name, child, None


def keras_storage_key(model_id: str, user_id: Optional[str] = None) -> str:
    mid = validate_id(model_id, kind="model")
    if is_user_uuid(user_id):
        return f"keras/{canonical_user_id(user_id)}/{mid}.keras"
    return f"keras/{mid}.keras"


def local_keras_path(root: Path, model_id: str, user_id: Optional[str] = None) -> Path:
    mid = validate_id(model_id, kind="model")
    if is_user_uuid(user_id):
        return Path(root) / canonical_user_id(user_id) / f"{mid}.keras"
    return Path(root) / f"{mid}.keras"


def find_local_keras_file(root: Path, model_id: str, user_id: Optional[str] = None) -> Optional[Path]:
    """Locate an uploaded .keras file in namespaced or legacy layout."""
    try:
        mid = validate_id(model_id, kind="model")
    except HTTPException:
        return None
    candidates = []
    if is_user_uuid(user_id):
        candidates.append(Path(root) / canonical_user_id(user_id) / f"{mid}.keras")
    candidates.append(Path(root) / f"{mid}.keras")
    for c in candidates:
        if c.is_file():
            return c
    return None


def find_keras_sidecar(root: Path, model_id: str, user_id: Optional[str] = None) -> Optional[Path]:
    """Locate `{model_id}.metadata.json` next to a namespaced or legacy keras file."""
    try:
        mid = validate_id(model_id, kind="model")
    except HTTPException:
        return None
    candidates = []
    if is_user_uuid(user_id):
        candidates.append(Path(root) / canonical_user_id(user_id) / f"{mid}.metadata.json")
    candidates.append(Path(root) / f"{mid}.metadata.json")
    for c in candidates:
        if c.is_file():
            return c
    return None
