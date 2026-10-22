"""
Cloud Run Job entrypoint for one CNN training run.

    python -m app.jobs.train_worker            # run id from CONVOLVE_RUN_ID
    python -m app.jobs.train_worker RUN_ID
    python -m app.jobs.train_worker --check    # database + artifact store reachability only

The API has already recorded the run (status queued, payload in extra_json). This
process claims it, restores the dataset, runs runners.trainer_runner.run_trainer
unchanged, stores the finals, and only then marks the run succeeded.
"""

from __future__ import annotations

import logging
import os
import signal
import sys
from pathlib import Path
from typing import Any, Dict, Optional

from app.config import APP_PROFILE, MODEL_BUCKET, TRAINER_THREADS, configure_logging

logger = logging.getLogger("app.jobs.train_worker")

_active_run: Optional[str] = None


def configure_threads(threads: int = TRAINER_THREADS) -> Dict[str, str]:
    """Must run before TensorFlow is imported."""
    values = {
        "OMP_NUM_THREADS": str(threads),
        "TF_NUM_INTRAOP_THREADS": str(threads),
        "TF_NUM_INTEROP_THREADS": str(threads),
    }
    os.environ.update(values)
    return values


def _apply_tf_threads(threads: int) -> None:
    import tensorflow as tf

    try:
        tf.config.threading.set_intra_op_parallelism_threads(threads)
        tf.config.threading.set_inter_op_parallelism_threads(threads)
    except RuntimeError:
        # TensorFlow was already initialised in this process; the env vars set earlier still apply.
        logger.warning("TensorFlow thread pools already initialised; keeping existing settings")


def worker_id() -> str:
    execution = os.getenv("CLOUD_RUN_EXECUTION", "")
    task = os.getenv("CLOUD_RUN_TASK_INDEX", "0")
    if execution:
        return f"job/{execution}/{task}"
    return f"job/local/{os.getpid()}"


