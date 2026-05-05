"""
Persisted bot execution: DB rows, idempotency, trade lifecycle, and bot_inference.

Used by API routes, startup hook, worker, and run_due_bots job — one path.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from enum import Enum
from typing import Optional

import pandas as pd
from sqlalchemy.orm import Session

from app.bot_runner import fetch_market_data
from app.config import BOT_DATA_DIR
from app.models import Bot, BotRun
from app.services.bot_inference import run_bot_inference
from app.services.model_paths import require_bot_model_file
from app.services.trade_lifecycle import (
    compute_equity_and_unrealized,
    open_trade_from_buy_signal,
    process_open_trades,
    record_equity_snapshot,
)

logger = logging.getLogger(__name__)


class BotNotExecutable(Exception):
    """Raised when lifecycle_state is not active (scheduled runs should filter before calling)."""


class BotRunOutcome(str, Enum):
    SKIPPED_ALREADY_RAN = "skipped_already_ran"
    CREATED_SUCCESS = "created_success"
    CREATED_ERROR = "created_error"


def _latest_run_for_bot(db: Session, bot_id: str) -> Optional[BotRun]:
    return (
        db.query(BotRun)
        .filter(BotRun.bot_id == bot_id)
        .order_by(BotRun.run_at.desc())
        .first()
    )


def _latest_success_run(db: Session, bot_id: str) -> Optional[BotRun]:
    return (
        db.query(BotRun)
        .filter(BotRun.bot_id == bot_id, BotRun.status == "success")
        .order_by(BotRun.run_at.desc())
        .first()
    )


def _run_chart_bar_date(run: BotRun) -> Optional[date]:
    ref = run.chart_date or run.run_at
    if ref is None:
        return None
    if getattr(ref, "tzinfo", None):
        ref = ref.astimezone(timezone.utc)
    return ref.date() if hasattr(ref, "date") else ref


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


def execute_bot_run(db: Session, bot: Bot) -> tuple[BotRun, BotRunOutcome]:
    """
    Execute one inference cycle: process open trades on latest bar, run inference,
    optionally open a new trade from BUY, persist equity snapshot.
    """
    started = datetime.now(timezone.utc)
    if getattr(bot, "lifecycle_state", "active") != "active":
        raise BotNotExecutable("Bot lifecycle_state is not active")

    market_data = fetch_market_data(bot.symbol)

    if market_data.empty:
        finished = datetime.now(timezone.utc)
        run = BotRun(
            bot_id=bot.id,
            run_at=started,
            run_started_at=started,
            run_finished_at=finished,
            status="error",
            error_message="No market data returned",
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        sync_bot_run_summary(db, bot, run)
        db.commit()
        db.refresh(bot)
        return run, BotRunOutcome.CREATED_ERROR

    idx = market_data.index[-1]
    last_market_date = idx.date() if hasattr(idx, "date") else pd.Timestamp(idx).date()

    succ = _latest_success_run(db, bot.id)
    if succ and _run_chart_bar_date(succ) == last_market_date:
        return succ, BotRunOutcome.SKIPPED_ALREADY_RAN

    try:
        resolved_model = require_bot_model_file(bot.model_path)
    except FileNotFoundError as exc:
        finished = datetime.now(timezone.utc)
        run = BotRun(
            bot_id=bot.id,
            run_at=started,
            run_started_at=started,
            run_finished_at=finished,
            status="error",
            error_message=str(exc),
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        sync_bot_run_summary(db, bot, run)
        db.commit()
        db.refresh(bot)
        return run, BotRunOutcome.CREATED_ERROR

    run = BotRun(
        bot_id=bot.id,
        run_at=started,
        run_started_at=started,
        status="running",
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    realized = process_open_trades(db, bot, market_data, exit_run_id=run.id)
    db.flush()

    result = run_bot_inference(
        bot_id=bot.id,
        symbol=bot.symbol,
        resolved_model_path=resolved_model,
        confidence_threshold=bot.confidence_threshold,
        img_size=bot.img_size,
        data_dir=BOT_DATA_DIR,
        tp_pct=bot.tp_pct,
        sl_pct=bot.sl_pct,
        market_data=market_data,
    )

    finished = datetime.now(timezone.utc)

    if result.ok:
        chart_dt = result.chart_date
        if isinstance(chart_dt, datetime) and chart_dt.tzinfo is None:
            chart_dt = chart_dt.replace(tzinfo=timezone.utc)

        run.run_at = chart_dt
        run.run_finished_at = finished
        run.label = result.label_legacy
        run.signal = result.signal
        run.confidence = result.confidence
        run.chart_path = result.chart_path
        run.heatmap_path = result.heatmap_path
        run.chart_date = chart_dt
        run.status = "success"
        run.error_message = None
        meta = {
            "gradcam_ok": result.debug.get("gradcam_ok"),
            "gradcam_error": result.debug.get("gradcam_error"),
            "inference_pnl_pct": result.pnl_pct,
            "realized_trade_pnl_this_run": realized,
        }
        run.run_metadata_json = json.dumps(meta)

        if result.signal == "BUY":
            open_trade_from_buy_signal(db, bot, market_data, run)
        db.flush()

        total_eq, _, _ = compute_equity_and_unrealized(db, bot, market_data)
        run.pnl = realized
        run.equity = total_eq
        db.add(run)
        record_equity_snapshot(db, bot, market_data=market_data, bot_run_id=run.id)
    else:
        run.run_finished_at = finished
        run.status = "error"
        run.error_message = result.error_message or "Inference failed"
        meta = {"realized_trade_pnl_this_run": realized}
        run.run_metadata_json = json.dumps(meta)
        total_eq, _, _ = compute_equity_and_unrealized(db, bot, market_data)
        run.pnl = realized
        run.equity = total_eq
        db.add(run)
        record_equity_snapshot(db, bot, market_data=market_data, bot_run_id=run.id)

    db.commit()
    db.refresh(run)
    sync_bot_run_summary(db, bot, run)
    db.commit()
    db.refresh(bot)

    outcome = BotRunOutcome.CREATED_SUCCESS if result.ok else BotRunOutcome.CREATED_ERROR
    return run, outcome


def is_runtime_expired(bot: Bot, now_utc: datetime) -> bool:
    if bot.runtime_days is None:
        return False
    created_at = bot.created_at or now_utc
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return now_utc > created_at + timedelta(days=bot.runtime_days)
