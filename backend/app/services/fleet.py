"""Fleet accounting for the currently deployed bots (read-only).

Every deployed bot is an independent paper sub-account: it owns its starting capital and its positions.
The fleet is the sum of those sub-accounts. Nothing here writes to the database or fetches market data.

Definitions (also returned to the client in ``DEFINITIONS``):

- Equity of a bot at time t: its last equity snapshot at or before t. Before the first snapshot the bot
  holds exactly its starting capital, because positions can only be opened inside a run and every run
  records a snapshot. Before deployment the bot does not exist (no value, never zero).
- Contributed capital: sum of starting capital of bots deployed at or before t. A deployment is an
  external capital flow, never trading profit.
- Net P&L = equity - contributed capital = realized + unrealized.
- Time-weighted return: chain-linked over consecutive valuation events, with flows placed at the start
  of the interval in which they occur: r = E(t) / (E(t-1) + F) - 1. A deployment therefore produces no return.
- Drawdown: peak-to-trough decline of the time-weighted index (running peak), so capital flows cannot
  hide or create drawdowns.
"""

from __future__ import annotations

import re
from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Optional, Sequence, Tuple

FLEET_LIFECYCLES = ("active", "paused", "expired")
CLOSED_TRADE_STATUSES = ("won", "lost", "expired", "closed")
RANGES: Dict[str, Tuple[Optional[timedelta], Optional[int]]] = {
    "1D": (timedelta(days=1), 300),
    "1W": (timedelta(days=7), 3600),
    "1M": (timedelta(days=30), 4 * 3600),
    "ALL": (None, None),
}
ALL_BUCKET_CHOICES = (300, 3600, 4 * 3600, 86400, 7 * 86400)
MAX_BUCKETS = 400
ACTIVITY_WINDOW = timedelta(hours=24)
ACTIVITY_BUCKET_S = 900
DAILY_MAX_DAYS = 45
EVENT_LIMIT = 40
ERROR_LOOKBACK = timedelta(days=7)
PAPER_WALLET_CURRENCY = "USD"

DEFINITIONS = {
    "equity": "Sum of each bot's latest valuation. Before its first run a bot holds exactly its starting capital.",
    "contributed_capital": "Sum of starting capital of deployed bots. Deployments are capital flows, not profit.",
    "net_pnl": "Equity minus contributed capital (= realized + unrealized).",
    "realized_pnl": "Net P&L of closed trades after commission; slippage is inside the fill prices.",
    "unrealized_pnl": "Open positions marked at the last bar close, after exit slippage and round-trip commission (liquidation basis).",
    "twr": "Time-weighted return: chain-linked across valuations with deployment flows removed.",
    "max_drawdown": "Largest peak-to-trough decline of the time-weighted index (running peak).",
    "pnl_24h": "Change in net P&L over the last 24 hours (deployments excluded).",
    "gross_exposure": "Open position notional at entry divided by fleet equity.",
    "win_rate": "Closed trades with net P&L > 0 divided by all closed trades (TP, SL, expiry and manual exits).",
    "error": "A bot is in error when its most recent analysis failed.",
    "valuation_stale": "Open positions whose last valuation is older than the freshness limit, or that belong to a paused bot (paused bots are not marked to market).",
    "ops_stale": "An active bot whose last analysis is older than the freshness limit.",
    "daily_pnl": "Change in fleet net P&L per UTC day. Days without any valuation have no value.",
}


# ── currency ─────────────────────────────────────────────────────────────────

_SUFFIX_CCY = {
    ".L": "GBp", ".DE": "EUR", ".F": "EUR", ".PA": "EUR", ".AS": "EUR", ".MI": "EUR", ".MC": "EUR",
    ".BR": "EUR", ".VI": "EUR", ".LS": "EUR", ".HE": "EUR", ".IR": "EUR", ".SW": "CHF", ".TO": "CAD",
    ".V": "CAD", ".AX": "AUD", ".NZ": "NZD", ".T": "JPY", ".HK": "HKD", ".SS": "CNY", ".SZ": "CNY",
    ".KS": "KRW", ".NS": "INR", ".BO": "INR", ".ST": "SEK", ".OL": "NOK", ".CO": "DKK", ".SA": "BRL",
}
_FX_RE = re.compile(r"^([A-Z]{3})([A-Z]{3})=X$")
_CRYPTO_RE = re.compile(r"^[A-Z0-9]{2,10}-([A-Z]{3})$")
_US_RE = re.compile(r"^[A-Z]{1,5}([.-][A-Z])?$")


