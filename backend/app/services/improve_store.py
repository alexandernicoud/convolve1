"""Read trainer runs for improvement sessions without downloading model weights.

Sources, in order: the local run directory (model_metadata.json / summary.json), the pipeline row's
job payload (queued or running cloud jobs) and the row's durable summary (finished runs whose files
live in object storage). Decisions are stored on the pipeline row (``extra_json``), or next to the
run's files when a legacy run has no row. No schema change; nothing is ever deleted.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.db import SessionLocal
from app.models import PipelineRun
from app.ownership import _as_uuid, _dt_to_epoch, _load_extra, merge_run_extra
from app.paths import is_user_uuid, iter_run_dirs, run_dir_for
from app.services.improve_sessions import DECISION_KEY

logger = logging.getLogger(__name__)

DECISION_FILE = "improve_decision.json"
_JOB_KEY = "trainer_job"


def _read_json(path: Path) -> Optional[Dict[str, Any]]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def trainer_rows(user_id: Optional[str]) -> Dict[str, Dict[str, Any]]:
    """Trainer pipeline rows by id (one user's when ``user_id`` is a UUID, else all)."""
    db = SessionLocal()
    try:
        q = db.query(PipelineRun).filter(PipelineRun.tool == "trainer")
        if user_id and is_user_uuid(user_id):
            q = q.filter(PipelineRun.user_id == _as_uuid(user_id))
        return {
            r.id: {
                "id": r.id,
                "user_id": str(r.user_id),
                "status": r.status,
                "created_at": _dt_to_epoch(r.created_at),
                "extra": _load_extra(r.extra_json),
            }
            for r in q.all()
        }
    except Exception:  # noqa: BLE001 — sessions degrade to disk-only runs
        logger.exception("Could not read trainer rows")
        return {}
    finally:
        db.close()


def local_trainer_dirs(user_id: Optional[str], auth_required: bool) -> Dict[str, Path]:
    """Trainer run directories on this machine that the caller may see."""
    out: Dict[str, Path] = {}
    for name, path, owner in iter_run_dirs():
        if auth_required and user_id and owner and owner != user_id:
            continue
        if (path / "model_metadata.json").is_file():
            out[name] = path
    return out


class RunView:
    """Everything a session needs about one trainer run."""

    def __init__(self, run_id: str, row: Optional[Dict[str, Any]], local_dir: Optional[Path]):
        self.id = run_id
        self.row = row
        self.dir = local_dir if local_dir and local_dir.is_dir() else None
        extra = (row or {}).get("extra") or {}
        job = extra.get(_JOB_KEY) if isinstance(extra.get(_JOB_KEY), dict) else {}
        durable = extra.get("durable") if isinstance(extra.get("durable"), dict) else {}
        self.metadata = (_read_json(self.dir / "model_metadata.json") if self.dir else None) or (
            job.get("metadata") if isinstance(job.get("metadata"), dict) else None
        )
        self.summary = (_read_json(self.dir / "summary.json") if self.dir else None) or (
            durable.get("metadata") if isinstance(durable.get("metadata"), dict) and durable.get("metadata", {}).get("config") is not None else None
        )
        self.decision = extra.get(DECISION_KEY) if isinstance(extra.get(DECISION_KEY), dict) else None
        if self.decision is None and self.dir:
            self.decision = _read_json(self.dir / DECISION_FILE)

    @property
    def status(self) -> str:
        if self.row and self.row.get("status"):
            return str(self.row["status"])
        if self.summary is not None and self.dir and any(
            p.suffix.lower() in (".keras", ".h5") for p in self.dir.iterdir() if p.is_file()
        ):
            return "succeeded"
        manifest = _read_json(self.dir / "run_manifest.json") if self.dir else None
        return str((manifest or {}).get("status") or "unknown")

    @property
    def created_at(self) -> Optional[float]:
        if self.row and self.row.get("created_at"):
            return self.row["created_at"]
        if self.dir:
            try:
                return os.path.getmtime(self.dir)
            except OSError:
                return None
        return None

    @property
    def name(self) -> Optional[str]:
        for src in (self.summary or {}, (self.metadata or {}).get("training_config") or {}, self.metadata or {}):
            n = src.get("model_name") if isinstance(src, dict) else None
            if isinstance(n, str) and n:
                return n
        return None


def run_views(user_id: Optional[str], auth_required: bool) -> Dict[str, RunView]:
    rows = trainer_rows(user_id if auth_required else None)
    dirs = local_trainer_dirs(user_id, auth_required)
    ids = set(rows)
    if not auth_required:
        ids |= set(dirs)
    else:
        # Legacy local runs without a row are not owned by anyone and stay invisible.
        ids |= {rid for rid in dirs if rid in rows}
    out: Dict[str, RunView] = {}
    for rid in ids:
        row = rows.get(rid)
        local = dirs.get(rid)
        if local is None and row is not None:
            candidate = run_dir_for(rid, row.get("user_id"))
            local = candidate if candidate.is_dir() else None
        out[rid] = RunView(rid, row, local)
    return out


def save_decision(view: RunView, record: Dict[str, Any]) -> None:
    if view.row is not None:
        merge_run_extra(view.id, {DECISION_KEY: record})
        return
    if view.dir is None:
        raise FileNotFoundError(view.id)
    tmp = view.dir / f".{DECISION_FILE}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2)
    os.replace(tmp, view.dir / DECISION_FILE)


def decisions_by_run(user_id: Optional[str], auth_required: bool) -> Dict[str, Dict[str, Any]]:
    """Decision records only (cheap: rows plus local decision files)."""
    out: Dict[str, Dict[str, Any]] = {}
    for rid, row in trainer_rows(user_id if auth_required else None).items():
        d = (row.get("extra") or {}).get(DECISION_KEY)
        if isinstance(d, dict):
            out[rid] = d
    for rid, path in local_trainer_dirs(user_id, auth_required).items():
        if rid not in out:
            d = _read_json(path / DECISION_FILE)
            if d:
                out[rid] = d
    return out


def list_ids(views: Dict[str, RunView]) -> List[str]:
    return sorted(views)
