import logging
import os
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.config import (
    BOT_DATA_DIR,
    BOT_SCHEDULE_TZ,
    LIVE_DEPLOY_ENABLED,
)
from app.db import get_db
from app.jobs.run_due_bots import run_due_bots_once
from app.services import direct_uploads, library_models
from app.storage import save_bot_keras_file, save_bot_keras_upload
from app.models import Bot, BotRun
from app.schemas.bot import (
    BotDetailOut,
    BotOut,
    BotRunOut,
    BotTradingDetailFullOut,
)
from app.services.bot_status import derive_bot_status, next_scheduled_run_iso
from app.services.bot_trading_payload import build_trading_detail_full
from app.services import bot_jobs, paper_engine
from app.services.bot_schedule import CHART_SPAN_UNITS, TIMEFRAMES, valid_timezone
from app.services.trade_lifecycle import record_equity_snapshot
from app.services.bot_execution import (
    BotNotExecutable,
    MarketDataUnavailable,
    execute_bot_run,
    is_runtime_expired,
    load_completed_bars,
)
from app.ownership import bot_scope_clause, bot_scope_owner_id, bot_write_owner_id


router = APIRouter(prefix="/api/bots", tags=["bots"])
logger = logging.getLogger(__name__)

LIVE_DEPLOY_DISABLED_DETAIL = (
    "Live bot deployment/execution is disabled in this environment. "
    "Training, analysis and backtesting are available."
)


def _require_live_deploy() -> None:
    if not LIVE_DEPLOY_ENABLED:
        raise HTTPException(status_code=403, detail=LIVE_DEPLOY_DISABLED_DETAIL)


def _normalize_run_time_hhmm(raw: str) -> str:
    """
    Accept HH:MM or HH.MM (e.g. 22.00) with optional whitespace.
    Stored as zero-padded HH:MM for scheduling (see run_due_bots._parse_hhmm).
    """
    s = (raw or "").strip()
    if not s:
        raise HTTPException(
            status_code=400,
            detail="run_time is required (HH:MM or HH.MM, e.g. 22:00)",
        )
    s = s.replace(".", ":").replace(",", ":")
    parts = s.split(":")
    if len(parts) != 2:
        raise HTTPException(
            status_code=400,
            detail="run_time must be HH:MM (e.g. 22:00 or 22.00)",
        )
    try:
        h, m = int(parts[0]), int(parts[1])
    except ValueError as e:
        raise HTTPException(status_code=400, detail="run_time must be valid numbers") from e
    if not (0 <= h <= 23 and 0 <= m <= 59):
        raise HTTPException(status_code=400, detail="run_time out of range (hour 0–23, minute 0–59)")
    return f"{h:02d}:{m:02d}"


def _validate_bot_config(
    *,
    tp_pct: float,
    sl_pct: float,
    confidence_threshold: float,
    starting_capital: float,
    horizon_bars: int,
    position_size_pct: float,
    commission_pct: float,
    slippage_pct: float,
    runtime_days: Optional[int],
    timezone_name: str,
    timeframe: str,
    chart_span_unit: Optional[str],
    chart_span_count: Optional[int],
) -> None:
    problems = []
    if not (tp_pct > 0):
        problems.append("take profit must be positive")
    if not (0 < sl_pct < 100):
        problems.append("stop loss must be between 0 and 100%")
    if not (0 < confidence_threshold < 1):
        problems.append("confidence threshold must be between 0 and 1")
    if not (starting_capital > 0):
        problems.append("starting capital must be positive")
    if not (1 <= horizon_bars <= 260):
        problems.append("horizon must be 1-260 bars")
    if not (0 < position_size_pct <= 100):
        problems.append("position size must be in (0, 100]%")
    if commission_pct < 0 or slippage_pct < 0 or commission_pct > 5 or slippage_pct > 5:
        problems.append("commission and slippage must be between 0 and 5%")
    if runtime_days is not None and runtime_days < 1:
        problems.append("runtime must be at least one day")
    if not valid_timezone(timezone_name or ""):
        problems.append("unknown timezone")
    if timeframe not in TIMEFRAMES:
        problems.append(f"timeframe must be one of {', '.join(TIMEFRAMES)}")
    if (chart_span_unit is None) != (chart_span_count is None):
        problems.append("chart span needs both a unit and a count")
    elif chart_span_unit is not None and (chart_span_unit not in CHART_SPAN_UNITS or not (0 < int(chart_span_count) <= 520)):
        problems.append("invalid chart span")
    if problems:
        raise HTTPException(status_code=400, detail="; ".join(problems).capitalize())


