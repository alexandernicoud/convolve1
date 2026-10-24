"""Scheduled paper bots: schedule, completed bars, execution claims, paper engine, job."""

from __future__ import annotations

import json
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from app import config
from app.db import SessionLocal
from app.models import Bot, BotRun, BotTrade
from app.services import bot_execution, bot_inference
from app.services.bot_execution import BotRunOutcome, execute_bot_run
from app.services.bot_schedule import completed_bars, is_due, latest_slot, next_slot
from tests.conftest import mint_token

NY = "America/New_York"
UTC = timezone.utc


def ny(day: str, hhmm: str = "00:00") -> datetime:
    return pd.Timestamp(f"{day} {hhmm}").tz_localize(NY).to_pydatetime().astimezone(UTC)


def frame(rows, tz=NY) -> pd.DataFrame:
    idx = pd.DatetimeIndex([pd.Timestamp(d).tz_localize(tz) for d, *_ in rows])
    data = [{"Open": o, "High": h, "Low": low, "Close": c, "Volume": 1000} for _, o, h, low, c in rows]
    return pd.DataFrame(data, index=idx)


# Warm-up history so the chart window is never empty; values are irrelevant to the trades.
WARMUP = [(d.strftime("%Y-%m-%d"), 100, 101, 99, 100) for d in pd.bdate_range("2026-05-01", "2026-05-29")]


class Feed:
    """Stands in for the market-data provider: returns whatever bars exist 'so far'."""

    def __init__(self):
        self.bars = frame(WARMUP)

    def set(self, rows):
        self.bars = frame(WARMUP + rows)

    def __call__(self, symbol, interval="1d", start=None):
        return self.bars.copy()


class Model:
    """Stands in for inference: returns a fixed probability, optionally failing or slow."""

    def __init__(self):
        self.prob = 0.9
        self.fail = 0
        self.delay = 0.0
        self.calls = 0

    def __call__(self, **kw):
        self.calls += 1
        if self.delay:
            time.sleep(self.delay)
        if self.fail:
            self.fail -= 1
            return bot_inference.BotInferenceResult(
                ok=False, signal="NO_BUY", confidence=None, chart_date=datetime.now(UTC), chart_path=None,
                heatmap_path=None, label_legacy="NEUTRAL", pnl_pct=None, error_message="model exploded", debug={},
            )
        buy = self.prob >= kw["confidence_threshold"]
        return bot_inference.BotInferenceResult(
            ok=True, signal="BUY" if buy else "NO_BUY", confidence=self.prob, chart_date=datetime.now(UTC),
            chart_path=None, heatmap_path=None, label_legacy="LONG" if buy else "NEUTRAL", pnl_pct=None,
            error_message=None, debug={"bars": len(kw["market_data"])},
        )


@pytest.fixture
def feed(monkeypatch):
    f = Feed()
    monkeypatch.setattr("app.bot_runner.fetch_market_data", f)
    return f


@pytest.fixture
def model(monkeypatch):
    m = Model()
    monkeypatch.setattr(bot_inference, "run_bot_inference", m)
    monkeypatch.setattr(bot_execution, "require_bot_model_file", lambda p: p)
    return m


@pytest.fixture
def make_bot():
    created: list[str] = []

    def _make(**kw):
        db = SessionLocal()
        try:
            fields = dict(
                id=str(uuid.uuid4()),
                user_id=str(uuid.uuid4()),
                symbol="TEST",
                model_path="/models/x.keras",
                confidence_threshold=0.5,
                img_size=64,
                tp_pct=2.0,
                sl_pct=2.0,
                run_time="22:00",
                timezone=NY,
                lifecycle_state="active",
                is_active=True,
                starting_capital=10_000.0,
                horizon_days=3,
                position_size_pct=50.0,
                commission_pct=0.1,
                slippage_pct=0.05,
                created_at=ny("2026-05-01"),
            )
            bot = Bot(**{**fields, **kw})
            db.add(bot)
            db.commit()
            created.append(bot.id)
            return bot.id
        finally:
            db.close()

    yield _make
    db = SessionLocal()
    try:
        for bot_id in created:
            bot = db.get(Bot, bot_id)
            if bot:
                db.delete(bot)
        db.commit()
    finally:
        db.close()


