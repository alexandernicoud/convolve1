"""Trained models in the library and the Improve session/decision endpoints, through the HTTP API."""

from __future__ import annotations

import json
import uuid

from app.main import _trainer_output_complete, all_runs
from app.ownership import record_pipeline_run
from app.paths import run_dir_for


def _headers(client, user_id: uuid.UUID) -> dict:
    from tests.conftest import mint_token

    headers = {"Authorization": f"Bearer {mint_token(user_id)}"}
    client.get("/api/me", headers=headers)
    return headers


def _summary(auc, *, seed=1, lr=0.001, experiment=None):
    cfg = {"dataset_id": "ds1", "val_split": 0.2, "random_seed": seed, "model_name": "m.keras"}
    if experiment:
        cfg["experiment"] = experiment
    return {
        "config": cfg,
        "options": {"optimizer": {"name": "adam", "learning_rate": lr}, "protocol": 3},
        "evaluation": {"validation": {"n": 20000, "roc_auc": auc, "baseline_accuracy": 0.5}},
        "saved_weights_metrics": {"accuracy": 0.7, "val_accuracy": 0.6, "val_loss": 0.67},
        "model": {"parameters": 1000},
        "reproducibility": {"random_seed": seed},
        "val_samples": 20000,
    }


def _run(user, *, status="succeeded", summary=True, auc=0.55, seed=1, lr=0.001, experiment=None) -> str:
    """A trainer run as the job leaves it: run folder, model file, optional summary, owned row."""
    run_id = f"imp_{uuid.uuid4().hex[:12]}"
    d = run_dir_for(run_id, str(user))
    d.mkdir(parents=True, exist_ok=True)
    (d / "m.keras").write_bytes(b"PK\x03\x04model")
    cfg = {"model_name": "m.keras", **({"experiment": experiment} if experiment else {})}
    (d / "model_metadata.json").write_text(json.dumps({"dataset_id": "ds1", "training_config": cfg}), encoding="utf-8")
    if summary:
        (d / "summary.json").write_text(json.dumps(_summary(auc, seed=seed, lr=lr, experiment=experiment)), encoding="utf-8")
    record_pipeline_run(run_id, str(user), "trainer", status=status)
    all_runs.pop(run_id, None)
    return run_id


def _exp(parent, anchor, key, replicate=0, selection_history=None):
    e = {"parent_run_id": parent, "anchor_run_id": anchor, "variant_key": key, "replicate": replicate, "version": 2}
    if selection_history:
        e["selection_history"] = selection_history
    return e


def _listed(client, headers):
    models = client.get("/api/models", headers=headers).json()["models"]
    return {m["training_run_id"]: m for m in models if m["kind"] == "trained"}


# --------------------------------------------------------------------------- library access


def test_output_completeness_rule():
    assert _trainer_output_complete("succeeded", has_summary=False, manifest_status=None)
    for bad in ("failed", "cancelled"):
        assert not _trainer_output_complete(bad, has_summary=True, manifest_status=None)
    assert not _trainer_output_complete("running", has_summary=False, manifest_status=None)
    assert _trainer_output_complete(None, has_summary=True, manifest_status=None)


def test_only_completed_runs_are_listed_as_saved_models(client, user_a):
    headers = _headers(client, user_a)
    done = _run(user_a)
    failed = _run(user_a, status="failed")
    cancelled = _run(user_a, status="cancelled")
    running = _run(user_a, status="running", summary=False)
    listed = _listed(client, headers)
    assert done in listed and listed[done]["lifecycle"] == "model"
    for rid in (failed, cancelled, running):
        assert rid not in listed
    # A page refresh lists the same model again.
    assert done in _listed(client, headers)


def test_models_are_private_to_their_owner(client, user_a, user_b):
    run_id = _run(user_a)
    other = _headers(client, user_b)
    assert run_id not in _listed(client, other)
    assert client.get(f"/api/improve/sessions/{run_id}", headers=other).status_code in (403, 404)
    res = client.post(f"/api/improve/candidates/{run_id}/decision", json={"decision": "keep", "confirm": True}, headers=other)
    assert res.status_code in (403, 404)


# --------------------------------------------------------------------------- sessions and decisions


