from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, model_validator
from typing import Optional, Dict, Any, List, Union, Callable
import subprocess
import os
import json
import re
import time
import uuid
import zipfile
import io
from datetime import datetime
import sys
import shutil
from pathlib import Path

import logging
import threading
from threading import Thread

from app.process_registry import kill_managed, popen_managed, running_processes, wait_managed
from app.bots_api import router as bots_router, run_active_bots_once
from app.dashboard_api import router as dashboard_router
from app.config import (
    APP_MODE,
    CORS_ORIGINS,
    LIVE_DEPLOY_ENABLED,
    MODEL_STORAGE_ROOT,
    RUN_BOTS_ON_API_STARTUP,
    SCHEDULED_BOTS_ENABLED,
    configure_logging,
)
from app.services.bot_scheduler import start_bot_scheduler
from app.db import init_db
from app.routers.models_upload import router as models_upload_router
from app.services.model_paths import require_existing_model_file

app = FastAPI(title="Labeling Optimizer API", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(bots_router)
app.include_router(dashboard_router)
app.include_router(models_upload_router)

logger = logging.getLogger("app.main")

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_SCRIPTS_DIR = _BACKEND_ROOT / "scripts"


def _resolve_pipeline_script(filename: str) -> Path:
    path = _SCRIPTS_DIR / filename
    if not path.is_file():
        raise FileNotFoundError(f"Pipeline script not found (expected in backend/scripts): {path}")
    return path


@app.on_event("startup")
def startup() -> None:
    configure_logging()
    if APP_MODE == "job":
        logger.warning(
            "APP_MODE=job but this process is the FastAPI app; "
            "scheduled batches should use: python -m app.jobs.run_due_bots"
        )
    init_db()
    logger.info("Startup complete: database initialized.")
    started = start_bot_scheduler()
    if started:
        logger.info(
            "Paper bots execute in this API process (LIVE_DEPLOY_ENABLED=%s, SCHEDULED_BOTS_ENABLED=%s).",
            LIVE_DEPLOY_ENABLED,
            SCHEDULED_BOTS_ENABLED,
        )
    elif RUN_BOTS_ON_API_STARTUP and SCHEDULED_BOTS_ENABLED and LIVE_DEPLOY_ENABLED:
        logger.info(
            "Starting due-bot batch in background (RUN_BOTS_ON_API_STARTUP, "
            "SCHEDULED_BOTS_ENABLED, LIVE_DEPLOY_ENABLED are all true)"
        )
        Thread(target=run_active_bots_once, daemon=True).start()
    else:
        logger.info(
            "Scheduled/live bot execution disabled "
            "(LIVE_DEPLOY_ENABLED=%s, SCHEDULED_BOTS_ENABLED=%s).",
            LIVE_DEPLOY_ENABLED,
            SCHEDULED_BOTS_ENABLED,
        )

# Pydantic models
class RunRequest(BaseModel):
    symbol: str
    start: str
    end: str
    # Optional — persisted to optimizer_config.json; core script still uses symbol/start/end
    timeframe: Optional[str] = None
    tp_min_pct: Optional[float] = None
    tp_max_pct: Optional[float] = None
    sl_min_pct: Optional[float] = None
    sl_max_pct: Optional[float] = None
    horizon_min: Optional[int] = None
    horizon_max: Optional[int] = None
    min_trades: Optional[int] = None
    grid_tp_steps: Optional[int] = None
    grid_sl_steps: Optional[int] = None
    fee_rate_pct: Optional[float] = None
    objective: Optional[str] = None

class TrainingChartGeneratorRequest(BaseModel):
    symbols: str
    chartsPerLabel: int
    useCandles: bool
    timeframe: str  # '1d', '1wk', '1mo'
    timespanUnit: str
    timespanCount: int
    horizonBars: int
    takeProfitFraction: float
    stopLossFraction: float
    imageDimension: int
    endOffset: int
    # How to handle the natural label imbalance (label 1 is usually rarer):
    #   "match_minority" -> trim the majority class down to the minority count (balanced 50/50)
    #   "keep_all"       -> keep every generated chart (more images, imbalanced)
    balanceMode: Optional[str] = "match_minority"
    # Optional UI context (stored in generator_config.json for the results page)
    volumeMode: Optional[str] = None
    referenceEndIso: Optional[str] = None
    trainingStartIso: Optional[str] = None

class ChartPreviewRequest(BaseModel):
    """Config for a single live-preview chart (Step 3 of the generator)."""

    symbols: str
    useCandles: bool = True
    timeframe: str = "1d"  # '1d', '1wk', '1mo'
    timespanUnit: str = "months"
    timespanCount: int = 6
    horizonBars: int = 7
    takeProfitFraction: float = 0.02
    stopLossFraction: float = 0.01
    imageDimension: int = 224  # square PNG size — must match generation
    # Anchor: where the previewed example sits on the calendar.
    volumeMode: Optional[str] = None  # "by_period" | "by_charts"
    trainingStartIso: Optional[str] = None
    referenceEndIso: Optional[str] = None


class RunResponse(BaseModel):
    run_id: str

class BacktestRunRequest(BaseModel):
    """Model reference: trainer_run_id (internal trained model), model_id (upload registry id),
    or model_path (resolved by server)."""

    model_path: Optional[str] = None
    model_id: Optional[str] = None
    trainer_run_id: Optional[str] = None
    dataset_path: str
    sample_size: Union[str, int] = "all"
    confidence_threshold: float = 0.5
    tp_pct: float = 2.0
    sl_pct: float = 2.0
    img_size: int = 224
    starting_capital: float = 10000.0
    position_size_pct: float = 10.0
    commission_pct: float = 0.1
    slippage_pct: float = 0.05
    max_drawdown_pct: float = 20.0
    max_trades_per_day: int = 10

    @model_validator(mode="after")
    def _require_model_ref(self) -> "BacktestRunRequest":
        if not self.model_path and not self.model_id:
            raise ValueError("Either model_id or model_path is required")
        return self

class BacktestStatusResponse(BaseModel):
    status: str  # "queued", "running", "succeeded", "failed"
    progress: float  # 0.0 to 1.0
    message: str
    log_tail: str
    result_ready: bool

class BacktestResultResponse(BaseModel):
    kpis: Dict[str, Any]
    charts: Dict[str, str]
    trades: List[Dict[str, Any]]
    summary: Dict[str, Any]
    config: Optional[Dict[str, Any]] = None
    timestamp: Optional[str] = None
    chart_events: Optional[List[Dict[str, Any]]] = None
    series: Optional[Dict[str, Any]] = None
    benchmark: Optional[Dict[str, Any]] = None
    classification_metrics: Optional[Dict[str, Any]] = None

class ProgressResponse(BaseModel):
    phase: str
    percent: float
    elapsed_s: float
    step: Optional[int] = None
    total_steps: Optional[int] = None
    error_message: Optional[str] = None

class DatasetStats(BaseModel):
    total_charts: Optional[int] = None
    symbols_count: Optional[int] = None
    timeframe: Optional[str] = None
    chart_type: Optional[str] = None
    # Per-class counts in the final dataset ({"0": n0, "1": n1}).
    label_counts: Optional[Dict[str, int]] = None
    # Requested charts per label (before balancing / history limits).
    charts_per_label_requested: Optional[int] = None
    # "match_minority" or "keep_all".
    balance_mode: Optional[str] = None
    # True when both classes ended up equal in the final dataset.
    balanced: Optional[bool] = None
    # How many majority-class charts were dropped to balance the dataset.
    removed_for_balance: Optional[int] = None

# Trainer models
class TrainerRequest(BaseModel):
    use_standard_config: bool = True
    folder_name: Optional[str] = None  # Legacy support
    dataset_id: Optional[str] = None   # New preferred way
    model_name: str
    image_height: Optional[int] = None
    image_width: Optional[int] = None
    batch_size: Optional[int] = None
    epochs: Optional[int] = None
    val_split: Optional[float] = None
    random_seed: Optional[int] = None
    # Chart-generator run the training dataset came from (enables model→dataset metadata linkage)
    generator_run_id: Optional[str] = None

class TrainerProgressResponse(BaseModel):
    status: str  # ready, running, done, failed
    progress: Dict[str, Any]
    last_metrics: Optional[Dict[str, Any]] = None
    history_preview: Optional[List[Dict[str, Any]]] = None
    artifact_paths: Optional[List[str]] = None

class TrainerSummary(BaseModel):
    model_name: str
    config: Dict[str, Any]
    train_samples: int
    val_samples: int
    image_size: List[int]
    batch_size: int
    epochs_trained: int
    best_epoch: int
    final_metrics: Optional[Dict[str, Any]] = None
    completed_at: float

# Analysis models
class AnalysisRequest(BaseModel):
    img_path: Optional[str] = None
    white_mask_thresh: Optional[float] = 0.96

class AnalysisResponse(BaseModel):
    analysis_id: str


class AnalysisStandaloneRequest(BaseModel):
    """Model reference: model_id (uploaded .keras) or trainer_run_id (internal trained model)."""

    model_id: Optional[str] = None
    trainer_run_id: Optional[str] = None
    dataset_id: str


class AnalysisStandaloneResponse(BaseModel):
    run_id: str
    analysis_id: str


class AnalysisStatusResponse(BaseModel):
    status: str  # ready, running, done, failed
    progress: Dict[str, Any]
    generated_files: Optional[List[str]] = None
    generated_json_files: Optional[List[str]] = None
    manifest_file: Optional[str] = None
    artifact_metadata: Optional[List[Dict[str, Any]]] = None
    error_message: Optional[str] = None

# Dataset upload models
class DatasetUploadResponse(BaseModel):
    dataset_id: str
    extracted_path: str
    summary: Dict[str, Any]

class DatasetSummary(BaseModel):
    dataset_id: str
    extracted_path: str
    total_images: int
    label_distribution: Dict[str, int]
    example_filenames: List[str]
    created_at: float

# Global run management
class GlobalRun(BaseModel):
    id: str
    tool: str  # "labeling-optimizer", "training-chart-generator", "trainer", "analysis", "backtester", "testdata"
    status: str  # "queued", "running", "succeeded", "failed", "cancelled"
    progress: float = 0.0  # 0.0 to 1.0
    stage: str = ""
    message: str = ""
    created_at: float
    updated_at: float
    route: Optional[str] = None  # Frontend route to view this run
    parent_run_id: Optional[str] = None  # For trainer-linked analysis; null for standalone analysis
    # CNN analysis: trainer folder id + analysis sub-id (for recovery / API paths)
    trainer_run_id: Optional[str] = None
    analysis_id: Optional[str] = None
    download_zip_url: Optional[str] = None  # optional hint for list UI


def _suggest_download_zip_url(
    tool: str,
    run_id: str,
    trainer_run_id: Optional[str],
    analysis_id: Optional[str],
) -> Optional[str]:
    if tool == "training-chart-generator":
        return f"/api/training-chart-generator/download/{run_id}"
    if tool == "backtester":
        return f"/runs/backtester/{run_id}/download.zip"
    if tool == "testdata":
        return f"/runs/testdata/{run_id}/download.zip"
    if tool == "analysis" and trainer_run_id and analysis_id:
        return f"/trainer/runs/{trainer_run_id}/analysis/{analysis_id}/download"
    return None


def _persist_run_manifest_disk(run: GlobalRun) -> None:
    """Write run_manifest.json under backend/runs/<registry_id>/. Does not modify generated artifacts."""
    manifest_dir = get_run_dir(run.id)
    os.makedirs(manifest_dir, exist_ok=True)
    payload: Dict[str, Any] = {
        "id": run.id,
        "tool": run.tool,
        "status": run.status,
        "progress": run.progress,
        "stage": run.stage,
        "message": run.message,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
        "route": run.route,
        "parent_run_id": run.parent_run_id,
        "trainer_run_id": run.trainer_run_id,
        "analysis_id": run.analysis_id,
        "download_zip_url": run.download_zip_url,
    }
    try:
        with open(os.path.join(manifest_dir, "run_manifest.json"), "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
    except (OSError, TypeError):
        pass


def _progress_phase_to_run_fields(phase: Optional[str], err: Optional[str]) -> tuple[str, str, str]:
    """Map progress.json-style phase to (status, stage, message)."""
    p = (phase or "").lower()
    if p in ("done", "completed", "succeeded", "success"):
        return "succeeded", phase or "done", "Completed"
    if p in ("error", "failed"):
        return "failed", phase or "error", (err or "Failed")[:500]
    if p in ("cancelled", "canceled"):
        return "cancelled", phase or "cancelled", err or "Cancelled"
    if p in ("queued",):
        return "queued", phase or "queued", err or "Queued"
    return "running", phase or "running", err or (phase or "Running")


def _infer_tool_from_run_dir(dirname: str, run_path: str) -> Optional[str]:
    """Best-effort tool guess for legacy folders without run_manifest.json."""
    if os.path.isfile(os.path.join(run_path, "optimizer_config.json")):
        return "labeling-optimizer"
    zip_name = f"training-dataset-{dirname}.zip"
    if os.path.isfile(os.path.join(run_path, zip_name)):
        return "training-chart-generator"
    try:
        for fn in os.listdir(run_path):
            if fn.endswith((".keras", ".h5", ".pkl", ".joblib")):
                return "trainer"
    except OSError:
        pass
    if os.path.isdir(os.path.join(run_path, "analysis")):
        return "trainer"
    return None


def _global_run_from_manifest_dict(m: Dict[str, Any]) -> GlobalRun:
    return GlobalRun(
        id=str(m["id"]),
        tool=str(m["tool"]),
        status=str(m.get("status", "running")),
        progress=float(m.get("progress", 0.0) or 0.0),
        stage=str(m.get("stage", "") or ""),
        message=str(m.get("message", "") or ""),
        created_at=float(m.get("created_at", 0) or 0),
        updated_at=float(m.get("updated_at", 0) or 0),
        route=m.get("route"),
        parent_run_id=m.get("parent_run_id"),
        trainer_run_id=m.get("trainer_run_id"),
        analysis_id=m.get("analysis_id"),
        download_zip_url=m.get("download_zip_url")
        or _suggest_download_zip_url(
            str(m["tool"]),
            str(m["id"]),
            m.get("trainer_run_id"),
            m.get("analysis_id"),
        ),
    )


def _merge_manifest_with_progress_json(run_path: str, base: GlobalRun) -> GlobalRun:
    pf = os.path.join(run_path, "progress.json")
    if not os.path.isfile(pf):
        return base
    try:
        with open(pf, "r", encoding="utf-8") as f:
            pr = json.load(f)
    except (json.JSONDecodeError, OSError):
        return base
    phase = pr.get("phase")
    err = pr.get("error_message")
    st, stage, msg = _progress_phase_to_run_fields(phase, err)
    pct = float(pr.get("percent") or 0.0)
    prog = pct / 100.0 if pct > 1.0 else pct
    try:
        mt = os.path.getmtime(pf)
    except OSError:
        mt = base.updated_at
    upd = max(base.updated_at, float(mt))
    return GlobalRun(
        id=base.id,
        tool=base.tool,
        status=st,
        progress=max(base.progress, prog),
        stage=stage,
        message=msg,
        created_at=base.created_at,
        updated_at=upd,
        route=base.route,
        parent_run_id=base.parent_run_id,
        trainer_run_id=base.trainer_run_id,
        analysis_id=base.analysis_id,
        download_zip_url=_suggest_download_zip_url(
            base.tool, base.id, base.trainer_run_id, base.analysis_id
        ),
    )


# A run whose manifest/progress says "running" but which has had no updates for this long,
# and which is not present in the in-memory registry, is treated as no-longer-active.
STALE_RUN_SECONDS = 30 * 60


def _trainer_completion_mtime(run_path: str) -> Optional[float]:
    """Newest artifact mtime when a trainer run dir shows completion (model + summary/history), else None."""
    try:
        entries = os.listdir(run_path)
    except OSError:
        return None
    has_model = any(
        fn.endswith((".keras", ".h5", ".pkl", ".joblib"))
        for fn in entries
        if os.path.isfile(os.path.join(run_path, fn))
    )
    if not has_model:
        return None
    summ = os.path.join(run_path, "summary.json")
    hist = os.path.join(run_path, "history.json")
    if not (os.path.isfile(summ) or os.path.isfile(hist)):
        return None
    mts: List[float] = []
    for f in (summ, hist, run_path):
        try:
            mts.append(os.path.getmtime(f))
        except OSError:
            pass
    return max(mts) if mts else None


def _reconcile_stale_running(run: GlobalRun, run_path: str) -> GlobalRun:
    """Recover a terminal status for a disk run that claims to be running but isn't.

    Safe because ``discover_runs_merged_from_disk_and_memory`` lets the in-memory registry
    win on conflicts — genuinely-active runs override whatever we infer here.
    """
    if run.status not in ("running", "queued"):
        return run
    if run.tool == "trainer":
        mt = _trainer_completion_mtime(run_path)
        if mt is not None:
            return run.model_copy(
                update={
                    "status": "succeeded",
                    "progress": 1.0,
                    "stage": "completed",
                    "message": "Training completed (recovered from disk)",
                    "updated_at": max(run.updated_at, mt),
                }
            )
    # No completion evidence and no recent activity ⇒ the process is gone (e.g. server restart).
    if (time.time() - (run.updated_at or 0)) > STALE_RUN_SECONDS:
        return run.model_copy(
            update={
                "status": "failed",
                "stage": "stale",
                "message": run.message or "Run is no longer active (interrupted).",
            }
        )
    return run


def _global_run_from_analysis_disk(
    registry_id: str,
    manifest: Dict[str, Any],
    run_path: str,
) -> GlobalRun:
    base = _global_run_from_manifest_dict(manifest)
    tr = manifest.get("trainer_run_id")
    aid = manifest.get("analysis_id")
    if not tr or not aid:
        return _merge_manifest_with_progress_json(run_path, base)
    tdir = get_run_dir(str(tr))
    if not os.path.isdir(tdir):
        return _merge_manifest_with_progress_json(run_path, base)
    delivery = os.path.join(tdir, "analysis", str(aid), "delivery_summary.json")
    upd = base.updated_at
    try:
        if os.path.isfile(delivery):
            upd = max(upd, os.path.getmtime(delivery))
            return GlobalRun(
                id=base.id,
                tool=base.tool,
                status="succeeded",
                progress=1.0,
                stage="done",
                message="Analysis completed",
                created_at=base.created_at,
                updated_at=upd,
                route=base.route,
                parent_run_id=base.parent_run_id,
                trainer_run_id=str(tr),
                analysis_id=str(aid),
                download_zip_url=_suggest_download_zip_url("analysis", base.id, str(tr), str(aid)),
            )
    except OSError:
        pass
    # running / partial
    analysis_dir = os.path.join(tdir, "analysis", str(aid))
    try:
        if os.path.isdir(analysis_dir):
            upd = max(upd, os.path.getmtime(analysis_dir))
    except OSError:
        pass
    return GlobalRun(
        id=base.id,
        tool=base.tool,
        status="running",
        progress=base.progress if base.progress > 0 else 0.1,
        stage=base.stage or "running",
        message=base.message or "Analysis in progress",
        created_at=base.created_at,
        updated_at=max(base.updated_at, upd),
        route=base.route,
        parent_run_id=base.parent_run_id,
        trainer_run_id=str(tr),
        analysis_id=str(aid),
        download_zip_url=_suggest_download_zip_url("analysis", base.id, str(tr), str(aid)),
    )


def _discover_run_from_main_folder(dirname: str, run_path: str) -> Optional[GlobalRun]:
    mf = os.path.join(run_path, "run_manifest.json")
    if os.path.isfile(mf):
        try:
            with open(mf, "r", encoding="utf-8") as f:
                manifest = json.load(f)
        except (json.JSONDecodeError, OSError):
            manifest = None
        if manifest and isinstance(manifest, dict):
            if manifest.get("tool") == "analysis" and manifest.get("trainer_run_id") and manifest.get("analysis_id"):
                return _reconcile_stale_running(
                    _global_run_from_analysis_disk(dirname, manifest, run_path), run_path
                )
            base = _global_run_from_manifest_dict(manifest)
            merged = _merge_manifest_with_progress_json(run_path, base)
            return _reconcile_stale_running(merged, run_path)
    # Legacy: no manifest
    if not os.path.isfile(os.path.join(run_path, "progress.json")):
        tool_guess = _infer_tool_from_run_dir(dirname, run_path)
        if tool_guess == "trainer":
            # Trainer often has no progress.json; infer from artifacts
            has_model = any(
                fn.endswith((".keras", ".h5", ".pkl", ".joblib"))
                for fn in os.listdir(run_path)
                if os.path.isfile(os.path.join(run_path, fn))
            )
            hist = os.path.join(run_path, "history.json")
            if has_model and os.path.isfile(hist):
                try:
                    mt = max(os.path.getmtime(hist), os.path.getmtime(run_path))
                except OSError:
                    mt = time.time()
                return GlobalRun(
                    id=dirname,
                    tool="trainer",
                    status="succeeded",
                    progress=1.0,
                    stage="completed",
                    message="Training completed (recovered from disk)",
                    created_at=float(mt),
                    updated_at=float(mt),
                    route=f"/tools/trainer/runs/{dirname}",
                    download_zip_url=None,
                )
        return None
    tool_guess = _infer_tool_from_run_dir(dirname, run_path) or "training-chart-generator"
    # Legacy runs (no manifest): use real file mtimes, NOT time.time() — otherwise old
    # runs permanently sort as "just updated" and win every latest-run selection.
    try:
        ts = os.path.getmtime(os.path.join(run_path, "progress.json"))
    except OSError:
        try:
            ts = os.path.getmtime(run_path)
        except OSError:
            ts = time.time()
    base = GlobalRun(
        id=dirname,
        tool=tool_guess,
        status="running",
        progress=0.0,
        stage="",
        message="",
        created_at=ts,
        updated_at=ts,
        route=None,
        download_zip_url=_suggest_download_zip_url(tool_guess, dirname, None, None),
    )
    merged = _merge_manifest_with_progress_json(run_path, base)
    if tool_guess == "labeling-optimizer":
        # Frontend routes are /run/:id (live) and /results/:id (done) — never /runs/
        lo_route = (
            f"/products/labeling-optimizer/results/{dirname}"
            if merged.status in ("succeeded", "failed")
            else f"/products/labeling-optimizer/run/{dirname}"
        )
        # Rewrite legacy plural /runs/ paths stored on disk / older clients
        legacy = (merged.route or "").startswith("/products/labeling-optimizer/runs/")
        merged = merged.model_copy(
            update={"route": lo_route if (not merged.route or legacy) else merged.route}
        )
    elif tool_guess == "training-chart-generator":
        merged = merged.model_copy(
            update={"route": merged.route or f"/tools/generator/runs/{dirname}"}
        )
    elif tool_guess == "trainer":
        merged = merged.model_copy(update={"route": merged.route or f"/tools/trainer/runs/{dirname}"})
    return _reconcile_stale_running(merged, run_path)


def _discover_backtest_runs_from_disk() -> Dict[str, GlobalRun]:
    out: Dict[str, GlobalRun] = {}
    root_dir = Path(__file__).resolve().parent.parent
    bt_root = root_dir / "backend" / "runs" / "backtests"
    if not bt_root.is_dir():
        return out
    for child in bt_root.iterdir():
        if not child.is_dir():
            continue
        rid = child.name
        info_file = child / "run_info.json"
        if not info_file.is_file():
            continue
        try:
            with open(info_file, "r", encoding="utf-8") as f:
                info = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue
        st = str(info.get("status", "running"))
        if st == "succeeded":
            api_status = "succeeded"
        elif st == "failed":
            api_status = "failed"
        elif st in ("queued",):
            api_status = "queued"
        else:
            api_status = "running"
        prog = float(info.get("progress", 0.0) or 0.0)
        msg = str(info.get("message", "") or "")
        started = float(info.get("started_at", 0) or 0)
        updated = float(info.get("updated_at", started) or started)
        out[rid] = GlobalRun(
            id=rid,
            tool="backtester",
            status=api_status,
            progress=prog,
            stage=st,
            message=msg,
            created_at=started or updated,
            updated_at=updated or started,
            route=f"/tools/backtester/runs/{rid}",
            download_zip_url=None,
        )
    return out


def discover_runs_merged_from_disk_and_memory(limit: int) -> List[GlobalRun]:
    """Merge disk-backed runs with in-memory all_runs (memory wins on same id)."""
    merged: Dict[str, GlobalRun] = {}
    try:
        for name in os.listdir(runs_dir):
            if name == "backtests":
                continue
            p = os.path.join(runs_dir, name)
            if not os.path.isdir(p):
                continue
            gr = _discover_run_from_main_folder(name, p)
            if gr:
                merged[gr.id] = gr
    except OSError:
        pass
    merged.update(_discover_backtest_runs_from_disk())
    for rid, run in all_runs.items():
        merged[rid] = run
    rows = sorted(merged.values(), key=lambda r: r.updated_at, reverse=True)
    return rows[:limit]


def try_resolve_run_from_disk(run_id: str) -> Optional[GlobalRun]:
    """Single-run recovery when not present in all_runs."""
    if run_id in all_runs:
        return all_runs[run_id]
    p = get_run_dir(run_id)
    if os.path.isdir(p):
        gr = _discover_run_from_main_folder(run_id, p)
        if gr:
            return gr
    root_dir = Path(__file__).resolve().parent.parent
    bt = root_dir / "backend" / "runs" / "backtests" / run_id
    if bt.is_dir():
        found = _discover_backtest_runs_from_disk()
        return found.get(run_id)
    return None


# Backtester models
class BacktesterStartRequest(BaseModel):
    model_path: Optional[str] = None
    model_id: Optional[str] = None
    dataset_id: Optional[str] = None
    chart_folder: Optional[str] = None
    sample_size: Union[str, int] = "all"
    confidence_threshold: float = 0.5
    tp_pct: float = 2.0
    sl_pct: float = 2.0
    img_size: int = 224
    # Trading parameters
    starting_capital: float = 10000.0
    position_size_pct: float = 10.0  # Percentage of capital per trade
    commission_pct: float = 0.1  # Commission per trade as percentage
    slippage_pct: float = 0.05  # Slippage as percentage
    # Risk management
    max_drawdown_pct: float = 20.0  # Max drawdown before stopping
    max_trades_per_day: int = 10  # Maximum trades per simulated day

class BacktesterStatusResponse(BaseModel):
    status: str
    progress: float
    stage: str
    message: str
    live_metrics: Optional[Dict[str, Any]] = None

class BacktesterResultResponse(BaseModel):
    kpis: Dict[str, Any]
    charts: Dict[str, str]  # chart_name -> url
    download_zip_url: str
    csv_urls: Optional[Dict[str, str]] = None
    summary_url: Optional[str] = None

# Test Data Generator models
class TestDataGeneratorRequest(BaseModel):
    symbols: str
    dataset_name: str
    use_candles: bool = True
    timeframe: str = "1d"
    span_unit: str = "months"
    span_units_count: int = 6
    future_horizon_bars: int = 7
    tp_frac: float = 0.02
    sl_frac: float = 0.01
    img_dim: int = 224
    period_length_units: int = 30
    end_offset_units: int = 0
    use_sma: bool = False
    sma_length: int = 20
    training_period_start: Optional[str] = None
    training_period_end: Optional[str] = None
    test_period_start: Optional[str] = None
    test_period_end: Optional[str] = None
    # Optional linkage when generated as a "fitting" test set for a model / training run
    model_id: Optional[str] = None
    training_run_id: Optional[str] = None
    generator_run_id: Optional[str] = None

class TestDataGeneratorStatusResponse(BaseModel):
    status: str
    progress: float
    stage: str
    message: str
    live_metrics: Optional[Dict[str, Any]] = None

class TestDataGeneratorResultResponse(BaseModel):
    dataset_id: str
    download_zip_url: str
    dataset_name: Optional[str] = None
    summary: Dict[str, Any]

def register_run(
    run_id: str,
    tool: str,
    route: Optional[str] = None,
    parent_run_id: Optional[str] = None,
    *,
    trainer_run_id: Optional[str] = None,
    analysis_id: Optional[str] = None,
) -> None:
    """Register a new run in the global registry and persist a lightweight manifest on disk."""
    now = time.time()
    all_runs[run_id] = GlobalRun(
        id=run_id,
        tool=tool,
        status="running",
        progress=0.0,
        stage="starting",
        message="Initializing...",
        created_at=now,
        updated_at=now,
        route=route,
        parent_run_id=parent_run_id,
        trainer_run_id=trainer_run_id,
        analysis_id=analysis_id,
        download_zip_url=_suggest_download_zip_url(tool, run_id, trainer_run_id, analysis_id),
    )
    _persist_run_manifest_disk(all_runs[run_id])


def update_run_progress(run_id: str, progress: float, stage: str, message: str = "", status: Optional[str] = None) -> None:
    """Update run progress.

    When an explicit ``status`` is not supplied, a terminal ``stage`` (e.g. "done",
    "completed", "error") is mapped to the matching run status so the on-disk manifest
    is always finalized. Historically some flows (trainer/analysis) only ever reported
    progress with a terminal *phase* but no status, leaving manifests stuck on "running".
    """
    if run_id in all_runs:
        run = all_runs[run_id]
        run.progress = progress
        run.stage = stage
        run.message = message
        run.updated_at = time.time()
        if not status:
            mapped, _, _ = _progress_phase_to_run_fields(stage, message)
            # Only adopt a terminal mapping; keep "running" as-is unless told otherwise.
            if mapped in ("succeeded", "failed", "cancelled"):
                status = mapped
        if status:
            run.status = status
        run.download_zip_url = _suggest_download_zip_url(
            run.tool, run.id, run.trainer_run_id, run.analysis_id
        )
        if run.status in ("succeeded", "failed", "cancelled"):
            _persist_run_manifest_disk(run)

def get_active_runs() -> List[GlobalRun]:
    """Get all active (running/queued) runs"""
    return [run for run in all_runs.values() if run.status in ["running", "queued"]]

def get_run(run_id: str) -> Optional[GlobalRun]:
    """Get a specific run by ID"""
    return all_runs.get(run_id)

# Global runs storage (in production, use a database)
runs_dir = os.path.join(os.path.dirname(__file__), "..", "runs")
os.makedirs(runs_dir, exist_ok=True)

# Global run registry - unified across all tools
all_runs = {}  # run_id -> run metadata
# running_processes lives in app.process_registry (imported above)

def _progress_phase_is_cancelled(run_id: str) -> bool:
    phase = str(read_progress_file(run_id).get("phase") or "").lower()
    return phase in ("cancelled", "canceled")


def _write_cancelled_progress(run_id: str, message: str = "Cancelled by user") -> None:
    run_dir = get_run_dir(run_id)
    os.makedirs(run_dir, exist_ok=True)
    cancel_progress = {
        "phase": "cancelled",
        "percent": 0,
        "elapsed_s": 0,
        "step": 0,
        "total_steps": None,
        "error_message": message,
        "message": message,
    }
    with open(os.path.join(run_dir, "progress.json"), "w") as f:
        json.dump(cancel_progress, f)


def cancel_run_process(run_id: str, message: str = "Cancelled by user") -> Dict[str, Any]:
    """Kill subprocess / signal in-process cancel for any tool. Idempotent."""
    killed = kill_managed(run_id)

    # In-process trainer cancel (dict may be empty if never started)
    trainer_map = globals().get("trainer_runs") or {}
    trainer_run = trainer_map.get(run_id)
    if trainer_run is not None:
        cancel_event = trainer_run.get("cancel_event")
        if cancel_event is not None:
            cancel_event.set()
        trainer_run["status"] = "cancelled"
        trainer_run["progress"] = {
            "phase": "cancelled",
            "percent": 0,
            "message": message,
        }

    testdata_map = globals().get("testdata_runs") or {}
    if run_id in testdata_map:
        testdata_map[run_id]["status"] = "cancelled"
        testdata_map[run_id]["progress"] = {
            "phase": "cancelled",
            "percent": 0,
            "message": message,
        }

    backtester_map = globals().get("backtester_runs") or {}
    if run_id in backtester_map:
        backtester_map[run_id]["status"] = "cancelled"
        backtester_map[run_id]["progress"] = {
            "phase": "cancelled",
            "percent": 0,
            "message": message,
        }

    _write_cancelled_progress(run_id, message)
    update_run_progress(run_id, 0.0, "cancelled", message, "cancelled")
    return {"status": "cancelled", "run_id": run_id, "killed": killed}


def generate_run_id() -> str:
    """Generate a unique run ID based on timestamp"""
    return datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + str(uuid.uuid4())[:6]

def get_run_dir(run_id: str) -> str:
    """Get the run directory path"""
    return os.path.join(runs_dir, run_id)

def get_artifacts_dir(run_id: str) -> str:
    """Get the artifacts directory path"""
    return os.path.join(get_run_dir(run_id), "artifacts")

def read_progress_file(run_id: str) -> Dict[str, Any]:
    """Safely read progress.json file"""
    progress_file = os.path.join(get_run_dir(run_id), "progress.json")
    try:
        if os.path.exists(progress_file):
            with open(progress_file, 'r') as f:
                return json.load(f)
    except (json.JSONDecodeError, IOError):
        pass

    # Return default progress if file doesn't exist or can't be read
    return {
        "phase": "starting",
        "percent": 0,
        "elapsed_s": 0,
        "step": 0,
        "total_steps": None
    }

def run_labeling_optimizer(request: RunRequest, run_id: str):
    """Run the labeling optimizer script"""
    symbol = request.symbol
    start = request.start
    end = request.end
    run_dir = get_run_dir(run_id)
    artifacts_dir = get_artifacts_dir(run_id)

    # Create directories
    os.makedirs(run_dir, exist_ok=True)
    os.makedirs(artifacts_dir, exist_ok=True)

    try:
        with open(os.path.join(run_dir, "optimizer_config.json"), "w") as f:
            json.dump(request.dict(), f, indent=2)
    except (OSError, TypeError):
        pass

    # Write initial progress
    initial_progress = {
        "phase": "starting",
        "percent": 0,
        "elapsed_s": 0,
        "step": 0,
        "total_steps": None
    }
    with open(os.path.join(run_dir, "progress.json"), 'w') as f:
        json.dump(initial_progress, f)

    # Update global run registry
    update_run_progress(run_id, 0.0, "starting", "Initializing labeling optimizer...")

    try:
        script_path = _resolve_pipeline_script("7.2.py")

        # Run the script
        cmd = [
            sys.executable,  # Use the same Python that's running this FastAPI app
            str(script_path),
            "--symbol", symbol,
            "--start", start,
            "--end", end,
            "--run_id", run_id,
            "--out_dir", runs_dir
        ]

        print(f"Starting labeling optimizer: {' '.join(cmd)}")
        proc = popen_managed(
            run_id,
            cmd,
            cwd=str(_SCRIPTS_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        returncode = wait_managed(run_id, proc, timeout_s=3600)
        stdout = ""
        stderr = ""
        try:
            out, err = proc.communicate(timeout=2)
            stdout = out or ""
            stderr = err or ""
        except Exception:
            pass

        if _progress_phase_is_cancelled(run_id):
            update_run_progress(run_id, 0.0, "cancelled", "Cancelled by user", "cancelled")
            return

        if returncode == 0:
            # Copy important chart files and metrics to artifacts directory for frontend access
            import shutil
            chart_files = [
                f"{symbol}_risk_return_cagr_vs_maxdd.png",
                f"{symbol}_cagr_vs_horizon_spread_groups.png",
                f"{symbol}_benchmarks_vs_best_cagr.png",
                f"{symbol}_correlation_matrix.png",
                f"{symbol}_hist_annual_pnl_per_year.png",
                f"{symbol}_cagr_vs_winrate.png",
                "metrics.json"  # Include the metrics JSON file
            ]

            for chart_file in chart_files:
                src_path = os.path.join(runs_dir, chart_file)
                if os.path.exists(src_path):
                    dst_path = os.path.join(artifacts_dir, chart_file)
                    shutil.copy2(src_path, dst_path)

            # Update global run registry for success
            update_run_progress(run_id, 1.0, "completed", "Labeling optimization completed successfully", "succeeded")

        if returncode != 0:
            # Update progress with error
            error_progress = {
                "phase": "error",
                "percent": 0,
                "elapsed_s": 0,
                "step": 0,
                "total_steps": None,
                "error_message": f"Script execution failed: {(stderr or '')[:500]}"
            }
            with open(os.path.join(run_dir, "progress.json"), 'w') as f:
                json.dump(error_progress, f)

            # Update global run registry
            update_run_progress(run_id, 0.0, "error", f"Script execution failed: {(stderr or '')[:100]}", "failed")

    except Exception as e:
        if _progress_phase_is_cancelled(run_id):
            update_run_progress(run_id, 0.0, "cancelled", "Cancelled by user", "cancelled")
            return
        error_progress = {
            "phase": "error",
            "percent": 0,
            "elapsed_s": 0,
            "step": 0,
            "total_steps": None,
            "error_message": f"Unexpected error: {str(e)[:500]}"
        }
        with open(os.path.join(run_dir, "progress.json"), 'w') as f:
            json.dump(error_progress, f)

        # Update global run registry
        update_run_progress(run_id, 0.0, "error", f"Unexpected error: {str(e)[:100]}", "failed")

def run_training_chart_generator(config: Dict[str, Any], run_id: str):
    """Run the training chart generator script"""
    run_dir = get_run_dir(run_id)
    artifacts_dir = get_artifacts_dir(run_id)

    # Create directories
    os.makedirs(run_dir, exist_ok=True)
    os.makedirs(artifacts_dir, exist_ok=True)

    # Write initial progress
    initial_progress = {
        "phase": "starting",
        "percent": 0,
        "elapsed_s": 0,
        "step": 0,
        "total_steps": None
    }
    with open(os.path.join(run_dir, "progress.json"), 'w') as f:
        json.dump(initial_progress, f)

    try:
        script_path = _resolve_pipeline_script("1.3_Adj_TrL.py")

        # Prepare script arguments from config
        symbols = config['symbols']
        x = config['chartsPerLabel']  # charts per symbol per label
        use_candles = "yes" if config['useCandles'] else "no"
        t = config['timeframe']  # '1d', '1wk', '1mo'
        u = config['timespanUnit']  # e.g. 'months'
        o = config['timespanCount']  # how many units
        w = config['horizonBars']  # future horizon in bars
        f = config['takeProfitFraction']  # take profit fraction
        s = config['stopLossFraction']  # stop loss fraction
        img_dim = config['imageDimension']  # image dimension
        i1 = config['endOffset']  # end offset

        # Create a temporary output directory for this run
        temp_out_dir = os.path.join(run_dir, "temp_output")
        os.makedirs(temp_out_dir, exist_ok=True)

        # Simulate progress updates during execution
        def update_progress(phase: str, percent: float, error_message: str = None):
            progress_data = {
                "phase": phase,
                "percent": percent,
                "elapsed_s": time.time() - start_time,
                "step": int(percent / 10),
                "total_steps": 10
            }
            if error_message:
                progress_data["error_message"] = error_message
            with open(os.path.join(run_dir, "progress.json"), 'w') as f:
                json.dump(progress_data, f)

            # Update global run registry
            update_run_progress(run_id, percent / 100.0, phase, f"{phase} ({percent:.1f}%)")

        start_time = time.time()

        # Update progress: starting
        update_progress("Initializing", 5)

        # Create a simple wrapper script that provides inputs


        # Run the script with command line arguments (like labeling optimizer)
        cmd = [
            sys.executable,
            str(script_path),
            "--symbols", symbols,
            "--x", str(x),
            "--out_dir", temp_out_dir,
            "--use_candles", use_candles,
            "--t", t,
            "--u", u,
            "--o", str(o),
            "--w", str(w),
            "--f", str(f),
            "--s", str(s),
            "--img_dim", str(img_dim),
            "--i1", str(i1),
            "--run_id", run_id,
            "--progress_dir", run_dir
        ]
        print(f"About to execute: {' '.join(cmd)}")
        print(f"Working directory: {_SCRIPTS_DIR}")
        print(f"Script exists: {script_path.is_file()}")
        print(f"Starting training chart generator: {' '.join(cmd)}")

        # Run the script directly (progress is updated by the script itself)
        try:
            proc = popen_managed(
                run_id,
                cmd,
                cwd=str(_SCRIPTS_DIR),
            )
            returncode = wait_managed(run_id, proc, timeout_s=3600)
            stdout = ""
            stderr = ""

            if returncode == -1 and not _progress_phase_is_cancelled(run_id):
                print("Script timed out after 3600 seconds")
                stderr = "Process timed out"
                update_progress("error", 0, "Script execution timed out after 1 hour")
                update_run_progress(run_id, 0.0, "timeout", "Script execution timed out", "failed")

        except Exception as e:
            print(f"Unexpected error during script execution: {e}")
            returncode = -1
            stdout = ""
            stderr = str(e)
            update_progress("error", 0, f"Unexpected error: {str(e)}")
            update_run_progress(run_id, 0.0, "error", f"Unexpected error: {str(e)[:100]}", "failed")

        if _progress_phase_is_cancelled(run_id):
            update_run_progress(run_id, 0.0, "cancelled", "Cancelled by user", "cancelled")
            return

        # Log output
        if stdout:
            print(f"Script stdout (last 1000 chars): {stdout[-1000:]}")
        if stderr:
            print(f"Script stderr (last 1000 chars): {stderr[-1000:]}")

        # Update final progress based on return code
        if returncode == 0:
            print("Script completed successfully")
            # Generation finished, but post-processing (balancing + zip) still runs below.
            # Don't mark the run "done" yet or the UI will stop polling and fetch stats
            # before they exist. Keep it "running" in the 95-100% band.
            update_progress("Finalizing dataset", 95)
        else:
            error_msg = stderr[-200:] if stderr else "Unknown error"
            print(f"Script failed with return code {returncode}: {error_msg}")
            update_progress("error", 0, error_msg)
            # Update global run registry
            update_run_progress(run_id, 0.0, "error", f"Chart generation failed: {error_msg[:100]}", "failed")

        if returncode and returncode != 0:
            error_progress = {
                "phase": "error",
                "percent": 0,
                "elapsed_s": time.time() - start_time,
                "step": 0,
                "total_steps": None,
                "error_message": f"Script execution failed: {(stderr or error_msg or 'Unknown error')[:500]}"
            }
            with open(os.path.join(run_dir, "progress.json"), 'w') as f:
                json.dump(error_progress, f)
            return

        update_progress("Processing generated charts", 96)

        # Count generated files and split by label class
        png_files = [f for f in os.listdir(temp_out_dir) if f.endswith('.png')]
        label0_files = sorted(f for f in png_files if f.endswith('_label0.png'))
        label1_files = sorted(f for f in png_files if f.endswith('_label1.png'))

        balance_mode = str(config.get('balanceMode') or 'match_minority').strip().lower()
        removed_for_balance = 0

        # Label 1 (TP-first) is naturally rarer, so a fixed window often yields fewer
        # label-1 charts than requested. When the user asked for a balanced dataset we
        # trim the majority class down to the minority count (evenly spaced to preserve
        # temporal/symbol coverage). Otherwise we keep every chart (imbalanced).
        if balance_mode == 'match_minority' and label0_files and label1_files:
            target = min(len(label0_files), len(label1_files))

            def _evenly_spaced(items: list, k: int) -> list:
                if k >= len(items):
                    return list(items)
                if k <= 1:
                    return items[:max(k, 0)]
                idxs = sorted({round(j * (len(items) - 1) / (k - 1)) for j in range(k)})
                # round() can collide near the ends; backfill to guarantee exactly k.
                if len(idxs) < k:
                    for extra in range(len(items)):
                        if extra not in idxs:
                            idxs.append(extra)
                            if len(idxs) == k:
                                break
                    idxs = sorted(idxs)
                return [items[i] for i in idxs[:k]]

            keep0 = set(_evenly_spaced(label0_files, target))
            keep1 = set(_evenly_spaced(label1_files, target))
            for file_name in png_files:
                is_label1 = file_name.endswith('_label1.png')
                keep_set = keep1 if is_label1 else keep0
                if file_name not in keep_set:
                    try:
                        os.remove(os.path.join(temp_out_dir, file_name))
                        removed_for_balance += 1
                    except OSError:
                        pass

        # Recompute after any trimming
        png_files = [f for f in os.listdir(temp_out_dir) if f.endswith('.png')]
        final_label0 = sum(1 for f in png_files if f.endswith('_label0.png'))
        final_label1 = sum(1 for f in png_files if f.endswith('_label1.png'))
        total_charts = len(png_files)

        # Create ZIP file
        update_progress("Creating ZIP archive", 98)

        zip_path = os.path.join(run_dir, f"training-dataset-{run_id}.zip")
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for file_name in png_files:
                file_path = os.path.join(temp_out_dir, file_name)
                zip_file.write(file_path, file_name)

        # Create dataset stats
        dataset_stats = {
            "total_charts": total_charts,
            "symbols_count": len(symbols.split(',')),
            "timeframe": t,
            "chart_type": "candlestick" if config['useCandles'] else "line",
            "label_counts": {"0": final_label0, "1": final_label1},
            "charts_per_label_requested": x,
            "balance_mode": balance_mode,
            "balanced": final_label0 == final_label1,
            "removed_for_balance": removed_for_balance,
        }

        with open(os.path.join(artifacts_dir, "dataset_stats.json"), 'w') as f:
            json.dump(dataset_stats, f)

        # Final progress update
        final_progress = {
            "phase": "done",
            "percent": 100,
            "elapsed_s": time.time() - start_time,
            "step": 10,
            "total_steps": 10
        }
        with open(os.path.join(run_dir, "progress.json"), 'w') as f:
            json.dump(final_progress, f)

        # Mark the global run registry succeeded only now that the dataset + zip exist.
        update_run_progress(run_id, 1.0, "completed", "Chart generation completed successfully", "succeeded")

    except subprocess.TimeoutExpired:
        error_progress = {
            "phase": "error",
            "percent": 0,
            "elapsed_s": 1800,
            "step": 0,
            "total_steps": None,
            "error_message": "Script execution timed out after 30 minutes"
        }
        with open(os.path.join(run_dir, "progress.json"), 'w') as f:
            json.dump(error_progress, f)

    except Exception as e:
        error_progress = {
            "phase": "error",
            "percent": 0,
            "elapsed_s": time.time() - start_time if 'start_time' in locals() else 0,
            "step": 0,
            "total_steps": None,
            "error_message": f"Unexpected error: {str(e)[:500]}"
        }
        with open(os.path.join(run_dir, "progress.json"), 'w') as f:
            json.dump(error_progress, f)

@app.post("/api/labeling-optimizer/run", response_model=RunResponse)
async def start_run(request: RunRequest, background_tasks: BackgroundTasks):
    """Start a labeling optimizer run"""
    run_id = generate_run_id()

    # Register run globally
    register_run(run_id, "labeling-optimizer", f"/products/labeling-optimizer/run/{run_id}")

    # Start the script in background
    background_tasks.add_task(run_labeling_optimizer, request, run_id)

    return RunResponse(run_id=run_id)

@app.get("/api/labeling-optimizer/progress/{run_id}")
async def get_progress(run_id: str) -> ProgressResponse:
    """Get progress for a run"""
    progress_data = read_progress_file(run_id)
    return ProgressResponse(**progress_data)

@app.get("/api/labeling-optimizer/runs/{run_id}")
async def list_run_artifacts(run_id: str) -> Dict[str, List[str]]:
    """List available artifact files for a run"""
    artifacts_dir = get_artifacts_dir(run_id)

    if not os.path.exists(artifacts_dir):
        return {"artifacts": []}

    artifacts = []
    for file in os.listdir(artifacts_dir):
        if file.endswith('.json'):
            # Remove .json extension for the API
            artifacts.append(file[:-5])

    return {"artifacts": artifacts}

@app.get("/api/labeling-optimizer/artifacts/{run_id}/{name}")
async def get_artifact(run_id: str, name: str):
    """Get a specific artifact file"""
    # Sanitize the name (only allow safe characters)
    if not all(c.isalnum() or c in '._-' for c in name):
        raise HTTPException(status_code=400, detail="Invalid artifact name")

    artifacts_dir = get_artifacts_dir(run_id)
    file_path = os.path.join(artifacts_dir, f"{name}.json")

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Artifact not found")

    return FileResponse(file_path, media_type="application/json")

@app.get("/api/labeling-optimizer/download-visuals/{run_id}")
async def download_visuals(run_id: str):
    """Download all visual artifacts as a ZIP file"""
    artifacts_dir = get_artifacts_dir(run_id)

    if not os.path.exists(artifacts_dir):
        raise HTTPException(status_code=404, detail="Run not found or no artifacts available")

    # Create ZIP file in memory
    zip_buffer = io.BytesIO()

    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for file_name in os.listdir(artifacts_dir):
            if file_name.endswith('.json'):
                file_path = os.path.join(artifacts_dir, file_name)
                # Add file to ZIP (keeping the .json extension)
                zip_file.write(file_path, file_name)

    zip_buffer.seek(0)

    return StreamingResponse(
        io.BytesIO(zip_buffer.getvalue()),
        media_type='application/zip',
        headers={"Content-Disposition": f"attachment; filename=labeling_optimizer_visuals_{run_id}.zip"}
    )


@app.get("/api/yfinance/search")
async def yfinance_symbol_search(q: str = "", max_results: int = 12):
    """Lightweight symbol lookup for the chart generator UI (Yahoo Finance via yfinance)."""
    query = (q or "").strip()
    if len(query) < 1:
        return {"results": []}
    max_results = max(1, min(int(max_results or 12), 25))
    try:
        import yfinance as yf  # noqa: WPS433 — optional heavy import isolated to this route

        search = yf.Search(query, max_results=max_results)
        quotes = getattr(search, "quotes", None) or []
        results: List[Dict[str, Any]] = []
        for row in quotes:
            if not isinstance(row, dict):
                continue
            sym = row.get("symbol")
            if not sym:
                continue
            results.append(
                {
                    "symbol": str(sym),
                    "name": str(row.get("longname") or row.get("shortname") or sym),
                    "exchange": row.get("exchDisp") or row.get("exchange"),
                    "type": row.get("typeDisp") or row.get("quoteType"),
                }
            )
        return {"results": results}
    except Exception as exc:
        logger.warning("yfinance search failed for %r: %s", query, exc)
        raise HTTPException(
            status_code=503,
            detail="Symbol search is temporarily unavailable. Try entering a ticker symbol directly.",
        ) from exc


# Training Chart Generator endpoints
@app.post("/api/training-chart-generator/run", response_model=RunResponse)
async def start_training_chart_generator(request: TrainingChartGeneratorRequest, background_tasks: BackgroundTasks):
    """Start a training chart generator run"""
    run_id = generate_run_id()

    # Register run globally
    register_run(run_id, "training-chart-generator", f"/tools/generator/runs/{run_id}")

    # Create run directory and initial progress file immediately
    run_dir = get_run_dir(run_id)
    os.makedirs(run_dir, exist_ok=True)

    initial_progress = {
        "phase": "starting",
        "percent": 1,  # Start at 1% to show it's working
        "elapsed_s": 0,
        "step": 1,
        "total_steps": 10
    }
    progress_file = os.path.join(run_dir, "progress.json")
    with open(progress_file, 'w') as f:
        json.dump(initial_progress, f)

    print(f"Created initial progress file for run {run_id}")

    # Persist request for results / run history UI (core generator ignores extra keys)
    try:
        with open(os.path.join(run_dir, "generator_config.json"), "w") as f:
            json.dump(request.dict(), f, indent=2)
    except OSError as exc:
        logger.warning("Could not write generator_config.json for %s: %s", run_id, exc)

    # Start the script in background
    background_tasks.add_task(run_training_chart_generator, request.dict(), run_id)

    return RunResponse(run_id=run_id)


# --- Live single-chart preview (Step 3 of the generator) ------------------------------------
# Short-lived in-memory cache of full price history per (symbol, timeframe) so tweaking
# TP/SL/horizon/window doesn't hit the network on every keystroke.
_PREVIEW_HISTORY_CACHE: Dict[tuple, tuple] = {}
_PREVIEW_HISTORY_TTL_S = 300.0


def _step_unit_for_timeframe(timeframe: str) -> str:
    return {"1d": "days", "1wk": "weeks", "1mo": "months"}.get(timeframe, "days")


def _preview_fetch_history(symbol: str, timeframe: str):
    """Full available history for symbol/timeframe (cached briefly). Returns a DataFrame."""
    import time as _time
    import yfinance as yf

    key = (symbol.upper(), timeframe)
    now = _time.time()
    cached = _PREVIEW_HISTORY_CACHE.get(key)
    if cached and (now - cached[0]) < _PREVIEW_HISTORY_TTL_S:
        return cached[1]
    ticker = yf.Ticker(symbol)
    df = ticker.history(period="max", interval=timeframe)
    _PREVIEW_HISTORY_CACHE[key] = (now, df)
    return df


def _preview_label(chart_df, future_df, f: float, s: float):
    """Same labeling rule as generation: enter at next open, SL-before-TP conservative walk.

    Returns (label, entry_price, tp_level, sl_level, which, hit_price, hit_offset).
    hit_offset is the positional index within future_df where the hit occurred (or None).
    """
    if chart_df is None or chart_df.empty or future_df is None or future_df.empty:
        return None, None, None, None, None, None, None
    first = future_df.iloc[0]
    entry = float(first["Open"]) if "Open" in future_df.columns else float(first["Close"])
    tp_level = entry * (1.0 + float(f))
    sl_level = entry * (1.0 - float(s))
    for offset in range(len(future_df)):
        row = future_df.iloc[offset]
        hi = float(row["High"]) if "High" in future_df.columns else float(row["Close"])
        lo = float(row["Low"]) if "Low" in future_df.columns else float(row["Close"])
        if lo <= sl_level:
            return 0, entry, tp_level, sl_level, "SL", sl_level, offset
        if hi >= tp_level:
            return 1, entry, tp_level, sl_level, "TP", tp_level, offset
    return 0, entry, tp_level, sl_level, None, None, None


def _render_preview_png(use_candles: bool, chart_df, img_dim: int) -> str:
    """Render a training-identical chart PNG (square, transparent, no chrome) → data URL.

    Matches ``1.3_Adj_TrL.py``: only the historical window the model sees — no title,
    axes, horizon shade, or TP/SL overlays. Label metadata is returned separately.
    """
    import base64
    import numpy as np
    from matplotlib.figure import Figure
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.patches import Rectangle
    from matplotlib.lines import Line2D
    import matplotlib.pyplot as plt

    # Same palette / DPI as the training generator script.
    dpi = 100.0
    line_color = "#1a1a1a"
    wick_color = "#1a1a1a"
    bull_body = "#0d8f4a"
    bear_body = "#c41e1e"

    dim = max(64, min(int(img_dim or 224), 1024))
    fig = Figure(figsize=(dim / dpi, dim / dpi), dpi=dpi, facecolor="none")
    fig.patch.set_alpha(0.0)
    FigureCanvasAgg(fig)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_facecolor("none")
    ax.patch.set_alpha(0.0)
    ax.axis("off")
    for spine in ax.spines.values():
        spine.set_visible(False)

    if use_candles and all(c in chart_df.columns for c in ("Open", "High", "Low", "Close")):
        o = chart_df["Open"].to_numpy(dtype=np.float64, copy=False)
        h = chart_df["High"].to_numpy(dtype=np.float64, copy=False)
        l = chart_df["Low"].to_numpy(dtype=np.float64, copy=False)
        c = chart_df["Close"].to_numpy(dtype=np.float64, copy=False)
        n = len(c)
        if n < 2:
            raise ValueError("candlestick needs at least 2 bars")
        ymin = float(np.min(l))
        ymax = float(np.max(h))
        span = ymax - ymin
        pad = max(span * 0.02, 1e-9) if span > 0 else 1.0
        ax.set_xlim(-0.5, n - 0.5)
        ax.set_ylim(ymin - pad, ymax + pad)
        half_w = 0.35
        min_body = max((ymax - ymin) * 0.0015, 1e-9)
        for i in range(n):
            oi, hi, li, ci = o[i], h[i], l[i], c[i]
            ax.add_line(
                Line2D([i, i], [li, hi], color=wick_color, linewidth=1.0, zorder=1, antialiased=False)
            )
            top = max(oi, ci)
            bot = min(oi, ci)
            body_h = abs(ci - oi)
            if body_h < min_body:
                mid = 0.5 * (oi + ci)
                bot = mid - min_body * 0.5
                top = mid + min_body * 0.5
            color = bull_body if ci >= oi else bear_body
            ax.add_patch(
                Rectangle(
                    (i - half_w, bot),
                    2 * half_w,
                    top - bot,
                    facecolor=color,
                    edgecolor=color,
                    linewidth=0.5,
                    zorder=2,
                    antialiased=False,
                )
            )
    else:
        y = chart_df["Close"].to_numpy(dtype=np.float64, copy=False)
        n = len(y)
        if n < 2:
            raise ValueError("line chart needs at least 2 points")
        x = np.arange(n, dtype=np.float64)
        ymin = float(np.min(y))
        ymax = float(np.max(y))
        span = ymax - ymin
        pad = max(span * 0.02, 1e-9) if span > 0 else 1.0
        ax.set_xlim(-0.5, n - 0.5)
        ax.set_ylim(ymin - pad, ymax + pad)
        ax.plot(
            x,
            y,
            color=line_color,
            linewidth=1.0,
            solid_capstyle="butt",
            solid_joinstyle="miter",
            antialiased=False,
        )

    ax.set_aspect("auto")
    buf = io.BytesIO()
    fig.savefig(
        buf,
        format="png",
        dpi=dpi,
        facecolor="none",
        edgecolor="none",
        transparent=True,
        bbox_inches=None,
        pad_inches=0,
    )
    buf.seek(0)
    plt.close(fig)
    return "data:image/png;base64," + base64.b64encode(buf.read()).decode("ascii")



@app.post("/api/training-chart-generator/preview")
def preview_training_chart(request: ChartPreviewRequest) -> Dict[str, Any]:
    """Render a single example chart with the current Step-3 settings.

    Image matches generation exactly (square, transparent, no chrome). Label /
    TP-SL metadata is returned alongside for the UI caption. Sync endpoint
    (threadpool) so yfinance/matplotlib never blocks the event loop.
    """
    import pandas as pd
    from dateutil.relativedelta import relativedelta

    symbol = (request.symbols or "").upper().replace(" ", "").split(",")[0].strip()
    if not symbol:
        return {"ok": False, "message": "Add a stock symbol to see a live preview."}

    tf = request.timeframe if request.timeframe in ("1d", "1wk", "1mo") else "1d"
    unit = (request.timespanUnit or "months").lower()
    count = max(int(request.timespanCount or 1), 1)
    horizon = max(int(request.horizonBars or 1), 1)
    f = max(float(request.takeProfitFraction or 0.0), 1e-6)
    s = max(float(request.stopLossFraction or 0.0), 1e-6)
    img_dim = max(64, min(int(request.imageDimension or 224), 1024))

    try:
        history = _preview_fetch_history(symbol, tf)
    except Exception as exc:  # noqa: BLE001 — network/lib errors degrade to a message
        logger.warning("Preview fetch failed for %s/%s: %s", symbol, tf, exc)
        return {"ok": False, "message": f"Could not load market data for {symbol}."}

    if history is None or history.empty or "Close" not in history:
        return {"ok": False, "message": f"No market data available for {symbol}."}

    history = history.dropna(subset=["Close"])
    idx = history.index
    n = len(history)
    if n < 3:
        return {"ok": False, "message": f"Not enough history for {symbol}."}

    def _to_naive(ts):
        ts = pd.Timestamp(ts)
        return ts.tz_localize(None) if ts.tzinfo is not None else ts

    naive_idx = [_to_naive(t) for t in idx]

    # Pick the window-end bar position.
    end_pos: Optional[int] = None
    if (request.volumeMode == "by_period") and request.trainingStartIso:
        # Anchor the previewed example at the (inputted) training start date.
        try:
            start_dt = _to_naive(pd.Timestamp(request.trainingStartIso))
            start_pos = next((i for i, t in enumerate(naive_idx) if t >= start_dt), 0)
            end_dt = _to_naive(pd.Timestamp(request.trainingStartIso)) + relativedelta(**{unit: count})
            end_pos = next((i for i, t in enumerate(naive_idx) if t >= end_dt), None)
            if end_pos is None:
                end_pos = min(start_pos + 30, n - 1)
        except (ValueError, TypeError):
            end_pos = None
    if end_pos is None:
        # Fixed-size mode (or bad dates): anchor at the dataset end date, else newest bars.
        ref = request.referenceEndIso
        if ref:
            try:
                ref_dt = _to_naive(pd.Timestamp(ref))
                cand = [i for i, t in enumerate(naive_idx) if t <= ref_dt]
                end_pos = cand[-1] if cand else n - 1
            except (ValueError, TypeError):
                end_pos = n - 1
        else:
            end_pos = n - 1

    # Ensure at least a few future bars exist to resolve the label; keep the window length.
    max_end = n - 1 - horizon
    if max_end < 2:
        max_end = n - 2
    if end_pos > max_end:
        end_pos = max_end
    if end_pos < 2:
        end_pos = min(2, n - 2)

    end_date = naive_idx[end_pos]
    start_date = end_date - relativedelta(**{unit: count})
    start_pos = next((i for i, t in enumerate(naive_idx) if t >= start_date), 0)
    if start_pos >= end_pos:
        start_pos = max(0, end_pos - 2)

    chart_df = history.iloc[start_pos:end_pos + 1]
    future_df = history.iloc[end_pos + 1:end_pos + 1 + horizon]
    if len(chart_df) < 2 or future_df.empty:
        return {"ok": False, "message": f"Not enough data around this date for {symbol}."}

    label_info = _preview_label(chart_df, future_df, f, s)
    label, entry, tp_level, sl_level, which, hit_price, hit_offset = label_info

    try:
        image = _render_preview_png(bool(request.useCandles), chart_df, img_dim)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Preview render failed for %s/%s: %s", symbol, tf, exc)
        return {"ok": False, "message": "Could not render the preview chart."}

    def _iso(ts) -> str:
        return _to_naive(ts).strftime("%Y-%m-%d")

    hit_date = _iso(future_df.index[hit_offset]) if hit_offset is not None else None
    return {
        "ok": True,
        "symbol": symbol,
        "timeframe": tf,
        "image": image,
        "window_start": _iso(chart_df.index[0]),
        "window_end": _iso(chart_df.index[-1]),
        "horizon_bars": horizon,
        "horizon_end": _iso(future_df.index[-1]),
        "entry_price": round(entry, 4) if entry is not None else None,
        "tp_price": round(tp_level, 4) if tp_level is not None else None,
        "sl_price": round(sl_level, 4) if sl_level is not None else None,
        "take_profit_pct": round(f * 100, 3),
        "stop_loss_pct": round(s * 100, 3),
        "label": label,
        "hit": which,
        "hit_date": hit_date,
    }


@app.get("/api/training-chart-generator/config/{run_id}")
async def get_training_chart_generator_config(run_id: str) -> Dict[str, Any]:
    """Return the saved generator request for this run (for results / history)."""
    run_dir = get_run_dir(run_id)
    path = os.path.join(run_dir, "generator_config.json")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="No saved configuration for this run")
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=500, detail=f"Could not read configuration: {exc}") from exc


@app.get("/api/training-chart-generator/progress/{run_id}")
async def get_training_chart_generator_progress(run_id: str) -> ProgressResponse:
    """Get progress for a training chart generator run"""
    progress_data = read_progress_file(run_id)
    print(f"Progress request for run {run_id}: {progress_data}")
    return ProgressResponse(**progress_data)

@app.get("/api/training-chart-generator/artifacts/{run_id}")
async def get_training_chart_generator_artifacts(run_id: str) -> DatasetStats:
    """Get dataset statistics for a training chart generator run"""
    artifacts_dir = get_artifacts_dir(run_id)
    stats_file = os.path.join(artifacts_dir, "dataset_stats.json")

    try:
        if os.path.exists(stats_file):
            with open(stats_file, 'r') as f:
                return DatasetStats(**json.load(f))
    except (json.JSONDecodeError, IOError):
        pass

    # Return default stats if file doesn't exist or can't be read
    return DatasetStats()

@app.post("/api/training-chart-generator/cancel/{run_id}")
async def cancel_training_chart_generator(run_id: str):
    """Cancel a training chart generator run"""
    run_dir = get_run_dir(run_id)

    if not os.path.exists(run_dir):
        raise HTTPException(status_code=404, detail="Run not found")

    return cancel_run_process(run_id, "Generation cancelled by user")


@app.post("/api/labeling-optimizer/cancel/{run_id}")
async def cancel_labeling_optimizer(run_id: str):
    """Cancel a labeling optimizer run"""
    run_dir = get_run_dir(run_id)
    if not os.path.exists(run_dir):
        raise HTTPException(status_code=404, detail="Run not found")
    return cancel_run_process(run_id, "Optimization cancelled by user")


@app.post("/api/runs/{run_id}/cancel")
async def cancel_any_run(run_id: str):
    """Cancel any active tool run by id (subprocess kill + status update)."""
    return cancel_run_process(run_id, "Cancelled by user")

@app.get("/api/training-chart-generator/download/{run_id}")
async def download_training_chart_generator_dataset(run_id: str):
    """Download the generated training dataset ZIP file"""
    run_dir = get_run_dir(run_id)
    zip_path = os.path.join(run_dir, f"training-dataset-{run_id}.zip")

    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="Dataset not found or still generating")

    return FileResponse(
        zip_path,
        media_type='application/zip',
        filename=f"training-dataset-{run_id}.zip"
    )

# Dataset storage
datasets_dir = os.path.join(os.path.dirname(__file__), "..", "datasets")
os.makedirs(datasets_dir, exist_ok=True)

# Dataset upload endpoints
@app.post("/datasets/upload", response_model=DatasetUploadResponse)
async def upload_dataset(
    file: UploadFile = File(...),
    source: Optional[str] = Form(None),
    generator_run_id: Optional[str] = Form(None),
):
    """Upload and extract a dataset ZIP file.

    Optional `source` / `generator_run_id` form fields record provenance
    (e.g. the Trainer page re-uploading a chart-generator ZIP) for lineage.
    """
    if not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="Only ZIP files are supported")

    # Check file size (warning at 2GB)
    file_size = 0
    content = await file.read()
    file_size = len(content)

    if file_size > 2 * 1024 * 1024 * 1024:  # 2GB
        print(f"Warning: Large file upload ({file_size} bytes)")

    # Generate dataset ID
    dataset_id = str(uuid.uuid4())[:8]
    dataset_dir = os.path.join(datasets_dir, dataset_id)
    images_dir = os.path.join(dataset_dir, "images")

    try:
        # Create directories
        os.makedirs(images_dir, exist_ok=True)

        # Save ZIP file
        zip_path = os.path.join(dataset_dir, f"{dataset_id}.zip")
        with open(zip_path, 'wb') as f:
            f.write(content)

        # Extract ZIP
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(images_dir)

        # Validate and analyze extracted files
        summary = analyze_dataset(images_dir)

        # Save summary
        summary_data = {
            "dataset_id": dataset_id,
            "extracted_path": images_dir,
            "total_images": summary["total_images"],
            "label_distribution": summary["label_distribution"],
            "example_filenames": summary["example_filenames"],
            "created_at": time.time()
        }
        if source:
            summary_data["source"] = source
        if generator_run_id:
            summary_data["generator_run_id"] = generator_run_id

        summary_file = os.path.join(dataset_dir, "summary.json")
        with open(summary_file, 'w') as f:
            json.dump(summary_data, f, indent=2)

        return DatasetUploadResponse(
            dataset_id=dataset_id,
            extracted_path=images_dir,
            summary=summary
        )

    except Exception as e:
        # Cleanup on failure
        if os.path.exists(dataset_dir):
            shutil.rmtree(dataset_dir)
        raise HTTPException(status_code=500, detail=f"Dataset processing failed: {str(e)}")

