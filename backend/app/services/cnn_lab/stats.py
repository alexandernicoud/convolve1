"""Small, dependency-free statistics used by lab experiments (95% intervals throughout)."""
from __future__ import annotations

import math
from typing import Dict, Optional, Sequence

import numpy as np

N_BOOT = 2000


def _clean(values: Sequence[float]) -> np.ndarray:
    v = np.asarray(values, dtype=np.float64)
    return v[np.isfinite(v)]


def mean_ci(values: Sequence[float], *, seed: int = 0, n_boot: int = N_BOOT) -> Dict[str, Optional[float]]:
    """Mean with a percentile-bootstrap 95% interval. Interval is None when n < 2."""
    v = _clean(values)
    n = int(v.size)
    if n == 0:
        return {"mean": None, "lo": None, "hi": None, "n": 0}
    m = float(v.mean())
    if n < 2:
        return {"mean": m, "lo": None, "hi": None, "n": n}
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, size=(n_boot, n))
    boots = v[idx].mean(axis=1)
    lo, hi = np.percentile(boots, [2.5, 97.5])
    return {"mean": m, "lo": float(lo), "hi": float(hi), "n": n}


def diff_ci(a: Sequence[float], b: Sequence[float], *, seed: int = 0, n_boot: int = N_BOOT) -> Dict[str, Optional[float]]:
    """mean(a) − mean(b) for independent groups, bootstrap 95% interval."""
    va, vb = _clean(a), _clean(b)
    if va.size == 0 or vb.size == 0:
        return {"mean": None, "lo": None, "hi": None, "n_a": int(va.size), "n_b": int(vb.size)}
    m = float(va.mean() - vb.mean())
    if va.size < 2 or vb.size < 2:
        return {"mean": m, "lo": None, "hi": None, "n_a": int(va.size), "n_b": int(vb.size)}
    rng = np.random.default_rng(seed)
    ba = va[rng.integers(0, va.size, size=(n_boot, va.size))].mean(axis=1)
    bb = vb[rng.integers(0, vb.size, size=(n_boot, vb.size))].mean(axis=1)
    lo, hi = np.percentile(ba - bb, [2.5, 97.5])
    return {"mean": m, "lo": float(lo), "hi": float(hi), "n_a": int(va.size), "n_b": int(vb.size)}


def wilson(k: int, n: int) -> Dict[str, Optional[float]]:
    """Proportion k/n with the Wilson 95% interval."""
    if n <= 0:
        return {"p": None, "lo": None, "hi": None, "k": int(k), "n": int(n)}
    z = 1.959963984540054
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return {"p": p, "lo": max(0.0, centre - half), "hi": min(1.0, centre + half), "k": int(k), "n": int(n)}


def cohen_d(a: Sequence[float], b: Sequence[float]) -> Dict[str, Optional[float]]:
    """Standardized mean difference (a − b, pooled SD) with a normal-approximation 95% interval."""
    va, vb = _clean(a), _clean(b)
    na, nb = int(va.size), int(vb.size)
    if na < 2 or nb < 2:
        return {"d": None, "lo": None, "hi": None, "n_a": na, "n_b": nb}
    pooled = math.sqrt(((na - 1) * va.var(ddof=1) + (nb - 1) * vb.var(ddof=1)) / (na + nb - 2))
    if pooled <= 0:
        return {"d": None, "lo": None, "hi": None, "n_a": na, "n_b": nb}
    d = float((va.mean() - vb.mean()) / pooled)
    se = math.sqrt((na + nb) / (na * nb) + d * d / (2 * (na + nb)))
    return {"d": d, "lo": d - 1.96 * se, "hi": d + 1.96 * se, "n_a": na, "n_b": nb}


def pearson(x: Sequence[float], y: Sequence[float]) -> Dict[str, Optional[float]]:
    """Pearson r with a Fisher-z 95% interval."""
    vx, vy = np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64)
    ok = np.isfinite(vx) & np.isfinite(vy)
    vx, vy = vx[ok], vy[ok]
    n = int(vx.size)
    if n < 4 or vx.std() == 0 or vy.std() == 0:
        return {"r": None, "lo": None, "hi": None, "n": n}
    r = float(np.corrcoef(vx, vy)[0, 1])
    r = max(min(r, 0.999999), -0.999999)
    zr, se = math.atanh(r), 1 / math.sqrt(n - 3)
    return {"r": r, "lo": math.tanh(zr - 1.96 * se), "hi": math.tanh(zr + 1.96 * se), "n": n}


def excludes(ci: Dict[str, Optional[float]], value: float) -> Optional[bool]:
    """True if the interval lies entirely on one side of ``value``; None if no interval."""
    lo, hi = ci.get("lo"), ci.get("hi")
    if lo is None or hi is None:
        return None
    return lo > value or hi < value
