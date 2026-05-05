"""
Reusable single-bot inference (chart + preprocess + predict).

Uses the same primitives as training-side tooling: bot_runner chart generation,
tf.keras.utils load_img / img_to_array, /255.0, and model.predict.

Grad-CAM is optional: a failure there does not fail the run if prediction succeeded.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

import pandas as pd
from pathlib import Path

from app.bot_runner import (
    fetch_market_data,
    generate_chart_image,
    generate_gradcam_heatmap,
    run_model_inference,
)

logger = logging.getLogger(__name__)


def _label_to_signal(label: str) -> str:
    if label == "LONG":
        return "BUY"
    return "NO_BUY"


@dataclass
class BotInferenceResult:
    ok: bool
    signal: str  # BUY | NO_BUY
    confidence: Optional[float]
    chart_date: datetime
    chart_path: Optional[str]
    heatmap_path: Optional[str]
    label_legacy: str  # LONG | NEUTRAL (matches training-era naming)
    pnl_pct: Optional[float]
    error_message: Optional[str]
    debug: dict[str, Any] = field(default_factory=dict)


def _fail(
    *,
    symbol: str,
    bot_id: str,
    chart_path: Optional[str],
    error_message: str,
    debug_base: dict[str, Any],
    exc: Optional[BaseException] = None,
) -> BotInferenceResult:
    dbg = {**debug_base, "exception_type": type(exc).__name__ if exc else None}
    return BotInferenceResult(
        ok=False,
        signal="NO_BUY",
        confidence=None,
        chart_date=datetime.now(timezone.utc),
        chart_path=chart_path if chart_path and Path(chart_path).exists() else None,
        heatmap_path=None,
        label_legacy="NEUTRAL",
        pnl_pct=None,
        error_message=error_message,
        debug=dbg,
    )


def run_bot_inference(
    *,
    bot_id: str,
    symbol: str,
    resolved_model_path: str,
    confidence_threshold: float,
    img_size: int,
    data_dir: str,
    tp_pct: Optional[float],
    sl_pct: Optional[float],
    market_data: Optional[pd.DataFrame] = None,
) -> BotInferenceResult:
    """
    Run one full inference pass. Caller must pass an existing resolved .keras path.

    Required path (must all succeed for ok=True): chart → load model → predict.
    Optional: Grad-CAM heatmap; failure is recorded in debug but does not set ok=False.
    """
    try:
        import tensorflow as tf
    except Exception as exc:
        return BotInferenceResult(
            ok=False,
            signal="NO_BUY",
            confidence=None,
            chart_date=datetime.now(timezone.utc),
            chart_path=None,
            heatmap_path=None,
            label_legacy="NEUTRAL",
            pnl_pct=None,
            error_message=f"TensorFlow not available: {exc}",
            debug={"symbol": symbol, "bot_id": bot_id},
        )

    data = market_data if market_data is not None else fetch_market_data(symbol)
    if data is None or data.empty:
        return BotInferenceResult(
            ok=False,
            signal="NO_BUY",
            confidence=None,
            chart_date=datetime.now(timezone.utc),
            chart_path=None,
            heatmap_path=None,
            label_legacy="NEUTRAL",
            pnl_pct=None,
            error_message=f"No market data returned for {symbol}",
            debug={"symbol": symbol, "bot_id": bot_id},
        )

    last_timestamp = data.index[-1].to_pydatetime()
    date_str = last_timestamp.strftime("%Y-%m-%d")
    run_dir = Path(data_dir) / "runs" / bot_id / date_str
    run_dir.mkdir(parents=True, exist_ok=True)

    chart_path = str(run_dir / "chart.png")
    heatmap_path = str(run_dir / "heatmap.png")

    debug: dict[str, Any] = {
        "symbol": symbol,
        "bot_id": bot_id,
        "bar_date": date_str,
        "resolved_model_path": resolved_model_path,
        "img_size": img_size,
        "confidence_threshold": confidence_threshold,
    }

    # --- Required: chart ---
    try:
        generate_chart_image(data, chart_path, img_size)
    except Exception as exc:
        logger.exception("Chart generation failed for bot %s", bot_id)
        return _fail(
            symbol=symbol,
            bot_id=bot_id,
            chart_path=chart_path,
            error_message=f"Chart generation failed: {exc}",
            debug_base=debug,
            exc=exc,
        )

    # --- Required: load model + predict ---
    try:
        model = tf.keras.models.load_model(resolved_model_path)
        confidence = float(run_model_inference(model, chart_path, img_size))
    except Exception as exc:
        logger.exception("Model load or prediction failed for bot %s", bot_id)
        return _fail(
            symbol=symbol,
            bot_id=bot_id,
            chart_path=chart_path,
            error_message=f"Model load or prediction failed: {exc}",
            debug_base=debug,
            exc=exc,
        )

    label_legacy = "LONG" if confidence >= confidence_threshold else "NEUTRAL"
    signal = _label_to_signal(label_legacy)

    pnl_pct: Optional[float] = 0.0
    if label_legacy == "LONG" and len(data) > 1:
        last_close = float(data["Close"].iloc[-1])
        prev_close = float(data["Close"].iloc[-2])
        daily_return = (last_close - prev_close) / prev_close * 100.0
        if tp_pct is not None:
            daily_return = min(daily_return, tp_pct)
        if sl_pct is not None:
            daily_return = max(daily_return, -abs(sl_pct))
        pnl_pct = daily_return
    else:
        pnl_pct = 0.0

    chart_dt = last_timestamp
    if isinstance(chart_dt, datetime) and chart_dt.tzinfo is None:
        chart_dt = chart_dt.replace(tzinfo=timezone.utc)

    debug["raw_confidence"] = confidence
    debug["label_legacy"] = label_legacy

    # --- Optional: Grad-CAM (non-fatal) ---
    heatmap_saved_path: Optional[str] = None
    try:
        generate_gradcam_heatmap(model, chart_path, img_size, heatmap_path)
        heatmap_saved_path = heatmap_path
        debug["gradcam_ok"] = True
        debug["gradcam_error"] = None
    except Exception as exc:
        logger.warning(
            "Grad-CAM failed for bot %s (non-fatal; prediction succeeded): %s",
            bot_id,
            exc,
            exc_info=True,
        )
        heatmap_saved_path = None
        debug["gradcam_ok"] = False
        debug["gradcam_error"] = str(exc)

    return BotInferenceResult(
        ok=True,
        signal=signal,
        confidence=confidence,
        chart_date=chart_dt,
        chart_path=chart_path,
        heatmap_path=heatmap_saved_path,
        label_legacy=label_legacy,
        pnl_pct=pnl_pct,
        error_message=None,
        debug=debug,
    )
