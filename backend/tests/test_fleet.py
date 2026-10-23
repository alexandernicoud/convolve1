"""Fleet accounting: flows, reconciliation, staleness, drawdown, currency, ordering and isolation."""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.db import SessionLocal
from app.models import Bot, BotEquitySnapshot, BotTrade
from app.services.fleet import BotIn, TradeIn, build_fleet, infer_currency
from tests.conftest import mint_token
from tests.fleet_fixture_data import build_fleet_fixture

NOW = datetime(2026, 10, 22, 12, 0, tzinfo=timezone.utc)


def _bot(bid, cap, created, snaps, *, symbol="AAPL", lifecycle="active", status="running", trades=None, last_run=None):
    return BotIn(
        id=bid, name=bid, symbol=symbol, lifecycle=lifecycle, status=status, created_at=created,
        starting_capital=cap, snaps=snaps, trades=trades or [], last_run_at=last_run or NOW - timedelta(minutes=1),
        currency=infer_currency(symbol)[0], currency_source=infer_currency(symbol)[1],
    )


def _fleet(bots, rng="ALL"):
    return build_fleet(bots, now=NOW, rng=rng, poll_interval_s=60, excluded_lifecycle_counts={})


def _h(hours):
    return NOW - timedelta(hours=hours)


# ── pure accounting ──────────────────────────────────────────────────────────


def test_deployment_is_a_flow_not_a_return():
    a = _bot("a", 10_000, _h(48), [(_h(47), 10_000, 0), (_h(30), 10_000, 0), (_h(1), 10_000, 0)])
    b = _bot("b", 50_000, _h(24), [(_h(23), 50_000, 0), (_h(1), 50_000, 0)])
    out = _fleet([a, b])
    k = out["kpis"]
    assert k["equity"] == 60_000 and k["contributed_capital"] == 60_000
    assert k["net_pnl"] == 0 and k["twr"] == 0
    assert k["max_drawdown"]["value"] == 0
    s = out["series"]
    eq = [v for v in s["equity"] if v is not None]
    assert max(eq) - min(eq) == 50_000  # equity jumps on deployment …
    assert all(v == 0 for v in s["twr"] if v is not None)  # … but no return is produced
    assert all(v == 0 for v in s["net_pnl"] if v is not None)
    assert [d["pnl"] for d in out["daily"] if d["pnl"] is not None] == [0.0] * len([d for d in out["daily"] if d["pnl"] is not None])


def test_twr_chains_returns_across_a_deployment():
    # a: +10% before b arrives, then both flat; b arrives with 10k. TWR must stay +10%, not dilute.
    a = _bot("a", 10_000, _h(72), [(_h(71), 10_000, 0), (_h(50), 11_000, 1_000), (_h(2), 11_000, 1_000)])
    b = _bot("b", 10_000, _h(24), [(_h(23), 10_000, 0), (_h(2), 10_000, 0)])
    k = _fleet([a, b])["kpis"]
    assert k["twr"] == pytest.approx(0.10)
    assert k["net_pnl"] == pytest.approx(1_000)
    # simple return on contributed capital would show 5%; the time-weighted index is not diluted
    assert k["net_pnl"] / k["contributed_capital"] == pytest.approx(0.05)


def test_drawdown_uses_flow_adjusted_index():
    # a loses 20%, then a large deployment lifts equity above the old peak. True drawdown remains -20%.
    a = _bot("a", 10_000, _h(72), [(_h(71), 10_000, 0), (_h(60), 8_000, -2_000), (_h(1), 8_000, -2_000)])
    b = _bot("b", 100_000, _h(30), [(_h(29), 100_000, 0), (_h(1), 100_000, 0)])
    dd = _fleet([a, b])["kpis"]["max_drawdown"]
    assert dd["value"] == pytest.approx(-0.20)
    assert dd["recovered_at"] is None


def test_equity_and_pnl_reconcile():
    trades = [TradeIn("t1", "a", "lost", 1_000, 100, _h(40), True, _h(30), True, 98.9, -12.0, "stop_loss"),
              TradeIn("t2", "a", "open", 990, 101, _h(5), True)]
    a = _bot("a", 10_000, _h(48), [(_h(47), 10_000, 0), (_h(30), 9_988, -12), (_h(4), 9_995, -12)], trades=trades)
    out = _fleet([a])
    k = out["kpis"]
    assert k["equity"] == pytest.approx(k["contributed_capital"] + k["net_pnl"])
    assert k["net_pnl"] == pytest.approx(k["realized_pnl"] + k["unrealized_pnl"])
    assert k["realized_pnl"] == pytest.approx(k["realized_pnl_trades"])
    assert k["gross_exposure"]["open_notional"] == 990
    assert k["win_rate"] == {"value": 0.0, "wins": 0, "n": 1}
    b = out["bots"][0]
    assert b["net_pnl"] == pytest.approx(b["realized_pnl"] + b["unrealized_pnl"])


