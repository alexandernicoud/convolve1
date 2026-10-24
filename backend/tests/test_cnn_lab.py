"""CNN lab: preprocessing parity, attribution correctness, experiment invariants, API isolation."""

from __future__ import annotations

import json
import math
import os
import shutil
import time
import uuid
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.db import SessionLocal
from app.models import PipelineRun, UserDataset
from app.paths import dataset_dir_for, datasets_root, run_dir_for, runs_root
from app.services.cnn_lab import core, experiments, findings, jobs, stats

SIZE = 32
SYMBOLS = ("AAA", "BBB")


# --------------------------------------------------------------------------- fixtures


def _chart(path: Path, seed: int, label: int) -> None:
    """RGBA chart-like PNG: transparent background, dark wicks, coloured bodies (like the generator)."""
    rng = np.random.default_rng(seed)
    img = np.zeros((64, 64, 4), dtype=np.uint8)
    n = 8
    level = 32.0
    for i in range(n):
        x0 = i * 8 + 2
        move = rng.normal(2 if label else -2, 3)
        top, bot = sorted([int(level), int(level + move)])
        top, bot = max(2, min(top, 60)), max(3, min(bot, 61))
        img[max(0, top - 3) : min(64, bot + 3), x0 + 2 : x0 + 3] = (26, 26, 26, 255)
        img[top : bot + 1, x0 : x0 + 5] = (13, 143, 74, 255) if move > 0 else (196, 30, 30, 255)
        level = min(58, max(6, level - move))
    Image.fromarray(img, mode="RGBA").save(path)


def _images(folder: Path, count: int = 24) -> list:
    folder.mkdir(parents=True, exist_ok=True)
    names = []
    for i in range(count):
        label = i % 2
        name = f"{SYMBOLS[i % 2]}_2020-01-{(i % 27) + 1:02d}_to_2020-02-{(i % 27) + 1:02d}_label{label}.png"
        _chart(folder / name, i, label)
        names.append(name)
    return names


def _model(path: Path) -> None:
    import keras

    keras.utils.set_random_seed(0)
    m = keras.Sequential(
        [
            keras.Input(shape=(SIZE, SIZE, 3)),
            keras.layers.Conv2D(4, 3, activation="relu"),
            keras.layers.MaxPooling2D(2),
            keras.layers.Conv2D(8, 3, activation="relu"),
            keras.layers.Flatten(),
            keras.layers.Dense(8, activation="relu"),
            keras.layers.Dense(1, activation="sigmoid"),
        ]
    )
    m.save(path)


@pytest.fixture(scope="module")
def lab_files(tmp_path_factory):
    root = tmp_path_factory.mktemp("lab")
    images = root / "images"
    names = _images(images)
    model_path = root / "model.keras"
    _model(model_path)
    return {"root": root, "images": images, "names": names, "model": model_path}


@pytest.fixture(scope="module")
def lm(lab_files):
    return core.get_model(str(lab_files["model"]))


def _ctx(lab_files, lm, *, val=None, verified=True):
    recs, _ = core.scan_images(str(lab_files["images"]))
    return experiments.Ctx(lm=lm, images_dir=str(lab_files["images"]), records=recs, split_status="recorded" if val else "not_applicable", val_set=val, layout={"verified": verified})


# --------------------------------------------------------------------------- core


def test_preprocessing_matches_trainer_pipeline(lab_files, lm):
    from runners.trainer_runner import build_image_dataset

    paths = [str(lab_files["images"] / n) for n in lab_files["names"][:4]]
    ds = build_image_dataset(paths, [0] * 4, (SIZE, SIZE), batch_size=4, shuffle=False, shuffle_seed=None)
    trainer_x = next(iter(ds))[0].numpy()
    ours = core.load_batch(paths, lm.input_size)
    assert ours.shape == trainer_x.shape
    assert np.abs(ours - trainer_x).max() == 0.0


