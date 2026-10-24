"""CNN interpretability lab API.

All endpoints resolve models and datasets through the owner's namespace and never return storage
paths. Single-image calls are synchronous and bounded; multi-image experiments run as lab jobs
inside an analysis session (a pipeline run of tool ``analysis``).
"""
from __future__ import annotations

import base64
import os
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from app.auth import get_current_user_id
from app.config import AUTH_REQUIRED, MODEL_STORAGE_ROOT
from app.ownership import assert_cross_owned, assert_run_owner, lookup_run_owner
from app.paths import canonical_user_id, find_local_keras_file, is_user_uuid, run_dir_for, runs_root, validate_id
from app.services.cnn_lab import core, experiments, findings, jobs

router = APIRouter(prefix="/api/lab", tags=["cnn-lab"])

ModelKind = Literal["trained", "uploaded"]


# --------------------------------------------------------------------------- resolution


class Resolved:
    def __init__(self, *, model_kind: str, model_id: str, model_path: str, trainer_dir: Optional[str], dataset_id: Optional[str], dataset_dir: Optional[str], default_dataset_id: Optional[str]):
        self.model_kind = model_kind
        self.model_id = model_id
        self.model_path = model_path
        self.trainer_dir = trainer_dir
        self.dataset_id = dataset_id
        self.dataset_dir = dataset_dir
        self.default_dataset_id = default_dataset_id


def _main():
    import app.main as main  # routers are included before main's helpers are defined

    return main


def _resolve(uid: Optional[str], model_kind: str, model_id: str, dataset_id: Optional[str]) -> Resolved:
    m = _main()
    mid = validate_id(model_id, kind="model")
    did = validate_id(dataset_id, kind="dataset") if dataset_id else None
    trainer_dir = None
    default_ds = None
    if model_kind == "trained":
        assert_cross_owned(uid, trainer_run_id=mid)
        trainer_dir = m.get_run_dir(mid)
        name = m._find_trained_model_file(trainer_dir) if os.path.isdir(trainer_dir) else None
        if not name:
            raise HTTPException(status_code=404, detail="Trained model not found")
        model_path = os.path.join(trainer_dir, name)
        meta = core.read_json(os.path.join(trainer_dir, "model_metadata.json"))
        cand = meta.get("dataset_id")
        if isinstance(cand, str) and cand:
            try:
                validate_id(cand, kind="dataset")
                assert_cross_owned(uid, dataset_id=cand)
                default_ds = cand
            except HTTPException:
                default_ds = None
    elif model_kind == "uploaded":
        assert_cross_owned(uid, model_id=mid)
        found = find_local_keras_file(Path(MODEL_STORAGE_ROOT), mid, uid)
        if found is None or not found.is_file():
            raise HTTPException(status_code=404, detail="Uploaded model not found")
        model_path = str(found)
    else:
        raise HTTPException(status_code=422, detail="model_kind must be trained or uploaded")
    did = did or default_ds
    ddir = None
    if did:
        assert_cross_owned(uid, dataset_id=did)
        located = m._locate_dataset_dir(did, uid)
        if not located:
            raise HTTPException(status_code=404, detail="Dataset not found")
        ddir = located
    return Resolved(model_kind=model_kind, model_id=mid, model_path=model_path, trainer_dir=trainer_dir, dataset_id=did, dataset_dir=ddir, default_dataset_id=default_ds)


def _load_model(r: Resolved) -> core.LoadedModel:
    try:
        return core.get_model(r.model_path)
    except core.UnsupportedModel as exc:
        raise HTTPException(status_code=422, detail=f"This model cannot be analysed: {exc}") from exc
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="The model file could not be loaded") from exc


def _require_dataset(r: Resolved) -> str:
    if not r.dataset_dir:
        raise HTTPException(status_code=422, detail="Choose a dataset")
    images = core.images_dir_for(r.dataset_dir)
    if not os.path.isdir(images):
        raise HTTPException(status_code=404, detail="Dataset has no images")
    return images