@app.get("/datasets/{dataset_id}", response_model=DatasetSummary)
async def get_dataset_info(dataset_id: str):
    """Get dataset information and summary"""
    dataset_dir = os.path.join(datasets_dir, dataset_id)
    summary_file = os.path.join(dataset_dir, "summary.json")

    if not os.path.exists(summary_file):
        raise HTTPException(status_code=404, detail="Dataset not found")

    with open(summary_file, 'r') as f:
        return DatasetSummary(**json.load(f))

def analyze_dataset(images_dir: str) -> Dict[str, Any]:
    """Analyze extracted dataset and build summary"""
    total_images = 0
    label_distribution = {}
    example_filenames = []

    # Supported image extensions
    image_extensions = {'.png', '.jpg', '.jpeg', '.webp'}

    # Walk through all files in the extracted directory
    for root, dirs, files in os.walk(images_dir):
        for file in files:
            if any(file.lower().endswith(ext) for ext in image_extensions):
                total_images += 1

                # Extract label from filename (look for _label{N} pattern)
                if '_label' in file:
                    try:
                        label_part = file.split('_label')[1]
                        label = label_part[0]  # First character after _label
                        if label.isdigit():
                            label_distribution[label] = label_distribution.get(label, 0) + 1
                    except (IndexError, ValueError):
                        pass

                # Collect example filenames (first 5)
                if len(example_filenames) < 5:
                    example_filenames.append(file)

    if total_images == 0:
        raise ValueError("No image files found in the uploaded ZIP")

    return {
        "total_images": total_images,
        "label_distribution": label_distribution,
        "example_filenames": example_filenames
    }