def test_graph_predict_is_bit_identical_to_eager_forward(lab_files, lm):
    x = core.load_batch([str(lab_files["images"] / n) for n in lab_files["names"][:7]], lm.input_size)
    probs, pen = core.predict(lm, x, batch=3)  # 3, 3, 1: the short last batch retraces
    ref = [core._forward(lm, x[i : i + 3]) for i in range(0, len(x), 3)]
    np.testing.assert_array_equal(probs, np.concatenate([core.probabilities(lm, z.numpy()) for _, _, z in ref]))
    np.testing.assert_array_equal(pen, np.concatenate([p.numpy() for _, p, _ in ref]))


def test_forward_matches_keras_predict(lab_files, lm):
    x = core.load_batch([str(lab_files["images"] / n) for n in lab_files["names"][:6]], lm.input_size)
    probs, pen = core.predict(lm, x)
    ref = lm.model.predict(x, verbose=0)[:, 0]
    assert np.abs(probs[:, 1] - ref).max() < 1e-5
    assert np.allclose(probs.sum(axis=1), 1.0)
    assert pen.shape == (6, 8)


def test_class_scores_sign_for_sigmoid(lm):
    import tensorflow as tf

    z = tf.constant([[1.5], [-0.25]])
    assert np.allclose(core.class_scores(lm, z, [1, 1]).numpy(), [1.5, -0.25])
    assert np.allclose(core.class_scores(lm, z, [0, 0]).numpy(), [-1.5, 0.25])


def test_gradcam_batch_equals_single_and_matches_manual(lab_files, lm):
    import tensorflow as tf

    x = core.load_batch([str(lab_files["images"] / n) for n in lab_files["names"][:4]], lm.input_size)
    layer = lm.last_conv
    batch, _ = core.gradcam_batch(lm, x, [0, 1, 0, 1], layer)
    single, _ = core.gradcam_batch(lm, x[1:2], [1], layer)
    assert np.allclose(batch[1], single[0], atol=1e-6)

    # Manual Grad-CAM for target 0 = evidence −z
    xt = tf.convert_to_tensor(x[:1])
    with tf.GradientTape() as tape:
        tape.watch(xt)
        convs, _, z = core._forward(lm, xt)
        score = tf.reduce_sum(-z[:, 0])
    g = tape.gradient(score, convs[-1])
    w = tf.reduce_mean(g, axis=(1, 2), keepdims=True)
    manual = tf.nn.relu(tf.reduce_sum(w * convs[-1], axis=-1)).numpy()[0]
    assert np.allclose(batch[0], manual, atol=1e-6)


def test_explain_reports_normalization_and_targets(lab_files, lm):
    x = core.load_model_input(str(lab_files["images"] / lab_files["names"][0]), lm.input_size)
    res = core.explain_image(lm, x, target="1", methods=["gradcam", "saliency", "occlusion", "activations"])
    assert res["target_class"] == 1
    for m in ("gradcam", "saliency", "occlusion"):
        assert res["maps"][m]["normalization"]
        assert res["notes"][m]
    assert res["maps"]["activations"]["layer_shape"][-1] == 8
    chosen = core.explain_image(lm, x, methods=["activations"], channels=[0, 3, 99])
    assert [c["channel"] for c in chosen["maps"]["activations"]["channels"]] == [0, 3]
    with pytest.raises(ValueError):
        core.explain_image(lm, x, target="5")


def test_image_path_rejects_unsafe_ids(lab_files, tmp_path):
    images = str(lab_files["images"])
    good = lab_files["names"][0]
    assert core.image_path(images, good) is not None
    outside = tmp_path / "secret_label1.png"
    outside.write_bytes(b"x")
    os.symlink(outside, lab_files["images"] / "link_label1.png")
    try:
        for bad in ("../secret_label1.png", f"sub/{good}", "/etc/passwd", "model.keras", "", "link_label1.png"):
            assert core.image_path(images, bad) is None, bad
    finally:
        os.unlink(lab_files["images"] / "link_label1.png")


