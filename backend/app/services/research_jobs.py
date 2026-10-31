"""Generator, Labeling Optimizer and test-data runs outside the API process.

The API records the run (status queued) with its request in
pipeline_runs.extra_json["research_job"] and enqueues it. pump_queue() dispatches waiting runs
oldest first while the global and per-user caps allow; waiting -> pending is a conditional UPDATE
under the queue lock, so a run is dispatched once. The worker (app.jobs.research_worker) claims
the row with a conditional queued -> running UPDATE, runs the unchanged tool function, mirrors the
tool's progress.json and a heartbeat into the row, and stops the tool when the row is cancelled.

Everything a status request needs is in the row, so any API instance can answer it, and an API
restart does not touch a running worker. A worker that dies without reporting is failed by
reconcile() once its heartbeat is stale and its execution has ended, which releases its slot.

Same pattern and queue states as app.services.trainer_jobs, with separate caps: research runs
are short CPU jobs on a smaller machine than training.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from app import config as app_config
from app.db import SessionLocal
from app.models import PipelineRun
from app.ownership import TERMINAL_RUN_STATUSES, _dt_to_epoch, _load_extra, update_pipeline_run_state
from app.services import trainer_jobs

logger = logging.getLogger("app.research_jobs")

TOOLS = ("training-chart-generator", "labeling-optimizer", "testdata")
JOB_KEY = "research_job"
PROGRESS_KEY = "research_progress"
HEARTBEAT_KEY = "research_heartbeat"
QUEUE_KEY = "research_queue"
FINGERPRINT_KEY = "research_fingerprint"
WAITING = trainer_jobs.WAITING
PENDING = trainer_jobs.PENDING
RUN_ID_ENV = trainer_jobs.RUN_ID_ENV
_QUEUE_LOCK_KEY = 724_461_002
_queue_lock = threading.Lock()
_BACKEND_DIR = Path(__file__).resolve().parents[2]

# Tools whose runs count against RESEARCH_MAX_RUNS_PER_DAY.
DAILY_LIMITED_TOOLS = frozenset(TOOLS + ("trainer", "backtester", "analysis"))
# Tools that still compute inside the API process: their concurrent runs are capped there.
INPROCESS_TOOLS = frozenset(TOOLS + ("backtester", "analysis"))
# An in-process row this quiet belongs to a process that is gone; it no longer holds a slot.
_INPROCESS_SLOT_SECONDS = 2 * 3600

# Run ids this process is executing as a worker; their local progress.json is authoritative.
_executing: Set[str] = set()


def enabled() -> bool:
    return app_config.RESEARCH_EXECUTION != "inprocess"


class AdmissionError(Exception):
    def __init__(self, status_code: int, detail: Dict[str, Any]) -> None:
        super().__init__(detail.get("message", ""))
        self.status_code = status_code
        self.detail = detail


# --- Dispatch -------------------------------------------------------------------


class LocalProcessDispatcher:
    """One detached worker process per run on this machine, at lower CPU priority.

    The worker runs in its own session, so restarting the API (or uvicorn --reload) leaves it
    running. Execution names are local/<host>/<pid>; another host cannot inspect them.
    """

    def __init__(self) -> None:
        self._children: Dict[int, subprocess.Popen] = {}
        self._lock = threading.Lock()

    def run(self, run_id: str) -> str:
        from app.paths import runs_root

        log_dir = runs_root() / "_worker_logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        env = dict(os.environ)
        env[RUN_ID_ENV] = run_id
        nice = app_config.RESEARCH_WORKER_NICE

        def _lower_priority() -> None:  # runs in the child before exec
            # Absolute, not relative: a worker that starts the next run must not compound it.
            current = os.nice(0)
            if nice > current:
                os.nice(nice - current)

        with open(log_dir / f"{run_id}.log", "ab") as log:
            proc = subprocess.Popen(
                [sys.executable, "-m", "app.jobs.research_worker", run_id],
                cwd=str(_BACKEND_DIR),
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                preexec_fn=_lower_priority,
            )
        with self._lock:
            self._children[proc.pid] = proc
        return f"local/{socket.gethostname()}/{proc.pid}"

    def _pid(self, execution: str) -> Optional[int]:
        parts = execution.split("/")
        if len(parts) != 3 or parts[0] != "local" or parts[1] != socket.gethostname():
            return None
        try:
            return int(parts[2])
        except ValueError:
            return None

    def cancel(self, execution: str) -> None:
        pid = self._pid(execution)
        if pid is None:
            return
        try:
            os.killpg(pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass

    def finished(self, execution: str) -> Optional[bool]:
        pid = self._pid(execution)
        if pid is None:
            return None
        with self._lock:
            child = self._children.get(pid)
            if child is not None:
                if child.poll() is None:
                    return False
                self._children.pop(pid, None)
                return True
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        except PermissionError:
            return False
        return False

    def reap(self) -> None:
        with self._lock:
            for pid, child in list(self._children.items()):
                if child.poll() is not None:
                    self._children.pop(pid, None)


_dispatcher: Optional[Any] = None
_dispatcher_override: Optional[Any] = None


def set_dispatcher(dispatcher: Optional[Any]) -> None:
    """Tests inject a dispatcher. None restores the configured one."""
    global _dispatcher_override
    _dispatcher_override = dispatcher


def get_dispatcher():
    global _dispatcher
    if _dispatcher_override is not None:
        return _dispatcher_override
    if _dispatcher is None:
        if app_config.RESEARCH_EXECUTION == "cloud_run_job":
            _dispatcher = trainer_jobs.CloudRunJobsDispatcher(
                app_config.RESEARCH_JOB_PROJECT, app_config.RESEARCH_JOB_REGION, app_config.RESEARCH_JOB_NAME
            )
        else:
            _dispatcher = LocalProcessDispatcher()
    return _dispatcher


def dispatch(run_id: str) -> Tuple[bool, str]:
    """Start the execution. On failure the run is failed, never left pending."""
    try:
        execution = get_dispatcher().run(run_id)
    except Exception as exc:
        logger.exception("Could not start research worker for %s", run_id)
        message = f"Could not start a worker: {exc}"[:500]
        update_pipeline_run_state(run_id, status="failed", progress=0.0, stage="error", message=message)
        return False, message
    _patch_extra(run_id, lambda extra: extra[JOB_KEY].update(execution=execution, dispatched_at=time.time()))
    return True, execution


# --- Row access -------------------------------------------------------------------


def _uid(user_id: str):
    import uuid as _uuid

    return _uuid.UUID(str(user_id))


def _serialized(db) -> None:
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        from sqlalchemy import text

        db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _QUEUE_LOCK_KEY})


def _patch_extra(run_id: str, mutate, *, only_active: bool = False) -> bool:
    """Read-modify-write of extra_json under a row lock (Postgres), so the API and the worker
    never overwrite each other's keys. False when the row is missing (or terminal with only_active)."""
    db = SessionLocal()
    try:
        q = db.query(PipelineRun).filter(PipelineRun.id == run_id)
        if db.bind is not None and db.bind.dialect.name == "postgresql":
            q = q.with_for_update()
        row = q.first()
        if row is None or (only_active and row.status in TERMINAL_RUN_STATUSES):
            db.rollback()
            return False
        extra = _load_extra(row.extra_json)
        extra.setdefault(JOB_KEY, {})
        result = mutate(extra)
        row.extra_json = json.dumps(extra)
        if isinstance(result, dict):
            for key, value in result.items():
                setattr(row, key, value)
        db.add(row)
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def load_row(run_id: str) -> Optional[Dict[str, Any]]:
    row = trainer_jobs._load_row(run_id)
    if row is None or not isinstance(row["extra"].get(JOB_KEY), dict):
        return None
    return row


