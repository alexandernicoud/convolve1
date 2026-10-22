"""Staging-only checks for large transfers, archive storage, bots and isolation.

Targets STAGING_API_URL only. Never prints tokens, secrets or upload session URLs.
"""
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import requests

import driver as d
from driver import USERS, body, call, note, poll

HERE = Path(__file__).parent
OUT = d.OUT
BUCKET = os.environ["STAGING_BUCKET"]
assert "staging" in BUCKET
ORIGIN = "http://localhost:8080"
LIMIT = 32 * 1024 * 1024


def ids_load():
    p = OUT / "ids2.json"
    return json.loads(p.read_text()) if p.exists() else {}


def ids_save(ids):
    (OUT / "ids2.json").write_text(json.dumps(ids, indent=2))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def init(kind, path, user="A", origin=None):
    headers = {"Origin": origin} if origin else {}
    r = call("POST", "/api/uploads", user, headers=headers,
             json={"kind": kind, "filename": path.name, "size": path.stat().st_size,
                   "content_type": "application/zip" if kind == "dataset" else "application/octet-stream"})
    return r


def put(upload_url, path, content_type):
    t0 = time.time()
    with open(path, "rb") as fh:
        r = requests.put(upload_url, data=fh, headers={"Content-Type": content_type}, timeout=1800)
    return r.status_code, round(time.time() - t0, 1)


def stage(kind, path, user="A", origin=None):
    r = init(kind, path, user, origin)
    b = body(r)
    note("init", kind=kind, user=user, code=r.status_code, mode=b.get("mode") if isinstance(b, dict) else b)
    assert r.ok and b["mode"] == "direct", b
    ctype = "application/zip" if kind == "dataset" else "application/octet-stream"
    code, secs = put(b["upload_url"], path, ctype)
    note("put_to_storage", kind=kind, code=code, seconds=secs, mib=round(path.stat().st_size / 1048576, 1))
    assert code in (200, 201), code
    return b["upload_id"], b["upload_url"]


def gcs_ls(prefix):
    out = subprocess.run(["gcloud", "storage", "ls", "-l", f"gs://{BUCKET}/{prefix}"], capture_output=True, text=True)
    return [line for line in out.stdout.splitlines() if line.strip() and not line.startswith("TOTAL")]


def stream_download(path, user, dest):
    r = call("GET", path, user, stream=True)
    info = {"code": r.status_code, "content_length": r.headers.get("content-length"),
            "transfer_encoding": r.headers.get("transfer-encoding"), "ctype": r.headers.get("content-type")}
    if r.status_code == 200:
        t0, total = time.time(), 0
        with open(dest, "wb") as fh:
            for chunk in r.iter_content(1 << 20):
                fh.write(chunk)
                total += len(chunk)
        info.update(bytes=total, mib=round(total / 1048576, 1), seconds=round(time.time() - t0, 1), sha256=sha256(dest))
    r.close()
    return info


def phase_upload():
    ids = ids_load()
    for u in USERS:
        note("api_me", user=u, code=call("GET", "/api/me", u).status_code)
    big = HERE / "dataset_big.zip"

    t0 = time.time()
    upload_id, url = stage("dataset", big, "A", origin=ORIGIN)
    pre = requests.options(url, headers={"Origin": ORIGIN, "Access-Control-Request-Method": "PUT",
                                         "Access-Control-Request-Headers": "content-type"}, timeout=30)
    note("cors_preflight", code=pre.status_code, allow_origin=pre.headers.get("access-control-allow-origin"),
         allow_methods=pre.headers.get("access-control-allow-methods"))

    r = call("POST", f"/api/uploads/{upload_id}/dataset", "B", json={})
    note("isolation_B_finalize_A_upload", code=r.status_code, body=body(r))
    r = call("POST", f"/api/uploads/{upload_id}/model", "A")
    note("kind_mismatch_finalize", code=r.status_code, body=body(r))

    t1 = time.time()
    r = call("POST", f"/api/uploads/{upload_id}/dataset", "A", json={})
    ds = body(r)
    note("finalize_dataset", code=r.status_code, seconds=round(time.time() - t1, 1),
         total_seconds=round(time.time() - t0, 1),
         dataset_id=ds.get("dataset_id") if r.ok else ds,
         summary=(ds.get("summary") or {}).get("label_distribution") if r.ok else None)
    assert r.ok
    dataset_id = ds["dataset_id"]
    ids["big_dataset_id"] = dataset_id
    ids_save(ids)
    note("gcs_dataset_objects", objects=gcs_ls(f"users/{USERS['A']}/datasets/{dataset_id}/"))
    note("gcs_staged_upload_left", objects=gcs_ls(f"uploads/{USERS['A']}/{upload_id}/"))
    r = call("POST", f"/api/uploads/{upload_id}/dataset", "A", json={})
    note("refinalize_same_upload", code=r.status_code)

    small = HERE / "dataset240.zip"
    t0 = time.time()
    with open(small, "rb") as fh:
        r = call("POST", "/datasets/upload", "A", files={"file": (small.name, fh, "application/zip")})
    sb = body(r)
    note("multipart_small_upload", code=r.status_code, seconds=round(time.time() - t0, 1),
         dataset_id=sb.get("dataset_id") if r.ok else sb)
    if r.ok:
        note("gcs_small_dataset_objects", objects=gcs_ls(f"users/{USERS['A']}/datasets/{sb['dataset_id']}/"))

    for path in (f"/datasets/{dataset_id}",):
        note("isolation_B", path=path, code=call("GET", path, "B").status_code)
    r = call("GET", "/api/datasets", "B")
    note("datasets_list_B", code=r.status_code, has_A_dataset=dataset_id in json.dumps(body(r)))
    note("no_app_token_init", code=call("POST", "/api/uploads", None,
                                         json={"kind": "dataset", "filename": "x.zip", "size": 10}).status_code)
    toobig = call("POST", "/api/uploads", "A", json={"kind": "dataset", "filename": "x.zip", "size": 5 * 1024 ** 3})
    note("init_too_big", code=toobig.status_code)