def run(bot_id: str, now: datetime, trigger="schedule"):
    db = SessionLocal()
    try:
        bot = db.get(Bot, bot_id)
        r, outcome = execute_bot_run(db, bot, trigger=trigger, now_utc=now)
        return r.id, outcome
    finally:
        db.close()


def rows(model_cls, bot_id: str):
    db = SessionLocal()
    try:
        return db.query(model_cls).filter(model_cls.bot_id == bot_id).all()
    finally:
        db.close()


# --- schedule -------------------------------------------------------------------------


def _sched(run_time="22:00", tz=NY, **kw):
    return SimpleNamespace(run_time=run_time, timezone=tz, lifecycle_state="active", **kw)


def test_daily_slot_keeps_wall_clock_across_dst():
    bot = _sched()
    before = latest_slot(bot, datetime(2026, 3, 8, 3, 30, tzinfo=UTC))  # Sat 7 Mar 22:00 EST
    after = latest_slot(bot, datetime(2026, 3, 9, 3, 30, tzinfo=UTC))  # Sun 8 Mar 22:00 EDT
    assert before == datetime(2026, 3, 8, 3, 0, tzinfo=UTC)
    assert after == datetime(2026, 3, 9, 2, 0, tzinfo=UTC)
    assert after - before == timedelta(hours=23)
    autumn = latest_slot(bot, datetime(2026, 11, 2, 4, 0, tzinfo=UTC))  # Sun 1 Nov 22:00 EST
    assert autumn == datetime(2026, 11, 2, 3, 0, tzinfo=UTC)


def test_nonexistent_and_ambiguous_local_times_give_one_slot_per_day():
    gap = _sched("02:30")
    assert latest_slot(gap, datetime(2026, 3, 8, 8, 0, tzinfo=UTC)) == datetime(2026, 3, 8, 7, 30, tzinfo=UTC)
    fold = _sched("01:30")
    assert latest_slot(fold, datetime(2026, 11, 1, 7, 0, tzinfo=UTC)) == datetime(2026, 11, 1, 5, 30, tzinfo=UTC)
    assert next_slot(fold, datetime(2026, 11, 1, 5, 30, tzinfo=UTC)) == datetime(2026, 11, 2, 6, 30, tzinfo=UTC)


def test_daily_bot_is_due_once_per_slot_not_every_tick():
    bot = _sched(created_at=ny("2026-05-01", "09:00"), last_slot_at=ny("2026-05-31", "22:00"), last_attempt_at=None)
    assert not is_due(bot, ny("2026-06-01", "21:59"))
    assert is_due(bot, ny("2026-06-01", "22:00"))
    bot.last_slot_at = ny("2026-06-01", "22:00")
    for minute in range(1, 120, 7):
        assert not is_due(bot, ny("2026-06-01", "22:00") + timedelta(minutes=minute))
    assert not is_due(bot, ny("2026-06-02", "21:59"))
    assert is_due(bot, ny("2026-06-02", "22:01"))


def test_new_bot_is_due_at_once_then_follows_its_schedule():
    bot = _sched(created_at=ny("2026-06-01", "23:00"), last_slot_at=None, last_attempt_at=None)
    assert is_due(bot, ny("2026-06-01", "23:01"))
    bot.last_attempt_at = ny("2026-06-01", "23:01")
    assert not is_due(bot, ny("2026-06-01", "23:05"))  # first run in flight or backing off
    bot.last_slot_at = latest_slot(bot, ny("2026-06-01", "23:01"))
    assert not is_due(bot, ny("2026-06-01", "23:30"))
    assert not is_due(bot, ny("2026-06-02", "21:59"))
    assert is_due(bot, ny("2026-06-02", "22:00"))
    assert next_slot(bot, ny("2026-06-01", "23:30")) == ny("2026-06-02", "22:00")


def test_failed_attempt_is_retried_only_after_backoff():
    bot = _sched(created_at=ny("2026-06-01"), last_slot_at=None, last_attempt_at=ny("2026-06-01", "22:01"))
    assert not is_due(bot, ny("2026-06-01", "22:10"))
    assert is_due(bot, ny("2026-06-01", "22:17"))


