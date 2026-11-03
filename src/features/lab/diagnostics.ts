import { fmtNum, fmtPct, fmtPp } from "@/lib/viz/format";
import type { CI, ExperimentKind, Prop } from "./api";
import { excludes } from "./lib";

export type DiagState = "missing" | "rerun" | "ok" | "attention" | "unclear" | "info" | "unavailable";

export type Diagnostic = {
  id: string;
  title: string;
  question: string;
  /** Experiments this check reads; the first missing one is what "Run" launches. */
  kinds: ExperimentKind[];
  state: DiagState;
  headline: string;
  details: string[];
  /** Lab tab with the full result. */
  tab: string;
  /** A controlled retraining comparison worth trying, as an Improve preset. */
  improve: { preset: string; reason: string } | null;
};

export type LabResults = Partial<Record<ExperimentKind, Record<string, unknown> | null>>;

/** Defaults for guided runs: whole dataset, fixed seed, so a rerun reuses the stored result. */
export const GUIDED_PARAMS: Record<ExperimentKind, Record<string, unknown>> = {
  atlas: { n: 200, seed: 0 },
  sensitivity: { n: 100, seed: 0, occlusion: false },
  faithfulness: { n: 100, seed: 0 },
  features: { n: 200, seed: 0 },
  embedding: { n: 500, seed: 0 },
  stability: { n: 100, seed: 0 },
};

type FaithRow = { k: number; masked_fraction: number; drop_top: CI; drop_random: CI; drop_bottom: CI; top_minus_random: CI; win_rate: Prop };
type Border = { attention: CI; ink: CI; area: number | null };
type SplitStats = { n: number; accuracy: Prop | null; confidence: CI };

const mean = (ci: CI | null | undefined) => (ci && typeof ci.mean === "number" ? ci.mean : null);
const ciText = (ci: CI, f: (v: number) => string) => (ci.lo != null && ci.hi != null ? `${f(ci.mean ?? 0)} (95% CI ${f(ci.lo)} to ${f(ci.hi)})` : f(ci.mean ?? 0));
const drop = (v: number | null) => (v == null ? "—" : fmtPp(v, 2));
const absPp = (v: number | null) => (v == null ? "—" : `${(Math.abs(v) * 100).toFixed(2)} pp`);

function missing(base: Omit<Diagnostic, "state" | "headline" | "details">, kind: ExperimentKind): Diagnostic {
  return { ...base, kinds: [kind, ...base.kinds.filter((k) => k !== kind)], state: "missing", headline: "Not run yet for this session.", details: [] };
}

function faithfulness(r: LabResults): Diagnostic {
  const base = {
    id: "faithfulness",
    title: "Faithfulness of Grad-CAM",
    question: "If the regions Grad-CAM highlights are removed, does the prediction weaken more than when random regions are removed?",
    kinds: ["faithfulness"] as ExperimentKind[],
    tab: "sensitivity",
    improve: null,
  };
  const res = r.faithfulness;
  const rows = (res?.rows as FaithRow[] | undefined) ?? [];
  if (!res || !rows.length) return missing(base, "faithfulness");
  const mid = rows[Math.floor(rows.length / 2)];
  const d = mid.top_minus_random;
  const faithful = excludes(d, 0) && (d.mean ?? 0) > 0 && (mid.win_rate.lo ?? 0) > 0.5;
  const reversed = excludes(d, 0) && (d.mean ?? 0) < 0;
  return {
    ...base,
    state: faithful ? "ok" : reversed ? "attention" : "unclear",
    headline: faithful
      ? "Yes. Masking Grad-CAM's top regions hurts the prediction more than masking matched random regions."
      : reversed
        ? "No. Grad-CAM's top regions matter less than matched random regions, so its maps should not be read as the model's reasons."
        : "Not established. The difference from matched random regions is within noise.",
    details: [
      `Masking the top ${mid.k} of ${Math.round(mid.k / mid.masked_fraction)} cells changes the predicted class's probability by ${drop(-(mean(mid.drop_top) ?? 0))}; matched random cells ${drop(-(mean(mid.drop_random) ?? 0))}.`,
      `Top minus random drop: ${ciText(d, (v) => fmtPp(v, 2))}. Top cells cause the larger drop in ${fmtPct(mid.win_rate.p, 0)} of images.`,
      ...(typeof res.n_all_zero === "number" && res.n_all_zero > 0 ? [`${res.n_all_zero} images were skipped because their Grad-CAM map was all zero.`] : []),
    ],
    improve: reversed ? { preset: "gap", reason: "A global-average-pooling head ties class evidence more directly to spatial maps; compare whether attribution becomes more faithful." } : null,
  };
}