def test_split_membership_recorded_reconstructed_unknown():
    order = [f"S_2020-01-0{i}_to_2020-01-0{i}_label{i % 2}.png" for i in range(1, 10)] + ["T_2020-01-10_to_2020-01-11_label1.png"]
    status, val = core.split_membership(order, {"val_files": [order[0]]}, {})
    assert status == "recorded" and val == {order[0]}

    np.random.seed(42)
    idx = np.arange(len(order))
    np.random.shuffle(idx)
    expected_val = {order[i] for i in idx[int(len(order) * 0.8) :]}
    summary = {"config": {"random_seed": 42, "val_split": 0.2}, "train_samples": 8, "val_samples": 2}
    status, val = core.split_membership(order, {}, summary)
    assert status == "reconstructed" and val == expected_val

    status, val = core.split_membership(order[:-1], {}, summary)
    assert status == "unknown" and val is None


def test_unsupported_model_is_rejected(tmp_path):
    import keras

    m = keras.Sequential([keras.Input(shape=(8, 8, 3)), keras.layers.Flatten(), keras.layers.Dense(3, activation="relu")])
    p = tmp_path / "bad.keras"
    m.save(p)
    with pytest.raises(core.UnsupportedModel):
        core.get_model(str(p))


# --------------------------------------------------------------------------- stats & serialization


def test_stats_intervals():
    w = stats.wilson(5, 10)
    assert w["p"] == 0.5 and 0.23 < w["lo"] < 0.24 and 0.76 < w["hi"] < 0.77
    assert stats.wilson(0, 0)["p"] is None
    ci = stats.mean_ci([1.0, 2.0, 3.0, 4.0, float("nan")])
    assert ci["n"] == 4 and ci["lo"] <= 2.5 <= ci["hi"]
    assert stats.mean_ci([1.0])["lo"] is None
    assert stats.excludes({"lo": 0.1, "hi": 0.2}, 0.0) is True
    assert stats.excludes({"lo": -0.1, "hi": 0.2}, 0.0) is False
    assert stats.excludes({"lo": None, "hi": None}, 0.0) is None
    d = stats.cohen_d([1, 2, 3, 4], [5, 6, 7, 8])
    assert d["d"] < 0 and d["hi"] < 0


def test_sanitize_never_emits_nan_or_numpy():
    out = jobs.sanitize({"a": float("nan"), "b": np.float32(1.5), "c": np.array([1, np.inf]), "d": np.bool_(True)})
    assert out == {"a": None, "b": 1.5, "c": [1.0, None], "d": True}
    json.dumps(out, allow_nan=False)


# --------------------------------------------------------------------------- experiments


def test_sampling_is_reproducible_and_filtered(lab_files, lm):
    ctx = _ctx(lab_files, lm)
    a = experiments.draw_sample(ctx, 6, 3, {})
    b = experiments.draw_sample(ctx, 6, 3, {})
    c = experiments.draw_sample(ctx, 6, 4, {})
    ids = lambda s: [it["id"] for it in s["items"]]
    assert ids(a) == ids(b) and ids(a) != ids(c)
    only1 = experiments.draw_sample(ctx, 50, 0, {"labels": [1], "symbols": ["BBB"]})
    assert only1["items"] and all(it["label"] == 1 and it["symbol"] == "BBB" for it in only1["items"])
    assert only1["exhausted"] is True
    with pytest.raises(ValueError):
        experiments.filter_records(ctx, {"split": "validation"})


