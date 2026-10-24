import uuid
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
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
    # Bar timeframe ("1d" | "1wk" | "1mo"; NULL = "1d") and the chart window the model was trained on.
    timeframe = Column(String, nullable=True)
    chart_span_unit = Column(String, nullable=True)  # "days" | "weeks" | "months" | "years"
    chart_span_count = Column(Integer, nullable=True)
    # Most recent scheduled instant this bot has handled, and the last time the job tried it.
    last_slot_at = Column(DateTime(timezone=True), nullable=True)
    last_attempt_at = Column(DateTime(timezone=True), nullable=True)
    # Trading / sizing (defaults align with typical backtester deploy)
    starting_capital = Column(Float, nullable=False, default=10000.0)
    # Horizon in bars of `timeframe` (column name predates bar semantics).
    horizon_days = Column(Integer, nullable=False, default=5)
    position_size_pct = Column(Float, nullable=False, default=10.0)
    commission_pct = Column(Float, nullable=False, default=0.1)
    slippage_pct = Column(Float, nullable=False, default=0.05)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    last_signal = Column(String, nullable=True)
    last_confidence = Column(Float, nullable=True)
    last_chart_date = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    # Provenance recorded when the bot was created. NULL on bots that predate it: unknown, never inferred.
    provenance = Column(String, nullable=True)  # "library" | "upload"
    source_model_id = Column(String, nullable=True, index=True)
    source_training_run_id = Column(String, nullable=True, index=True)
    source_backtest_run_id = Column(String, nullable=True)
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
    __table_args__ = (UniqueConstraint("bot_id", "execution_key", name="uq_bot_runs_bot_execution_key"),)

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    bot_id = Column(String, ForeignKey("bots.id", ondelete="CASCADE"), nullable=False, index=True)
    # "<timeframe>:<decision bar date>"; one execution per bot and completed bar. NULL on legacy rows.
    execution_key = Column(String, nullable=True)
    trigger = Column(String, nullable=True)  # schedule | manual | deploy
    attempts = Column(Integer, nullable=True)
    decision_bar_at = Column(DateTime(timezone=True), nullable=True)
    # BUY handling: pending (enters at the next bar's open) | filled | skipped_position_open | cancelled
    entry_state = Column(String, nullable=True)
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
    __table_args__ = (UniqueConstraint("prediction_run_id", name="uq_bot_trades_prediction_run"),)

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    bot_id = Column(String, ForeignKey("bots.id", ondelete="CASCADE"), nullable=False, index=True)
    prediction_run_id = Column(String, ForeignKey("bot_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    decision_bar_at = Column(DateTime(timezone=True), nullable=True)
    outcome_flags = Column(Text, nullable=True)
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
    bars_held = Column(Integer, nullable=True)
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


class Profile(Base):
    """App user row. id is the Supabase Auth UUID (auth.users.id)."""

    __tablename__ = "profiles"

    id = Column(Uuid(as_uuid=True), primary_key=True)
    email = Column(String, nullable=True)
    display_name = Column(String, nullable=True)
    # Versions of the Terms / Privacy Policy the user accepted, and when (server clock).
    terms_version = Column(String, nullable=True)
    privacy_version = Column(String, nullable=True)
    terms_accepted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    credit_account = relationship("CreditAccount", back_populates="profile", uselist=False)
    ledger_entries = relationship("CreditLedgerEntry", back_populates="profile")
    pipeline_runs = relationship("PipelineRun", back_populates="profile")
    datasets = relationship("UserDataset", back_populates="profile")
    models = relationship("UserModel", back_populates="profile")


class CreditAccount(Base):
    __tablename__ = "credit_accounts"
    __table_args__ = (CheckConstraint("balance >= 0", name="ck_credit_accounts_balance_nonnegative"),)

    user_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True)
    balance = Column(Integer, nullable=False, default=0)
    version = Column(Integer, nullable=False, default=1)

    profile = relationship("Profile", back_populates="credit_account")


class CreditLedgerEntry(Base):
    """Append-only. ``reason`` is grant | allocation | charge | refund | adjustment."""

    __tablename__ = "credit_ledger"
    __table_args__ = (UniqueConstraint("idempotency_key", name="uq_credit_ledger_idempotency_key"),)

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    delta = Column(Integer, nullable=False)
    balance_after = Column(Integer, nullable=False)
    reason = Column(String, nullable=False)
    idempotency_key = Column(Text, nullable=False)
    run_id = Column(String, nullable=True, index=True)
    tool = Column(String, nullable=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    profile = relationship("Profile", back_populates="ledger_entries")


class UserPlan(Base):
    """Which plan a user is on. Holds no payment data; billing is not implemented."""

    __tablename__ = "user_plans"

    user_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True)
    plan_id = Column(String, nullable=False)
    status = Column(String, nullable=False, default="active")
    source = Column(String, nullable=False, default="default")
    current_period_start = Column(DateTime(timezone=True), nullable=True)
    current_period_end = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class DeletedAccount(Base):
    """Tombstone: a user ID whose account was deleted. Outlives the profile row on purpose."""

    __tablename__ = "deleted_accounts"

    user_id = Column(Uuid(as_uuid=True), primary_key=True)
    deleted_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PipelineRun(Base):
    """Ownership record for Generator / trainer / backtest / analysis / optimizer runs."""

    __tablename__ = "pipeline_runs"

    id = Column(String, primary_key=True)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    tool = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False, default="running")
    progress = Column(Float, nullable=False, default=0.0)
    stage = Column(String, nullable=True)
    message = Column(Text, nullable=True)
    error_summary = Column(Text, nullable=True)
    artifact_ref = Column(Text, nullable=True)
    worker_id = Column(String, nullable=True)
    route = Column(String, nullable=True)
    parent_run_id = Column(String, nullable=True)
    extra_json = Column(Text, nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    profile = relationship("Profile", back_populates="pipeline_runs")


class UserDataset(Base):
    """Ownership metadata for generated and uploaded datasets. Disk layout may be namespaced."""

    __tablename__ = "user_datasets"

    id = Column(String, primary_key=True)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    source = Column(String, nullable=True)
    kind = Column(String, nullable=True)
    path = Column(Text, nullable=True)
    extra_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    profile = relationship("Profile", back_populates="datasets")


class UserModel(Base):
    """Ownership metadata for uploaded (and optionally trained) models."""

    __tablename__ = "user_models"

    id = Column(String, primary_key=True)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    source = Column(String, nullable=True)
    storage_key = Column(Text, nullable=True)
    path = Column(Text, nullable=True)
    extra_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    profile = relationship("Profile", back_populates="models")


class AssetLabel(Base):
    """User organization overlay (name, tags, favorite, archive, notes) for one research asset.

    Never changes the artifact itself. ``kind`` is model | dataset | run.
    """

    __tablename__ = "asset_labels"
    __table_args__ = (UniqueConstraint("user_id", "kind", "asset_id", name="uq_asset_labels_user_kind_asset"),)

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String, nullable=False)
    asset_id = Column(String, nullable=False)
    display_name = Column(String, nullable=True)
    tags_json = Column(Text, nullable=True)
    favorite = Column(Boolean, nullable=False, default=False)
    archived = Column(Boolean, nullable=False, default=False)
    notes = Column(Text, nullable=True)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