def _load_generator_config_from_disk(generator_run_id: str) -> Optional[Dict[str, Any]]:
    """Saved generator config for a chart-generator run, or None.

    Prefers the full ``generator_config.json``. For older runs that predate it,
    falls back to whatever was recorded in ``artifacts/dataset_stats.json``
    (typically just timeframe + chart type) so partial params can still surface.
    """
    run_dir = get_run_dir(generator_run_id)
    path = os.path.join(run_dir, "generator_config.json")
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    stats = _read_json_dict(os.path.join(run_dir, "artifacts", "dataset_stats.json"))
    if stats:
        recovered: Dict[str, Any] = {}
        if stats.get("timeframe"):
            recovered["timeframe"] = stats["timeframe"]
        if stats.get("chart_type"):
            recovered["useCandles"] = stats["chart_type"] == "candlestick"
        if recovered:
            return recovered
    return None


# Generated chart filenames look like: SYMBOL_YYYY-MM-DD_to_YYYY-MM-DD_label{0|1}.png
_CHART_FILENAME_RE = re.compile(
    r"^(?P<symbol>[A-Za-z0-9.\-]+)_(?P<start>\d{4}-\d{2}-\d{2})_to_(?P<end>\d{4}-\d{2}-\d{2})_label(?P<label>\d)",
)