def test_atlas_outputs_and_invariants(lab_files, lm):
    res = experiments.run_atlas(_ctx(lab_files, lm), {"n": 12, "seed": 1})
    assert res["n_used"] + res["n_all_zero"] == len(res["items"]) == 12
    prof = res["profile"]
    t = sum(prof["time"][k]["attention"]["mean"] for k in experiments.TIME_REGIONS)
    p = sum(prof["price"][k]["attention"]["mean"] for k in experiments.PRICE_REGIONS)
    assert abs(t - 1) < 1e-6 and abs(p - 1) < 1e-6
    assert "per-image" not in res["normalization"] or res["normalization"]
    assert res["region_note"] == experiments.REGION_NOTE_VERIFIED
    unverified = experiments.run_atlas(_ctx(lab_files, lm, verified=False), {"n": 6, "seed": 1})
    assert unverified["region_note"] == experiments.REGION_NOTE_ASSUMED
    json.dumps(jobs.sanitize(res), allow_nan=False)


def test_white_masking_of_blank_region_is_a_no_op(lab_files, lm):
    x = core.load_model_input(str(lab_files["images"] / lab_files["names"][0]), lm.input_size)
    blank = np.ones_like(x)
    res = experiments.intervene_single(lm, blank, (0, 0, 0.5, 0.5), "white")
    assert res["delta_target"] == 0.0 and res["masked_foreground"] == 0.0
    changed = experiments.intervene_single(lm, x, (0, 0, 1, 1), "black")
    assert changed["masked_area"] == 1.0


def test_sensitivity_faithfulness_features_embedding_run(lab_files, lm):
    ctx = _ctx(lab_files, lm)
    sens = experiments.run_sensitivity(ctx, {"n": 6, "seed": 2, "baselines": ["white", "black"], "occlusion_patch": 16})
    assert {r["baseline"] for r in sens["regions"]} == {"white", "black"}
    assert len(sens["regions"]) == 12 and sens["occlusion"]["grid"] == [2, 2]
    faith = experiments.run_faithfulness(ctx, {"n": 6, "seed": 2, "repeats": 3, "ks": [2, 4]})
    assert [r["k"] for r in faith["rows"]] == [2, 4]
    feats = experiments.run_features(ctx, {"n": 12, "layer": lm.last_conv})
    assert len(feats["channels"]) == 8 and feats["tensor_shape"][-1] == 8
    emb = experiments.run_embedding(ctx, {"n": 20})
    assert len(emb["points"]) == 20 and sum(emb["explained_variance"]) <= 1.0 + 1e-4
    for res in (sens, faith, feats, emb):
        json.dumps(jobs.sanitize(res), allow_nan=False)


def test_findings_are_complete_and_use_fixed_vocabulary(lab_files, lm):
    ctx = _ctx(lab_files, lm)
    latest = {
        "atlas": {**experiments.run_atlas(ctx, {"n": 12, "seed": 1}), "job_id": "job_aaaaaaaaaaaa"},
        "sensitivity": {**experiments.run_sensitivity(ctx, {"n": 6, "baselines": ["white", "blur"], "occlusion": False}), "job_id": "job_bbbbbbbbbbbb"},
        "features": {**experiments.run_features(ctx, {"n": 12}), "job_id": "job_cccccccccccc"},
    }
    out = findings.derive(jobs.sanitize(latest))
    assert out["findings"]
    for f in out["findings"]:
        assert f["status"] in ("observation", "hypothesis", "supported", "inconclusive")
        assert f["title"] and f["observation"] and isinstance(f["limitations"], list)
        assert f["link"]["job_id"].startswith("job_")
    again = findings.derive(jobs.sanitize(latest))
    assert again == out


def test_findings_supported_requires_interval_excluding_baseline():
    def atlas(lo, hi):
        ci = {"mean": (lo + hi) / 2, "lo": lo, "hi": hi, "n": 50}
        flat = {"mean": 0.0, "lo": -0.01, "hi": 0.01, "n": 50}
        row = lambda e: {"attention": {"mean": 0.33}, "ink": {"mean": 0.33}, "excess_over_ink": e}
        return {
            "job_id": "job_000000000000",
            "layer": "conv",
            "target": "predicted",
            "layout": {"verified": True},
            "profile": {"n": 50, "time": {"oldest": row(flat), "middle": row(flat), "recent": row(ci)}, "price": {}},
        }

    sup = [f for f in findings.derive({"atlas": atlas(0.05, 0.12)})["findings"] if f["id"] == "atlas.time"][0]
    inc = [f for f in findings.derive({"atlas": atlas(-0.02, 0.12)})["findings"] if f["id"] == "atlas.time"][0]
    assert sup["status"] == "supported" and "recent" in sup["title"]
    assert inc["status"] == "inconclusive"


