/** Pure helpers for the labeling optimizer results page (no React). */

export type Cell = number | null;
export type Grid2 = Cell[][]; // [slIndex][tpIndex]

export type Model = "label" | "mtm";

export type Surface = {
  tp: number[];
  sl: number[];
  horizons: number[];
  label: Grid2[]; // [hIndex][sl][tp]
  mtm: Grid2[] | null;
  best: { tp: number; sl: number; h: number };
  source: "audit" | "heatmaps";
};

export type Neighbourhood = {
  best: number;
  count: number;
  median: number;
  min: number;
  max: number;
  median_ratio: number;
  share_within_25pct: number;
  share_within_50pct: number;
};

export type Region = "plateau" | "ridge" | "isolated" | "unknown";

export type AuditCandidate = {
  rank: number;
  tp: number;
  sl: number;
  h: number;
  sl_min: number;
  sl_max: number;
  tied: number;
  cagr_pct: number | null;
  mtm_cagr_pct: number | null;
  trades: number;
  tp_share: number | null;
  max_dd_pct: number | null;
  neighbour_median_ratio: number | null;
  region: Region;
};

export type AuditDefect = {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
};

export type Audit = {
  version: number;
  symbol: string;
  start: string;
  end: string;
  bars: number;
  years: number | null;
  objective: { key: string; label: string };
  evaluation: "in_sample" | "out_of_sample";
  payoff_model: {
    name: string;
    entry: string;
    sizing: string;
    exits: string;
    expiry: string;
    costs_round_trip_pct: number | null;
  };
  best: {
    tp: number;
    sl: number;
    h: number;
    cagr_pct: number | null;
    total_return_pct: number | null;
    linear_pl_per_year_pct: number | null;
    trades_counted: number;
    tp_share: number | null;
    max_dd_realized_pct: number | null;
    reproduced: boolean;
    ties: number;
    tie_sl_values: number[];
    tie_tp_values: number[];
    tie_horizons: number[];
  };
  exits: {
    tp_hits: number;
    sl_hits: number;
    expiries: number;
    expiry_mean_move_pct: number | null;
    expiry_negative_share: number | null;
  };
  mark_to_market: {
    description: string;
    cagr_pct: number | null;
    total_return_pct: number | null;
    max_dd_marked_pct: number | null;
    label_max_dd_marked_pct: number | null;
    best_under_mtm: { tp: number; sl: number; h: number; cagr_pct: number | null; label_model_cagr_pct: number | null } | null;
    grid_available: boolean;
  };
  asset: { total_return_pct: number | null; cagr_pct: number | null };
  robustness: {
    region: Region;
    label_model: Neighbourhood | null;
    mark_to_market: Neighbourhood | null;
    cells_within_10pct_of_best: number | null;
    grid_cells: number;
  };
  walk_forward:
    | { available: false; reason: string }
    | {
        available: true;
        train_fraction: number;
        train: {
          start: string;
          end: string;
          bars: number;
          selected: { tp: number; sl: number; h: number };
          in_sample_return_pct: number | null;
        };
        test: {
          start: string;
          end: string;
          bars: number;
          label_model_return_pct: number | null;
          mark_to_market_return_pct: number | null;
          buy_and_hold_return_pct: number | null;
          tp_hits: number;
          sl_hits: number;
          expiries: number;
        };
        test_percentile_label_model: number | null;
      };
  configuration: { field: string; configured: unknown; applied: unknown; match: boolean; note: string | null }[];
  defects: AuditDefect[];
  candidates: AuditCandidate[];
  verdict: { evidence: string; recommend: boolean; out_of_sample_beats_buy_and_hold: boolean };
  series: { dates: string[]; label_model_pct: Cell[]; mark_to_market_pct: Cell[]; asset_pct: Cell[] };
};

// ------------------------------------------------------------------
// Formatting
// ------------------------------------------------------------------

export function fmtPct(v: number | null | undefined, digits = 1, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v.toFixed(digits);
  return `${signed && v > 0 ? "+" : ""}${s}%`;
}

