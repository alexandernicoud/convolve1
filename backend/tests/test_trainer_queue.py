"""Training queue: concurrency limits, FIFO dispatch, retry claims, checkpoint resume."""

from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path

import pytest

from app import config as app_config
from app.db import SessionLocal
from app.jobs import train_worker
from app.models import PipelineRun
from app.ownership import record_pipeline_run
from app.paths import run_dir_for
from app.services import trainer_jobs
from tests.test_trainer_jobs import FakeDispatcher, FakeTrainer, _dataset, _headers, _row, _start  # noqa: F401
from tests.test_trainer_jobs import cleanup, dispatcher, store  # noqa: F401  (fixtures)


@pytest.fixture
def limits(monkeypatch):
    def set_limits(*, total=4, per_user=1, queued=5):
        monkeypatch.setattr(app_config, "TRAINER_MAX_ACTIVE_JOBS", total)
        monkeypatch.setattr(app_config, "TRAINER_MAX_ACTIVE_JOBS_PER_USER", per_user)
        monkeypatch.setattr(app_config, "TRAINER_MAX_QUEUED_JOBS_PER_USER", queued)

    set_limits()
    monkeypatch.setattr(trainer_jobs, "POLL_PUMP_INTERVAL_S", 0.0)
    return set_limits


def _finish(run_id: str, status: str = "succeeded") -> None:
    db = SessionLocal()
    try:
        db.query(PipelineRun).filter(PipelineRun.id == run_id).update({PipelineRun.status: status}, synchronize_session=False)
        db.commit()
    finally:
        db.close()


def test_second_run_waits_for_the_users_first_and_starts_when_it_ends(client, user_a, store, dispatcher, cleanup, limits):
    headers = _headers(client, user_a)
    dataset_id = _dataset(user_a, cleanup)
    first = _start(client, headers, dataset_id, cleanup, user_a)
    second = _start(client, headers, dataset_id, cleanup, user_a)

    assert dispatcher.runs == [first]
    assert _row(second).worker_id == trainer_jobs.WAITING and _row(second).status == "queued"
    view = client.get(f"/trainer/runs/{second}", headers=headers).json()
    assert view["progress"]["phase"] == "queued"
    assert view["progress"]["queue"]["waiting_for"] == "user"
    assert "your running training job" in view["progress"]["message"]
    # A worker that somehow started for the waiting run must not take it.
    assert trainer_jobs.claim(second, "job/x/0/0") is None

    assert train_worker.run_job(first, trainer=FakeTrainer()) == 0
    client.get(f"/trainer/runs/{second}", headers=headers)
    assert dispatcher.runs == [first, second]
    assert _row(second).worker_id == trainer_jobs.PENDING
    assert train_worker.run_job(second, trainer=FakeTrainer()) == 0
    assert _row(second).status == "succeeded"


def test_finishing_worker_starts_the_next_run_when_enabled(client, user_a, store, dispatcher, cleanup, limits, monkeypatch):
    headers = _headers(client, user_a)
    dataset_id = _dataset(user_a, cleanup)
    first = _start(client, headers, dataset_id, cleanup, user_a)
    second = _start(client, headers, dataset_id, cleanup, user_a)
    assert train_worker.run_job(first, trainer=FakeTrainer()) == 0
    train_worker.start_next_queued()
    assert dispatcher.runs == [first]  # off by default
    monkeypatch.setenv("TRAINER_WORKER_STARTS_QUEUED", "1")
    train_worker.start_next_queued()
    assert dispatcher.runs == [first, second]


def test_polls_do_not_take_the_queue_lock_when_nothing_waits(client, user_a, store, dispatcher, cleanup, limits, monkeypatch):
    headers = _headers(client, user_a)
    run_id = _start(client, headers, _dataset(user_a, cleanup), cleanup, user_a)
    assert dispatcher.runs == [run_id]
    calls = []
    monkeypatch.setattr(trainer_jobs, "pump_queue", lambda *a, **k: calls.append(1) or [])
    client.get(f"/trainer/runs/{run_id}", headers=headers)
    assert calls == []


