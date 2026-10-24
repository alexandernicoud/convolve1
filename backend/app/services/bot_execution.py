"""
One paper-bot cycle, executed at most once per bot and completed bar.

Used by the scheduled job, the local poller, the deploy hook and manual runs: one path.

Ownership of a cycle is a row in ``bot_runs`` with ``execution_key = "<timeframe>:<bar date>"``
under a unique (bot_id, execution_key) constraint. Inserting that row is the claim, so two
workers, a scheduler retry and a simultaneous manual run cannot both execute the same bar.
A failed claim may be retried (``MAX_ATTEMPTS``); a claim left "running" by a crashed worker
is taken over after ``STALE_AFTER``. Both transitions are conditional UPDATEs, so only one
contender wins. Trade fills are additionally unique per prediction run.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Optional

import pandas as pd
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import bot_runner
from app.config import APP_PROFILE, BOT_DATA_DIR
from app.models import Bot, BotRun
from app.services import bot_inference, paper_engine
from app.services.bot_schedule import (
    chart_span_of,
    chart_window,
    completed_bars,
    execution_key,
    timeframe_of,
    utc,
)
from app.services.model_paths import require_bot_model_file
from app.services.trade_lifecycle import record_equity_snapshot

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
STALE_AFTER = timedelta(minutes=15)


class BotNotExecutable(Exception):
    """Raised when lifecycle_state is not active."""


class MarketDataUnavailable(Exception):
    """No completed bar could be loaded; nothing was claimed, so a later attempt may succeed."""


class BotRunOutcome(str, Enum):
    SKIPPED_ALREADY_RAN = "skipped_already_ran"
    SKIPPED_IN_PROGRESS = "skipped_in_progress"
    CREATED_SUCCESS = "created_success"
    CREATED_ERROR = "created_error"


def sync_bot_run_summary(db: Session, bot: Bot, run: BotRun) -> None:
    bot.last_run_at = run.run_finished_at or run.run_at
    if run.status == "success":
        bot.last_signal = run.signal or run.label
        bot.last_confidence = run.confidence
        bot.last_chart_date = run.chart_date
        bot.last_error = None
    elif run.status == "error":
        bot.last_error = run.error_message
    db.add(bot)


def history_start(db: Session, bot: Bot, now_utc: datetime):
    """First date to download: the chart span plus room for horizons and open positions."""
    unit, count = chart_span_of(bot)
    start = pd.Timestamp(utc(now_utc)) - pd.DateOffset(**{unit: count}) - pd.Timedelta(days=60)
    needed = paper_engine.earliest_needed_bar(db, bot)
    if needed is not None:
        start = min(start, pd.Timestamp(needed) - pd.Timedelta(days=10))
    return start.date()


def load_completed_bars(db: Session, bot: Bot, now_utc: datetime) -> pd.DataFrame:
    tf = timeframe_of(bot)
    try:
        raw = bot_runner.fetch_market_data(bot.symbol, interval=tf, start=history_start(db, bot, now_utc))
    except Exception as exc:
        raise MarketDataUnavailable(f"Market data request failed for {bot.symbol}: {exc}") from exc
    if raw is None or raw.empty:
        raise MarketDataUnavailable(f"No market data returned for {bot.symbol}")
    bars = completed_bars(raw, tf, now_utc)
    if bars.empty:
        raise MarketDataUnavailable(f"No completed {tf} bar for {bot.symbol} yet")
    return bars


def _claim(
    db: Session, bot: Bot, key: str, decision_at: datetime, trigger: str, now: datetime
) -> tuple[Optional[BotRun], BotRun]:
    """Return (claimed run or None, the run row for this key)."""
    run = BotRun(
        id=str(uuid.uuid4()),
        bot_id=bot.id,
        run_at=now,
        run_started_at=now,
        status="running",
        execution_key=key,
        trigger=trigger,
        attempts=1,
        decision_bar_at=decision_at,
    )
    db.add(run)
    try:
        db.commit()
        return run, run
    except IntegrityError:
        db.rollback()

    existing = db.query(BotRun).filter(BotRun.bot_id == bot.id, BotRun.execution_key == key).one()
    attempts = int(existing.attempts or 1)
    started = utc(existing.run_started_at or existing.run_at)
    if existing.status == "error":
        retryable = BotRun.status == "error"
    elif existing.status == "running" and started is not None and now - started >= STALE_AFTER:
        retryable = (BotRun.status == "running") & (func.coalesce(BotRun.run_started_at, BotRun.run_at) <= now - STALE_AFTER)
    else:
        return None, existing
    if attempts >= MAX_ATTEMPTS:
        if existing.status == "running":
            existing.status = "error"
            existing.run_finished_at = now
            existing.error_message = "Stale run: the worker stopped before finishing and no retries are left."
            db.commit()
        return None, existing

    won = (
        db.query(BotRun)
        .filter(BotRun.id == existing.id, retryable, or_(BotRun.attempts == attempts, BotRun.attempts.is_(None)))
        .update(
            {
                BotRun.status: "running",
                BotRun.attempts: attempts + 1,
                BotRun.run_started_at: now,
                BotRun.run_finished_at: None,
                BotRun.error_message: None,
                BotRun.trigger: trigger,
            },
            synchronize_session=False,
        )
    )
    db.commit()
    db.refresh(existing)
    return (existing if won == 1 else None), existing


def _persist_artifact(bot: Bot, run_id: str, local_path: Optional[str], name: str) -> Optional[str]:
    """Cloud runs (e.g. the scheduled job) keep charts in the bucket; locally the file stays put."""
    if not local_path or APP_PROFILE != "cloud":
        return local_path
    from app.services.durable_outputs import get_artifact_store

    owner = bot.user_id or "shared"
    return get_artifact_store().put_file(f"users/{owner}/bots/{bot.id}/runs/{run_id}/{name}", Path(local_path))


def execute_bot_run(
    db: Session, bot: Bot, *, trigger: str = "schedule", now_utc: Optional[datetime] = None
) -> tuple[BotRun, BotRunOutcome]:
    """Settle trades on completed bars, predict on the latest completed bar, queue a BUY.

    Raises BotNotExecutable for inactive bots and MarketDataUnavailable when no completed
    bar can be loaded (nothing is claimed; bot.last_error is updated).
    """
    now = utc(now_utc) or datetime.now(timezone.utc)
    if (getattr(bot, "lifecycle_state", None) or "active") != "active":
        raise BotNotExecutable("Bot lifecycle_state is not active")

    try:
        bars = load_completed_bars(db, bot, now)
    except MarketDataUnavailable as exc:
        bot.last_error = str(exc)
        db.add(bot)
        db.commit()
        raise

    tf = timeframe_of(bot)
    decision_ts = bars.index[-1]
    key = execution_key(tf, decision_ts)
    decision_at = utc(pd.Timestamp(decision_ts).to_pydatetime())
    run, existing = _claim(db, bot, key, decision_at, trigger, now)
    if run is None:
        outcome = BotRunOutcome.SKIPPED_IN_PROGRESS if existing.status == "running" else BotRunOutcome.SKIPPED_ALREADY_RAN
        return existing, outcome

    try:
        return _execute_claimed(db, bot.id, run.id, bars, now)
    except Exception as exc:
        logger.exception("Bot %s: execution of %s failed", bot.id, key)
        db.rollback()
        failed = db.get(BotRun, run.id)
        failed.status = "error"
        failed.run_finished_at = datetime.now(timezone.utc)
        failed.error_message = f"Execution failed: {exc}"
        fresh = db.get(Bot, bot.id)
        sync_bot_run_summary(db, fresh, failed)
        db.commit()
        return failed, BotRunOutcome.CREATED_ERROR


def _execute_claimed(db: Session, bot_id: str, run_id: str, bars: pd.DataFrame, now: datetime) -> tuple[BotRun, BotRunOutcome]:
    # Row lock on PostgreSQL serialises trade bookkeeping per bot; SQLite serialises writers anyway.
    bot = db.query(Bot).filter(Bot.id == bot_id).with_for_update().one()
    run = db.get(BotRun, run_id)

    events = paper_engine.settle(db, bot, bars, exit_run_id=run.id)
    meta: dict = {
        "execution_key": run.execution_key,
        "trigger": run.trigger,
        "attempt": run.attempts,
        "decision_bar": pd.Timestamp(bars.index[-1]).isoformat(),
        "bars_used": int(len(bars)),
        "assumptions": paper_engine.assumptions(bot),
        "settlement": events,
    }

    try:
        model_path = require_bot_model_file(bot.model_path)
    except FileNotFoundError as exc:
        result = None
        error = str(exc)
    else:
        unit, count = chart_span_of(bot)
        meta["chart_span"] = f"{count} {unit}"
        result = bot_inference.run_bot_inference(
            bot_id=bot.id,
            symbol=bot.symbol,
            resolved_model_path=model_path,
            confidence_threshold=bot.confidence_threshold,
            img_size=bot.img_size,
            data_dir=BOT_DATA_DIR,
            tp_pct=bot.tp_pct,
            sl_pct=bot.sl_pct,
            market_data=chart_window(bars, unit, count),
            artifact_key=run.id,
        )
        error = None if result.ok else (result.error_message or "Inference failed")

    run.run_finished_at = datetime.now(timezone.utc)
    if result is not None and result.ok:
        run.label = result.label_legacy
        run.signal = result.signal
        run.confidence = result.confidence
        run.chart_path = _persist_artifact(bot, run.id, result.chart_path, "chart.png")
        run.heatmap_path = _persist_artifact(bot, run.id, result.heatmap_path, "heatmap.png")
        run.chart_date = run.decision_bar_at
        run.status = "success"
        run.error_message = None
        meta["gradcam_ok"] = result.debug.get("gradcam_ok")
        meta["gradcam_error"] = result.debug.get("gradcam_error")
        meta["model_io"] = result.debug.get("model_io")
        meta["raw_probability"] = result.confidence
        if result.signal == "BUY":
            meta["entry"] = paper_engine.queue_entry(db, bot, run)
    else:
        run.status = "error"
        run.error_message = error

    total_eq, _, _ = paper_engine.mark_to_market(db, bot, bars)
    run.pnl = float(events.get("realized") or 0.0)
    run.equity = total_eq
    run.run_metadata_json = json.dumps(meta, default=str)
    record_equity_snapshot(db, bot, market_data=bars, bot_run_id=run.id)
    sync_bot_run_summary(db, bot, run)
    db.commit()
    db.refresh(run)
    return run, (BotRunOutcome.CREATED_SUCCESS if run.status == "success" else BotRunOutcome.CREATED_ERROR)


def is_runtime_expired(bot: Bot, now_utc: datetime) -> bool:
    if bot.runtime_days is None:
        return False
    created_at = utc(bot.created_at) or utc(now_utc)
    return utc(now_utc) > created_at + timedelta(days=bot.runtime_days)