def run_job(run_id: str, trainer=None) -> int:
    """0 when the run ended succeeded/cancelled or was not ours to run. 1 when it failed."""
    global _active_run
    from app.paths import dataset_dir_for, run_dir_for, validate_id
    from app.services import trainer_jobs
    from app.services.durable_outputs import restore_dataset

    run_id = validate_id(run_id, kind="run id")
    job = trainer_jobs.claim(run_id, worker_id())
    if job is None:
        logger.info("Run %s is not queued; nothing to do", run_id)
        return 0
    _active_run = run_id
    user_id = job["user_id"]
    try:
        config: Dict[str, Any] = dict(job.get("config") or {})
        dataset_id = str(job.get("dataset_id") or "")
        model_name = str(config.get("model_name") or "")
        if not model_name or Path(model_name).name != model_name:
            raise ValueError("model_name must be a plain file name")
        if not dataset_id or not restore_dataset(dataset_id, user_id):
            raise FileNotFoundError(f"Dataset {dataset_id or '(none)'} could not be restored from storage")
        images = dataset_dir_for(dataset_id, user_id) / "images"
        if not images.is_dir():
            raise FileNotFoundError(f"Dataset {dataset_id} has no images directory")
        config["folder_name"] = str(images)

        run_dir = run_dir_for(run_id, user_id)
        run_dir.mkdir(parents=True, exist_ok=True)
        metadata = job.get("metadata")
        if isinstance(metadata, dict):
            import json

            (run_dir / "model_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

        if trainer is None:
            _apply_tf_threads(TRAINER_THREADS)
            from runners.trainer_runner import run_trainer as trainer
        from runners.trainer_runner import CancelledError

        def progress(phase: str, percent: float, data: Dict[str, Any]) -> None:
            trainer_jobs.report_progress(run_id, phase, percent, data)

        try:
            trainer(config, run_dir, progress, cancel_event=trainer_jobs.DbCancelFlag(run_id))
        except CancelledError:
            trainer_jobs.finish_cancelled(run_id)
            logger.info("Run %s cancelled", run_id)
            return 0

        if trainer_jobs.DbCancelFlag(run_id).is_set():
            logger.info("Run %s was cancelled after training finished; not storing results", run_id)
            return 0
        ok, err = trainer_jobs.finish_succeeded(run_id)
        if not ok:
            logger.error("Run %s not marked succeeded: %s", run_id, err)
            return 1
        logger.info("Run %s succeeded", run_id)
        return 0
    except Exception as exc:
        logger.exception("Run %s failed", run_id)
        trainer_jobs.finish_failed(run_id, f"Training failed: {exc}")
        return 1
    finally:
        _active_run = None


def check_access() -> int:
    """Report whether this job can train: ML pins, database (read-only checks) and artifact bucket.

    Writes nothing: database checks run in a READ ONLY transaction and the bucket is only listed.
    """
    from sqlalchemy import text

    from app import ml_versions
    from app.db import engine
    from app.db_security import browser_exposed_tables, rls_blocked_tables, worker_database_checks

    problems = ml_versions.version_mismatches()
    checks = [("ML package pins", not problems, "; ".join(problems) or ml_versions.describe())]

    with engine.connect() as conn, conn.begin():
        if conn.dialect.name == "postgresql":
            conn.execute(text("SET TRANSACTION READ ONLY"))
        conn.execute(text("SELECT 1"))
        checks.append(("database reachable", True, engine.dialect.name))
        checks.extend(worker_database_checks(conn, require_ssl=APP_PROFILE == "cloud"))
        blocked = rls_blocked_tables(conn)
        exposed = browser_exposed_tables(conn)
        checks.append(("row level security lets this user see its tables", not blocked, ", ".join(blocked) or "ok"))
        checks.append(("tables closed to browser roles", not exposed, ", ".join(exposed) or "ok"))

    if APP_PROFILE != "cloud":
        checks.append(("artifact store", True, f"APP_PROFILE={APP_PROFILE}: local disk"))
    elif not MODEL_BUCKET:
        checks.append(("artifact store", False, "APP_PROFILE=cloud requires MODEL_BUCKET"))
    else:
        try:
            from google.cloud import storage

            list(storage.Client().list_blobs(MODEL_BUCKET, prefix="users/", max_results=1))
            checks.append(("artifact store", True, f"bucket {MODEL_BUCKET} readable"))
        except Exception as exc:  # noqa: BLE001 — report it with the other results instead of aborting
            checks.append(("artifact store", False, f"bucket {MODEL_BUCKET}: {type(exc).__name__}"))

    for name, ok, detail in checks:
        (logger.info if ok else logger.error)("%s %s: %s", "OK  " if ok else "FAIL", name, detail)
    failed = [name for name, ok, _ in checks if not ok]
    if failed:
        logger.error("Training worker cannot run with this configuration (%s)", ", ".join(failed))
        return 1
    logger.info("Training worker can run with this configuration")
    return 0


def _on_sigterm(signum, frame) -> None:
    del frame
    run_id = _active_run
    if run_id:
        from app.services import trainer_jobs

        trainer_jobs.finish_failed(run_id, "Training job was stopped before it finished (timeout or shutdown)")
    os._exit(128 + signum)


def main(argv: Optional[list] = None) -> int:
    configure_threads()
    configure_logging()
    args = list(sys.argv[1:] if argv is None else argv)
    if args and args[0] == "--check":
        try:
            return check_access()
        except Exception:
            logger.exception("Access check failed")
            return 1
    run_id = args[0] if args else os.getenv("CONVOLVE_RUN_ID", "")
    if not run_id:
        logger.error("No run id: set CONVOLVE_RUN_ID or pass it as the first argument")
        return 2
    signal.signal(signal.SIGTERM, _on_sigterm)
    logger.info("Training job for %s (threads=%s)", run_id, TRAINER_THREADS)
    return run_job(run_id)


if __name__ == "__main__":
    sys.exit(main())