def infer_currency(symbol: Optional[str]) -> Tuple[Optional[str], str]:
    """Quote currency from the ticker format. The deploy flow does not record a currency, so this is
    an inference from listing conventions; unknown formats return ``None`` and are never assumed USD."""
    s = (symbol or "").strip().upper()
    if not s:
        return None, "unknown"
    if s.startswith("^"):
        return None, "index_level"
    if s.endswith("=F"):
        return None, "futures_contract"
    m = _FX_RE.match(s)
    if m:
        return m.group(2), "fx_pair_quote"
    m = _CRYPTO_RE.match(s)
    if m:
        return m.group(1), "crypto_pair_quote"
    for suffix, ccy in _SUFFIX_CCY.items():
        if s.endswith(suffix) and len(s) > len(suffix):
            return ccy, f"exchange_suffix{suffix}"
    if _US_RE.match(s):
        return "USD", "us_listing_format"
    return None, "unknown"


# ── inputs ───────────────────────────────────────────────────────────────────


@dataclass
class TradeIn:
    id: str
    bot_id: str
    status: str
    notional: float
    entry_price: float
    opened_at: datetime
    opened_precise: bool
    closed_at: Optional[datetime] = None
    closed_precise: bool = True
    exit_price: Optional[float] = None
    pnl: Optional[float] = None
    exit_reason: Optional[str] = None


@dataclass
class RunIn:
    at: datetime
    status: str
    signal: Optional[str] = None
    error: Optional[str] = None


@dataclass
class BotIn:
    id: str
    name: Optional[str]
    symbol: str
    lifecycle: str
    status: str
    created_at: datetime
    starting_capital: float
    commission_pct: float = 0.0
    slippage_pct: float = 0.0
    snaps: List[Tuple[datetime, float, float]] = field(default_factory=list)  # (as_of, equity, realized), ascending
    trades: List[TradeIn] = field(default_factory=list)
    runs_recent: List[RunIn] = field(default_factory=list)  # within the activity window, ascending
    last_run_at: Optional[datetime] = None
    last_run_before_window: Optional[datetime] = None
    errors_recent: List[RunIn] = field(default_factory=list)
    last_error: Optional[str] = None
    next_run_at: Optional[str] = None
    source_backtest_run_id: Optional[str] = None
    currency: Optional[str] = None
    currency_source: str = "unknown"


# ── per-bot valuation timeline ───────────────────────────────────────────────


class Timeline:
    """Step function of one bot's (equity, realized) with redundant repeated snapshots collapsed."""

    def __init__(self, bot: BotIn):
        self.bot = bot
        self.raw_times = [s[0] for s in bot.snaps]
        times: List[datetime] = []
        eq: List[float] = []
        re_: List[float] = []
        for t, e, r in bot.snaps:
            if eq and abs(eq[-1] - e) < 1e-9 and abs(re_[-1] - r) < 1e-9:
                continue
            times.append(t)
            eq.append(float(e))
            re_.append(float(r))
        self.times, self.equity, self.realized = times, eq, re_

    def value_at(self, t: datetime) -> Optional[Tuple[float, float]]:
        if t < self.bot.created_at:
            return None
        i = bisect_right(self.times, t) - 1
        if i < 0:
            return float(self.bot.starting_capital), 0.0
        return self.equity[i], self.realized[i]

    def last_mark_at(self, t: datetime) -> Optional[datetime]:
        i = bisect_right(self.raw_times, t) - 1
        return self.raw_times[i] if i >= 0 else None

    def obs_between(self, a: datetime, b: datetime) -> int:
        return bisect_right(self.raw_times, b) - bisect_right(self.raw_times, a)