def _parse_meta_from_chart_filenames(filenames: List[str]) -> Dict[str, Any]:
    """Recover symbols + covered date range from generated chart filenames.

    This reads information already encoded in the artifact names (not fabricated). Used
    as a fallback for older datasets/models whose summary.json predates generator linkage.
    """
    symbols: List[str] = []
    starts: List[str] = []
    ends: List[str] = []
    for fn in filenames:
        m = _CHART_FILENAME_RE.match(os.path.basename(str(fn)))
        if not m:
            continue
        sym = m.group("symbol").upper()
        if sym not in symbols:
            symbols.append(sym)
        starts.append(m.group("start"))
        ends.append(m.group("end"))
    out: Dict[str, Any] = {}
    if symbols:
        out["symbols"] = ",".join(sorted(symbols))
    if starts:
        out["period_start"] = min(starts)
    if ends:
        out["period_end"] = max(ends)
    return out


def _dataset_meta_from_disk(dataset_id: str) -> Dict[str, Any]:
    """Best-effort {symbols, period_start, period_end} for a dataset from its files on disk.

    Prefers the full image listing (accurate range); falls back to the summary's
    example_filenames. Returns {} when nothing can be recovered.
    """
    ddir = os.path.join(datasets_dir, str(dataset_id))
    images_dir = os.path.join(ddir, "images")
    names: List[str] = []
    try:
        if os.path.isdir(images_dir):
            names = [f for f in os.listdir(images_dir) if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
    except OSError:
        names = []
    if not names:
        summary = _read_json_dict(os.path.join(ddir, "summary.json")) or {}
        ex = summary.get("example_filenames")
        if isinstance(ex, list):
            names = [str(x) for x in ex]
    return _parse_meta_from_chart_filenames(names)


def _resolve_generator_run_id_for_dataset(dataset_id: str) -> Optional[str]:
    """Generator run recorded in the dataset's summary.json at upload time, or None."""
    path = os.path.join(datasets_dir, str(dataset_id), "summary.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            summary = json.load(f)
        gid = summary.get("generator_run_id") if isinstance(summary, dict) else None
        return str(gid) if gid else None
    except (json.JSONDecodeError, OSError):
        return None


def _generator_output_names(generator_run_id: str) -> set:
    """Basenames of the chart PNGs a generator run produced.

    Reads the ``temp_output`` directory when present, otherwise the delivered
    ``training-dataset-<id>.zip`` name list (no decompression). Returns an empty
    set when neither is available.
    """
    run_path = get_run_dir(generator_run_id)
    temp_output = os.path.join(run_path, "temp_output")
    try:
        if os.path.isdir(temp_output):
            names = {f for f in os.listdir(temp_output) if f.lower().endswith(".png")}
            if names:
                return names
    except OSError:
        pass
    zip_path = os.path.join(run_path, f"training-dataset-{generator_run_id}.zip")
    if os.path.isfile(zip_path):
        try:
            with zipfile.ZipFile(zip_path) as zf:
                return {os.path.basename(n) for n in zf.namelist() if n.lower().endswith(".png")}
        except (zipfile.BadZipFile, OSError):
            pass
    return set()


def _build_generator_output_index() -> Dict[str, set]:
    """Map each generator run id -> set of chart filenames it produced.

    Used to backtrace a dataset (and the models trained on it) to the generator
    run that created it, by matching identical chart filenames. Cheap: only reads
    directory listings / zip name tables.
    """
    index: Dict[str, set] = {}
    try:
        entries = os.listdir(runs_dir)
    except OSError:
        return index
    for name in entries:
        run_path = os.path.join(runs_dir, name)
        if not os.path.isdir(run_path):
            continue
        # A generator run is identifiable by its config, delivered zip, or output dir.
        has_marker = (
            os.path.isfile(os.path.join(run_path, "generator_config.json"))
            or os.path.isfile(os.path.join(run_path, f"training-dataset-{name}.zip"))
            or os.path.isdir(os.path.join(run_path, "temp_output"))
        )
        if not has_marker:
            continue
        names = _generator_output_names(name)
        if names:
            index[name] = names
    return index


def _match_generator_run_for_dataset(dataset_id: str, index: Dict[str, set]) -> Optional[str]:
    """Find the generator run whose output contains this dataset's charts.

    Datasets can be a balanced subset of the generator's output, so we require
    the dataset's filenames to be (almost entirely) a subset of a generator run's
    output rather than an exact match.
    """
    ddir = os.path.join(datasets_dir, str(dataset_id), "images")
    try:
        dataset_names = {f for f in os.listdir(ddir) if f.lower().endswith(".png")} if os.path.isdir(ddir) else set()
    except OSError:
        dataset_names = set()
    if not dataset_names:
        summary = _read_json_dict(os.path.join(datasets_dir, str(dataset_id), "summary.json")) or {}
        ex = summary.get("example_filenames")
        if isinstance(ex, list):
            dataset_names = {os.path.basename(str(x)) for x in ex if str(x).lower().endswith(".png")}
    if not dataset_names:
        return None
    for gid, gen_names in index.items():
        overlap = len(dataset_names & gen_names)
        if overlap and overlap >= 0.9 * len(dataset_names):
            return gid
    return None


def _persist_dataset_generator_link(dataset_id: str, generator_run_id: str) -> None:
    """Record a recovered generator link into the dataset's summary.json.

    Makes the backtrace permanent so subsequent reads hit the fast path and the
    trainer-time metadata resolver picks it up too. Never overwrites an existing link.
    """
    path = os.path.join(datasets_dir, str(dataset_id), "summary.json")
    summary = _read_json_dict(path)
    if summary is None or summary.get("generator_run_id"):
        return
    summary["generator_run_id"] = generator_run_id
    summary.setdefault("source", "generator")
    summary["generator_link_recovered_by"] = "filename_match"
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2)
    except OSError:
        pass


_GENERATOR_MIRROR_KEYS = (
    "symbols",
    "useCandles",
    "timeframe",
    "timespanUnit",
    "timespanCount",
    "chartsPerLabel",
    "horizonBars",
    "takeProfitFraction",
    "stopLossFraction",
    "imageDimension",
)


def _derive_model_fields_from_generator_config(generator_config: Dict[str, Any]) -> Dict[str, Any]:
    """Top-level model metadata fields mirrored from a generator config (only what's recorded)."""
    out: Dict[str, Any] = {}
    for key in _GENERATOR_MIRROR_KEYS:
        if generator_config.get(key) is not None:
            out[key] = generator_config[key]
    if generator_config.get("volumeMode") == "by_period" and generator_config.get("trainingStartIso"):
        out["training_period_start"] = generator_config["trainingStartIso"]
    if generator_config.get("referenceEndIso"):
        out["training_period_end"] = generator_config["referenceEndIso"]
    return out


def _write_trainer_model_metadata(run_id: str, request: "TrainerRequest", trainer_config: Dict[str, Any]) -> None:
    """Write model_metadata.json into the trainer run dir.

    Links the trained model to its source dataset and (when known) the
    chart-generator run + config it was built from. Unknown fields are
    omitted rather than guessed.
    """
    metadata: Dict[str, Any] = {
        "schema_version": 1,
        "source": "trained",
        "training_run_id": run_id,
        "model_name": request.model_name,
        "created_at": time.time(),
        "training_config": trainer_config,
    }
    if request.dataset_id:
        metadata["dataset_id"] = request.dataset_id
    # Prefer the explicit link from the client; otherwise fall back to the provenance
    # recorded in the dataset's summary.json at upload time.
    generator_run_id = request.generator_run_id
    if not generator_run_id and request.dataset_id:
        generator_run_id = _resolve_generator_run_id_for_dataset(request.dataset_id)
    if generator_run_id:
        metadata["generator_run_id"] = generator_run_id
        generator_config = _load_generator_config_from_disk(generator_run_id)
        if generator_config:
            metadata["generator_config"] = generator_config
            metadata.update(_derive_model_fields_from_generator_config(generator_config))
    try:
        with open(os.path.join(get_run_dir(run_id), "model_metadata.json"), "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)
    except (OSError, TypeError) as exc:
        logger.warning("Could not write model_metadata.json for %s: %s", run_id, exc)


@app.get("/trainer/runs/{run_id}/model-metadata")
async def get_trainer_model_metadata(run_id: str) -> Dict[str, Any]:
    """Model/training metadata for a trainer run (404 when the run predates metadata support).

    Read-time enrichment: when the stored file lacks generator settings but the linked
    generator config exists on disk (directly or via the dataset's recorded provenance),
    the recorded values are merged into the response. Nothing is guessed.
    """
    path = os.path.join(get_run_dir(run_id), "model_metadata.json")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="No model metadata for this run")
    try:
        with open(path, "r", encoding="utf-8") as f:
            metadata = json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=500, detail=f"Could not read model metadata: {exc}") from exc
    if isinstance(metadata, dict) and metadata.get("symbols") is None:
        generator_run_id = metadata.get("generator_run_id")
        if not generator_run_id and metadata.get("dataset_id"):
            generator_run_id = _resolve_generator_run_id_for_dataset(str(metadata["dataset_id"]))
        if generator_run_id:
            generator_config = _load_generator_config_from_disk(str(generator_run_id))
            if generator_config:
                metadata.setdefault("generator_run_id", generator_run_id)
                metadata.setdefault("generator_config", generator_config)
                for key, value in _derive_model_fields_from_generator_config(generator_config).items():
                    metadata.setdefault(key, value)
    return metadata


@app.get("/models/{model_id}/metadata")
async def get_uploaded_model_metadata(model_id: str) -> Dict[str, Any]:
    """Metadata sidecar for an uploaded .keras model (404 when none exists — never fabricated)."""
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", model_id or ""):
        raise HTTPException(status_code=400, detail="Invalid model id")
    path = Path(MODEL_STORAGE_ROOT) / f"{model_id}.metadata.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="No metadata for this model")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=500, detail=f"Could not read model metadata: {exc}") from exc


# Trainer endpoints
trainer_runs = {}  # In-memory storage (use database in production)

# Backtester endpoints
from runners.backtester_runner import run_backtester
from runners.new_backtester_runner import run_backtester_realtime

def _parse_testdata_png_name(filename: str) -> Dict[str, Any]:
    """Parse `{SYMBOL}_{start}_to_{end}_label{N}.png` into label/start/end (best effort)."""
    out: Dict[str, Any] = {"label": None, "start": None, "end": None}
    stem = filename[:-4] if filename.lower().endswith(".png") else filename
    m = re.search(r"_label(\d)$", stem)
    if m:
        out["label"] = m.group(1)
        stem = stem[: m.start()]
    dates = re.findall(r"\d{4}-\d{2}-\d{2}", stem)
    if dates:
        out["start"] = dates[0]
        out["end"] = dates[-1]
    return out


def _finalize_testdata_from_output(config: Dict[str, Any], run_dir: Path, progress_cb: Optional[Callable] = None) -> Optional[Dict[str, Any]]:
    """Copy PNGs from run output/ into datasets/, write results + ZIP. Idempotent when results already exist."""
    results_file = run_dir / "testdata_results.json"
    if results_file.is_file():
        try:
            with open(results_file, "r") as f:
                existing = json.load(f)
            if isinstance(existing, dict) and existing.get("dataset_id"):
                return existing
        except (json.JSONDecodeError, OSError):
            pass

    output_dir = run_dir / "output"
    png_files = sorted(output_dir.glob("*.png")) if output_dir.is_dir() else []
    if not png_files:
        return None

    if progress_cb:
        progress_cb("processing", 0.85, {"message": f"Registering {len(png_files)} charts as a test dataset…"})

    total_images = len(png_files)
    label_distribution: Dict[str, int] = {}
    chart_dates: List[str] = []
    for png_file in png_files:
        parsed = _parse_testdata_png_name(png_file.name)
        if parsed["label"] is not None:
            label_distribution[parsed["label"]] = label_distribution.get(parsed["label"], 0) + 1
        for key in ("start", "end"):
            if parsed[key]:
                chart_dates.append(parsed[key])

    dataset_id = f"dataset_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    dataset_path = Path(datasets_dir) / dataset_id
    dataset_images_path = dataset_path / "images"
    dataset_images_path.mkdir(parents=True, exist_ok=True)
    for png_file in png_files:
        shutil.copy2(png_file, dataset_images_path / png_file.name)

    summary = {
        "total_images": total_images,
        "label_distribution": label_distribution,
        "start_date": min(chart_dates) if chart_dates else None,
        "end_date": max(chart_dates) if chart_dates else None,
    }

    try:
        with open(dataset_path / "summary.json", "w") as f:
            json.dump(
                {
                    "dataset_id": dataset_id,
                    "extracted_path": str(dataset_images_path),
                    "total_images": total_images,
                    "label_distribution": label_distribution,
                    "example_filenames": [p.name for p in png_files[:5]],
                    "created_at": time.time(),
                    "source": "testdata",
                    "kind": "test",
                    "dataset_name": (config.get("dataset_name") or "").strip() or None,
                    "symbols": config.get("symbols"),
                    "timeframe": config.get("timeframe"),
                    "period_start": config.get("test_period_start") or summary["start_date"],
                    "period_end": config.get("test_period_end") or summary["end_date"],
                    "test_period_start": config.get("test_period_start"),
                    "test_period_end": config.get("test_period_end"),
                    "training_period_start": config.get("training_period_start"),
                    "training_period_end": config.get("training_period_end"),
                    "model_id": config.get("model_id"),
                    "training_run_id": config.get("training_run_id"),
                    "generator_run_id": config.get("generator_run_id"),
                    "source_run_id": run_dir.name if hasattr(run_dir, "name") else None,
                },
                f,
                indent=2,
            )
    except OSError as exc:
        logger.warning("Could not write dataset summary for %s: %s", dataset_id, exc)

    results = {
        "dataset_id": dataset_id,
        "dataset_path": str(dataset_images_path),
        "summary": summary,
        "model_id": config.get("model_id"),
        "training_run_id": config.get("training_run_id"),
        "generator_run_id": config.get("generator_run_id"),
        "dataset_name": config.get("dataset_name"),
        "symbols": config.get("symbols"),
        "training_period_start": config.get("training_period_start"),
        "training_period_end": config.get("training_period_end"),
        "test_period_start": config.get("test_period_start"),
        "test_period_end": config.get("test_period_end"),
    }
    with open(results_file, "w") as f:
        json.dump(results, f, indent=2)

    # Eager ZIP so Download works immediately (same idea as the training generator).
    try:
        zip_path = run_dir / "testdata.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for png_file in png_files:
                zf.write(png_file, png_file.name)
    except OSError as exc:
        logger.warning("Could not prebuild testdata.zip for %s: %s", run_dir.name, exc)

    if progress_cb:
        progress_cb("done", 1.0, {
            "message": f"Generated {total_images} labeled images successfully!",
            "dataset_id": dataset_id,
        })
    return results


def _load_testdata_config(run_dir: Path) -> Dict[str, Any]:
    cfg = _read_json_dict(str(run_dir / "testdata_config.json"))
    return cfg if isinstance(cfg, dict) else {}


