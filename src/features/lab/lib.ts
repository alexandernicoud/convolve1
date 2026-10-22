import { fmtNum, fmtPct, fmtPp, isFiniteNum, MISSING } from "@/lib/viz/format";
import type { CI, ExperimentKind, Finding, LabJob, Prop } from "./api";

export type Filters = {
  labels: number[];
  predicted: number[];
  outcome: "" | "correct" | "incorrect";
  split: "all" | "validation" | "training";
  symbols: string[];
  date_from: string;
  date_to: string;
  confidence_min: string;
  confidence_max: string;
};

export const EMPTY_FILTERS: Filters = {
  labels: [],
  predicted: [],
  outcome: "",
  split: "all",
  symbols: [],
  date_from: "",
  date_to: "",
  confidence_min: "",
  confidence_max: "",
};

/** UI filters → API filter object. Empty fields are dropped; confidence strings become numbers. */
export function filtersToParams(f: Filters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.labels.length) out.labels = [...f.labels].sort();
  if (f.predicted.length) out.predicted = [...f.predicted].sort();
  if (f.outcome) out.outcome = f.outcome;
  if (f.split !== "all") out.split = f.split;
  if (f.symbols.length) out.symbols = [...f.symbols].sort();
  if (f.date_from) out.date_from = f.date_from;
  if (f.date_to) out.date_to = f.date_to;
  const cmin = parseFloat(f.confidence_min);
  const cmax = parseFloat(f.confidence_max);
  if (Number.isFinite(cmin)) out.confidence_min = cmin;
  if (Number.isFinite(cmax)) out.confidence_max = cmax;
  return out;
}

/** Human summary of a filter object as stored in job params. */
export function describeFilters(f: Record<string, unknown> | undefined): string {
  if (!f || !Object.keys(f).length) return "All images";
  const parts: string[] = [];
  const list = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v));
  if (f.labels) parts.push(`label ${list(f.labels)}`);
  if (f.predicted) parts.push(`predicted ${list(f.predicted)}`);
  if (f.outcome) parts.push(String(f.outcome));
  if (f.split) parts.push(`${f.split} images`);
  if (f.symbols) parts.push(list(f.symbols));
  if (f.date_from || f.date_to) parts.push(`ending ${f.date_from ?? "…"} to ${f.date_to ?? "…"}`);
  if (f.confidence_min != null || f.confidence_max != null) parts.push(`confidence ${f.confidence_min ?? 0}–${f.confidence_max ?? 1}`);
  return parts.join(" · ");
}

export const isActive = (j?: LabJob | null) => !!j && (j.status === "queued" || j.status === "running");

/** Newest job of a kind, and newest successful job of that kind (may differ while one is running). */
export function latestByKind(jobs: LabJob[], kind: ExperimentKind): { latest: LabJob | null; succeeded: LabJob | null } {
  const ofKind = jobs.filter((j) => j.kind === kind).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  return { latest: ofKind[0] ?? null, succeeded: ofKind.find((j) => j.status === "succeeded") ?? null };
}

/** "0.123 [0.100, 0.150]" with a custom number format. */
export function fmtCI(ci: Pick<CI, "mean" | "lo" | "hi"> | null | undefined, fmt: (v: number) => string): string {
  if (!ci || !isFiniteNum(ci.mean)) return MISSING;
  const base = fmt(ci.mean);
  if (!isFiniteNum(ci.lo) || !isFiniteNum(ci.hi)) return base;
  return `${base} [${fmt(ci.lo)}, ${fmt(ci.hi)}]`;
}

export function fmtProp(p: Prop | null | undefined, digits = 0): string {
  if (!p || !isFiniteNum(p.p)) return MISSING;
  const f = (v: number) => `${(v * 100).toFixed(digits)}%`;
  return isFiniteNum(p.lo) && isFiniteNum(p.hi) ? `${f(p.p)} [${f(p.lo)}, ${f(p.hi)}]` : f(p.p);
}

/** Whether a 95% interval excludes a reference value: true/false, or null when there is no interval. */
export function excludes(ci: Pick<CI, "lo" | "hi"> | null | undefined, ref: number): boolean | null {
  if (!ci || !isFiniteNum(ci.lo) || !isFiniteNum(ci.hi)) return null;
  return ci.lo > ref || ci.hi < ref;
}

export const STATUS_ORDER: Finding["status"][] = ["supported", "hypothesis", "observation", "inconclusive"];

export function groupFindings(fs: Finding[]): { status: Finding["status"]; items: Finding[] }[] {
  return STATUS_ORDER.map((status) => ({ status, items: fs.filter((f) => f.status === status) })).filter((g) => g.items.length);
}

/** Axis domain covering every interval end and the reference value, padded 8%. */
export function intervalDomain(rows: { lo?: number | null; hi?: number | null; mean?: number | null }[], ref?: number): [number, number] | null {
  const vals: number[] = [];
  for (const r of rows) for (const v of [r.lo, r.hi, r.mean]) if (isFiniteNum(v)) vals.push(v);
  if (isFiniteNum(ref)) vals.push(ref);
  if (!vals.length) return null;
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) {
    const d = Math.abs(lo) * 0.1 || 0.01;
    lo -= d;
    hi += d;
  }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

export const MODULE_LABEL: Record<ExperimentKind, string> = {
  atlas: "Attention atlas",
  sensitivity: "Sensitivity",
  faithfulness: "Sensitivity",
  features: "Feature laboratory",
  embedding: "Representation",
};

export const TAB_FOR_KIND: Record<ExperimentKind, string> = {
  atlas: "atlas",
  sensitivity: "sensitivity",
  faithfulness: "sensitivity",
  features: "features",
  embedding: "representation",
};

/** Formats a finding value in its unit; differences of shares are shown in percentage points. */
export function formatMeasurement(m: NonNullable<Finding["measurement"]>, v: number | null): string {
  if (!isFiniteNum(v)) return MISSING;
  const isDiff = /−|minus|difference|Δ/i.test(m.label);
  if (m.unit === "probability") return fmtPp(v, 2);
  if (m.unit === "share") return isDiff ? fmtPp(v, 1) : fmtPct(v, 1);
  if (m.unit === "proportion") return fmtPct(v, 0);
  return fmtNum(v, 2);
}