def open_notional_at(trades: Sequence[TradeIn], t: datetime) -> Tuple[float, int]:
    total, n = 0.0, 0
    for tr in trades:
        if tr.opened_at <= t and (tr.closed_at is None or tr.closed_at > t):
            total += tr.notional
            n += 1
    return total, n


# ── fleet path over valuation events ─────────────────────────────────────────


@dataclass
class FleetPath:
    times: List[datetime]
    equity: List[float]
    contributed: List[float]
    realized: List[float]
    index: List[float]
    drawdown: List[float]


def fleet_path(timelines: Sequence[Timeline]) -> FleetPath:
    events = sorted({tl.bot.created_at for tl in timelines} | {t for tl in timelines for t in tl.times})
    out = FleetPath([], [], [], [], [], [])
    idx, peak = 1.0, 1.0
    prev_e: Optional[float] = None
    prev_c = 0.0
    for t in events:
        e_sum = c_sum = r_sum = 0.0
        present = False
        for tl in timelines:
            v = tl.value_at(t)
            if v is None:
                continue
            present = True
            e_sum += v[0]
            r_sum += v[1]
            c_sum += float(tl.bot.starting_capital)
        if not present:
            continue
        flow = c_sum - prev_c
        if prev_e is not None and prev_e + flow > 0:
            idx *= e_sum / (prev_e + flow)
        peak = max(peak, idx)
        out.times.append(t)
        out.equity.append(e_sum)
        out.contributed.append(c_sum)
        out.realized.append(r_sum)
        out.index.append(idx)
        out.drawdown.append(idx / peak - 1.0 if peak > 0 else 0.0)
        prev_e, prev_c = e_sum, c_sum
    return out


def state_at(path: FleetPath, t: datetime) -> Optional[int]:
    i = bisect_right(path.times, t) - 1
    return i if i >= 0 else None


def max_drawdown(path: FleetPath) -> Dict[str, object]:
    if len(path.index) < 2:
        return {"value": None, "unavailable": "Needs at least two valuations."}
    peak, peak_t = path.index[0], path.times[0]
    worst, w_peak_t, w_trough_t, w_peak = 0.0, None, None, None
    for t, v in zip(path.times, path.index):
        if v > peak:
            peak, peak_t = v, t
        dd = v / peak - 1.0
        if dd < worst:
            worst, w_peak_t, w_trough_t, w_peak = dd, peak_t, t, peak
    recovered = None
    if w_trough_t is not None:
        for t, v in zip(path.times, path.index):
            if t > w_trough_t and v >= (w_peak or 0):
                recovered = t
                break
    return {"value": worst, "peak_at": _iso(w_peak_t), "trough_at": _iso(w_trough_t), "recovered_at": _iso(recovered)}


# ── helpers ──────────────────────────────────────────────────────────────────


def _iso(t: Optional[datetime]) -> Optional[str]:
    return t.isoformat() if t is not None else None


def _r(v: Optional[float], nd: int = 6) -> Optional[float]:
    return None if v is None else round(float(v), nd)


def trade_win_rate(trades: Sequence[TradeIn]) -> Dict[str, object]:
    closed = [t for t in trades if t.status in CLOSED_TRADE_STATUSES and t.pnl is not None]
    wins = sum(1 for t in closed if (t.pnl or 0) > 0)
    return {"value": (wins / len(closed)) if closed else None, "wins": wins, "n": len(closed)}


def trade_costs(bot: BotIn, trades: Sequence[TradeIn]) -> Dict[str, float]:
    """Exact cost split for closed trades from fill prices and the bot's (immutable) cost settings."""
    s = bot.slippage_pct / 100.0
    gross = commission = slippage = 0.0
    for t in trades:
        if t.status not in CLOSED_TRADE_STATUSES or t.exit_price is None or t.entry_price <= 0:
            continue
        qty = t.notional / t.entry_price
        raw_entry = t.entry_price / (1 + s)
        raw_exit = t.exit_price / (1 - s) if s < 1 else t.exit_price
        gross += qty * (raw_exit - raw_entry)
        slippage += qty * (t.entry_price - raw_entry) + qty * (raw_exit - t.exit_price)
        commission += t.notional * (bot.commission_pct / 100.0) * 2.0
    return {"gross_price_move": gross, "slippage": slippage, "commission": commission}


