"""CNN training in a dedicated Cloud Run Job.

The API records the run (status queued) with everything the worker needs in
pipeline_runs.extra_json["trainer_job"], then starts one job execution whose only
input is CONVOLVE_RUN_ID. The worker claims the row, restores the dataset from the
artifact store, runs the unchanged trainer, and reports progress to the same row.
Succeeded is written only after publish_completed_run has stored the model.

Queue: a run over the concurrency limits waits as status queued with worker_id
"job/waiting" and no execution. pump_queue() starts waiting runs oldest first as capacity
frees up; flipping waiting -> pending is a conditional UPDATE, so a run is dispatched once.

Checkpoints: the worker saves one after every epoch and uploads it under
checkpoints/{user}/{run}/. A retried attempt of the same execution, or a resume the user asks
for after a failure, continues from it. The trainer refuses checkpoints of another run, user or
experiment configuration.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, List, Optional, Protocol, Tuple

import threading

from app import config as app_config
from app.config import (
    TRAINER_EXECUTION,
    TRAINER_JOB_NAME,
    TRAINER_JOB_PROJECT,
    TRAINER_JOB_REGION,
    TRAINER_JOB_STALE_SECONDS,
)
from app.db import SessionLocal
from app.models import PipelineRun, UserDataset, UserPlan
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
WORKER_TIMINGS_KEY = "trainer_worker_timings"
CHECKPOINT_KEY = "trainer_checkpoint"
QUEUE_KEY = "trainer_queue"
WAITING = "job/waiting"
PENDING = "job/pending"
_QUEUE_LOCK_KEY = 724_461_001
_queue_lock = threading.Lock()
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
    "trainer_protocol",
    "validation_method",
    "test_samples",
    "test_label_counts",
    "split",
)
_EXTRA_EPOCH_KEYS = (
    "label_1_recall",
    "val_label_1_recall",
    "timestamp",
    "auc",
    "pr_auc",
    "balanced_accuracy",
    "val_auc",
    "val_pr_auc",
    "val_balanced_accuracy",
    "val_precision",
    "val_recall",
    "val_f1",
    "learning_rate",
)
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


def _authorized_session():
    import google.auth
    from google.auth.transport.requests import AuthorizedSession

    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    return AuthorizedSession(credentials)


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
        return _authorized_session()

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


_BATCH_API = "https://batch.googleapis.com/v1"
_BATCH_ENDED = {"SUCCEEDED", "FAILED", "CANCELLED", "DELETION_IN_PROGRESS"}


class CloudBatchDispatcher:
    """Cloud Batch (GPU pool on Compute Engine G2, e.g. Zurich). One Batch job per execution;
    the job body comes from a reviewed template, only CONVOLVE_RUN_ID is injected."""

    def __init__(self, project: str, region: str, template_path: str) -> None:
        if not project or not region or not template_path:
            raise RuntimeError(
                "TRAINER_JOB_PROJECT, TRAINER_GPU_REGION and TRAINER_GPU_BATCH_TEMPLATE are required "
                "when TRAINER_GPU_EXECUTION=batch"
            )
        self.parent = f"projects/{project}/locations/{region}"
        with open(template_path, encoding="utf-8") as fh:
            self.template = json.load(fh)

    def _session(self):
        return _authorized_session()

    def body(self, run_id: str) -> Dict[str, Any]:
        body = json.loads(json.dumps(self.template))
        body.pop("//", None)
        spec = body["taskGroups"][0]["taskSpec"]
        env = spec.setdefault("environment", {}).setdefault("variables", {})
        env[RUN_ID_ENV] = run_id
        return body

    @staticmethod
    def job_id(run_id: str) -> str:
        import re
        import uuid as _uuid

        slug = re.sub(r"[^a-z0-9-]", "-", run_id.lower())[:40].strip("-")
        return f"train-{slug}-{_uuid.uuid4().hex[:8]}"

    def run(self, run_id: str) -> str:
        resp = self._session().post(
            f"{_BATCH_API}/{self.parent}/jobs", params={"job_id": self.job_id(run_id)}, json=self.body(run_id), timeout=30
        )
        if resp.status_code >= 300:
            raise RuntimeError(f"Cloud Batch API returned {resp.status_code}: {resp.text[:300]}")
        name = resp.json().get("name") or ""
        if not name:
            raise RuntimeError("Cloud Batch API did not return a job name")
        return name

    def cancel(self, execution: str) -> None:
        # Deleting a Batch job stops its VMs; the run row keeps the history.
        resp = self._session().delete(f"{_BATCH_API}/{execution}", timeout=30)
        if resp.status_code >= 300 and resp.status_code != 404:
            raise RuntimeError(f"Cancel returned {resp.status_code}: {resp.text[:300]}")

    def finished(self, execution: str) -> Optional[bool]:
        resp = self._session().get(f"{_BATCH_API}/{execution}", timeout=30)
        if resp.status_code == 404:
            return True
        if resp.status_code >= 300:
            return None
        return ((resp.json().get("status") or {}).get("state")) in _BATCH_ENDED


_dispatchers: Dict[str, JobDispatcher] = {}
ACCELERATORS = ("cpu", "gpu")


def accelerator_of(job: Optional[Dict[str, Any]]) -> str:
    return "gpu" if (job or {}).get("accelerator") == "gpu" else "cpu"


def set_dispatcher(dispatcher: Optional[JobDispatcher], accelerator: str = "cpu") -> None:
    """Tests inject a fake. None restores the configured dispatcher."""
    if dispatcher is None:
        _dispatchers.pop(accelerator, None)
    else:
        _dispatchers[accelerator] = dispatcher


def gpu_enabled() -> bool:
    return "gpu" in _dispatchers or bool(app_config.TRAINER_GPU_EXECUTION and app_config.TRAINER_GPU_REGION)


def get_dispatcher(accelerator: str = "cpu") -> JobDispatcher:
    if accelerator not in _dispatchers:
        if accelerator == "gpu":
            if not gpu_enabled():
                raise RuntimeError("GPU training is not configured (TRAINER_GPU_EXECUTION, TRAINER_GPU_REGION)")
            if app_config.TRAINER_GPU_EXECUTION == "batch":
                _dispatchers["gpu"] = CloudBatchDispatcher(
                    TRAINER_JOB_PROJECT, app_config.TRAINER_GPU_REGION, app_config.TRAINER_GPU_BATCH_TEMPLATE
                )
            else:
                _dispatchers["gpu"] = CloudRunJobsDispatcher(
                    TRAINER_JOB_PROJECT, app_config.TRAINER_GPU_REGION, app_config.TRAINER_GPU_JOB_NAME
                )
        else:
            _dispatchers["cpu"] = CloudRunJobsDispatcher(TRAINER_JOB_PROJECT, TRAINER_JOB_REGION, TRAINER_JOB_NAME)
    return _dispatchers[accelerator]


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


def save_job_payload(
    run_id: str, config: Dict[str, Any], dataset_id: str, metadata: Dict[str, Any], accelerator: str = "cpu"
) -> None:
    """Store the worker's inputs. worker_id loses the API host:pid so API restarts never interrupt it."""
    if accelerator not in ACCELERATORS:
        raise ValueError(f"accelerator must be one of {', '.join(ACCELERATORS)}")
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
            "accelerator": accelerator,
            "requested_at": time.time(),
        }
        row.extra_json = json.dumps(extra)
        row.worker_id = PENDING
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
        execution = get_dispatcher(accelerator_of(load_job(run_id))).run(run_id)
    except Exception as exc:
        logger.exception("Could not start training job for %s", run_id)
        message = f"Could not start training job: {exc}"[:500]
        update_pipeline_run_state(run_id, status="failed", progress=0.0, stage="error", message=message)
        return False, message
    job = dict(load_job(run_id) or {})
    job["execution"] = execution
    merge_run_extra(run_id, {JOB_KEY: job})
    return True, execution


