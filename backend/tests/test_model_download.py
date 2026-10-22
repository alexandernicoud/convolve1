"""Large trained models download through Cloud Run's HTTP/1 limits.

Cloud Run rejects HTTP/1 responses larger than 32 MiB unless they are streamed
(chunked transfer encoding, no Content-Length). The staging model was 128 MiB.
"""

from __future__ import annotations

import hashlib
import http.client
import os
import shutil
import socket
import threading
import time
import uuid
from pathlib import Path

import pytest

from app.main import all_runs, app, update_run_progress
from app.ownership import record_pipeline_run
from app.paths import run_dir_for
from app.services.durable_outputs import LocalCopyStore, set_artifact_store

CLOUD_RUN_HTTP1_LIMIT = 32 * 1024 * 1024
MODEL_BYTES = 40 * 1024 * 1024


@pytest.fixture
def copy_store(tmp_path: Path):
    store = LocalCopyStore(tmp_path / "durable")
    set_artifact_store(store)
    yield store
    set_artifact_store(None)


def _headers(client, user_id: uuid.UUID) -> dict:
    from tests.conftest import mint_token

    headers = {"Authorization": f"Bearer {mint_token(user_id)}"}
    client.get("/api/me", headers=headers)
    return headers


def _write_model(path: Path, size: int = MODEL_BYTES) -> str:
    block = os.urandom(1024 * 1024)
    digest = hashlib.sha256()
    with open(path, "wb") as fh:
        written = 0
        while written < size:
            chunk = block[: min(len(block), size - written)]
            fh.write(chunk)
            digest.update(chunk)
            written += len(chunk)
    return digest.hexdigest()


def _seed_trained_run(user_id: uuid.UUID, run_id: str, model_name: str = "big_model.keras") -> tuple[Path, str]:
    run_dir = run_dir_for(run_id, str(user_id))
    run_dir.mkdir(parents=True, exist_ok=True)
    sha = _write_model(run_dir / "model.keras")
    (run_dir / "summary.json").write_text('{"final_metrics": {"val_accuracy": 0.5}}', encoding="utf-8")
    (run_dir / "model_metadata.json").write_text(f'{{"model_name": "{model_name}"}}', encoding="utf-8")
    record_pipeline_run(run_id, str(user_id), "trainer", status="running")
    all_runs.pop(run_id, None)
    update_run_progress(run_id, 1.0, "completed", "Training completed", "succeeded")
    all_runs.pop(run_id, None)
    return run_dir, sha


def _rm(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path)


def test_large_model_streams_without_content_length(client, user_a, copy_store):
    headers = _headers(client, user_a)
    run_dir, sha = _seed_trained_run(user_a, "dl_big_stream_1")
    try:
        with client.stream("GET", "/trainer/runs/dl_big_stream_1/download/model", headers=headers) as resp:
            assert resp.status_code == 200
            assert "content-length" not in {k.lower() for k in resp.headers}
            assert resp.headers["content-disposition"] == 'attachment; filename="big_model.keras"'
            digest, total = hashlib.sha256(), 0
            for chunk in resp.iter_bytes():
                digest.update(chunk)
                total += len(chunk)
        assert total == MODEL_BYTES > CLOUD_RUN_HTTP1_LIMIT
        assert digest.hexdigest() == sha
    finally:
        _rm(run_dir)


def test_other_user_cannot_download_large_model(client, user_a, user_b, copy_store):
    _headers(client, user_a)
    headers_b = _headers(client, user_b)
    run_dir, _ = _seed_trained_run(user_a, "dl_big_owner_1")
    try:
        denied = client.get("/trainer/runs/dl_big_owner_1/download/model", headers=headers_b)
        assert denied.status_code == 404
        assert len(denied.content) < 200
        assert client.get("/trainer/runs/dl_big_owner_1/download/model").status_code == 401
    finally:
        _rm(run_dir)


def test_large_model_restored_from_store_then_streamed(client, user_a, user_b, copy_store):
    """The Cloud Run API instance has no local copy; it restores from the store first."""
    headers_a = _headers(client, user_a)
    headers_b = _headers(client, user_b)
    run_dir, sha = _seed_trained_run(user_a, "dl_big_restore_1")
    _rm(run_dir)
    try:
        assert client.get("/trainer/runs/dl_big_restore_1/download/model", headers=headers_b).status_code == 404
        assert not run_dir.exists()
        with client.stream("GET", "/trainer/runs/dl_big_restore_1/download/model", headers=headers_a) as resp:
            assert resp.status_code == 200
            digest = hashlib.sha256()
            for chunk in resp.iter_bytes():
                digest.update(chunk)
        assert digest.hexdigest() == sha
    finally:
        _rm(run_dir)


def test_large_backtester_zip_streams(client, user_a, user_b, copy_store):
    headers = _headers(client, user_a)
    run_id = "dl_big_backtest_1"
    record_pipeline_run(run_id, str(user_a), "backtester", status="running")
    run_dir = run_dir_for(run_id, str(user_a))
    output = run_dir / "backtest_output"
    output.mkdir(parents=True, exist_ok=True)
    _write_model(output / "trades.bin")
    try:
        assert client.get(f"/runs/backtester/{run_id}/download.zip", headers=_headers(client, user_b)).status_code == 404
        with client.stream("GET", f"/runs/backtester/{run_id}/download.zip", headers=headers) as resp:
            assert resp.status_code == 200, resp.read()
            assert "content-length" not in {k.lower() for k in resp.headers}
            assert resp.headers["content-type"] == "application/zip"
            body = b"".join(resp.iter_bytes())
        assert len(body) > CLOUD_RUN_HTTP1_LIMIT
        assert body[:4] == b"PK\x03\x04"
    finally:
        _rm(run_dir)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_wire_response_is_chunked_over_real_http(client, user_a, copy_store):
    """TestClient bypasses HTTP framing; check the bytes Cloud Run would actually see."""
    import uvicorn

    headers = _headers(client, user_a)
    run_dir, sha = _seed_trained_run(user_a, "dl_big_wire_1")
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="off"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.time() + 10
        while not server.started and time.time() < deadline:
            time.sleep(0.05)
        assert server.started
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=60)
        conn.request("GET", "/trainer/runs/dl_big_wire_1/download/model", headers=headers)
        resp = conn.getresponse()
        assert resp.status == 200
        assert resp.getheader("Transfer-Encoding") == "chunked"
        assert resp.getheader("Content-Length") is None
        digest, total = hashlib.sha256(), 0
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            total += len(chunk)
        conn.close()
        assert total == MODEL_BYTES
        assert digest.hexdigest() == sha
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        _rm(run_dir)
