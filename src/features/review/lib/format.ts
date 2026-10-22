/** Formatting for research values. Missing values render as an em dash — never as 0. */

export const MISSING = "—";

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Accepts epoch seconds, epoch ms or ISO strings. */
export function toMs(ts: unknown): number | null {
  if (isNum(ts)) return ts > 1e12 ? ts : ts * 1000;
  if (typeof ts === "string" && ts) {
    const n = Date.parse(ts);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDate(ts: unknown, withTime = true): string {
  const ms = toMs(ts);
  if (ms == null) return MISSING;
  const d = new Date(ms);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
}

export function formatRelative(ts: unknown, now = Date.now()): string {
  const ms = toMs(ts);
  if (ms == null) return MISSING;
  const s = Math.round((now - ms) / 1000);
  if (s < 0) return formatDate(ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(ts, false);
}

export function formatDuration(seconds: unknown): string {
  if (!isNum(seconds) || seconds < 0) return MISSING;
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${pad(Math.round(seconds % 60))}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${pad(m % 60)}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function num(v: unknown, digits = 2): string {
  if (!isNum(v)) return MISSING;
  return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function int(v: unknown): string {
  if (!isNum(v)) return MISSING;
  return Math.round(v).toLocaleString();
}

/** A value already expressed in percent units (e.g. 32.8 → "32.8%"). */
export function pctUnits(v: unknown, digits = 1, signed = false): string {
  if (!isNum(v)) return MISSING;
  const s = v.toFixed(digits);
  return `${signed && v > 0 ? "+" : ""}${s}%`;
}

/** A fraction 0–1 shown as percent (e.g. 0.574 → "57.4%"). */
export function pctFrac(v: unknown, digits = 1): string {
  if (!isNum(v)) return MISSING;
  return `${(v * 100).toFixed(digits)}%`;
}

export function money(v: unknown, digits = 0): string {
  if (!isNum(v)) return MISSING;
  const sign = v < 0 ? "−" : "";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Compact percent label from a fraction: 0.02 → "2", 0.025 → "2.5". */
export function fracLabel(v: unknown): string | null {
  if (!isNum(v)) return null;
  const p = v * 100;
  return Number.isInteger(Math.round(p * 100) / 100) ? String(Math.round(p)) : String(Math.round(p * 100) / 100);
}

export function shortId(id?: string | null, n = 6): string {
  if (!id) return MISSING;
  return id.length > n + 2 ? id.slice(-n) : id;
}

export function formatPeriod(start?: string | null, end?: string | null): string {
  if (!start && !end) return MISSING;
  return `${start ? String(start).slice(0, 10) : "?"} → ${end ? String(end).slice(0, 10) : "?"}`;
}

export function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\bpct\b/i, "%")
    .replace(/^./, (c) => c.toUpperCase());
}

export function formatValue(v: unknown): string {
  if (v == null || v === "") return MISSING;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (isNum(v)) return Number.isInteger(v) ? v.toLocaleString() : String(Math.round(v * 10000) / 10000);
  if (Array.isArray(v)) return v.map((x) => formatValue(x)).join(" × ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Share of each class in a label distribution, sorted by label. */
export function classBalance(dist?: Record<string, number> | null): { label: string; count: number; share: number }[] {
  if (!dist) return [];
  const entries = Object.entries(dist).filter(([, c]) => isNum(c));
  const total = entries.reduce((s, [, c]) => s + c, 0);
  if (total <= 0) return [];
  return entries
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([label, count]) => ({ label, count, share: count / total }));
}