# --- Queue and concurrency -------------------------------------------------------


def _active_filter(query):
    """Job rows holding (or about to hold) a training machine: dispatched and not finished."""
    return query.filter(
        PipelineRun.tool == "trainer",
        PipelineRun.status.in_(("queued", "running")),
        PipelineRun.worker_id.like("job/%"),
        PipelineRun.worker_id != WAITING,
    )


def _user_limits(db, user_id: str) -> Dict[str, int]:
    from app.plans import DEFAULT_PLAN_ID, compute_limits

    plan = None
    try:
        import uuid as _uuid

        plan = db.get(UserPlan, _uuid.UUID(str(user_id)))
    except (ValueError, TypeError):
        plan = None
    return compute_limits(plan.plan_id if plan else DEFAULT_PLAN_ID)


def _capacity_blocker(db, user_id: str, accelerator: str = "cpu") -> Optional[str]:
    """None when one more job may start for user_id, else why not ("global", "gpu" or "user")."""
    global_cap = app_config.TRAINER_MAX_ACTIVE_JOBS
    if global_cap and _active_filter(db.query(PipelineRun)).count() >= global_cap:
        return "global"
    gpu_cap = app_config.TRAINER_MAX_ACTIVE_GPU_JOBS
    if accelerator == "gpu" and gpu_cap:
        rows = _active_filter(db.query(PipelineRun.extra_json)).all()
        if sum(1 for (extra,) in rows if accelerator_of(_load_extra(extra).get(JOB_KEY)) == "gpu") >= gpu_cap:
            return "gpu"
    user_cap = _user_limits(db, user_id)["max_active_training_jobs"]
    if user_cap and _active_filter(db.query(PipelineRun)).filter(PipelineRun.user_id == _uid(user_id)).count() >= user_cap:
        return "user"
    return None


