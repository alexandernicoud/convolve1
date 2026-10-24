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
import time
from pathlib import Path
from typing import Any, Dict, Optional

_PROCESS_T0 = time.perf_counter()

from app.config import (  # noqa: E402
    APP_PROFILE,
    MODEL_BUCKET,
    TRAINER_CHECKPOINTS,
    TRAINER_JOB_MAX_RETRIES,
    TRAINER_THREADS,
    configure_logging,
)

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


def task_attempt() -> int:
    """Retry attempt of this task: Cloud Run Jobs or Cloud Batch (GPU pool in Zurich)."""
    try:
        return int(os.getenv("CLOUD_RUN_TASK_ATTEMPT") or os.getenv("BATCH_TASK_RETRY_ATTEMPT") or "0")
    except ValueError:
        return 0


def task_prefix() -> Optional[str]:
    """Identifies this task across its retry attempts."""
    execution = os.getenv("CLOUD_RUN_EXECUTION", "")
    if execution:
        return f"job/{execution}/{os.getenv('CLOUD_RUN_TASK_INDEX', '0')}/"
    batch_job = os.getenv("BATCH_JOB_UID") or os.getenv("BATCH_JOB_ID")
    if batch_job:
        return f"job/batch-{batch_job}/{os.getenv('BATCH_TASK_INDEX', '0')}/"
    return None


def worker_id() -> str:
    prefix = task_prefix()
    if prefix:
        return f"{prefix}{task_attempt()}"
    return f"job/local/{os.getpid()}"


def run_job(run_id: str, trainer=None) -> int:
    """0 when the run ended succeeded/cancelled or was not ours to run. 1 when it failed."""
    global _active_run
    from app.paths import dataset_dir_for, run_dir_for, validate_id
    from app.services import trainer_jobs
    from app.services.durable_outputs import restore_dataset

    run_id = validate_id(run_id, kind="run id")
    retry_of = task_prefix() if task_attempt() > 0 else None
    me = worker_id()
    job = trainer_jobs.claim(run_id, me, retry_of=retry_of)
    if job is None:
        logger.info("Run %s is not queued; nothing to do", run_id)
        return 0
    cancel_flag = trainer_jobs.DbCancelFlag(run_id, owner=me)
    claimed_at = time.time()
    _active_run = run_id
    user_id = job["user_id"]
    timings: Dict[str, Any] = {"worker_claimed_at": claimed_at, "process_to_claim_seconds": round(time.perf_counter() - _PROCESS_T0, 2)}
    if isinstance(job.get("requested_at"), (int, float)):
        # API dispatch, Cloud Run scheduling, container start and Python start-up together.
        timings["queue_to_claim_seconds"] = round(claimed_at - float(job["requested_at"]), 2)
    try:
        config: Dict[str, Any] = dict(job.get("config") or {})
        dataset_id = str(job.get("dataset_id") or "")
        model_name = str(config.get("model_name") or "")
        if not model_name or Path(model_name).name != model_name:
            raise ValueError("model_name must be a plain file name")
        t_restore = time.perf_counter()
        restored = bool(dataset_id) and restore_dataset(dataset_id, user_id)
        timings["dataset_restore_seconds"] = round(time.perf_counter() - t_restore, 2)
        if not restored:
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

        t_import = time.perf_counter()
        if trainer is None:
            _apply_tf_threads(TRAINER_THREADS)
            from runners.trainer_runner import run_trainer as trainer
        from runners.trainer_runner import CancelledError

        timings["tensorflow_import_seconds"] = round(time.perf_counter() - t_import, 2)
        trainer_jobs.save_worker_timings(run_id, timings)

        def progress(phase: str, percent: float, data: Dict[str, Any]) -> None:
            trainer_jobs.report_progress(run_id, phase, percent, data)

        trainer_kwargs: Dict[str, Any] = {"cancel_event": cancel_flag}
        if TRAINER_CHECKPOINTS:
            ckpt_dir = run_dir / "checkpoint"
            t_ckpt = time.perf_counter()
            restored_epochs = trainer_jobs.restore_checkpoint(run_id, ckpt_dir)
            if restored_epochs:
                timings["checkpoint_restore_seconds"] = round(time.perf_counter() - t_ckpt, 2)
                timings["checkpoint_restored_epochs"] = restored_epochs
            elif job.get("has_checkpoint"):
                # Recorded but not restorable (expired or unreadable): say so instead of
                # presenting a fresh start as a resume.
                timings["checkpoint_unavailable"] = True
                trainer_jobs.report_progress(
                    run_id, "loading", 1, {"message": "The saved checkpoint is no longer available; training restarts from epoch 1"}
                )
            upload_seconds = [0.0]

            def on_saved(directory, state) -> None:
                if cancel_flag.is_set(fresh=True) and cancel_flag.superseded:
                    return
                t_up = time.perf_counter()
                try:
                    trainer_jobs.store_checkpoint(run_id, user_id, directory, state)
                except Exception:
                    # Training goes on; only the ability to resume from this epoch is lost.
                    logger.exception("Could not upload checkpoint for %s", run_id)
                upload_seconds[0] += time.perf_counter() - t_up
                timings["checkpoint_upload_seconds"] = round(upload_seconds[0], 2)

            trainer_kwargs["checkpoint"] = {"dir": ckpt_dir, "run_id": run_id, "user_id": user_id, "on_saved": on_saved}

        try:
            trainer(config, run_dir, progress, **trainer_kwargs)
        except CancelledError:
            if cancel_flag.superseded:
                logger.warning("Run %s is now held by another worker; stopping without writing", run_id)
                return 0
            trainer_jobs.finish_cancelled(run_id)
            logger.info("Run %s cancelled", run_id)
            return 0

        if cancel_flag.is_set(fresh=True):
            logger.info("Run %s was cancelled or taken over after training finished; not storing results", run_id)
            return 0
        t_publish = time.perf_counter()
        ok, err = trainer_jobs.finish_succeeded(run_id)
        timings["publish_seconds"] = round(time.perf_counter() - t_publish, 2)
        timings["worker_total_seconds"] = round(time.time() - claimed_at, 2)
        trainer_jobs.save_worker_timings(run_id, timings)
        if not ok:
            logger.error("Run %s not marked succeeded: %s", run_id, err)
            return 1
        logger.info("Run %s succeeded", run_id)
        return 0
    except Exception as exc:
        logger.exception("Run %s failed", run_id)
        if cancel_flag.is_set(fresh=True) and cancel_flag.superseded:
            return 1
        trainer_jobs.finish_failed(run_id, trainer_jobs.public_failure_message(exc))
        return 1
    finally:
        _active_run = None