function randomMask(r: LabResults): Diagnostic {
  const base = {
    id: "random-mask",
    title: "Reaction to random masking",
    question: "Does the output change at all when parts of the chart are removed, or is the prediction nearly constant?",
    kinds: ["faithfulness"] as ExperimentKind[],
    tab: "sensitivity",
    improve: null,
  };
  const rows = (r.faithfulness?.rows as FaithRow[] | undefined) ?? [];
  if (!rows.length) return missing(base, "faithfulness");
  const largest = rows[rows.length - 1];
  const rand = Math.abs(mean(largest.drop_random) ?? 0);
  const top = Math.abs(mean(largest.drop_top) ?? 0);
  const inert = Math.max(rand, top) < 0.01;
  return {
    ...base,
    state: inert ? "attention" : "info",
    headline: inert
      ? `Removing ${fmtPct(largest.masked_fraction, 0)} of the chart moves the probability by less than one percentage point. The model's output barely depends on image content.`
      : `Removing ${fmtPct(largest.masked_fraction, 0)} of the chart in random cells changes the probability by ${drop(-(mean(largest.drop_random) ?? 0))} on average, so the output does depend on what is drawn.`,
    details: rows.map(
      (row) =>
        `${fmtPct(row.masked_fraction, 0)} masked: top cells ${drop(-(mean(row.drop_top) ?? 0))}, random cells ${drop(-(mean(row.drop_random) ?? 0))}, lowest-attribution cells with candles ${drop(-(mean(row.drop_bottom) ?? 0))}.`,
    ),
    improve: inert ? { preset: "lr", reason: "A near-constant output often means training collapsed to the base rate; compare learning rates." } : null,
  };
}

function backgroundBorder(r: LabResults): Diagnostic {
  const base = {
    id: "background",
    title: "Background, border and artifact attention",
    question: "Does attention fall on candles, on empty background, or on the image border where padding and frame artifacts live?",
    kinds: ["atlas"] as ExperimentKind[],
    tab: "atlas",
    improve: null,
  };
  const prof = r.atlas?.profile as { foreground_share?: CI; foreground_area?: CI; border?: Border } | undefined;
  if (!r.atlas || !prof) return missing(base, "atlas");
  if (!prof.border) return { ...base, state: "rerun", headline: "This atlas was computed before the border measurement existed. Run it again to add it.", details: [] };
  const fg = prof.foreground_share, area = mean(prof.foreground_area);
  const b = prof.border;
  const ref = Math.max(b.area ?? 0, mean(b.ink) ?? 0);
  const heavy = excludes(b.attention, ref) && (mean(b.attention) ?? 0) > ref;
  const onBackground = fg && area != null && excludes(fg, area) && (fg.mean ?? 0) < area;
  return {
    ...base,
    state: heavy ? "attention" : "ok",
    headline: heavy
      ? "Grad-CAM puts more mass on the image border than its area or candle content explains. This can be a padding or frame artifact."
      : "No excess attention on the image border.",
    details: [
      `Border band: ${fmtPct(b.area, 1)} of the image, ${fmtPct(mean(b.ink), 1)} of candle pixels, ${ciText(b.attention, (v) => fmtPct(v, 1))} of Grad-CAM mass.`,
      fg && area != null
        ? `${fmtPct(fg.mean, 1)} of Grad-CAM mass is on candle pixels, which cover ${fmtPct(area, 1)} of the image.` +
          (onBackground ? " Background attention is not automatically wrong: empty space encodes where price did not go." : "")
        : "Candle coverage was not measured.",
      "The right border also holds the most recent bar; read this together with the recency check before calling it an artifact.",
    ],
    improve: heavy ? { preset: "gap", reason: "A global-average-pooling head cannot weight fixed image positions, which removes one route to border artifacts." } : null,
  };
}