def _waiting_in_order(db) -> List[Tuple[str, Any, str]]:
    """Waiting runs (id, user_id, accelerator), first submitted first. created_at alone is too
    coarse (seconds on SQLite)."""
    rows = (
        db.query(PipelineRun.id, PipelineRun.user_id, PipelineRun.created_at, PipelineRun.extra_json)
        .filter(PipelineRun.tool == "trainer", PipelineRun.status == "queued", PipelineRun.worker_id == WAITING)
        .all()
    )
    items = []
    for r in rows:
        extra = _load_extra(r.extra_json)
        queued_at = (extra.get(QUEUE_KEY) or {}).get("queued_at")
        order = (float(queued_at) if queued_at else r.created_at.timestamp(), r.id)
        items.append((order, r.id, r.user_id, accelerator_of(extra.get(JOB_KEY))))
    return [(rid, uid, acc) for _, rid, uid, acc in sorted(items)]


def _uid(user_id: str):
    import uuid as _uuid

    return _uuid.UUID(str(user_id))


def _serialized(db) -> None:
    """Serialise queue decisions across API instances (Postgres); SQLite has a single writer."""
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        from sqlalchemy import text

        db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _QUEUE_LOCK_KEY})


def queue_admission_error(user_id: str, images: Optional[int], epochs: Optional[int]) -> Optional[str]:
    """Checked before a run is registered (and could be charged): queue depth and size limits."""
    db = SessionLocal()
    try:
        limits = _user_limits(db, user_id)
        max_queued = limits["max_queued_training_jobs"]
        if max_queued:
            waiting = (
                db.query(PipelineRun)
                .filter(
                    PipelineRun.tool == "trainer",
                    PipelineRun.status == "queued",
                    PipelineRun.worker_id == WAITING,
                    PipelineRun.user_id == _uid(user_id),
                )
                .count()
            )
            if waiting >= max_queued:
                return f"You already have {waiting} training runs waiting. Start more when one has begun."
    finally:
        db.close()
    if limits["max_training_images"] and images and images > limits["max_training_images"]:
        return f"This dataset has {images:,} images; training is limited to {limits['max_training_images']:,}."
    if limits["max_epochs"] and epochs and epochs > limits["max_epochs"]:
        return f"Training is limited to {limits['max_epochs']} epochs."
    return None


def submit(run_id: str, user_id: str) -> Tuple[bool, str]:
    """Enqueue the run and start whatever capacity allows, oldest first (a new run never overtakes
    one already waiting). Returns (False, message) only when starting this run failed."""
    with _queue_lock:
        db = SessionLocal()
        try:
            _serialized(db)
            row = db.get(PipelineRun, run_id)
            if row is not None and row.status == "queued":
                extra = _load_extra(row.extra_json)
                extra[QUEUE_KEY] = {"queued_at": time.time()}
                row.extra_json = json.dumps(extra)
                row.worker_id = WAITING
                row.stage = "queued"
                row.message = "Waiting in the training queue"
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
    failures: Dict[str, str] = {}
    started = pump_queue(failures=failures)
    if run_id in failures:
        return False, failures[run_id]
    return True, "started" if run_id in started else "queued"