def run_testdata_generator(config: Dict[str, Any], run_dir: Path, progress_cb: Callable, run_id: str):
    """Run the test data generator script (`backend/scripts/1.4_Adj_testL.py`).

    Uses the same fast path as training charts: one yfinance download per symbol +
    matplotlib Agg. Progress comes from the script's progress.json and the growing
    ``output/`` folder.
    """
    try:
        output_dir = run_dir / "output"
        output_dir.mkdir(parents=True, exist_ok=True)

        script_path = _resolve_pipeline_script("1.4_Adj_testL.py")
        cmd = [
            sys.executable,
            str(script_path),
            "--symbols", str(config["symbols"]),
            "--x", str(config["period_length_units"]),
            "--out_dir", str(output_dir),
            "--use_candles", "yes" if config.get("use_candles") else "no",
            "--t", str(config["timeframe"]),
            "--u", str(config["span_unit"]),
            "--o", str(config["span_units_count"]),
            "--w", str(config["future_horizon_bars"]),
            "--f", str(config["tp_frac"]),
            "--s", str(config["sl_frac"]),
            "--img_dim", str(config["img_dim"]),
            "--i1", str(config["end_offset_units"]),
            "--use_sma", "yes" if config.get("use_sma") else "no",
            "--sma_length", str(config.get("sma_length") or 20),
            "--run_id", run_id,
            "--progress_dir", str(run_dir),
        ]

        expected = max(1, int(config.get("period_length_units") or 1))
        n_symbols = max(1, len([s for s in str(config.get("symbols") or "").split(",") if s.strip()]))
        expected_total = max(1, expected * n_symbols)

        progress_cb("generating", 0.05, {"message": "Starting test data generator…"})
        print(f"Starting testdata generator: {' '.join(cmd)}")

        proc = popen_managed(
            run_id,
            cmd,
            cwd=str(_SCRIPTS_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        start_t = time.time()
        timeout_s = 1800
        last_count = 0
        stdout_chunks: List[str] = []
        stderr_chunks: List[str] = []

        while True:
            if _progress_phase_is_cancelled(run_id):
                kill_managed(run_id)
                progress_cb("cancelled", 0.0, {"message": "Cancelled by user"})
                return

            ret = proc.poll()
            try:
                png_count = sum(1 for _ in output_dir.glob("*.png"))
            except OSError:
                png_count = 0
            if png_count != last_count or ret is not None:
                last_count = png_count
                frac = min(0.8, 0.05 + 0.75 * (png_count / expected_total))
                progress_cb(
                    "generating",
                    frac,
                    {"message": f"Rendering charts… {png_count} saved"},
                )
            if ret is not None:
                break
            if time.time() - start_t > timeout_s:
                kill_managed(run_id)
                if last_count > 0:
                    progress_cb("processing", 0.82, {
                        "message": f"Timed out — saving {last_count} charts already generated…"
                    })
                    _finalize_testdata_from_output(config, run_dir, progress_cb)
                    return
                progress_cb("error", 0.0, {"message": "Test data generation timed out after 30 minutes"})
                return
            time.sleep(0.5)

        # Drain remaining pipes
        try:
            out, err = proc.communicate(timeout=5)
            if out:
                stdout_chunks.append(out)
            if err:
                stderr_chunks.append(err)
        except Exception:
            pass
        finally:
            running_processes.pop(run_id, None)

        if _progress_phase_is_cancelled(run_id):
            progress_cb("cancelled", 0.0, {"message": "Cancelled by user"})
            return

        png_files = sorted(output_dir.glob("*.png"))
        if proc.returncode not in (0, None) and not png_files:
            error_msg = ("".join(stderr_chunks) or "".join(stdout_chunks) or "Unknown error")[-500:]
            progress_cb("error", 0.0, {"message": f"Test data generation failed: {error_msg}"})
            return

        if not png_files:
            progress_cb("error", 0.0, {"message": "Test data generation produced no chart images (check symbols and test period)"})
            return

        _finalize_testdata_from_output(config, run_dir, progress_cb)

    except Exception as e:
        if _progress_phase_is_cancelled(run_id):
            progress_cb("cancelled", 0.0, {"message": "Cancelled by user"})
            return
        progress_cb("error", 0.0, {"message": f"Test data generation failed: {str(e)[:200]}"})
        raise

@app.post("/trainer/runs", response_model=RunResponse)
async def start_trainer(request: TrainerRequest, background_tasks: BackgroundTasks):
    """Start a CNN trainer run"""
    try:
        from runners.trainer_runner import run_trainer, CancelledError
    except Exception as import_error:
        raise HTTPException(
            status_code=500,
            detail=f"Trainer dependencies not available: {import_error}",
        ) from import_error
    run_id = generate_run_id()

    # Register run globally
    register_run(run_id, "trainer", f"/tools/trainer/runs/{run_id}")

    run_dir = Path(get_run_dir(run_id))
    run_dir.mkdir(parents=True, exist_ok=True)

    # Resolve training folder from dataset_id or folder_name
    if request.dataset_id:
        # Use uploaded dataset
        dataset_images_dir = os.path.join(datasets_dir, request.dataset_id, "images")
        if not os.path.exists(dataset_images_dir):
            raise HTTPException(status_code=400, detail=f"Dataset {request.dataset_id} not found")
        training_folder = dataset_images_dir
    elif request.folder_name:
        # Legacy support
        training_folder = request.folder_name
    else:
        raise HTTPException(status_code=400, detail="Either dataset_id or folder_name must be provided")

    # Create config with resolved folder
    trainer_config = request.dict()
    trainer_config["folder_name"] = training_folder

    # Persist model/training metadata next to the artifacts (no fabricated values:
    # generator-derived fields are only included when the generator config is found on disk).
    _write_trainer_model_metadata(run_id, request, trainer_config)

    # Initialize run status
    cancel_event = threading.Event()
    trainer_runs[run_id] = {
        "status": "running",
        "progress": {"phase": "starting", "percent": 0, "message": "Initializing..."},
        "last_metrics": None,
        "history_preview": [],
        "artifact_paths": [],
        "config": trainer_config,
        "run_dir": run_dir,
        "cancel_event": cancel_event,
    }

    def progress_callback(phase: str, percent: int, data: Dict[str, Any]):
        trainer_runs[run_id]["progress"] = {
            "phase": phase,
            "percent": percent,
            **data
        }
        if "epoch" in data:
            trainer_runs[run_id]["last_metrics"] = {
                "epoch": data.get("epoch"),
                "epochs": data.get("epochs"),
                "loss": data.get("loss"),
                "accuracy": data.get("accuracy"),
                "val_loss": data.get("val_loss"),
                "val_accuracy": data.get("val_accuracy")
            }
            # Keep last 20 history points for preview
            history = trainer_runs[run_id]["history_preview"]
            history.append(trainer_runs[run_id]["last_metrics"])
            if len(history) > 20:
                history.pop(0)

        # Update global run registry
        message = data.get("message", f"{phase}")
        if "epoch" in data:
            epoch = data.get("epoch", 0)
            epochs = data.get("epochs", 0)
            acc = data.get("val_accuracy", 0)
            message = f"Epoch {epoch}/{epochs} • Val acc {acc:.3f}"

        update_run_progress(run_id, percent / 100.0, phase, message)

    def run_trainer_safe():
        try:
            run_trainer(trainer_config, run_dir, progress_callback, cancel_event=cancel_event)
            trainer_runs[run_id]["status"] = "done"
            # Finalize the global registry + on-disk manifest (progress callbacks never
            # carry a terminal status, so without this the manifest stays "running").
            update_run_progress(run_id, 1.0, "completed", "Training completed", "succeeded")
        except CancelledError:
            trainer_runs[run_id]["status"] = "cancelled"
            trainer_runs[run_id]["progress"] = {
                "phase": "cancelled",
                "percent": 0,
                "message": "Training cancelled",
            }
            update_run_progress(run_id, 0.0, "cancelled", "Training cancelled", "cancelled")
        except Exception as exc:
            trainer_runs[run_id]["status"] = "failed"
            trainer_runs[run_id]["progress"] = {
                "phase": "error",
                "percent": 0,
                "message": str(exc),
            }
            update_run_progress(run_id, 0.0, "error", str(exc), "failed")
            raise

    # Start training in background
    background_tasks.add_task(run_trainer_safe)

    return RunResponse(run_id=run_id)


@app.post("/trainer/runs/{run_id}/cancel")
async def cancel_trainer_run(run_id: str):
    """Cancel a running trainer job"""
    run = trainer_runs.get(run_id)
    if not run:
        # Still try unified cancel (progress + registry) so UI can clear the run
        return cancel_run_process(run_id, "Training cancelled")
    if run.get("status") != "running":
        return {"status": run.get("status"), "message": "Run is not active"}
    return cancel_run_process(run_id, "Training cancelled")

@app.get("/trainer/runs/{run_id}", response_model=TrainerProgressResponse)
async def get_trainer_progress(run_id: str):
    """Get trainer run progress and status"""
    if run_id in trainer_runs:
        run_data = dict(trainer_runs[run_id])
        run_data.pop("cancel_event", None)
        return TrainerProgressResponse(**run_data)

    # Check if run directory exists (don't rely on in-memory trainer_runs)
    run_dir = get_run_dir(run_id)
    if not os.path.exists(run_dir):
        raise HTTPException(status_code=404, detail="Trainer run not found")

    # Look for common model file extensions
    model_extensions = ['.keras', '.h5', '.pkl', '.joblib']
    model_found = any(
        filename.endswith(tuple(model_extensions))
        for filename in os.listdir(run_dir)
    )

    if not model_found:
        # No in-memory run + no model on disk -> treat as stale
        raise HTTPException(status_code=404, detail="Trainer run not found")

    # Provide completed trainer data structure
    run_data = {
        "status": "done",
        "progress": {"phase": "completed", "percent": 100, "message": "Training completed"},
        "last_metrics": None,
        "history_preview": [],
        "artifact_paths": ["model", "metrics", "summary", "history"],
        "config": {"model_name": "trained_model.keras"},
        "run_dir": run_dir
    }

    return TrainerProgressResponse(**run_data)


@app.get("/trainer/runs/{run_id}/history")
async def get_trainer_history(run_id: str):
    """Per-epoch metrics from `history.json` (written at end of training). Used by the analysis UI."""
    run_dir = get_run_dir(run_id)
    if not os.path.exists(run_dir):
        raise HTTPException(status_code=404, detail="Trainer run not found")
    history_path = os.path.join(run_dir, "history.json")
    if not os.path.isfile(history_path):
        return []
    try:
        with open(history_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


@app.get("/trainer/runs/{run_id}/download/model")
async def download_trainer_model(run_id: str):
    """Download the trained model file"""
    run_dir = get_run_dir(run_id)
    if not os.path.exists(run_dir):
        raise HTTPException(status_code=404, detail="Trainer run not found")

    # Look for model files in the run directory
    model_extensions = ['.keras', '.h5', '.pkl', '.joblib']
    model_file = None
    for filename in os.listdir(run_dir):
        if any(filename.endswith(ext) for ext in model_extensions):
            model_file = filename
            break

    if not model_file:
        raise HTTPException(status_code=404, detail="Model not found")

    model_path = os.path.join(run_dir, model_file)
    # Prefer the user-facing training name so re-uploads can rematch by filename.
    download_name = model_file
    meta = _read_json_dict(os.path.join(run_dir, "model_metadata.json")) or {}
    named = meta.get("model_name")
    if isinstance(named, str) and named.strip().lower().endswith((".keras", ".h5")):
        download_name = Path(named.strip()).name

    return FileResponse(
        model_path,
        media_type='application/octet-stream',
        filename=os.path.basename(download_name)
    )

@app.post("/trainer/runs/{run_id}/analysis", response_model=AnalysisResponse)
async def start_trainer_analysis(run_id: str, request: AnalysisRequest, background_tasks: BackgroundTasks):
    """Start CNN analysis on a trained model"""
    try:
        from runners.cnn_analysis_runner import run_cnn_analysis
    except Exception as import_error:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis dependencies not available: {import_error}",
        ) from import_error
    run_dir = get_run_dir(run_id)
    if not os.path.exists(run_dir):
        raise HTTPException(status_code=404, detail="Trainer run not found")

    # Resolve model path from disk to handle server restarts
    model_extensions = ['.keras', '.h5', '.pkl', '.joblib']
    model_file = None
    for filename in os.listdir(run_dir):
        if any(filename.endswith(ext) for ext in model_extensions):
            model_file = filename
            break

    if not model_file:
        raise HTTPException(status_code=400, detail="Training must be completed before analysis")

    analysis_id = f"analysis_{generate_run_id()}"
    model_path = Path(run_dir) / model_file

    # Register analysis run globally
    analysis_run_id = f"{run_id}_{analysis_id}"
    register_run(
        analysis_run_id,
        "analysis",
        f"/tools/trainer/runs/{run_id}/analysis",
        run_id,
        trainer_run_id=run_id,
        analysis_id=analysis_id,
    )

    # Initialize analysis status
    analysis_key = f"{run_id}_{analysis_id}"
    trainer_runs[analysis_key] = {
        "status": "running",
        "progress": {"phase": "starting", "percent": 0, "message": "Starting analysis..."},
        "generated_files": [],
        "generated_json_files": [],
        "manifest_file": None,
        "artifact_metadata": [],
        "run_id": run_id,
        "analysis_id": analysis_id
    }

    def analysis_progress_callback(phase: str, percent: int, data: Dict[str, Any]):
        trainer_runs[analysis_key]["progress"] = {
            "phase": phase,
            "percent": percent,
            **data
        }
        if "analysis_files" in data:
            trainer_runs[analysis_key]["generated_files"] = data["analysis_files"]
        if "generated_json_files" in data:
            trainer_runs[analysis_key]["generated_json_files"] = data["generated_json_files"]
        if "manifest_file" in data:
            trainer_runs[analysis_key]["manifest_file"] = data["manifest_file"]
        if "artifact_metadata" in data:
            trainer_runs[analysis_key]["artifact_metadata"] = data["artifact_metadata"]
        if phase == "done":
            trainer_runs[analysis_key]["status"] = "done"
        elif phase == "error":
            trainer_runs[analysis_key]["status"] = "failed"

        # Update global run registry
        message = data.get("message", phase)
        update_run_progress(analysis_run_id, percent / 100.0, phase, message)

    # Prepare analysis config
    trainer_folder = None
    summary_path = os.path.join(run_dir, "summary.json")
    if os.path.exists(summary_path):
        try:
            with open(summary_path, "r") as f:
                summary_data = json.load(f)
                trainer_folder = summary_data.get("config", {}).get("folder_name")
        except (json.JSONDecodeError, IOError):
            trainer_folder = None

    analysis_config = {
        "model_path": str(model_path),
        "img_path": request.img_path,
        "img_size": [224, 224],  # Default size
        "white_mask_thresh": request.white_mask_thresh,
        "trainer_folder": trainer_folder or "",
        "analysis_id": analysis_id
    }

    # Start analysis in background
    background_tasks.add_task(run_cnn_analysis, analysis_config, str(run_dir), analysis_progress_callback)

    return AnalysisResponse(analysis_id=analysis_id)


@app.get("/trainer/runs/{run_id}/analyses")
async def list_trainer_run_analyses(run_id: str) -> Dict[str, List[str]]:
    """List completed analysis folder IDs under this trainer (or standalone analysis) run."""
    run_dir = get_run_dir(run_id)
    if not os.path.isdir(run_dir):
        raise HTTPException(status_code=404, detail="Run not found")
    analysis_root = os.path.join(run_dir, "analysis")
    if not os.path.isdir(analysis_root):
        return {"analysis_ids": []}
    out: List[str] = []
    for name in os.listdir(analysis_root):
        sub = os.path.join(analysis_root, name)
        if os.path.isdir(sub) and name.startswith("analysis_"):
            out.append(name)
    out.sort()
    return {"analysis_ids": out}


@app.post("/trainer/analysis/standalone", response_model=AnalysisStandaloneResponse)
async def start_standalone_cnn_analysis(
    request: AnalysisStandaloneRequest, background_tasks: BackgroundTasks
):
    """Run CNN analysis from an uploaded .keras model and a dataset ZIP (first image as sample)."""
    try:
        from runners.cnn_analysis_runner import run_cnn_analysis
    except Exception as import_error:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis dependencies not available: {import_error}",
        ) from import_error

    if request.trainer_run_id:
        trainer_dir = get_run_dir(request.trainer_run_id)
        trained_name = _find_trained_model_file(trainer_dir) if os.path.isdir(trainer_dir) else None
        if not trained_name:
            raise HTTPException(status_code=404, detail="Trained model not found for this trainer run")
        model_file = Path(trainer_dir) / trained_name
    elif request.model_id:
        model_file = Path(MODEL_STORAGE_ROOT) / f"{request.model_id}.keras"
        if not model_file.is_file():
            raise HTTPException(status_code=404, detail="Uploaded model not found")
    else:
        raise HTTPException(status_code=422, detail="Provide model_id or trainer_run_id")

    dataset_images = os.path.join(datasets_dir, request.dataset_id, "images")
    if not os.path.isdir(dataset_images):
        raise HTTPException(status_code=404, detail="Dataset not found")

    img_path: Optional[str] = None
    for root, _, files in os.walk(dataset_images):
        for f in sorted(files):
            if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                img_path = os.path.join(root, f)
                break
        if img_path:
            break
    if not img_path:
        raise HTTPException(status_code=400, detail="No images found in the test dataset")

    run_id = generate_run_id()
    run_dir = get_run_dir(run_id)
    os.makedirs(run_dir, exist_ok=True)

    # Record what this standalone analysis was run against (lineage)
    try:
        context: Dict[str, Any] = {
            "source": "standalone",
            "dataset_id": request.dataset_id,
            "created_at": time.time(),
        }
        if request.model_id:
            context["model_id"] = request.model_id
        if request.trainer_run_id:
            context["source_trainer_run_id"] = request.trainer_run_id
        with open(os.path.join(run_dir, "analysis_context.json"), "w", encoding="utf-8") as f:
            json.dump(context, f, indent=2)
    except OSError as exc:
        logger.warning("Could not write analysis_context.json for %s: %s", run_id, exc)

    analysis_id = f"analysis_{generate_run_id()}"
    analysis_key = f"{run_id}_{analysis_id}"
    analysis_run_id = f"{run_id}_{analysis_id}"
    register_run(
        analysis_run_id,
        "analysis",
        f"/products/trainer/analysis/{run_id}/{analysis_id}",
        None,
        trainer_run_id=run_id,
        analysis_id=analysis_id,
    )

    trainer_runs[analysis_key] = {
        "status": "running",
        "progress": {"phase": "starting", "percent": 0, "message": "Starting analysis..."},
        "generated_files": [],
        "generated_json_files": [],
        "manifest_file": None,
        "artifact_metadata": [],
        "run_id": run_id,
        "analysis_id": analysis_id,
    }

    def analysis_progress_callback(phase: str, percent: int, data: Dict[str, Any]):
        trainer_runs[analysis_key]["progress"] = {
            "phase": phase,
            "percent": percent,
            **data,
        }
        if "analysis_files" in data:
            trainer_runs[analysis_key]["generated_files"] = data["analysis_files"]
        if "generated_json_files" in data:
            trainer_runs[analysis_key]["generated_json_files"] = data["generated_json_files"]
        if "manifest_file" in data:
            trainer_runs[analysis_key]["manifest_file"] = data["manifest_file"]
        if "artifact_metadata" in data:
            trainer_runs[analysis_key]["artifact_metadata"] = data["artifact_metadata"]
        if phase == "done":
            trainer_runs[analysis_key]["status"] = "done"
        elif phase == "error":
            trainer_runs[analysis_key]["status"] = "failed"

        message = data.get("message", phase)
        update_run_progress(analysis_run_id, percent / 100.0, phase, message)

    analysis_config = {
        "model_path": str(model_file.resolve()),
        "img_path": img_path,
        "img_size": [224, 224],
        "white_mask_thresh": 0.96,
        "trainer_folder": "",
        "analysis_id": analysis_id,
    }

    background_tasks.add_task(run_cnn_analysis, analysis_config, str(run_dir), analysis_progress_callback)

    return AnalysisStandaloneResponse(run_id=run_id, analysis_id=analysis_id)


@app.get("/trainer/runs/{run_id}/analysis/{analysis_id}", response_model=AnalysisStatusResponse)
async def get_analysis_status(run_id: str, analysis_id: str):
    """Get CNN analysis status"""
    # Check if run directory exists (don't rely on in-memory trainer_runs)
    run_dir = get_run_dir(run_id)
    if not os.path.exists(run_dir):
        raise HTTPException(status_code=404, detail="Analysis not found")

    analysis_key = f"{run_id}_{analysis_id}"
    if analysis_key in trainer_runs:
        run_data = trainer_runs[analysis_key]
        progress = run_data.get("progress") or {"phase": "starting", "percent": 0, "message": "Starting analysis..."}
        status = run_data.get("status", "running")
        if progress.get("phase") == "done":
            status = "done"
        elif progress.get("phase") == "error":
            status = "failed"

        return AnalysisStatusResponse(
            status=status,
            progress=progress,
            generated_files=run_data.get("generated_files", []),
            generated_json_files=run_data.get("generated_json_files"),
            manifest_file=run_data.get("manifest_file"),
            artifact_metadata=run_data.get("artifact_metadata"),
        )

    analysis_dir = os.path.join(run_dir, "analysis", analysis_id)
    delivery_path = os.path.join(analysis_dir, "delivery_summary.json")

    if os.path.isfile(delivery_path):
        try:
            with open(delivery_path, "r", encoding="utf-8") as f:
                delivery = json.load(f)
            return AnalysisStatusResponse(
                status="done",
                progress={
                    "phase": "done",
                    "percent": 100,
                    "message": "Analysis completed successfully",
                },
                generated_files=delivery.get("generated_files", []),
                generated_json_files=delivery.get("generated_json_files"),
                manifest_file=delivery.get("manifest_file"),
                artifact_metadata=delivery.get("artifacts_summary"),
            )
        except (json.JSONDecodeError, IOError):
            pass

    # Check for completion by looking for ZIP file or analysis folder
    zip_path = os.path.join(run_dir, "cnn_analysis.zip")
    status = "running"
    if os.path.exists(zip_path) or os.path.isdir(analysis_dir):
        status = "done"

    png_files: List[str] = []
    json_files: List[str] = []
    manifest_name: Optional[str] = None
    if os.path.isdir(analysis_dir):
        try:
            names = os.listdir(analysis_dir)
            png_files = sorted(f for f in names if f.endswith(".png"))
            json_files = sorted(
                f for f in names if f.endswith(".json") and f != "analysis_manifest.json"
            )
            if "analysis_manifest.json" in names:
                manifest_name = "analysis_manifest.json"
        except OSError:
            pass

    return AnalysisStatusResponse(
        status=status,
        progress={
            "phase": "done" if status == "done" else "running",
            "percent": 100 if status == "done" else 50,
            "message": "Analysis completed successfully" if status == "done" else "Analysis in progress",
        },
        generated_files=png_files or None,
        generated_json_files=json_files or None,
        manifest_file=manifest_name,
        artifact_metadata=None,
    )

@app.get("/trainer/runs/{run_id}/analysis/{analysis_id}/download")
async def download_analysis_zip(run_id: str, analysis_id: str):
    """Download the CNN analysis ZIP file"""
    run_dir = get_run_dir(run_id)
    zip_path = os.path.join(run_dir, "cnn_analysis.zip")

    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="Analysis ZIP not found")

    return FileResponse(
        zip_path,
        media_type='application/zip',
        filename=f"cnn_analysis_{run_id}_{analysis_id}.zip"
    )