/** Fraction (0.0215) → "2.15%". */
export function fmtFrac(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtSlRange(c: { sl: number; sl_min?: number; sl_max?: number; tied?: number }): string {
  if (c.tied && c.tied > 1 && c.sl_min != null && c.sl_max != null && c.sl_min !== c.sl_max) {
    return `${fmtFrac(c.sl_min, 1)}–${fmtFrac(c.sl_max, 1)}`;
  }
  return fmtFrac(c.sl, 2);
}

// ------------------------------------------------------------------
// Surface normalisation
// ------------------------------------------------------------------

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function asGrid(raw: unknown, nSl: number, nTp: number): Grid2 | null {
  if (!Array.isArray(raw) || raw.length !== nSl) return null;
  const out: Grid2 = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== nTp) return null;
    out.push(row.map((v) => (isNum(v) ? v : null)));
  }
  return out;
}

export function surfaceFromAudit(raw: unknown): Surface | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const tp = r.tp_values, sl = r.sl_values, hs = r.horizons, lab = r.label_model;
  if (!Array.isArray(tp) || !Array.isArray(sl) || !Array.isArray(hs) || !Array.isArray(lab)) return null;
  if (lab.length !== hs.length) return null;
  const label: Grid2[] = [];
  for (const g of lab) {
    const grid = asGrid(g, sl.length, tp.length);
    if (!grid) return null;
    label.push(grid);
  }
  let mtm: Grid2[] | null = null;
  if (Array.isArray(r.mark_to_market) && r.mark_to_market.length === hs.length) {
    const tmp: Grid2[] = [];
    for (const g of r.mark_to_market) {
      const grid = asGrid(g, sl.length, tp.length);
      if (!grid) break;
      tmp.push(grid);
    }
    if (tmp.length === hs.length) mtm = tmp;
  }
  const b = (r.best ?? {}) as Record<string, unknown>;
  return {
    tp: tp as number[],
    sl: sl as number[],
    horizons: hs as number[],
    label,
    mtm,
    best: { tp: Number(b.tp), sl: Number(b.sl), h: Number(b.h) },
    source: "audit",
  };
}

/** Older runs: heatmaps_cagr.json holds a handful of horizon slices, label model only. */
export function surfaceFromHeatmaps(
  raw: unknown,
  best: { tp: number; sl: number; h: number } | null,
): Surface | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const tp = r.tp_values, sl = r.sl_values, hm = r.horizons;
  if (!Array.isArray(tp) || !Array.isArray(sl) || !hm || typeof hm !== "object") return null;
  const keys = Object.keys(hm as object).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const label: Grid2[] = [];
  const horizons: number[] = [];
  for (const k of keys) {
    const g = asGrid((hm as Record<string, unknown>)[String(k)], sl.length, tp.length);
    if (g) {
      label.push(g);
      horizons.push(k);
    }
  }
  if (!horizons.length) return null;
  return {
    tp: tp as number[],
    sl: sl as number[],
    horizons,
    label,
    mtm: null,
    best: best ?? { tp: NaN, sl: NaN, h: horizons[0]! },
    source: "heatmaps",
  };
}

export function nearestIndex(values: number[], v: number): number {
  let best = 0;
  let d = Infinity;
  values.forEach((x, i) => {
    const e = Math.abs(x - v);
    if (e < d) {
      d = e;
      best = i;
    }
  });
  return best;
}

export function sliceFor(surface: Surface, model: Model, hIndex: number): Grid2 | null {
  const src = model === "mtm" ? surface.mtm : surface.label;
  return src?.[hIndex] ?? null;
}

// ------------------------------------------------------------------
// Stability
// ------------------------------------------------------------------

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** 8-neighbourhood at a fixed horizon (2D). Same ratios as the backend audit. */
export function neighbourhood2D(grid: Grid2, si: number, ti: number): Neighbourhood | null {
  const best = grid[si]?.[ti];
  if (!isNum(best)) return null;
  const vals: number[] = [];
  for (let ds = -1; ds <= 1; ds++) {
    for (let dt = -1; dt <= 1; dt++) {
      if (!ds && !dt) continue;
      const v = grid[si + ds]?.[ti + dt];
      if (isNum(v)) vals.push(v);
    }
  }
  if (!vals.length) return null;
  const ratios = Math.abs(best) > 1e-12 ? vals.map((v) => v / best) : vals.map(() => NaN);
  return {
    best,
    count: vals.length,
    median: median(vals),
    min: Math.min(...vals),
    max: Math.max(...vals),
    median_ratio: median(ratios),
    share_within_25pct: ratios.filter((r) => r >= 0.75).length / ratios.length,
    share_within_50pct: ratios.filter((r) => r >= 0.5).length / ratios.length,
  };
}