_last_poll_pump = 0.0
POLL_PUMP_INTERVAL_S = 5.0


def pump_queue_if_due() -> List[str]:
    """For progress polls: at most every few seconds per process, and without taking the queue
    lock when nothing is waiting."""
    global _last_poll_pump
    now = time.monotonic()
    if now - _last_poll_pump < POLL_PUMP_INTERVAL_S:
        return []
    _last_poll_pump = now
    db = SessionLocal()
    try:
        waiting = (
            db.query(PipelineRun.id)
            .filter(PipelineRun.tool == "trainer", PipelineRun.status == "queued", PipelineRun.worker_id == WAITING)
            .first()
        )
    finally:
        db.close()
    return pump_queue() if waiting else []


def pump_queue(limit: int = 20, failures: Optional[Dict[str, str]] = None) -> List[str]:
    """Start waiting runs, oldest first, while capacity allows. Safe to call from any instance."""
    started: List[str] = []
    for _ in range(limit):
        with _queue_lock:
            db = SessionLocal()
            picked: Optional[str] = None
            try:
                _serialized(db)
                for rid, uid, acc in _waiting_in_order(db):
                    blocker = _capacity_blocker(db, str(uid), acc)
                    if blocker == "global":
                        break
                    if blocker:
                        continue
                    flipped = (
                        db.query(PipelineRun)
                        .filter(PipelineRun.id == rid, PipelineRun.status == "queued", PipelineRun.worker_id == WAITING)
                        .update({PipelineRun.worker_id: PENDING, PipelineRun.message: "Starting a training machine"}, synchronize_session=False)
                    )
                    if flipped == 1:
                        picked = rid
                        break
                db.commit()
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()
        if picked is None:
            break
        ok, detail = dispatch(picked)
        if ok:
            started.append(picked)
        elif failures is not None:
            failures[picked] = detail
    return started


def queue_status(run_id: str) -> Optional[Dict[str, Any]]:
    """Position among waiting runs (FIFO) and what it waits for. None when the run is not waiting."""
    db = SessionLocal()
    try:
        row = db.get(PipelineRun, run_id)
        if row is None or row.status != "queued" or row.worker_id != WAITING:
            return None
        waiting = _waiting_in_order(db)
        index = next(i for i, (rid, _, _) in enumerate(waiting) if rid == run_id)
        mine = waiting[index][2]
        blocker = _capacity_blocker(db, str(row.user_id), mine)
        # Count only earlier runs that would start before this one when a machine frees up:
        # not those held by their owner's own limit, nor GPU runs held by the GPU pool.
        ahead = 0
        for _rid, uid, acc in waiting[:index]:
            theirs = _capacity_blocker(db, str(uid), acc)
            if theirs == "user" or (theirs == "gpu" and mine != "gpu"):
                continue
            ahead += 1
        return {"position": ahead + 1, "waiting_for": blocker or "capacity", "accelerator": mine}
    finally:
        db.close()


def queue_message(status: Dict[str, Any]) -> str:
    if status["waiting_for"] == "user":
        return "Queued: starts when your running training job finishes"
    ahead = status["position"] - 1
    machine = "GPU machine" if status["waiting_for"] == "gpu" else "training machine"
    if ahead <= 0:
        return f"Queued: next to start when a {machine} frees up"
    return f"Queued: {ahead} run{'s' if ahead != 1 else ''} ahead of yours"


# --- Checkpoints -----------------------------------------------------------------


