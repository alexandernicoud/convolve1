import type { FleetBot, FleetPayload, FleetSeries } from "./api";

export const MISSING = "—";
export const ACCENT = "#8FB3E0";
export const ACCENT_DIM = "rgba(143,179,224,0.18)";

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// ── layout tiers ─────────────────────────────────────────────────────────────

export type Tier = "L" | "M" | "S" | "stacked";
export type SecondaryPanel = "daily" | "contribution" | "exposure" | "health";

export interface FleetLayout {
  tier: Tier;
  /** CSS grid-template-rows for the overview root. */
  rows: string;
  gap: number;
  kpiHeight: number;
  secondaryHeight: number;
  swimlaneHeight: number;
  secondary: SecondaryPanel[];
  showSwimlane: boolean;
  showUnderwater: boolean;
  /** Narrow widths: main row 7/5 and fewer table columns. */
  compact: boolean;
  /** Tier M/S: activity folds into a fleet-table column. */
  tableActivity: boolean;
  /** Estimated height of the main (equity + table) row. */
  mainHeight: number;
}

export const MIN_MAIN = 300;
const GAP = 6;

/** Pick the layout from the measured overview area (below the top bar, beside the sidebar). */
export function pickLayout(width: number, height: number): FleetLayout {
  const compact = width < 1200;
  const base = { gap: GAP, compact };
  if (width < 960 || height < 500) {
    return { ...base, tier: "stacked", rows: "auto", kpiHeight: 0, secondaryHeight: 220, swimlaneHeight: 0, secondary: ["daily", "contribution", "exposure", "health"], showSwimlane: false, showUnderwater: true, tableActivity: false, mainHeight: 420 };
  }
  if (height >= 740) {
    const kpi = 60, sec = height >= 900 ? 228 : 200, lane = height >= 900 ? 108 : 96;
    const main = height - kpi - sec - lane - 3 * GAP;
    return { ...base, tier: "L", rows: `${kpi}px minmax(0,1fr) ${sec}px ${lane}px`, kpiHeight: kpi, secondaryHeight: sec, swimlaneHeight: lane, secondary: ["daily", "contribution", "exposure", "health"], showSwimlane: true, showUnderwater: main >= MIN_MAIN, tableActivity: false, mainHeight: main };
  }
  if (height >= 600) {
    const kpi = 58, sec = 184;
    const main = height - kpi - sec - 2 * GAP;
    return { ...base, tier: "M", rows: `${kpi}px minmax(0,1fr) ${sec}px`, kpiHeight: kpi, secondaryHeight: sec, swimlaneHeight: 0, secondary: ["daily", "contribution", "exposure", "health"], showSwimlane: false, showUnderwater: main >= MIN_MAIN, tableActivity: true, mainHeight: main };
  }
  const kpi = 56, sec = 156;
  const main = height - kpi - sec - 2 * GAP;
  return { ...base, tier: "S", rows: `${kpi}px minmax(0,1fr) ${sec}px`, kpiHeight: kpi, secondaryHeight: sec, swimlaneHeight: 0, secondary: ["daily", "health"], showSwimlane: false, showUnderwater: main >= MIN_MAIN, tableActivity: true, mainHeight: main };
}

// ── formatting ───────────────────────────────────────────────────────────────

const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", CHF: "CHF ", CAD: "C$", AUD: "A$" };

export function fmtMoney(v: unknown, ccy: string | null | undefined, opts: { signed?: boolean; digits?: number; compact?: boolean } = {}): string {
  if (!isNum(v)) return MISSING;
  const { signed = false, compact = false } = opts;
  const abs = Math.abs(v);
  const digits = opts.digits ?? (abs >= 1000 ? 0 : 2);
  let body: string;
  if (compact && abs >= 10_000) body = abs >= 1e6 ? `${(abs / 1e6).toFixed(2)}M` : `${(abs / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}k`;
  else body = abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sym = ccy ? (SYMBOL[ccy] ?? `${ccy} `) : "";
  const sign = v < 0 ? "−" : signed && v > 0 ? "+" : "";
  return `${sign}${sym}${body}`;
}