def test_paused_bot_is_never_due():
    bot = _sched(created_at=ny("2026-06-01"), last_slot_at=None, last_attempt_at=None)
    bot.lifecycle_state = "paused"
    assert not is_due(bot, ny("2026-06-02", "23:00"))


# --- completed bars ---------------------------------------------------------------------


def test_forming_daily_bar_is_dropped_until_after_the_close():
    bars = frame([("2026-06-01", 1, 1, 1, 1), ("2026-06-02", 1, 1, 1, 1), ("2026-06-03", 1, 1, 1, 1)])
    assert completed_bars(bars, "1d", ny("2026-06-03", "15:00")).index[-1].date().isoformat() == "2026-06-02"
    assert completed_bars(bars, "1d", ny("2026-06-03", "16:10")).index[-1].date().isoformat() == "2026-06-02"
    assert completed_bars(bars, "1d", ny("2026-06-03", "16:30")).index[-1].date().isoformat() == "2026-06-03"


def test_other_venues_and_timeframes():
    zurich = frame([("2026-06-02", 1, 1, 1, 1)], tz="Europe/Zurich")
    at = pd.Timestamp("2026-06-02 17:40").tz_localize("Europe/Zurich").to_pydatetime()
    assert completed_bars(zurich, "1d", at).empty
    assert len(completed_bars(zurich, "1d", at + timedelta(minutes=15))) == 1
    crypto = frame([("2026-06-02", 1, 1, 1, 1)], tz="UTC")
    assert completed_bars(crypto, "1d", datetime(2026, 6, 2, 23, 59, tzinfo=UTC)).empty
    assert len(completed_bars(crypto, "1d", datetime(2026, 6, 3, 0, 0, tzinfo=UTC))) == 1
    weekly = frame([("2026-06-01", 1, 1, 1, 1)])
    assert completed_bars(weekly, "1wk", ny("2026-06-05", "20:00")).empty
    assert len(completed_bars(weekly, "1wk", ny("2026-06-08", "00:00"))) == 1


# --- paper engine -------------------------------------------------------------------------


def test_buy_enters_at_next_open_never_on_the_signal_bar(feed, model, make_bot):
    bot_id = make_bot()
    # Signal bar: an enormous high that the old engine would have counted as a TP hit.
    feed.set([("2026-06-01", 100, 300, 99, 100)])
    run_id, outcome = run(bot_id, ny("2026-06-01", "22:00"))
    assert outcome == BotRunOutcome.CREATED_SUCCESS
    assert rows(BotTrade, bot_id) == []
    assert [r.entry_state for r in rows(BotRun, bot_id)] == ["pending"]

    feed.set([("2026-06-01", 100, 300, 99, 100), ("2026-06-02", 101, 104, 100.5, 103)])
    model.prob = 0.1
    run(bot_id, ny("2026-06-02", "22:00"))
    (trade,) = rows(BotTrade, bot_id)
    assert trade.entry_date.isoformat() == "2026-06-02"
    assert trade.entry_price == pytest.approx(101 * 1.0005)
    assert trade.tp_price == pytest.approx(101 * 1.02)
    assert trade.status == "won" and trade.exit_reason == "take_profit"
    assert trade.exit_price == pytest.approx(101 * 1.02 * 0.9995)
    ratio = trade.exit_price / trade.entry_price
    expected = 5000 * (ratio - 1) - 5000 * 0.001 - 5000 * ratio * 0.001
    assert trade.pnl_amount == pytest.approx(expected)
    assert trade.prediction_run_id == run_id


def test_same_bar_tp_and_sl_resolves_stop_first(feed, model, make_bot):
    bot_id = make_bot()
    feed.set([("2026-06-01", 100, 100, 100, 100)])
    run(bot_id, ny("2026-06-01", "22:00"))
    model.prob = 0.1
    feed.set([("2026-06-01", 100, 100, 100, 100), ("2026-06-02", 100, 103, 97, 100)])
    run(bot_id, ny("2026-06-02", "22:00"))
    (trade,) = rows(BotTrade, bot_id)
    assert trade.status == "lost" and trade.exit_reason == "stop_loss"
    assert "ambiguous_tp_sl_same_bar" in json.loads(trade.outcome_flags)


