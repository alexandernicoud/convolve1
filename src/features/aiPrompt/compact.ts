/**
 * Shrinks run results for an LLM prompt without dropping meaning: numbers are rounded, images
 * (base64 PNG) are removed, and long series are replaced by their statistics plus an evenly
 * spaced sample. Short arrays and every scalar field are kept as they are.
 */

export type CompactOptions = {
  /** Arrays longer than this are summarised. */
  maxArray: number;
  /** Points kept from a summarised numeric series. */
  samplePoints: number;
  /** Items kept from the head and tail of a summarised list of objects. */
  keepHead: number;
  keepTail: number;
  maxString: number;
  maxDepth: number;
  significant: number;
};

export const DEFAULT_COMPACT: CompactOptions = {
  maxArray: 40,
  samplePoints: 24,
  keepHead: 12,
  keepTail: 4,
  maxString: 1200,
  maxDepth: 10,
  significant: 5,
};

const IMAGE_KEYS = new Set(["png", "modified_png", "image_png", "thumbnail", "data_url"]);

export function roundSig(v: number, sig = DEFAULT_COMPACT.significant): number {
  if (!Number.isFinite(v) || Number.isInteger(v)) return v;
  const r = Number(v.toPrecision(sig));
  return Object.is(r, -0) ? 0 : r;
}

function looksLikeImage(s: string): boolean {
  return s.startsWith("data:image/") || (s.length > 400 && /^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 400)));
}

function numericStats(xs: number[], o: CompactOptions) {
  const finite = xs.filter(Number.isFinite);
  const n = finite.length;
  const mean = n ? finite.reduce((a, b) => a + b, 0) / n : null;
  const step = (xs.length - 1) / Math.max(1, o.samplePoints - 1);
  const sample: (number | null)[] = [];
  for (let i = 0; i < o.samplePoints && i * step < xs.length; i++) {
    const v = xs[Math.round(i * step)];
    sample.push(Number.isFinite(v) ? roundSig(v, o.significant) : null);
  }
  return {
    _summary: `numeric series of ${xs.length} values (summarised)`,
    n: xs.length,
    first: Number.isFinite(xs[0]) ? roundSig(xs[0], o.significant) : null,
    last: Number.isFinite(xs[xs.length - 1]) ? roundSig(xs[xs.length - 1], o.significant) : null,
    min: n ? roundSig(Math.min(...finite), o.significant) : null,
    max: n ? roundSig(Math.max(...finite), o.significant) : null,
    mean: mean == null ? null : roundSig(mean, o.significant),
    evenly_spaced_sample: sample,
  };
}

export function compact(value: unknown, opts: Partial<CompactOptions> = {}, depth = 0, key = ""): unknown {
  const o = { ...DEFAULT_COMPACT, ...opts };
  if (value == null) return value ?? null;
  if (typeof value === "number") return roundSig(value, o.significant);
  if (typeof value === "string") {
    if (IMAGE_KEYS.has(key) || looksLikeImage(value)) return "[image omitted]";
    return value.length > o.maxString ? `${value.slice(0, o.maxString)}… [${value.length - o.maxString} characters cut]` : value;
  }
  if (typeof value !== "object") return value;
  if (depth >= o.maxDepth) return "[nested too deep, omitted]";

  if (Array.isArray(value)) {
    if (value.length <= o.maxArray) return value.map((v) => compact(v, o, depth + 1));
    if (value.every((v) => typeof v === "number" || v == null)) return numericStats(value.map((v) => (v == null ? NaN : (v as number))), o);
    const head = value.slice(0, o.keepHead).map((v) => compact(v, o, depth + 1));
    const tail = value.slice(-o.keepTail).map((v) => compact(v, o, depth + 1));
    return [...head, `… ${value.length - o.keepHead - o.keepTail} more items omitted (total ${value.length}) …`, ...tail];
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined || typeof v === "function") continue;
    out[k] = compact(v, o, depth + 1, k);
  }
  return out;
}

/** Evenly spaced rows of a long table (always keeps the first and last row). */
export function sampleRows<T>(rows: T[], n: number): T[] {
  if (rows.length <= n) return rows;
  const step = (rows.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => rows[Math.round(i * step)]);
}

/** Indented JSON that keeps short objects and arrays on one line. */
export function stringify(value: unknown, indent = "", width = 150): string {
  const flat = JSON.stringify(value);
  if (flat === undefined) return "null";
  if (value === null || typeof value !== "object" || flat.length + indent.length <= width) return flat;
  const inner = indent + " ";
  if (Array.isArray(value)) return `[\n${value.map((v) => inner + stringify(v, inner, width)).join(",\n")}\n${indent}]`;
  const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${stringify(v, inner, width)}`);
  return `{\n${entries.join(",\n")}\n${indent}}`;
}

export function toJson(value: unknown, opts?: Partial<CompactOptions>): string {
  return stringify(compact(value, opts));
}
