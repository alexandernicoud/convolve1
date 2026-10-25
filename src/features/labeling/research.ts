import type { Cell, Grid2, Surface } from "./lib";

// ------------------------------------------------------------------
// Ranking modes
// ------------------------------------------------------------------

export type RankMode = "profitability" | "suitability" | "robustness";

export const RANK_MODES: { value: RankMode; label: string; title: string }[] = [
  { value: "profitability", label: "Profitability", title: "Historical CAGR of the staggered portfolio (research period)" },
  { value: "suitability", label: "CNN suitability", title: "How usable these labels look as a CNN training target (0–100, research period)" },
  { value: "robustness", label: "Robustness", title: "Stability across time blocks, neighbouring TP/SL and nearby horizons (0–100)" },
];

export function parseRankMode(v: string | null | undefined): RankMode {
  return v === "suitability" || v === "robustness" ? v : "profitability";
}

// ------------------------------------------------------------------
// research_surface.json
// ------------------------------------------------------------------

export type ResearchMetric =
  | "suitability"
  | "robustness"
  | "label1_share"
  | "samples"
  | "independent"
  | "net_return_bp"
  | "block_range"
  | "required_lift"
  | "eval_label1_share"
  | "eval_samples"
  | "eval_net_return_bp";

/** Decoded research grids, same [hIndex][sl][tp] layout as `Surface`. Shares are 0–1, returns are fractions. */
export type ResearchSurface = {
  version: number;
  metrics: Partial<Record<ResearchMetric, Grid2[]>>;
};

/** Decode the stored integers; null when absent or when its axes differ from the optimizer surface. */
export function researchFromRaw(raw: unknown, surface: Surface | null): ResearchSurface | null {
  if (!raw || typeof raw !== "object" || !surface) return null;
  const r = raw as Record<string, unknown>;
  const same = (a: unknown, b: number[]) => Array.isArray(a) && a.length === b.length && a.every((v, i) => Math.abs(Number(v) - b[i]!) < 1e-9);
  if (!same(r.tp_values, surface.tp) || !same(r.sl_values, surface.sl) || !same(r.horizons, surface.horizons)) return null;
  const metrics = (r.metrics ?? {}) as Record<string, unknown>;
  const scales = (r.scales ?? {}) as Record<string, number>;
  const out: ResearchSurface = { version: Number(r.version) || 0, metrics: {} };
  for (const [name, cube] of Object.entries(metrics)) {
    const scale = Number(scales[name]) || 1;
    if (!Array.isArray(cube) || cube.length !== surface.horizons.length) continue;
    out.metrics[name as ResearchMetric] = cube.map((g: unknown) =>
      Array.isArray(g) ? g.map((row: unknown) => (Array.isArray(row) ? row.map((v) => (typeof v === "number" ? v / scale : null)) : [])) : [],
    );
  }
  return out;
}

export function researchCell(rs: ResearchSurface | null, name: ResearchMetric, hi: number, si: number, ti: number): Cell {
  return rs?.metrics[name]?.[hi]?.[si]?.[ti] ?? null;
}

// ------------------------------------------------------------------
// research_candidates.json
// ------------------------------------------------------------------

export type Period = { start: string; end: string; bars: number; buy_and_hold_return_pct?: number };
export type Periods = { research: Period; evaluation: Period | null; boundary?: string; note?: string };

export type Candidate = {
  tp: number;
  sl: number;
  h: number;
  index: { ti: number; si: number; hi: number };
  ranks: Record<RankMode, number | null>;
  scores: { profitability_cagr_pct: number | null; label_payoff_cagr_pct?: number | null; suitability: number | null; robustness: number | null };
  components: Record<string, number | null>;
  research: {
    samples: number;
    label1_share: number | null;
    label0_share: number | null;
    sl_share: number | null;
    timeout_share: number | null;
    independent: number | null;
    mean_bars_held: number | null;
    block_label1_share: (number | null)[];
    block_range: number | null;
    payoff_sign_consistency: number | null;
    neighbour_agreement: number | null;
    horizon_agreement: number | null;
    net_return_per_sample_pct: number | null;
    label0_mean_return_pct: number | null;
    breakeven_precision: number | null;
    required_lift: number | null;
    reward_to_risk: number | null;
  };
  evaluation: {
    samples: number;
    label1_share: number | null;
    net_return_per_sample_pct: number | null;
    block_label1_share?: (number | null)[];
    profitability_cagr_pct?: number | null;
    profitability_return_pct?: number | null;
    closed_trades?: number;
  } | null;
  flags: string[];
};