def test_gap_through_stop_fills_at_the_open(feed, model, make_bot):
    bot_id = make_bot()
    feed.set([("2026-06-01", 100, 100, 100, 100)])
    run(bot_id, ny("2026-06-01", "22:00"))
    model.prob = 0.1
    feed.set([("2026-06-01", 100, 100, 100, 100), ("2026-06-02", 100, 101, 99, 100), ("2026-06-03", 95, 96, 94, 95)])
    run(bot_id, ny("2026-06-03", "22:00"))
    (trade,) = rows(BotTrade, bot_id)
    assert trade.exit_reason == "stop_loss"
    assert trade.exit_price == pytest.approx(95 * 0.9995)
    assert "gap_through_stop" in json.loads(trade.outcome_flags)


def test_horizon_counts_bars_not_calendar_days(feed, model, make_bot):
    bot_id = make_bot()  # horizon 3 bars
    thu = [("2026-06-04", 100, 100, 100, 100)]
    feed.set(thu)
    run(bot_id, ny("2026-06-04", "22:00"))
    model.prob = 0.1
    quiet = [("2026-06-05", 100, 101, 99.5, 100), ("2026-06-08", 100, 101, 99.5, 100.5)]
    feed.set(thu + quiet)
    run(bot_id, ny("2026-06-08", "22:00"))  # Fri + Mon: two bars, five calendar days
    (trade,) = rows(BotTrade, bot_id)
    assert trade.status == "open" and trade.bars_held == 2
    feed.set(thu + quiet + [("2026-06-09", 100.5, 101, 99.5, 100.8)])
    run(bot_id, ny("2026-06-09", "22:00"))
    (trade,) = rows(BotTrade, bot_id)
    assert trade.status == "expired" and trade.exit_reason == "horizon_expired"
    assert trade.exit_date.isoformat() == "2026-06-09" and trade.bars_held == 3
    assert trade.exit_price == pytest.approx(100.8 * 0.9995)


def test_buy_while_position_open_is_recorded_not_traded(feed, model, make_bot):
    bot_id = make_bot(horizon_days=10)
    days = [("2026-06-01", 100, 100, 100, 100)]
    feed.set(days)
    run(bot_id, ny("2026-06-01", "22:00"))
    for d in ("2026-06-02", "2026-06-03"):
        days.append((d, 100, 101, 99.5, 100))
        feed.set(days)
        run(bot_id, ny(d, "22:00"))
    states = sorted(r.entry_state for r in rows(BotRun, bot_id))
    assert states == ["filled", "skipped_position_open", "skipped_position_open"]
    assert len(rows(BotTrade, bot_id)) == 1


# --- one execution per bar ----------------------------------------------------------------


def test_same_bar_executes_once(feed, model, make_bot):
    bot_id = make_bot()
    feed.set([("2026-06-01", 100, 100, 100, 100)])
    first, o1 = run(bot_id, ny("2026-06-01", "22:00"))
    second, o2 = run(bot_id, ny("2026-06-01", "22:05"), trigger="manual")
    assert o1 == BotRunOutcome.CREATED_SUCCESS and o2 == BotRunOutcome.SKIPPED_ALREADY_RAN
    assert first == second and model.calls == 1
    (r,) = rows(BotRun, bot_id)
    assert r.execution_key == "1d:2026-06-01" and r.trigger == "schedule"


def test_concurrent_workers_execute_a_bar_once(feed, model, make_bot):
    bot_id = make_bot()
    feed.set([("2026-06-01", 100, 100, 100, 100)])
    model.delay = 0.2
    outcomes, errors = [], []

    def worker():
        try:
            outcomes.append(run(bot_id, ny("2026-06-01", "22:00"))[1])
        except Exception as exc:  # pragma: no cover - surfaced below
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    assert outcomes.count(BotRunOutcome.CREATED_SUCCESS) == 1
    assert len(rows(BotRun, bot_id)) == 1 and model.calls == 1


def test_failed_execution_is_retried_with_a_limit(feed, model, make_bot):
    bot_id = make_bot()
    feed.set([("2026-06-01", 100, 100, 100, 100)])
    model.fail = 5
    outcomes = [run(bot_id, ny("2026-06-01", "22:00") + timedelta(minutes=i))[1] for i in range(4)]
    assert outcomes[:3] == [BotRunOutcome.CREATED_ERROR] * 3
    assert outcomes[3] == BotRunOutcome.SKIPPED_ALREADY_RAN
    (r,) = rows(BotRun, bot_id)
    assert r.attempts == 3 and r.status == "error"