def _user_scope_filter(owner_id: str):
    return bot_scope_clause(owner_id)


def _get_bot(db: Session, bot_id: str, owner_id: str) -> Bot:
    bot = (
        db.query(Bot)
        .filter(Bot.id == bot_id, _user_scope_filter(owner_id))
        .first()
    )
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    return bot


def _assert_bot_runnable(bot: Bot) -> None:
    ls = getattr(bot, "lifecycle_state", "active")
    if ls != "active":
        raise HTTPException(status_code=400, detail=f"Bot is not runnable (state={ls})")
    if not (bot.symbol or "").strip():
        raise HTTPException(status_code=400, detail="Bot has no symbol")


def _safe_path(path: str) -> str:
    data_root = Path(BOT_DATA_DIR).resolve()
    resolved = Path(path).resolve()
    if data_root not in resolved.parents and data_root != resolved:
        raise HTTPException(status_code=403, detail="Access denied")
    return str(resolved)


def _artifact_file(stored: str, bot_id: str, run_id: str, name: str) -> Optional[str]:
    """Local path for a run artifact; bucket copies (scheduled job runs) are fetched once."""
    if stored.startswith("gcs://"):
        from app.services.durable_outputs import get_artifact_store

        dest = Path(BOT_DATA_DIR) / "runs" / bot_id / "_remote" / run_id / name
        if not dest.is_file():
            try:
                get_artifact_store().materialize(stored, dest)
            except Exception:
                logger.warning("Could not fetch %s for bot run %s", name, run_id, exc_info=True)
                return None
        return str(dest)
    file_path = _safe_path(stored)
    return file_path if os.path.exists(file_path) else None


def _enrich_bot_out(db: Session, bot: Bot) -> BotOut:
    latest_run = (
        db.query(BotRun)
        .filter(BotRun.bot_id == bot.id)
        .order_by(BotRun.run_finished_at.desc(), BotRun.run_at.desc())
        .first()
    )
    bot_out = BotOut.model_validate(bot)
    if latest_run:
        bot_out.latest_run = BotRunOut.model_validate(latest_run)
    now_utc = datetime.now(timezone.utc)
    status = derive_bot_status(bot, now_utc=now_utc, latest_run=latest_run)
    next_iso = next_scheduled_run_iso(bot, now_utc, latest_run)
    return bot_out.model_copy(
        update={
            "derived_status": status,
            "lifecycle_state": getattr(bot, "lifecycle_state", "active"),
            "next_scheduled_run_iso": next_iso,
            "execution_assumptions": paper_engine.assumptions(bot),
        }
    )


def run_active_bots_once() -> None:
    """Startup hook: same due-bot batch as the scheduled job (per-bot TZ + run_time)."""
    run_due_bots_once()


