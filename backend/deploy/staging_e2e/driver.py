"""Staging-only end-to-end driver for the Cloud Run Job CNN trainer.

Talks only to the staging API (STAGING_API_URL). Never prints tokens or secrets.
Writes a JSON log of every step to results/<phase>.json.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import jwt
import requests

API = os.environ["STAGING_API_URL"].rstrip("/")
SECRET = os.environ["STAGING_JWT_SECRET"]
assert "staging" in API, "driver must only target the staging API"

OUT = Path(__file__).parent / "results"
OUT.mkdir(exist_ok=True)
USERS = {
    "A": "a0000000-0000-4000-8000-00000000000a",
    "B": "b0000000-0000-4000-8000-00000000000b",
}
_iam = {"token": None, "at": 0.0}
log = []


def note(step, **data):
    entry = {"t": round(time.time(), 2), "step": step, **data}
    log.append(entry)
    print(json.dumps(entry, default=str)[:700], flush=True)


def iam_token():
    if time.time() - _iam["at"] > 1800:
        _iam["token"] = subprocess.check_output(["gcloud", "auth", "print-identity-token"], text=True).strip()
        _iam["at"] = time.time()
    return _iam["token"]


def app_token(user):
    now = int(time.time())
    return jwt.encode(
        {"sub": USERS[user], "aud": "authenticated", "exp": now + 3600, "iat": now,
         "email": f"staging-{user.lower()}@example.invalid", "role": "authenticated"},
        SECRET, algorithm="HS256",
    )


def call(method, path, user="A", **kw):
    headers = kw.pop("headers", {})
    headers["X-Serverless-Authorization"] = f"Bearer {iam_token()}"
    if user:
        headers["Authorization"] = f"Bearer {app_token(user)}"
    return requests.request(method, API + path, headers=headers, timeout=120, **kw)


def body(r):
    try:
        return r.json()
    except ValueError:
        return r.text[:300]


def head_download(path, user):
    r = call("GET", path, user, stream=True)
    out = {"code": r.status_code, "content_length": r.headers.get("content-length"),
           "ctype": r.headers.get("content-type")}
    r.close()
    return out


def config(dataset_id, model_name, epochs):
    return {"use_standard_config": False, "dataset_id": dataset_id, "model_name": model_name,
            "image_height": 224, "image_width": 224, "batch_size": 16, "epochs": epochs,
            "val_split": 0.2, "random_seed": 7}


def poll(run_id, user="A", timeout=1500, interval=3):
    seen, phases, start = [], [], time.time()
    last = {}
    while time.time() - start < timeout:
        pj = body(call("GET", f"/trainer/runs/{run_id}", user))
        gj = body(call("GET", f"/runs/{run_id}", user))
        api_status = pj.get("status") if isinstance(pj, dict) else None
        db_status = gj.get("status") if isinstance(gj, dict) else None
        phase = (pj.get("progress") or {}).get("phase") if isinstance(pj, dict) else None
        if not seen or seen[-1][1] != db_status:
            seen.append((round(time.time() - start, 1), db_status, api_status))
            note("transition", run_id=run_id, elapsed=seen[-1][0], db_status=db_status, api_status=api_status)
        if phase and (not phases or phases[-1][1] != phase):
            phases.append((round(time.time() - start, 1), phase, (pj.get("progress") or {}).get("percent")))
        last = pj if isinstance(pj, dict) else {}
        if api_status in ("done", "failed", "cancelled"):
            return seen, phases, last
        time.sleep(interval)
    return seen, phases, last


def ids_load():
    return json.loads((OUT / "ids.json").read_text())


def ids_save(ids):
    (OUT / "ids.json").write_text(json.dumps(ids))


def checks_after_success(run_id, dataset_id):
    note("download_model", **head_download(f"/trainer/runs/{run_id}/download/model", "A"))
    r = call("GET", f"/trainer/runs/{run_id}/model-metadata", "A")
    note("model_metadata", code=r.status_code, body=body(r))
    r = call("GET", f"/trainer/runs/{run_id}/history", "A")
    hb = body(r)
    note("history", code=r.status_code, epochs=len(hb) if isinstance(hb, list) else hb)
    r = call("GET", "/api/models", "A")
    models = body(r)
    note("models_list_A", code=r.status_code, count=len(models) if isinstance(models, list) else None,
         has_run=run_id in json.dumps(models), sample=models[:1] if isinstance(models, list) else models)

    for path in (f"/trainer/runs/{run_id}", f"/runs/{run_id}", f"/trainer/runs/{run_id}/history",
                 f"/trainer/runs/{run_id}/model-metadata", f"/datasets/{dataset_id}"):
        r = call("GET", path, "B")
        note("isolation_B", path=path, code=r.status_code)
    note("isolation_B_download", **head_download(f"/trainer/runs/{run_id}/download/model", "B"))
    r = call("POST", f"/trainer/runs/{run_id}/cancel", "B")
    note("isolation_B_cancel", code=r.status_code)
    r = call("POST", "/trainer/runs", "B", json=config(dataset_id, "b_steal.keras", 1))
    note("isolation_B_train_on_A_dataset", code=r.status_code, body=body(r))
    r = call("GET", "/api/models", "B")
    note("models_list_B", code=r.status_code, has_A_run=run_id in json.dumps(body(r)))
    r = call("GET", "/runs", "B")
    note("runs_list_B", code=r.status_code, has_A_run=run_id in json.dumps(body(r)))
    r = call("GET", f"/trainer/runs/{run_id}", None)
    note("no_app_token", code=r.status_code)
    r = call("GET", f"/trainer/runs/{run_id}", None, headers={"Authorization": "Bearer not-a-jwt"})
    note("bad_app_token", code=r.status_code)
    forged = jwt.encode({"sub": USERS["A"], "aud": "authenticated", "exp": int(time.time()) + 600},
                        "wrong-secret-" + "x" * 32, algorithm="HS256")
    r = call("GET", f"/trainer/runs/{run_id}", None, headers={"Authorization": f"Bearer {forged}"})
    note("forged_app_token", code=r.status_code)


def main(phase):
    if phase == "happy":
        for u in USERS:
            r = call("GET", "/api/me", u)
            note("api_me", user=u, code=r.status_code, body=body(r))
        r = call("GET", "/api/me", None)
        note("api_me_no_token", code=r.status_code)

        t0 = time.time()
        with open(Path(__file__).parent / "dataset240.zip", "rb") as fh:
            r = call("POST", "/datasets/upload", "A", files={"file": ("dataset240.zip", fh, "application/zip")})
        ds = body(r)
        note("upload", code=r.status_code, seconds=round(time.time() - t0, 1),
             dataset_id=ds.get("dataset_id") if r.ok else ds,
             summary=(ds.get("summary") or {}).get("label_distribution") if r.ok else None)
        dataset_id = ds["dataset_id"]

        t0 = time.time()
        r = call("POST", "/trainer/runs", "A", json=config(dataset_id, "staging_e2e.keras", 3))
        note("start", code=r.status_code, seconds=round(time.time() - t0, 2), body=body(r))
        run_id = body(r)["run_id"]
        ids_save({"dataset_id": dataset_id, "happy_run_id": run_id})
        seen, phases, last = poll(run_id)
        note("final", run_id=run_id, transitions=seen, phases=phases,
             status=last.get("status"), last_metrics=last.get("last_metrics"),
             history_len=len(last.get("history_preview") or []), artifact_paths=last.get("artifact_paths"))
        checks_after_success(run_id, dataset_id)

    elif phase == "post":
        ids = ids_load()
        checks_after_success(ids["happy_run_id"], ids["dataset_id"])

    elif phase == "failure":
        ids = ids_load()
        r = call("POST", "/trainer/runs", "A", json=config(ids["dataset_id"], "../escape.keras", 1))
        note("failure_start", code=r.status_code, body=body(r))
        if r.ok:
            run_id = r.json()["run_id"]
            seen, phases, last = poll(run_id, timeout=600)
            note("failure_final", run_id=run_id, transitions=seen, phases=phases, status=last.get("status"),
                 message=(last.get("progress") or {}).get("message"))
            note("failure_download", **head_download(f"/trainer/runs/{run_id}/download/model", "A"))
            ids["failure_run_id"] = run_id
            ids_save(ids)

    elif phase == "cancel":
        ids = ids_load()
        r = call("POST", "/trainer/runs", "A", json=config(ids["dataset_id"], "staging_cancel.keras", 15))
        note("cancel_start", code=r.status_code, body=body(r))
        run_id = r.json()["run_id"]
        start, phase_now = time.time(), None
        while time.time() - start < 600:
            pj = body(call("GET", f"/trainer/runs/{run_id}", "A"))
            phase_now = (pj.get("progress") or {}).get("phase")
            if pj.get("status") != "running" or phase_now == "training":
                break
            time.sleep(2)
        note("cancel_requested_at_phase", phase=phase_now, elapsed=round(time.time() - start, 1),
             progress=pj.get("progress"))
        r = call("POST", f"/trainer/runs/{run_id}/cancel", "A")
        note("cancel_call", code=r.status_code, body=body(r))
        seen, phases, last = poll(run_id, timeout=300)
        note("cancel_final", run_id=run_id, transitions=seen, phases=phases, status=last.get("status"),
             message=(last.get("progress") or {}).get("message"))
        note("cancel_download", **head_download(f"/trainer/runs/{run_id}/download/model", "A"))
        ids["cancel_run_id"] = run_id
        ids_save(ids)

    (OUT / f"{phase}.json").write_text(json.dumps(log, indent=2, default=str))


if __name__ == "__main__":
    main(sys.argv[1])