def is_research_run(run_id: str) -> bool:
    return enabled() and load_row(run_id) is not None


# --- Admission ------------------------------------------------------------------


def fingerprint(tool: str, payload: Dict[str, Any]) -> str:
    """Same tool and identical settings: a double submit, not a new experiment."""
    canonical = json.dumps({"tool": tool, "payload": payload}, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _active_research(query):
    """Rows holding (or about to hold) a worker: dispatched and not finished."""
    return query.filter(
        PipelineRun.tool.in_(TOOLS),
        PipelineRun.status.in_(("queued", "running")),
        PipelineRun.worker_id.like("job/%"),
        PipelineRun.worker_id != WAITING,
    )


def _duplicate_of(db, user_id: str, tool: str, fp: str, exclude: Optional[str] = None) -> Optional[str]:
    rows = (
        db.query(PipelineRun.id, PipelineRun.extra_json, PipelineRun.created_at)
        .filter(
            PipelineRun.user_id == _uid(user_id),
            PipelineRun.tool == tool,
            PipelineRun.status.in_(("queued", "running")),
        )
        .order_by(PipelineRun.created_at.asc(), PipelineRun.id.asc())
        .all()
    )
    for rid, extra, _ in rows:
        if rid != exclude and _load_extra(extra).get(FINGERPRINT_KEY) == fp:
            return rid
    return None


def check_daily_limit(user_id: Optional[str], tool: str) -> None:
    """Abuse protection for every compute tool, in every execution mode."""
    cap = app_config.RESEARCH_MAX_RUNS_PER_DAY
    if not cap or not user_id or tool not in DAILY_LIMITED_TOOLS:
        return
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    db = SessionLocal()
    try:
        started = (
            db.query(PipelineRun)
            .filter(
                PipelineRun.user_id == _uid(user_id),
                PipelineRun.tool.in_(DAILY_LIMITED_TOOLS),
                PipelineRun.created_at >= since,
            )
            .count()
        )
    finally:
        db.close()
    if started >= cap:
        raise AdmissionError(
            429,
            {
                "code": "daily_limit",
                "message": f"You have started {started} runs in the last 24 hours, the beta limit. Try again later.",
                "limit": cap,
            },
        )


def check_inprocess_capacity(user_id: Optional[str], tool: str) -> None:
    """Runs that compute in the API process are refused, not queued, over the caps."""
    if tool not in INPROCESS_TOOLS or (enabled() and tool in TOOLS):
        return
    if not app_config.INPROCESS_MAX_ACTIVE_RUNS and not app_config.INPROCESS_MAX_ACTIVE_RUNS_PER_USER:
        return
    from sqlalchemy import or_

    since = datetime.now(timezone.utc) - timedelta(seconds=_INPROCESS_SLOT_SECONDS)
    db = SessionLocal()
    try:
        base = db.query(PipelineRun).filter(
            PipelineRun.tool.in_(INPROCESS_TOOLS),
            PipelineRun.status == "running",
            PipelineRun.updated_at >= since,
            or_(PipelineRun.worker_id.is_(None), ~PipelineRun.worker_id.like("job/%")),
        )
        global_cap = app_config.INPROCESS_MAX_ACTIVE_RUNS
        if global_cap and base.count() >= global_cap:
            raise AdmissionError(
                503,
                {"code": "busy", "message": "All research workers are busy. Please try again in a few minutes."},
            )
        user_cap = app_config.INPROCESS_MAX_ACTIVE_RUNS_PER_USER
        if user_cap and user_id:
            mine = base.filter(PipelineRun.user_id == _uid(user_id)).count()
            if mine >= user_cap:
                raise AdmissionError(
                    429,
                    {
                        "code": "too_many_active",
                        "message": "You already have a run in progress. Start another one when it has finished.",
                        "limit": user_cap,
                    },
                )
    finally:
        db.close()


def check_admission(user_id: Optional[str], tool: str, fp: str) -> None:
    """Before the run is registered: duplicate and queue depth. Raises AdmissionError."""
    if not user_id:
        return
    db = SessionLocal()
    try:
        dup = _duplicate_of(db, user_id, tool, fp)
        if dup:
            raise AdmissionError(
                409,
                {
                    "code": "duplicate_submission",
                    "message": "An identical run is already queued or running; it was not started again.",
                    "run_id": dup,
                },
            )
        cap = app_config.RESEARCH_MAX_QUEUED_JOBS_PER_USER
        if cap:
            waiting = (
                db.query(PipelineRun)
                .filter(
                    PipelineRun.tool.in_(TOOLS),
                    PipelineRun.status == "queued",
                    PipelineRun.worker_id == WAITING,
                    PipelineRun.user_id == _uid(user_id),
                )
                .count()
            )
            if waiting >= cap:
                raise AdmissionError(
                    429,
                    {
                        "code": "queue_full",
                        "message": f"You already have {waiting} runs waiting. Start more when one has begun.",
                        "limit": cap,
                    },
                )
    finally:
        db.close()


# --- Queue ------------------------------------------------------------------------


def save_payload(run_id: str, tool: str, payload: Dict[str, Any], fp: str) -> None:
    def mutate(extra: Dict[str, Any]) -> None:
        extra[JOB_KEY] = {"tool": tool, "payload": payload, "requested_at": time.time()}
        extra[FINGERPRINT_KEY] = fp

    _patch_extra(run_id, mutate)


def submit(run_id: str) -> Tuple[bool, str]:
    """Enqueue and start what capacity allows. (False, message) when starting it failed (the run
    is then failed). AdmissionError when an identical run submitted at the same moment won the race."""
    duplicate: Optional[str] = None
    with _queue_lock:
        db = SessionLocal()
        try:
            _serialized(db)
            row = db.get(PipelineRun, run_id)
            if row is not None and row.status == "queued":
                extra = _load_extra(row.extra_json)
                duplicate = _duplicate_of(db, str(row.user_id), row.tool, extra.get(FINGERPRINT_KEY) or "", exclude=run_id)
                if duplicate is None or not extra.get(FINGERPRINT_KEY):
                    duplicate = None
                    extra[QUEUE_KEY] = {"queued_at": time.time()}
                    row.extra_json = json.dumps(extra)
                    row.worker_id = WAITING
                    row.stage = "queued"
                    row.message = "Waiting for a research worker"
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
    if duplicate:
        update_pipeline_run_state(
            run_id, status="cancelled", progress=0.0, stage="cancelled", message=f"Duplicate of run {duplicate}"
        )
        raise AdmissionError(
            409,
            {
                "code": "duplicate_submission",
                "message": "An identical run is already queued or running; it was not started again.",
                "run_id": duplicate,
            },
        )
    failures: Dict[str, str] = {}
    started = pump_queue(failures=failures)
    if run_id in failures:
        return False, failures[run_id]
    return True, "started" if run_id in started else "queued"


def _waiting_in_order(db) -> List[Tuple[str, Any]]:
    rows = (
        db.query(PipelineRun.id, PipelineRun.user_id, PipelineRun.created_at, PipelineRun.extra_json)
        .filter(PipelineRun.tool.in_(TOOLS), PipelineRun.status == "queued", PipelineRun.worker_id == WAITING)
        .all()
    )
    items = []
    for r in rows:
        queued_at = (_load_extra(r.extra_json).get(QUEUE_KEY) or {}).get("queued_at")
        items.append(((float(queued_at) if queued_at else _dt_to_epoch(r.created_at), r.id), r.id, r.user_id))
    return [(rid, uid) for _, rid, uid in sorted(items)]


def _capacity_blocker(db, user_id: str) -> Optional[str]:
    global_cap = app_config.RESEARCH_MAX_ACTIVE_JOBS
    if global_cap and _active_research(db.query(PipelineRun)).count() >= global_cap:
        return "global"
    user_cap = app_config.RESEARCH_MAX_ACTIVE_JOBS_PER_USER
    if user_cap and _active_research(db.query(PipelineRun)).filter(PipelineRun.user_id == _uid(user_id)).count() >= user_cap:
        return "user"
    return None


def pump_queue(limit: int = 20, failures: Optional[Dict[str, str]] = None) -> List[str]:
    """Start waiting runs, oldest first, while capacity allows. Safe from any process."""
    started: List[str] = []
    for _ in range(limit):
        picked: Optional[str] = None
        with _queue_lock:
            db = SessionLocal()
            try:
                _serialized(db)
                for rid, uid in _waiting_in_order(db):
                    blocker = _capacity_blocker(db, str(uid))
                    if blocker == "global":
                        break
                    if blocker:
                        continue
                    flipped = (
                        db.query(PipelineRun)
                        .filter(PipelineRun.id == rid, PipelineRun.status == "queued", PipelineRun.worker_id == WAITING)
                        .update(
                            {PipelineRun.worker_id: PENDING, PipelineRun.message: "Starting a research worker"},
                            synchronize_session=False,
                        )
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


_last_poll_pump = 0.0
POLL_PUMP_INTERVAL_S = 5.0


def pump_queue_if_due() -> List[str]:
    """For status polls: reconcile and start waiting runs at most every few seconds per process."""
    global _last_poll_pump
    if not enabled():
        return []
    now = time.monotonic()
    if now - _last_poll_pump < POLL_PUMP_INTERVAL_S:
        return []
    _last_poll_pump = now
    try:
        reconcile_all()
        return pump_queue()
    except Exception:
        logger.exception("Research queue pump failed")
        return []


def queue_position(run_id: str) -> Optional[Dict[str, Any]]:
    db = SessionLocal()
    try:
        row = db.get(PipelineRun, run_id)
        if row is None or row.status != "queued" or row.worker_id != WAITING:
            return None
        waiting = _waiting_in_order(db)
        index = next((i for i, (rid, _) in enumerate(waiting) if rid == run_id), None)
        if index is None:
            return None
        blocker = _capacity_blocker(db, str(row.user_id))
        ahead = sum(1 for _rid, uid in waiting[:index] if _capacity_blocker(db, str(uid)) != "user")
        return {"position": ahead + 1, "waiting_for": blocker or "capacity"}
    finally:
        db.close()


def queue_message(queue: Optional[Dict[str, Any]]) -> str:
    if not queue:
        return "Queued: waiting for a research worker"
    if queue["waiting_for"] == "user":
        return "Queued: starts when your current run finishes"
    ahead = queue["position"] - 1
    if ahead <= 0:
        return "Queued: next to start"
    return f"Queued: {ahead} run{'s' if ahead != 1 else ''} ahead of yours"


def cancel(run_id: str) -> None:
    """After the row is cancelled: stop an execution that has not claimed it yet, free the slot.
    A running worker sees the cancelled row within seconds and stops its tool itself."""
    row = load_row(run_id)
    if row is None:
        return
    job = row["extra"].get(JOB_KEY) or {}
    if row.get("worker_id") == PENDING and job.get("execution"):
        try:
            get_dispatcher().cancel(job["execution"])
        except Exception:
            logger.exception("Could not cancel research execution for %s", run_id)
    try:
        pump_queue()
    except Exception:
        logger.exception("Research queue pump after cancel failed")


# --- Failure recovery -------------------------------------------------------------

_last_execution_check: Dict[str, float] = {}


def reconcile(row: Dict[str, Any]) -> Dict[str, Any]:
    """Fail a dispatched run whose worker is gone, so it stops holding a slot."""
    if row["status"] in TERMINAL_RUN_STATUSES or row.get("worker_id") == WAITING:
        return row
    job = row["extra"].get(JOB_KEY) or {}
    now = time.time()
    stale = app_config.RESEARCH_JOB_STALE_SECONDS
    if row.get("worker_id") == PENDING:
        # Cloud Run needs time to schedule a job and pull the image before the worker claims.
        since = float(job.get("dispatched_at") or row["updated_at"] or now)
        limit = max(300, 3 * stale)
        message = "The research worker did not start. Please start the run again."
    else:
        since = float(row["extra"].get(HEARTBEAT_KEY) or row["updated_at"] or now)
        limit = stale
        message = "The research worker stopped without reporting a result (crash, out of memory or timeout)."
    quiet = now - since
    if quiet < limit:
        return row
    rid = row["id"]
    if now - _last_execution_check.get(rid, 0.0) < 15:
        return row
    _last_execution_check[rid] = now
    execution = job.get("execution")
    ended: Optional[bool] = None
    if execution:
        try:
            ended = get_dispatcher().finished(execution)
        except Exception:
            logger.exception("Could not read research execution for %s", rid)
    if ended or (ended is None and quiet >= 3 * limit):
        current = trainer_jobs._load_row(rid)
        if current is None or current["status"] in TERMINAL_RUN_STATUSES:
            return current or row
        update_pipeline_run_state(rid, status="failed", progress=0.0, stage="error", message=message)
        _last_execution_check.pop(rid, None)
        if execution:
            try:
                get_dispatcher().cancel(execution)
            except Exception:
                logger.warning("Could not stop execution of failed run %s", rid)
            _stop_orphaned_tool(execution, job.get("tool_pid"))
        return trainer_jobs._load_row(rid) or row
    return row


_TOOL_SCRIPTS = ("1.3_Adj_TrL.py", "7.2.py", "1.4_Adj_testL.py")


def _stop_orphaned_tool(execution: str, tool_pid: Any) -> None:
    """A local worker killed outright leaves its tool script (own session) running. Stop it, but
    only on this host and only while that pid is still one of the pipeline scripts."""
    if not str(execution).startswith(f"local/{socket.gethostname()}/") or not isinstance(tool_pid, int):
        return
    try:
        command = subprocess.run(["ps", "-o", "command=", "-p", str(tool_pid)], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return
    if not any(script in command for script in _TOOL_SCRIPTS):
        return
    try:
        os.killpg(tool_pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass


def reconcile_all() -> int:
    """Startup and periodic: check every dispatched, unfinished research run."""
    db = SessionLocal()
    try:
        ids = [r[0] for r in _active_research(db.query(PipelineRun.id)).all()]
    finally:
        db.close()
    failed = 0
    for rid in ids:
        row = load_row(rid)
        if row is not None and reconcile(row)["status"] == "failed":
            failed += 1
    reap = getattr(get_dispatcher(), "reap", None)
    if reap:
        reap()
    return failed


# --- What status requests see -------------------------------------------------------


def progress_snapshot(run_id: str) -> Optional[Dict[str, Any]]:
    """progress.json-shaped dict for a research run executed elsewhere; None otherwise.

    The worker's own process reads its local progress.json (None here), as does inprocess mode.
    """
    if not enabled() or run_id in _executing:
        return None
    if load_row(run_id) is None:
        return None
    pump_queue_if_due()
    row = load_row(run_id)
    if row is None:
        return None
    row = reconcile(row)
    status = row["status"]
    mirrored = row["extra"].get(PROGRESS_KEY)
    mirrored = dict(mirrored) if isinstance(mirrored, dict) else {}
    started = float((row["extra"].get(JOB_KEY) or {}).get("claimed_at") or 0)
    elapsed = max(0.0, (row.get("finished_at") or time.time()) - started) if started else 0.0
    base = {"elapsed_s": round(elapsed, 1), "step": None, "total_steps": None}
    if status == "succeeded":
        return {**base, **mirrored, "phase": "done", "percent": 100, "status": status}
    if status in ("failed", "interrupted"):
        error = row.get("error_summary") or row["message"] or "Run failed"
        return {**base, "phase": "error", "percent": 0, "error_message": error, "status": status}
    if status == "cancelled":
        return {**base, "phase": "cancelled", "percent": 0, "error_message": row["message"] or "Cancelled", "status": status}
    if status == "queued":
        if row.get("worker_id") == WAITING:
            phase = queue_message(queue_position(run_id))
        else:
            phase = "Starting a research worker"
        return {**base, "phase": phase, "percent": 0, "status": status, "queued": True}
    if not mirrored:
        mirrored = {"phase": row["stage"] or "starting", "percent": round(row["progress"] * 100, 1)}
    return {**base, **mirrored, "status": status}


def status_view(run_id: str) -> Optional[Dict[str, Any]]:
    """status / progress (0..1) / stage / message for status endpoints of research runs."""
    snap = progress_snapshot(run_id)
    if snap is None:
        return None
    pct = float(snap.get("percent") or 0.0)
    stage = str(snap.get("phase") or "")
    message = snap.get("message") or snap.get("error_message") or stage
    return {
        "status": "running" if snap["status"] == "queued" else snap["status"],
        "progress": pct / 100.0 if pct > 1.0 else pct,
        "stage": "queued" if snap.get("queued") else stage,
        "message": str(message),
    }


# --- Worker side --------------------------------------------------------------------


def claim(run_id: str, worker_id: str, retry_of: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """queued (dispatched) -> running for exactly one worker. None: nothing to do.

    retry_of: worker-id prefix of an earlier attempt of the same Cloud Run task, which may take
    over a running row only from that attempt (the tool then starts over).
    """
    from sqlalchemy import and_, or_

    condition = and_(PipelineRun.status == "queued", PipelineRun.worker_id != WAITING)
    if retry_of:
        condition = or_(condition, and_(PipelineRun.status == "running", PipelineRun.worker_id.like(f"{retry_of}%")))
    db = SessionLocal()
    try:
        updated = (
            db.query(PipelineRun)
            .filter(PipelineRun.id == run_id, PipelineRun.tool.in_(TOOLS), condition)
            .update(
                {
                    PipelineRun.status: "running",
                    PipelineRun.worker_id: worker_id,
                    PipelineRun.stage: "starting",
                    PipelineRun.message: "Research worker started",
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
    now = time.time()

    def mutate(extra: Dict[str, Any]) -> None:
        extra[JOB_KEY]["claimed_at"] = now
        extra[JOB_KEY]["attempts"] = int(extra[JOB_KEY].get("attempts") or 0) + 1
        extra[HEARTBEAT_KEY] = now
        extra.pop(PROGRESS_KEY, None)

    _patch_extra(run_id, mutate)
    row = load_row(run_id)
    if row is None:
        return None
    return {"user_id": row["user_id"], "tool": row["tool"], **row["extra"][JOB_KEY]}


def report(run_id: str, progress: Optional[Dict[str, Any]], tool_pid: Optional[int] = None) -> bool:
    """Heartbeat, plus the tool's latest progress.json when given. Never sets a status."""

    def mutate(extra: Dict[str, Any]):
        extra[HEARTBEAT_KEY] = time.time()
        if tool_pid is not None:
            extra[JOB_KEY]["tool_pid"] = tool_pid
        if progress is None:
            return None
        extra[PROGRESS_KEY] = trainer_jobs._json_safe(progress)
        fields: Dict[str, Any] = {}
        try:
            pct = float(progress.get("percent") or 0.0)
            fields["progress"] = max(0.0, min(1.0, pct / 100.0 if pct > 1.0 else pct))
        except (TypeError, ValueError):
            pass
        if progress.get("phase"):
            fields["stage"] = str(progress["phase"])[:255]
        return fields

    try:
        return _patch_extra(run_id, mutate, only_active=True)
    except Exception:
        logger.exception("Could not record heartbeat for %s", run_id)
        return True