@router.post("", response_model=BotOut)
async def create_bot(
    model_file: Optional[UploadFile] = File(None),
    model_upload_id: Optional[str] = Form(None),
    symbol: str = Form(...),
    confidence_threshold: float = Form(0.5),
    img_size: int = Form(224),
    tp_pct: float = Form(...),
    sl_pct: float = Form(...),
    runtime_days: Optional[int] = Form(None),
    name: Optional[str] = Form(None),
    starting_capital: float = Form(10000.0),
    horizon_days: int = Form(5),
    position_size_pct: float = Form(10.0),
    commission_pct: float = Form(0.1),
    slippage_pct: float = Form(0.05),
    run_time: str = Form(..., description="Daily run time HH:MM or HH.MM in the bot timezone"),
    timezone: str = Form(default=BOT_SCHEDULE_TZ),
    timeframe: str = Form("1d"),
    chart_span_unit: Optional[str] = Form(None),
    chart_span_count: Optional[int] = Form(None),
    source_model_id: Optional[str] = Form(None),
    source_training_run_id: Optional[str] = Form(None),
    source_backtest_run_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    owner_id: str = Depends(bot_write_owner_id),
):
    _validate_bot_config(
        tp_pct=tp_pct,
        sl_pct=sl_pct,
        confidence_threshold=confidence_threshold,
        starting_capital=starting_capital,
        horizon_bars=horizon_days,
        position_size_pct=position_size_pct,
        commission_pct=commission_pct,
        slippage_pct=slippage_pct,
        runtime_days=runtime_days,
        timezone_name=timezone,
        timeframe=timeframe,
        chart_span_unit=chart_span_unit,
        chart_span_count=chart_span_count,
    )
    schedule_time = _normalize_run_time_hhmm(run_time)
    from_library = bool(source_model_id or source_training_run_id)
    supplied = sum((model_file is not None, bool(model_upload_id), from_library))
    if supplied != 1:
        raise HTTPException(
            status_code=400,
            detail="Provide exactly one of model_file, model_upload_id, or a library model",
        )
    if source_backtest_run_id and not from_library:
        raise HTTPException(status_code=400, detail="source_backtest_run_id requires a library model")

    bot_id = str(uuid.uuid4())
    if model_file is not None:
        artifact = await save_bot_keras_upload(model_file, bot_id, user_id=owner_id)
    elif model_upload_id:
        artifact = await run_in_threadpool(_adopt_bot_model_upload, model_upload_id, bot_id, owner_id)
    else:
        artifact = await run_in_threadpool(
            _adopt_library_model,
            owner_id,
            source_model_id,
            source_training_run_id,
            source_backtest_run_id,
            bot_id,
        )

    bot = Bot(
        id=bot_id,
        user_id=owner_id,
        name=name,
        symbol=symbol.upper(),
        model_path=artifact.absolute_path,
        model_filename=artifact.original_filename,
        confidence_threshold=confidence_threshold,
        img_size=img_size,
        tp_pct=tp_pct,
        sl_pct=sl_pct,
        runtime_days=runtime_days,
        run_time=schedule_time,
        timezone=timezone or BOT_SCHEDULE_TZ,
        timeframe=timeframe,
        chart_span_unit=chart_span_unit if chart_span_count else None,
        chart_span_count=chart_span_count if chart_span_unit else None,
        starting_capital=starting_capital,
        horizon_days=horizon_days,
        position_size_pct=position_size_pct,
        commission_pct=commission_pct,
        slippage_pct=slippage_pct,
        is_active=True,
        lifecycle_state="active",
        provenance="library" if from_library else "upload",
        source_model_id=source_model_id if from_library else None,
        source_training_run_id=source_training_run_id if from_library else None,
        source_backtest_run_id=source_backtest_run_id if from_library else None,
    )
    db.add(bot)
    db.commit()
    db.refresh(bot)
    # The new bot is due (bot_schedule.is_due): its first run goes through the same job and
    # per-bar claim as scheduled runs. Starting the job now only removes the wait for the next tick.
    bot_jobs.request_batch()

    return _enrich_bot_out(db, bot)


def _adopt_bot_model_upload(upload_id: str, bot_id: str, owner_id: str):
    with direct_uploads.adopt_upload(owner_id, upload_id, "model") as (staged, local):
        return save_bot_keras_file(local, staged.filename, bot_id, user_id=owner_id)


def _adopt_library_model(
    owner_id: str,
    model_id: Optional[str],
    training_run_id: Optional[str],
    backtest_run_id: Optional[str],
    bot_id: str,
):
    """Bot-owned copy of an owned library model; the source stays untouched."""
    src, filename = library_models.resolve_library_model(
        owner_id, model_id=model_id, training_run_id=training_run_id
    )
    if backtest_run_id and not library_models.backtest_references_model(
        owner_id, backtest_run_id, model_id=model_id, training_run_id=training_run_id
    ):
        raise HTTPException(status_code=400, detail="That backtest was not run on the selected model")
    return save_bot_keras_file(src, filename, bot_id, user_id=owner_id)


@router.get("", response_model=List[BotOut])
def list_bots(db: Session = Depends(get_db), owner_id: str = Depends(bot_scope_owner_id)):
    bots = (
        db.query(Bot)
        .filter(_user_scope_filter(owner_id), Bot.lifecycle_state != "archived")
        .order_by(Bot.created_at.desc())
        .all()
    )
    return [_enrich_bot_out(db, bot) for bot in bots]