def test_paused_bot_keeps_capital_and_is_marked_stale():
    trades = [TradeIn("t", "p", "open", 800, 50, _h(80), True)]
    paused = _bot("p", 8_000, _h(200), [(_h(199), 8_000, 0), (_h(72), 8_040, 0)], lifecycle="paused", status="paused", trades=trades, last_run=_h(72))
    live = _bot("l", 10_000, _h(100), [(_h(99), 10_000, 0), (_h(1), 10_100, 100)])
    out = _fleet([paused, live])
    assert out["kpis"]["equity"] == pytest.approx(18_140)
    assert out["kpis"]["valuation_stale_bots"] == ["p"]
    row = next(b for b in out["bots"] if b["id"] == "p")
    assert row["valuation_stale"] is True and row["ops_stale"] is False
    assert out["health"]["counts"]["paused"] == 1
    assert out["series"]["stale_bots"][-1] == 1


def test_missing_snapshots_never_become_zero():
    a = _bot("a", 10_000, _h(24 * 10), [(_h(24 * 10 - 1), 10_000, 0), (_h(24 * 9), 10_050, 50), (_h(2), 10_050, 50)])
    late = _bot("late", 5_000, _h(24 * 3), [(_h(24 * 3 - 1), 5_000, 0), (_h(2), 5_100, 100)])
    out = _fleet([a, late])
    per_bot = out["series"]["bots_equity"]["late"]
    first_valid = next(i for i, v in enumerate(per_bot) if v is not None)
    assert first_valid > 0 and all(v is None for v in per_bot[:first_valid])
    assert 0 not in [v for v in per_bot if v is not None]
    gap_days = [d for d in out["daily"] if d["observations"] == 0]
    assert gap_days and all(d["pnl"] is None for d in gap_days)


def test_no_bots_returns_no_series():
    out = _fleet([])
    k = out["kpis"]
    assert "unavailable" not in k
    assert k["equity"] == 0 and k["contributed_capital"] == 0 and k["net_pnl"] == 0
    assert k["gross_exposure"] == {"value": 0.0, "open_notional": 0.0, "open_positions": 0}
    assert k["twr"] is None and k["max_drawdown"]["value"] is None and k["pnl_24h"]["value"] is None
    assert k["win_rate"]["value"] is None and k["win_rate"]["n"] == 0
    assert out["series"] == {} and out["daily"] == [] and out["bots"] == [] and out["contribution"] == []
    assert out["window"]["start"] < out["window"]["end"] and out["window"]["bucket_s"] > 0
    assert out["currency"]["base"] == "USD" and out["currency"]["excluded"] == []


def test_currencies_are_never_summed():
    usd = _bot("u", 10_000, _h(10), [(_h(9), 10_100, 100)], symbol="MSFT")
    eur = _bot("e", 9_000, _h(10), [(_h(9), 9_500, 500)], symbol="SAP.DE")
    unk = _bot("x", 7_000, _h(10), [(_h(9), 7_000, 0)], symbol="GC=F")
    out = _fleet([usd, eur, unk])
    assert out["currency"]["base"] == "USD"
    assert out["kpis"]["equity"] == 10_100
    reasons = {e["bot_id"]: e["reason"] for e in out["currency"]["excluded"]}
    assert set(reasons) == {"e", "x"}
    assert {b["id"]: b["in_aggregate"] for b in out["bots"]} == {"u": True, "e": False, "x": False}
    only_unknown = _fleet([unk])
    assert "unavailable" in only_unknown["kpis"]


@pytest.mark.parametrize(
    "symbol,ccy",
    [("AAPL", "USD"), ("BRK-B", "USD"), ("SAP.DE", "EUR"), ("VOD.L", "GBp"), ("EURUSD=X", "USD"), ("USDJPY=X", "JPY"),
     ("BTC-USD", "USD"), ("^GSPC", None), ("GC=F", None), ("weird!!", None)],
)
def test_infer_currency(symbol, ccy):
    assert infer_currency(symbol)[0] == ccy


def test_ranges_bucket_and_window():
    a = _bot("a", 10_000, _h(24 * 60), [(_h(24 * 60 - 1), 10_000, 0), (_h(1), 10_000, 0)])
    for rng, step in (("1D", 300), ("1W", 3600), ("1M", 14400)):
        out = _fleet([a], rng)
        assert out["window"]["bucket_s"] == step
        assert len(out["series"]["t"]) <= 400
    assert len(_fleet([a], "ALL")["series"]["t"]) <= 400


# ── database + API ───────────────────────────────────────────────────────────


def _auth(uid):
    return {"Authorization": f"Bearer {mint_token(uid)}"}


