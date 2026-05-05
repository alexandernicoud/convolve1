import uuid
from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import declarative_base, relationship


Base = declarative_base()


class Bot(Base):
    __tablename__ = "bots"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=True, index=True)
    name = Column(String, nullable=True)
    symbol = Column(String, nullable=False)
    model_path = Column(Text, nullable=False)
    model_filename = Column(String, nullable=True)
    confidence_threshold = Column(Float, nullable=False, default=0.5)
    img_size = Column(Integer, nullable=False, default=224)
    tp_pct = Column(Float, nullable=True)
    sl_pct = Column(Float, nullable=True)
    runtime_days = Column(Integer, nullable=True)
    run_time = Column(String, nullable=True)
    timezone = Column(String, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    # active | paused | closed | archived | expired — source of truth for scheduling UX
    lifecycle_state = Column(String, nullable=False, default="active", index=True)
    # Trading / sizing (defaults align with typical backtester deploy)
    starting_capital = Column(Float, nullable=False, default=10000.0)
    horizon_days = Column(Integer, nullable=False, default=5)
    position_size_pct = Column(Float, nullable=False, default=10.0)
    commission_pct = Column(Float, nullable=False, default=0.1)
    slippage_pct = Column(Float, nullable=False, default=0.05)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    last_signal = Column(String, nullable=True)
    last_confidence = Column(Float, nullable=True)
    last_chart_date = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    runs = relationship("BotRun", back_populates="bot", cascade="all, delete-orphan")
    trades = relationship("BotTrade", back_populates="bot", cascade="all, delete-orphan")
    equity_snapshots = relationship("BotEquitySnapshot", back_populates="bot", cascade="all, delete-orphan")


class BotRun(Base):
    __tablename__ = "bot_runs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    bot_id = Column(String, ForeignKey("bots.id", ondelete="CASCADE"), nullable=False, index=True)
    run_at = Column(DateTime(timezone=True), nullable=False)
    run_started_at = Column(DateTime(timezone=True), nullable=True)
    run_finished_at = Column(DateTime(timezone=True), nullable=True)
    label = Column(String, nullable=True)
    signal = Column(String, nullable=True)
    confidence = Column(Float, nullable=True)
    chart_path = Column(Text, nullable=True)
    heatmap_path = Column(Text, nullable=True)
    chart_date = Column(DateTime(timezone=True), nullable=True)
    equity = Column(Float, nullable=True)
    pnl = Column(Float, nullable=True)
    status = Column(String, nullable=False)
    error_message = Column(Text, nullable=True)
    run_metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    bot = relationship("Bot", back_populates="runs")


class BotTrade(Base):
    """A position opened from a BUY prediction; closed by TP/SL/horizon or expiry."""

    __tablename__ = "bot_trades"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    bot_id = Column(String, ForeignKey("bots.id", ondelete="CASCADE"), nullable=False, index=True)
    prediction_run_id = Column(String, ForeignKey("bot_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    entry_date = Column(Date, nullable=False)
    entry_price = Column(Float, nullable=False)
    position_notional = Column(Float, nullable=False)
    tp_price = Column(Float, nullable=True)
    sl_price = Column(Float, nullable=True)
    horizon_days = Column(Integer, nullable=False)
    expiry_date = Column(Date, nullable=False)
    status = Column(String, nullable=False, index=True)
    exit_date = Column(Date, nullable=True)
    exit_price = Column(Float, nullable=True)
    exit_reason = Column(String, nullable=True)
    exit_run_id = Column(String, ForeignKey("bot_runs.id", ondelete="SET NULL"), nullable=True)
    pnl_amount = Column(Float, nullable=True)
    pnl_pct = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    bot = relationship("Bot", back_populates="trades")
    prediction_run = relationship("BotRun", foreign_keys=[prediction_run_id])


class BotEquitySnapshot(Base):
    """Point-in-time equity after a run (or trade-only update) for charting."""

    __tablename__ = "bot_equity_snapshots"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    bot_id = Column(String, ForeignKey("bots.id", ondelete="CASCADE"), nullable=False, index=True)
    as_of = Column(DateTime(timezone=True), nullable=False, index=True)
    total_equity = Column(Float, nullable=False)
    realized_pnl = Column(Float, nullable=False, default=0.0)
    unrealized_pnl = Column(Float, nullable=True)
    bot_run_id = Column(String, ForeignKey("bot_runs.id", ondelete="SET NULL"), nullable=True)

    bot = relationship("Bot", back_populates="equity_snapshots")