def phase_train():
    ids = ids_load()
    t0 = time.time()
    r = call("POST", "/trainer/runs", "A", json=d.config(ids["big_dataset_id"], "staging_big.keras", 1))
    note("start", code=r.status_code, seconds=round(time.time() - t0, 2), body=body(r))
    run_id = body(r)["run_id"]
    ids["big_run_id"] = run_id
    ids_save(ids)
    seen, phases, last = poll(run_id, timeout=2400, interval=5)
    note("final", run_id=run_id, transitions=seen, phases=phases, status=last.get("status"),
         last_metrics=last.get("last_metrics"), artifact_paths=last.get("artifact_paths"))


def phase_download():
    ids = ids_load()
    run_id = ids["big_run_id"]
    dest = HERE / "downloaded_model.keras"
    info = stream_download(f"/trainer/runs/{run_id}/download/model", "A", dest)
    note("download_model", **info)
    ids["model_sha256"] = info.get("sha256")
    ids_save(ids)
    note("isolation_B_download", **{k: v for k, v in stream_download(
        f"/trainer/runs/{run_id}/download/model", "B", HERE / "b.bin").items() if k in ("code", "content_length")})
    note("gcs_model_objects", objects=gcs_ls(f"users/{USERS['A']}/runs/{run_id}/model.keras"))
    out = subprocess.run([sys.executable, "-c",
                          "import keras,sys; m=keras.saving.load_model(sys.argv[1]); print(keras.__version__, m.input_shape, m.count_params())",
                          str(dest)], capture_output=True, text=True)
    note("local_load_downloaded_model", rc=out.returncode, out=out.stdout.strip()[-200:], err=out.stderr.strip()[-300:])


def phase_model_upload():
    ids = ids_load()
    model = HERE / "downloaded_model.keras"
    upload_id, _ = stage("model", model, "A")
    r = call("POST", f"/api/uploads/{upload_id}/model", "B")
    note("isolation_B_finalize_A_model", code=r.status_code)
    t0 = time.time()
    r = call("POST", f"/api/uploads/{upload_id}/model", "A")
    mb = body(r)
    note("finalize_model", code=r.status_code, seconds=round(time.time() - t0, 1),
         byte_size=mb.get("byte_size") if r.ok else mb, model_id=mb.get("model_id") if r.ok else None,
         metadata_matched=mb.get("metadata_matched") if r.ok else None)
    ids["uploaded_model_id"] = mb.get("model_id")
    ids_save(ids)

    upload_id, _ = stage("model", model, "A")
    form = {"model_upload_id": upload_id, "symbol": "AAPL", "tp_pct": "2", "sl_pct": "1", "run_time": "09:30",
            "img_size": "224", "confidence_threshold": "0.5", "name": "staging-big-model-bot"}
    r = call("POST", "/api/bots", "B", data=form)
    note("isolation_B_create_bot_with_A_upload", code=r.status_code)
    t0 = time.time()
    r = call("POST", "/api/bots", "A", data=form)
    bb = body(r)
    note("create_bot", code=r.status_code, seconds=round(time.time() - t0, 1),
         bot_id=bb.get("id") if r.ok else bb, model_path=bb.get("model_path") if r.ok else None)
    ids["bot_id"] = bb.get("id")
    ids_save(ids)
    r = call("GET", "/api/bots", "B")
    note("bots_list_B", code=r.status_code, has_A_bot=str(ids["bot_id"]) in json.dumps(body(r)))
    note("isolation_B_bot", code=call("GET", f"/api/bots/{ids['bot_id']}", "B").status_code)


def phase_bot_result():
    ids = ids_load()
    bot_id = ids["bot_id"]
    r = call("GET", f"/api/bots/{bot_id}", "A")
    note("bot_A", code=r.status_code, body=body(r) if not r.ok else {k: body(r).get(k) for k in (
        "id", "last_run_status", "last_run_at", "last_signal", "last_confidence", "last_error", "model_filename")})
    for path in (f"/api/bots/{bot_id}/runs", f"/api/bots/{bot_id}/runs?limit=5"):
        r = call("GET", path, "A")
        if r.ok:
            runs = body(r)
            rows = runs if isinstance(runs, list) else runs.get("runs", runs)
            note("bot_runs_A", path=path, code=r.status_code, runs=rows[:3] if isinstance(rows, list) else rows)
            break
        note("bot_runs_A_try", path=path, code=r.status_code)


if __name__ == "__main__":
    phase = sys.argv[1]
    {"upload": phase_upload, "train": phase_train, "download": phase_download,
     "model_upload": phase_model_upload, "bot_result": phase_bot_result}[phase]()
    (OUT / f"v2_{phase}.json").write_text(json.dumps(d.log, indent=2, default=str))