export function classifyRegion(nb: Neighbourhood | null | undefined): Region {
  if (!nb) return "unknown";
  if (nb.best <= 0) return "unknown";
  if (nb.share_within_25pct >= 0.6 && nb.median_ratio >= 0.75) return "plateau";
  if (nb.share_within_50pct >= 0.5) return "ridge";
  return "isolated";
}

export const REGION_COPY: Record<Region, { label: string; detail: string }> = {
  plateau: { label: "Stable plateau", detail: "Most neighbouring parameters score within 25% of the peak." },
  ridge: { label: "Narrow ridge", detail: "About half of the neighbours keep at least half of the score." },
  isolated: { label: "Isolated peak", detail: "Small parameter changes lose most of the score." },
  unknown: { label: "Not assessed", detail: "Neighbouring scores are unavailable or the peak is not positive." },
};

/** Value of one TP/SL cell across all horizons. */
export function cellProfile(surface: Surface, model: Model, si: number, ti: number): Cell[] {
  const src = model === "mtm" ? surface.mtm : surface.label;
  if (!src) return [];
  return src.map((g) => g[si]?.[ti] ?? null);
}

/** Highest value per horizon (envelope). */
export function horizonEnvelope(surface: Surface, model: Model): Cell[] {
  const src = model === "mtm" ? surface.mtm : surface.label;
  if (!src) return [];
  return src.map((g) => {
    let m: number | null = null;
    for (const row of g) for (const v of row) if (isNum(v) && (m == null || v > m)) m = v;
    return m;
  });
}

/** Share of the slice the cell beats (0–100). */
export function percentileInSlice(grid: Grid2, si: number, ti: number): number | null {
  const v = grid[si]?.[ti];
  if (!isNum(v)) return null;
  let below = 0;
  let n = 0;
  for (const row of grid) {
    for (const x of row) {
      if (!isNum(x)) continue;
      n++;
      if (x < v) below++;
    }
  }
  return n ? (below / n) * 100 : null;
}

/** Largest |value| across slices (colour domain). */
export function maxAbs(grids: (Grid2 | null)[]): number {
  let m = 0;
  for (const g of grids) if (g) for (const row of g) for (const v of row) if (isNum(v) && Math.abs(v) > m) m = Math.abs(v);
  return Math.max(m, 1);
}

/** Signed log compression so a few extreme cells don't flatten the rest of the colour scale. */
export function signedLog(v: number): number {
  return Math.sign(v) * Math.log10(1 + Math.abs(v));
}

export function signedLogTicks(limit: number): { vals: number[]; text: string[] } {
  const steps = [-1000, -100, -50, -20, 0, 20, 100, 500, 2000, 10000].filter((v) => Math.abs(v) <= limit);
  return { vals: steps.map(signedLog), text: steps.map((v) => `${v > 0 ? "+" : ""}${v.toLocaleString("en-US")}%`) };
}

// ------------------------------------------------------------------
// Flattened grid (3D view, scatter)
// ------------------------------------------------------------------

/** One entry per grid cell, column-oriented so WebGL traces can use the arrays directly. */
export type FlatGrid = {
  n: number;
  tp: Float64Array;
  sl: Float64Array;
  h: Float64Array;
  label: Float64Array;
  mtm: Float64Array | null;
  /** Packed indices: hi * nSl * nTp + si * nTp + ti. */
  index: Int32Array;
};