def test_sensitivity_title_does_not_claim_a_largest_region_when_intervals_overlap():
    def res(deltas):
        rows = [
            {"region": region, "baseline": b, "delta": {"mean": m, "lo": m - w, "hi": m + w, "n": 20}}
            for region, (m, w) in deltas.items()
            for b in ("white", "blur")
        ]
        return {"job_id": "job_000000000001", "regions": rows, "baselines": {"white": "", "blur": ""}, "summary": {"n": 20}, "paired": {}}

    overlap = {"time:oldest": (-0.03, 0.01), "time:recent": (-0.035, 0.01), "price:upper": (-0.025, 0.01)}
    t = [f for f in findings.derive({"sensitivity": res(overlap)})["findings"] if f["id"] == "sensitivity.region"][0]
    assert t["title"].startswith("Masking any third lowers") and "largest effect" not in t["title"]

    separated = {"time:oldest": (-0.01, 0.005), "time:recent": (-0.08, 0.01), "price:upper": (-0.012, 0.005)}
    t = [f for f in findings.derive({"sensitivity": res(separated)})["findings"] if f["id"] == "sensitivity.region"][0]
    assert t["title"] == "Masking the most recent third (right) has the largest effect"
    assert t["status"] == "supported"


# --------------------------------------------------------------------------- jobs


def test_job_lifecycle_and_interrupted_detection(lab_files, lm, tmp_path):
    session = tmp_path / "sess"
    finished = []
    jid = jobs.submit(str(session), "embedding", {"n": 10, "seed": 0}, {"fingerprint": lm.fingerprint}, lambda: _ctx(lab_files, lm), lambda s, m: finished.append(s))
    deadline = time.time() + 60
    while time.time() < deadline and not finished:
        time.sleep(0.1)
    assert finished == ["succeeded"]
    st = jobs.job_status(str(session), jid)
    assert st["status"] == "succeeded" and st["has_result"]
    assert jobs.read_result(str(session), jid)["kind"] == "embedding"

    ghost = jobs.new_job_id()
    jobs.write_json(os.path.join(jobs.job_dir(str(session), ghost), "params.json"), {"kind": "atlas", "params": {}, "created_at": 1})
    jobs.write_json(os.path.join(jobs.job_dir(str(session), ghost), "status.json"), {"status": "running"})
    assert jobs.job_status(str(session), ghost)["status"] == "interrupted"
    with pytest.raises(ValueError):
        jobs.job_dir(str(session), "../../etc")


# --------------------------------------------------------------------------- API


def _auth(client, user_id: uuid.UUID) -> dict:
    from tests.conftest import mint_token

    headers = {"Authorization": f"Bearer {mint_token(user_id)}"}
    client.get("/api/me", headers=headers)
    return headers


@pytest.fixture
def copy_store(tmp_path: Path):
    from app.services.durable_outputs import LocalCopyStore, set_artifact_store

    store = LocalCopyStore(tmp_path / "durable")
    set_artifact_store(store)
    yield store
    set_artifact_store(None)