export function fmtPct(v: unknown, digits = 2, signed = true): string {
  if (!isNum(v)) return MISSING;
  const p = v * 100;
  const sign = p < 0 ? "−" : signed && p > 0 ? "+" : "";
  return `${sign}${Math.abs(p).toFixed(digits)}%`;
}

export function fmtAge(seconds: unknown): string {
  if (!isNum(seconds)) return MISSING;
  const s = Math.max(0, seconds);
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

export const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

export function fmtClock(t: number): string {
  return new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function fmtDayLabel(t: number): string {
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtDateTime(t: number): string {
  return new Date(t).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function signColor(v: unknown, pos: string, neg: string, zero = "rgba(255,255,255,0.75)"): string {
  if (!isNum(v) || v === 0) return zero;
  return v > 0 ? pos : neg;
}

// ── time axis ────────────────────────────────────────────────────────────────

const STEPS_MS = [3600e3, 3 * 3600e3, 6 * 3600e3, 12 * 3600e3, 86400e3, 2 * 86400e3, 3 * 86400e3, 7 * 86400e3, 14 * 86400e3, 30 * 86400e3];

/** Calendar-aligned ticks (local time) that fit the plot width at `pxPerTick` per label. */
export function timeTicks(start: number, end: number, widthPx: number, pxPerTick = 84): { ticks: number[]; step: number } {
  const span = Math.max(1, end - start);
  const maxTicks = Math.max(2, Math.floor(widthPx / pxPerTick));
  const step = STEPS_MS.find((s) => span / s <= maxTicks) ?? STEPS_MS[STEPS_MS.length - 1];
  const ticks: number[] = [];
  const d = new Date(start);
  if (step < 86400e3) {
    d.setMinutes(0, 0, 0);
    const h = step / 3600e3;
    d.setHours(Math.ceil(d.getHours() / h) * h);
  } else {
    d.setHours(0, 0, 0, 0);
    if (d.getTime() < start) d.setDate(d.getDate() + 1);
  }
  let t = d.getTime();
  while (t <= end) {
    if (t >= start) ticks.push(t);
    const n = new Date(t);
    if (step < 86400e3) n.setTime(t + step);
    else n.setDate(n.getDate() + Math.round(step / 86400e3));
    t = n.getTime();
  }
  return { ticks, step };
}

export function tickLabel(t: number, step: number): string {
  if (step >= 86400e3) return fmtDayLabel(t);
  const d = new Date(t);
  return d.getHours() === 0 && d.getMinutes() === 0 ? fmtDayLabel(t) : fmtClock(t);
}

// ── chart rows ───────────────────────────────────────────────────────────────

export type ChartMode = "pnl" | "equity" | "twr";

export interface ChartRow {
  t: number;
  value: number | null;
  contributed: number | null;
  equity: number | null;
  netPnl: number | null;
  realized: number | null;
  unrealized: number | null;
  twr: number | null;
  drawdown: number | null;
  exposure: number | null;
  nObs: number;
  staleBots: number;
  closeUp: number | null;
  closeDown: number | null;
  closes: { bot_id: string; pnl: number | null }[];
  [bot: `b_${string}`]: number | null;
}

export const botKey = (id: string) => `b_${id}` as const;

/** Bucketed series → chart rows. Missing values stay null (never 0). Close markers sit on the fleet line. */
export function buildChartRows(p: FleetPayload, mode: ChartMode): ChartRow[] {
  const s = p.series as FleetSeries;
  if (!s?.t?.length) return [];
  const times = s.t.map((x) => ms(x) ?? 0);
  const valueOf = (i: number) => (mode === "pnl" ? s.net_pnl[i] : mode === "equity" ? s.equity[i] : s.twr[i]);
  const perBot = mode === "equity" ? s.bots_equity : s.bots_net_pnl;
  const rows: ChartRow[] = times.map((t, i) => {
    const row: ChartRow = {
      t,
      value: valueOf(i) ?? null,
      contributed: s.contributed[i] ?? null,
      equity: s.equity[i] ?? null,
      netPnl: s.net_pnl[i] ?? null,
      realized: s.realized[i] ?? null,
      unrealized: s.unrealized[i] ?? null,
      twr: s.twr[i] ?? null,
      drawdown: s.drawdown[i] ?? null,
      exposure: s.exposure[i] ?? null,
      nObs: s.n_obs[i] ?? 0,
      staleBots: s.stale_bots[i] ?? 0,
      closeUp: null,
      closeDown: null,
      closes: [],
    };
    if (mode !== "twr") for (const [id, arr] of Object.entries(perBot ?? {})) row[botKey(id)] = arr[i] ?? null;
    return row;
  });
  for (const c of p.markers?.closes ?? []) {
    const t = ms(c.t);
    if (t == null) continue;
    let i = times.findIndex((x) => x >= t);
    if (i < 0) i = times.length - 1;
    const r = rows[i];
    r.closes.push({ bot_id: c.bot_id, pnl: c.pnl });
    if (r.value == null) continue;
    const sum = r.closes.reduce((a, x) => a + (x.pnl ?? 0), 0);
    r.closeUp = sum >= 0 ? r.value : null;
    r.closeDown = sum < 0 ? r.value : null;
  }
  return rows;
}

/** Consecutive bucket ranges where a predicate holds, as [x1, x2] in ms (bucket starts → ends). */
export function bands(rows: ChartRow[], pred: (r: ChartRow) => boolean, bucketMs: number): [number, number][] {
  const out: [number, number][] = [];
  let open: number | null = null;
  rows.forEach((r, i) => {
    const on = pred(r);
    const startT = i > 0 ? rows[i - 1].t : r.t - bucketMs;
    if (on && open == null) open = startT;
    if (!on && open != null) {
      out.push([open, startT]);
      open = null;
    }
  });
  if (open != null && rows.length) out.push([open, rows[rows.length - 1].t]);
  return out;
}

// ── fleet table ──────────────────────────────────────────────────────────────

export function botPriority(b: FleetBot): number {
  if (b.status === "error") return 0;
  if (b.valuation_stale || b.ops_stale) return 1;
  if (!b.in_aggregate) return 3;
  return 2;
}

export function sortBots(bots: FleetBot[]): FleetBot[] {
  return [...bots].sort((a, b) => botPriority(a) - botPriority(b) || Math.abs(b.net_pnl) - Math.abs(a.net_pnl) || a.symbol.localeCompare(b.symbol));
}

export const botHref = (id: string) => `/dashboard/bots/${encodeURIComponent(id)}`;
export const PORTFOLIO_HREF = "/dashboard/portfolio";
export const TRADES_HREF = "/dashboard/trade-history";
export const BOTS_HREF = "/dashboard/bots";
export const DEPLOY_HREF = "/tools/deploy";

export type StatusTone = "ok" | "warn" | "error" | "muted";

export function statusTone(b: FleetBot): StatusTone {
  if (b.status === "error") return "error";
  if (b.valuation_stale || b.ops_stale) return "warn";
  if (b.status === "paused" || b.status === "expired") return "muted";
  return "ok";
}

export function statusLabel(b: FleetBot): string {
  if (b.status === "error") return "Error";
  if (b.ops_stale) return "No recent runs";
  if (b.status === "paused") return b.valuation_stale ? "Paused · stale" : "Paused";
  if (b.valuation_stale) return "Stale mark";
  if (b.status === "running") return "Running";
  if (b.status === "waiting") return "Waiting";
  if (b.status === "expired") return "Expired";
  return "Live";
}

// ── daily ────────────────────────────────────────────────────────────────────

export interface DailyRow {
  date: string;
  t: number;
  label: string;
  pnl: number | null;
  realized: number;
  flows: number;
  observations: number;
  complete: boolean;
}

/** Calendar frame of the last `n` UTC days with no values, used when no daily valuation exists yet. */
export function emptyDailyRows(asOf: string, n: number): DailyRow[] {
  const end = new Date(asOf);
  const today = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Array.from({ length: Math.max(1, n) }, (_, i) => {
    const t = today - (n - 1 - i) * 86400e3;
    const date = new Date(t).toISOString().slice(0, 10);
    return { date, t, pnl: null, realized: 0, flows: 0, observations: 0, complete: t < today, label: new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) };
  });
}

/** No deployed bots: current state is zero and no history exists. */
export const isInactive = (p: FleetPayload) => p.bots.length === 0;

/** Symmetric unit domain for frames without observations; only the zero tick is labelled. */
export const FRAME_DOMAIN: [number, number] = [-1, 1];
export const FRAME_TICKS = [-1, -0.5, 0, 0.5, 1];

export function dailyRows(p: FleetPayload, maxBars: number): DailyRow[] {
  const rows = (p.daily ?? []).map((d) => {
    const t = Date.parse(`${d.date}T00:00:00Z`);
    return { ...d, t, label: new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) };
  });
  return rows.slice(-Math.max(1, maxBars));
}

// ── contribution / decomposition ─────────────────────────────────────────────

export interface ContributionRow {
  id: string;
  label: string;
  realized: number;
  unrealized: number;
  pnl: number;
}

export function contributionRows(p: FleetPayload, maxRows: number): ContributionRow[] {
  const byId = new Map(p.bots.map((b) => [b.id, b]));
  const rows = (p.contribution ?? [])
    .map((c) => ({ id: c.bot_id, label: byId.get(c.bot_id)?.symbol ?? c.bot_id.slice(0, 6), realized: c.realized, unrealized: c.unrealized, pnl: c.pnl }))
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  if (rows.length <= maxRows) return rows;
  const head = rows.slice(0, maxRows - 1);
  const rest = rows.slice(maxRows - 1);
  head.push({
    id: "__others",
    label: `${rest.length} others`,
    realized: rest.reduce((a, r) => a + r.realized, 0),
    unrealized: rest.reduce((a, r) => a + r.unrealized, 0),
    pnl: rest.reduce((a, r) => a + r.pnl, 0),
  });
  return head;
}

export interface DecompRow {
  key: string;
  label: string;
  value: number;
  kind: "component" | "total";
}

/** One-bot P&L decomposition since deployment. Costs are shown as negative contributions. */
export function decomposition(b: FleetBot): DecompRow[] {
  return [
    { key: "gross", label: "Price move (closed)", value: b.costs.gross_price_move, kind: "component" },
    { key: "slip", label: "Slippage", value: -b.costs.slippage, kind: "component" },
    { key: "comm", label: "Commission", value: -b.costs.commission, kind: "component" },
    { key: "open", label: "Open P&L (liq.)", value: b.unrealized_pnl, kind: "component" },
    { key: "net", label: "Net P&L", value: b.net_pnl, kind: "total" },
  ];
}

// ── activity ─────────────────────────────────────────────────────────────────

export function laneOrder(p: FleetPayload, maxLanes: number): string[] {
  const bots = sortBots(p.bots);
  const activity = new Map(p.activity.lanes.map((l) => [l.bot_id, l.ok.reduce((a, x) => a + x, 0) + l.error.reduce((a, x) => a + x, 0)]));
  return bots
    .map((b, i) => ({ id: b.id, pri: botPriority(b), act: activity.get(b.id) ?? 0, i }))
    .sort((a, b) => a.pri - b.pri || b.act - a.act || a.i - b.i)
    .slice(0, maxLanes)
    .map((x) => x.id);
}

export function fleetLane(p: FleetPayload) {
  const n = p.activity.buckets;
  const sum = (k: "ok" | "error" | "buy") => Array.from({ length: n }, (_, i) => p.activity.lanes.reduce((a, l) => a + (l[k][i] ?? 0), 0));
  return { ok: sum("ok"), error: sum("error"), buy: sum("buy") };
}