export function flattenSurface(s: Surface): FlatGrid {
  const nTp = s.tp.length;
  const nSl = s.sl.length;
  const nH = s.horizons.length;
  const n = nTp * nSl * nH;
  const out: FlatGrid = {
    n,
    tp: new Float64Array(n),
    sl: new Float64Array(n),
    h: new Float64Array(n),
    label: new Float64Array(n),
    mtm: s.mtm ? new Float64Array(n) : null,
    index: new Int32Array(n),
  };
  let k = 0;
  for (let hi = 0; hi < nH; hi++) {
    for (let si = 0; si < nSl; si++) {
      for (let ti = 0; ti < nTp; ti++) {
        out.tp[k] = s.tp[ti]!;
        out.sl[k] = s.sl[si]!;
        out.h[k] = s.horizons[hi]!;
        out.label[k] = s.label[hi]?.[si]?.[ti] ?? NaN;
        if (out.mtm) out.mtm[k] = s.mtm?.[hi]?.[si]?.[ti] ?? NaN;
        out.index[k] = hi * nSl * nTp + si * nTp + ti;
        k++;
      }
    }
  }
  return out;
}

export function unpackIndex(s: Surface, packed: number): { hi: number; si: number; ti: number } {
  const nTp = s.tp.length;
  const nSl = s.sl.length;
  const hi = Math.floor(packed / (nSl * nTp));
  const rem = packed - hi * nSl * nTp;
  return { hi, si: Math.floor(rem / nTp), ti: rem % nTp };
}

/** Score at or above which the top `share` (0–1] of finite values lie. */
export function quantileThreshold(values: ArrayLike<number>, share: number): number {
  const finite: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]!)) finite.push(values[i]!);
  if (!finite.length || share >= 1) return -Infinity;
  finite.sort((a, b) => b - a);
  const k = Math.max(0, Math.min(finite.length - 1, Math.ceil(finite.length * share) - 1));
  return finite[k]!;
}

// ------------------------------------------------------------------
// Calendar
// ------------------------------------------------------------------

/**
 * Calendar-year returns from a cumulative % series. Each year is measured from the last session of
 * the previous year (the first session for the first year) to its own last session, so the years
 * chain to the total — the same convention as the optimizer's `yearly_returns` export.
 */
export function yearlyReturns(dates: string[], cumPct: Cell[]): { year: string; value: number | null; sessions: number; first: string; last: string }[] {
  const out: { year: string; value: number | null; sessions: number; first: string; last: string }[] = [];
  let prevLast: number | null = null;
  let cur: { year: string; start: number | null; last: number | null; sessions: number; first: string; lastDate: string } | null = null;
  const flush = () => {
    if (!cur) return;
    const value = cur.start != null && cur.last != null && 1 + cur.start / 100 > 0 ? ((1 + cur.last / 100) / (1 + cur.start / 100) - 1) * 100 : null;
    out.push({ year: cur.year, value, sessions: cur.sessions, first: cur.first, last: cur.lastDate });
    prevLast = cur.last;
  };
  for (let i = 0; i < dates.length; i++) {
    const y = String(dates[i]).slice(0, 4);
    const v = cumPct[i];
    if (!cur || cur.year !== y) {
      flush();
      cur = { year: y, start: prevLast ?? (isNum(v) ? v : null), last: null, sessions: 0, first: String(dates[i]).slice(0, 10), lastDate: "" };
    }
    if (isNum(v)) {
      if (cur.start == null) cur.start = v;
      cur.last = v;
    }
    cur.sessions++;
    cur.lastDate = String(dates[i]).slice(0, 10);
  }
  flush();
  return out;
}

// ------------------------------------------------------------------
// Conclusion
// ------------------------------------------------------------------

export type Tone = "bad" | "warn" | "neutral" | "good";

export type ConclusionItem = { key: string; label: string; value: string; detail?: string; tone: Tone };

export type Conclusion = {
  status: { label: string; tone: Tone };
  headline: string;
  summary: string;
  items: ConclusionItem[];
  nextSteps: string[];
};

type MetricsLike = {
  best_tp?: number;
  best_sl?: number;
  best_h?: number;
  best_cagr?: number;
  asset_annual_cagr_pct?: number;
  trades?: number;
};

export function buildConclusion(audit: Audit | null, metrics: MetricsLike | null, localNb: Neighbourhood | null): Conclusion {
  if (audit) return auditedConclusion(audit);
  return unauditedConclusion(metrics, localNb);
}