def test_crashed_worker_claim_is_taken_over_after_stale_window(feed, model, make_bot):
    bot_id = make_bot()
    feed.set([("2026-06-01", 100, 100, 100, 100)])
    started = ny("2026-06-01", "22:00")
    db = SessionLocal()
    db.add(BotRun(id=str(uuid.uuid4()), bot_id=bot_id, run_at=started, run_started_at=started, status="running",
                  execution_key="1d:2026-06-01", attempts=1, trigger="schedule"))
    db.commit()
    db.close()
    assert run(bot_id, started + timedelta(minutes=5))[1] == BotRunOutcome.SKIPPED_IN_PROGRESS
    assert run(bot_id, started + timedelta(minutes=20))[1] == BotRunOutcome.CREATED_SUCCESS
    (r,) = rows(BotRun, bot_id)
    assert r.attempts == 2 and r.status == "success"


def test_retried_run_does_not_fill_a_signal_twice(feed, model, make_bot):
    bot_id = make_bot()
    feed.set([("2026-06-01", 100, 100, 100, 100)])
    run(bot_id, ny("2026-06-01", "22:00"))
    feed.set([("2026-06-01", 100, 100, 100, 100), ("2026-06-02", 100, 101, 99.5, 100)])
    model.prob, model.fail = 0.1, 1
    assert run(bot_id, ny("2026-06-02", "22:00"))[1] == BotRunOutcome.CREATED_ERROR
    assert run(bot_id, ny("2026-06-02", "22:20"))[1] == BotRunOutcome.CREATED_SUCCESS
    assert len(rows(BotTrade, bot_id)) == 1


# --- scheduled job ------------------------------------------------------------------------


@pytest.fixture
def job(monkeypatch):
    from app.jobs import run_due_bots

    monkeypatch.setattr(config, "LIVE_DEPLOY_ENABLED", True)
    monkeypatch.setattr(config, "SCHEDULED_BOTS_ENABLED", True)
    monkeypatch.setattr(config, "AUTH_REQUIRED", False)

    def _run(user_id: str, now: datetime):
        monkeypatch.setattr(config, "USER_ID", user_id)
        return run_due_bots.run_due_bots_once(now)

    return _run


def test_job_runs_a_daily_bot_once_per_day_and_skips_closed_markets(feed, model, make_bot, job):
    owner = str(uuid.uuid4())
    bot_id = make_bot(user_id=owner, created_at=ny("2026-06-01", "09:00"), last_slot_at=ny("2026-06-04", "22:00"))
    week = [("2026-06-05", 100, 100, 100, 100)]  # Friday
    feed.set(week)
    assert job(owner, ny("2026-06-05", "21:00"))["due"] == 0
    assert job(owner, ny("2026-06-05", "22:01"))["success"] == 1
    for minute in (2, 3, 10, 60):
        s = job(owner, ny("2026-06-05", "22:00") + timedelta(minutes=minute))
        assert s["due"] == 0 and s["skipped_schedule"] == 1
    sat = job(owner, ny("2026-06-06", "22:01"))  # market closed: no new bar
    assert sat["due"] == 1 and sat["no_new_data"] == 1 and sat["success"] == 0
    assert job(owner, ny("2026-06-06", "22:30"))["due"] == 0
    feed.set(week + [("2026-06-08", 100, 101, 99.5, 100)])
    assert job(owner, ny("2026-06-08", "22:01"))["success"] == 1
    keys = sorted(r.execution_key for r in rows(BotRun, bot_id))
    assert keys == ["1d:2026-06-05", "1d:2026-06-08"]