@pytest.fixture
def seeded(client, user_a, user_b, lab_files):
    """User A owns a trained model (trainer run) and its dataset; user B owns nothing of A's."""
    ha, hb = _auth(client, user_a), _auth(client, user_b)
    run_id = f"20260101_000000_{uuid.uuid4().hex[:6]}"
    dataset_id = uuid.uuid4().hex[:8]
    db = SessionLocal()
    try:
        db.add(PipelineRun(id=run_id, user_id=user_a, tool="trainer", status="succeeded"))
        db.add(UserDataset(id=dataset_id, user_id=user_a, source="generator", kind="training"))
        db.commit()
    finally:
        db.close()
    rdir = run_dir_for(run_id, str(user_a))
    rdir.mkdir(parents=True, exist_ok=True)
    shutil.copy(lab_files["model"], rdir / "model.keras")
    (rdir / "model_metadata.json").write_text(json.dumps({"dataset_id": dataset_id}))
    (rdir / "summary.json").write_text(json.dumps({"config": {"random_seed": 42, "val_split": 0.2}, "train_samples": 19, "val_samples": 5}))
    ddir = dataset_dir_for(dataset_id, str(user_a))
    shutil.copytree(lab_files["images"], ddir / "images")
    (ddir / "summary.json").write_text(json.dumps({"dataset_id": dataset_id, "source": "generator", "extracted_path": str(ddir)}))
    yield {"ha": ha, "hb": hb, "run_id": run_id, "dataset_id": dataset_id, "rdir": rdir, "ddir": ddir}
    for uid in (user_a, user_b):
        for root in (runs_root(), datasets_root()):
            shutil.rmtree(root / str(uid), ignore_errors=True)


def _ref(s):
    return {"model_kind": "trained", "model_id": s["run_id"], "dataset_id": s["dataset_id"]}


