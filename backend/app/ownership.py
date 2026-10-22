"""Scope pipeline runs, datasets, models, and bots to the authenticated user.

Mismatch → 404, never 403. Canonical owner is JWT ``sub`` when AUTH_REQUIRED.
When AUTH_REQUIRED is false, checks are skipped so current production stays up
until the explicit cutover.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from fastapi import HTTPException, Request
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth import get_current_user_id, require_user_id
from app.config import AUTH_REQUIRED, USER_ID
from app.db import SessionLocal
from app.models import Bot, PipelineRun, UserDataset, UserModel

logger = logging.getLogger("app.ownership")

# API clients already treat "succeeded" as completed. Do not rename that value.
TERMINAL_RUN_STATUSES = frozenset({"succeeded", "failed", "cancelled", "interrupted"})
_STATUS_ALIASES = {
    "completed": "succeeded",
    "complete": "succeeded",
    "done": "succeeded",
    "success": "succeeded",
    "error": "failed",
    "canceled": "cancelled",
}


def canonical_run_status(status: Optional[str]) -> Optional[str]:
    if status is None:
        return None
    raw = str(status).strip().lower()
    if not raw:
        return None
    return _STATUS_ALIASES.get(raw, raw)


def current_worker_id() -> str:
    """Host and pid of the process that started the run. Not a global lock."""
    return f"{socket.gethostname()}:{os.getpid()}"


def _pid_is_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _dt_to_epoch(value: Optional[datetime]) -> float:
    if value is None:
        return 0.0
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.timestamp()


def _row_state(row: PipelineRun) -> Dict[str, Any]:
    extra: Dict[str, Any] = {}
    if row.extra_json:
        try:
            parsed = json.loads(row.extra_json)
            if isinstance(parsed, dict):
                extra = parsed
        except (TypeError, ValueError):
            extra = {}
    return {
        "id": row.id,
        "user_id": str(row.user_id),
        "tool": row.tool,
        "status": row.status,
        "progress": float(row.progress or 0.0),
        "stage": row.stage or "",
        "message": row.message or "",
        "error_summary": row.error_summary,
        "artifact_ref": row.artifact_ref,
        "worker_id": row.worker_id,
        "route": row.route,
        "parent_run_id": row.parent_run_id,
        "trainer_run_id": extra.get("trainer_run_id"),
        "analysis_id": extra.get("analysis_id"),
        "created_at": _dt_to_epoch(row.created_at),
        "updated_at": _dt_to_epoch(row.updated_at),
        "finished_at": _dt_to_epoch(row.finished_at) if row.finished_at else None,
    }


def _as_uuid(user_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(user_id))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid token subject") from exc


def lookup_run_owner(run_id: str) -> Optional[str]:
    db = SessionLocal()
    try:
        row = db.get(PipelineRun, run_id)
        return str(row.user_id) if row is not None else None
    finally:
        db.close()


def record_pipeline_run(
    run_id: str,
    user_id: Optional[str],
    tool: str,
    *,
    status: str = "running",
    route: Optional[str] = None,
    parent_run_id: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
    progress: float = 0.0,
    stage: Optional[str] = None,
    message: Optional[str] = None,
    artifact_ref: Optional[str] = None,
    worker_id: Optional[str] = None,
) -> None:
    """Insert ownership row. No-op when user_id is missing or not a UUID (legacy env)."""
    if not user_id:
        return
    try:
        uid = uuid.UUID(str(user_id))
    except (ValueError, TypeError):
        logger.warning("Skipping pipeline_runs insert for non-UUID user_id=%r run=%s", user_id, run_id)
        return
    status = canonical_run_status(status) or "running"
    db = SessionLocal()
    try:
        existing = db.get(PipelineRun, run_id)
        extra_json = json.dumps(extra) if extra else None
        if existing is None:
            db.add(
                PipelineRun(
                    id=run_id,
                    user_id=uid,
                    tool=tool,
                    status=status,
                    progress=progress,
                    stage=stage,
                    message=message,
                    artifact_ref=artifact_ref,
                    worker_id=worker_id,
                    route=route,
                    parent_run_id=parent_run_id,
                    extra_json=extra_json,
                )
            )
        elif existing.status in TERMINAL_RUN_STATUSES and status not in TERMINAL_RUN_STATUSES:
            logger.info("Refusing to reopen terminal pipeline_run %s (%s)", run_id, existing.status)
        else:
            existing.status = status
            existing.progress = progress
            existing.stage = stage or existing.stage
            existing.message = message if message is not None else existing.message
            existing.artifact_ref = artifact_ref or existing.artifact_ref
            existing.worker_id = worker_id or existing.worker_id
            existing.route = route or existing.route
            existing.parent_run_id = parent_run_id if parent_run_id is not None else existing.parent_run_id
            if extra_json:
                existing.extra_json = extra_json
            db.add(existing)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to record pipeline_run %s", run_id)
        raise
    finally:
        db.close()


def update_pipeline_run_state(
    run_id: str,
    *,
    status: Optional[str] = None,
    progress: Optional[float] = None,
    stage: Optional[str] = None,
    message: Optional[str] = None,
    error_summary: Optional[str] = None,
    artifact_ref: Optional[str] = None,
) -> bool:
    """Persist a lifecycle transition. Terminal rows are not moved back to running.

    Returns False when the row is missing or the transition is rejected.
    Missing rows are ignored so legacy disk-only runs keep working.
    """
    status = canonical_run_status(status)
    db = SessionLocal()
    try:
        row = db.get(PipelineRun, run_id)
        if row is None:
            return False
        if row.status in TERMINAL_RUN_STATUSES and status is not None and status != row.status:
            logger.info(
                "Ignoring pipeline_run %s transition %s -> %s",
                run_id,
                row.status,
                status,
            )
            return False
        if status is not None:
            row.status = status
        if progress is not None:
            row.progress = max(0.0, min(1.0, float(progress)))
        if stage is not None:
            row.stage = stage
        if message is not None:
            row.message = message[:2000]
        if artifact_ref:
            row.artifact_ref = artifact_ref
        if row.status in TERMINAL_RUN_STATUSES:
            summary = error_summary if error_summary is not None else message
            if summary and row.status != "succeeded":
                row.error_summary = summary[:500]
            if row.finished_at is None:
                row.finished_at = datetime.now(timezone.utc)
        db.add(row)
        db.commit()
        return True
    except Exception:
        db.rollback()
        logger.exception("Failed to update pipeline_run %s", run_id)
        return False
    finally:
        db.close()


def _load_extra(raw: Optional[str]) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def merge_run_extra(run_id: str, patch: Dict[str, Any]) -> None:
    """Merge keys into pipeline_runs.extra_json. Missing row is a no-op."""
    db = SessionLocal()
    try:
        row = db.get(PipelineRun, run_id)
        if row is None:
            return
        extra = _load_extra(row.extra_json)
        extra.update(patch)
        row.extra_json = json.dumps(extra)
        db.add(row)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to merge pipeline_run extra %s", run_id)
        raise
    finally:
        db.close()


def merge_dataset_extra(dataset_id: str, patch: Dict[str, Any]) -> None:
    db = SessionLocal()
    try:
        row = db.get(UserDataset, dataset_id)
        if row is None:
            return
        extra = _load_extra(row.extra_json)
        extra.update(patch)
        row.extra_json = json.dumps(extra)
        db.add(row)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to merge user_dataset extra %s", dataset_id)
        raise
    finally:
        db.close()


def fetch_pipeline_run_state(run_id: str) -> Optional[Dict[str, Any]]:
    db = SessionLocal()
    try:
        row = db.get(PipelineRun, run_id)
        return _row_state(row) if row is not None else None
    finally:
        db.close()


def list_pipeline_run_states(user_id: Optional[str] = None, limit: int = 500) -> List[Dict[str, Any]]:
    db = SessionLocal()
    try:
        q = db.query(PipelineRun)
        if user_id:
            q = q.filter(PipelineRun.user_id == _as_uuid(user_id))
        rows = q.order_by(PipelineRun.updated_at.desc()).limit(limit).all()
        return [_row_state(row) for row in rows]
    finally:
        db.close()


def reconcile_orphaned_pipeline_runs() -> int:
    """Mark this host's dead-pid runs interrupted.

    Rows with no worker_id, or a worker_id for another host, are left alone.
    A different API or a future worker may still be executing them.
    """
    host = socket.gethostname()
    me = os.getpid()
    db = SessionLocal()
    changed = 0
    try:
        rows = (
            db.query(PipelineRun)
            .filter(PipelineRun.status.in_(("running", "queued")))
            .all()
        )
        now = datetime.now(timezone.utc)
        for row in rows:
            worker = row.worker_id or ""
            worker_host, sep, pid_s = worker.rpartition(":")
            if not sep or worker_host != host:
                continue
            try:
                pid = int(pid_s)
            except ValueError:
                continue
            if pid == me or _pid_is_alive(pid):
                continue
            row.status = "interrupted"
            row.stage = "interrupted"
            row.message = "The API process exited before this run finished."
            row.error_summary = row.message
            row.finished_at = now
            db.add(row)
            changed += 1
        if changed:
            db.commit()
        return changed
    except Exception:
        db.rollback()
        logger.exception("Failed to reconcile orphaned pipeline runs")
        return 0
    finally:
        db.close()


def owned_run_ids(user_id: str) -> Set[str]:
    uid = _as_uuid(user_id)
    db = SessionLocal()
    try:
        rows = db.query(PipelineRun.id).filter(PipelineRun.user_id == uid).all()
        return {r[0] for r in rows}
    finally:
        db.close()


def assert_run_owner(run_id: str, user_id: str, db: Optional[Session] = None) -> PipelineRun:
    uid = _as_uuid(user_id)
    own_session = db is None
    session = db or SessionLocal()
    try:
        row = session.get(PipelineRun, run_id)
        if row is None or row.user_id != uid:
            raise HTTPException(status_code=404, detail="Run not found")
        return row
    finally:
        if own_session:
            session.close()


def require_owned_run(run_id: str, request: Request) -> str:
    """Path-param dependency: 404 if this run is not owned by JWT ``sub``."""
    if not AUTH_REQUIRED:
        return run_id
    user_id = get_current_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    assert_run_owner(run_id, user_id)
    return run_id


def filter_runs_for_user(run_ids: List[str], user_id: Optional[str]) -> List[str]:
    if not AUTH_REQUIRED or not user_id:
        return run_ids
    owned = owned_run_ids(user_id)
    return [rid for rid in run_ids if rid in owned]


def record_user_dataset(
    dataset_id: str,
    user_id: Optional[str],
    *,
    source: Optional[str] = None,
    kind: Optional[str] = None,
    path: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    if not user_id:
        return
    try:
        uid = uuid.UUID(str(user_id))
    except (ValueError, TypeError):
        return
    db = SessionLocal()
    try:
        existing = db.get(UserDataset, dataset_id)
        extra_json = json.dumps(extra) if extra else None
        if existing is None:
            db.add(
                UserDataset(
                    id=dataset_id,
                    user_id=uid,
                    source=source,
                    kind=kind,
                    path=path,
                    extra_json=extra_json,
                )
            )
        else:
            if source:
                existing.source = source
            if kind:
                existing.kind = kind
            if path:
                existing.path = path
            if extra_json:
                existing.extra_json = extra_json
            db.add(existing)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to record user_dataset %s", dataset_id)
        raise
    finally:
        db.close()


def _epoch(value: Optional[datetime]) -> Optional[float]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.timestamp()


def fetch_library_catalog(user_id: Optional[str]) -> Dict[str, List[Dict[str, Any]]]:
    """Dataset, uploaded-model, and succeeded-trainer rows for library lists.

    One query per table. Does not read or download artifact files.
    """
    db = SessionLocal()
    try:
        datasets_q = db.query(UserDataset)
        models_q = db.query(UserModel)
        trainers_q = db.query(PipelineRun).filter(
            PipelineRun.tool == "trainer",
            PipelineRun.status == "succeeded",
        )
        if user_id:
            uid = _as_uuid(user_id)
            datasets_q = datasets_q.filter(UserDataset.user_id == uid)
            models_q = models_q.filter(UserModel.user_id == uid)
            trainers_q = trainers_q.filter(PipelineRun.user_id == uid)
        datasets = [
            {
                "id": row.id,
                "user_id": str(row.user_id),
                "source": row.source,
                "kind": row.kind,
                "created_at": _epoch(row.created_at),
                "extra": _load_extra(row.extra_json),
            }
            for row in datasets_q.all()
        ]
        models = [
            {
                "id": row.id,
                "user_id": str(row.user_id),
                "source": row.source,
                "storage_key": row.storage_key,
                "path": row.path,
                "created_at": _epoch(row.created_at),
                "extra": _load_extra(row.extra_json),
            }
            for row in models_q.all()
        ]
        trainers = [
            {
                "id": row.id,
                "user_id": str(row.user_id),
                "status": row.status,
                "created_at": _epoch(row.created_at),
                "extra": _load_extra(row.extra_json),
            }
            for row in trainers_q.all()
        ]
        return {"datasets": datasets, "models": models, "trainers": trainers}
    finally:
        db.close()


def owned_dataset_ids(user_id: str) -> Set[str]:
    uid = _as_uuid(user_id)
    db = SessionLocal()
    try:
        rows = db.query(UserDataset.id).filter(UserDataset.user_id == uid).all()
        return {r[0] for r in rows}
    finally:
        db.close()


def assert_dataset_owner(dataset_id: str, user_id: str) -> UserDataset:
    uid = _as_uuid(user_id)
    db = SessionLocal()
    try:
        row = db.get(UserDataset, dataset_id)
        if row is None or row.user_id != uid:
            raise HTTPException(status_code=404, detail="Dataset not found")
        return row
    finally:
        db.close()


def require_owned_dataset(dataset_id: str, request: Request) -> str:
    if not AUTH_REQUIRED:
        return dataset_id
    user_id = get_current_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    assert_dataset_owner(dataset_id, user_id)
    return dataset_id


def record_user_model(
    model_id: str,
    user_id: Optional[str],
    *,
    source: Optional[str] = None,
    storage_key: Optional[str] = None,
    path: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    if not user_id:
        return
    try:
        uid = uuid.UUID(str(user_id))
    except (ValueError, TypeError):
        return
    db = SessionLocal()
    try:
        existing = db.get(UserModel, model_id)
        extra_json = json.dumps(extra) if extra else None
        if existing is None:
            db.add(
                UserModel(
                    id=model_id,
                    user_id=uid,
                    source=source,
                    storage_key=storage_key,
                    path=path,
                    extra_json=extra_json,
                )
            )
        else:
            if source:
                existing.source = source
            if storage_key:
                existing.storage_key = storage_key
            if path:
                existing.path = path
            if extra_json:
                existing.extra_json = extra_json
            db.add(existing)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to record user_model %s", model_id)
        raise
    finally:
        db.close()


def owned_model_ids(user_id: str) -> Set[str]:
    uid = _as_uuid(user_id)
    db = SessionLocal()
    try:
        rows = db.query(UserModel.id).filter(UserModel.user_id == uid).all()
        return {r[0] for r in rows}
    finally:
        db.close()


def assert_model_owner(model_id: str, user_id: str) -> None:
    """Uploaded model row or a trainer pipeline run owned by the user."""
    uid = _as_uuid(user_id)
    db = SessionLocal()
    try:
        model = db.get(UserModel, model_id)
        if model is not None and model.user_id == uid:
            return
        run = db.get(PipelineRun, model_id)
        if run is not None and run.user_id == uid:
            return
        raise HTTPException(status_code=404, detail="Model not found")
    finally:
        db.close()


def require_owned_model(model_id: str, request: Request) -> str:
    if not AUTH_REQUIRED:
        return model_id
    user_id = get_current_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    assert_model_owner(model_id, user_id)
    return model_id


def assert_cross_owned(
    user_id: Optional[str],
    *,
    run_id: Optional[str] = None,
    dataset_id: Optional[str] = None,
    model_id: Optional[str] = None,
    trainer_run_id: Optional[str] = None,
) -> None:
    """When AUTH_REQUIRED, every provided resource id must belong to ``user_id``."""
    if not AUTH_REQUIRED or not user_id:
        return
    if run_id:
        assert_run_owner(run_id, user_id)
    if trainer_run_id:
        assert_run_owner(trainer_run_id, user_id)
    if dataset_id:
        assert_dataset_owner(dataset_id, user_id)
    if model_id:
        assert_model_owner(model_id, user_id)


def bot_write_owner_id(request: Request) -> str:
    """Owner stamped on new bots: JWT sub when auth is on, else env USER_ID."""
    if AUTH_REQUIRED:
        return require_user_id(request)
    return USER_ID


def bot_scope_owner_id(request: Request) -> str:
    if AUTH_REQUIRED:
        return require_user_id(request)
    return USER_ID


def bot_scope_clause(owner_id: str):
    """SQLAlchemy filter for bot listings/get. Auth on → exact UUID. Auth off → USER_ID or NULL."""
    if AUTH_REQUIRED:
        return Bot.user_id == owner_id
    return or_(Bot.user_id == USER_ID, Bot.user_id.is_(None))