def _accelerator_check():
    """GPU visible to TensorFlow. Required only when TRAINER_REQUIRE_GPU is set (GPU job spec);
    without it a CPU-only machine is the normal production path."""
    require = os.getenv("TRAINER_REQUIRE_GPU", "").strip().lower() in ("1", "true", "yes")
    try:
        import tensorflow as tf

        gpus = tf.config.list_physical_devices("GPU")
        built_cuda = tf.test.is_built_with_cuda()
    except Exception as exc:  # noqa: BLE001
        return ("accelerator", not require, f"TensorFlow could not list devices: {type(exc).__name__}")
    if gpus:
        names = []
        for gpu in gpus:
            try:
                names.append(tf.config.experimental.get_device_details(gpu).get("device_name") or gpu.name)
            except Exception:  # noqa: BLE001
                names.append(gpu.name)
        return ("accelerator", True, f"GPU: {', '.join(names)}")
    detail = "CPU only" + ("" if built_cuda else " (TensorFlow build without CUDA)")
    return ("accelerator", not require, detail + ("; TRAINER_REQUIRE_GPU is set" if require else ""))


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
    checks.append(_accelerator_check())

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

        if TRAINER_CHECKPOINTS and task_attempt() < TRAINER_JOB_MAX_RETRIES:
            # Cloud Run retries this task; the next attempt claims the row and resumes.
            from app.ownership import update_pipeline_run_state

            update_pipeline_run_state(run_id, message="Training machine was interrupted; continuing from the last checkpoint")
        else:
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
    code = run_job(run_id)
    start_next_queued()
    return code


def start_next_queued() -> None:
    """With TRAINER_WORKER_STARTS_QUEUED, the finishing worker starts waiting runs itself, so the
    queue moves even when no browser is polling. Needs run.jobs.runWithOverrides on the trainer
    job(s) for this service account; best effort, a failure only delays the next start."""
    if os.getenv("TRAINER_WORKER_STARTS_QUEUED", "").strip().lower() not in ("1", "true", "yes"):
        return
    from app.services import trainer_jobs

    try:
        started = trainer_jobs.pump_queue()
        if started:
            logger.info("Started %d queued run(s)", len(started))
    except Exception:
        logger.exception("Could not start queued runs")


if __name__ == "__main__":
    sys.exit(main())