@app.get("/trainer/runs/{run_id}/analysis/{analysis_id}/images/{filename}")
async def get_analysis_image(run_id: str, analysis_id: str, filename: str):
    """Serve individual analysis images"""
    run_dir = get_run_dir(run_id)
    if not os.path.exists(run_dir):
        raise HTTPException(status_code=404, detail="Analysis not found")

    analysis_dir = os.path.join(run_dir, "analysis", analysis_id)
    image_path = os.path.join(analysis_dir, filename)

    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="Image not found")

    return FileResponse(image_path)


@app.get("/trainer/runs/{run_id}/analysis/{analysis_id}/artifacts/{filename}")
async def get_analysis_artifact(run_id: str, analysis_id: str, filename: str):
    """Serve analysis JSON manifest, matrix bundles, or other artifacts (same folder as PNGs)."""
    if filename != os.path.basename(filename) or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    run_dir = get_run_dir(run_id)
    if not os.path.exists(run_dir):
        raise HTTPException(status_code=404, detail="Analysis not found")

    analysis_dir = os.path.join(run_dir, "analysis", analysis_id)
    file_path = os.path.join(analysis_dir, filename)

    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Artifact not found")

    media = "application/octet-stream"
    lower = filename.lower()
    if lower.endswith(".json"):
        media = "application/json"
    elif lower.endswith(".png"):
        media = "image/png"

    return FileResponse(file_path, media_type=media)

# Backtester endpoints
backtester_runs = {}  # In-memory storage

@app.post("/runs/backtester/start", response_model=RunResponse)
async def start_backtester_run(request: BacktesterStartRequest, background_tasks: BackgroundTasks):
    """Start a backtester run"""
    run_id = generate_run_id()

    # Register run globally
    register_run(run_id, "backtester", f"/tools/backtester/runs/{run_id}")

    # Resolve model path (canonical resolver + existence check)
    try:
        if request.model_id:
            model_path = require_existing_model_file(f"backend/models/{request.model_id}.keras")
        elif request.model_path:
            model_path = require_existing_model_file(request.model_path)
        else:
            raise HTTPException(status_code=400, detail="Either model_path or model_id must be provided")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # Resolve dataset path
    dataset_path = None
    if request.dataset_id:
        # Construct path relative to project root (where the script will run)
        dataset_images_dir = os.path.join("backend", "datasets", request.dataset_id, "images")
        # Check if it exists using absolute path
        abs_dataset_path = os.path.join(datasets_dir, request.dataset_id, "images")
        if not os.path.exists(abs_dataset_path):
            raise HTTPException(status_code=400, detail=f"Dataset {request.dataset_id} not found")
        dataset_path = dataset_images_dir
    elif request.chart_folder:
        dataset_path = request.chart_folder
    else:
        raise HTTPException(status_code=400, detail="Either dataset_id or chart_folder must be provided")

    # Create run directory
    run_dir = Path(get_run_dir(run_id))
    run_dir.mkdir(parents=True, exist_ok=True)

    # Store run info
    backtester_runs[run_id] = {
        "run_dir": run_dir,
        "config": request.dict(),
        "status": "running",
        "progress": {"phase": "starting", "percent": 0.05, "message": "Initializing backtester..."},
    }

    # Prepare config for runner
    runner_config = {
        "model_path": model_path,
        "dataset_path": dataset_path,
        "sample_size": request.sample_size,
        "confidence_threshold": request.confidence_threshold,
        "tp_pct": request.tp_pct,
        "sl_pct": request.sl_pct,
        "img_size": request.img_size,
        # Trading parameters
        "starting_capital": request.starting_capital,
        "position_size_pct": request.position_size_pct,
        "commission_pct": request.commission_pct,
        "slippage_pct": request.slippage_pct,
        # Risk management
        "max_drawdown_pct": request.max_drawdown_pct,
        "max_trades_per_day": request.max_trades_per_day,
    }

    # Start the backtester in background
    background_tasks.add_task(run_backtester, runner_config, run_dir, lambda phase, percent, data: update_backtester_progress(run_id, phase, percent, data))

    return RunResponse(run_id=run_id)

def update_backtester_progress(run_id: str, phase: str, percent: float, data: Dict[str, Any]):
    """Update backtester progress"""
    if run_id in backtester_runs:
        backtester_runs[run_id]["progress"] = {
            "phase": phase,
            "percent": percent,
            **data
        }

        # Update local status
        status = "running"
        if phase == "done":
            status = "done"
        elif phase == "error":
            status = "failed"
        backtester_runs[run_id]["status"] = status

        # Update global run registry
        update_run_progress(run_id, percent, phase, data.get("message", ""), status)

@app.get("/runs/backtester/{run_id}/status", response_model=BacktesterStatusResponse)
async def get_backtester_status(run_id: str):
    """Get backtester run status"""
    run_dir = get_run_dir(run_id)
    if not os.path.exists(run_dir):
        raise HTTPException(status_code=404, detail="Backtester run not found")

    # For completed runs, always return "done" status
    return BacktesterStatusResponse(
        status="done",
        progress=1.0,
        stage="done",
        message="Backtest completed successfully!",
        live_metrics=None
    )

@app.get("/runs/backtester/{run_id}/result", response_model=BacktesterResultResponse)
async def get_backtester_result(run_id: str):
    """Get backtester run results"""
    # Check if run directory exists (don't rely on in-memory backtester_runs)
    run_dir = get_run_dir(run_id)
    if not os.path.exists(run_dir):
        raise HTTPException(status_code=404, detail="Backtester run not found")

    # Check if results exist
    results_file = os.path.join(run_dir, "backtest_output", "backtest_results.json")
    if not os.path.exists(results_file):
        raise HTTPException(status_code=404, detail="Results not available yet")

    with open(results_file, 'r') as f:
        results = json.load(f)

    # Generate chart URLs
    charts = {}
    charts_dir = os.path.join(run_dir, "backtest_output", "charts")
    if os.path.exists(charts_dir):
        for filename in os.listdir(charts_dir):
            if filename.endswith('.png'):
                chart_name = filename[:-4]  # Remove .png extension
                charts[chart_name] = f"/runs/backtester/{run_id}/charts/{filename}"

    return BacktesterResultResponse(
        kpis=results.get("kpis", {}),
        charts=charts,
        download_zip_url=f"/runs/backtester/{run_id}/download.zip",
        csv_urls=results.get("csv_urls"),
        summary_url=results.get("summary_url")
    )

@app.get("/runs/backtester/{run_id}/charts/{filename}")
async def get_backtester_chart(run_id: str, filename: str):
    """Serve backtester chart files"""
    run_dir = get_run_dir(run_id)
    if not os.path.exists(run_dir):
        raise HTTPException(status_code=404, detail="Backtester run not found")

    chart_path = os.path.join(run_dir, "backtest_output", filename)

    if not os.path.exists(chart_path):
        raise HTTPException(status_code=404, detail="Chart not found")

    return FileResponse(chart_path)

@app.get("/runs/backtester/{run_id}/download.zip")
async def download_backtester_zip(run_id: str):
    """Download backtester results ZIP"""
    if run_id not in backtester_runs:
        raise HTTPException(status_code=404, detail="Backtester run not found")

    run_dir = backtester_runs[run_id]["run_dir"]
    output_dir = run_dir / "backtest_output"

    if not output_dir.exists():
        raise HTTPException(status_code=404, detail="Results not available")

    # Create ZIP file
    import zipfile
    zip_path = run_dir / "backtester_results.zip"

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for file_path in output_dir.rglob('*'):
            if file_path.is_file():
                zip_file.write(file_path, file_path.relative_to(output_dir))

    return FileResponse(zip_path, media_type="application/zip", filename=f"backtester_results_{run_id}.zip")

# ===== NEW BACKTESTER ENDPOINTS WITH REAL-TIME LOGGING =====

@app.post("/api/backtests/run", response_model=RunResponse)
async def start_backtest_run(request: BacktestRunRequest, background_tasks: BackgroundTasks):
    """Start a new backtest run with real-time progress tracking"""
    run_id = str(uuid.uuid4())

    payload = request.model_dump()
    try:
        if payload.get("trainer_run_id"):
            # Internal trained model: resolve the artifact inside the trainer run dir
            trainer_dir = get_run_dir(str(payload["trainer_run_id"]))
            model_file = _find_trained_model_file(trainer_dir) if os.path.isdir(trainer_dir) else None
            if not model_file:
                raise HTTPException(
                    status_code=404,
                    detail=f"No model artifact found in trainer run {payload['trainer_run_id']}",
                )
            payload["model_path"] = require_existing_model_file(os.path.join(trainer_dir, model_file))
        elif payload.get("model_id"):
            payload["model_path"] = require_existing_model_file(
                f"backend/models/{payload['model_id']}.keras"
            )
        elif payload.get("model_path"):
            payload["model_path"] = require_existing_model_file(payload["model_path"])
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # Keep model_id / trainer_run_id in the persisted run_info config for lineage
    # (the runner only reads explicit keys, so extra keys are harmless)
    if not payload.get("model_id"):
        payload.pop("model_id", None)
    if not payload.get("trainer_run_id"):
        payload.pop("trainer_run_id", None)

    # Resolve dataset_path to an absolute on-disk folder. Clients often send
    # "backend/datasets/<id>/images" which breaks when the script cwd is not the repo root.
    raw_ds = str(payload.get("dataset_path") or "").strip()
    if not raw_ds:
        raise HTTPException(status_code=422, detail="dataset_path is required")
    ds_path = Path(raw_ds)
    if not ds_path.is_absolute():
        # Accept "backend/datasets/<id>/images", "datasets/<id>/images", or bare dataset ids.
        m = _DATASET_PATH_RE.search(raw_ds.replace("\\", "/"))
        if m:
            ds_path = Path(datasets_dir) / m.group(1) / "images"
        elif (Path(datasets_dir) / raw_ds / "images").is_dir():
            ds_path = Path(datasets_dir) / raw_ds / "images"
        else:
            ds_path = (_BACKEND_ROOT.parent / raw_ds).resolve()
            if not ds_path.is_dir():
                ds_path = (Path(datasets_dir).parent.parent / raw_ds).resolve()
    if not ds_path.is_dir():
        raise HTTPException(
            status_code=404,
            detail=f"Dataset path does not exist: {raw_ds}",
        )
    payload["dataset_path"] = str(ds_path)

    print(f"Starting backtest run {run_id} with config: {payload}")

    # Start the backtester in background
    background_tasks.add_task(run_backtester_realtime, run_id, payload)

    return {"run_id": run_id}

@app.get("/api/backtests/{run_id}", response_model=BacktestStatusResponse)
async def get_backtest_status(run_id: str):
    """Get backtest run status with logs and progress"""
    from runners.new_backtester_runner import get_run_info

    info = get_run_info(run_id)
    if not info:
        raise HTTPException(status_code=404, detail="Run not found")

    # Check if results are ready
    result_ready = False
    if info["status"] == "succeeded":
        output_dir = Path(info["output_dir"])
        results_file = output_dir / "backtest_results.json"
        result_ready = results_file.exists()

    return {
        "status": info["status"],
        "progress": info["progress"],
        "message": info.get("message", ""),
        "log_tail": info.get("logs", ""),
        "result_ready": result_ready
    }

@app.get("/api/backtests/{run_id}/results", response_model=BacktestResultResponse)
async def get_backtest_results(run_id: str):
    """Get backtest results when ready"""
    from runners.new_backtester_runner import get_run_info

    info = get_run_info(run_id)
    if not info:
        raise HTTPException(status_code=404, detail="Run not found")

    if info["status"] != "succeeded":
        raise HTTPException(status_code=409, detail="Results not ready yet")

    output_dir = Path(info["output_dir"])
    results_file = output_dir / "backtest_results.json"

    if not results_file.exists():
        raise HTTPException(status_code=409, detail="Results file not found")

    # Load results
    with open(results_file, 'r') as f:
        results = json.load(f)

    # Convert chart paths to URLs
    charts = {}
    charts_dir = output_dir / "charts"
    if charts_dir.exists():
        for chart_file in sorted(charts_dir.glob("*.png")) + sorted(charts_dir.glob("*.svg")):
            chart_name = chart_file.stem
            charts[chart_name] = f"/api/backtests/{run_id}/files/charts/{chart_file.name}"

    timestamp = results.get("timestamp")
    if not timestamp and info.get("started_at"):
        try:
            timestamp = datetime.fromtimestamp(info["started_at"]).isoformat()
        except Exception:
            timestamp = None

    return {
        "kpis": results.get("kpis", {}),
        "charts": charts,
        "trades": results.get("trades", []),
        "summary": results.get("summary", {}),
        "config": results.get("config") or info.get("config"),
        "timestamp": timestamp,
        # Full timeline (incl. predicted_label 0 / NO_TRADE) for ledger & charts — must not be stripped
        "chart_events": results.get("chart_events"),
        "series": results.get("series"),
        "benchmark": results.get("benchmark"),
        "classification_metrics": results.get("classification_metrics"),
    }

@app.get("/api/backtests/{run_id}/files/{path:path}")
async def get_backtest_file(run_id: str, path: str):
    """Serve backtest files (charts, logs, etc.)"""
    from runners.new_backtester_runner import get_run_info

    info = get_run_info(run_id)
    if not info:
        raise HTTPException(status_code=404, detail="Run not found")

    output_dir = Path(info["output_dir"])
    file_path = output_dir / path

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(file_path)

# Test Data Generator endpoints
testdata_runs = {}  # In-memory storage

@app.post("/runs/testdata/start", response_model=RunResponse)
async def start_testdata_run(request: TestDataGeneratorRequest, background_tasks: BackgroundTasks):
    """Start a test data generation run"""
    run_id = generate_run_id()

    # Register run globally
    register_run(run_id, "testdata", f"/tools/backtester?runId={run_id}")  # No dedicated results page

    # Create run directory
    run_dir = Path(get_run_dir(run_id))
    run_dir.mkdir(parents=True, exist_ok=True)

    # Persist request for recovery / linkage (model_id, training_run_id, periods)
    try:
        with open(run_dir / "testdata_config.json", "w") as f:
            json.dump(request.dict(), f, indent=2)
    except OSError as exc:
        logger.warning("Could not write testdata_config.json for %s: %s", run_id, exc)

    # Store run info
    testdata_runs[run_id] = {
        "run_dir": run_dir,
        "config": request.dict(),
        "status": "running",
        "progress": {"phase": "starting", "percent": 0.05, "message": "Initializing test data generator..."},
    }
    update_testdata_progress(run_id, "starting", 0.05, {"message": "Initializing test data generator..."})

    # Start the testdata generator in background
    background_tasks.add_task(
        run_testdata_generator,
        request.dict(),
        run_dir,
        lambda phase, percent, data: update_testdata_progress(run_id, phase, percent, data),
        run_id,
    )

    return RunResponse(run_id=run_id)

def update_testdata_progress(run_id: str, phase: str, percent: float, data: Dict[str, Any]):
    """Update testdata progress (in-memory + progress.json on disk for recovery)"""
    # Never clobber a cancelled status with a late "generating" tick
    if phase not in ("cancelled", "canceled"):
        in_mem = testdata_runs.get(run_id) or {}
        if str(in_mem.get("status") or "").lower() in ("cancelled", "canceled"):
            return
        if _progress_phase_is_cancelled(run_id):
            return

    if run_id in testdata_runs:
        testdata_runs[run_id]["progress"] = {
            "phase": phase,
            "percent": percent,
            **data
        }

        # Update global run registry
        status = "running"
        if phase == "done":
            status = "succeeded"
        elif phase == "error":
            status = "failed"
        elif phase in ("cancelled", "canceled"):
            status = "cancelled"
        testdata_runs[run_id]["status"] = status

        update_run_progress(run_id, percent, phase, data.get("message", ""), status)

    # progress.json on disk → run survives restarts via the disk-merged runs discovery
    try:
        progress_payload = {
            "phase": phase,
            "percent": percent * 100 if percent <= 1.0 else percent,
            "elapsed_s": 0,
            "step": None,
            "total_steps": None,
        }
        if phase == "error" and data.get("message"):
            progress_payload["error_message"] = data["message"]
        with open(os.path.join(get_run_dir(run_id), "progress.json"), "w") as f:
            json.dump(progress_payload, f)
    except OSError:
        pass

def _maybe_recover_testdata_run(run_id: str, run_dir: Path) -> Optional[Dict[str, Any]]:
    """If a run left PNGs in output/ but never wrote results (crash/timeout/restart), finalize now."""
    results_file = run_dir / "testdata_results.json"
    if results_file.is_file():
        try:
            with open(results_file, "r") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else None
        except (json.JSONDecodeError, OSError):
            return None
    output_dir = run_dir / "output"
    if not output_dir.is_dir():
        return None
    try:
        png_count = sum(1 for _ in output_dir.glob("*.png"))
    except OSError:
        png_count = 0
    if png_count <= 0:
        return None
    # Only auto-finalize when the in-memory job is gone (process finished / server restarted)
    # or when progress already looks terminal/stale.
    in_mem = testdata_runs.get(run_id)
    if in_mem and in_mem.get("status") == "running":
        return None
    cfg = _load_testdata_config(run_dir)
    if not cfg:
        cfg = {"dataset_name": f"testset_{run_id[-8:]}"}
    return _finalize_testdata_from_output(
        cfg,
        run_dir,
        lambda phase, percent, data: update_testdata_progress(run_id, phase, percent, data),
    )


@app.post("/runs/testdata/{run_id}/cancel")
async def cancel_testdata_run(run_id: str):
    """Cancel a running testdata generator job"""
    return cancel_run_process(run_id, "Test data generation cancelled by user")


@app.get("/runs/testdata/{run_id}/status", response_model=TestDataGeneratorStatusResponse)
async def get_testdata_status(run_id: str):
    """Get testdata run status (in-memory, with disk fallback after restarts)"""
    run_dir = Path(get_run_dir(run_id))
    if run_id in testdata_runs:
        run_dir = Path(testdata_runs[run_id]["run_dir"])

    # Recover orphaned output folders so the UI can show Download / Use as test set.
    recovered = _maybe_recover_testdata_run(run_id, run_dir)
    if recovered and run_id in testdata_runs:
        testdata_runs[run_id]["status"] = "succeeded"

    if run_id in testdata_runs:
        run_data = testdata_runs[run_id]
        progress = run_data["progress"]
        return TestDataGeneratorStatusResponse(
            status=run_data["status"],
            progress=progress["percent"],
            stage=progress["phase"],
            message=progress.get("message", ""),
            live_metrics=progress.get("live_metrics")
        )

    # Disk fallback: progress.json written by update_testdata_progress
    progress_file = run_dir / "progress.json"
    if (run_dir / "testdata_results.json").is_file():
        results = _read_json_dict(str(run_dir / "testdata_results.json")) or {}
        total = (results.get("summary") or {}).get("total_images")
        return TestDataGeneratorStatusResponse(
            status="succeeded",
            progress=1.0,
            stage="done",
            message=f"Generated {total} labeled images successfully!" if total else "Completed",
        )
    if not progress_file.is_file():
        raise HTTPException(status_code=404, detail="Testdata run not found")
    try:
        with open(progress_file, "r") as f:
            pr = json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=500, detail=f"Could not read run progress: {exc}") from exc
    status, stage, message = _progress_phase_to_run_fields(pr.get("phase"), pr.get("error_message"))
    pct = float(pr.get("percent") or 0.0)
    return TestDataGeneratorStatusResponse(
        status=status,
        progress=pct / 100.0 if pct > 1.0 else pct,
        stage=stage,
        message=message,
    )

@app.get("/runs/testdata/{run_id}/result", response_model=TestDataGeneratorResultResponse)
async def get_testdata_result(run_id: str):
    """Get testdata run results"""
    run_dir = Path(get_run_dir(run_id))
    if run_id in testdata_runs:
        run_dir = Path(testdata_runs[run_id]["run_dir"])

    results = _maybe_recover_testdata_run(run_id, run_dir)
    results_file = run_dir / "testdata_results.json"
    if not results and results_file.exists():
        with open(results_file, 'r') as f:
            results = json.load(f)
    if not results:
        raise HTTPException(status_code=404, detail="Results not available")

    return TestDataGeneratorResultResponse(
        dataset_id=results["dataset_id"],
        download_zip_url=f"/runs/testdata/{run_id}/download.zip",
        dataset_name=results.get("dataset_name"),
        summary=results.get("summary", {}),
    )