export type ScoreDoc = { label: string; formula: string; components: Record<string, string>; gate: string };

export type ResearchCandidates = {
  version: number;
  label: Record<string, string>;
  costs_round_trip_pct: number | null;
  periods: Periods;
  scores: Record<RankMode, ScoreDoc>;
  limitations: string[];
  best: Record<RankMode, { tp: number; sl: number; h: number } | null>;
  scored_cells: Record<RankMode, number>;
  candidates: Candidate[];
  profitability_model?: "mark_to_market" | "label_payoff";
};

export function candidatesFromRaw(raw: unknown): ResearchCandidates | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as ResearchCandidates;
  if (!Array.isArray(r.candidates) || !r.periods?.research) return null;
  return r;
}

export const FLAG_COPY: Record<string, string> = {
  minority_class_below_10pct: "Minority class below 10 %",
  few_non_overlapping_windows: "Fewer than 30 non-overlapping windows",
  label_share_unstable_over_time: "Label share moves by more than half the minority share between time blocks",
  label_share_sensitive_to_tp_sl: "Label share sensitive to small TP/SL changes",
  target_does_not_cover_costs: "Take-profit does not cover costs",
  base_rate_already_above_break_even: "Base rate already above break-even precision",
};

export type SortKey =
  | "rank"
  | "suitability"
  | "robustness"
  | "profitability"
  | "label1_share"
  | "samples"
  | "independent"
  | "block_range"
  | "net_return"
  | "required_lift"
  | "eval_label1_share";

export function sortValue(c: Candidate, key: SortKey, mode: RankMode): number | null {
  switch (key) {
    case "rank":
      return c.ranks[mode] != null ? -c.ranks[mode]! : null;
    case "suitability":
      return c.scores.suitability;
    case "robustness":
      return c.scores.robustness;
    case "profitability":
      return c.scores.profitability_cagr_pct;
    case "label1_share":
      return c.research.label1_share;
    case "samples":
      return c.research.samples;
    case "independent":
      return c.research.independent;
    case "block_range":
      return c.research.block_range;
    case "net_return":
      return c.research.net_return_per_sample_pct;
    case "required_lift":
      return c.research.required_lift;
    case "eval_label1_share":
      return c.evaluation?.label1_share ?? null;
  }
}

/** Stable sort; missing values always last; ties keep the ranking order of `mode`. */
export function sortCandidates(list: Candidate[], key: SortKey, desc: boolean, mode: RankMode): Candidate[] {
  const base = [...list].sort((a, b) => (a.ranks[mode] ?? Infinity) - (b.ranks[mode] ?? Infinity));
  return base
    .map((c, i) => ({ c, i, v: sortValue(c, key, mode) }))
    .sort((a, b) => {
      const av = a.v != null && Number.isFinite(a.v) ? a.v : null;
      const bv = b.v != null && Number.isFinite(b.v) ? b.v : null;
      if (av == null && bv == null) return a.i - b.i;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av !== bv) return desc ? bv - av : av - bv;
      return a.i - b.i;
    })
    .map((x) => x.c);
}

// ------------------------------------------------------------------
// Optimizer → Generator transfer
// ------------------------------------------------------------------

