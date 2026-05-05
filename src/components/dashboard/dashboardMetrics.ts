import type { Bot, BotEquityPoint, BotRun, DashboardOverview } from "@/lib/api";

/** Signed +/− currency for PnL-style lines */
export function formatSignedUsd(n: number) {
  const sign = n >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export function formatUsdPlain(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Percent with sign, e.g. +0.03% */
export function formatReturnPct(pct: number) {
  const sign = pct >= 0 ? "+" : "−";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

/** Aggregate account view for the capital card (fallbacks when API omits new fields). */
export function capitalOverview(overview: DashboardOverview | undefined, bots: Bot[]) {
  const start =
    overview?.total_starting_capital ??
    bots.reduce((s, b) => s + (b.starting_capital ?? 10000), 0);
  const realized = overview?.total_realized_pnl ?? 0;
  const openMtm = overview?.open_unrealized_pnl ?? 0;
  const equity =
    overview?.current_equity ?? (start > 0 ? start + realized + openMtm : start + realized);
  const realizedReturnPct = start > 0 ? (realized / start) * 100 : 0;
  return {
    equity,
    startCapital: start,
    realizedPnl: realized,
    realizedReturnPct,
    openMtm,
    openTrades: overview?.open_trades_count ?? 0,
    closedTrades: overview?.total_closed_trades ?? 0,
    label1Precision: overview?.label_1_precision ?? null,
    label1Sample: overview?.label_1_precision_sample ?? 0,
  };
}

export type SystemUiStatus = "LIVE" | "WAITING" | "ERROR" | "PAUSED";

export function systemStatusFromBots(bots: Bot[]): SystemUiStatus {
  const ds = (s: string | null | undefined) => (s ?? "").toLowerCase();
  if (bots.some((b) => ds(b.derived_status) === "error")) return "ERROR";
  if (bots.some((b) => ds(b.derived_status) === "paused")) return "PAUSED";
  if (bots.some((b) => ds(b.derived_status) === "running")) return "LIVE";
  if (bots.some((b) => ds(b.derived_status) === "waiting")) return "WAITING";
  return "LIVE";
}

export function formatSignal(label?: string | null): "LONG" | "SHORT" | "NEUTRAL" {
  if (!label) return "NEUTRAL";
  const upper = String(label).toUpperCase();
  if (upper === "1" || upper === "LONG") return "LONG";
  if (upper === "-1" || upper === "SHORT") return "SHORT";
  return "NEUTRAL";
}

export function formatConfidence(confidence?: number | null): string {
  if (confidence === null || confidence === undefined) return "—";
  return `${Math.round(confidence * 100)}%`;
}

export function formatTime(value?: string): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Date + time for dashboard cards (next run, last run). */
export function formatShortDateTime(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Cumulative profit across runs, sorted by time (for main chart). */
export function buildRunningProfitSeries(bots: Bot[], runsByBot: Record<string, BotRun[]>) {
  type Row = { t: number; runAt: string; pnl: number };
  const rows: Row[] = [];
  for (const bot of bots) {
    for (const r of runsByBot[bot.id] ?? []) {
      rows.push({ t: new Date(r.run_at).getTime(), runAt: r.run_at, pnl: r.pnl ?? 0 });
    }
  }
  rows.sort((a, b) => a.t - b.t);
  let cum = 0;
  return rows.map((row, i) => {
    cum += row.pnl;
    return { i: i + 1, profit: Number(cum.toFixed(4)), t: row.t, runAt: row.runAt };
  });
}

/** Deterministic placeholder equity curve — dense steps, jagged moves (no Math.random). */
export function placeholderRunningProfit() {
  const n = 52;
  let cum = 0;
  return Array.from({ length: n }, (_, i) => {
    const a = Math.sin(i * 0.31) * 140 + Math.sin(i * 0.09) * 55;
    const b = ((i * 17) % 9) - 4;
    const c = i % 11 === 0 ? 42 : i % 7 === 0 ? -28 : 0;
    cum += a * 0.045 + b + c * 0.35;
    return {
      i: i + 1,
      profit: Number(cum.toFixed(2)),
      t: Date.now() - (n - i) * 3_600_000,
      runAt: "",
    };
  });
}

export function aggregateTotals(bots: Bot[], runsByBot: Record<string, BotRun[]>) {
  let totalPnl = 0;
  let wins = 0;
  let n = 0;
  for (const bot of bots) {
    for (const r of runsByBot[bot.id] ?? []) {
      const p = r.pnl ?? 0;
      totalPnl += p;
      n++;
      if (p > 0) wins++;
    }
  }
  const winRate = n ? wins / n : 0;
  const active = bots.filter((b) => b.is_active).length;
  return { totalPnl, winRate, active, runCount: n };
}

/** Latest prediction time from bot list (enriched `latest_run`) and optional per-bot run history. */
export function lastPredictionTimestamp(bots: Bot[], runsByBot?: Record<string, BotRun[]>) {
  let latest = 0;
  for (const bot of bots) {
    if (runsByBot) {
      for (const r of runsByBot[bot.id] ?? []) {
        const t = new Date(r.run_at).getTime();
        if (t > latest) latest = t;
      }
    }
    const lr = bot.latest_run?.run_at;
    if (lr) {
      const t = new Date(lr).getTime();
      if (t > latest) latest = t;
    }
  }
  return latest;
}

export function bestPerformingBot(bots: Bot[], runsByBot: Record<string, BotRun[]>) {
  let best: { bot: Bot; pnl: number } | null = null;
  for (const bot of bots) {
    let sum = 0;
    for (const r of runsByBot[bot.id] ?? []) sum += r.pnl ?? 0;
    if (!best || sum > best.pnl) best = { bot, pnl: sum };
  }
  return best;
}

export function sparklineFromRuns(runs: BotRun[]): { i: number; v: number }[] {
  const sorted = [...runs].sort((a, b) => new Date(a.run_at).getTime() - new Date(b.run_at).getTime());
  let e = 0;
  return sorted.slice(-12).map((r, i) => {
    e += r.pnl ?? 0;
    return { i, v: e };
  });
}

/** Equity curve samples for mini sparkline (last N points). */
export function sparklineFromEquityPoints(points: BotEquityPoint[], maxPoints = 14): { i: number; v: number }[] {
  const slice = points.slice(-maxPoints);
  return slice.map((p, i) => ({ i, v: p.total_equity }));
}
