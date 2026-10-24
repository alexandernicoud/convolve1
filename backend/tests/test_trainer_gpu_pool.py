"""Optional GPU pool: routing, separate capacity, Cloud Batch dispatcher, GPU job specs."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from app import config as app_config
from app.jobs import train_worker
from app.services import trainer_jobs
from tests.test_trainer_jobs import BACKEND, FakeDispatcher, _dataset, _headers, _request, _row
from tests.test_trainer_jobs import cleanup, dispatcher, store  # noqa: F401  (fixtures)
from tests.test_trainer_queue import _finish, limits  # noqa: F401


@pytest.fixture
def gpu():
    fake = FakeDispatcher()
    trainer_jobs.set_dispatcher(fake, accelerator="gpu")
    yield fake
    trainer_jobs.set_dispatcher(None, accelerator="gpu")


def _start(client, headers, dataset_id, cleanup, user_id, accelerator=None):
    from app.paths import run_dir_for

    body = _request(dataset_id)
    if accelerator:
        body["accelerator"] = accelerator
    resp = client.post("/trainer/runs", json=body, headers=headers)
    assert resp.status_code == 200, resp.text
    run_id = resp.json()["run_id"]
    cleanup.append(run_dir_for(run_id, str(user_id)))
    return run_id


def test_gpu_is_refused_when_no_gpu_pool_is_configured(client, user_a, store, dispatcher, cleanup):
    headers = _headers(client, user_a)
    body = {**_request(_dataset(user_a, cleanup)), "accelerator": "gpu"}
    resp = client.post("/trainer/runs", json=body, headers=headers)
    assert resp.status_code == 409 and "GPU" in resp.json()["detail"]
    assert dispatcher.runs == []
    assert client.get("/trainer/architectures", headers=headers).json()["accelerators"] == ["cpu"]


def test_gpu_runs_use_the_gpu_pool_with_its_own_capacity(client, user_a, user_b, store, dispatcher, gpu, cleanup, limits, monkeypatch):
    from tests.conftest import _profiled
    import uuid

    monkeypatch.setattr(app_config, "TRAINER_MAX_ACTIVE_GPU_JOBS", 1)
    user_c = _profiled(uuid.uuid4())
    ha, hb, hc = _headers(client, user_a), _headers(client, user_b), _headers(client, user_c)
    catalog = client.get("/trainer/architectures", headers=ha).json()
    assert catalog["accelerators"] == ["cpu", "gpu"]
    assert catalog["architectures"][0]["id"] == "convolve-cnn-v1"

    g1 = _start(client, ha, _dataset(user_a, cleanup), cleanup, user_a, "gpu")
    g2 = _start(client, hb, _dataset(user_b, cleanup), cleanup, user_b, "gpu")
    c1 = _start(client, hc, _dataset(user_c, cleanup), cleanup, user_c)
    assert gpu.runs == [g1] and dispatcher.runs == [c1]  # the CPU run does not wait behind g2
    queue = client.get(f"/trainer/runs/{g2}", headers=hb).json()["progress"]["queue"]
    assert queue == {"position": 1, "waiting_for": "gpu", "accelerator": "gpu"}
    assert json.loads(_row(g1).extra_json)["trainer_job"]["accelerator"] == "gpu"

    assert client.post(f"/trainer/runs/{g1}/cancel", headers=ha).status_code == 200
    assert gpu.cancelled and not dispatcher.cancelled
    trainer_jobs.pump_queue()
    assert gpu.runs == [g1, g2]


def test_worker_runs_gpu_payload_with_the_same_trainer(client, user_a, store, dispatcher, gpu, cleanup, limits):
    from tests.test_trainer_jobs import FakeTrainer

    headers = _headers(client, user_a)
    run_id = _start(client, headers, _dataset(user_a, cleanup), cleanup, user_a, "gpu")
    trainer = FakeTrainer()
    assert train_worker.run_job(run_id, trainer=trainer) == 0
    assert trainer.calls[0]["accelerator"] == "gpu"
    assert _row(run_id).status == "succeeded"


class _Resp:
    def __init__(self, status, body=None):
        self.status_code, self._body, self.text = status, body or {}, json.dumps(body or {})

    def json(self):
        return self._body


class _Session:
    def __init__(self):
        self.calls = []
        self.state = "RUNNING"

    def post(self, url, params=None, json=None, timeout=None):
        self.calls.append(("POST", url, params, json))
        return _Resp(200, {"name": f"projects/p/locations/europe-west6/jobs/{params['job_id']}"})

    def delete(self, url, timeout=None):
        self.calls.append(("DELETE", url, None, None))
        return _Resp(200)

    def get(self, url, timeout=None):
        return _Resp(200, {"status": {"state": self.state}})


def test_batch_dispatcher_submits_the_reviewed_template_with_only_the_run_id(monkeypatch):
    template = BACKEND / "deploy" / "trainer-batch-gpu-zurich.json"
    d = trainer_jobs.CloudBatchDispatcher("proj", "europe-west6", str(template))
    session = _Session()
    monkeypatch.setattr(d, "_session", lambda: session)

    name = d.run("20261024_175828_7fb3b5")
    method, url, params, body = session.calls[0]
    assert url == "https://batch.googleapis.com/v1/projects/proj/locations/europe-west6/jobs"
    assert re.fullmatch(r"[a-z]([a-z0-9-]{0,61}[a-z0-9])?", params["job_id"])
    assert "//" not in body
    original = json.loads(template.read_text())
    env = body["taskGroups"][0]["taskSpec"]["environment"]["variables"]
    assert env.pop(trainer_jobs.RUN_ID_ENV) == "20261024_175828_7fb3b5"
    assert env == original["taskGroups"][0]["taskSpec"]["environment"]["variables"]
    assert d.finished(name) is False
    session.state = "SUCCEEDED"
    assert d.finished(name) is True
    d.cancel(name)
    assert session.calls[-1][:2] == ("DELETE", f"https://batch.googleapis.com/v1/{name}")


def test_gpu_specs_keep_data_in_their_declared_regions_and_never_hold_secrets():
    batch = json.loads((BACKEND / "deploy" / "trainer-batch-gpu-zurich.json").read_text())
    zones = batch["allocationPolicy"]["location"]["allowedLocations"]
    assert zones and all(z.startswith("zones/europe-west6-") for z in zones)
    policy = batch["allocationPolicy"]["instances"][0]
    assert policy["installGpuDrivers"] is True
    assert policy["policy"]["accelerators"] == [{"type": "nvidia-l4", "count": 1}]
    spec = batch["taskGroups"][0]["taskSpec"]
    assert "DATABASE_URL" not in spec["environment"]["variables"]
    assert spec["environment"]["secretVariables"]["DATABASE_URL"].startswith("projects/")
    assert spec["maxRetryCount"] == int(spec["environment"]["variables"]["TRAINER_JOB_MAX_RETRIES"])

    yaml = pytest.importorskip("yaml")
    job = yaml.safe_load((BACKEND / "deploy" / "trainer-job-gpu.yaml").read_text())
    task = job["spec"]["template"]["spec"]["template"]["spec"]
    container = task["containers"][0]
    env = {e["name"]: e for e in container["env"]}
    assert task["nodeSelector"] == {"run.googleapis.com/accelerator": "nvidia-l4"}
    assert container["resources"]["limits"]["nvidia.com/gpu"] == "1"
    assert task["maxRetries"] == int(env["TRAINER_JOB_MAX_RETRIES"]["value"])
    assert "secretKeyRef" in env["DATABASE_URL"]["valueFrom"]
    assert "outside" in (BACKEND / "deploy" / "trainer-job-gpu.yaml").read_text().split("apiVersion")[0]


def test_gpu_image_keeps_the_ml_pins():
    dockerfile = (BACKEND / "Dockerfile.gpu").read_text()
    assert "pip install --no-cache-dir -r requirements.txt" in dockerfile
    assert "tensorflow[and-cuda]==$(python -c" in dockerfile  # same version as requirements.txt


def test_accelerator_check_fails_only_when_a_gpu_is_required(monkeypatch):
    monkeypatch.delenv("TRAINER_REQUIRE_GPU", raising=False)
    name, ok, detail = train_worker._accelerator_check()
    assert name == "accelerator"
    if "GPU:" in detail:
        pytest.skip("this machine has a GPU")
    assert ok and detail.startswith("CPU only")
    monkeypatch.setenv("TRAINER_REQUIRE_GPU", "1")
    assert train_worker._accelerator_check()[1] is False


def test_batch_task_identity_for_retries(monkeypatch):
    for var in ("CLOUD_RUN_EXECUTION", "CLOUD_RUN_TASK_ATTEMPT"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("BATCH_JOB_UID", "train-x-1234")
    monkeypatch.setenv("BATCH_TASK_INDEX", "0")
    monkeypatch.setenv("BATCH_TASK_RETRY_ATTEMPT", "1")
    assert train_worker.task_prefix() == "job/batch-train-x-1234/0/"
    assert train_worker.worker_id() == "job/batch-train-x-1234/0/1"
