"""
Worker for one Generator, Labeling Optimizer or test-data run.

    python -m app.jobs.research_worker            # run id from CONVOLVE_RUN_ID
    python -m app.jobs.research_worker RUN_ID

Started by app.services.research_jobs: a Cloud Run Job execution (RESEARCH_EXECUTION=
cloud_run_job) or a detached local process (local_process). The API has recorded the run
(status queued, request in extra_json). This process claims it, runs the same tool function the
API used to run in a background task, mirrors its progress.json and a heartbeat into the row,
and stops the tool when the row is cancelled. The tool itself stores its finals and marks the
run succeeded or failed exactly as before.
"""

from __future__ import annotations

import json
import logging
import os
import signal
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from app.config import RESEARCH_HEARTBEAT_SECONDS, RESEARCH_JOB_MAX_RETRIES, configure_logging
from app.jobs.train_worker import task_attempt, task_prefix

logger = logging.getLogger("app.jobs.research_worker")

_active_run: Optional[str] = None
_PROGRESS_POLL_S = 1.0
_CANCEL_POLL_S = 2.0


def worker_id() -> str:
    prefix = task_prefix()
    if prefix:
        return f"{prefix}{task_attempt()}"
    return f"job/local/{os.getpid()}"


def _write_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _run_generator(main, run_id: str, payload: Dict[str, Any]) -> None:
    run_dir = Path(main.get_run_dir(run_id))
    _write_json(run_dir / "generator_config.json", payload)
    main.run_training_chart_generator(payload, run_id)


def _run_optimizer(main, run_id: str, payload: Dict[str, Any]) -> None:
    main.run_labeling_optimizer(main.RunRequest(**payload), run_id)


def _run_testdata(main, run_id: str, payload: Dict[str, Any]) -> None:
    run_dir = Path(main.get_run_dir(run_id))
    run_dir.mkdir(parents=True, exist_ok=True)
    _write_json(run_dir / "testdata_config.json", payload)
    # update_testdata_progress writes the row only for runs in this process's registry.
    main.testdata_runs[run_id] = {
        "run_dir": run_dir,
        "config": payload,
        "status": "running",
        "progress": {"phase": "starting", "percent": 0.05, "message": "Initializing test data generator..."},
    }

    def progress(phase: str, percent: float, data: Dict[str, Any]) -> None:
        main.update_testdata_progress(run_id, phase, percent, data)

    main.run_testdata_generator(payload, run_dir, progress, run_id)


RUNNERS: Dict[str, Callable[[Any, str, Dict[str, Any]], None]] = {
    "training-chart-generator": _run_generator,
    "labeling-optimizer": _run_optimizer,
    "testdata": _run_testdata,
}


class _Watch(threading.Thread):
    """Mirrors progress.json and a heartbeat into the row; stops the tool once the row is
    cancelled or another worker holds it."""

    def __init__(self, main, run_id: str, me: str) -> None:
        super().__init__(daemon=True, name=f"research-watch-{run_id}")
        from app.services import trainer_jobs

        self.main = main
        self.run_id = run_id
        self.flag = trainer_jobs.DbCancelFlag(run_id, interval_s=_CANCEL_POLL_S, owner=me)
        self.stop_event = threading.Event()
        self.cancelled = False
        self._last: Optional[str] = None
        self._last_beat = 0.0
        self._tool_pid: Optional[int] = None

    def flush(self) -> None:
        from app.services import research_jobs

        path = Path(self.main.get_run_dir(self.run_id)) / "progress.json"
        progress: Optional[Dict[str, Any]] = None
        try:
            raw = path.read_text(encoding="utf-8")
            if raw != self._last:
                parsed = json.loads(raw)
                if isinstance(parsed, dict):
                    progress = parsed
                    self._last = raw
        except (OSError, ValueError):
            pass
        from app.process_registry import running_processes

        child = running_processes.get(self.run_id)
        tool_pid = child.pid if child is not None and child.poll() is None else None
        now = time.monotonic()
        if progress is not None or tool_pid != self._tool_pid or now - self._last_beat >= RESEARCH_HEARTBEAT_SECONDS:
            research_jobs.report(self.run_id, progress, tool_pid=tool_pid if tool_pid != self._tool_pid else None)
            self._tool_pid = tool_pid
            self._last_beat = now

    def run(self) -> None:
        from app.process_registry import kill_managed

        while not self.stop_event.wait(_PROGRESS_POLL_S):
            try:
                self.flush()
                if self.flag.is_set():
                    self.cancelled = True
                    if not self.flag.superseded:
                        # The tool's own cancelled path reads this file.
                        self.main._write_cancelled_progress(self.run_id)
                    kill_managed(self.run_id)
                    return
            except Exception:
                logger.exception("Watch loop error for %s", self.run_id)