function recency(r: LabResults): Diagnostic {
  const base = {
    id: "recency",
    title: "Recent vs older prices",
    question: "Does removing the most recent bars change the prediction more than removing the oldest bars?",
    kinds: ["sensitivity"] as ExperimentKind[],
    tab: "sensitivity",
    improve: null,
  };
  const res = r.sensitivity;
  const paired = res?.paired as Record<string, { recent_minus_oldest?: CI }> | undefined;
  if (!res || !paired) return missing(base, "sensitivity");
  const entries = Object.entries(paired).filter(([, v]) => v.recent_minus_oldest && v.recent_minus_oldest.mean != null);
  if (!entries.length) return { ...base, state: "unclear", headline: "No paired recency measurement in this result.", details: [] };
  const [primary, v] = entries[0];
  const rmo = v.recent_minus_oldest as CI;
  const agree = entries.filter(([, e]) => excludes(e.recent_minus_oldest as CI, 0) && Math.sign(e.recent_minus_oldest!.mean ?? 0) === Math.sign(rmo.mean ?? 0)).length;
  const ex = excludes(rmo, 0);
  return {
    ...base,
    state: ex ? "info" : "unclear",
    headline: ex
      ? (rmo.mean ?? 0) < 0
        ? "Recent bars matter more: masking them lowers the predicted class's probability more than masking the oldest bars."
        : "Older bars matter more than the most recent bars. Unusual for short-horizon labels; check the window length and label horizon."
      : "No measurable preference between recent and older bars.",
    details: [
      `Per image, Δ after masking the recent third minus Δ after masking the oldest third: ${ciText(rmo, (x) => fmtPp(x, 2))} (${primary} baseline).`,
      `Same direction with an interval excluding zero for ${agree} of ${entries.length} masking baselines.`,
    ],
  };
}

function inactive(r: LabResults): Diagnostic {
  const base = {
    id: "inactive",
    title: "Inactive channels and units",
    question: "How many convolution channels and penultimate units never activate?",
    kinds: ["features", "embedding"] as ExperimentKind[],
    tab: "features",
    improve: null,
  };
  const feats = r.features as { dead_channels?: number; channels?: unknown[]; layer?: string } | null | undefined;
  const emb = r.embedding as { inactive_units?: number; dim?: number } | null | undefined;
  if (!feats && !emb) return missing(base, "features");
  const parts: string[] = [];
  let worst = 0;
  if (feats?.channels?.length) {
    const share = (feats.dead_channels ?? 0) / feats.channels.length;
    worst = Math.max(worst, share);
    parts.push(`${feats.dead_channels ?? 0} of ${feats.channels.length} channels in ${feats.layer} never activated on the sample.`);
  }
  if (emb?.dim) {
    const share = (emb.inactive_units ?? 0) / emb.dim;
    worst = Math.max(worst, share);
    parts.push(`${emb.inactive_units ?? 0} of ${emb.dim} penultimate units are always zero.`);
  }
  if (!feats) parts.push("Run the feature laboratory to check the last convolution layer.");
  if (!emb) parts.push("Run the representation projection to check the penultimate layer.");
  const many = worst >= 0.5;
  return {
    ...base,
    kinds: !feats ? ["features", "embedding"] : !emb ? ["embedding", "features"] : base.kinds,
    state: many ? "attention" : "ok",
    headline: many
      ? `${fmtPct(worst, 0)} of units in at least one layer never activate. The network may have lost capacity during training ("dead" ReLUs).`
      : "Most channels and units are active on this sample.",
    details: parts,
    improve: many ? { preset: "lr", reason: "Dead ReLUs are often caused by a learning rate that is too high; compare a lower one." } : null,
  };
}

function stability(r: LabResults): Diagnostic {
  const base = {
    id: "stability",
    title: "Rendering stability",
    question: "Do predictions survive small edits a different renderer or image pipeline could introduce (2 px shifts, resampling, light blur, colour quantization)?",
    kinds: ["stability"] as ExperimentKind[],
    tab: "diagnostics",
    improve: null,
  };
  const res = r.stability as { any_flip?: Prop; any_flip_confident?: Prop | null; rows?: { description: string; abs_delta: CI; flip_rate: Prop }[] } | null | undefined;
  if (!res) return missing(base, "stability");
  const flip = res.any_flip_confident ?? res.any_flip;
  if (!flip || flip.p == null) return { ...base, state: "unclear", headline: "Not enough images to measure.", details: [] };
  const state: DiagState = flip.lo != null && flip.lo > 0.05 ? "attention" : flip.hi != null && flip.hi < 0.05 ? "ok" : "unclear";
  return {
    ...base,
    state,
    headline:
      state === "attention"
        ? `${fmtPct(flip.p, 0)} of confidently predicted charts change class under at least one harmless edit. Predictions depend on rendering details.`
        : state === "ok"
          ? "Predictions are stable under small rendering edits."
          : `${fmtPct(flip.p, 0)} of confidently predicted charts change class under at least one edit; the interval spans the 5% reference.`,
    details: (res.rows ?? []).map((row) => `${row.description}: mean |Δ| ${absPp(row.abs_delta.mean)}, flips ${fmtPct(row.flip_rate.p, 0)}.`),
    improve: state === "attention" ? { preset: "regularize", reason: "Stronger regularization or a smaller network can reduce reliance on pixel-level detail; compare on the same split." } : null,
  };
}