def choose_bucket(start: datetime, end: datetime, rng: str) -> int:
    fixed = RANGES[rng][1]
    if fixed:
        return fixed
    span = max(1.0, (end - start).total_seconds())
    for b in ALL_BUCKET_CHOICES:
        if span / b <= MAX_BUCKETS:
            return b
    return ALL_BUCKET_CHOICES[-1]


def _floor(t: datetime, step: int) -> datetime:
    ts = int(t.timestamp())
    return datetime.fromtimestamp(ts - ts % step, tz=timezone.utc)


# ── main aggregation ─────────────────────────────────────────────────────────


def build_fleet(
    bots: Sequence[BotIn],
    *,
    now: datetime,
    rng: str,
    poll_interval_s: int,
    excluded_lifecycle_counts: Dict[str, int],
) -> Dict[str, object]:
    stale_after_s = max(3 * int(poll_interval_s), 300)
    stale_after = timedelta(seconds=stale_after_s)

    # Currency coverage: aggregate only the currency holding the most capital; never convert.
    by_ccy: Dict[str, float] = {}
    for b in bots:
        if b.currency:
            by_ccy[b.currency] = by_ccy.get(b.currency, 0.0) + float(b.starting_capital)
    base = max(by_ccy.items(), key=lambda kv: kv[1])[0] if by_ccy else None
    included = [b for b in bots if base is not None and b.currency == base]
    inc_ids = {b.id for b in included}
    excluded = [
        {
            "bot_id": b.id,
            "symbol": b.symbol,
            "currency": b.currency,
            "reason": "Quote currency could not be determined from the symbol." if not b.currency else f"{b.currency} cannot be converted to {base}; no FX source is configured.",
        }
        for b in bots
        if b.id not in inc_ids
    ]

    tls = {b.id: Timeline(b) for b in bots}
    inc_tls = [tls[b.id] for b in included]
    path = fleet_path(inc_tls)
    limitations: List[str] = [
        "Quote currency is inferred from the ticker format; it is not recorded when a bot is deployed.",
        "Pause and resume times are not recorded, so paused periods cannot be drawn historically.",
    ]
    n_excl = sum(excluded_lifecycle_counts.values())
    if n_excl:
        limitations.append(
            f"{n_excl} closed or archived bot{'s' if n_excl != 1 else ''} excluded: closure times are not recorded, so their "
            "historical contribution and withdrawal cannot be separated reliably. Their records are unchanged."
        )
    if excluded:
        limitations.append(f"{len(excluded)} bot{'s' if len(excluded) != 1 else ''} excluded from monetary aggregates (currency).")

    # ── per-bot current state ──
    bot_rows: List[Dict[str, object]] = []
    imprecise = False
    for b in bots:
        tl = tls[b.id]
        v = tl.value_at(now) or (float(b.starting_capital), 0.0)
        equity, realized = v
        unrealized = equity - b.starting_capital - realized
        open_trades = [t for t in b.trades if t.status == "open"]
        open_notional = sum(t.notional for t in open_trades)
        last_mark = tl.last_mark_at(now)
        mark_age = (now - last_mark).total_seconds() if last_mark else None
        valuation_stale = bool(open_trades) and (
            b.lifecycle != "active" or mark_age is None or mark_age > stale_after_s
        )
        run_age = (now - b.last_run_at).total_seconds() if b.last_run_at else None
        ops_stale = b.lifecycle == "active" and (run_age is None or run_age > stale_after_s) and now - b.created_at > stale_after
        imprecise = imprecise or any(not t.opened_precise or (t.closed_at and not t.closed_precise) for t in b.trades)
        wr = trade_win_rate(b.trades)
        bot_rows.append(
            {
                "id": b.id,
                "name": b.name or b.symbol,
                "symbol": b.symbol,
                "lifecycle": b.lifecycle,
                "status": b.status,
                "currency": b.currency,
                "currency_source": b.currency_source,
                "in_aggregate": b.id in inc_ids,
                "deployed_at": _iso(b.created_at),
                "starting_capital": _r(b.starting_capital, 4),
                "equity": _r(equity, 4),
                "realized_pnl": _r(realized, 4),
                "unrealized_pnl": _r(unrealized, 4),
                "net_pnl": _r(equity - b.starting_capital, 4),
                "return": _r((equity - b.starting_capital) / b.starting_capital, 8) if b.starting_capital > 0 else None,
                "open_positions": [
                    {"id": t.id, "notional": _r(t.notional, 4), "entry_price": _r(t.entry_price, 6), "opened_at": _iso(t.opened_at), "opened_precise": t.opened_precise}
                    for t in open_trades
                ],
                "open_notional": _r(open_notional, 4),
                "exposure": _r(open_notional / equity, 8) if equity > 0 else None,
                "last_mark_at": _iso(last_mark),
                "mark_age_s": _r(mark_age, 1),
                "valuation_stale": valuation_stale,
                "ops_stale": ops_stale,
                "last_run_at": _iso(b.last_run_at),
                "next_run_at": b.next_run_at,
                "last_error": b.last_error if b.status == "error" else None,
                "win_rate": wr,
                "costs": {k: _r(x, 4) for k, x in trade_costs(b, b.trades).items()},
                "backtest_ref": b.source_backtest_run_id,
            }
        )

    if imprecise:
        limitations.append("Some trade times fall back to the market-bar date because the linked analysis run is missing.")

    # ── KPIs ──
    kpis: Dict[str, object]
    if not bots:
        # Zero deployed bots: current-state quantities are genuinely zero; anything that needs history is unavailable.
        no_history = "No valuation history."
        kpis = {
            "equity": 0.0,
            "contributed_capital": 0.0,
            "net_pnl": 0.0,
            "realized_pnl": 0.0,
            "unrealized_pnl": 0.0,
            "realized_pnl_trades": 0.0,
            "twr": None,
            "max_drawdown": {"value": None, "unavailable": no_history},
            "pnl_24h": {"value": None, "unavailable": no_history},
            "gross_exposure": {"value": 0.0, "open_notional": 0.0, "open_positions": 0},
            "win_rate": trade_win_rate([]),
            "last_mark_at": None,
            "oldest_mark_at": None,
            "valuation_stale_bots": [],
        }
    elif not included:
        kpis = {"unavailable": "No bots with a determinable common currency."}
    else:
        i_now = state_at(path, now)
        E = path.equity[i_now] if i_now is not None else sum(b.starting_capital for b in included)
        C = path.contributed[i_now] if i_now is not None else sum(b.starting_capital for b in included)
        R = path.realized[i_now] if i_now is not None else 0.0
        t24 = now - timedelta(hours=24)
        i24 = state_at(path, t24)
        obs24 = sum(tls[b.id].obs_between(t24, now) for b in included)
        pnl_now = E - C
        pnl_then = (path.equity[i24] - path.contributed[i24]) if i24 is not None else 0.0
        inc_trades = [t for b in included for t in b.trades]
        open_n = sum(t.notional for t in inc_trades if t.status == "open")
        marks = [tls[b.id].last_mark_at(now) for b in included]
        marks = [m for m in marks if m]
        stale_val = [r["id"] for r in bot_rows if r["in_aggregate"] and r["valuation_stale"]]
        kpis = {
            "equity": _r(E, 4),
            "contributed_capital": _r(C, 4),
            "net_pnl": _r(pnl_now, 4),
            "realized_pnl": _r(R, 4),
            "unrealized_pnl": _r(E - C - R, 4),
            "realized_pnl_trades": _r(sum(t.pnl or 0.0 for t in inc_trades if t.status in CLOSED_TRADE_STATUSES), 4),
            "twr": _r(path.index[i_now] - 1.0, 8) if i_now is not None else None,
            "max_drawdown": max_drawdown(path),
            "pnl_24h": {"value": _r(pnl_now - pnl_then, 4)} if obs24 > 0 else {"value": None, "unavailable": "No valuations in the last 24 hours."},
            "gross_exposure": {"value": _r(open_n / E, 8) if E > 0 else None, "open_notional": _r(open_n, 4), "open_positions": sum(1 for t in inc_trades if t.status == "open")},
            "win_rate": trade_win_rate(inc_trades),
            "last_mark_at": _iso(max(marks)) if marks else None,
            "oldest_mark_at": _iso(min(marks)) if marks else None,
            "valuation_stale_bots": stale_val,
        }

    # ── series over the selected window ──
    series: Dict[str, object] = {}
    window: Dict[str, object] = {}
    markers: Dict[str, List[Dict[str, object]]] = {"deployments": [], "closes": [], "opens": []}
    contribution: List[Dict[str, object]] = []
    daily: List[Dict[str, object]] = []
    if not bots:
        # Time frame only, so empty charts keep a real axis; series stay empty because nothing was observed.
        span = RANGES[rng][0] or RANGES["1M"][0]
        bucket = choose_bucket(now - span, now, rng if RANGES[rng][1] else "1M")
        window = {"start": _iso(_floor(now - span, bucket)), "end": _iso(now), "bucket_s": bucket}
    if included:
        first = min(b.created_at for b in included)
        span = RANGES[rng][0]
        start = first if span is None else max(first, now - span)
        bucket = choose_bucket(start, now, rng)
        start = _floor(start, bucket)
        ends: List[datetime] = []
        t = start + timedelta(seconds=bucket)
        while t < now:
            ends.append(t)
            t += timedelta(seconds=bucket)
        ends.append(now)
        window = {"start": _iso(start), "end": _iso(now), "bucket_s": bucket}
        cols: Dict[str, List[Optional[float]]] = {k: [] for k in ("equity", "contributed", "net_pnl", "realized", "unrealized", "twr", "drawdown", "exposure")}
        n_obs: List[int] = []
        stale_bots: List[int] = []
        per_bot_pnl: Dict[str, List[Optional[float]]] = {b.id: [] for b in included}
        per_bot_eq: Dict[str, List[Optional[float]]] = {b.id: [] for b in included}
        prev_end = start
        for end in ends:
            i = state_at(path, end)
            if i is None:
                for k in cols:
                    cols[k].append(None)
            else:
                E, C, R = path.equity[i], path.contributed[i], path.realized[i]
                cols["equity"].append(_r(E, 4))
                cols["contributed"].append(_r(C, 4))
                cols["net_pnl"].append(_r(E - C, 4))
                cols["realized"].append(_r(R, 4))
                cols["unrealized"].append(_r(E - C - R, 4))
                cols["twr"].append(_r(path.index[i] - 1.0, 8))
                lo = bisect_right(path.times, prev_end)
                hi = bisect_right(path.times, end)
                dds = path.drawdown[lo:hi]
                j = state_at(path, prev_end)
                if j is not None:
                    dds = dds + [path.drawdown[j]]
                cols["drawdown"].append(_r(min(dds), 8) if dds else None)
                notional = sum(open_notional_at(b.trades, end)[0] for b in included)
                cols["exposure"].append(_r(notional / E, 8) if E > 0 else None)
            n_obs.append(sum(tls[b.id].obs_between(prev_end, end) for b in included))
            stale = 0
            for b in included:
                if b.created_at > end:
                    continue
                lm = tls[b.id].last_mark_at(end) or b.created_at
                _, n_open = open_notional_at(b.trades, end)
                if n_open and ((end - lm) > stale_after or (b.lifecycle != "active" and end == now)):
                    stale += 1
            stale_bots.append(stale)
            for b in included:
                v = tls[b.id].value_at(end)
                per_bot_eq[b.id].append(_r(v[0], 4) if v else None)
                per_bot_pnl[b.id].append(_r(v[0] - b.starting_capital, 4) if v else None)
            prev_end = end
        series = {
            "t": [_iso(e) for e in ends],
            **cols,
            "n_obs": n_obs,
            "stale_bots": stale_bots,
            "bots_net_pnl": per_bot_pnl,
            "bots_equity": per_bot_eq,
        }
        for b in included:
            if b.created_at >= start:
                markers["deployments"].append({"t": _iso(b.created_at), "bot_id": b.id, "capital": _r(b.starting_capital, 4)})
            for tr in b.trades:
                if tr.opened_at >= start:
                    markers["opens"].append({"t": _iso(tr.opened_at), "bot_id": b.id, "notional": _r(tr.notional, 4), "precise": tr.opened_precise})
                if tr.closed_at and tr.closed_at >= start and tr.status in CLOSED_TRADE_STATUSES:
                    markers["closes"].append({"t": _iso(tr.closed_at), "bot_id": b.id, "pnl": _r(tr.pnl, 4), "reason": tr.exit_reason, "precise": tr.closed_precise})
        for b in included:
            tl = tls[b.id]
            v0 = tl.value_at(start)
            v1 = tl.value_at(now) or (float(b.starting_capital), 0.0)
            p0 = (v0[0] - b.starting_capital) if v0 else 0.0
            r0 = v0[1] if v0 else 0.0
            pnl = (v1[0] - b.starting_capital) - p0
            realized_chg = v1[1] - r0
            contribution.append(
                {"bot_id": b.id, "pnl": _r(pnl, 4), "realized": _r(realized_chg, 4), "unrealized": _r(pnl - realized_chg, 4)}
            )

        # Daily net P&L per UTC day; days without any valuation stay empty.
        today = now.date()
        d0 = max(first.date(), today - timedelta(days=DAILY_MAX_DAYS - 1))
        d = d0
        while d <= today:
            day_start = datetime.combine(d, time.min, tzinfo=timezone.utc)
            day_end = min(day_start + timedelta(days=1), now)
            i1 = state_at(path, day_end - timedelta(microseconds=1)) if day_end < now else state_at(path, now)
            i0 = state_at(path, day_start - timedelta(microseconds=1))
            obs = sum(tls[b.id].obs_between(day_start - timedelta(microseconds=1), day_end - timedelta(microseconds=1)) for b in included)
            deployed_today = [b for b in included if day_start <= b.created_at < day_end]
            flows = sum(b.starting_capital for b in deployed_today)
            realized_d = sum(
                t.pnl or 0.0
                for b in included
                for t in b.trades
                if t.closed_at and t.status in CLOSED_TRADE_STATUSES and day_start <= t.closed_at < day_end
            )
            if i1 is None or (obs == 0 and not deployed_today):
                pnl_d = None
            else:
                pnl1 = path.equity[i1] - path.contributed[i1]
                pnl0 = (path.equity[i0] - path.contributed[i0]) if i0 is not None else 0.0
                pnl_d = pnl1 - pnl0
            daily.append(
                {"date": d.isoformat(), "pnl": _r(pnl_d, 4), "realized": _r(realized_d, 4), "flows": _r(flows, 4), "observations": obs, "complete": d < today}
            )
            d += timedelta(days=1)

    # ── activity (last 24 h) ──
    a_start = _floor(now - ACTIVITY_WINDOW, ACTIVITY_BUCKET_S)
    n_b = int((now - a_start).total_seconds() // ACTIVITY_BUCKET_S) + 1
    lanes = []
    totals = {"ok": 0, "error": 0, "buy": 0}
    for b in bots:
        ok = [0] * n_b
        err = [0] * n_b
        buy = [0] * n_b
        times: List[datetime] = []
        for r in b.runs_recent:
            k = int((r.at - a_start).total_seconds() // ACTIVITY_BUCKET_S)
            if not 0 <= k < n_b:
                continue
            times.append(r.at)
            if r.status == "success":
                ok[k] += 1
                totals["ok"] += 1
                if (r.signal or "").upper() == "BUY":
                    buy[k] += 1
                    totals["buy"] += 1
            elif r.status == "error":
                err[k] += 1
                totals["error"] += 1
        gaps: List[List[Optional[str]]] = []
        if b.lifecycle == "active" or b.runs_recent:
            seq = ([b.last_run_before_window] if b.last_run_before_window else [max(a_start, b.created_at)]) + sorted(times)
            seq.append(now)
            for x, y in zip(seq, seq[1:]):
                x = max(x, a_start)
                if y - x > stale_after:
                    gaps.append([_iso(x), _iso(y)])
        lanes.append(
            {
                "bot_id": b.id,
                "ok": ok,
                "error": err,
                "buy": buy,
                "opens": [{"t": _iso(t.opened_at), "precise": t.opened_precise} for t in b.trades if t.opened_at >= a_start],
                "closes": [
                    {"t": _iso(t.closed_at), "pnl": _r(t.pnl, 4), "precise": t.closed_precise}
                    for t in b.trades
                    if t.closed_at and t.closed_at >= a_start and t.status in CLOSED_TRADE_STATUSES
                ],
                "gaps": gaps,
            }
        )

    # ── events ──
    events: List[Dict[str, object]] = []
    for b in bots:
        groups: Dict[str, Dict[str, object]] = {}
        for r in b.errors_recent:
            msg = (r.error or "Analysis failed").strip()[:140]
            g = groups.setdefault(msg, {"count": 0, "first_at": r.at, "last_at": r.at})
            g["count"] = int(g["count"]) + 1
            g["first_at"] = min(g["first_at"], r.at)  # type: ignore[type-var]
            g["last_at"] = max(g["last_at"], r.at)  # type: ignore[type-var]
        for msg, g in groups.items():
            last_at: datetime = g["last_at"]  # type: ignore[assignment]
            events.append(
                {
                    "kind": "error",
                    "severity": "critical" if b.status == "error" and now - last_at < timedelta(hours=24) else "warning",
                    "t": _iso(last_at),
                    "first_at": _iso(g["first_at"]),  # type: ignore[arg-type]
                    "count": g["count"],
                    "bot_id": b.id,
                    "message": msg,
                }
            )
        events.append({"kind": "deploy", "severity": "info", "t": _iso(b.created_at), "bot_id": b.id, "capital": _r(b.starting_capital, 4)})
        for tr in b.trades:
            events.append({"kind": "trade_open", "severity": "info", "t": _iso(tr.opened_at), "precise": tr.opened_precise, "bot_id": b.id, "notional": _r(tr.notional, 4)})
            if tr.closed_at and tr.status in CLOSED_TRADE_STATUSES:
                events.append(
                    {"kind": "trade_close", "severity": "info", "t": _iso(tr.closed_at), "precise": tr.closed_precise, "bot_id": b.id, "pnl": _r(tr.pnl, 4), "reason": tr.exit_reason}
                )
    events.sort(key=lambda e: (e["severity"] != "critical", -(datetime.fromisoformat(str(e["t"])).timestamp())))
    events = events[:EVENT_LIMIT]

    counts = {"live": 0, "paused": 0, "error": 0, "expired": 0, "ops_stale": 0, "valuation_stale": 0}
    for row in bot_rows:
        st = str(row["status"])
        if st == "paused":
            counts["paused"] += 1
        elif st == "error":
            counts["error"] += 1
        elif st == "expired":
            counts["expired"] += 1
        else:
            counts["live"] += 1
        counts["ops_stale"] += int(bool(row["ops_stale"]))
        counts["valuation_stale"] += int(bool(row["valuation_stale"]))

    return {
        "schema": "fleet.v1",
        "as_of": _iso(now),
        "range": rng,
        "definitions": DEFINITIONS,
        "currency": {
            # With no bots there is nothing to infer from; deploy capital is drawn from the USD paper wallet.
            "base": base if bots else PAPER_WALLET_CURRENCY,
            "included_bot_ids": [b.id for b in included],
            "excluded": excluded,
            "note": "Inferred from ticker format; amounts in different currencies are never summed."
            if bots
            else "No bots deployed; zero amounts are shown in the paper-wallet currency.",
        },
        "excluded_lifecycles": excluded_lifecycle_counts,
        "health": {"counts": counts, "poll_interval_s": int(poll_interval_s), "stale_after_s": stale_after_s, "runs_24h": totals},
        "kpis": kpis,
        "bots": bot_rows,
        "window": window,
        "series": series,
        "markers": markers,
        "contribution": contribution,
        "daily": daily,
        "activity": {"start": _iso(a_start), "bucket_s": ACTIVITY_BUCKET_S, "buckets": n_b, "lanes": lanes},
        "events": events,
        "limitations": limitations,
    }