def test_variant_opens_the_session_of_its_original(client, user_a):
    headers = _headers(client, user_a)
    anchor = _run(user_a)
    v1 = _run(user_a, lr=0.01, experiment=_exp(anchor, anchor, "lr_low"))
    v2 = _run(user_a, lr=0.0001, experiment=_exp(v1, anchor, "lr_high"))
    legacy = _run(user_a, seed=7, experiment={"parent_run_id": v1, "variant_key": "seed"})

    res = client.get(f"/api/improve/sessions/{v2}", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["anchor"]["run_id"] == anchor and body["opened_from_variant"] is True
    ids = {e["run_id"] for e in body["experiments"]}
    assert {v1, v2, legacy} <= ids
    assert all(e["lifecycle"] == "candidate" for e in body["experiments"])
    # With only the original run the noise is unknown: no clear verdict for anyone.
    assert all(e["verdict"]["verdict"] in ("insufficient_evidence", "replicate") for e in body["experiments"])

    # Undecided candidates are marked in the library so lists can keep them out of the overview.
    listed = _listed(client, headers)
    assert listed[v1]["lifecycle"] == "candidate" and listed[v1]["improve"]["anchor_run_id"] == anchor
    assert listed[anchor]["lifecycle"] == "model"


def test_a_candidate_is_not_a_new_original_until_kept(client, user_a):
    headers = _headers(client, user_a)
    anchor = _run(user_a)
    v = _run(user_a, lr=0.01, experiment=_exp(anchor, anchor, "lr_low"))
    assert client.get(f"/api/improve/sessions/{v}?anchor=self", headers=headers).status_code == 409
    keep = client.post(f"/api/improve/candidates/{v}/decision", json={"decision": "keep", "confirm": True}, headers=headers)
    assert keep.status_code == 200, keep.text
    own = client.get(f"/api/improve/sessions/{v}?anchor=self", headers=headers).json()
    assert own["anchor"]["run_id"] == v and own["opened_from_variant"] is False


def test_decisions_need_confirmation_and_never_delete(client, user_a):
    headers = _headers(client, user_a)
    anchor = _run(user_a)
    v = _run(user_a, lr=0.01, experiment=_exp(anchor, anchor, "lr_low"))
    url = f"/api/improve/candidates/{v}/decision"

    assert client.post(url, json={"decision": "keep"}, headers=headers).status_code == 400
    assert client.post(url, json={"decision": "delete", "confirm": True}, headers=headers).status_code == 400
    ordinary = client.post(f"/api/improve/candidates/{anchor}/decision", json={"decision": "discard", "confirm": True}, headers=headers)
    assert ordinary.status_code == 400

    kept = client.post(url, json={"decision": "keep", "confirm": True, "preferred": True}, headers=headers).json()
    assert kept["lifecycle"] == "kept" and kept["decision"]["preferred"] is True
    assert _listed(client, headers)[v]["lifecycle"] == "kept"

    archived = client.post(url, json={"decision": "discard", "confirm": True}, headers=headers).json()
    assert archived["lifecycle"] == "archived"
    row = _listed(client, headers)[v]
    assert row["archived"] is True  # hidden by the library's archive filter, still listed and recoverable
    assert (run_dir_for(v, str(user_a)) / "m.keras").is_file()

    restored = client.post(url, json={"decision": "restore", "confirm": True}, headers=headers).json()
    assert restored["lifecycle"] == "candidate"
    assert [h["action"] for h in restored["decision"]["history"]] == ["keep", "discard", "restore"]
    assert _listed(client, headers)[v]["archived"] is False


def test_only_one_preferred_model_per_session(client, user_a):
    headers = _headers(client, user_a)
    anchor = _run(user_a)
    a = _run(user_a, lr=0.01, experiment=_exp(anchor, anchor, "lr_low"))
    b = _run(user_a, lr=0.0001, experiment=_exp(anchor, anchor, "lr_high"))
    for rid in (a, b):
        r = client.post(f"/api/improve/candidates/{rid}/decision", json={"decision": "keep", "confirm": True, "preferred": True}, headers=headers)
        assert r.status_code == 200, r.text
    listed = _listed(client, headers)
    assert listed[b]["improve"]["preferred"] is True and listed[a]["improve"]["preferred"] is False


def test_unfinished_experiment_cannot_be_kept(client, user_a):
    headers = _headers(client, user_a)
    anchor = _run(user_a)
    v = _run(user_a, status="running", summary=False, experiment=_exp(anchor, anchor, "lr_low"))
    res = client.post(f"/api/improve/candidates/{v}/decision", json={"decision": "keep", "confirm": True}, headers=headers)
    assert res.status_code == 409


def test_new_experiment_is_anchored_and_inherits_session_history(client, user_a):
    from app.main import _experiment_record

    _headers(client, user_a)
    anchor = _run(user_a)
    hist = [{"kind": "backtest", "run_id": "bt_seen", "dataset_id": "ds_test", "first_decision": "2024-01-02", "last_decision": "2024-06-28"}]
    sibling = _run(user_a, lr=0.01, experiment=_exp(anchor, anchor, "lr_low", selection_history=hist))
    rec = _experiment_record({"parent_run_id": sibling, "variant_key": "smaller", "origin": "model-health"}, str(user_a))
    assert rec["anchor_run_id"] == anchor and rec["session_id"] == f"imp_{anchor}"
    assert [h["run_id"] for h in rec["selection_history"]] == ["bt_seen"]

    fresh = _run(user_a)
    rec2 = _experiment_record({"parent_run_id": fresh, "variant_key": "seed", "replicate": 1}, str(user_a))
    assert rec2["anchor_run_id"] == fresh and rec2["selection_history"] == [] and rec2["replicate"] == 1


def test_session_and_candidate_survive_restart_without_local_files(client, user_a, tmp_path):
    import shutil

    from app.main import update_run_progress
    from app.services.durable_outputs import LocalCopyStore, set_artifact_store

    set_artifact_store(LocalCopyStore(tmp_path / "durable"))
    try:
        headers = _headers(client, user_a)

        def published(**kw) -> str:
            rid = _run(user_a, status="running", **kw)
            update_run_progress(rid, 1.0, "completed", "Training completed", "succeeded")
            all_runs.pop(rid, None)
            shutil.rmtree(run_dir_for(rid, str(user_a)))
            return rid

        anchor = published()
        v = published(lr=0.01, experiment=_exp(anchor, anchor, "lr_low"))
        listed = _listed(client, headers)
        assert listed[anchor]["lifecycle"] == "model"
        assert listed[v]["lifecycle"] == "candidate" and listed[v]["improve"]["anchor_run_id"] == anchor
        body = client.get(f"/api/improve/sessions/{v}", headers=headers).json()
        assert body["anchor"]["run_id"] == anchor and [e["run_id"] for e in body["experiments"]] == [v]
        keep = client.post(f"/api/improve/candidates/{v}/decision", json={"decision": "keep", "confirm": True}, headers=headers)
        assert keep.status_code == 200, keep.text
        assert _listed(client, headers)[v]["lifecycle"] == "kept"
    finally:
        set_artifact_store(None)


def test_session_and_candidate_survive_restart_without_local_files(client, user_a, tmp_path):
    import shutil

    from app.main import update_run_progress
    from app.services.durable_outputs import LocalCopyStore, set_artifact_store

    set_artifact_store(LocalCopyStore(tmp_path / "durable"))
    try:
        headers = _headers(client, user_a)

        def published(**kw) -> str:
            rid = _run(user_a, status="running", **kw)
            update_run_progress(rid, 1.0, "completed", "Training completed", "succeeded")
            all_runs.pop(rid, None)
            shutil.rmtree(run_dir_for(rid, str(user_a)))
            return rid

        anchor = published()
        v = published(lr=0.01, experiment=_exp(anchor, anchor, "lr_low"))
        listed = _listed(client, headers)
        assert listed[anchor]["lifecycle"] == "model"
        assert listed[v]["lifecycle"] == "candidate" and listed[v]["improve"]["anchor_run_id"] == anchor
        body = client.get(f"/api/improve/sessions/{v}", headers=headers).json()
        assert body["anchor"]["run_id"] == anchor and [e["run_id"] for e in body["experiments"]] == [v]
        keep = client.post(f"/api/improve/candidates/{v}/decision", json={"decision": "keep", "confirm": True}, headers=headers)
        assert keep.status_code == 200, keep.text
        assert _listed(client, headers)[v]["lifecycle"] == "kept"
    finally:
        set_artifact_store(None)


def test_trainer_progress_is_not_done_before_the_summary_exists(client, user_a):
    headers = _headers(client, user_a)
    rid = _run(user_a, status="running", summary=False)
    res = client.get(f"/trainer/runs/{rid}", headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["status"] != "succeeded"