def store_checkpoint(run_id: str, user_id: str, ckpt_dir, state: Dict[str, Any]) -> None:
    """Upload the checkpoint files (state.json last) and record where they are."""
    from pathlib import Path

    from app.paths import canonical_user_id
    from app.services.durable_outputs import get_artifact_store
    from runners.trainer_checkpoint import checkpoint_files

    store = get_artifact_store()
    uid = canonical_user_id(user_id)
    files = []
    for path in checkpoint_files(Path(ckpt_dir), state):
        uri = store.put_file(f"checkpoints/{uid}/{run_id}/{path.name}", path)
        files.append({"rel": path.name, "uri": uri})
    merge_run_extra(
        run_id,
        {CHECKPOINT_KEY: {"epochs_completed": state["epochs_completed"], "files": files, "saved_at": time.time()}},
    )


def restore_checkpoint(run_id: str, ckpt_dir) -> Optional[int]:
    """Download the recorded checkpoint into ckpt_dir. Returns its epoch count, or None."""
    from pathlib import Path

    from app.services.durable_outputs import _safe_rel, get_artifact_store

    row = _load_row(run_id)
    meta = (row or {}).get("extra", {}).get(CHECKPOINT_KEY)
    if not isinstance(meta, dict) or not meta.get("files"):
        return None
    dest = Path(ckpt_dir)
    store = get_artifact_store()
    try:
        for item in meta["files"]:
            store.materialize(item["uri"], dest / _safe_rel(item["rel"]))
    except Exception:
        logger.exception("Could not restore checkpoint for %s; training restarts from scratch", run_id)
        return None
    return int(meta.get("epochs_completed") or 0) or None


def checkpoint_epochs(row: Dict[str, Any]) -> Optional[int]:
    """Epochs a resume would continue after, or None. A day of margin before the bucket deletes it."""
    meta = row.get("extra", {}).get(CHECKPOINT_KEY)
    if not isinstance(meta, dict) or not meta.get("files"):
        return None
    max_age = (app_config.TRAINER_CHECKPOINT_RETENTION_DAYS - 1) * 86400
    if time.time() - float(meta.get("saved_at") or 0) > max_age:
        return None
    return int(meta.get("epochs_completed") or 0) or None


