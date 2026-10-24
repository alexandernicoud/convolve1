"""Deterministic bot fleets (0 / 1 / 3 / 12 bots) for fleet accounting tests and UI fixtures.

Every bot is internally consistent with the live accounting model: equity = start + realized + unrealized,
realized = sum of closed-trade P&L, one open position at a time, trades linked to the runs that opened
and closed them.
"""

from __future__ import annotations

import random
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models import Bot, BotEquitySnapshot, BotRun, BotTrade


@dataclass
class Spec:
    symbol: str
    name: str
    capital: float
    deployed_days_ago: float
    lifecycle: str = "active"
    seed: int = 1
    drift: float = 0.0  # mean P&L per trade as a fraction of notional
    vol: float = 0.02
    stop_days_ago: Optional[float] = None  # last run (paused / stale bots)
    end_with_error: bool = False
    open_at_end: bool = False
    errors: int = 0
    extra: dict = field(default_factory=dict)


def _bot(user_id: str, s: Spec, now: datetime) -> Bot:
    return Bot(
        id=str(uuid.uuid4()),
        user_id=user_id,
        name=s.name,
        symbol=s.symbol,
        model_path="fixture/model.pt",
        model_filename="model.pt",
        confidence_threshold=0.5,
        img_size=224,
        tp_pct=2.0,
        sl_pct=1.0,
        starting_capital=s.capital,
        horizon_days=5,
        position_size_pct=10.0,
        commission_pct=0.05,
        slippage_pct=0.05,
        lifecycle_state=s.lifecycle,
        is_active=s.lifecycle == "active",
        created_at=now - timedelta(days=s.deployed_days_ago),
    )


def add_bot(db: Session, user_id: str, s: Spec, now: datetime) -> Bot:
    rng = random.Random(s.seed)
    bot = _bot(user_id, s, now)
    db.add(bot)
    start = bot.created_at
    end = now - timedelta(days=s.stop_days_ago) if s.stop_days_ago else now - timedelta(minutes=2)
    dense_from = now - timedelta(hours=24)
    t = start + timedelta(minutes=30)
    realized = 0.0
    trade: Optional[dict] = None
    times: List[datetime] = []
    while t <= end:
        times.append(t)
        t += timedelta(minutes=20) if t >= dense_from else timedelta(hours=3)
    if times and not s.stop_days_ago and times[-1] < end:
        times.append(end)
    error_slots = set(rng.sample(range(len(times)), min(s.errors, max(0, len(times) - 2)))) if times else set()
    for k, t in enumerate(times):
        last = k == len(times) - 1
        failed = k in error_slots or (last and s.end_with_error)
        run = BotRun(
            id=str(uuid.uuid4()),
            bot_id=bot.id,
            run_at=t - timedelta(seconds=40),
            run_started_at=t - timedelta(seconds=40),
            run_finished_at=t,
            status="error" if failed else "success",
            error_message=("No market data returned" if k % 2 else "Chart generation failed: Axis limits cannot be NaN or Inf") if failed else None,
        )
        unrealized = 0.0
        if not failed:
            run.signal = "NO_BUY"
            if trade and (k - trade["k0"] >= trade["len"]) and not (s.open_at_end and k >= len(times) - 3):
                pnl = trade["pnl"]
                realized += pnl
                tr: BotTrade = trade["row"]
                tr.status = "won" if pnl > 0 else "lost"
                tr.exit_reason = "take_profit" if pnl > 0 else "stop_loss"
                tr.exit_date = t.date()
                tr.exit_price = tr.entry_price * (1 + pnl / tr.position_notional + 0.001)
                tr.pnl_amount = pnl
                tr.pnl_pct = pnl / tr.position_notional * 100
                tr.exit_run_id = run.id
                trade = None
            elif trade is None and (rng.random() < 0.35 or (s.open_at_end and k == len(times) - 3)):
                run.signal = "BUY"
                equity = s.capital + realized
                notional = equity * 0.10
                pnl = notional * rng.gauss(s.drift, s.vol)
                row = BotTrade(
                    id=str(uuid.uuid4()),
                    bot_id=bot.id,
                    prediction_run_id=run.id,
                    entry_date=t.date(),
                    entry_price=100.0 + k * 0.1,
                    position_notional=notional,
                    tp_price=None,
                    sl_price=None,
                    horizon_days=5,
                    expiry_date=(t + timedelta(days=5)).date(),
                    status="open",
                )
                db.add(row)
                trade = {"row": row, "pnl": pnl, "k0": k, "len": rng.randint(2, 6)}
            if trade:
                frac = min(1.0, (k - trade["k0"]) / max(1, trade["len"]))
                unrealized = trade["pnl"] * frac - trade["row"].position_notional * 0.001
            run.equity = s.capital + realized + unrealized
            run.pnl = 0.0
        db.add(run)
        db.flush()  # snapshots reference the run; Postgres checks the foreign key per statement
        if not failed:
            db.add(
                BotEquitySnapshot(
                    id=str(uuid.uuid4()),
                    bot_id=bot.id,
                    as_of=t,
                    total_equity=s.capital + realized + unrealized,
                    realized_pnl=realized,
                    unrealized_pnl=unrealized,
                    bot_run_id=run.id,
                )
            )
    if times and s.end_with_error:
        bot.last_error = "No market data returned"
    db.flush()
    return bot