@pytest.mark.parametrize("n", [0, 1, 3, 12])
def test_fixture_fleets_reconcile(client, user_a, n):
    db = SessionLocal()
    try:
        build_fleet_fixture(db, str(user_a), n)
    finally:
        db.close()
    r = client.get("/api/dashboard/fleet?range=1W", headers=_auth(user_a))
    assert r.status_code == 200, r.text
    out = r.json()
    assert len(out["bots"]) == n
    if n == 0:
        assert out["series"] == {}
        return
    k = out["kpis"]
    inc = [b for b in out["bots"] if b["in_aggregate"]]
    assert k["equity"] == pytest.approx(sum(b["equity"] for b in inc), abs=1e-3)
    assert k["net_pnl"] == pytest.approx(sum(b["net_pnl"] for b in inc), abs=1e-3)
    assert k["realized_pnl"] == pytest.approx(k["realized_pnl_trades"], abs=1e-3)
    assert k["equity"] == pytest.approx(k["contributed_capital"] + k["net_pnl"], abs=1e-3)
    if n == 3:
        assert out["health"]["counts"]["error"] == 1
        assert out["health"]["counts"]["paused"] == 1
        assert out["kpis"]["valuation_stale_bots"]
        assert out["events"][0]["kind"] == "error" and out["events"][0]["severity"] == "critical"
    if n == 12:
        assert out["excluded_lifecycles"] == {"closed": 1, "archived": 1}
        assert [e["symbol"] for e in out["currency"]["excluded"]] == ["SAP.DE"]
        assert any("closed or archived" in s for s in out["limitations"])


def test_fleet_is_user_scoped(client, user_a, user_b):
    db = SessionLocal()
    try:
        build_fleet_fixture(db, str(user_a), 3)
    finally:
        db.close()
    assert client.get("/api/dashboard/fleet").status_code == 401
    other = client.get("/api/dashboard/fleet", headers=_auth(user_b)).json()
    assert other["bots"] == [] and other["series"] == {}
    mine = client.get("/api/dashboard/fleet", headers=_auth(user_a)).json()
    assert len(mine["bots"]) == 3


def test_range_is_validated(client, user_a):
    assert client.get("/api/dashboard/fleet?range=5Y", headers=_auth(user_a)).status_code == 422


def test_snapshots_ordered_and_bundle_returns_newest(client, user_a):
    db = SessionLocal()
    try:
        bot = Bot(id=str(uuid.uuid4()), user_id=str(user_a), name="ord", symbol="AAPL", model_path="m.pt",
                  starting_capital=10_000, lifecycle_state="active", created_at=datetime.now(timezone.utc) - timedelta(days=30))
        db.add(bot)
        base = datetime.now(timezone.utc) - timedelta(days=29)
        order = list(range(450))
        random.Random(3).shuffle(order)
        for i in order:  # inserted out of order
            db.add(BotEquitySnapshot(id=str(uuid.uuid4()), bot_id=bot.id, as_of=base + timedelta(hours=i),
                                     total_equity=10_000 + i, realized_pnl=float(i), unrealized_pnl=0.0))
        db.commit()
        bot_id = bot.id
    finally:
        db.close()
    bundle = client.get("/api/dashboard/bundle", headers=_auth(user_a)).json()
    pts = next(s for s in bundle["equity_by_bot"] if s["bot_id"] == bot_id)["points"]
    assert len(pts) == 400
    assert pts[-1]["total_equity"] == 10_449 and pts[0]["total_equity"] == 10_050
    assert [p["as_of"] for p in pts] == sorted(p["as_of"] for p in pts)
    fleet = client.get("/api/dashboard/fleet?range=ALL", headers=_auth(user_a)).json()
    row = next(b for b in fleet["bots"] if b["id"] == bot_id)
    assert row["equity"] == 10_449


def test_unified_win_rate_in_bundle(client, user_a):
    db = SessionLocal()
    try:
        bot = Bot(id=str(uuid.uuid4()), user_id=str(user_a), name="wr", symbol="AAPL", model_path="m.pt", starting_capital=10_000)
        db.add(bot)
        today = datetime.now(timezone.utc).date()
        for st, pnl in (("won", 5.0), ("lost", -3.0), ("expired", 1.0), ("expired", -1.0), ("open", None)):
            db.add(BotTrade(id=str(uuid.uuid4()), bot_id=bot.id, entry_date=today, entry_price=100, position_notional=1000,
                            horizon_days=5, expiry_date=today, status=st, pnl_amount=pnl, exit_date=today if pnl is not None else None))
        db.commit()
        from app.services.fleet_db import trade_win_rate_db
        assert trade_win_rate_db(db, [bot.id]) == (0.5, 2, 4)
    finally:
        db.close()