def test_lab_context_owner_only_and_no_paths(client, seeded):
    s = seeded
    r = client.get("/api/lab/context", params={"model_kind": "trained", "model_id": s["run_id"]}, headers=s["ha"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["default_dataset_id"] == s["dataset_id"]
    assert body["dataset"]["n_images"] == 24 and body["dataset"]["layout"]["verified"] is True
    assert body["dataset"]["split"]["status"] == "reconstructed"
    assert str(runs_root()) not in r.text and str(datasets_root()) not in r.text and "extracted_path" not in r.text
    assert client.get("/api/lab/context", params={"model_kind": "trained", "model_id": s["run_id"]}, headers=s["hb"]).status_code == 404
    assert client.get("/api/lab/context", params={"model_kind": "trained", "model_id": "../x"}, headers=s["ha"]).status_code in (404, 422)


def test_lab_explain_image_and_listing(client, seeded):
    s = seeded
    listing = client.get("/api/lab/images", params={**_ref(s), "label": 1, "predict": True, "limit": 5}, headers=s["ha"])
    assert listing.status_code == 200, listing.text
    items = listing.json()["items"]
    assert len(items) == 5 and all(it["label"] == 1 and "probs" in it and it["split"] in ("validation", "training") for it in items)
    img = client.get("/api/lab/image", params={**_ref(s), "image_id": items[0]["id"]}, headers=s["ha"])
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    assert Image.open(__import__("io").BytesIO(img.content)).size == (SIZE, SIZE)
    ex = client.post("/api/lab/explain", json={**_ref(s), "image_id": items[0]["id"], "methods": ["gradcam", "saliency"]}, headers=s["ha"])
    assert ex.status_code == 200, ex.text
    assert set(ex.json()["maps"]) == {"gradcam", "saliency"} and ex.json()["image"]["label"] == 1
    for bad in ("../summary.json", "x/../../model.keras"):
        assert client.post("/api/lab/explain", json={**_ref(s), "image_id": bad}, headers=s["ha"]).status_code == 404
    assert client.post("/api/lab/explain", json={**_ref(s), "image_id": items[0]["id"]}, headers=s["hb"]).status_code == 404
    iv = client.post("/api/lab/intervene", json={**_ref(s), "image_id": items[0]["id"], "rect": [0.66, 0, 1, 1], "baseline": "white"}, headers=s["ha"])
    assert iv.status_code == 200 and "modified_png" in iv.json()


def test_lab_jobs_sessions_findings_isolated(client, seeded, copy_store, user_a):
    s = seeded
    sub = client.post("/api/lab/jobs", json={**_ref(s), "kind": "atlas", "params": {"n": 8, "seed": 5, "bogus": 1}}, headers=s["ha"])
    assert sub.status_code == 200, sub.text
    sid, jid = sub.json()["session_id"], sub.json()["job_id"]
    deadline = time.time() + 90
    st = {}
    while time.time() < deadline:
        st = client.get(f"/api/lab/sessions/{sid}/jobs/{jid}", headers=s["ha"]).json()
        if st.get("status") not in ("queued", "running"):
            break
        time.sleep(0.2)
    assert st["status"] == "succeeded", st
    assert st["params"] == {"n": 8, "seed": 5}
    assert st["result"]["identity"]["fingerprint"] and "bogus" not in json.dumps(st)
    assert str(runs_root()) not in json.dumps(st)

    again = client.post("/api/lab/jobs", json={**_ref(s), "session_id": sid, "kind": "atlas", "params": {"n": 8, "seed": 5}}, headers=s["ha"])
    assert again.json() == {"session_id": sid, "job_id": jid, "reused": True}

    from app.services.cnn_lab import experiments as lab_experiments

    orig = lab_experiments.METHOD_VERSION["atlas"]
    lab_experiments.METHOD_VERSION["atlas"] = orig + 1
    try:
        bumped = client.post("/api/lab/jobs", json={**_ref(s), "session_id": sid, "kind": "atlas", "params": {"n": 8, "seed": 5}}, headers=s["ha"]).json()
        assert bumped["reused"] is False and bumped["job_id"] != jid
        deadline = time.time() + 60
        while time.time() < deadline and client.get(f"/api/lab/sessions/{sid}/jobs/{bumped['job_id']}", headers=s["ha"]).json().get("status") in ("queued", "running"):
            time.sleep(0.2)
    finally:
        lab_experiments.METHOD_VERSION["atlas"] = orig

    f = client.get(f"/api/lab/sessions/{sid}/findings", headers=s["ha"])
    assert f.status_code == 200 and f.json()["sources"]["atlas"] == bumped["job_id"]

    deadline = time.time() + 10
    row = None
    while time.time() < deadline:
        db = SessionLocal()
        try:
            row = db.get(PipelineRun, sid)
        finally:
            db.close()
        if row is not None and row.status == "succeeded":
            break
        time.sleep(0.2)
    assert row is not None and row.tool == "analysis" and row.user_id == user_a and row.status == "succeeded"

    edges = client.get("/api/review/overview", headers=s["ha"]).json()["edges"]
    pairs = {(e["source"], e["target"]) for e in edges}
    assert (f"model:{s['run_id']}", f"run:{sid}") in pairs
    assert (f"dataset:{s['dataset_id']}", f"run:{sid}") in pairs

    for path in (f"/api/lab/sessions/{sid}", f"/api/lab/sessions/{sid}/jobs/{jid}", f"/api/lab/sessions/{sid}/findings"):
        assert client.get(path, headers=s["hb"]).status_code == 404, path
    assert client.post(f"/api/lab/sessions/{sid}/jobs/{jid}/cancel", headers=s["hb"]).status_code == 404
    other = client.post("/api/lab/jobs", json={**_ref(s), "session_id": sid, "kind": "atlas", "params": {"n": 8}}, headers=s["hb"])
    assert other.status_code == 404
    assert client.get("/api/lab/sessions", headers=s["hb"]).json()["sessions"] == []
    mine = client.get("/api/lab/sessions", params={"model_id": s["run_id"]}, headers=s["ha"]).json()["sessions"]
    assert [x["session_id"] for x in mine] == [sid] and mine[0]["completed"] == ["atlas"]
    assert client.get("/api/lab/sessions/../../etc", headers=s["ha"]).status_code == 404
    assert client.post("/api/lab/jobs", json={**_ref(s), "kind": "atlas", "params": {"n": 100000}}, headers=s["ha"]).status_code == 422


# --------------------------------------------------------------------------- legacy analysis path validation


def test_legacy_analysis_ids_and_filenames_are_validated(client, seeded):
    from app.main import _analysis_dir_for, _analysis_file
    from fastapi import HTTPException

    s = seeded
    rdir = str(s["rdir"])
    adir = Path(rdir) / "analysis" / "analysis_20260101_000000_abcdef"
    adir.mkdir(parents=True)
    (adir / "gradcam.png").write_bytes(b"\x89PNG")
    for bad in ("..", ".", "analysis_../x", "summary.json", ""):
        with pytest.raises(HTTPException):
            _analysis_dir_for(rdir, bad)
    with pytest.raises(HTTPException):
        _analysis_file(rdir, "analysis_20260101_000000_abcdef", "../summary.json")
    assert _analysis_file(rdir, "analysis_20260101_000000_abcdef", "gradcam.png") is not None

    base = f"/trainer/runs/{s['run_id']}/analysis"
    ok = client.get(f"{base}/analysis_20260101_000000_abcdef/images/gradcam.png", headers=s["ha"])
    assert ok.status_code == 200
    for aid in ("..", "notanalysis"):
        r = client.get(f"{base}/{aid}/images/summary.json", headers=s["ha"])
        assert r.status_code in (400, 404), (aid, r.status_code)
        r = client.get(f"{base}/{aid}/artifacts/summary.json", headers=s["ha"])
        assert r.status_code in (400, 404), (aid, r.status_code)
    assert client.get(f"{base}/analysis_20260101_000000_abcdef/images/gradcam.png", headers=s["hb"]).status_code == 404


def test_legacy_analysis_image_must_come_from_training_dataset(seeded, user_a, tmp_path):
    from app.main import _resolve_trainer_analysis_image
    from fastapi import HTTPException

    s = seeded
    rdir = str(s["rdir"])
    images = os.path.realpath(s["ddir"] / "images")
    first = _resolve_trainer_analysis_image(rdir, None, str(user_a))
    assert first == os.path.join(images, sorted(os.listdir(images))[0])
    name = sorted(os.listdir(images))[3]
    assert _resolve_trainer_analysis_image(rdir, name, str(user_a)) == os.path.join(images, name)
    assert _resolve_trainer_analysis_image(rdir, os.path.join(images, name), str(user_a)) == os.path.join(images, name)
    outside = tmp_path / "x_label1.png"
    outside.write_bytes(b"x")
    for bad in (str(outside), "../summary.json", "/etc/passwd", os.path.join(images, "..", "summary.json")):
        with pytest.raises(HTTPException) as exc:
            _resolve_trainer_analysis_image(rdir, bad, str(user_a))
        assert exc.value.status_code == 400
    with pytest.raises(HTTPException):
        _resolve_trainer_analysis_image(rdir, name, str(uuid.uuid4()))


def test_display_png_keeps_model_rgb_and_source_alpha(tmp_path):
    import io

    src = tmp_path / "c_label1.png"
    _chart(src, seed=3, label=1)
    x = core.load_model_input(str(src), (SIZE, SIZE))
    rgb_model = np.array(Image.open(io.BytesIO(core.input_png_bytes(x))))
    disp = np.array(Image.open(io.BytesIO(core.display_png_bytes(str(src), (SIZE, SIZE)))))
    assert disp.shape == (SIZE, SIZE, 4)
    assert np.array_equal(disp[..., :3], rgb_model)
    source = np.array(Image.open(src).convert("RGBA"))
    if source.shape[:2] == (SIZE, SIZE):
        assert np.array_equal(disp[..., 3], source[..., 3])
    assert (disp[..., 3] == 0).any() and (disp[..., 3] == 255).any()

    opaque = tmp_path / "o_label0.png"
    Image.fromarray(np.full((SIZE, SIZE, 3), 255, np.uint8), mode="RGB").save(opaque)
    d2 = np.array(Image.open(io.BytesIO(core.display_png_bytes(str(opaque), (SIZE, SIZE)))))
    assert (d2[..., 3] == 255).all() and (d2[..., :3] == 255).all()