@router.get("/{bot_id}", response_model=BotDetailOut)
def get_bot_detail(bot_id: str, db: Session = Depends(get_db), owner_id: str = Depends(bot_scope_owner_id)):
    bot = _get_bot(db, bot_id, owner_id)
    total_runs = db.query(BotRun).filter(BotRun.bot_id == bot.id).count()
    success_runs = (
        db.query(BotRun).filter(BotRun.bot_id == bot.id, BotRun.status == "success").count()
    )
    error_runs = (
        db.query(BotRun).filter(BotRun.bot_id == bot.id, BotRun.status == "error").count()
    )
    return BotDetailOut(
        bot=_enrich_bot_out(db, bot),
        total_runs=total_runs,
        success_runs=success_runs,
        error_runs=error_runs,
    )


@router.get("/{bot_id}/trading", response_model=BotTradingDetailFullOut)
def get_bot_trading(bot_id: str, db: Session = Depends(get_db), owner_id: str = Depends(bot_scope_owner_id)):
    bot = _get_bot(db, bot_id, owner_id)
    return build_trading_detail_full(db, bot)


@router.post("/{bot_id}/pause", response_model=BotOut)
def pause_bot(bot_id: str, db: Session = Depends(get_db), owner_id: str = Depends(bot_scope_owner_id)):
    bot = _get_bot(db, bot_id, owner_id)
    if getattr(bot, "lifecycle_state", "active") in ("archived", "closed"):
        raise HTTPException(status_code=400, detail="Cannot pause this bot")
    bot.lifecycle_state = "paused"
    bot.is_active = False
    db.add(bot)
    db.commit()
    db.refresh(bot)
    return _enrich_bot_out(db, bot)


@router.post("/{bot_id}/resume", response_model=BotOut)
def resume_bot(bot_id: str, db: Session = Depends(get_db), owner_id: str = Depends(bot_scope_owner_id)):
    _require_live_deploy()
    bot = _get_bot(db, bot_id, owner_id)
    if bot.lifecycle_state != "paused":
        raise HTTPException(status_code=400, detail="Bot is not paused")
    if is_runtime_expired(bot, datetime.now(timezone.utc)):
        raise HTTPException(status_code=400, detail="Runtime expired; cannot resume")
    bot.lifecycle_state = "active"
    bot.is_active = True
    db.add(bot)
    db.commit()
    db.refresh(bot)
    return _enrich_bot_out(db, bot)


@router.post("/{bot_id}/close", response_model=BotTradingDetailFullOut)
def close_bot_lifecycle(bot_id: str, db: Session = Depends(get_db), owner_id: str = Depends(bot_scope_owner_id)):
    _require_live_deploy()
    bot = _get_bot(db, bot_id, owner_id)
    if bot.lifecycle_state in ("closed", "archived"):
        raise HTTPException(status_code=400, detail="Bot is already stopped")
    try:
        market_data = load_completed_bars(db, bot, datetime.now(timezone.utc))
    except MarketDataUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"{exc}. Open positions were not closed; try again later.") from exc

    paper_engine.close_all(db, bot, market_data)
    db.flush()
    bot.lifecycle_state = "closed"
    bot.is_active = False
    db.add(bot)
    record_equity_snapshot(db, bot, market_data=market_data, bot_run_id=None)
    db.commit()
    db.refresh(bot)
    return build_trading_detail_full(db, bot)


@router.post("/{bot_id}/archive", response_model=BotOut)
def archive_bot(bot_id: str, db: Session = Depends(get_db), owner_id: str = Depends(bot_scope_owner_id)):
    bot = _get_bot(db, bot_id, owner_id)
    bot.lifecycle_state = "archived"
    bot.is_active = False
    db.add(bot)
    db.commit()
    db.refresh(bot)
    return _enrich_bot_out(db, bot)


@router.get("/{bot_id}/runs", response_model=List[BotRunOut])
def list_bot_runs(bot_id: str, limit: int = 20, db: Session = Depends(get_db), owner_id: str = Depends(bot_scope_owner_id)):
    bot = _get_bot(db, bot_id, owner_id)
    runs = (
        db.query(BotRun)
        .filter(BotRun.bot_id == bot.id)
        .order_by(BotRun.run_at.desc())
        .limit(limit)
        .all()
    )
    return [BotRunOut.model_validate(run) for run in runs]