def test_global_capacity_is_shared_fifo_across_users(client, user_a, user_b, store, dispatcher, cleanup, limits):
    limits(total=1, per_user=1)
    ha, hb = _headers(client, user_a), _headers(client, user_b)
    da, db_ = _dataset(user_a, cleanup), _dataset(user_b, cleanup)
    a1 = _start(client, ha, da, cleanup, user_a)
    b1 = _start(client, hb, db_, cleanup, user_b)
    a2 = _start(client, ha, da, cleanup, user_a)
    assert dispatcher.runs == [a1]
    q = client.get(f"/trainer/runs/{b1}", headers=hb).json()["progress"]["queue"]
    assert q == {"position": 1, "waiting_for": "global", "accelerator": "cpu"}
    assert client.get(f"/trainer/runs/{a2}", headers=ha).json()["progress"]["queue"]["position"] == 2

    _finish(a1)
    trainer_jobs.pump_queue()
    assert dispatcher.runs == [a1, b1]  # oldest waiting run first, one at a time
    _finish(b1)
    trainer_jobs.pump_queue()
    assert dispatcher.runs == [a1, b1, a2]


def test_queue_depth_limit_refuses_before_registering(client, user_a, store, dispatcher, cleanup, limits):
    limits(per_user=1, queued=1)
    headers = _headers(client, user_a)
    dataset_id = _dataset(user_a, cleanup)
    _start(client, headers, dataset_id, cleanup, user_a)
    _start(client, headers, dataset_id, cleanup, user_a)
    db = SessionLocal()
    try:
        before = db.query(PipelineRun).filter(PipelineRun.user_id == user_a).count()
    finally:
        db.close()
    from tests.test_trainer_jobs import _request

    resp = client.post("/trainer/runs", json=_request(dataset_id), headers=headers)
    assert resp.status_code == 429 and "waiting" in resp.json()["detail"]
    db = SessionLocal()
    try:
        assert db.query(PipelineRun).filter(PipelineRun.user_id == user_a).count() == before
    finally:
        db.close()


def test_cancelling_a_waiting_run_never_dispatches_it(client, user_a, store, dispatcher, cleanup, limits):
    headers = _headers(client, user_a)
    dataset_id = _dataset(user_a, cleanup)
    first = _start(client, headers, dataset_id, cleanup, user_a)
    second = _start(client, headers, dataset_id, cleanup, user_a)
    assert client.post(f"/trainer/runs/{second}/cancel", headers=headers).status_code == 200
    _finish(first)
    trainer_jobs.pump_queue()
    assert dispatcher.runs == [first]
    assert _row(second).status == "cancelled"


def test_retry_attempt_takes_over_only_its_own_task(client, user_a, store, dispatcher, cleanup, limits):
    headers = _headers(client, user_a)
    run_id = _start(client, headers, _dataset(user_a, cleanup), cleanup, user_a)
    assert trainer_jobs.claim(run_id, "job/exec-1/0/0") is not None
    assert trainer_jobs.claim(run_id, "job/exec-2/0/1", retry_of="job/exec-2/0/") is None
    assert trainer_jobs.claim(run_id, "job/exec-1/0/1") is None
    assert trainer_jobs.claim(run_id, "job/exec-1/0/1", retry_of="job/exec-1/0/") is not None
    assert _row(run_id).worker_id == "job/exec-1/0/1"


class CheckpointingTrainer(FakeTrainer):
    """Writes one epoch checkpoint through the real store path, then fails or finishes."""

    def __init__(self, fail: bool) -> None:
        super().__init__()
        self.fail = fail
        self.saw_restored = None

    def __call__(self, config, run_dir, progress_cb, cancel_event=None, checkpoint=None):
        ckpt = Path(checkpoint["dir"])
        self.saw_restored = (ckpt / "state.json").is_file()
        if self.fail:
            ckpt.mkdir(parents=True, exist_ok=True)
            (ckpt / "epoch-0001.keras").write_bytes(b"weights-and-optimizer")
            state = {"version": 1, "run_id": checkpoint["run_id"], "user_id": checkpoint["user_id"],
                     "epochs_completed": 1, "model_file": "epoch-0001.keras", "best_weights_file": None}
            (ckpt / "state.json").write_text(json.dumps(state))
            checkpoint["on_saved"](ckpt, state)
            raise RuntimeError("machine lost")
        return super().__call__(config, run_dir, progress_cb, cancel_event, checkpoint)