export type GeneratorTransfer = {
  runId: string;
  symbol: string;
  timeframe: "1d";
  tp: number;
  sl: number;
  h: number;
  mode: RankMode;
  researchStart?: string;
  researchEnd?: string;
  methodologyVersion?: number;
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const RUN_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SYMBOL_RE = /^[A-Za-z0-9.^=_-]{1,20}$/;

function isIsoDate(v: string | null | undefined): v is string {
  if (!v || !ISO_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function generatorTransferHref(t: GeneratorTransfer): string {
  const q = new URLSearchParams({
    src: "optimizer",
    opt_run: t.runId,
    symbols: t.symbol,
    tf: t.timeframe,
    tp: String(t.tp),
    sl: String(t.sl),
    h: String(t.h),
    mode: t.mode,
  });
  if (t.researchStart) q.set("rs", t.researchStart);
  if (t.researchEnd) q.set("re", t.researchEnd);
  if (t.methodologyVersion) q.set("mv", String(t.methodologyVersion));
  return `/tools/generator?${q.toString()}`;
}

export type ParsedTransfer = {
  /** Values that passed validation and were applied to the form. */
  values: Partial<GeneratorTransfer>;
  /** Human-readable reasons for every transferred value that was not applied. */
  issues: string[];
};

/** Parse `?src=optimizer…`; null when the query is not an optimizer transfer. */
export function parseGeneratorTransfer(q: URLSearchParams, todayIso: string): ParsedTransfer | null {
  if (q.get("src") !== "optimizer") return null;
  const values: Partial<GeneratorTransfer> = {};
  const issues: string[] = [];
  const run = q.get("opt_run");
  if (run && RUN_RE.test(run)) values.runId = run;
  else issues.push("The optimizer run id is missing or invalid; provenance will not be recorded.");
  const sym = q.get("symbols")?.trim().toUpperCase();
  if (sym && SYMBOL_RE.test(sym)) values.symbol = sym;
  else if (sym) issues.push(`Symbol “${sym}” is not a valid ticker.`);
  const tf = q.get("tf");
  if (tf === "1d") values.timeframe = "1d";
  else if (tf) issues.push(`Timeframe “${tf}” is not supported for optimizer transfers (the optimizer searches daily bars).`);
  const frac = (key: "tp" | "sl", name: string) => {
    const raw = q.get(key);
    if (raw == null) return;
    const v = Number(raw);
    if (Number.isFinite(v) && v > 0 && v <= 1) values[key] = v;
    else issues.push(`${name} “${raw}” is outside the Generator's range (0–100 %).`);
  };
  frac("tp", "Take profit");
  frac("sl", "Stop loss");
  const hRaw = q.get("h");
  if (hRaw != null) {
    const h = Number(hRaw);
    if (Number.isInteger(h) && h >= 1 && h <= 1000) values.h = h;
    else issues.push(`Horizon “${hRaw}” must be a whole number of bars between 1 and 1000.`);
  }
  values.mode = parseRankMode(q.get("mode"));
  const rs = q.get("rs");
  const re = q.get("re");
  if (rs || re) {
    if (!isIsoDate(rs) || !isIsoDate(re)) issues.push("The research period dates are invalid; the training window was left unchanged.");
    else if (rs >= re) issues.push("The research period starts after it ends; the training window was left unchanged.");
    else if (re > todayIso) issues.push("The research period ends in the future; the training window was left unchanged.");
    else {
      values.researchStart = rs;
      values.researchEnd = re;
    }
  }
  const mv = Number(q.get("mv"));
  if (Number.isInteger(mv) && mv >= 1 && mv <= 99) values.methodologyVersion = mv;
  return { values, issues };
}

/** Provenance stored with the Generator request (whitelisted again by the API). */
export function transferProvenance(v: Partial<GeneratorTransfer>): Record<string, string | number> | null {
  if (!v.runId) return null;
  const out: Record<string, string | number> = { run_id: v.runId };
  if (v.mode) out.mode = v.mode;
  if (v.symbol) out.symbol = v.symbol;
  if (v.tp != null) out.tp = v.tp;
  if (v.sl != null) out.sl = v.sl;
  if (v.h != null) out.h = v.h;
  if (v.researchStart) out.research_start = v.researchStart;
  if (v.researchEnd) out.research_end = v.researchEnd;
  if (v.methodologyVersion) out.methodology_version = v.methodologyVersion;
  return out;
}