@router.post("/{bot_id}/toggle", response_model=BotOut)
def toggle_bot(bot_id: str, db: Session = Depends(get_db), owner_id: str = Depends(bot_scope_owner_id)):
    bot = _get_bot(db, bot_id, owner_id)
    ls = getattr(bot, "lifecycle_state", "active")
    if ls == "active":
        bot.lifecycle_state = "paused"
        bot.is_active = False
    elif ls == "paused":
        _require_live_deploy()
        if is_runtime_expired(bot, datetime.now(timezone.utc)):
            raise HTTPException(status_code=400, detail="Runtime expired; cannot resume")
        bot.lifecycle_state = "active"
        bot.is_active = True
    else:
        raise HTTPException(
            status_code=400,
            detail="Toggle only applies to active or paused bots; use archive/close if needed.",
        )
    db.add(bot)
    db.commit()
    db.refresh(bot)
    return _enrich_bot_out(db, bot)


def _manual_run_response(bot_id: str, db: Session, owner_id: str) -> BotRunOut:
    _require_live_deploy()
    bot = _get_bot(db, bot_id, owner_id)
    _assert_bot_runnable(bot)
    try:
        run, outcome = execute_bot_run(db, bot, trigger="manual")
    except BotNotExecutable as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except MarketDataUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    out = BotRunOut.model_validate(run)
    return out.model_copy(update={"outcome": outcome.value})


@router.post("/{bot_id}/run", response_model=BotRunOut)
def run_bot_scheduled_shape(bot_id: str, db: Session = Depends(get_db), owner_id: str = Depends(bot_scope_owner_id)):
    """Manual run: same execution path as the batch job; ignores schedule, respects idempotency."""
    return _manual_run_response(bot_id, db, owner_id)


@router.post("/{bot_id}/run-now", response_model=BotRunOut)
def run_bot_now(bot_id: str, db: Session = Depends(get_db), owner_id: str = Depends(bot_scope_owner_id)):
    """Alias for POST /{bot_id}/run."""
    return _manual_run_response(bot_id, db, owner_id)


@router.delete("/{bot_id}")
def delete_bot(bot_id: str, db: Session = Depends(get_db), owner_id: str = Depends(bot_scope_owner_id)):
    bot = _get_bot(db, bot_id, owner_id)
    model_path = bot.model_path
    runs_dir = Path(os.path.join(BOT_DATA_DIR, "runs", bot.id))

    db.delete(bot)
    db.commit()

    if model_path and os.path.exists(model_path):
        os.remove(model_path)
    if runs_dir.is_dir():
        shutil.rmtree(runs_dir, ignore_errors=True)

    return {"status": "deleted"}


@router.get("/{bot_id}/runs/{run_id}/chart")
def get_run_chart(bot_id: str, run_id: str, db: Session = Depends(get_db), owner_id: str = Depends(bot_scope_owner_id)):
    _get_bot(db, bot_id, owner_id)
    run = (
        db.query(BotRun)
        .filter(BotRun.id == run_id, BotRun.bot_id == bot_id)
        .first()
    )
    if not run or not run.chart_path:
        raise HTTPException(status_code=404, detail="Chart not found")
    file_path = _artifact_file(run.chart_path, bot_id, run_id, "chart.png")
    if not file_path:
        raise HTTPException(status_code=404, detail="Chart not found")
    return FileResponse(
        file_path,
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.get("/{bot_id}/runs/{run_id}/heatmap")
def get_run_heatmap(bot_id: str, run_id: str, db: Session = Depends(get_db), owner_id: str = Depends(bot_scope_owner_id)):
    _get_bot(db, bot_id, owner_id)
    run = (
        db.query(BotRun)
        .filter(BotRun.id == run_id, BotRun.bot_id == bot_id)
        .first()
    )
    if not run or not run.heatmap_path:
        raise HTTPException(status_code=404, detail="Heatmap not found")
    file_path = _artifact_file(run.heatmap_path, bot_id, run_id, "heatmap.png")
    if not file_path:
        raise HTTPException(status_code=404, detail="Heatmap not found")
    return FileResponse(
        file_path,
        headers={"Cache-Control": "no-store, max-age=0"},
    )