def _layout(r: Resolved) -> Dict[str, Any]:
    summary = core.read_json(os.path.join(r.dataset_dir, "summary.json")) if r.dataset_dir else {}
    source = summary.get("source")
    return {"verified": source == "generator", "source": source if isinstance(source, str) else None}


def _partitions(r: Resolved) -> Optional[Dict[str, str]]:
    if r.model_kind != "trained" or not r.trainer_dir or r.dataset_id != r.default_dataset_id:
        return None
    return core.recorded_partitions(r.trainer_dir)


def _split(r: Resolved, order: List[str]):
    """Validation membership applies only when the dataset is the one the model was trained on."""
    if r.model_kind != "trained" or not r.trainer_dir:
        return "not_applicable", None, "Uploaded models carry no training split."
    if not r.default_dataset_id or r.dataset_id != r.default_dataset_id:
        return "not_applicable", None, "This dataset is not the one the model was trained on; every image is unseen by training."
    parts = _partitions(r)
    if parts is not None:
        held_out = {i for i, p in parts.items() if p != "training"}
        return (
            "recorded",
            held_out,
            "Training, validation, test and excluded (purged) images were recorded by the trainer; only training images were seen during training.",
        )
    st = core.read_json(os.path.join(r.trainer_dir, "training_state.json"))
    sm = core.read_json(os.path.join(r.trainer_dir, "summary.json"))
    status, val = core.split_membership(order, st, sm)
    note = {
        "recorded": "Validation images were recorded by the trainer.",
        "reconstructed": "Validation membership was re-derived from the seed and folder order; it matches the recorded counts but is not verified file by file.",
        "unknown": "Validation membership could not be determined for this run, so images cannot be marked as seen or unseen.",
    }[status]
    return status, val, note


def _identity(r: Resolved, lm: core.LoadedModel, split_status: str) -> Dict[str, Any]:
    return {
        "model": {"kind": r.model_kind, "id": r.model_id},
        "dataset_id": r.dataset_id,
        "fingerprint": lm.fingerprint,
        "preprocessing": core.PREPROCESS_ID,
        "input_size": list(lm.input_size),
        "split_status": split_status,
    }


def _ctx(r: Resolved, lm: core.LoadedModel) -> experiments.Ctx:
    images = _require_dataset(r)
    recs, order = core.scan_images(images)
    status, val, _ = _split(r, order)
    return experiments.Ctx(
        lm=lm, images_dir=images, records=recs, split_status=status, val_set=val, layout=_layout(r),
        partitions=_partitions(r) if status == "recorded" else None,
    )


# --------------------------------------------------------------------------- context & images


@router.get("/context")
def lab_context(request: Request, model_kind: ModelKind, model_id: str, dataset_id: Optional[str] = None) -> Dict[str, Any]:
    uid = get_current_user_id(request)
    r = _resolve(uid, model_kind, model_id, dataset_id)
    lm = _load_model(r)
    out: Dict[str, Any] = {
        "model": {"kind": r.model_kind, "id": r.model_id, **lm.describe()},
        "default_dataset_id": r.default_dataset_id,
        "dataset": None,
        "methods": core.METHOD_NOTES,
        "baselines": experiments.BASELINE_NOTES,
        "limits": experiments.LIMITS,
    }
    if r.dataset_dir:
        images = _require_dataset(r)
        recs, order = core.scan_images(images)
        status, val, note = _split(r, order)
        labels: Dict[str, int] = {}
        symbols: Dict[str, int] = {}
        ends = [x.end for x in recs if x.end]
        for x in recs:
            labels[str(x.label)] = labels.get(str(x.label), 0) + 1
            if x.symbol:
                symbols[x.symbol] = symbols.get(x.symbol, 0) + 1
        out["dataset"] = {
            "id": r.dataset_id,
            "n_images": len(recs),
            "truncated": len(order) > len(recs),
            "labels": labels,
            "symbols": sorted(({"symbol": k, "n": v} for k, v in symbols.items()), key=lambda d: -d["n"])[:200],
            "date_range": [min(ends), max(ends)] if ends else None,
            "layout": _layout(r),
            "split": {"status": status, "n_validation": len(val) if val is not None else None, "note": note},
        }
    return out