@app.get("/runs/testdata/{run_id}/config")
async def get_testdata_config(run_id: str) -> Dict[str, Any]:
    """Saved request for this test dataset run (linkage / history UI)."""
    path = Path(get_run_dir(run_id)) / "testdata_config.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="No saved configuration for this run")
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=500, detail=f"Could not read configuration: {exc}") from exc

@app.get("/runs/testdata/{run_id}/download.zip")
async def download_testdata_zip(run_id: str):
    """Download testdata results ZIP (prebuilt on finalize; rebuilt on demand if missing)."""
    run_dir = Path(get_run_dir(run_id))
    if run_id in testdata_runs:
        run_dir = Path(testdata_runs[run_id]["run_dir"])
    # Ensure orphaned runs still get a registered dataset + zip.
    _maybe_recover_testdata_run(run_id, run_dir)
    output_dir = run_dir / "output"
    zip_path = run_dir / "testdata.zip"

    if not zip_path.is_file():
        if not output_dir.is_dir():
            raise HTTPException(status_code=404, detail="Results not available")
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for file_path in output_dir.rglob('*'):
                if file_path.is_file():
                    zip_file.write(file_path, file_path.relative_to(output_dir))

    return FileResponse(zip_path, media_type="application/zip", filename=f"testdata_{run_id}.zip")

# Global run management endpoints
@app.get("/runs/active")
async def get_active_runs_endpoint():
    """Active (running/queued) runs, merged from disk + memory."""
    rows = discover_runs_merged_from_disk_and_memory(400)
    active_runs = [r for r in rows if r.status in ("running", "queued")]
    return {"runs": [r.model_dump() for r in active_runs]}

@app.get("/runs/{run_id}")
async def get_run_endpoint(run_id: str):
    """Get details for a specific run"""
    run = get_run(run_id) or try_resolve_run_from_disk(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run.model_dump()

@app.get("/runs")
async def get_all_runs_endpoint(limit: int = 200):
    """Recent runs: in-memory registry merged with disk (manifest, progress, backtests). Memory wins on conflicts."""
    rows = discover_runs_merged_from_disk_and_memory(limit)
    return {"runs": [r.model_dump() for r in rows]}


# ===== Review overview (best-effort metadata aggregation, no DB) =====

def _read_json_dict(path: str) -> Optional[Dict[str, Any]]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, OSError):
        return None


# ---------------------------------------------------------------------------
# Library labels — user-editable organization overlay for models & datasets.
#
# We keep this as ONE small JSON registry (backend/library_labels.json) keyed by
# "model:<id>" / "dataset:<id>" instead of mutating each artifact. That way the
# existing (good) discovery system is untouched — labels are overlaid on top of
# the machine-derived metadata whenever we list models/datasets/overview.
# ---------------------------------------------------------------------------
_LIBRARY_LABELS_PATH = os.path.join(os.path.dirname(__file__), "..", "library_labels.json")
_LIBRARY_LABEL_FIELDS = ("display_name", "tags", "favorite", "archived", "notes")


def _load_library_labels() -> Dict[str, Dict[str, Any]]:
    data = _read_json_dict(_LIBRARY_LABELS_PATH) or {}
    return data if isinstance(data, dict) else {}


def _save_library_labels(data: Dict[str, Dict[str, Any]]) -> None:
    tmp = f"{_LIBRARY_LABELS_PATH}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, _LIBRARY_LABELS_PATH)


def _label_key(kind: str, entity_id: str) -> str:
    return f"{kind}:{entity_id}"


def _labels_for(kind: str, entity_id: str, labels: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Return the user label overlay for one entity (empty dict when none)."""
    store = labels if labels is not None else _load_library_labels()
    entry = store.get(_label_key(kind, entity_id)) or {}
    out: Dict[str, Any] = {
        "display_name": entry.get("display_name"),
        "tags": entry.get("tags") if isinstance(entry.get("tags"), list) else [],
        "favorite": bool(entry.get("favorite")),
        "archived": bool(entry.get("archived")),
        "notes": entry.get("notes"),
    }
    return out


def _apply_label_overlay(item: Dict[str, Any], kind: str, entity_id: str, labels: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """Merge user labels into a listing item. `display_name` (when set) wins for `name`."""
    overlay = _labels_for(kind, entity_id, labels)
    item["display_name"] = overlay["display_name"]
    item["tags"] = overlay["tags"]
    item["favorite"] = overlay["favorite"]
    item["archived"] = overlay["archived"]
    item["notes"] = overlay["notes"]
    if overlay["display_name"]:
        # Keep the machine name available, but prefer the user's chosen label.
        item["auto_name"] = item.get("name")
        item["name"] = overlay["display_name"]
    return item


def _update_library_label(kind: str, entity_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
    """Apply a partial update to one entity's label entry and persist. Returns the new overlay."""
    if kind not in ("model", "dataset"):
        raise ValueError("kind must be 'model' or 'dataset'")
    store = _load_library_labels()
    key = _label_key(kind, entity_id)
    entry = dict(store.get(key) or {})
    if "display_name" in patch:
        dn = patch["display_name"]
        entry["display_name"] = (str(dn).strip() or None) if dn is not None else None
    if "notes" in patch:
        nt = patch["notes"]
        entry["notes"] = (str(nt) if nt is not None and str(nt).strip() else None)
    if "favorite" in patch and patch["favorite"] is not None:
        entry["favorite"] = bool(patch["favorite"])
    if "archived" in patch and patch["archived"] is not None:
        entry["archived"] = bool(patch["archived"])
    if "tags" in patch and patch["tags"] is not None:
        raw = patch["tags"]
        if isinstance(raw, list):
            seen: List[str] = []
            for t in raw:
                s = str(t).strip()
                if s and s.lower() not in {x.lower() for x in seen}:
                    seen.append(s)
            entry["tags"] = seen[:24]
    # Drop empties so the file stays tidy.
    entry = {k: v for k, v in entry.items() if v not in (None, [], "")}
    if entry:
        store[key] = entry
    else:
        store.pop(key, None)
    _save_library_labels(store)
    return _labels_for(kind, entity_id, store)


_DATASET_PATH_RE = re.compile(r"datasets[/\\]([A-Za-z0-9_.-]+)[/\\]")
_RUNS_MODEL_PATH_RE = re.compile(r"runs[/\\]([A-Za-z0-9_.-]+)[/\\][^/\\]+\.(?:keras|h5)$")


def _parse_backtest_links(cfg: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """Extract recorded references from a backtest config (paths only — nothing guessed)."""
    model_path = str(cfg.get("model_path") or "")
    dataset_path = str(cfg.get("dataset_path") or "")
    out: Dict[str, Optional[str]] = {
        "model_id": cfg.get("model_id"),
        "trainer_run_id": cfg.get("trainer_run_id"),
        "dataset_id": None,
    }
    m = _RUNS_MODEL_PATH_RE.search(model_path)
    if m and not out["trainer_run_id"]:
        out["trainer_run_id"] = m.group(1)
    elif not out["model_id"]:
        # Uploaded models follow the model_<ts>_<hex>.keras naming convention
        base = os.path.basename(model_path)
        if base.startswith("model_") and base.endswith(".keras"):
            out["model_id"] = base[: -len(".keras")]
    dm = _DATASET_PATH_RE.search(dataset_path)
    if dm:
        out["dataset_id"] = dm.group(1)
    return out


def _find_trained_model_file(run_dir: str) -> Optional[str]:
    """First model artifact (.keras/.h5) directly inside a trainer run dir, or None."""
    try:
        for fn in sorted(os.listdir(run_dir)):
            if fn.endswith((".keras", ".h5")) and os.path.isfile(os.path.join(run_dir, fn)):
                return fn
    except OSError:
        pass
    return None


def _collect_internal_models() -> List[Dict[str, Any]]:
    """All models known to this workspace: trained (trainer run dirs) + uploaded (.keras storage).

    Trained models keep their full provenance (training run, dataset, generator config);
    uploaded models only carry what their sidecar recorded. Nothing is guessed.
    """
    models: List[Dict[str, Any]] = []

    # Trained models: any trainer run dir containing a model artifact
    try:
        run_names = os.listdir(runs_dir)
    except OSError:
        run_names = []
    for name in run_names:
        if name == "backtests":
            continue
        run_dir = os.path.join(runs_dir, name)
        if not os.path.isdir(run_dir):
            continue
        model_file = _find_trained_model_file(run_dir)
        if not model_file:
            continue
        summary = _read_json_dict(os.path.join(run_dir, "summary.json")) or {}
        meta = _read_json_dict(os.path.join(run_dir, "model_metadata.json")) or {}
        manifest = _read_json_dict(os.path.join(run_dir, "run_manifest.json")) or {}
        if not (summary or meta or manifest.get("tool") == "trainer"):
            continue  # model-looking file in a non-trainer dir; skip
        tconf = summary.get("config") if isinstance(summary.get("config"), dict) else {}
        dataset_id = (tconf or {}).get("dataset_id") or meta.get("dataset_id")
        generator_run_id = meta.get("generator_run_id")
        if not generator_run_id and dataset_id:
            generator_run_id = _resolve_generator_run_id_for_dataset(str(dataset_id))
        derived: Dict[str, Any] = {}
        if generator_run_id:
            gen_cfg = _load_generator_config_from_disk(str(generator_run_id))
            if gen_cfg:
                derived = _derive_model_fields_from_generator_config(gen_cfg)
        final = summary.get("final_metrics") if isinstance(summary.get("final_metrics"), dict) else {}
        metrics = {
            k: (final or {}).get(k)
            for k in ("accuracy", "val_accuracy", "loss", "val_loss")
            if (final or {}).get(k) is not None
        }
        if summary.get("epochs_trained") is not None:
            metrics["epochs_trained"] = summary.get("epochs_trained")
        try:
            created_at: Optional[float] = os.path.getmtime(os.path.join(run_dir, model_file))
        except OSError:
            created_at = manifest.get("created_at")
        models.append(
            {
                "model_id": name,
                "kind": "trained",
                "name": model_file,
                "model_path": f"backend/runs/{name}/{model_file}",
                "training_run_id": name,
                "dataset_id": str(dataset_id) if dataset_id else None,
                "generator_run_id": generator_run_id,
                "symbols": meta.get("symbols") or derived.get("symbols"),
                "timeframe": meta.get("timeframe") or derived.get("timeframe"),
                "timespan_unit": meta.get("timespanUnit") or derived.get("timespanUnit"),
                "timespan_count": meta.get("timespanCount") or derived.get("timespanCount"),
                "horizon_bars": meta.get("horizonBars") or derived.get("horizonBars"),
                "take_profit_fraction": meta.get("takeProfitFraction") or derived.get("takeProfitFraction"),
                "stop_loss_fraction": meta.get("stopLossFraction") or derived.get("stopLossFraction"),
                "image_dimension": meta.get("imageDimension") or derived.get("imageDimension"),
                "metrics": metrics or None,
                "created_at": created_at,
                "metadata_available": bool(
                    (meta.get("symbols") or derived.get("symbols")) is not None
                    or meta.get("generator_config")
                ),
                "download_url": f"/trainer/runs/{name}/download/model",
            }
        )

    # Uploaded models: .keras files in the upload storage root (+ optional sidecars)
    try:
        storage_root = Path(MODEL_STORAGE_ROOT)
        if storage_root.is_dir():
            for f in sorted(storage_root.glob("*.keras")):
                mid = f.stem
                sidecar = _read_json_dict(str(storage_root / f"{mid}.metadata.json")) or {}
                try:
                    mtime: Optional[float] = f.stat().st_mtime
                except OSError:
                    mtime = None
                models.append(
                    {
                        "model_id": mid,
                        "kind": "uploaded",
                        "name": sidecar.get("original_filename") or f.name,
                        "model_path": None,
                        "training_run_id": sidecar.get("training_run_id"),
                        "dataset_id": sidecar.get("dataset_id"),
                        "generator_run_id": sidecar.get("generator_run_id"),
                        "symbols": sidecar.get("symbols"),
                        "timeframe": sidecar.get("timeframe"),
                        "timespan_unit": sidecar.get("timespanUnit"),
                        "timespan_count": sidecar.get("timespanCount"),
                        "horizon_bars": sidecar.get("horizonBars"),
                        "take_profit_fraction": sidecar.get("takeProfitFraction"),
                        "stop_loss_fraction": sidecar.get("stopLossFraction"),
                        "image_dimension": sidecar.get("imageDimension"),
                        "metrics": None,
                        "created_at": sidecar.get("uploaded_at") or mtime,
                        "metadata_available": bool(
                            sidecar.get("training_run_id") or sidecar.get("generator_run_id")
                        ),
                        "download_url": None,
                    }
                )
    except OSError as exc:
        logger.warning("Internal models: could not scan model storage root: %s", exc)

    def _created_sort_key(model: Dict[str, Any]) -> float:
        v = model.get("created_at")
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            try:
                return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
            except ValueError:
                return 0.0
        return 0.0

    models.sort(key=_created_sort_key, reverse=True)
    labels = _load_library_labels()
    for m in models:
        _apply_label_overlay(m, "model", str(m.get("model_id")), labels)
    # Favorites first, then newest.
    models.sort(key=lambda m: (1 if m.get("favorite") else 0, _created_sort_key(m)), reverse=True)
    return models


@app.get("/api/models")
async def list_internal_models() -> Dict[str, Any]:
    """Unified model registry: trained models (selectable without download/reupload) + uploads."""
    return {"models": _collect_internal_models()}


class LibraryLabelPatch(BaseModel):
    display_name: Optional[str] = None
    tags: Optional[List[str]] = None
    favorite: Optional[bool] = None
    archived: Optional[bool] = None
    notes: Optional[str] = None


@app.patch("/api/models/{model_id}/label")
async def update_model_label(model_id: str, patch: LibraryLabelPatch) -> Dict[str, Any]:
    """Rename / tag / favorite / archive a model (overlay only — never touches artifacts)."""
    overlay = _update_library_label("model", model_id, patch.dict(exclude_unset=True))
    return {"model_id": model_id, **overlay}


@app.patch("/api/datasets/{dataset_id}/label")
async def update_dataset_label(dataset_id: str, patch: LibraryLabelPatch) -> Dict[str, Any]:
    """Rename / tag / favorite / archive a dataset (overlay only — never touches artifacts)."""
    overlay = _update_library_label("dataset", dataset_id, patch.dict(exclude_unset=True))
    return {"dataset_id": dataset_id, **overlay}


def _testdata_dataset_index() -> Dict[str, Dict[str, Any]]:
    """Map dataset_id -> test-run metadata (customer-given name, periods) from testdata runs."""
    index: Dict[str, Dict[str, Any]] = {}
    try:
        entries = os.listdir(runs_dir)
    except OSError:
        return index
    for name in entries:
        res = _read_json_dict(os.path.join(runs_dir, name, "testdata_results.json"))
        if not res:
            continue
        did = res.get("dataset_id")
        if did:
            index[str(did)] = {
                "name": res.get("dataset_name"),
                "symbols": res.get("symbols"),
                "test_period_start": res.get("test_period_start"),
                "test_period_end": res.get("test_period_end"),
                "model_id": res.get("model_id"),
                "training_run_id": res.get("training_run_id"),
            }
    return index


@app.get("/api/datasets")
async def list_datasets() -> Dict[str, Any]:
    """List extracted datasets under datasets/ with friendly names for pickers.

    Each entry can be used directly by analysis/backtest (images live at
    datasets/<id>/images). Test datasets surface the customer-given name; generated
    training datasets surface symbols + size. Purely best-effort from on-disk files.
    """
    test_index = _testdata_dataset_index()
    labels = _load_library_labels()
    out: List[Dict[str, Any]] = []
    try:
        entries = os.listdir(datasets_dir)
    except OSError:
        return {"datasets": []}
    for did in entries:
        ddir = os.path.join(datasets_dir, did)
        images_dir = os.path.join(ddir, "images")
        if not os.path.isdir(images_dir):
            continue
        summary = _read_json_dict(os.path.join(ddir, "summary.json")) or {}
        total = summary.get("total_images")
        if total is None:
            try:
                total = sum(
                    1 for f in os.listdir(images_dir) if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))
                )
            except OSError:
                total = 0
        created = summary.get("created_at")
        if created is None:
            try:
                created = os.path.getmtime(os.path.join(ddir, "summary.json"))
            except OSError:
                created = None
        meta = _dataset_meta_from_disk(did)
        symbols = summary.get("symbols") or meta.get("symbols")
        gen_run = summary.get("generator_run_id")
        test_info = test_index.get(did)
        summary_source = str(summary.get("source") or "").lower()
        summary_kind = str(summary.get("kind") or "").lower()

        period_start = summary.get("period_start") or meta.get("period_start")
        period_end = summary.get("period_end") or meta.get("period_end")

        # Prefer metadata written ON the dataset (durable, self-describing); fall back to
        # the run-scan index for older datasets that predate self-describing summaries.
        if summary_kind == "test" or summary_source == "testdata" or test_info:
            kind = "test"
            symbols = symbols or (test_info or {}).get("symbols")
            name = (
                summary.get("dataset_name")
                or (test_info or {}).get("name")
                or f"Test set · {symbols or did[-8:]}"
            )
            period_start = period_start or (test_info or {}).get("test_period_start")
            period_end = period_end or (test_info or {}).get("test_period_end")
        elif gen_run or summary_source == "generator" or summary_kind == "training":
            kind = "training"
            bits = [b for b in (symbols, f"{total} imgs" if total else None) if b]
            name = summary.get("dataset_name") or (" · ".join(bits) if bits else did)
        else:
            kind = "unknown"
            name = summary.get("dataset_name") or (f"{symbols} · {total} imgs" if symbols else did)

        item = {
            "dataset_id": did,
            "name": name,
            "kind": kind,
            "total_images": total,
            "symbols": symbols,
            "timeframe": summary.get("timeframe"),
            "period_start": period_start,
            "period_end": period_end,
            "generator_run_id": gen_run,
            "created_at": created,
            "example_filenames": summary.get("example_filenames") or [],
        }
        out.append(_apply_label_overlay(item, "dataset", did, labels))
    # Favorites float to the top, then newest first.
    out.sort(key=lambda d: (1 if d.get("favorite") else 0, d.get("created_at") or 0), reverse=True)
    return {"datasets": out}


