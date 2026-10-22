/** Number, unit and date formatting shared by every chart. Missing values never become zero. */

export const MISSING = "—";

export const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Fraction (0–1) as a percentage. */
export function fmtPct(v: unknown, digits = 1): string {
  return isFiniteNum(v) ? `${(v * 100).toFixed(digits)}%` : MISSING;
}

/** Value already in percent units. */
export function fmtPctUnits(v: unknown, digits = 1): string {
  return isFiniteNum(v) ? `${v.toFixed(digits)}%` : MISSING;
}

export function fmtNum(v: unknown, digits = 3): string {
  return isFiniteNum(v) ? v.toFixed(digits) : MISSING;
}

export function fmtSigned(v: unknown, digits = 3): string {
  if (!isFiniteNum(v)) return MISSING;
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s;
}

/** Signed change in probability, shown in percentage points. */
export function fmtPp(v: unknown, digits = 1): string {
  if (!isFiniteNum(v)) return MISSING;
  const s = (v * 100).toFixed(digits);
  return `${v > 0 ? "+" : ""}${s} pp`;
}

export function fmtInt(v: unknown): string {
  return isFiniteNum(v) ? Math.round(v).toLocaleString("en-US") : MISSING;
}

/** Seconds → "42 s", "3 min 05 s", "1 h 04 min". */
export function fmtDuration(seconds: unknown): string {
  if (!isFiniteNum(seconds) || seconds < 0) return MISSING;
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m} min ${String(r).padStart(2, "0")} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} min`;
}

/** Clock-style elapsed time for live counters: 04:12 or 1:04:12. */
export function fmtClock(seconds: unknown): string {
  if (!isFiniteNum(seconds) || seconds < 0) return MISSING;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, "0");
  const rr = String(r).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${rr}` : `${mm}:${rr}`;
}

/** Unix seconds or ms → "21 Oct 2026, 16:34". */
export function fmtDateTime(ts: unknown): string {
  if (!isFiniteNum(ts) || ts <= 0) return MISSING;
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtDate(ts: unknown): string {
  if (!isFiniteNum(ts) || ts <= 0) return MISSING;
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Y-domain that fits the data with padding, without forcing zero. Returns undefined when there is
 * nothing finite to fit (callers then let the chart library decide).
 */
export function paddedDomain(values: unknown[], { pad = 0.08, clamp }: { pad?: number; clamp?: [number, number] } = {}): [number, number] | undefined {
  const nums = values.filter(isFiniteNum);
  if (!nums.length) return undefined;
  let lo = Math.min(...nums);
  let hi = Math.max(...nums);
  if (lo === hi) {
    const d = Math.abs(lo) * 0.05 || 0.01;
    lo -= d;
    hi += d;
  }
  const span = hi - lo;
  lo -= span * pad;
  hi += span * pad;
  if (clamp) {
    lo = Math.max(clamp[0], lo);
    hi = Math.min(clamp[1], hi);
  }
  return [lo, hi];
}

/**
 * Round a domain outward to a "nice" step (1, 2, 2.5, 5 × 10^k) so axis ticks land on readable
 * values. Display only: the data is not changed.
 */
export function niceScale(domain: [number, number] | undefined, targetTicks = 5, clamp?: [number, number]): { domain: [number, number]; ticks: number[] } | undefined {
  if (!domain || !isFiniteNum(domain[0]) || !isFiniteNum(domain[1]) || domain[1] <= domain[0]) return undefined;
  const raw = (domain[1] - domain[0]) / Math.max(1, targetTicks - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  let lo = Math.floor(domain[0] / step + 1e-9) * step;
  let hi = Math.ceil(domain[1] / step - 1e-9) * step;
  if (clamp) {
    lo = Math.max(clamp[0], lo);
    hi = Math.min(clamp[1], hi);
  }
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)));
  return { domain: [lo, hi], ticks };
}

/** CSV with RFC-4180 quoting; missing values stay empty cells. */
export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label?: string }[]): string {
  const esc = (v: unknown) => {
    if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label ?? c.key)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(","));
  return [head, ...body].join("\n");
}

export function downloadText(filename: string, text: string, type = "text/csv") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
