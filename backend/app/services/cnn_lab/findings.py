"""Deterministic research findings derived from stored lab results.

Rules are fixed and interval-based. Status vocabulary:
  observation  — a descriptive fact about the sample (no comparison claimed)
  supported    — the 95% interval for a pre-defined comparison excludes the baseline value
  hypothesis   — suggestive but not established (e.g. holds for one baseline only, or correlational)
  inconclusive — the interval includes the baseline value, or the data are insufficient
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .experiments import PRICE_REGIONS, TIME_REGIONS
from .stats import excludes

REGION_LABEL = {
    "time": {"oldest": "oldest third (left)", "middle": "middle third", "recent": "most recent third (right)"},
    "price": {"upper": "upper third (highest prices)", "middle": "middle price band", "lower": "lower third (lowest prices)"},
}


def _pct(v: Optional[float], digits: int = 1) -> str:
    return "—" if v is None else f"{v * 100:.{digits}f}%"


def _pp(v: Optional[float], digits: int = 1) -> str:
    return "—" if v is None else f"{v * 100:+.{digits}f} pp"


def _drop_text(drop: Optional[float]) -> str:
    """Wording for a probability drop (positive = the probability fell)."""
    if drop is None:
        return "has an unknown effect on the predicted class's probability"
    return f"{'lowers' if drop >= 0 else 'raises'} the predicted class's probability by {abs(drop) * 100:.2f} pp"


def _overlaps(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    if None in (a.get("lo"), a.get("hi"), b.get("lo"), b.get("hi")):
        return True
    return not (a["hi"] < b["lo"] or b["hi"] < a["lo"])


def _m(label: str, ci: Dict[str, Any], unit: str, key: str = "mean") -> Dict[str, Any]:
    return {"label": label, "value": ci.get(key), "lo": ci.get("lo"), "hi": ci.get("hi"), "unit": unit}


def _f(fid: str, module: str, job_id: str, status: str, title: str, observation: str, measurement: Optional[Dict[str, Any]], n: Optional[int], baseline: Optional[str], limitations: List[str]) -> Dict[str, Any]:
    return {
        "id": fid,
        "module": module,
        "status": status,
        "title": title,
        "observation": observation,
        "measurement": measurement,
        "n": n,
        "baseline": baseline,
        "limitations": limitations,
        "link": {"module": module, "job_id": job_id},
    }


def _context(res: Dict[str, Any], job_id: str, module: str) -> List[Dict[str, Any]]:
    out = []
    s = res.get("summary") or {}
    near = s.get("near_chance")
    if near and near.get("n"):
        weak = near["p"] is not None and near["p"] >= 0.5
        out.append(
            _f(
                "context.confidence",
                module,
                job_id,
                "observation",
                "Most predictions are close to 50/50" if weak else "Prediction confidence on the sample",
                f"{_pct(near['p'], 0)} of sampled images are predicted with confidence below 55%."
                + (" Attributions then explain small differences in evidence, which makes them less stable." if weak else ""),
                {"label": "Share with confidence < 0.55", "value": near["p"], "lo": near["lo"], "hi": near["hi"], "unit": "proportion"},
                near["n"],
                None,
                ["Describes this sample only.", "Confidence is the model's probability, not a calibrated likelihood."],
            )
        )
    return out


def _atlas(res: Dict[str, Any], job_id: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    prof = res.get("profile") or {}
    n = prof.get("n")
    layer = res.get("layer")
    region_caveat = "Regions are fixed thirds of the image." + ("" if (res.get("layout") or {}).get("verified") else " The chart layout is assumed, not verified, for this dataset.")
    for axis, names in (("time", TIME_REGIONS), ("price", PRICE_REGIONS)):
        rows = prof.get(axis) or {}
        cands = [(k, rows[k]["excess_over_ink"]) for k in names if k in rows and rows[k]["excess_over_ink"].get("mean") is not None]
        if not cands:
            continue
        k, ci = max(cands, key=lambda kv: abs(kv[1]["mean"]))
        ex = excludes(ci, 0.0)
        label = REGION_LABEL[axis][k]
        att = rows[k]["attention"]["mean"]
        ink = rows[k]["ink"]["mean"]
        if ex:
            more = ci["mean"] > 0
            title = f"Grad-CAM {'favours' if more else 'avoids'} the {label}"
            obs = (
                f"The {label} receives {_pct(att)} of Grad-CAM mass but holds {_pct(ink)} of the candle pixels "
                f"({_pp(ci['mean'])} relative to candle share)."
            )
            status = "supported"
        else:
            title = f"No {('time' if axis == 'time' else 'price')} region stands out beyond where the candles are"
            obs = f"The largest deviation from candle share is in the {label} ({_pp(ci['mean'])}), and its interval includes zero."
            status = "inconclusive"
        out.append(
            _f(
                f"atlas.{axis}",
                "atlas",
                job_id,
                status,
                title,
                obs,
                _m(f"Attention share − candle share, {label}", ci, "share"),
                n,
                "Share of candle (non-background) pixels in the same region, per image",
                [
                    region_caveat,
                    "The region with the largest deviation is selected from three; intervals are not corrected for that choice.",
                    f"Grad-CAM at layer {layer} (target: {res.get('target')}). Other layers or methods can disagree.",
                ],
            )
        )

    fg, area = prof.get("foreground_share") or {}, prof.get("foreground_area") or {}
    if fg.get("mean") is not None and area.get("mean") is not None:
        ex = excludes(fg, area["mean"])
        if ex and fg["mean"] > area["mean"]:
            status, title = "supported", "Attention concentrates on candles more than their area implies"
        elif ex:
            status, title = "supported", "Most Grad-CAM mass falls on the white background"
        else:
            status, title = "inconclusive", "Attention on candles is in line with the area they cover"
        out.append(
            _f(
                "atlas.foreground",
                "atlas",
                job_id,
                status,
                title,
                f"{_pct(fg['mean'])} of Grad-CAM mass lies on candle pixels, which cover {_pct(area['mean'])} of the image on average."
                + (" Background attention can still be informative: empty space encodes where price did not go." if status == "supported" and fg["mean"] < area["mean"] else ""),
                _m("Grad-CAM share on candle pixels", fg, "share"),
                n,
                f"Mean candle area ({_pct(area['mean'])})",
                ["Grad-CAM is coarse (layer grid upsampled), so mass near candle edges spills onto background.", "The baseline is the sample mean area, not a per-image paired comparison."],
            )
        )

    typ = (res.get("typicality") or {}).get("quartiles")
    if typ:
        med = typ[1]
        out.append(
            _f(
                "atlas.consistency",
                "atlas",
                job_id,
                "observation",
                "Attention patterns are " + ("consistent across images" if med >= 0.5 else "heterogeneous across images"),
                f"Median correlation between an image's map and the sample mean map is {med:.2f} (IQR {typ[0]:.2f}–{typ[2]:.2f}).",
                {"label": "Median map correlation with mean", "value": med, "lo": typ[0], "hi": typ[2], "unit": "r (IQR)"},
                n,
                None,
                ["A low value means the mean map is a poor summary; inspect the representative examples."],
            )
        )
    if res.get("n_all_zero"):
        out.append(
            _f(
                "atlas.zero",
                "atlas",
                job_id,
                "observation",
                "Some images have no positive Grad-CAM evidence",
                f"{res['n_all_zero']} of {res['n_all_zero'] + res.get('n_used', 0)} sampled images produced an all-zero map at layer {layer} and were excluded from the aggregates.",
                None,
                res["n_all_zero"] + res.get("n_used", 0),
                None,
                ["All-zero maps occur when no channel has positive gradient-weighted activation for the target."],
            )
        )

    grp = (res.get("groups") or {}).get("predicted") or {}
    diff = grp.get("difference")
    if diff:
        hits = []
        for axis, names in (("time", TIME_REGIONS), ("price", PRICE_REGIONS)):
            for k in names:
                ci = diff["regions"][axis][k]
                if excludes(ci, 0.0):
                    hits.append((axis, k, ci))
        if hits:
            axis, k, ci = max(hits, key=lambda h: abs(h[2]["mean"]))
            out.append(
                _f(
                    "atlas.groups.predicted",
                    "atlas",
                    job_id,
                    "supported",
                    f"{diff['a']} and {diff['b']} images attend differently to the {REGION_LABEL[axis][k]}",
                    f"Attention share in the {REGION_LABEL[axis][k]} differs by {_pp(ci['mean'])} ({diff['a']} minus {diff['b']}). {len(hits)} of 6 region comparisons exclude zero.",
                    _m("Difference in attention share", ci, "share"),
                    (ci.get("n_a") or 0) + (ci.get("n_b") or 0),
                    "No difference between predicted classes",
                    ["Six region comparisons are tested; intervals are not corrected for multiplicity.", "Groups are defined by the model's own prediction, so differences describe its behaviour, not the data."],
                )
            )
        else:
            out.append(
                _f(
                    "atlas.groups.predicted",
                    "atlas",
                    job_id,
                    "inconclusive",
                    "No regional attention difference between predicted classes",
                    "None of the six region-share differences between predicted classes has an interval excluding zero.",
                    None,
                    sum(g.get("n", 0) for g in (grp.get("groups") or {}).values()),
                    "No difference between predicted classes",
                    ["Small groups give wide intervals; increase the sample size before reading this as 'no difference'."],
                )
            )
    return out


def _sensitivity(res: Dict[str, Any], job_id: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    rows = res.get("regions") or []
    baselines = list((res.get("baselines") or {}).keys())
    n = (res.get("summary") or {}).get("n")
    if not rows or not baselines:
        return out
    primary = baselines[0]
    prim = [r for r in rows if r["baseline"] == primary and r["delta"].get("mean") is not None]
    if prim:
        top = max(prim, key=lambda r: abs(r["delta"]["mean"]))
        region = top["region"]
        axis, k = region.split(":")
        agree = [
            r["baseline"]
            for r in rows
            if r["region"] == region and excludes(r["delta"], 0.0) and r["delta"]["mean"] is not None and (r["delta"]["mean"] > 0) == (top["delta"]["mean"] > 0)
        ]
        if excludes(top["delta"], 0.0) and len(agree) >= 2:
            status = "supported"
        elif excludes(top["delta"], 0.0):
            status = "hypothesis"
        else:
            status = "inconclusive"
        tiny = abs(top["delta"]["mean"]) < 0.01
        sign = top["delta"]["mean"] > 0
        same = [r for r in prim if excludes(r["delta"], 0.0) and (r["delta"]["mean"] > 0) == sign]
        separated = all(not _overlaps(top["delta"], r["delta"]) for r in prim if r is not top)
        name = REGION_LABEL[axis][k]
        if separated:
            title = f"Masking the {name} has the largest effect"
        elif len(same) == len(prim):
            title = f"Masking any third {'raises' if sign else 'lowers'} the predicted class's probability"
        else:
            title = f"Largest point estimate: masking the {name}"
        out.append(
            _f(
                "sensitivity.region",
                "sensitivity",
                job_id,
                status,
                title,
                f"With the {primary} baseline, masking the {name} changes the predicted class's probability by {_pp(top['delta']['mean'], 2)} on average, "
                f"the largest of {len(prim)} regions; its interval {'does not overlap' if separated else 'overlaps'} the others'. "
                f"{len(same)} of {len(prim)} regions shift the probability in the same direction with an interval excluding zero. "
                f"For the {name}, the effect has the same sign and excludes zero for {len(agree)} of {len(baselines)} baselines ({', '.join(agree) or 'none'})."
                + (" The change is under one percentage point; the model's output barely moves under these edits." if tiny else ""),
                _m(f"Δ p(predicted), {primary} baseline", top["delta"], "probability"),
                n,
                "No change in probability (Δ = 0)",
                ["Supported requires agreement across at least two baselines.", "The region is selected as the largest of six; not corrected for that choice."] + (res.get("limitations") or [])[:2],
            )
        )
    paired = (res.get("paired") or {}).get(primary) or {}
    rmo = paired.get("recent_minus_oldest")
    if rmo and rmo.get("mean") is not None:
        ex = excludes(rmo, 0.0)
        out.append(
            _f(
                "sensitivity.recency",
                "sensitivity",
                job_id,
                "supported" if ex else "inconclusive",
                ("Recent bars matter more than the oldest bars" if rmo["mean"] < 0 else "The oldest bars matter more than recent bars") if ex else "No measurable recency preference",
                f"Per image, Δ p after masking the recent third minus Δ after masking the oldest third = {_pp(rmo['mean'], 2)} ({primary} baseline).",
                _m("Paired difference (recent − oldest)", rmo, "probability"),
                rmo.get("n"),
                "Equal effect of masking either end",
                ["Negative means masking recent bars lowers the predicted class's probability more.", "One baseline only; compare with the other baselines in the table."],
            )
        )
    return out


def _faithfulness(res: Dict[str, Any], job_id: str) -> List[Dict[str, Any]]:
    rows = res.get("rows") or []
    if not rows:
        return []
    verdicts = []
    for r in rows:
        d, w = r["top_minus_random"], r["win_rate"]
        if excludes(d, 0.0) and d["mean"] > 0 and w.get("lo") is not None and w["lo"] > 0.5:
            verdicts.append("faithful")
        elif excludes(d, 0.0) and d["mean"] < 0:
            verdicts.append("unfaithful")
        else:
            verdicts.append("unclear")
    mid = rows[len(rows) // 2]
    if verdicts.count("faithful") > len(verdicts) / 2:
        status, title = "supported", "Grad-CAM highlights regions the model relies on"
    elif verdicts.count("unfaithful") > len(verdicts) / 2:
        status, title = "supported", "Grad-CAM top regions matter less than matched random regions"
    else:
        status, title = "inconclusive", "Grad-CAM faithfulness is not established for this model"
    return [
        _f(
            "faithfulness",
            "faithfulness",
            job_id,
            status,
            title,
            f"Masking the top {mid['k']} Grad-CAM cells {_drop_text(mid['drop_top'].get('mean'))}; masking the same number of coverage-matched random cells "
            f"{_drop_text(mid['drop_random'].get('mean'))}. The top cells cause the larger drop in {_pct(mid['win_rate']['p'], 0)} of images. "
            f"Verdict per k ({', '.join(str(r['k']) for r in rows)}): {', '.join(verdicts)}.",
            _m(f"Drop(top) − drop(random), k = {mid['k']}", mid["top_minus_random"], "probability"),
            mid["win_rate"].get("n"),
            "Coverage-matched random cells (same number, similar candle coverage)",
            [
                "Faithful requires the difference interval above zero and the win-rate interval above 50% for most k.",
                f"Layer {res.get('layer')}, {res.get('baseline')} baseline; other layers or baselines can differ.",
            ]
            + (res.get("limitations") or [])[:1],
        )
    ]


def _features(res: Dict[str, Any], job_id: str) -> List[Dict[str, Any]]:
    out = []
    chans = res.get("channels") or []
    if not chans:
        return out
    n = (res.get("summary") or {}).get("n")
    total = len(chans)
    dead = res.get("dead_channels") or 0
    if dead:
        out.append(
            _f(
                "features.dead",
                "features",
                job_id,
                "hypothesis" if dead / total >= 0.5 else "observation",
                f"{dead} of {total} channels in {res.get('layer')} never activate",
                f"{dead} channels had zero activation on every sampled image."
                + (" When most channels are inactive, the network may have lost capacity during training (for example through 'dead' ReLUs)." if dead / total >= 0.5 else ""),
                {"label": "Inactive channels", "value": dead / total, "lo": None, "hi": None, "unit": "proportion"},
                n,
                None,
                ["Inactive on this sample; a channel might fire on images outside it.", "Whether this hurts accuracy is not tested here."],
            )
        )
    sep = res.get("label_separating") or {}
    if sep:
        cands = [c for c in chans if c.get("d_label") and c["d_label"].get("d") is not None]
        best = max(cands, key=lambda c: abs(c["d_label"]["d"])) if cands else None
        beyond = sep.get("count", 0) > sep.get("expected_by_chance", 0)
        out.append(
            _f(
                "features.separation",
                "features",
                job_id,
                "hypothesis" if beyond else "inconclusive",
                f"{sep.get('count')} channels separate the labels" + ("" if beyond else " — no more than chance would give"),
                f"{sep.get('count')} of {sep.get('of')} channels have a Cohen's d interval excluding zero (about {sep.get('expected_by_chance')} expected by chance)."
                + (f" Strongest: channel {best['channel']} (d = {best['d_label']['d']:.2f})." if best else ""),
                {"label": f"Cohen's d, channel {best['channel']}", "value": best["d_label"]["d"], "lo": best["d_label"]["lo"], "hi": best["d_label"]["hi"], "unit": "d"} if best else None,
                n,
                "d = 0 (no difference in mean activation between labels)",
                ["Correlational: a channel that separates labels is not shown to drive the prediction.", "No multiplicity correction; the chance count is the reference."],
            )
        )
    return out


def _embedding(res: Dict[str, Any], job_id: str) -> List[Dict[str, Any]]:
    ev = res.get("explained_variance") or []
    if not ev:
        return []
    align = res.get("classifier_alignment") or []
    n = (res.get("summary") or {}).get("n")
    out = [
        _f(
            "embedding.pca",
            "embedding",
            job_id,
            "observation",
            "The penultimate representation is " + ("low-dimensional" if ev[0] >= 0.5 else "spread over many directions"),
            f"PC1 explains {_pct(ev[0])} and PC2 {_pct(ev[1] if len(ev) > 1 else None)} of the variance."
            + (f" PC1's alignment with the classifier direction is |cos| = {align[0]:.2f}." if align and align[0] is not None else ""),
            {"label": "Variance explained by PC1", "value": ev[0], "lo": None, "hi": None, "unit": "share"},
            n,
            None,
            (res.get("caveats") or [])[:2],
        )
    ]
    if res.get("inactive_units"):
        out.append(
            _f(
                "embedding.inactive",
                "embedding",
                job_id,
                "observation",
                f"{res['inactive_units']} of {res.get('dim')} penultimate units are always zero",
                f"{res['inactive_units']} units never activated on the sample, so the classifier reads at most {res['dim'] - res['inactive_units']} effective features.",
                {"label": "Inactive units", "value": res["inactive_units"] / max(1, res.get("dim") or 1), "lo": None, "hi": None, "unit": "proportion"},
                n,
                None,
                ["Inactive on this sample only."],
            )
        )
    return out


BUILDERS = {"atlas": _atlas, "sensitivity": _sensitivity, "faithfulness": _faithfulness, "features": _features, "embedding": _embedding}


def derive(latest: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """``latest`` maps experiment kind → its most recent successful result (with ``job_id``)."""
    findings: List[Dict[str, Any]] = []
    ctx_done = False
    for kind in ("atlas", "sensitivity", "faithfulness", "features", "embedding"):
        res = latest.get(kind)
        if not res:
            continue
        jid = res.get("job_id") or ""
        if not ctx_done:
            findings.extend(_context(res, jid, kind))
            ctx_done = True
        findings.extend(BUILDERS[kind](res, jid))
    return {
        "findings": findings,
        "sources": {k: v.get("job_id") for k, v in latest.items()},
        "rules": __doc__.strip(),
    }
