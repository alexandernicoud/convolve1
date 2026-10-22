"""CNN training in a dedicated Cloud Run Job.

The API records the run (status queued) with everything the worker needs in
pipeline_runs.extra_json["trainer_job"], then starts one job execution whose only
input is CONVOLVE_RUN_ID. The worker claims the row, restores the dataset from the
artifact store, runs the unchanged trainer, and reports progress to the same row.
Succeeded is written only after publish_completed_run has stored the model.

No checkpoints and no resume: a job that dies mid-training ends failed.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, List, Optional, Protocol, Tuple

from app.config import (
    TRAINER_EXECUTION,
    TRAINER_JOB_NAME,
    TRAINER_JOB_PROJECT,
    TRAINER_JOB_REGION,
    TRAINER_JOB_STALE_SECONDS,
)
from app.db import SessionLocal
from app.models import PipelineRun, UserDataset
from app.ownership import (
    TERMINAL_RUN_STATUSES,
    _dt_to_epoch,
    _load_extra,
    merge_run_extra,
    update_pipeline_run_state,
)

logger = logging.getLogger("app.trainer_jobs")

JOB_KEY = "trainer_job"
PROGRESS_KEY = "trainer_progress"
RUN_ID_ENV = "CONVOLVE_RUN_ID"
_HISTORY_PREVIEW = 20
_HISTORY_FULL = 2000
_SPLIT_KEYS = (
    "train_samples",
    "val_samples",
    "image_size",
    "batch_size",
    "epochs",
    "val_split",
    "random_seed",
    "train_label_counts",
    "val_label_counts",
)
_EXTRA_EPOCH_KEYS = ("label_1_recall", "val_label_1_recall", "timestamp")
_RUN_API = "https://run.googleapis.com/v2"


def job_mode_enabled() -> bool:
    return TRAINER_EXECUTION == "cloud_run_job"


# --- Dispatch -------------------------------------------------------------------


class JobDispatcher(Protocol):
    def run(self, run_id: str) -> str:
        """Start one execution for run_id. Return the execution resource name."""

    def cancel(self, execution: str) -> None:
        """Ask Cloud Run to stop the execution."""

    def finished(self, execution: str) -> Optional[bool]:
        """True when the execution has ended, False when still active, None if unknown."""


class CloudRunJobsDispatcher:
    """Cloud Run Admin API v2 with the runtime service account (no keys, no secrets in args)."""

    def __init__(self, project: str, region: str, job: str) -> None:
        if not project or not region or not job:
            raise RuntimeError(
                "TRAINER_JOB_PROJECT, TRAINER_JOB_REGION and TRAINER_JOB_NAME are required "
                "when TRAINER_EXECUTION=cloud_run_job"
            )
        self.job_path = f"projects/{project}/locations/{region}/jobs/{job}"

    def _session(self):
        import google.auth
        from google.auth.transport.requests import AuthorizedSession

        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        return AuthorizedSession(credentials)

    def run(self, run_id: str) -> str:
        body = {"overrides": {"containerOverrides": [{"env": [{"name": RUN_ID_ENV, "value": run_id}]}]}}
        resp = self._session().post(f"{_RUN_API}/{self.job_path}:run", json=body, timeout=30)
        if resp.status_code >= 300:
            raise RuntimeError(f"Cloud Run Jobs API returned {resp.status_code}: {resp.text[:300]}")
        op = resp.json()
        execution = ((op.get("metadata") or {}).get("name")) or op.get("name") or ""
        if not execution:
            raise RuntimeError("Cloud Run Jobs API did not return an execution name")
        return execution

    def cancel(self, execution: str) -> None:
        resp = self._session().post(f"{_RUN_API}/{execution}:cancel", json={}, timeout=30)
        if resp.status_code >= 300 and resp.status_code != 404:
            raise RuntimeError(f"Cancel returned {resp.status_code}: {resp.text[:300]}")

    def finished(self, execution: str) -> Optional[bool]:
        resp = self._session().get(f"{_RUN_API}/{execution}", timeout=30)
        if resp.status_code == 404:
            return True
        if resp.status_code >= 300:
            return None
        return bool(resp.json().get("completionTime"))


_dispatcher: Optional[JobDispatcher] = None


def set_dispatcher(dispatcher: Optional[JobDispatcher]) -> None:
    """Tests inject a fake. None restores the Cloud Run dispatcher."""
    global _dispatcher
    _dispatcher = dispatcher


def get_dispatcher() -> JobDispatcher:
    global _dispatcher
    if _dispatcher is None:
        _dispatcher = CloudRunJobsDispatcher(TRAINER_JOB_PROJECT, TRAINER_JOB_REGION, TRAINER_JOB_NAME)
    return _dispatcher


def dataset_is_stored(dataset_id: str, user_id: str) -> Tuple[bool, str]:
    """The job can only train on a dataset the artifact store holds for this owner."""
    db = SessionLocal()
    try:
        row = db.get(UserDataset, dataset_id)
        if row is None or str(row.user_id) != str(user_id):
            return False, "Dataset has no ownership record, so a training job cannot load it"
        durable = _load_extra(row.extra_json).get("durable") or {}
    finally:
        db.close()
    if not durable.get("published") or not (durable.get("files") or durable.get("archive")):
        return False, "Dataset has not been stored durably yet"
    return True, ""


def save_job_payload(run_id: str, config: Dict[str, Any], dataset_id: str, metadata: Dict[str, Any]) -> None:
    """Store the worker's inputs. worker_id loses the API host:pid so API restarts never interrupt it."""
    db = SessionLocal()
    try:
        row = db.get(PipelineRun, run_id)
        if row is None:
            raise RuntimeError(f"Run {run_id} has no pipeline_runs row")
        extra = _load_extra(row.extra_json)
        extra[JOB_KEY] = {
            "config": config,
            "dataset_id": dataset_id,
            "metadata": metadata,
            "requested_at": time.time(),
        }
        row.extra_json = json.dumps(extra)
        row.worker_id = "job/pending"
        db.add(row)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def dispatch(run_id: str) -> Tuple[bool, str]:
    """Start the execution. On failure the run is failed, never left queued."""
    try:
        execution = get_dispatcher().run(run_id)
    except Exception as exc:
        logger.exception("Could not start training job for %s", run_id)
        message = f"Could not start training job: {exc}"[:500]
        update_pipeline_run_state(run_id, status="failed", progress=0.0, stage="error", message=message)
        return False, message
    job = dict(load_job(run_id) or {})
    job["execution"] = execution
    merge_run_extra(run_id, {JOB_KEY: job})
    return True, execution


