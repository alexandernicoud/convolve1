"""Daily FX closing rates for converting paper-bot amounts into one reporting currency.

Rates come from Yahoo Finance (the same source as the bots' price bars), are cached in memory and are
returned as ``[(date, units of target per unit of source)]`` in ascending date order.
"""

from __future__ import annotations

import logging
import time as _time
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

FX_SOURCE = "Yahoo Finance daily close"
CACHE_TTL_S = 3600
# Minor units quoted by some exchanges (London prices are in pence).
_MINOR = {"GBp": ("GBP", 0.01), "GBX": ("GBP", 0.01), "ZAc": ("ZAR", 0.01), "ILA": ("ILS", 0.01)}

Rates = List[Tuple[date, float]]
_cache: Dict[Tuple[str, str], Tuple[float, date, Rates]] = {}


def _major(ccy: str) -> Tuple[str, float]:
    return _MINOR.get(ccy, (ccy.upper(), 1.0))


def _history(pair: str, start: date) -> Rates:
    import yfinance as yf

    end = datetime.now(timezone.utc).date() + timedelta(days=1)
    df = yf.Ticker(pair).history(start=start.isoformat(), end=end.isoformat(), interval="1d", auto_adjust=False)
    if df is None or df.empty or "Close" not in df:
        return []
    closes = df["Close"].dropna()
    return [(ts.date(), float(v)) for ts, v in closes.items() if float(v) > 0]


def _major_rates(src: str, dst: str, start: date) -> Optional[Rates]:
    hit = _cache.get((src, dst))
    if hit and _time.time() - hit[0] < CACHE_TTL_S and hit[1] <= start:
        return hit[2]
    fetch_from = start - timedelta(days=10)
    try:
        rates = _history(f"{src}{dst}=X", fetch_from)
        if not rates:
            rates = [(d, 1.0 / v) for d, v in _history(f"{dst}{src}=X", fetch_from)]
    except Exception as e:  # network or provider failure: the caller reports the bot as unconverted
        logger.warning("fx: %s->%s unavailable: %s", src, dst, e)
        return None
    if not rates:
        return None
    _cache[(src, dst)] = (_time.time(), fetch_from, rates)
    return rates


def daily_rates(src: str, dst: str, start: date) -> Optional[Rates]:
    """Daily closes converting ``src`` amounts into ``dst`` from about ``start`` until today; None if unavailable."""
    s, fs = _major(src)
    d, fd = _major(dst)
    factor = fs / fd
    if s == d:
        return [(start, factor)]
    rates = _major_rates(s, d, start)
    return None if rates is None else [(day, v * factor) for day, v in rates]
