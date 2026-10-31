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
    LargeBinary,
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
    # Guided-tour progress as JSON (see app.services.onboarding); NULL = never started.
    onboarding_json = Column(Text, nullable=True)
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
    """Append-only. ``reason`` is grant | allocation | charge | refund | adjustment |
    subscription (monthly credits) | purchase (top-up) | expiry | credit_refund (purchased
    credits cashed out) | credit_refund_reversal (a failed cash refund put back) | chargeback."""

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
    """A user's subscription state. Card data never reaches Convolve; only provider references.

    ``status``: active | past_due | canceled (still inside a paid period) | expired | incomplete.
    """

    __tablename__ = "user_plans"

    user_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True)
    plan_id = Column(String, nullable=False)
    status = Column(String, nullable=False, default="active")
    source = Column(String, nullable=False, default="default")
    current_period_start = Column(DateTime(timezone=True), nullable=True)
    current_period_end = Column(DateTime(timezone=True), nullable=True)
    provider = Column(String, nullable=True)
    provider_customer_id = Column(String, nullable=True)
    provider_subscription_id = Column(String, nullable=True, index=True)
    cancel_at_period_end = Column(Boolean, nullable=False, default=False)
    canceled_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    billing_country = Column(String(2), nullable=True)
    # A downgrade scheduled for the next renewal; the current tier stays until the period ends.
    pending_plan_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class BillingPayment(Base):
    """One successful (or attempted) charge at the payment provider: a renewal or a top-up."""

    __tablename__ = "billing_payments"
    __table_args__ = (
        UniqueConstraint("provider", "provider_payment_id", name="uq_billing_payments_provider_ref"),
        CheckConstraint("amount_minor >= 0", name="ck_billing_payments_amount_nonnegative"),
        CheckConstraint("refunded_minor >= 0 AND refunded_minor <= amount_minor", name="ck_billing_payments_refund_bounds"),
    )

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String, nullable=False)
    provider_payment_id = Column(String, nullable=False)
    kind = Column(String, nullable=False)  # subscription | topup
    item_id = Column(String, nullable=False)  # tier id or credit pack id
    amount_minor = Column(Integer, nullable=False)
    currency = Column(String(3), nullable=False)
    refunded_minor = Column(Integer, nullable=False, default=0)
    # succeeded | failed | refunded | partially_refunded | disputed
    status = Column(String, nullable=False)
    country = Column(String(2), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class CreditLot(Base):
    """A block of credits from one source. Charges draw from lots; cash refunds are per lot.

    ``kind``: subscription (expires at ``expires_at``) | purchase (no routine expiry) | grant.
    Invariant: remaining + refunded <= total, so a credit can be refunded at most once.
    """

    __tablename__ = "credit_lots"
    __table_args__ = (
        CheckConstraint("credits_remaining >= 0", name="ck_credit_lots_remaining_nonnegative"),
        CheckConstraint("credits_refunded >= 0", name="ck_credit_lots_refunded_nonnegative"),
        CheckConstraint("credits_remaining + credits_refunded <= credits_total", name="ck_credit_lots_conservation"),
        UniqueConstraint("source_key", name="uq_credit_lots_source_key"),
    )

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String, nullable=False)
    source_key = Column(Text, nullable=False)
    item_id = Column(String, nullable=True)
    credits_total = Column(Integer, nullable=False)
    credits_remaining = Column(Integer, nullable=False)
    credits_refunded = Column(Integer, nullable=False, default=0)
    payment_id = Column(Uuid(as_uuid=True), ForeignKey("billing_payments.id", ondelete="SET NULL"), nullable=True, index=True)
    amount_minor = Column(Integer, nullable=True)
    currency = Column(String(3), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    expired_at = Column(DateTime(timezone=True), nullable=True)
    # Consumer acknowledged at checkout that delivery starts at once (withdrawal right waiver).
    withdrawal_waived = Column(Boolean, nullable=False, default=False)
    # "full" when an operator records that a mandatory full refund applies to this purchase.
    statutory_override = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class CreditLotMove(Base):
    """How one ledger entry changed one lot (charges, run refunds, expiries, cash refunds)."""

    __tablename__ = "credit_lot_moves"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lot_id = Column(Uuid(as_uuid=True), ForeignKey("credit_lots.id", ondelete="CASCADE"), nullable=False, index=True)
    ledger_key = Column(Text, nullable=False, index=True)
    run_id = Column(String, nullable=True, index=True)
    delta = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class BillingRefund(Base):
    """A cash refund of unused purchased credits from one lot. ``status``: pending | succeeded | failed."""

    __tablename__ = "billing_refunds"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_billing_refunds_idempotency_key"),
        CheckConstraint("amount_minor >= 0", name="ck_billing_refunds_amount_nonnegative"),
    )

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    request_id = Column(String, nullable=False, index=True)
    payment_id = Column(Uuid(as_uuid=True), ForeignKey("billing_payments.id", ondelete="SET NULL"), nullable=True, index=True)
    lot_id = Column(Uuid(as_uuid=True), ForeignKey("credit_lots.id", ondelete="SET NULL"), nullable=True, index=True)
    credits = Column(Integer, nullable=False)
    unused_value_minor = Column(Integer, nullable=False)
    rate_bps = Column(Integer, nullable=False)
    amount_minor = Column(Integer, nullable=False)
    currency = Column(String(3), nullable=False)
    basis = Column(String, nullable=False)  # voluntary | statutory_withdrawal | statutory_override
    status = Column(String, nullable=False, default="pending")
    provider = Column(String, nullable=False)
    provider_refund_id = Column(String, nullable=True)
    idempotency_key = Column(Text, nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    failure_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class BillingEvent(Base):
    """Processed provider webhook events, so a redelivered event is applied once."""

    __tablename__ = "billing_events"
    __table_args__ = (UniqueConstraint("provider", "event_id", name="uq_billing_events_provider_event"),)

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider = Column(String, nullable=False)
    event_id = Column(String, nullable=False)
    type = Column(String, nullable=False)
    user_id = Column(Uuid(as_uuid=True), nullable=True, index=True)
    outcome = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class FeedbackResponse(Base):
    """One completed feedback questionnaire per account; its bonus credit lot shares the transaction."""

    __tablename__ = "feedback_responses"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, unique=True)
    survey_version = Column(String, nullable=False)
    answers_json = Column(Text, nullable=False)
    credits_granted = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class FoundingDiscount(Base):
    """Founding beta member offer: one discounted first subscription invoice per account.

    Eligibility comes from profiles.created_at and the configured beta window; this row only
    tracks the offer's use. ``redeemed_at`` is set once, when the discounted first subscription
    payment arrives, and never cleared, so the offer cannot be used twice.
    """

    __tablename__ = "founding_discounts"

    user_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True)
    percent = Column(Integer, nullable=False)
    checkout_session_id = Column(String, nullable=True)
    offered_at = Column(DateTime(timezone=True), nullable=True)
    subscription_ref = Column(String, nullable=True)
    payment_ref = Column(String, nullable=True)
    redeemed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ReferralCode(Base):
    """An ambassador's personal invite code (one per account, created on request)."""

    __tablename__ = "referral_codes"

    user_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True)
    code = Column(String(16), nullable=False, unique=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Referral(Base):
    """One invited account. ``status``: pending (signed up) | rewarded (first paid subscription) |
    reversed (that payment was refunded in full or disputed; unused rewards withdrawn).

    ``referrer_reward``: credits (promotional credits, Starter) | free_month (complimentary Research
    month) | invoice_credit (credit on the ambassador's next invoices) | limit_reached | unavailable.
    Rewards are granted at most once per referee, for the payment in ``payment_id``.
    """

    __tablename__ = "referrals"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    referrer_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    referee_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, unique=True)
    code = Column(String(16), nullable=False)
    status = Column(String, nullable=False, default="pending")
    referee_credits = Column(Integer, nullable=False, default=0)
    referrer_reward = Column(String, nullable=True)
    referrer_credits = Column(Integer, nullable=False, default=0)
    referee_tier = Column(String, nullable=True)
    payment_id = Column(Uuid(as_uuid=True), ForeignKey("billing_payments.id", ondelete="SET NULL"), nullable=True,
                        index=True)
    rewarded_at = Column(DateTime(timezone=True), nullable=True)
    reversed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class CitationClaim(Base):
    """A request for the citation bonus. ``status``: pending | approved | rejected.

    The proof file is small (capped on upload) and kept in the row so it survives stateless hosts.
    """

    __tablename__ = "citation_claims"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    url = Column(String(500), nullable=True)
    note = Column(Text, nullable=True)
    file_name = Column(String(200), nullable=True)
    content_type = Column(String(100), nullable=True)
    file_bytes = Column(LargeBinary, nullable=True)
    status = Column(String, nullable=False, default="pending")
    review_note = Column(Text, nullable=True)
    reviewed_by = Column(Uuid(as_uuid=True), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    credits_granted = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ContactMessage(Base):
    """Contact-form submission. ``ip_hash`` is a keyed hash, used only for rate limiting."""

    __tablename__ = "contact_messages"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)
    email = Column(String(320), nullable=False)
    topic = Column(String(64), nullable=True)
    message = Column(Text, nullable=False)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("profiles.id", ondelete="SET NULL"), nullable=True, index=True)
    ip_hash = Column(String(64), nullable=True, index=True)
    notified_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)


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