def cancel_execution(run_id: str) -> None:
    """Best effort. The worker also stops at the next epoch once the row is cancelled."""
    execution = (load_job(run_id) or {}).get("execution")
    if not execution:
        return
    try:
        get_dispatcher().cancel(execution)
    except Exception:
        logger.exception("Could not cancel job execution for %s", run_id)


# --- Shared row access ----------------------------------------------------------


def _load_row(run_id: str) -> Optional[Dict[str, Any]]:
    db = SessionLocal()
    try:
        row = db.get(PipelineRun, run_id)
        if row is None:
            return None
        return {
            "id": row.id,
            "user_id": str(row.user_id),
            "tool": row.tool,
            "status": row.status,
            "progress": float(row.progress or 0.0),
            "stage": row.stage or "",
            "message": row.message or "",
            "error_summary": row.error_summary,
            "updated_at": _dt_to_epoch(row.updated_at),
            "created_at": _dt_to_epoch(row.created_at),
            "finished_at": _dt_to_epoch(row.finished_at) if row.finished_at else None,
            "extra": _load_extra(row.extra_json),
        }
    finally:
        db.close()


def load_job(run_id: str) -> Optional[Dict[str, Any]]:
    row = _load_row(run_id)
    if row is None:
        return None
    job = row["extra"].get(JOB_KEY)
    return job if isinstance(job, dict) else None


