"""
Deterministic, rule-based findings for a v2 backtest. No language model; each rule reads computed
numbers and states what was measured, on how many observations, against which baseline, under which
assumptions, and what it does and does not show.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

FINDINGS_VERSION = 1

POSITIVE, NEUTRAL, CAUTION, NEGATIVE = "positive", "neutral", "caution", "negative"


def _v(m: Optional[Dict[str, Any]]) -> Optional[float]:
    return None if not isinstance(m, dict) else m.get("value")


def _f(
    id: str, severity: str, title: str, measurement: str, n: Optional[int], baseline: Optional[str],
    ci: Optional[List[float]], assumptions: str, limitations: str, interpretation: str,
) -> Dict[str, Any]:
    return {
        "id": id, "severity": severity, "title": title, "measurement": measurement, "sample_size": n,
        "baseline": baseline, "ci95": ci, "assumptions": assumptions, "limitations": limitations,
        "interpretation": interpretation,
    }


def _pct(x: Optional[float], d: int = 1) -> str:
    return "n/a" if x is None else f"{x * 100:.{d}f}%"


def build_findings(r: Dict[str, Any]) -> List[Dict[str, Any]]:
    """``r`` is the backtest_results.json payload (v2)."""
    out: List[Dict[str, Any]] = []
    tm = r.get("trading_metrics") or {}
    cm = r.get("classification_metrics") or {}
    th = r.get("threshold") or {}
    rb = r.get("robustness") or {}
    bm = (r.get("benchmarks") or {}).get("benchmarks") or {}
    audit = r.get("leakage_audit") or {}
    diag = r.get("diagnostics") or {}
    cfg = r.get("config") or {}

    # Threshold provenance -----------------------------------------------------------------------
    if th.get("source") != "validation_locked":
        out.append(_f(
            "threshold_not_validated", CAUTION, "The decision threshold is not independently validated",
            f"Threshold {th.get('value')} ({th.get('source')}).", None, None, None,
            "A manually entered threshold.",
            "If it was chosen after looking at this test set, every test metric is optimistic.",
            "Treat the headline result as exploratory until a threshold is selected on validation data and locked.",
        ))

    sel = th.get("selection") or {}
    vb, tb = sel.get("validation_base_rate"), _v(cm.get("positive_base_rate"))
    if th.get("source") == "validation_locked" and vb is not None and tb is not None and abs(vb - tb) > 0.05:
        out.append(_f(
            "base_rate_shift", CAUTION, "Label-1 base rate differs between validation and test data",
            f"Validation {_pct(vb)} vs. test {_pct(tb)}.", sel.get("n_validation"), None, None,
            f"Threshold selected by {sel.get('rule')} on the validation split.",
            "A threshold tuned where label 1 is more (or less) common shifts how many trades fire on the test set; "
            "balanced training datasets make this likely.",
            "The locked threshold is valid but may not be well calibrated to the test period's base rate.",
        ))

    # Classification vs majority baseline ---------------------------------------------------------
    acc, maj = cm.get("accuracy") or {}, cm.get("majority_baseline_accuracy") or {}
    if _v(acc) is not None and _v(maj) is not None:
        ci = acc.get("ci95")
        n = acc.get("n")
        above = ci is not None and ci[0] > _v(maj)
        below = ci is not None and ci[1] < _v(maj)
        out.append(_f(
            "accuracy_vs_majority", POSITIVE if above else NEGATIVE if below else NEUTRAL,
            ("Accuracy is above the majority-class baseline" if above else
             "Accuracy is below the majority-class baseline" if below else
             "The model does not demonstrate a statistically clear improvement over the majority baseline"),
            f"Accuracy {_pct(_v(acc))} vs. always predicting the majority class {_pct(_v(maj))}.", n,
            f"majority class = {maj.get('majority_class')}", ci,
            f"Threshold {cm.get('threshold')}; labels from the dataset's TP/SL/horizon definition.",
            "Wilson 95% interval on accuracy; overlapping label horizons make samples dependent, so the true "
            "uncertainty is larger.",
            "Accuracy measures label agreement, not trading profit.",
        ))
    auc = cm.get("roc_auc") or {}
    if _v(auc) is not None and auc.get("ci95"):
        lo, hi = auc["ci95"]
        out.append(_f(
            "ranking_skill", POSITIVE if lo > 0.5 else NEGATIVE if hi < 0.5 else NEUTRAL,
            "Probability ranking is better than random" if lo > 0.5 else
            "Probability ranking is worse than random" if hi < 0.5 else
            "Probability ranking is not distinguishable from random",
            f"ROC-AUC {_v(auc):.3f}.", cm.get("n"), "0.5 (random ranking)", [lo, hi],
            "Threshold-free; computed on all labelled test predictions.",
            "Bootstrap interval resamples charts independently and ignores overlap between label horizons.",
            "Ranking skill is necessary, not sufficient, for a profitable strategy.",
        ))

    # Costs erase gross --------------------------------------------------------------------------
    g, net = _v(tm.get("gross_pnl")), _v(tm.get("net_pnl"))
    if g is not None and net is not None and g > 0 and net <= 0:
        out.append(_f(
            "costs_erase_gross", NEGATIVE, "Trading costs erase the gross return",
            f"Gross P&L {g:,.2f}, costs {_v(tm.get('total_costs')) or 0:,.2f}, net P&L {net:,.2f}.",
            tm.get("executed_trades"), "zero net P&L", None,
            f"Commission {cfg.get('commission_pct')}% and slippage {cfg.get('slippage_pct')}% per side.",
            "Costs are a simple percentage model; real spreads vary by symbol and time.",
            "The signal's edge, if any, is smaller than the assumed cost of trading it.",
        ))

    # Small sample / concentration ---------------------------------------------------------------
    closed = tm.get("closed_trades") or 0
    if closed < 30:
        out.append(_f(
            "small_sample", CAUTION, "Too few trades for reliable conclusions",
            f"{closed} closed trade(s).", closed, "≥ 30 closed trades", (tm.get("win_rate") or {}).get("ci95"),
            "Win-rate interval is Wilson 95%.", "Subgroup and ratio metrics are highly unstable at this size.",
            "Results may change materially with a different test period.",
        ))
    conc = rb.get("concentration") or {}
    if conc.get("top3_share_of_net") is not None and conc["top3_share_of_net"] > 0.5 and (net or 0) > 0:
        out.append(_f(
            "concentration", CAUTION, "Performance depends heavily on a small number of trades",
            f"The 3 best trades contribute {_pct(conc['top3_share_of_net'], 0)} of net P&L.", closed, None, None,
            "Share of total net P&L.", "Removing a few trades would change the conclusion.",
            "The result is fragile; do not extrapolate from it.",
        ))

    # Slippage sensitivity ------------------------------------------------------------------------
    sens = rb.get("slippage_sensitivity") or []
    base_ret = _v(tm.get("total_return"))
    worst = next((s for s in sens if s.get("multiplier") == 4), None)
    if worst and base_ret is not None and worst.get("total_return") is not None:
        drop = base_ret - worst["total_return"]
        flips = base_ret > 0 >= worst["total_return"]
        if flips or drop > 0.02:
            out.append(_f(
                "slippage_sensitive", NEGATIVE if flips else CAUTION, "Results deteriorate materially under higher slippage",
                f"Total return {_pct(base_ret)} at the assumed slippage vs. {_pct(worst['total_return'])} at 4×.",
                tm.get("executed_trades"), "assumed slippage", None,
                "Same signals and threshold; only the slippage parameter changes.",
                "Capacity constraints and position-dependent skips change with costs.",
                "The strategy's viability depends on execution quality.",
            ))

    # Benchmarks ----------------------------------------------------------------------------------
    em = bm.get("exposure_matched")
    if em and base_ret is not None and _v(em.get("total_return")) is not None:
        diff = base_ret - _v(em["total_return"])
        out.append(_f(
            "vs_exposure_matched", POSITIVE if diff > 0 else NEGATIVE, "Comparison with a passive mix at the same average exposure",
            f"Strategy {_pct(base_ret)} vs. {em.get('label')} {_pct(_v(em['total_return']))} ({'+' if diff >= 0 else ''}{_pct(diff)}).",
            tm.get("n_periods"), em.get("label"), None, em.get("note", ""),
            "One realised path; no significance test is applied to the difference.",
            "Shows whether timing added value beyond simply holding a smaller position.",
        ))

    # Leakage / data quality ----------------------------------------------------------------------
    if audit.get("purged_sample_ids"):
        out.append(_f(
            "purged_samples", CAUTION, "Some test samples overlap the training label period",
            f"{len(audit['purged_sample_ids'])} sample(s) purged before simulation.", len(audit["purged_sample_ids"]),
            None, None, "Purge rule: entry on or before the last training label's horizon end (same symbol).",
            "Purging shortens the effective test period.", "Purged samples are excluded from all metrics.",
        ))
    unknown = [c for c in audit.get("checks") or [] if c.get("status") == "unknown"]
    if unknown:
        out.append(_f(
            "audit_incomplete", CAUTION, "Leakage checks could not all be completed",
            "; ".join(c["title"] for c in unknown) + ".", None, None, None,
            "Checks require recorded training metadata.", ", ".join(audit.get("missing_information") or []),
            "The evaluation is classified as exploratory.",
        ))
    if diag.get("ambiguous_same_bar_tp_sl"):
        out.append(_f(
            "intrabar_ambiguity", NEUTRAL, "Some exits are ambiguous within a single bar",
            f"{diag['ambiguous_same_bar_tp_sl']} trade(s) touched both TP and SL in one bar; SL was assumed first.",
            tm.get("executed_trades"), None, None, "OHLC bars do not record intrabar order.",
            "Conservative assumption; true outcomes may be better.", "Small effect unless the count is large.",
        ))
    if tm.get("open_at_end"):
        out.append(_f(
            "open_positions", NEUTRAL, "Positions remain open at the end of the data",
            f"{tm['open_at_end']} position(s) marked at the last close and not booked as exits.", tm.get("open_at_end"),
            None, None, "Marked to market.", "Their final outcome is unknown.", "Included in equity, excluded from trade statistics.",
        ))
    sharpe = tm.get("sharpe") or {}
    if sharpe.get("unavailable"):
        out.append(_f(
            "sharpe_unavailable", NEUTRAL, "Sharpe ratio not reported", sharpe["unavailable"], tm.get("n_periods"),
            None, None, "Sharpe needs enough periodic returns with variance.", "", "Not a sign of good or bad performance.",
        ))
    return out