def run_job(run_id: str, runners: Optional[Dict[str, Callable]] = None) -> int:
    """0 when the run reached a final state or was not ours. 1 only for an unexpected crash."""
    global _active_run
    from app.paths import validate_id
    from app.services import research_jobs

    run_id = validate_id(run_id, kind="run id")
    retry_of = task_prefix() if task_attempt() > 0 else None
    me = worker_id()
    job = research_jobs.claim(run_id, me, retry_of=retry_of)
    if job is None:
        logger.info("Run %s is not waiting for a worker; nothing to do", run_id)
        return 0
    tool = job.get("tool") or ""
    runner = (runners or RUNNERS).get(tool)
    if runner is None:
        research_jobs.update_pipeline_run_state(run_id, status="failed", stage="error", message=f"Unknown tool {tool!r}")
        return 0

    from app import main

    research_jobs._executing.add(run_id)
    _active_run = run_id
    watch = _Watch(main, run_id, me)
    watch.start()
    try:
        runner(main, run_id, dict(job.get("payload") or {}))
    except Exception as exc:
        logger.exception("Run %s failed", run_id)
        if not watch.flag.is_set(fresh=True):
            from app.services.trainer_jobs import public_failure_message

            message = public_failure_message(exc).replace("Training failed", "Run failed", 1)
            research_jobs.update_pipeline_run_state(run_id, status="failed", progress=0.0, stage="error", message=message)
    finally:
        watch.stop_event.set()
        watch.join(timeout=5)
        try:
            watch.flush()
        except Exception:
            logger.exception("Final progress flush failed for %s", run_id)
        research_jobs._executing.discard(run_id)
        _active_run = None

    row = research_jobs.load_row(run_id) or {}
    if watch.flag.superseded:
        logger.warning("Run %s is now held by another worker; stopped without writing", run_id)
    elif row.get("status") not in research_jobs.TERMINAL_RUN_STATUSES:
        # The tool returned without recording an outcome (e.g. a timeout path that only wrote
        # progress.json). Never leave the run holding a slot.
        progress = main.read_progress_file(run_id)
        message = str(progress.get("error_message") or "The run ended without a result")[:500]
        research_jobs.update_pipeline_run_state(run_id, status="failed", progress=0.0, stage="error", message=message)
    logger.info("Run %s ended: %s", run_id, (research_jobs.load_row(run_id) or {}).get("status"))
    return 0


def _on_sigterm(signum, frame) -> None:
    del frame
    run_id = _active_run
    if run_id:
        from app.process_registry import kill_managed
        from app.services import research_jobs

        kill_managed(run_id)
        if task_prefix() and task_attempt() < RESEARCH_JOB_MAX_RETRIES:
            # Cloud Run retries this task; the next attempt claims the row and starts over.
            research_jobs.update_pipeline_run_state(run_id, message="The worker was interrupted; restarting the run")
        else:
            research_jobs.update_pipeline_run_state(
                run_id, status="failed", progress=0.0, stage="error",
                message="The run was stopped before it finished (timeout or shutdown)",
            )
    os._exit(128 + signum)


def start_next_queued() -> None:
    """The finishing worker starts waiting runs itself, so the queue moves even when nobody
    is polling. Best effort (Cloud Run needs run.jobs.runWithOverrides for this account)."""
    from app.services import research_jobs

    try:
        research_jobs.reconcile_all()
        started = research_jobs.pump_queue()
        if started:
            logger.info("Started %d queued run(s)", len(started))
    except Exception:
        logger.exception("Could not start queued runs")


def main(argv: Optional[list] = None) -> int:
    configure_logging()
    args = list(sys.argv[1:] if argv is None else argv)
    run_id = args[0] if args else os.getenv("CONVOLVE_RUN_ID", "")
    if not run_id:
        logger.error("No run id: set CONVOLVE_RUN_ID or pass it as the first argument")
        return 2
    signal.signal(signal.SIGTERM, _on_sigterm)
    try:
        code = run_job(run_id)
    except Exception:
        logger.exception("Research worker crashed for %s", run_id)
        code = 1
    start_next_queued()
    return code


if __name__ == "__main__":
    sys.exit(main())