FLEETS = {
    0: [],
    1: [Spec("AAPL", "AAPL momentum", 10000, 20, seed=11, drift=0.004)],
    3: [
        Spec("MSFT", "MSFT breakout", 10000, 34, seed=21, drift=0.006),
        Spec("NVDA", "NVDA swing", 15000, 12, seed=22, drift=-0.003, end_with_error=True, errors=4),
        Spec("AMZN", "AMZN reversal", 8000, 25, lifecycle="paused", seed=23, drift=0.002, stop_days_ago=3, open_at_end=True),
    ],
    12: [
        Spec("MSFT", "MSFT breakout", 10000, 40, seed=31, drift=0.006),
        Spec("NVDA", "NVDA swing", 15000, 38, seed=32, drift=-0.002, end_with_error=True, errors=6),
        Spec("AMZN", "AMZN reversal", 8000, 36, lifecycle="paused", seed=33, drift=0.002, stop_days_ago=3, open_at_end=True),
        Spec("AAPL", "AAPL momentum", 12000, 33, seed=34, drift=0.004),
        Spec("GOOGL", "GOOGL trend", 10000, 30, seed=35, drift=0.001),
        Spec("META", "META mean-revert", 9000, 27, seed=36, drift=-0.004, errors=2),
        Spec("TSLA", "TSLA volatility", 6000, 22, seed=37, drift=0.0, vol=0.05),
        Spec("AMD", "AMD breakout", 7000, 18, seed=38, drift=0.005, stop_days_ago=0.15),
        Spec("JPM", "JPM carry", 11000, 14, seed=39, drift=0.002, open_at_end=True),
        Spec("BTC-USD", "BTC trend", 5000, 9, seed=40, drift=0.003, vol=0.04),
        Spec("SAP.DE", "SAP swing (EUR)", 9000, 16, seed=41, drift=0.002),
        Spec("XOM", "XOM momentum", 8000, 5, seed=42, drift=-0.001),
    ],
}

EXCLUDED_12 = [
    Spec("QCOM", "QCOM retired", 10000, 30, lifecycle="closed", seed=51, stop_days_ago=10),
    Spec("INTC", "INTC archived", 10000, 28, lifecycle="archived", seed=52, stop_days_ago=12),
]


def build_fleet_fixture(db: Session, user_id: str, n: int, now: Optional[datetime] = None) -> List[Bot]:
    now = now or datetime.now(timezone.utc)
    bots = [add_bot(db, user_id, s, now) for s in FLEETS[n]]
    if n == 12:
        for s in EXCLUDED_12:
            add_bot(db, user_id, s, now)
    db.commit()
    return bots
