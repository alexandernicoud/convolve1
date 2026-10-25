"""Compiled TP / SL / horizon grid kernels for the Labeling Optimizer (scripts/7.2.py) and its audit.

For an entry at bar ``k`` the offset of the first bar whose High reaches ``Open[k] * (1 + tp)`` does
not depend on the holding horizon, and neither does the first Low at or below ``Open[k] * (1 - sl)``.
Both offsets are computed once per TP and SL level. Every grid cell's exits then follow from the two
offsets and its horizon, so a cell costs O(n) instead of the O(n * h) bar walk.

Positions that close on the same bar are processed in entry order, which is the order of the bar
walk in 7.2.py and in the audit. The arithmetic is the same expression by expression, so the
results are bit-identical to those walks (tests/test_label_grid_parity.py).

Offsets are measured from the entry bar (offset 0 = entry bar). ``NO_HIT`` = the largest horizon,
i.e. not touched within any horizon of the grid.
"""

from __future__ import annotations

import numpy as np

try:
    from numba import njit, prange

    HAVE_NUMBA = True
except Exception:  # pragma: no cover - exercised only where numba is missing
    HAVE_NUMBA = False
    prange = range

    def njit(*args, **kwargs):
        if args and callable(args[0]):
            return args[0]
        return lambda f: f


@njit(cache=False, parallel=True)
def first_passage(opens, prices, fracs, hmax, upper):
    """[level, entry] offset of the first bar at/through ``Open[k] * (1 ± frac)``; ``hmax`` when none."""
    n = opens.shape[0]
    m = fracs.shape[0]
    out = np.full((m, n), hmax, dtype=np.int32)
    for li in prange(m):
        f = fracs[li]
        for k in range(1, n):
            lim = n - 1 - k
            if lim > hmax - 1:
                lim = hmax - 1
            if upper:
                level = opens[k] * (1.0 + f)
                for j in range(lim + 1):
                    if prices[k + j] >= level:
                        out[li, k] = j
                        break
            else:
                level = opens[k] * (1.0 - f)
                for j in range(lim + 1):
                    if prices[k + j] <= level:
                        out[li, k] = j
                        break
    return out


@njit(cache=False)
def _exit_order(e_arr, t_arr, n, h, exit_bar, kind, count, order):
    """Exit bar and kind of every position at horizon ``h``; ``order`` = positions by (exit bar, entry)."""
    for b in range(n):
        count[b] = 0
    for k in range(1, n):
        exp_off = h - 1
        if exp_off > n - 1 - k:
            exp_off = n - 1 - k
        e = e_arr[k]
        if e <= exp_off:
            exit_bar[k] = k + e
            kind[k] = t_arr[k]
        else:
            exit_bar[k] = k + exp_off
            kind[k] = 0
        count[exit_bar[k]] += 1
    pos = 0
    for b in range(n):
        c = count[b]
        count[b] = pos
        pos += c
    for k in range(1, n):
        b = exit_bar[k]
        order[count[b]] = k
        count[b] += 1
    return pos