@router.get("/images")
def lab_images(
    request: Request,
    model_kind: ModelKind,
    model_id: str,
    dataset_id: str,
    label: Optional[int] = None,
    symbol: Optional[str] = None,
    split: Literal["all", "validation", "training", "test", "excluded"] = "all",
    q: Optional[str] = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(48, ge=1, le=96),
    predict: bool = False,
) -> Dict[str, Any]:
    uid = get_current_user_id(request)
    r = _resolve(uid, model_kind, model_id, dataset_id)
    lm = _load_model(r) if predict else None
    images = _require_dataset(r)
    recs, order = core.scan_images(images)
    status, val, _ = _split(r, order)
    if split != "all" and val is None:
        raise HTTPException(status_code=422, detail="Validation membership is not available for this model and dataset")
    sel = recs
    if label is not None:
        sel = [x for x in sel if x.label == label]
    if symbol:
        sel = [x for x in sel if x.symbol == symbol]
    if split != "all":
        sel = [x for x in sel if (x.id in val) == (split == "validation")]
    if q:
        ql = q.lower()
        sel = [x for x in sel if ql in x.id.lower()]
    page = sel[offset : offset + limit]
    items = [{**x.to_dict(), "split": None if val is None else ("validation" if x.id in val else "training")} for x in page]
    if lm is not None and page:
        probs, _ = core.predict(lm, core.load_batch([os.path.join(images, x.id) for x in page], lm.input_size))
        for it, p in zip(items, probs):
            it["probs"] = [float(v) for v in p]
            it["pred"] = int(p.argmax())
    return {"total": len(sel), "offset": offset, "items": items, "split_status": status}


