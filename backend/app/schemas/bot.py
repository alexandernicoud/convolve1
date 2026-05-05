from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class BotRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    bot_id: str
    run_at: datetime
    run_started_at: Optional[datetime] = None
    run_finished_at: Optional[datetime] = None
    label: Optional[str] = None
    signal: Optional[str] = None
    confidence: Optional[float] = None
    chart_path: Optional[str] = None
    heatmap_path: Optional[str] = None
    chart_date: Optional[datetime] = None
    equity: Optional[float] = None
    pnl: Optional[float] = None
    status: str
    error_message: Optional[str] = None
    created_at: Optional[datetime] = None
    run_metadata_json: Optional[str] = Field(
        default=None,
        description="JSON with optional gradcam_ok / gradcam_error when prediction succeeded.",
    )


class BotTradeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    bot_id: str
    prediction_run_id: Optional[str] = None
    entry_date: date
    entry_price: float
    position_notional: float
    tp_price: Optional[float] = None
    sl_price: Optional[float] = None
    horizon_days: int
    expiry_date: date
    status: str
    exit_date: Optional[date] = None
    exit_price: Optional[float] = None
    exit_reason: Optional[str] = None
    exit_run_id: Optional[str] = None
    pnl_amount: Optional[float] = None
    pnl_pct: Optional[float] = None
    created_at: Optional[datetime] = None


class BotEquityPointOut(BaseModel):
    as_of: datetime
    total_equity: float
    realized_pnl: float
    unrealized_pnl: Optional[float] = None


class BotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: Optional[str] = None
    name: Optional[str] = None
    symbol: str
    model_path: str
    model_filename: Optional[str] = None
    confidence_threshold: float
    img_size: int
    tp_pct: Optional[float] = None
    sl_pct: Optional[float] = None
    runtime_days: Optional[int] = None
    run_time: Optional[str] = None
    timezone: Optional[str] = None
    starting_capital: float = 10000.0
    horizon_days: int = 5
    position_size_pct: float = 10.0
    commission_pct: float = 0.1
    slippage_pct: float = 0.05
    is_active: bool
    last_run_at: Optional[datetime] = None
    last_signal: Optional[str] = None
    last_confidence: Optional[float] = None
    last_chart_date: Optional[datetime] = None
    last_error: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    latest_run: Optional[BotRunOut] = None
    derived_status: Optional[str] = None
    lifecycle_state: str = "active"
    next_scheduled_run_iso: Optional[str] = None


class BotSummarySectionOut(BaseModel):
    id: str
    symbol: str
    model_filename: Optional[str] = None
    started_at: Optional[datetime] = None
    runtime_days: Optional[int] = None
    lifecycle_state: str
    derived_status: str
    next_scheduled_run_iso: Optional[str] = None
    days_running: int = 0


class BotConfigSectionOut(BaseModel):
    starting_capital: float
    tp_pct: Optional[float] = None
    sl_pct: Optional[float] = None
    horizon_days: int
    position_size_pct: float
    commission_pct: float
    slippage_pct: float
    run_time: Optional[str] = None
    timezone: Optional[str] = None


class BotPerformanceSectionOut(BaseModel):
    current_equity: float
    realized_pnl: float
    unrealized_pnl: Optional[float] = None
    total_return_pct: float
    """Winning (TP) trades / all closed trades."""
    accuracy_winning_trades_over_total_closed: Optional[float] = None
    closed_trades_count: int
    open_trades_count: int
    predictions_count: int


class BotOpenTradeRowOut(BaseModel):
    id: str
    entry_date: date
    entry_price: float
    tp_price: Optional[float] = None
    sl_price: Optional[float] = None
    current_price: Optional[float] = None
    unrealized_pnl: float
    days_held: int


class BotPredictionHistoryRowOut(BaseModel):
    run_id: str
    run_at: datetime
    chart_date: Optional[datetime] = None
    signal: Optional[str] = None
    confidence: Optional[float] = None
    label: Optional[str] = None
    status: str
    trade_opened: bool
    linked_trade_id: Optional[str] = None


class BotDetailOut(BaseModel):
    bot: BotOut
    total_runs: int
    success_runs: int
    error_runs: int


class DashboardOverviewOut(BaseModel):
    total_realized_pnl: float
    open_unrealized_pnl: float
    active_bots: int
    best_bot_id: Optional[str] = None
    best_bot_name: Optional[str] = None
    best_realized_pnl: Optional[float] = None
    win_rate_closed: Optional[float] = None
    total_closed_trades: int
    open_trades_count: int
    next_scheduled_run_iso: Optional[str] = None
    # Aggregate account context (sum across non-archived bots)
    total_starting_capital: float = 0.0
    current_equity: float = 0.0
    # Among closed trades opened from a LONG (label 1) prediction: wins / (wins + losses)
    label_1_precision: Optional[float] = None
    label_1_precision_sample: int = 0
    # Best bot snapshot (by realized PnL)
    best_bot_symbol: Optional[str] = None
    best_bot_starting_capital: Optional[float] = None
    best_bot_return_pct: Optional[float] = None
    best_bot_max_drawdown_pct: Optional[float] = None
    best_bot_label_1_precision: Optional[float] = None
    best_bot_label_1_sample: int = 0


class DashboardActivityItemOut(BaseModel):
    """Unified feed row for dashboard overview."""

    at: datetime
    kind: str  # prediction | trade_closed | trade_open
    symbol: str
    bot_name: Optional[str] = None
    title: str
    subtitle: Optional[str] = None
    pnl_amount: Optional[float] = None
    confidence: Optional[float] = None


class EquitySeriesOut(BaseModel):
    bot_id: str
    name: Optional[str] = None
    symbol: str
    points: List[BotEquityPointOut]


class DashboardBundleOut(BaseModel):
    overview: DashboardOverviewOut
    equity_by_bot: List[EquitySeriesOut]
    activity_feed: List[DashboardActivityItemOut] = Field(default_factory=list)


class DashboardTradeRowOut(BaseModel):
    """Flattened trade for cross-bot history UI."""

    id: str
    bot_id: str
    bot_name: str
    symbol: str
    entry_date: str
    exit_date: Optional[str] = None
    status: str
    pnl_amount: Optional[float] = None
    pnl_pct: Optional[float] = None


class BotTradingDetailFullOut(BaseModel):
    """Complete trading dashboard payload for one bot."""

    bot: BotOut
    summary: BotSummarySectionOut
    config: BotConfigSectionOut
    performance: BotPerformanceSectionOut
    open_trades_detail: List[BotOpenTradeRowOut]
    closed_trades: List[BotTradeOut]
    prediction_history: List[BotPredictionHistoryRowOut]
    equity_history: List[BotEquityPointOut]
    recent_runs: List[BotRunOut]