@njit(cache=False, parallel=True)
def simulate_grid(fp_tp, fp_sl, tp_values, sl_values, horizons, n, start_equity, total_cost, sl_first):
    """Label-payoff portfolio of 7.2.py for every cell. Same outputs and flat order as its _simulate_grid."""
    n_tp = tp_values.shape[0]
    n_sl = sl_values.shape[0]
    n_h = horizons.shape[0]
    total = n_tp * n_sl * n_h
    trades = np.zeros(total, dtype=np.int64)
    label1 = np.zeros(total, dtype=np.int64)
    pnl = np.zeros(total, dtype=np.float64)
    dd = np.zeros(total, dtype=np.float64)
    mean = np.zeros(total, dtype=np.float64)
    m2 = np.zeros(total, dtype=np.float64)
    equity = np.zeros(total, dtype=np.float64)

    for pair in prange(n_tp * n_sl):
        ti = pair // n_sl
        si = pair % n_sl
        tp_frac = tp_values[ti]
        sl_frac = sl_values[si]
        e_arr = np.empty(n, dtype=np.int64)
        t_arr = np.empty(n, dtype=np.int64)
        exit_bar = np.empty(n, dtype=np.int64)
        kind = np.empty(n, dtype=np.int64)
        count = np.empty(n, dtype=np.int64)
        order = np.empty(n, dtype=np.int64)
        for k in range(1, n):
            et = fp_tp[ti, k]
            es = fp_sl[si, k]
            if es < et or (es == et and sl_first != 0):
                e_arr[k] = es
                t_arr[k] = -1
            else:
                e_arr[k] = et
                t_arr[k] = 1

        for hi in range(n_h):
            h = horizons[hi]
            if h < 1:
                h = 1
            w = 1.0 / h
            m = _exit_order(e_arr, t_arr, n, h, exit_bar, kind, count, order)

            t_count = 0
            l1 = 0
            pnl_linear_sum = 0.0
            equity_lin = 1.0
            max_equity_lin = 1.0
            dd_min = 0.0
            mean_r = 0.0
            M2 = 0.0
            equity_comp = start_equity
            for q in range(m):
                k = order[q]
                out = kind[k]
                if out == 1:
                    r = tp_frac
                    t_count += 1
                    l1 += 1
                    counted = True
                elif out == -1:
                    r = -sl_frac
                    t_count += 1
                    counted = True
                else:
                    r = 0.0
                    counted = False

                eff_r = w * r
                eff_r -= w * total_cost

                pnl_linear_sum += eff_r
                equity_lin += eff_r
                equity_lin = max(equity_lin, 0.0)
                max_equity_lin = max(max_equity_lin, equity_lin)
                dd_min = min(dd_min, equity_lin - max_equity_lin)

                if counted:
                    delta = eff_r - mean_r
                    mean_r += delta / t_count
                    delta2 = eff_r - mean_r
                    M2 += delta2 * delta2

                equity_comp *= (1.0 + eff_r)
                equity_comp = max(equity_comp, 0.0)

            p = pair * n_h + hi
            trades[p] = t_count
            label1[p] = l1
            pnl[p] = pnl_linear_sum
            dd[p] = dd_min
            mean[p] = mean_r
            m2[p] = M2
            equity[p] = equity_comp
    return trades, label1, pnl, dd, mean, m2, equity


@njit(cache=False, parallel=True)
def mtm_grid(opens, closes, fp_tp, fp_sl, tp_values, sl_values, horizons, n, total_cost, sl_first):
    """Final equity (start 1.0) of the audit's mark-to-market walk for every cell, as [tp, sl, h]."""
    n_tp = tp_values.shape[0]
    n_sl = sl_values.shape[0]
    n_h = horizons.shape[0]
    out = np.empty(n_tp * n_sl * n_h, dtype=np.float64)
    for pair in prange(n_tp * n_sl):
        ti = pair // n_sl
        si = pair % n_sl
        tp = tp_values[ti]
        sl = sl_values[si]
        e_arr = np.empty(n, dtype=np.int64)
        t_arr = np.empty(n, dtype=np.int64)
        exit_bar = np.empty(n, dtype=np.int64)
        kind = np.empty(n, dtype=np.int64)
        count = np.empty(n, dtype=np.int64)
        order = np.empty(n, dtype=np.int64)
        for k in range(1, n):
            et = fp_tp[ti, k]
            es = fp_sl[si, k]
            if es < et or (es == et and sl_first != 0):
                e_arr[k] = es
                t_arr[k] = -1
            else:
                e_arr[k] = et
                t_arr[k] = 1
        for hi in range(n_h):
            h = horizons[hi]
            if h < 1:
                h = 1
            w = 1.0 / h
            m = _exit_order(e_arr, t_arr, n, h, exit_bar, kind, count, order)
            eq = 1.0
            for q in range(m):
                k = order[q]
                i = exit_bar[k]
                e = opens[k]
                out_k = kind[k]
                if out_k == 1:
                    tpL = e * (1.0 + tp)
                    r = tp
                    if k < i and opens[i] >= tpL:
                        r = opens[i] / e - 1.0
                elif out_k == -1:
                    slL = e * (1.0 - sl)
                    r = -sl
                    if k < i and opens[i] <= slL:
                        r = opens[i] / e - 1.0
                else:
                    r = closes[i] / e - 1.0
                eq *= 1.0 + (w * r - w * total_cost)
                if eq < 0.0:
                    eq = 0.0
            out[pair * n_h + hi] = eq
    return out