@router.get("/image")
def lab_image(request: Request, model_kind: ModelKind, model_id: str, dataset_id: str, image_id: str, alpha: bool = False) -> Response:
    """The image exactly as the model receives it (decoded RGB, resized with AREA).

    With ``alpha=true`` the same RGB is returned with the source chart's transparency re-attached.
    """
    uid = get_current_user_id(request)
    r = _resolve(uid, model_kind, model_id, dataset_id)
    lm = _load_model(r)
    path = core.image_path(_require_dataset(r), image_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Image not found")
    png = core.display_png_bytes(path, lm.input_size) if alpha else core.input_png_bytes(core.load_model_input(path, lm.input_size))
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


# --------------------------------------------------------------------------- single-image tools


class ModelRef(BaseModel):
    model_kind: ModelKind
    model_id: str
    dataset_id: Optional[str] = None


class ExplainRequest(ModelRef):
    image_id: str
    target: Optional[str] = "predicted"
    layer: Optional[str] = None
    methods: List[Literal["gradcam", "saliency", "smoothgrad", "occlusion", "activations"]] = Field(default_factory=lambda: ["gradcam"])
    channels: Optional[List[int]] = None
    top_channels: int = Field(16, ge=1, le=64)


_explain_cache: "OrderedDict[tuple, Dict[str, Any]]" = OrderedDict()
_explain_lock = threading.Lock()
EXPLAIN_CACHE_SIZE = 64


def _image_meta(r: Resolved, images: str, image_id: str) -> Dict[str, Any]:
    recs, order = core.scan_images(images)
    _, val, _ = _split(r, order)
    rec = core.parse_filename(image_id)
    return {**rec.to_dict(), "split": None if val is None else ("validation" if image_id in val else "training")}


@router.post("/explain")
def lab_explain(body: ExplainRequest, request: Request) -> Dict[str, Any]:
    uid = get_current_user_id(request)
    r = _resolve(uid, body.model_kind, body.model_id, body.dataset_id)
    lm = _load_model(r)
    images = _require_dataset(r)
    path = core.image_path(images, body.image_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Image not found")
    methods = list(dict.fromkeys(body.methods))
    key = (lm.fingerprint, core.PREPROCESS_ID, r.dataset_id, body.image_id, body.target, body.layer, tuple(methods), tuple(body.channels or ()), body.top_channels)
    with _explain_lock:
        hit = _explain_cache.get(key)
        if hit is not None:
            _explain_cache.move_to_end(key)
            return hit
    try:
        x = core.load_model_input(path, lm.input_size)
        res = core.explain_image(lm, x, target=body.target, layer=body.layer, methods=methods, top_channels=body.top_channels, channels=body.channels)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    res["image"] = _image_meta(r, images, body.image_id)
    res["identity"] = {"fingerprint": lm.fingerprint, "preprocessing": core.PREPROCESS_ID, "input_size": list(lm.input_size)}
    res = jobs.sanitize(res)
    with _explain_lock:
        _explain_cache[key] = res
        while len(_explain_cache) > EXPLAIN_CACHE_SIZE:
            _explain_cache.popitem(last=False)
    return res


class InterveneRequest(ModelRef):
    image_id: str
    rect: List[float] = Field(..., min_length=4, max_length=4)
    baseline: Literal["white", "black", "blur"] = "white"
    target: Optional[str] = "predicted"


@router.post("/intervene")
def lab_intervene(body: InterveneRequest, request: Request) -> Dict[str, Any]:
    uid = get_current_user_id(request)
    r = _resolve(uid, body.model_kind, body.model_id, body.dataset_id)
    lm = _load_model(r)
    path = core.image_path(_require_dataset(r), body.image_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Image not found")
    try:
        res = experiments.intervene_single(lm, core.load_model_input(path, lm.input_size), tuple(body.rect), body.baseline, body.target)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    res["modified_png"] = base64.b64encode(res["modified_png"]).decode("ascii")
    return jobs.sanitize(res)


class ActMaxRequest(ModelRef):
    layer: str
    channel: int = Field(..., ge=0)
    steps: int = Field(96, ge=8, le=200)
    seed: int = 0


@router.post("/actmax")
def lab_actmax(body: ActMaxRequest, request: Request) -> Dict[str, Any]:
    uid = get_current_user_id(request)
    r = _resolve(uid, body.model_kind, body.model_id, body.dataset_id)
    lm = _load_model(r)
    conv = {c["name"]: c for c in lm.conv_layers}
    if body.layer not in conv or body.channel >= int(conv[body.layer]["output_shape"][-1]):
        raise HTTPException(status_code=422, detail="Unknown layer or channel")
    res = experiments.activation_maximization(lm, body.layer, body.channel, steps=body.steps, seed=body.seed)
    res["png"] = base64.b64encode(res["png"]).decode("ascii")
    return jobs.sanitize(res)


# --------------------------------------------------------------------------- sessions & jobs


def _session_dir(uid: Optional[str], session_id: str) -> str:
    if not jobs.valid_session_id(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    if AUTH_REQUIRED and not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if lookup_run_owner(session_id):
        if AUTH_REQUIRED:
            assert_run_owner(session_id, uid)
        d = _main().get_run_dir(session_id)
    else:
        d = str(run_dir_for(session_id, uid))
    meta = jobs.read_session(d)
    if meta is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if AUTH_REQUIRED and str(meta.get("owner") or "") != str(uid):
        raise HTTPException(status_code=404, detail="Session not found")
    return d


def _session_public(meta: Dict[str, Any]) -> Dict[str, Any]:
    return {k: meta.get(k) for k in ("session_id", "model", "dataset_id", "fingerprint", "created_at", "registered")}


def _latest_results(d: str) -> Dict[str, Dict[str, Any]]:
    latest: Dict[str, Dict[str, Any]] = {}
    for j in jobs.list_jobs(d):
        if j.get("status") == "succeeded" and j.get("kind") not in latest:
            res = jobs.read_result(d, j["job_id"])
            if res:
                latest[j["kind"]] = res
    return latest


class JobRequest(ModelRef):
    session_id: Optional[str] = None
    kind: Literal["atlas", "sensitivity", "faithfulness", "features", "embedding"]
    params: Dict[str, Any] = Field(default_factory=dict)


ALLOWED_PARAMS = {
    "atlas": {"n", "seed", "layer", "target", "filters"},
    "sensitivity": {"n", "seed", "filters", "baselines", "window", "stride", "occlusion", "occlusion_patch"},
    "faithfulness": {"n", "seed", "layer", "filters", "grid", "repeats", "ks", "baseline"},
    "features": {"n", "seed", "layer", "filters", "top_images"},
    "embedding": {"n", "seed", "filters"},
}
FILTER_KEYS = {"labels", "symbols", "date_from", "date_to", "split", "predicted", "outcome", "confidence_min", "confidence_max"}


def _clean_params(kind: str, params: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in params.items() if k in ALLOWED_PARAMS[kind] and v is not None}
    if "filters" in out:
        if not isinstance(out["filters"], dict):
            raise HTTPException(status_code=422, detail="filters must be an object")
        out["filters"] = {k: v for k, v in out["filters"].items() if k in FILTER_KEYS and v not in (None, "", [])}
    out.setdefault("seed", 0)
    out.setdefault("n", {"atlas": 200, "sensitivity": 100, "faithfulness": 100, "features": 200, "embedding": 500}[kind])
    try:
        out["n"] = int(out["n"])
        out["seed"] = int(out["seed"])
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="n and seed must be integers") from exc
    if out["n"] < 1 or out["n"] > experiments.LIMITS[kind]:
        raise HTTPException(status_code=422, detail=f"n must be between 1 and {experiments.LIMITS[kind]}")
    return out


def _on_finish(uid: Optional[str], session_id: str, d: str, kind: str):
    def done(status: str, message: Optional[str]) -> None:
        if status != "succeeded":
            return
        m = _main()
        meta = jobs.read_session(d) or {}
        try:
            jobs.write_json(os.path.join(jobs.lab_dir(d), "findings.json"), findings.derive(_latest_results(d)))
        except Exception:
            m.logger.exception("Could not write findings for %s", session_id)
        if not meta.get("registered"):
            m.register_run(session_id, "analysis", f"/tools/analysis?session={session_id}", user_id=uid, status="running", charge=False)
            meta["registered"] = True
            jobs.write_session(d, meta)
        m.update_run_progress(session_id, 1.0, "done", f"Lab: {kind} completed", "succeeded")

    return done


@router.post("/jobs")
def lab_submit_job(body: JobRequest, request: Request) -> Dict[str, Any]:
    uid = get_current_user_id(request)
    if body.session_id:
        d = _session_dir(uid, body.session_id)
        meta = jobs.read_session(d) or {}
        model = meta.get("model") or {}
        r = _resolve(uid, model.get("kind"), model.get("id"), meta.get("dataset_id"))
        session_id = body.session_id
    else:
        r = _resolve(uid, body.model_kind, body.model_id, body.dataset_id)
        session_id, d, meta = None, None, None
    lm = _load_model(r)
    images = _require_dataset(r)
    if meta is not None and meta.get("fingerprint") != lm.fingerprint:
        raise HTTPException(status_code=409, detail="The model file changed since this session started; start a new session")
    params = _clean_params(body.kind, body.params)
    recs, order = core.scan_images(images)
    status, _, _ = _split(r, order)
    identity = {**_identity(r, lm, status), "method_version": experiments.METHOD_VERSION[body.kind]}

    if d is not None:
        for j in jobs.list_jobs(d):
            if j.get("kind") == body.kind and j.get("status") == "succeeded" and j.get("params") == params:
                pj = jobs.read_json(os.path.join(jobs.job_dir(d, j["job_id"]), "params.json")) or {}
                if (
                    pj.get("fingerprint") == lm.fingerprint
                    and pj.get("preprocessing") == core.PREPROCESS_ID
                    and pj.get("method_version", 1) == identity["method_version"]
                ):
                    return {"session_id": session_id, "job_id": j["job_id"], "reused": True}

    if session_id is None:
        session_id = jobs.new_session_id()
        d = str(run_dir_for(session_id, uid))
        os.makedirs(d, exist_ok=True)
        meta = {
            "session_id": session_id,
            "owner": uid,
            "model": {"kind": r.model_kind, "id": r.model_id},
            "dataset_id": r.dataset_id,
            "fingerprint": lm.fingerprint,
            "created_at": time.time(),
            "registered": False,
        }
        jobs.write_session(d, meta)
        ctx_doc = {"source": "lab", "model_id": r.model_id, "dataset_id": r.dataset_id, "created_at": meta["created_at"]}
        if r.model_kind == "trained":
            ctx_doc["source_trainer_run_id"] = r.model_id
        jobs.write_json(os.path.join(d, "analysis_context.json"), ctx_doc)

    try:
        job_id = jobs.submit(d, body.kind, params, identity, lambda: _ctx(r, core.get_model(r.model_path)), _on_finish(uid, session_id, d, body.kind))
    except RuntimeError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    return {"session_id": session_id, "job_id": job_id, "reused": False}


@router.get("/sessions")
def lab_sessions(request: Request, model_kind: Optional[ModelKind] = None, model_id: Optional[str] = None) -> Dict[str, Any]:
    """The caller's lab sessions, newest first (optionally for one model)."""
    uid = get_current_user_id(request)
    if AUTH_REQUIRED and not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    root = runs_root() / canonical_user_id(uid) if is_user_uuid(uid) else runs_root()
    out = []
    if root.is_dir():
        for child in root.iterdir():
            if not child.is_dir() or not jobs.valid_session_id(child.name):
                continue
            meta = jobs.read_session(str(child))
            if not meta or (AUTH_REQUIRED and str(meta.get("owner")) != str(uid)):
                continue
            if model_id and (meta.get("model") or {}).get("id") != model_id:
                continue
            if model_kind and (meta.get("model") or {}).get("kind") != model_kind:
                continue
            js = jobs.list_jobs(str(child))
            out.append({**_session_public(meta), "jobs": len(js), "completed": sorted({j["kind"] for j in js if j.get("status") == "succeeded"})})
    out.sort(key=lambda s: s.get("created_at") or 0, reverse=True)
    return {"sessions": out[:50]}


@router.get("/sessions/{session_id}")
def lab_session(session_id: str, request: Request) -> Dict[str, Any]:
    d = _session_dir(get_current_user_id(request), session_id)
    meta = jobs.read_session(d) or {}
    return {"session": _session_public(meta), "jobs": jobs.list_jobs(d)}


@router.get("/sessions/{session_id}/jobs/{job_id}")
def lab_job(session_id: str, job_id: str, request: Request) -> Dict[str, Any]:
    d = _session_dir(get_current_user_id(request), session_id)
    if not jobs.valid_job_id(job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    st = jobs.job_status(d, job_id)
    if st is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if st.get("status") == "succeeded":
        st["result"] = jobs.read_result(d, job_id)
    return st


@router.post("/sessions/{session_id}/jobs/{job_id}/cancel")
def lab_cancel(session_id: str, job_id: str, request: Request) -> Dict[str, Any]:
    d = _session_dir(get_current_user_id(request), session_id)
    if not jobs.valid_job_id(job_id) or jobs.job_status(d, job_id) is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"cancel_requested": jobs.cancel(job_id)}


@router.get("/sessions/{session_id}/findings")
def lab_findings(session_id: str, request: Request) -> Dict[str, Any]:
    d = _session_dir(get_current_user_id(request), session_id)
    return jobs.sanitize(findings.derive(_latest_results(d)))