def test_newly_deployed_bot_runs_on_the_next_job_execution(feed, model, make_bot, job):
    owner = str(uuid.uuid4())
    bot_id = make_bot(user_id=owner, created_at=ny("2026-06-05", "18:00"))
    feed.set([("2026-06-04", 100, 100, 100, 100), ("2026-06-05", 100, 100, 100, 100)])
    first = job(owner, ny("2026-06-05", "18:02"))  # before today's 22:00 slot
    assert first["due"] == 1 and first["success"] == 1
    assert job(owner, ny("2026-06-05", "18:15"))["due"] == 0
    tonight = job(owner, ny("2026-06-05", "22:01"))  # same completed bar: recorded, not re-run
    assert tonight["due"] == 1 and tonight["no_new_data"] == 1
    (r,) = rows(BotRun, bot_id)
    assert r.execution_key == "1d:2026-06-05" and r.status == "success"


def test_deploy_requests_a_job_execution_instead_of_running_in_the_request(monkeypatch):
    from app.services import bot_jobs

    calls = []

    class Resp:
        status_code = 200
        text = ""

    class Session:
        def __init__(self, creds):
            pass

        def post(self, url, json, timeout):
            calls.append(url)
            return Resp()

    import google.auth
    import google.auth.transport.requests as gtr

    monkeypatch.setattr(google.auth, "default", lambda scopes: (object(), "p"))
    monkeypatch.setattr(gtr, "AuthorizedSession", Session)
    monkeypatch.setattr(config, "LIVE_DEPLOY_ENABLED", True)
    monkeypatch.setattr(config, "SCHEDULED_BOTS_ENABLED", True)
    monkeypatch.setattr(config, "BOT_JOB_NAME", "")
    assert bot_jobs.request_batch() is False and calls == []
    monkeypatch.setattr(config, "BOT_JOB_NAME", "convolve-run-due-bots")
    monkeypatch.setattr(config, "BOT_JOB_PROJECT", "proj")
    monkeypatch.setattr(config, "BOT_JOB_REGION", "europe-west6")
    assert bot_jobs.request_batch() is True
    assert calls == ["https://run.googleapis.com/v2/projects/proj/locations/europe-west6/jobs/convolve-run-due-bots:run"]
    monkeypatch.setattr(config, "SCHEDULED_BOTS_ENABLED", False)
    assert bot_jobs.request_batch() is False and len(calls) == 1


def test_job_retries_missing_data_without_marking_the_slot(feed, model, make_bot, job):
    owner = str(uuid.uuid4())
    bot_id = make_bot(user_id=owner)
    feed.bars = feed.bars.iloc[0:0]
    s = job(owner, ny("2026-06-05", "22:01"))
    assert s["error"] == 1
    db = SessionLocal()
    bot = db.get(Bot, bot_id)
    assert bot.last_slot_at is None and "No market data" in bot.last_error
    db.close()
    feed.set([("2026-06-05", 100, 100, 100, 100)])
    assert job(owner, ny("2026-06-05", "22:05"))["due"] == 0  # backoff
    assert job(owner, ny("2026-06-05", "22:20"))["success"] == 1


def test_job_catches_up_once_on_the_latest_missed_slot(feed, model, make_bot, job):
    owner = str(uuid.uuid4())
    bot_id = make_bot(user_id=owner, created_at=ny("2026-06-01", "09:00"))
    feed.set([("2026-06-01", 100, 100, 100, 100), ("2026-06-02", 100, 100, 100, 100), ("2026-06-03", 100, 100, 100, 100)])
    assert job(owner, ny("2026-06-04", "12:00"))["success"] == 1  # outage covered three slots
    assert job(owner, ny("2026-06-04", "12:05"))["due"] == 0
    (r,) = rows(BotRun, bot_id)
    assert r.execution_key == "1d:2026-06-03"


def test_job_is_a_no_op_when_disabled(monkeypatch, make_bot):
    from app.jobs import run_due_bots

    monkeypatch.setattr(config, "SCHEDULED_BOTS_ENABLED", False)
    assert run_due_bots.run_due_bots_once(ny("2026-06-05", "22:01"))["candidates"] == 0


# --- inference adapter --------------------------------------------------------------------