@njit(cache=False, parallel=True)
def research_grid(opens, closes, fp_tp, fp_sl, tp_values, sl_values, horizons, k_lo, k_hi, data_end, n_blocks, sl_first):
    """Outcome statistics of every cell over entries ``k_lo..k_hi`` with complete windows.

    A sample is the trade entered at the open of bar ``k`` (decided at the close of ``k - 1``).
    Like ``label_for_method(..., LABEL_METHOD_V2)`` it is counted at horizon ``h`` when TP or SL is
    touched at or before ``data_end``, or when the untouched window ``k .. k + h - 1`` ends at or
    before ``data_end``; an outcome never reads a bar after the period boundary. Horizons must be
    ascending. Exits follow the shared
    contract (app.services.trade_outcomes): TP fills at the target, SL at the stop or at a gapping
    open after the entry bar, a timeout at the close of the last horizon bar. Returns are gross.

    Outputs are [tp, sl, h] (``blk_*`` add a trailing block axis): samples, TP exits, SL exits,
    sum of returns, sum of returns of label-0 samples, sum of bars held, and per chronological
    block of entries: samples, TP exits, sum of returns.
    """
    n_tp = tp_values.shape[0]
    n_sl = sl_values.shape[0]
    n_h = horizons.shape[0]
    shape = (n_tp, n_sl, n_h)
    cnt = np.zeros(shape, dtype=np.int64)
    n_tp_hit = np.zeros(shape, dtype=np.int64)
    n_sl_hit = np.zeros(shape, dtype=np.int64)
    s_ret = np.zeros(shape, dtype=np.float64)
    s_ret0 = np.zeros(shape, dtype=np.float64)
    s_held = np.zeros(shape, dtype=np.float64)
    blk_n = np.zeros((n_tp, n_sl, n_h, n_blocks), dtype=np.int64)
    blk_tp = np.zeros((n_tp, n_sl, n_h, n_blocks), dtype=np.int64)
    blk_ret = np.zeros((n_tp, n_sl, n_h, n_blocks), dtype=np.float64)
    span = k_hi - k_lo + 1
    if span <= 0:
        return cnt, n_tp_hit, n_sl_hit, s_ret, s_ret0, s_held, blk_n, blk_tp, blk_ret

    for pair in prange(n_tp * n_sl):
        ti = pair // n_sl
        si = pair % n_sl
        tp = tp_values[ti]
        sl = sl_values[si]
        for k in range(k_lo, k_hi + 1):
            entry = opens[k]
            et = fp_tp[ti, k]
            es = fp_sl[si, k]
            if es < et or (es == et and sl_first != 0):
                e = es
                kind = -1
            else:
                e = et
                kind = 1
            if kind == 1:
                r_hit = (entry * (1.0 + tp)) / entry - 1.0
            else:
                stop = entry * (1.0 - sl)
                px = stop
                if e > 0 and k + e < opens.shape[0] and opens[k + e] <= stop:
                    px = opens[k + e]
                r_hit = px / entry - 1.0
            b = ((k - k_lo) * n_blocks) // span
            for hi in range(n_h):
                h = horizons[hi]
                if e <= h - 1:
                    if k + e > data_end:
                        break
                    r = r_hit
                    held = e + 1
                    if kind == 1:
                        n_tp_hit[ti, si, hi] += 1
                        blk_tp[ti, si, hi, b] += 1
                    else:
                        n_sl_hit[ti, si, hi] += 1
                        s_ret0[ti, si, hi] += r
                else:
                    if k + h - 1 > data_end:
                        if k + e > data_end:
                            break
                        continue
                    r = closes[k + h - 1] / entry - 1.0
                    held = h
                    s_ret0[ti, si, hi] += r
                cnt[ti, si, hi] += 1
                s_ret[ti, si, hi] += r
                s_held[ti, si, hi] += held
                blk_n[ti, si, hi, b] += 1
                blk_ret[ti, si, hi, b] += r
    return cnt, n_tp_hit, n_sl_hit, s_ret, s_ret0, s_held, blk_n, blk_tp, blk_ret


def passage_tables(opens, highs, lows, tp_values, sl_values, hmax):
    """First-passage offsets for every TP and SL level (int32 [level, entry])."""
    fp_tp = first_passage(opens, highs, np.ascontiguousarray(tp_values, dtype=np.float64), int(hmax), True)
    fp_sl = first_passage(opens, lows, np.ascontiguousarray(sl_values, dtype=np.float64), int(hmax), False)
    return fp_tp, fp_sl