function splits(r: LabResults, splitKnown: boolean): Diagnostic {
  const base = {
    id: "splits",
    title: "Training vs validation representation",
    question: "Does the model treat images it was trained on differently from held-out validation images?",
    kinds: ["embedding"] as ExperimentKind[],
    tab: "representation",
    improve: null,
  };
  if (!splitKnown) return { ...base, state: "unavailable", headline: "Which images were used for training is not recorded for this model and dataset, so the comparison cannot be made.", details: [] };
  const emb = r.embedding;
  if (!emb) return missing(base, "embedding");
  if (!("splits" in emb)) return { ...base, state: "rerun", headline: "This projection was computed before the split comparison existed. Run it again to add it.", details: [] };
  const sp = emb.splits as { training: SplitStats; validation: SplitStats; centroid_shift: number | null } | null;
  if (!sp || sp.centroid_shift == null) return { ...base, state: "unclear", headline: "Fewer than 5 training or validation images in the sample.", details: [] };
  const at = sp.training.accuracy, av = sp.validation.accuracy;
  const gap = at && av && at.lo != null && av.hi != null && at.lo > av.hi;
  const apart = sp.centroid_shift >= 0.5;
  const pointGap = (at?.p ?? 0) - (av?.p ?? 0);
  return {
    ...base,
    state: gap || apart ? "attention" : pointGap > 0.05 ? "unclear" : "ok",
    headline: gap
      ? "Training images are classified clearly better than validation images: a sign of memorization."
      : apart
        ? "Training and validation images sit apart in the representation, beyond the typical within-split spread."
        : pointGap > 0.05
          ? `Training accuracy is ${fmtPp(pointGap, 1)} higher, but the intervals overlap at this sample size; the representations overlap.`
          : "Training and validation images look alike to the model.",
    details: [
      `Accuracy: training ${fmtPct(at?.p, 1)} (n = ${sp.training.n}), validation ${fmtPct(av?.p, 1)} (n = ${sp.validation.n}).`,
      `Mean confidence: training ${fmtPct(sp.training.confidence.mean, 1)}, validation ${fmtPct(sp.validation.confidence.mean, 1)}.`,
      `Centroid shift ${fmtNum(sp.centroid_shift, 2)} (0 = same centre; 1 = apart by one typical spread). Splits that cover different periods also shift.`,
    ],
    improve: gap ? { preset: "regularize", reason: "A train–validation gap is what dropout and L2 target; compare on the same split." } : null,
  };
}

export function diagnose(r: LabResults, opts: { splitKnown: boolean }): Diagnostic[] {
  return [faithfulness(r), randomMask(r), backgroundBorder(r), recency(r), inactive(r), stability(r), splits(r, opts.splitKnown)];
}

/** Images whose Grad-CAM map was all zero, per experiment that reports it. */
export function allZeroCounts(r: LabResults): { kind: ExperimentKind; zero: number; of: number }[] {
  const out: { kind: ExperimentKind; zero: number; of: number }[] = [];
  for (const kind of ["atlas", "faithfulness"] as const) {
    const res = r[kind];
    if (res && typeof res.n_all_zero === "number") out.push({ kind, zero: res.n_all_zero, of: res.n_all_zero + ((res.n_used as number) ?? 0) });
  }
  return out;
}

export function improveLink(modelKind: string, modelId: string, sessionId: string | null, preset: string | null): string | null {
  if (modelKind !== "trained") return null;
  const q = new URLSearchParams({ model: `trained:${modelId}` });
  q.set("from", sessionId ? `analysis:${sessionId}` : "analysis");
  if (preset) q.set("preset", preset);
  return `/tools/improve?${q.toString()}`;
}