function paramsText(tp: number, sl: number, h: number, ties?: number, slVals?: number[]): string {
  const slText =
    ties && ties > 1 && slVals && slVals.length > 1
      ? `SL ${fmtFrac(Math.min(...slVals), 1)}–${fmtFrac(Math.max(...slVals), 1)} (${ties} tied)`
      : `SL ${fmtFrac(sl)}`;
  return `TP ${fmtFrac(tp)} · ${slText} · ${h} day${h === 1 ? "" : "s"}`;
}

function auditedConclusion(a: Audit): Conclusion {
  const score = a.best.cagr_pct;
  const mtm = a.mark_to_market.cagr_pct;
  const asset = a.asset.cagr_pct;
  const region = a.robustness.region;
  const nb = a.robustness.label_model;
  const wf = a.walk_forward;
  const expiryDefect = a.defects.some((d) => d.id === "expiry_zero");
  const configMismatch = a.configuration.some((c) => !c.match && c.field !== "min_trades");
  const totalPositions = a.exits.tp_hits + a.exits.sl_hits + a.exits.expiries;

  const mtmFails = mtm != null && (mtm < 0 || (asset != null && mtm < asset));
  const headline = mtmFails
    ? `The ${fmtPct(score, 0)} score does not hold up once expired trades are valued at market`
    : region === "isolated"
      ? "The highest score sits on an isolated peak of an in-sample search"
      : "A promising in-sample region that still needs independent validation";

  const parts: string[] = [];
  parts.push(
    `Maximising the ${a.objective.label.charAt(0).toLowerCase()}${a.objective.label.slice(1)} over ${a.robustness.grid_cells.toLocaleString()} combinations selected ${paramsText(
      a.best.tp, a.best.sl, a.best.h, a.best.ties, a.best.tie_sl_values,
    )}, scored on the same ${a.bars} bars it was chosen from.`,
  );
  if (mtm != null) {
    parts.push(
      `Re-valuing the same trades at the actual expiry price gives ${fmtPct(mtm, 1, true)} CAGR, against ${fmtPct(asset, 1, true)} for buy-and-hold.`,
    );
  }
  if (wf.available) {
    parts.push(
      `On the last ${wf.test.bars} bars, a candidate chosen from earlier data returned ${fmtPct(wf.test.mark_to_market_return_pct, 1, true)} at market vs ${fmtPct(wf.test.buy_and_hold_return_pct, 1, true)} buy-and-hold.`,
    );
  }

  const ridge = a.candidates.find((c) => c.region !== "isolated" && c.mtm_cagr_pct != null && c.mtm_cagr_pct > 0);
  const nextSteps: string[] = [];
  if (expiryDefect) nextSteps.push("Use these TP/SL/horizon values as label definitions only; the CAGR is a label-payoff score, not a trading return.");
  nextSteps.push("Backtest any candidate with a realistic simulator (market-valued exits, one position budget) before acting on it.");
  if (region === "isolated" && ridge) {
    nextSteps.push(
      `If exploring further, start from the broader region around candidate #${ridge.rank} (TP ${fmtFrac(ridge.tp)}, ${ridge.h} d), not the single peak.`,
    );
  }
  nextSteps.push("Confirm on a later period that was not used for selection (walk-forward or a fresh holdout).");
  if (configMismatch) nextSteps.push("Note: the TP/SL ranges set in the form were not applied; this grid used the optimizer's built-in ranges.");

  const items: ConclusionItem[] = [
    {
      key: "objective",
      label: "Objective maximised",
      value: "Compounded CAGR",
      detail: "Single objective of the label-payoff simulation; no risk or trade-count constraint at selection.",
      tone: "neutral",
    },
    {
      key: "params",
      label: "Highest-scoring parameters",
      value: paramsText(a.best.tp, a.best.sl, a.best.h, a.best.ties, a.best.tie_sl_values),
      detail:
        a.best.ties > 1
          ? `${a.best.ties} cells share the identical score; the stop-loss never triggered, so its value is arbitrary.`
          : undefined,
      tone: a.best.ties > 1 ? "warn" : "neutral",
    },
    {
      key: "evaluation",
      label: "Evaluation",
      value: a.evaluation === "in_sample" ? "In-sample only" : "Independently evaluated",
      detail:
        a.evaluation === "in_sample"
          ? `Selected and scored on the same ${a.bars} bars${wf.available ? "; a separate chronological holdout is shown below" : ""}.`
          : undefined,
      tone: a.evaluation === "in_sample" ? "bad" : "good",
    },
    {
      key: "stability",
      label: "Neighbouring parameters",
      value: REGION_COPY[region].label,
      detail: nb
        ? `Neighbours score a median ${Math.round(nb.median_ratio * 100)}% of the peak; ${Math.round(nb.share_within_50pct * 100)}% keep at least half.`
        : REGION_COPY[region].detail,
      tone: region === "plateau" ? "good" : region === "ridge" ? "warn" : "bad",
    },
    {
      key: "assumptions",
      label: "Limiting assumptions",
      value: expiryDefect ? "Expiries booked at 0%" : "Idealised fills",
      detail: [
        expiryDefect && totalPositions
          ? `${a.exits.expiries} of ${totalPositions} positions expired; ${fmtPct((a.exits.expiry_negative_share ?? 0) * 100, 0)} were losing at expiry`
          : null,
        a.payoff_model.sizing,
        `costs ${fmtPct(a.payoff_model.costs_round_trip_pct, 2)} round trip`,
        a.years != null ? `${a.years.toFixed(2)}-year window, annualised` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      tone: expiryDefect ? "bad" : "warn",
    },
    {
      key: "recommendation",
      label: "Recommendation",
      value: a.verdict.recommend ? "Candidate supported" : "Not recommended",
      detail: a.verdict.recommend
        ? undefined
        : "Evidence is insufficient: in-sample, idealised payoff" + (mtmFails ? ", and negative under market valuation." : "."),
      tone: a.verdict.recommend ? "good" : "bad",
    },
  ];

  return {
    status: { label: mtmFails ? "Not supported" : "Insufficient evidence", tone: mtmFails ? "bad" : "warn" },
    headline,
    summary: parts.join(" "),
    items,
    nextSteps,
  };
}

function unauditedConclusion(m: MetricsLike | null, nb: Neighbourhood | null): Conclusion {
  const region = classifyRegion(nb);
  const has = m && isNum(m.best_tp) && isNum(m.best_sl) && isNum(m.best_h);
  const params = has ? paramsText(m!.best_tp!, m!.best_sl!, m!.best_h!) : "—";
  return {
    status: { label: "Unaudited · in-sample", tone: "warn" },
    headline: "Highest in-sample score — methodology audit not available for this run",
    summary:
      `Maximising compounded CAGR of the label-payoff simulation selected ${params}` +
      (isNum(m?.best_cagr) ? ` with a score of ${fmtPct(m!.best_cagr, 1)}` : "") +
      ". The score was selected and measured on the same data, and expired trades are booked at 0% in this model.",
    items: [
      { key: "objective", label: "Objective maximised", value: "Compounded CAGR", tone: "neutral" },
      { key: "params", label: "Highest-scoring parameters", value: params, tone: "neutral" },
      { key: "evaluation", label: "Evaluation", value: "In-sample only", tone: "bad" },
      {
        key: "stability",
        label: "Neighbouring parameters",
        value: REGION_COPY[region].label,
        detail: nb ? `Median neighbour ${Math.round(nb.median_ratio * 100)}% of the peak (same horizon).` : undefined,
        tone: region === "plateau" ? "good" : region === "ridge" ? "warn" : "bad",
      },
      { key: "assumptions", label: "Limiting assumptions", value: "Expiries booked at 0%", tone: "bad" },
      { key: "recommendation", label: "Recommendation", value: "Not recommended", detail: "No independent evaluation.", tone: "bad" },
    ],
    nextSteps: [
      "Re-run the optimizer to generate the methodology audit (market-valued exits, holdout, stability).",
      "Treat the CAGR as a label-payoff score, not a trading return.",
    ],
  };
}