def test_bot_inference_reads_softmax_column_one(tmp_path):
    tf = pytest.importorskip("tensorflow")
    from PIL import Image

    from app.bot_runner import run_model_inference

    path = tmp_path / "c.png"
    Image.new("RGB", (32, 32), (10, 200, 30)).save(path)

    class TwoUnit:
        input_shape = (None, 16, 16, 3)
        output_shape = (None, 2)

        def __call__(self, x, training=False):
            assert tuple(x.shape) == (1, 16, 16, 3)
            return tf.constant([[0.9, 0.1]])

    class OneUnit(TwoUnit):
        output_shape = (None, 1)

        def __call__(self, x, training=False):
            return tf.constant([[0.3]])

    assert run_model_inference(TwoUnit(), str(path), 224) == pytest.approx(0.1)
    assert run_model_inference(OneUnit(), str(path)) == pytest.approx(0.3)


# --- API ----------------------------------------------------------------------------------


def _h(uid) -> dict:
    return {"Authorization": f"Bearer {mint_token(uid)}"}


def test_manual_run_is_owner_only_and_idempotent(client, monkeypatch, feed, model, make_bot, user_a, user_b):
    monkeypatch.setattr("app.bots_api.LIVE_DEPLOY_ENABLED", True)
    client.get("/api/account", headers=_h(user_a))
    bot_id = make_bot(user_id=str(user_a))
    feed.set([("2026-06-01", 100, 100, 100, 100)])
    assert client.post(f"/api/bots/{bot_id}/run", headers=_h(user_b)).status_code == 404
    first = client.post(f"/api/bots/{bot_id}/run", headers=_h(user_a)).json()
    second = client.post(f"/api/bots/{bot_id}/run", headers=_h(user_a)).json()
    assert first["outcome"] == "created_success" and first["trigger"] == "manual"
    assert second["outcome"] == "skipped_already_ran" and second["id"] == first["id"]
    detail = client.get(f"/api/bots/{bot_id}", headers=_h(user_a)).json()["bot"]
    assert detail["execution_assumptions"]["entry"].startswith("open of the next bar")
    assert client.get(f"/api/bots/{bot_id}", headers=_h(user_b)).status_code == 404


def test_create_rejects_invalid_configuration(client, user_a):
    form = {"symbol": "AAPL", "tp_pct": "2", "sl_pct": "150", "run_time": "22:00", "timezone": "Mars/Base", "timeframe": "5m"}
    r = client.post("/api/bots", data=form, headers=_h(user_a))
    assert r.status_code == 400
    detail = r.json()["detail"].lower()
    assert "stop loss" in detail and "timezone" in detail and "timeframe" in detail


def test_stop_closes_at_the_latest_completed_close(client, monkeypatch, feed, model, make_bot, user_a):
    monkeypatch.setattr("app.bots_api.LIVE_DEPLOY_ENABLED", True)
    bot_id = make_bot(user_id=str(user_a), horizon_days=10)
    feed.set([("2026-06-01", 100, 100, 100, 100)])
    run(bot_id, ny("2026-06-01", "22:00"))
    feed.set([("2026-06-01", 100, 100, 100, 100), ("2026-06-02", 100, 101, 99.5, 100.5)])
    model.prob = 0.1
    run(bot_id, ny("2026-06-02", "22:00"))
    r = client.post(f"/api/bots/{bot_id}/close", headers=_h(user_a))
    assert r.status_code == 200, r.text
    (trade,) = rows(BotTrade, bot_id)
    assert trade.status == "closed" and trade.exit_reason == "manual"
    assert trade.exit_price == pytest.approx(100.5 * 0.9995)
    assert r.json()["bot"]["lifecycle_state"] == "closed"


def test_trading_detail_marks_open_positions_with_engine_costs(client, feed, model, make_bot, user_a):
    bot_id = make_bot(user_id=str(user_a), horizon_days=10)
    feed.set([("2026-06-01", 100, 100, 100, 100)])
    run(bot_id, ny("2026-06-01", "22:00"))
    feed.set([("2026-06-01", 100, 100, 100, 100), ("2026-06-02", 100, 101, 99.5, 101)])
    model.prob = 0.1
    run(bot_id, ny("2026-06-02", "22:00"))
    body = client.get(f"/api/bots/{bot_id}/trading", headers=_h(user_a)).json()
    (open_row,) = body["open_trades_detail"]
    ratio = 101 * 0.9995 / (100 * 1.0005)
    assert open_row["unrealized_pnl"] == pytest.approx(5000 * (ratio - 1) - 5 - 5000 * ratio * 0.001)
    assert np.isfinite(body["performance"]["current_equity"])
