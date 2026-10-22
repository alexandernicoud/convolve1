"""Lab jobs: disk-persisted status and results, executed by a bounded in-process worker.

Layout under a session directory::

    lab/session.json                 owner, model, dataset, fingerprint
    lab/jobs/<job_id>/params.json    what was requested (kind, params, model identity)
    lab/jobs/<job_id>/status.json    queued | running | succeeded | failed | cancelled (+ progress)
    lab/jobs/<job_id>/result.json    the experiment output (only when succeeded)

Disk is the source of truth. A job whose status says queued/running but that no live worker owns
(e.g. after a server restart) is reported as ``interrupted``; it is never resumed silently.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional

import numpy as np

from .experiments import EXPERIMENTS, Ctx, JobCancelled

logger = logging.getLogger(__name__)

JOB_ID_RE = re.compile(r"^job_[a-f0-9]{12}$")
SESSION_ID_RE = re.compile(r"^lab_\d{8}_\d{6}_[a-f0-9]{6}$")
MAX_PENDING_PER_SESSION = 3
ACTIVE = ("queued", "running")

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="cnn-lab")
_live: Dict[str, threading.Event] = {}
_live_lock = threading.Lock()


def new_session_id() -> str:
    return time.strftime("lab_%Y%m%d_%H%M%S_") + secrets.token_hex(3)


def new_job_id() -> str:
    return "job_" + secrets.token_hex(6)


def valid_job_id(job_id: str) -> bool:
    return bool(JOB_ID_RE.fullmatch(str(job_id or "")))


def valid_session_id(session_id: str) -> bool:
    return bool(SESSION_ID_RE.fullmatch(str(session_id or "")))


def sanitize(obj: Any) -> Any:
    """JSON-safe copy: numpy → Python, non-finite floats → None (never NaN or 0)."""
    if isinstance(obj, dict):
        return {str(k): sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [sanitize(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return sanitize(obj.tolist())
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        f = float(obj)
        return f if math.isfinite(f) else None
    return obj


def write_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp-{os.getpid()}-{threading.get_ident()}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(sanitize(data), f, allow_nan=False, separators=(",", ":"))
    os.replace(tmp, path)


def read_json(path: str) -> Optional[Dict[str, Any]]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def lab_dir(session_dir: str) -> str:
    return os.path.join(session_dir, "lab")


def job_dir(session_dir: str, job_id: str) -> str:
    if not valid_job_id(job_id):
        raise ValueError("invalid job id")
    return os.path.join(lab_dir(session_dir), "jobs", job_id)


def read_session(session_dir: str) -> Optional[Dict[str, Any]]:
    return read_json(os.path.join(lab_dir(session_dir), "session.json"))


def write_session(session_dir: str, meta: Dict[str, Any]) -> None:
    write_json(os.path.join(lab_dir(session_dir), "session.json"), meta)


def is_live(job_id: str) -> bool:
    with _live_lock:
        return job_id in _live


def job_status(session_dir: str, job_id: str) -> Optional[Dict[str, Any]]:
    d = job_dir(session_dir, job_id)
    params = read_json(os.path.join(d, "params.json"))
    if params is None:
        return None
    status = read_json(os.path.join(d, "status.json")) or {"status": "interrupted"}
    if status.get("status") in ACTIVE and not is_live(job_id):
        status = {**status, "status": "interrupted", "message": "The server stopped while this job was running. Start it again to recompute."}
    return {
        "job_id": job_id,
        "kind": params.get("kind"),
        "params": params.get("params"),
        "created_at": params.get("created_at"),
        "has_result": os.path.isfile(os.path.join(d, "result.json")),
        **status,
    }


def list_jobs(session_dir: str) -> List[Dict[str, Any]]:
    root = os.path.join(lab_dir(session_dir), "jobs")
    if not os.path.isdir(root):
        return []
    out = []
    for name in os.listdir(root):
        if valid_job_id(name):
            st = job_status(session_dir, name)
            if st:
                out.append(st)
    out.sort(key=lambda j: j.get("created_at") or 0, reverse=True)
    return out


def read_result(session_dir: str, job_id: str) -> Optional[Dict[str, Any]]:
    return read_json(os.path.join(job_dir(session_dir, job_id), "result.json"))


def cancel(job_id: str) -> bool:
    with _live_lock:
        ev = _live.get(job_id)
    if ev is None:
        return False
    ev.set()
    return True


def submit(
    session_dir: str,
    kind: str,
    params: Dict[str, Any],
    identity: Dict[str, Any],
    build_ctx: Callable[[], Ctx],
    on_finish: Callable[[str, Optional[str]], None],
) -> str:
    """Queue an experiment. ``on_finish(status, message)`` runs on the worker after the job ends."""
    if kind not in EXPERIMENTS:
        raise ValueError(f"unknown experiment {kind}")
    pending = [j for j in list_jobs(session_dir) if j.get("status") in ACTIVE]
    if len(pending) >= MAX_PENDING_PER_SESSION:
        raise RuntimeError("Too many experiments queued in this session; wait for one to finish")
    job_id = new_job_id()
    d = job_dir(session_dir, job_id)
    write_json(os.path.join(d, "params.json"), {"kind": kind, "params": params, "created_at": time.time(), **identity})
    write_json(os.path.join(d, "status.json"), {"status": "queued", "progress": None, "message": "Waiting for the lab worker"})
    cancel_ev = threading.Event()
    with _live_lock:
        _live[job_id] = cancel_ev

    def run() -> None:
        status_path = os.path.join(d, "status.json")
        started = time.time()
        last = [0.0]

        def report(frac: float, msg: str) -> None:
            now = time.time()
            if now - last[0] < 0.5:
                return
            last[0] = now
            write_json(status_path, {"status": "running", "progress": max(0.0, min(1.0, float(frac))), "message": msg, "started_at": started})

        final, message = "failed", None
        try:
            if cancel_ev.is_set():
                raise JobCancelled()
            write_json(status_path, {"status": "running", "progress": None, "message": "Loading model and dataset", "started_at": started})
            ctx = build_ctx()
            ctx.report = report
            ctx.cancelled = cancel_ev.is_set
            result = EXPERIMENTS[kind](ctx, params)
            result["job_id"] = job_id
            result["identity"] = identity
            result["seconds"] = round(time.time() - started, 2)
            write_json(os.path.join(d, "result.json"), result)
            final, message = "succeeded", None
            write_json(status_path, {"status": "succeeded", "progress": 1.0, "message": "Done", "started_at": started, "finished_at": time.time()})
        except JobCancelled:
            final, message = "cancelled", "Cancelled"
            write_json(status_path, {"status": "cancelled", "progress": None, "message": message, "started_at": started, "finished_at": time.time()})
        except ValueError as exc:
            final, message = "failed", str(exc)[:500]
            write_json(status_path, {"status": "failed", "progress": None, "message": message, "started_at": started, "finished_at": time.time()})
        except Exception:
            logger.exception("Lab job %s (%s) failed", job_id, kind)
            final, message = "failed", "The experiment failed unexpectedly. Details are in the server log."
            write_json(status_path, {"status": "failed", "progress": None, "message": message, "started_at": started, "finished_at": time.time()})
        finally:
            with _live_lock:
                _live.pop(job_id, None)
            try:
                on_finish(final, message)
            except Exception:
                logger.exception("Lab job %s finish hook failed", job_id)

    _executor.submit(run)
    return job_id