def requeue_for_resume(run_id: str) -> Tuple[bool, str]:
    """failed/cancelled -> queued with the same immutable payload, to continue from its checkpoint."""
    row = _load_row(run_id)
    if row is None or not isinstance(row["extra"].get(JOB_KEY), dict):
        return False, "Only cloud training runs can be resumed"
    epochs = checkpoint_epochs(row)
    if not epochs:
        return False, "This run has no saved checkpoint to resume from"
    if row["status"] not in ("failed", "interrupted", "cancelled"):
        return False, "Only a failed or cancelled run can be resumed"
    execution = row["extra"][JOB_KEY].get("execution")
    if execution:
        try:
            ended = get_dispatcher(accelerator_of(row["extra"][JOB_KEY])).finished(execution)
        except Exception:
            ended = None
        if ended is not True:
            # Cancelling is asynchronous: never let a new execution overlap the previous one.
            return False, "The previous training machine is still stopping. Try again in a minute."
    db = SessionLocal()
    try:
        updated = (
            db.query(PipelineRun)
            .filter(PipelineRun.id == run_id, PipelineRun.status.in_(("failed", "interrupted", "cancelled")))
            .update(
                {
                    PipelineRun.status: "queued",
                    PipelineRun.worker_id: WAITING,
                    PipelineRun.stage: "queued",
                    PipelineRun.progress: 0.0,
                    PipelineRun.message: f"Resuming from the checkpoint after epoch {epochs}",
                    PipelineRun.error_summary: None,
                    PipelineRun.finished_at: None,
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
        return False, "Run changed state; refresh and try again"
    job = dict(row["extra"][JOB_KEY])
    job.pop("execution", None)
    job["resume_requested_at"] = time.time()
    job["resumes"] = int(job.get("resumes") or 0) + 1
    merge_run_extra(run_id, {JOB_KEY: job})
    ok, detail = submit(run_id, row["user_id"])
    return ok, detail


def cancel_execution(run_id: str) -> None:
    """Best effort. The worker also stops at the next epoch once the row is cancelled."""
    job = load_job(run_id) or {}
    execution = job.get("execution")
    if not execution:
        return
    try:
        get_dispatcher(accelerator_of(job)).cancel(execution)
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
            "worker_id": row.worker_id,
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


def claim(run_id: str, worker_id: str, retry_of: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """queued → running for exactly one worker. Anything else returns None (nothing to do).

    retry_of: worker-id prefix ("job/<execution>/<task>/") of an earlier attempt of this same
    Cloud Run task. A retry may take over a running row only from its own previous attempt.
    """
    from sqlalchemy import and_, or_

    # A waiting run was never dispatched; only the execution started for it may claim it.
    condition = and_(PipelineRun.status == "queued", PipelineRun.worker_id != WAITING)
    if retry_of:
        condition = or_(condition, and_(PipelineRun.status == "running", PipelineRun.worker_id.like(f"{retry_of}%")))
    db = SessionLocal()
    try:
        updated = (
            db.query(PipelineRun)
            .filter(PipelineRun.id == run_id, condition)
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
    return {"user_id": row["user_id"], "has_checkpoint": CHECKPOINT_KEY in row["extra"], **job}


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
        # Only the data-ready event carries train_samples; epoch events also carry "epochs".
        if data.get("train_samples") is not None:
            split = {k: data[k] for k in _SPLIT_KEYS if data.get(k) is not None}
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


def public_failure_message(exc: BaseException) -> str:
    """What the user sees for a failed run: no stack trace, paths or database internals.

    The full exception is logged server-side by the caller.
    """
    from app.services.backtest_api import strip_paths

    name = type(exc).__name__
    module = type(exc).__module__ or ""
    if isinstance(exc, MemoryError) or name == "ResourceExhaustedError":
        return "Training failed: the training machine ran out of memory. A smaller image size or batch size needs less."
    if module.startswith(("sqlalchemy", "psycopg")):
        return "Training failed: the database could not be reached while saving progress. Please start the run again."
    lines = str(exc).strip().splitlines()
    detail = strip_paths(lines[0] if lines else "")[:300]
    return f"Training failed: {detail}" if detail else f"Training failed ({name})."


def save_worker_timings(run_id: str, timings: Dict[str, Any]) -> None:
    """Telemetry only: a failed write must never fail the run."""
    try:
        merge_run_extra(run_id, {WORKER_TIMINGS_KEY: _json_safe(timings)})
    except Exception:
        logger.warning("Could not record worker timings for %s", run_id)


def finish_failed(run_id: str, message: str) -> None:
    update_pipeline_run_state(run_id, status="failed", progress=0.0, stage="error", message=message[:500])


def finish_cancelled(run_id: str) -> None:
    update_pipeline_run_state(run_id, status="cancelled", progress=0.0, stage="cancelled", message="Training cancelled")


class DbCancelFlag:
    """cancel_event for run_trainer. Reads the row status at most every interval_s.

    With ``owner`` it is also set once another worker holds the run (``superseded``): that worker
    must then stop without writing anything to the run."""

    def __init__(self, run_id: str, interval_s: float = 5.0, owner: Optional[str] = None) -> None:
        self.run_id = run_id
        self.interval_s = interval_s
        self.owner = owner
        self.superseded = False
        self._checked: Optional[float] = None
        self._set = False

    def is_set(self, fresh: bool = False) -> bool:
        if self._set:
            return True
        now = time.monotonic()
        if not fresh and self._checked is not None and now - self._checked < self.interval_s:
            return False
        self._checked = now
        row = _load_row(self.run_id)
        self.superseded = bool(row and self.owner and row.get("worker_id") != self.owner)
        self._set = row is None or row["status"] == "cancelled" or self.superseded
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
        ended = get_dispatcher(accelerator_of(row["extra"].get(JOB_KEY))).finished(execution)
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
            queue = queue_status(run_id) if row["extra"].get(JOB_KEY) and row.get("worker_id") == WAITING else None
            if queue:
                progress = {"phase": "queued", "percent": 0, "message": queue_message(queue), "queue": queue}
            else:
                progress = {"phase": "queued", "percent": 0, "message": row["message"] or "Waiting for a training machine…"}
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
        "worker_timings": row["extra"].get(WORKER_TIMINGS_KEY) or {},
        # A failed or cancelled run with a checkpoint can continue instead of starting over.
        "resumable_from_epoch": checkpoint_epochs(row) if status in ("failed", "interrupted", "cancelled") else None,
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