def is_job_run(run_id: str) -> bool:
    return load_job(run_id) is not None


# --- Worker side ----------------------------------------------------------------


def claim(run_id: str, worker_id: str) -> Optional[Dict[str, Any]]:
    """queued → running for exactly one worker. Anything else returns None (nothing to do)."""
    db = SessionLocal()
    try:
        updated = (
            db.query(PipelineRun)
            .filter(PipelineRun.id == run_id, PipelineRun.status == "queued")
            .update(
                {
                    PipelineRun.status: "running",
                    PipelineRun.worker_id: worker_id,
                    PipelineRun.stage: "starting",
                    PipelineRun.message: "Training job started",
                },
                synchronize_session=False,
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    if updated != 1:
        return None
    row = _load_row(run_id)
    job = (row or {}).get("extra", {}).get(JOB_KEY)
    if not row or not isinstance(job, dict):
        return None
    return {"user_id": row["user_id"], **job}


def report_progress(run_id: str, phase: str, percent: float, data: Dict[str, Any]) -> None:
    """Mirror the in-process trainer_runs progress into the row. Never sets a status."""
    db = SessionLocal()
    try:
        row = db.get(PipelineRun, run_id)
        if row is None or row.status in TERMINAL_RUN_STATUSES:
            return
        extra = _load_extra(row.extra_json)
        state = extra.get(PROGRESS_KEY) if isinstance(extra.get(PROGRESS_KEY), dict) else {}
        progress = {"phase": phase, "percent": percent, **_json_safe(data)}
        state["progress"] = progress
        message = data.get("message", phase)
        split = {k: data[k] for k in _SPLIT_KEYS if data.get(k) is not None}
        if split:
            state["training_state"] = {**(state.get("training_state") or {}), **_json_safe(split), "data_ready_at": time.time()}
        if "epoch" in data:
            metrics = {
                "epoch": data.get("epoch"),
                "epochs": data.get("epochs"),
                "loss": data.get("loss"),
                "accuracy": data.get("accuracy"),
                "val_loss": data.get("val_loss"),
                "val_accuracy": data.get("val_accuracy"),
            }
            state["last_metrics"] = metrics
            history: List[Dict[str, Any]] = list(state.get("history_preview") or [])
            history.append(metrics)
            state["history_preview"] = history[-_HISTORY_PREVIEW:]
            full: List[Dict[str, Any]] = list(state.get("history") or [])
            full.append({**metrics, **{k: data.get(k) for k in _EXTRA_EPOCH_KEYS if k in data}})
            state["history"] = full[-_HISTORY_FULL:]
            val_acc = data.get("val_accuracy")
            message = f"Epoch {data.get('epoch', 0)}/{data.get('epochs', 0)}" + (
                f" • Val acc {val_acc:.3f}" if isinstance(val_acc, (int, float)) else ""
            )
        extra[PROGRESS_KEY] = state
        row.extra_json = json.dumps(extra)
        row.progress = max(0.0, min(1.0, float(percent) / 100.0))
        row.stage = phase
        row.message = str(message)[:2000]
        db.add(row)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Could not record progress for %s", run_id)
    finally:
        db.close()


def finish_succeeded(run_id: str) -> Tuple[bool, str]:
    from app.services.durable_outputs import publish_completed_run

    stored, err = publish_completed_run(run_id)
    if not stored:
        message = (err or "Completed outputs could not be stored")[:500]
        update_pipeline_run_state(run_id, status="failed", progress=0.0, stage="error", message=message)
        return False, message
    accepted = update_pipeline_run_state(
        run_id, status="succeeded", progress=1.0, stage="completed", message="Training completed"
    )
    return accepted, "" if accepted else "Run was already finished"


def finish_failed(run_id: str, message: str) -> None:
    update_pipeline_run_state(run_id, status="failed", progress=0.0, stage="error", message=message[:500])


def finish_cancelled(run_id: str) -> None:
    update_pipeline_run_state(run_id, status="cancelled", progress=0.0, stage="cancelled", message="Training cancelled")


class DbCancelFlag:
    """cancel_event for run_trainer. Reads the row status at most every interval_s."""

    def __init__(self, run_id: str, interval_s: float = 5.0) -> None:
        self.run_id = run_id
        self.interval_s = interval_s
        self._checked: Optional[float] = None
        self._set = False

    def is_set(self) -> bool:
        if self._set:
            return True
        now = time.monotonic()
        if self._checked is not None and now - self._checked < self.interval_s:
            return False
        self._checked = now
        row = _load_row(self.run_id)
        self._set = row is None or row["status"] == "cancelled"
        return self._set


# --- API side -------------------------------------------------------------------

_last_execution_check: Dict[str, float] = {}


def reconcile_stale(run_id: str, row: Dict[str, Any]) -> Dict[str, Any]:
    """Fail a quiet non-terminal job row whose execution has already ended."""
    if row["status"] in TERMINAL_RUN_STATUSES:
        return row
    now = time.time()
    if now - row["updated_at"] < TRAINER_JOB_STALE_SECONDS:
        return row
    if now - _last_execution_check.get(run_id, 0.0) < 60:
        return row
    _last_execution_check[run_id] = now
    execution = (row["extra"].get(JOB_KEY) or {}).get("execution")
    if not execution:
        return row
    try:
        ended = get_dispatcher().finished(execution)
    except Exception:
        logger.exception("Could not read job execution for %s", run_id)
        return row
    if ended:
        finish_failed(run_id, "Training job ended without reporting a result (crash, out of memory, or timeout)")
        return _load_row(run_id) or row
    return row


def progress_response(run_id: str) -> Optional[Dict[str, Any]]:
    """TrainerProgressResponse fields for a job run, or None when run_id is not a job run."""
    row = _load_row(run_id)
    if row is None or not isinstance(row["extra"].get(JOB_KEY), dict):
        return None
    row = reconcile_stale(run_id, row)
    state = row["extra"].get(PROGRESS_KEY) if isinstance(row["extra"].get(PROGRESS_KEY), dict) else {}
    status = row["status"]
    progress = dict(state.get("progress") or {})
    if status == "succeeded":
        api_status = "done"
        progress = {**progress, "phase": "completed", "percent": 100, "message": row["message"] or "Training completed"}
    elif status in ("failed", "interrupted"):
        api_status = "failed"
        progress = {"phase": "error", "percent": 0, "message": row["error_summary"] or row["message"] or "Training failed"}
    elif status == "cancelled":
        api_status = "cancelled"
        progress = {"phase": "cancelled", "percent": 0, "message": row["message"] or "Training cancelled"}
    else:
        api_status = "running"
        if status == "queued":
            progress = {"phase": "queued", "percent": 0, "message": "Waiting for a training machine…"}
        elif not progress:
            progress = {"phase": row["stage"] or "starting", "percent": round(row["progress"] * 100), "message": row["message"]}
    return {
        "status": api_status,
        "progress": progress,
        "last_metrics": state.get("last_metrics"),
        "history_preview": state.get("history_preview") or [],
        "artifact_paths": ["model", "metrics", "summary", "history"] if api_status == "done" else [],
        "history": state.get("history") or state.get("history_preview") or [],
        "training_state": state.get("training_state") or {},
        "row": {
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
            "finished_at": row.get("finished_at"),
            "error_summary": row.get("error_summary"),
            "status": status,
        },
    }


def _json_safe(data: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key, value in data.items():
        try:
            json.dumps(value)
        except (TypeError, ValueError):
            value = str(value)
        out[key] = value
    return out