@app.get("/api/review/overview")
async def get_review_overview() -> Dict[str, Any]:
    """Aggregate runs, models, datasets and their best-effort lineage from on-disk metadata.

    Only relationships explicitly recorded somewhere (configs, manifests, sidecars,
    recorded paths) are surfaced — missing links stay null for the UI to label.
    """
    runs = discover_runs_merged_from_disk_and_memory(500)
    runs_by_id: Dict[str, GlobalRun] = {r.id: r for r in runs}

    # Backtests: read directly from the runner's storage root (authoritative location)
    backtest_infos: Dict[str, Dict[str, Any]] = {}
    try:
        from runners.new_backtester_runner import get_backtests_root

        bt_root = get_backtests_root()
        if bt_root.is_dir():
            for child in sorted(bt_root.iterdir()):
                if child.is_dir():
                    info = _read_json_dict(str(child / "run_info.json"))
                    if info:
                        backtest_infos[child.name] = info
    except Exception as exc:  # noqa: BLE001 — overview must degrade gracefully
        logger.warning("Review overview: could not scan backtests root: %s", exc)

    for rid, info in backtest_infos.items():
        if rid in runs_by_id:
            continue
        st = str(info.get("status", "running"))
        status = st if st in ("succeeded", "failed", "queued") else "running"
        started = float(info.get("started_at", 0) or 0)
        updated = float(info.get("updated_at", started) or started)
        runs_by_id[rid] = GlobalRun(
            id=rid,
            tool="backtester",
            status=status,
            progress=float(info.get("progress", 0.0) or 0.0),
            stage=st,
            message=str(info.get("message", "") or ""),
            created_at=started or updated,
            updated_at=updated or started,
            route=f"/tools/backtester/runs/{rid}",
        )

    run_rows: List[Dict[str, Any]] = []
    models: List[Dict[str, Any]] = []
    datasets_by_key: Dict[str, Dict[str, Any]] = {}
    testdata_rows: List[Dict[str, Any]] = []
    analysis_rows: List[Dict[str, Any]] = []
    backtest_rows: List[Dict[str, Any]] = []
    generator_runs: Dict[str, Dict[str, Any]] = {}
    trainer_dataset_usage: Dict[str, List[str]] = {}

    # Lazily-built index of generator outputs, used to backtrace datasets/models that
    # predate explicit generator linkage. Built at most once per request, and only when
    # something actually needs it (write-back makes future requests hit the fast path).
    _gen_index_holder: Dict[str, Dict[str, set]] = {}

    def _generator_index() -> Dict[str, set]:
        if "idx" not in _gen_index_holder:
            _gen_index_holder["idx"] = _build_generator_output_index()
        return _gen_index_holder["idx"]

    def _resolve_or_match_generator(dataset_id: Optional[str]) -> Optional[str]:
        """Generator run for a dataset: recorded link first, else match by chart filenames."""
        if not dataset_id:
            return None
        gid = _resolve_generator_run_id_for_dataset(str(dataset_id))
        if gid:
            return gid
        gid = _match_generator_run_for_dataset(str(dataset_id), _generator_index())
        if gid:
            _persist_dataset_generator_link(str(dataset_id), gid)
        return gid

    for run in sorted(runs_by_id.values(), key=lambda r: r.updated_at, reverse=True):
        row = run.model_dump()
        links: Dict[str, Any] = {}
        details: Dict[str, Any] = {}
        run_dir = get_run_dir(run.id)

        if run.tool == "training-chart-generator":
            cfg = _read_json_dict(os.path.join(run_dir, "generator_config.json")) or {}
            stats = _read_json_dict(os.path.join(run_dir, "artifacts", "dataset_stats.json")) or {}
            has_zip = os.path.isfile(os.path.join(run_dir, f"training-dataset-{run.id}.zip"))
            details = {
                k: cfg.get(k)
                for k in (
                    "symbols",
                    "timeframe",
                    "timespanUnit",
                    "timespanCount",
                    "chartsPerLabel",
                    "horizonBars",
                    "takeProfitFraction",
                    "stopLossFraction",
                    "imageDimension",
                    "volumeMode",
                    "trainingStartIso",
                    "referenceEndIso",
                )
                if cfg.get(k) is not None
            }
            if stats.get("total_charts") is not None:
                details["total_charts"] = stats.get("total_charts")
            generator_runs[run.id] = {"config": cfg, "stats": stats, "has_zip": has_zip, "run": run}
            if has_zip or cfg:
                key = f"generated:{run.id}"
                datasets_by_key[key] = {
                    "id": key,
                    "dataset_id": None,
                    "name": f"training-dataset-{run.id}.zip" if has_zip else f"Generator run {run.id}",
                    "kind": "training",
                    "source": "generated",
                    "created_at": run.created_at,
                    "generator_run_id": run.id,
                    "symbols": cfg.get("symbols"),
                    "timeframe": cfg.get("timeframe"),
                    "period_start": cfg.get("trainingStartIso") if cfg.get("volumeMode") == "by_period" else None,
                    "period_end": cfg.get("referenceEndIso"),
                    "timespan_unit": cfg.get("timespanUnit"),
                    "timespan_count": cfg.get("timespanCount"),
                    "take_profit_fraction": cfg.get("takeProfitFraction"),
                    "stop_loss_fraction": cfg.get("stopLossFraction"),
                    "horizon_bars": cfg.get("horizonBars"),
                    "total_images": stats.get("total_charts"),
                    "label_distribution": None,
                    "download_url": f"/api/training-chart-generator/download/{run.id}" if has_zip else None,
                }

        elif run.tool == "trainer":
            meta = _read_json_dict(os.path.join(run_dir, "model_metadata.json")) or {}
            summary = _read_json_dict(os.path.join(run_dir, "summary.json")) or {}
            model_file = None
            try:
                for fn in sorted(os.listdir(run_dir)):
                    if fn.endswith((".keras", ".h5")):
                        model_file = fn
                        break
            except OSError:
                pass
            tconf = summary.get("config") if isinstance(summary.get("config"), dict) else {}
            dataset_id = (tconf or {}).get("dataset_id") or meta.get("dataset_id")
            generator_run_id = meta.get("generator_run_id")
            if not generator_run_id and dataset_id:
                # Older metadata files may predate the link; recover it from the dataset
                # summary or, failing that, by matching the dataset's charts to a generator run.
                generator_run_id = _resolve_or_match_generator(str(dataset_id))
            # Read-time enrichment: mirror generator settings when the metadata file
            # lacks them but the linked generator config is on disk (recorded, not guessed)
            gen_fields: Dict[str, Any] = {
                k: meta.get(k)
                for k in (
                    "symbols",
                    "timeframe",
                    "takeProfitFraction",
                    "stopLossFraction",
                    "horizonBars",
                    "imageDimension",
                    "training_period_start",
                    "training_period_end",
                )
            }
            if generator_run_id and gen_fields.get("symbols") is None:
                gen_cfg = _load_generator_config_from_disk(str(generator_run_id))
                if gen_cfg:
                    derived = _derive_model_fields_from_generator_config(gen_cfg)
                    for k in gen_fields:
                        if gen_fields[k] is None and derived.get(k) is not None:
                            gen_fields[k] = derived[k]
            # Last-resort recovery: parse symbols + covered period from the dataset's
            # chart filenames when no generator config is linked (older runs).
            if gen_fields.get("symbols") is None and dataset_id:
                ds_meta = _dataset_meta_from_disk(str(dataset_id))
                if ds_meta.get("symbols"):
                    gen_fields["symbols"] = ds_meta["symbols"]
                if gen_fields.get("training_period_start") is None and ds_meta.get("period_start"):
                    gen_fields["training_period_start"] = ds_meta["period_start"]
                if gen_fields.get("training_period_end") is None and ds_meta.get("period_end"):
                    gen_fields["training_period_end"] = ds_meta["period_end"]
            if dataset_id:
                links["dataset_id"] = str(dataset_id)
                trainer_dataset_usage.setdefault(str(dataset_id), []).append(run.id)
            if generator_run_id:
                links["generator_run_id"] = generator_run_id
            final = summary.get("final_metrics") if isinstance(summary.get("final_metrics"), dict) else {}
            metrics = {
                k: (final or {}).get(k)
                for k in ("accuracy", "val_accuracy", "loss", "val_loss", "val_label_1_recall")
                if (final or {}).get(k) is not None
            }
            if summary.get("epochs_trained") is not None:
                metrics["epochs_trained"] = summary.get("epochs_trained")
            if model_file or summary:
                models.append(
                    {
                        "id": run.id,
                        "name": model_file or summary.get("model_name") or meta.get("model_name"),
                        "source": "trained",
                        "created_at": run.created_at,
                        "training_run_id": run.id,
                        "dataset_id": str(dataset_id) if dataset_id else None,
                        "generator_run_id": generator_run_id,
                        "symbols": gen_fields.get("symbols"),
                        "timeframe": gen_fields.get("timeframe"),
                        "take_profit_fraction": gen_fields.get("takeProfitFraction"),
                        "stop_loss_fraction": gen_fields.get("stopLossFraction"),
                        "horizon_bars": gen_fields.get("horizonBars"),
                        "image_dimension": gen_fields.get("imageDimension"),
                        "training_period_start": gen_fields.get("training_period_start"),
                        "training_period_end": gen_fields.get("training_period_end"),
                        "metrics": metrics or None,
                        "download_url": f"/trainer/runs/{run.id}/download/model" if model_file else None,
                        "metadata_available": bool(meta) or gen_fields.get("symbols") is not None,
                        "status": run.status,
                    }
                )
            details = {
                k: v
                for k, v in {
                    "model_name": summary.get("model_name"),
                    "dataset_id": str(dataset_id) if dataset_id else None,
                    "epochs_trained": summary.get("epochs_trained"),
                }.items()
                if v is not None
            }

        elif run.tool == "testdata":
            cfg = _read_json_dict(os.path.join(run_dir, "testdata_config.json")) or {}
            res = _read_json_dict(os.path.join(run_dir, "testdata_results.json")) or {}
            for src_key, dst_key in (
                ("model_id", "model_id"),
                ("training_run_id", "trainer_run_id"),
                ("generator_run_id", "generator_run_id"),
            ):
                v = cfg.get(src_key) or res.get(src_key)
                if v:
                    links[dst_key] = v
            ds_id = res.get("dataset_id")
            if ds_id:
                links["dataset_id"] = str(ds_id)
            details = {
                k: cfg.get(k)
                for k in ("symbols", "timeframe", "dataset_name", "test_period_start", "test_period_end")
                if cfg.get(k) is not None
            }
            testdata_rows.append({"run": run, "config": cfg, "results": res})
            if ds_id:
                ds_summary = res.get("summary") if isinstance(res.get("summary"), dict) else {}
                datasets_by_key[str(ds_id)] = {
                    "id": str(ds_id),
                    "dataset_id": str(ds_id),
                    "name": cfg.get("dataset_name") or str(ds_id),
                    "kind": "test",
                    "source": "generated",
                    "created_at": run.created_at,
                    "testdata_run_id": run.id,
                    "model_id": cfg.get("model_id"),
                    "training_run_id": cfg.get("training_run_id"),
                    "generator_run_id": cfg.get("generator_run_id"),
                    "symbols": cfg.get("symbols"),
                    "timeframe": cfg.get("timeframe"),
                    "period_start": cfg.get("test_period_start") or (ds_summary or {}).get("start_date"),
                    "period_end": cfg.get("test_period_end") or (ds_summary or {}).get("end_date"),
                    "take_profit_fraction": cfg.get("tp_frac"),
                    "stop_loss_fraction": cfg.get("sl_frac"),
                    "horizon_bars": cfg.get("future_horizon_bars"),
                    "total_images": (ds_summary or {}).get("total_images"),
                    "label_distribution": (ds_summary or {}).get("label_distribution"),
                    "download_url": f"/runs/testdata/{run.id}/download.zip",
                }

        elif run.tool == "backtester":
            info = backtest_infos.get(run.id) or {}
            cfg = info.get("config") if isinstance(info.get("config"), dict) else {}
            if cfg:
                parsed = _parse_backtest_links(cfg)
                for k in ("model_id", "trainer_run_id", "dataset_id"):
                    if parsed.get(k):
                        links[k] = parsed[k]
                details = {
                    k: cfg.get(k)
                    for k in ("confidence_threshold", "tp_pct", "sl_pct", "sample_size")
                    if cfg.get(k) is not None
                }
            backtest_rows.append({"run": run, "links": dict(links)})

        elif run.tool == "analysis":
            if run.trainer_run_id:
                links["trainer_run_id"] = run.trainer_run_id
            if run.analysis_id:
                links["analysis_id"] = run.analysis_id
            ctx = (
                _read_json_dict(os.path.join(get_run_dir(str(run.trainer_run_id)), "analysis_context.json"))
                if run.trainer_run_id
                else None
            )
            if ctx:
                if ctx.get("model_id"):
                    links["model_id"] = ctx["model_id"]
                if ctx.get("dataset_id"):
                    links["dataset_id"] = ctx["dataset_id"]
                details["standalone"] = True
            analysis_rows.append({"run": run, "links": dict(links)})

        row["links"] = links
        row["details"] = details
        run_rows.append(row)

    # Uploaded models (.keras under the upload storage root + optional metadata sidecars)
    try:
        storage_root = Path(MODEL_STORAGE_ROOT)
        if storage_root.is_dir():
            for f in sorted(storage_root.glob("*.keras")):
                mid = f.stem
                sidecar = _read_json_dict(str(storage_root / f"{mid}.metadata.json")) or {}
                try:
                    mtime: Optional[float] = f.stat().st_mtime
                except OSError:
                    mtime = None
                has_provenance = bool(sidecar.get("training_run_id") or sidecar.get("generator_run_id"))
                models.append(
                    {
                        "id": mid,
                        "name": sidecar.get("original_filename") or f.name,
                        "source": "uploaded",
                        "created_at": mtime,
                        "uploaded_at": sidecar.get("uploaded_at"),
                        "training_run_id": sidecar.get("training_run_id"),
                        "dataset_id": sidecar.get("dataset_id"),
                        "generator_run_id": sidecar.get("generator_run_id"),
                        "symbols": sidecar.get("symbols"),
                        "timeframe": sidecar.get("timeframe"),
                        "take_profit_fraction": sidecar.get("takeProfitFraction"),
                        "stop_loss_fraction": sidecar.get("stopLossFraction"),
                        "horizon_bars": sidecar.get("horizonBars"),
                        "image_dimension": sidecar.get("imageDimension"),
                        "training_period_start": sidecar.get("training_period_start"),
                        "training_period_end": sidecar.get("training_period_end"),
                        "metrics": None,
                        "byte_size": sidecar.get("byte_size"),
                        "download_url": None,
                        "metadata_available": has_provenance,
                        "status": None,
                    }
                )
    except OSError as exc:
        logger.warning("Review overview: could not scan model storage root: %s", exc)

    # Extracted datasets (backend/datasets/*/summary.json)
    try:
        for name in sorted(os.listdir(datasets_dir)):
            ddir = os.path.join(datasets_dir, name)
            if not os.path.isdir(ddir):
                continue
            summary = _read_json_dict(os.path.join(ddir, "summary.json"))
            if not summary:
                continue
            ds_id = str(summary.get("dataset_id") or name)
            existing = datasets_by_key.get(ds_id)
            if existing:
                if existing.get("total_images") is None:
                    existing["total_images"] = summary.get("total_images")
                if existing.get("label_distribution") is None:
                    existing["label_distribution"] = summary.get("label_distribution")
                if not existing.get("symbols") or not existing.get("period_start"):
                    fb = _parse_meta_from_chart_filenames(summary.get("example_filenames") or [])
                    existing.setdefault("symbols", fb.get("symbols"))
                    if not existing.get("period_start"):
                        existing["period_start"] = fb.get("period_start")
                    if not existing.get("period_end"):
                        existing["period_end"] = fb.get("period_end")
                existing["extracted"] = True
                continue
            gen_run = summary.get("generator_run_id")
            if not gen_run:
                # Backtrace the source generator run by matching the dataset's charts.
                gen_run = _resolve_or_match_generator(ds_id)
            is_generated = bool(gen_run) or summary.get("source") == "generator"
            # Recover symbols/period from filenames when the summary lacks a generator link.
            fb = _parse_meta_from_chart_filenames(summary.get("example_filenames") or [])
            gen_cfg = _load_generator_config_from_disk(str(gen_run)) if gen_run else None
            gen_derived = _derive_model_fields_from_generator_config(gen_cfg) if gen_cfg else {}
            datasets_by_key[ds_id] = {
                "id": ds_id,
                "dataset_id": ds_id,
                "name": ds_id,
                "kind": "training" if is_generated else "unknown",
                "source": "generated" if is_generated else "uploaded",
                "created_at": summary.get("created_at"),
                "generator_run_id": gen_run,
                "symbols": summary.get("symbols") or gen_derived.get("symbols") or fb.get("symbols"),
                "timeframe": summary.get("timeframe") or gen_derived.get("timeframe"),
                "period_start": fb.get("period_start") or gen_derived.get("training_period_start"),
                "period_end": fb.get("period_end") or gen_derived.get("training_period_end"),
                "total_images": summary.get("total_images"),
                "label_distribution": summary.get("label_distribution"),
                "download_url": None,
                "extracted": True,
            }
    except OSError as exc:
        logger.warning("Review overview: could not scan datasets dir: %s", exc)

    # Mark datasets actually used for training
    for ds_id, trainer_ids in trainer_dataset_usage.items():
        ds_row = datasets_by_key.get(ds_id)
        if ds_row:
            ds_row["used_by_training_runs"] = trainer_ids
            if ds_row.get("kind") == "unknown":
                ds_row["kind"] = "training"

    # ---- Lineages (only explicitly recorded edges) ----
    lineages: List[Dict[str, Any]] = []
    consumed_generator_runs: set = set()
    consumed_testdata: set = set()

    def _matching_testdata(model_row: Dict[str, Any]) -> List[Dict[str, Any]]:
        out = []
        for t in testdata_rows:
            cfg = t["config"]
            if (
                (cfg.get("model_id") and cfg.get("model_id") == model_row.get("id"))
                or (cfg.get("training_run_id") and cfg.get("training_run_id") == model_row.get("training_run_id"))
                or (
                    cfg.get("generator_run_id")
                    and model_row.get("generator_run_id")
                    and cfg.get("generator_run_id") == model_row.get("generator_run_id")
                )
            ):
                out.append(t)
        return out

    for model_row in models:
        is_trained = model_row["source"] == "trained"
        gid = model_row.get("generator_run_id")
        if gid:
            consumed_generator_runs.add(gid)
        tds = _matching_testdata(model_row)
        for t in tds:
            consumed_testdata.add(t["run"].id)
        test_ds_ids = {str(t["results"].get("dataset_id")) for t in tds if t["results"].get("dataset_id")}
        ana = [
            a
            for a in analysis_rows
            if (is_trained and a["links"].get("trainer_run_id") == model_row.get("training_run_id"))
            or (a["links"].get("model_id") and a["links"].get("model_id") == model_row.get("id"))
        ]
        bts = []
        for b in backtest_rows:
            bl = b["links"]
            if (
                (is_trained and bl.get("trainer_run_id") == model_row.get("training_run_id"))
                or (bl.get("model_id") and bl.get("model_id") == model_row.get("id"))
                or (bl.get("dataset_id") and bl.get("dataset_id") in test_ds_ids)
            ):
                bts.append(b)

        training_dataset_ref = None
        if gid and f"generated:{gid}" in datasets_by_key:
            training_dataset_ref = {
                "key": f"generated:{gid}",
                "label": datasets_by_key[f"generated:{gid}"]["name"],
                "generator_run_id": gid,
                "symbols": datasets_by_key[f"generated:{gid}"].get("symbols") or model_row.get("symbols"),
            }
        elif model_row.get("dataset_id"):
            ds_key = str(model_row["dataset_id"])
            ds_row = datasets_by_key.get(ds_key) or {}
            syms = ds_row.get("symbols") or model_row.get("symbols")
            training_dataset_ref = {
                "key": ds_key,
                "label": ds_row.get("name") or (f"{syms} · {ds_key[:8]}" if syms else ds_key),
                "dataset_id": ds_key,
                "symbols": syms,
            }

        lineages.append(
            {
                "key": f"model:{model_row['id']}",
                "training_dataset": training_dataset_ref,
                "training_run": (
                    {"id": model_row["training_run_id"], "status": model_row.get("status")} if is_trained else None
                ),
                "model": {
                    "id": model_row["id"],
                    "name": model_row.get("name"),
                    "source": model_row["source"],
                    "metadata_available": model_row.get("metadata_available", False),
                },
                "test_datasets": [
                    {
                        "run_id": t["run"].id,
                        "dataset_id": t["results"].get("dataset_id"),
                        "name": t["config"].get("dataset_name"),
                        "status": t["run"].status,
                    }
                    for t in tds
                ],
                "analyses": [
                    {
                        "run_id": a["run"].id,
                        "trainer_run_id": a["links"].get("trainer_run_id"),
                        "analysis_id": a["links"].get("analysis_id"),
                        "status": a["run"].status,
                    }
                    for a in ana
                ],
                "backtests": [{"run_id": b["run"].id, "status": b["run"].status} for b in bts],
                "bot": None,
                "updated_at": model_row.get("created_at") or 0,
            }
        )

    # Generator runs not consumed by any model → partial chains (what's missing is visible)
    for gid, g in generator_runs.items():
        if gid in consumed_generator_runs:
            continue
        tds = [
            t
            for t in testdata_rows
            if t["config"].get("generator_run_id") == gid and t["run"].id not in consumed_testdata
        ]
        lineages.append(
            {
                "key": f"generator:{gid}",
                "training_dataset": {
                    "key": f"generated:{gid}",
                    "label": datasets_by_key.get(f"generated:{gid}", {}).get("name") or f"Generator run {gid}",
                    "generator_run_id": gid,
                },
                "training_run": None,
                "model": None,
                "test_datasets": [
                    {
                        "run_id": t["run"].id,
                        "dataset_id": t["results"].get("dataset_id"),
                        "name": t["config"].get("dataset_name"),
                        "status": t["run"].status,
                    }
                    for t in tds
                ],
                "analyses": [],
                "backtests": [],
                "bot": None,
                "updated_at": g["run"].updated_at,
            }
        )

    lineages.sort(key=lambda x: x.get("updated_at") or 0, reverse=True)
    models.sort(key=lambda m: m.get("created_at") or 0, reverse=True)
    dataset_rows = sorted(datasets_by_key.values(), key=lambda d: d.get("created_at") or 0, reverse=True)

    # Deployed bots (best effort; lineage links stay empty until explicit bot↔model metadata exists)
    bots_summary: List[Dict[str, Any]] = []
    try:
        from app.db import SessionLocal
        from app.models import Bot

        db = SessionLocal()
        try:
            for b in db.query(Bot).order_by(Bot.created_at.desc()).limit(50).all():
                bots_summary.append(
                    {
                        "id": b.id,
                        "name": b.name,
                        "symbol": b.symbol,
                        "model_filename": b.model_filename,
                        "is_active": bool(b.is_active),
                        "lifecycle_state": b.lifecycle_state,
                    }
                )
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001 — bots are optional context
        logger.warning("Review overview: could not load bots: %s", exc)

    statuses = [r["status"] for r in run_rows]
    # Overlay user labels (rename/tags/favorite/archive) onto models & datasets so the
    # library reflects the user's organization without touching artifacts.
    _labels = _load_library_labels()
    for _m in models:
        _apply_label_overlay(_m, "model", str(_m.get("id")), _labels)
    for _d in dataset_rows:
        _apply_label_overlay(_d, "dataset", str(_d.get("dataset_id") or _d.get("id")), _labels)

    return {
        "summary": {
            "totalRuns": len(run_rows),
            "runningRuns": sum(1 for s in statuses if s in ("running", "queued")),
            "completedRuns": sum(1 for s in statuses if s == "succeeded"),
            "failedRuns": sum(1 for s in statuses if s in ("failed", "cancelled")),
            "totalModels": len(models),
            "totalDatasets": len(dataset_rows),
            "totalTrainingRuns": sum(1 for r in run_rows if r["tool"] == "trainer"),
            "totalBacktests": sum(1 for r in run_rows if r["tool"] == "backtester"),
            "totalAnalyses": sum(1 for r in run_rows if r["tool"] == "analysis"),
            "totalBots": len(bots_summary),
        },
        "runs": run_rows,
        "models": models,
        "datasets": dataset_rows,
        "lineages": lineages,
        "bots": bots_summary,
    }

@app.head("/datasets/test")
async def test_datasets_endpoint():
    """Test endpoint for connectivity checks"""
    return {"status": "ok"}

@app.get("/")
def health():
    """Health check endpoint"""
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        reload=True,
        reload_includes=["*.py"],
        reload_excludes=["runs/*", "runs/**/*", "*.pyc", "__pycache__"]
    )