def test_failed_run_resumes_from_its_uploaded_checkpoint(client, user_a, user_b, store, dispatcher, cleanup, limits):
    headers = _headers(client, user_a)
    run_id = _start(client, headers, _dataset(user_a, cleanup), cleanup, user_a)
    assert train_worker.run_job(run_id, trainer=CheckpointingTrainer(fail=True)) == 1
    view = client.get(f"/trainer/runs/{run_id}", headers=headers).json()
    assert view["status"] == "failed"
    assert view["session"]["resumable_from_epoch"] == 1
    meta = json.loads(_row(run_id).extra_json)["trainer_checkpoint"]
    assert meta["epochs_completed"] == 1
    assert [f["rel"] for f in meta["files"]] == ["epoch-0001.keras", "state.json"]
    assert all(f"checkpoints/{user_a}/{run_id}/" in f["uri"] for f in meta["files"])

    assert client.post(f"/trainer/runs/{run_id}/resume", headers=_headers(client, user_b)).status_code == 404
    dispatcher.ended = None  # Cloud Run has not confirmed the old execution stopped
    resp = client.post(f"/trainer/runs/{run_id}/resume", headers=headers)
    assert resp.status_code == 409 and "still stopping" in resp.json()["detail"]
    assert dispatcher.runs == [run_id]
    dispatcher.ended = True
    resp = client.post(f"/trainer/runs/{run_id}/resume", headers=headers)
    assert resp.status_code == 200, resp.text
    assert dispatcher.runs == [run_id, run_id]
    assert _row(run_id).status == "queued"

    # The new execution starts on a fresh machine: the checkpoint comes from the store.
    import shutil

    shutil.rmtree(run_dir_for(run_id, str(user_a)) / "checkpoint")
    trainer = CheckpointingTrainer(fail=False)
    assert train_worker.run_job(run_id, trainer=trainer) == 0
    assert trainer.saw_restored is True
    assert _row(run_id).status == "succeeded"
    assert client.post(f"/trainer/runs/{run_id}/resume", headers=headers).status_code == 409


def test_superseded_worker_stops_without_touching_the_run(client, user_a, store, dispatcher, cleanup, limits):
    headers = _headers(client, user_a)
    run_id = _start(client, headers, _dataset(user_a, cleanup), cleanup, user_a)

    def taken_over(epoch: int) -> None:
        if epoch == 1:
            db = SessionLocal()
            try:
                db.query(PipelineRun).filter(PipelineRun.id == run_id).update(
                    {PipelineRun.worker_id: "job/exec-9/0/0"}, synchronize_session=False
                )
                db.commit()
            finally:
                db.close()

    trainer = FakeTrainer(on_epoch=taken_over)
    import app.services.trainer_jobs as tj

    original = tj.DbCancelFlag.__init__

    def no_throttle(self, run_id, interval_s=5.0, owner=None):
        original(self, run_id, 0.0, owner)

    tj.DbCancelFlag.__init__ = no_throttle
    try:
        assert train_worker.run_job(run_id, trainer=trainer) == 0
    finally:
        tj.DbCancelFlag.__init__ = original
    row = _row(run_id)
    assert row.status == "running" and row.worker_id == "job/exec-9/0/0"


def test_run_without_checkpoint_cannot_resume(client, user_a, store, dispatcher, cleanup, limits):
    headers = _headers(client, user_a)
    run_id = _start(client, headers, _dataset(user_a, cleanup), cleanup, user_a)
    assert train_worker.run_job(run_id, trainer=FakeTrainer(error=ValueError("bad"))) == 1
    resp = client.post(f"/trainer/runs/{run_id}/resume", headers=headers)
    assert resp.status_code == 409 and "no saved checkpoint" in resp.json()["detail"]


def test_concurrent_submissions_never_exceed_capacity_or_dispatch_twice(store, dispatcher, limits):
    limits(total=3, per_user=1, queued=0)
    from tests.conftest import _profiled

    users = [str(_profiled(uuid.uuid4())) for _ in range(8)]
    runs = []
    for i, uid in enumerate(users):
        for j in range(2):
            rid = f"stress_{uuid.uuid4().hex[:10]}"
            record_pipeline_run(rid, uid, "trainer", status="queued")
            trainer_jobs.save_job_payload(rid, {"model_name": "m.keras"}, "dset", {})
            runs.append((rid, uid))
            time.sleep(0.001)

    errors = []

    def submit(rid, uid):
        try:
            trainer_jobs.submit(rid, uid)
            trainer_jobs.pump_queue()
        except Exception as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=submit, args=r) for r in runs]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    assert len(dispatcher.runs) == len(set(dispatcher.runs)) == 3

    finished = set()
    for _ in range(20):
        for rid in list(dispatcher.runs):
            if rid not in finished:
                _finish(rid)
                finished.add(rid)
        trainer_jobs.pump_queue()
        if len(dispatcher.runs) == len(runs):
            break
    assert sorted(dispatcher.runs) == sorted(r for r, _ in runs)
    assert len(dispatcher.runs) == len(set(dispatcher.runs))
