import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Radio } from "lucide-react";
import {
  botsApi,
  dashboardApi,
  type Bot,
  type DashboardActivityItem,
  type DashboardBundle,
} from "@/lib/api";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";
import { RunningProfitChart } from "@/components/dashboard/RunningProfitChart";
import { BotEquityMiniChart } from "@/components/dashboard/BotEquityMiniChart";
import { CommunityRankingCard } from "@/components/dashboard/CommunityRankingCard";
import { MarketTickerTape } from "@/components/dashboard/MarketTickerTape";
import { dashboardCard, dashboardCardHover } from "@/components/dashboard/dashboardCard";
import { systemOperationalBadgeClass } from "@/components/dashboard/botStatusStyles";
import { cn } from "@/lib/utils";
import {
  capitalOverview,
  formatConfidence,
  formatReturnPct,
  formatSignal,
  formatSignedUsd,
  formatShortDateTime,
  formatUsdPlain,
  lastPredictionTimestamp,
  systemStatusFromBots,
} from "@/components/dashboard/dashboardMetrics";

function formatActivityTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildActivityFallback(bots: Bot[]): { id: string; label: string; time: string }[] {
  const rows: { t: number; label: string }[] = [];
  for (const bot of bots) {
    const lr = bot.latest_run;
    if (!lr) continue;
    const name = bot.name || bot.symbol;
    const sig = formatSignal(lr.label);
    rows.push({
      t: new Date(lr.run_at).getTime(),
      label:
        lr.status === "error"
          ? `${name} · run error`
          : `${name} · ${sig} ${formatConfidence(lr.confidence)}`,
    });
  }
  rows.sort((a, b) => b.t - a.t);
  return rows.slice(0, 6).map((r, i) => ({
    id: `fb-${r.t}-${i}`,
    label: r.label,
    time: new Date(r.t).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));
}

function activityFeedLine(item: DashboardActivityItem): string {
  const conf = item.confidence != null ? formatConfidence(item.confidence) : null;
  if (item.kind === "prediction") {
    return conf ? `${item.symbol} → ${item.title} (${conf})` : `${item.symbol} → ${item.title}`;
  }
  return `${item.symbol} → ${item.title}`;
}

export default function Dashboard() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [bundle, setBundle] = useState<DashboardBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWorkflowGuide, setShowWorkflowGuide] = useState(false);

  useEffect(() => {
    try {
      const dismissed = window.localStorage.getItem("dashboard-workflow-guide-dismissed");
      setShowWorkflowGuide(dismissed !== "1");
    } catch {
      setShowWorkflowGuide(true);
    }
  }, []);

  const fetchDashboard = useCallback(async () => {
    try {
      setError(null);
      const [list, dash] = await Promise.all([botsApi.listBots(), dashboardApi.getBundle()]);
      setBots(list);
      setBundle(dash);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let active = true;

    const refresh = async () => {
      if (!active) return;
      await fetchDashboard();
    };

    void refresh();
    interval = setInterval(refresh, 45000);

    return () => {
      active = false;
      if (interval) clearInterval(interval);
    };
  }, [fetchDashboard]);

  const overview = bundle?.overview;
  const cap = capitalOverview(overview, bots);

  const bestBot = overview?.best_bot_id ? bots.find((b) => b.id === overview.best_bot_id) : null;
  const bestSeries = bundle?.equity_by_bot.find((s) => s.bot_id === overview?.best_bot_id);

  const bestReturnPct =
    overview?.best_bot_return_pct != null
      ? overview.best_bot_return_pct
      : overview?.best_realized_pnl != null && bestBot
        ? (overview.best_realized_pnl / (bestBot.starting_capital ?? 10000)) * 100
        : null;

  const lastTs = lastPredictionTimestamp(bots);
  const systemStatus = systemStatusFromBots(bots);

  const feed = bundle?.activity_feed?.length ? bundle.activity_feed : null;
  const fallbackActivity = !feed?.length ? buildActivityFallback(bots) : [];
  const closeWorkflowGuide = () => {
    setShowWorkflowGuide(false);
    try {
      window.localStorage.setItem("dashboard-workflow-guide-dismissed", "1");
    } catch {
      // no-op: storage can fail in private mode
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden font-sans">
      <DashboardTopBar className="mb-2" />
      {showWorkflowGuide ? (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-xl rounded-2xl border border-white/[0.15] bg-[#0f1116] p-6 shadow-[0_36px_100px_-48px_rgba(0,0,0,0.9)]">
            <h2 className="text-[clamp(1.15rem,2.2vw,1.5rem)] font-semibold tracking-tight text-white">
              Workspace flow
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-white/72">
              Follow this order to move from idea to live execution.
            </p>
            <ol className="mt-4 space-y-2 text-sm text-white/88">
              <li>1. Generate data</li>
              <li>2. Train model</li>
              <li>3. Analyze signals</li>
              <li>4. Backtest strategy</li>
              <li>5. Deploy bot</li>
              <li>6. Monitor in dashboard</li>
            </ol>
            <button
              type="button"
              onClick={closeWorkflowGuide}
              className="mt-6 inline-flex rounded-full border border-white/25 bg-white/[0.08] px-5 py-2.5 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/[0.14]"
            >
              Got it
            </button>
          </div>
        </div>
      ) : null}

      {error && (
        <div className="shrink-0 border-b border-rose-500/25 bg-rose-500/10 px-5 py-2 text-center text-sm font-medium text-rose-200">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3 md:gap-3 md:p-4">
        <div className="grid shrink-0 grid-cols-12 gap-2 md:gap-3">
          {/* Account & Performance */}
          <div className={cn("col-span-12 md:col-span-4", dashboardCard, dashboardCardHover, "p-3 md:p-4")}>
            <Link
              to="/dashboard/portfolio"
              className="block w-fit text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45 transition hover:text-white/75"
            >
              Account & Performance
            </Link>
            <p className="mt-2 font-digits text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tabular-nums tracking-tight text-white">
              {loading ? "…" : formatUsdPlain(cap.equity)}
            </p>
            <p className="mt-0.5 text-[9px] uppercase tracking-[0.1em] text-white/35">Equity</p>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              <div>
                <p className="text-[9px] uppercase tracking-[0.12em] text-white/40">Start capital</p>
                <p className="font-digits text-[13px] font-medium tabular-nums text-white/90">
                  {loading ? "…" : formatUsdPlain(cap.startCapital)}
                </p>
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-[0.12em] text-white/40">Realized PnL</p>
                <p className="font-digits text-[13px] font-medium tabular-nums text-white/90">
                  {loading ? "…" : formatSignedUsd(cap.realizedPnl)}
                </p>
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-[0.12em] text-white/40">Return</p>
                <p className="font-digits text-[13px] font-medium tabular-nums text-white/90">
                  {loading ? "…" : formatReturnPct(cap.realizedReturnPct)}
                </p>
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-[0.12em] text-white/40">Open MTM</p>
                <p className="font-digits text-[13px] font-medium tabular-nums text-white/90">
                  {loading ? "…" : formatSignedUsd(cap.openMtm)}
                </p>
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-[0.12em] text-white/40">Open trades</p>
                <p className="font-digits text-[13px] font-medium tabular-nums text-white/90">
                  {loading ? "…" : cap.openTrades}
                </p>
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-[0.12em] text-white/40">Closed trades</p>
                <p className="font-digits text-[13px] font-medium tabular-nums text-white/90">
                  {loading ? "…" : cap.closedTrades}
                </p>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <p className="text-[9px] uppercase tracking-[0.12em] text-white/40">Label 1 precision</p>
                <p className="font-digits text-[13px] font-medium tabular-nums text-white/90">
                  {loading
                    ? "…"
                    : cap.label1Precision != null && cap.label1Sample > 0
                      ? `${(cap.label1Precision * 100).toFixed(1)}% (n=${cap.label1Sample})`
                      : "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Top bot — visual-first: metrics in header row, equity chart body */}
          <div className={cn("col-span-12 flex min-h-0 flex-col md:col-span-4", dashboardCard, dashboardCardHover, "p-3")}>
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                {overview?.best_bot_id ? (
                  <Link
                    to={`/dashboard/bots/${overview.best_bot_id}`}
                    className="block w-fit text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45 transition hover:text-white/75"
                  >
                    Top bot
                  </Link>
                ) : (
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Top bot</p>
                )}
                <p className="mt-0.5 font-digits text-[11px] font-bold uppercase tracking-wide text-white/85">
                  {loading ? "…" : overview?.best_bot_symbol || bestBot?.symbol || "—"}
                </p>
                <p className="truncate text-[13px] font-semibold leading-tight text-white">
                  {loading ? "…" : overview?.best_bot_name || bestBot?.name || bestBot?.symbol || "—"}
                </p>
              </div>
              <div className="flex max-w-[min(100%,220px)] flex-shrink-0 flex-wrap justify-end gap-x-3 gap-y-2 text-right sm:gap-x-4">
                <div>
                  <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-white/40">Return</p>
                  <p className="font-digits text-[12px] font-semibold tabular-nums text-emerald-300/95 sm:text-[13px]">
                    {loading || bestReturnPct == null
                      ? "…"
                      : `${bestReturnPct >= 0 ? "+" : ""}${bestReturnPct.toFixed(2)}%`}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-white/40">Realized</p>
                  <p className="font-digits text-[12px] font-semibold tabular-nums text-white sm:text-[13px]">
                    {loading ? "…" : formatSignedUsd(overview?.best_realized_pnl ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-white/40">Max DD</p>
                  <p className="font-digits text-[12px] font-semibold tabular-nums text-white sm:text-[13px]">
                    {loading
                      ? "…"
                      : overview?.best_bot_max_drawdown_pct != null
                        ? `${overview.best_bot_max_drawdown_pct.toFixed(1)}%`
                        : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-white/40">Label 1 prec.</p>
                  <p className="font-digits text-[12px] font-semibold tabular-nums text-white sm:text-[13px]">
                    {loading
                      ? "…"
                      : overview?.best_bot_label_1_precision != null && (overview.best_bot_label_1_sample ?? 0) > 0
                        ? `${(overview.best_bot_label_1_precision * 100).toFixed(1)}%`
                        : "—"}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-2 min-h-0 flex-1">
              <BotEquityMiniChart points={bestSeries?.points} />
            </div>
          </div>

          {/* Operations — secondary, compact */}
          <div className={cn("col-span-12 md:col-span-4", dashboardCard, dashboardCardHover, "p-3")}>
            <Link
              to="/dashboard/bots"
              className="block w-fit text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45 transition hover:text-white/75"
            >
              Operations
            </Link>
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/50">System</span>
                <span className={systemOperationalBadgeClass(systemStatus)}>{systemStatus}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-white/90">
                  <Radio className="h-3.5 w-3.5 text-white/60" aria-hidden />
                  Active bots
                </span>
                <span className="font-digits text-[15px] font-semibold tabular-nums text-white">
                  {loading ? "…" : overview?.active_bots ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between gap-1 border-t border-white/[0.06] pt-1.5">
                <span className="text-[9px] font-medium uppercase tracking-[0.1em] text-white/45">Last prediction</span>
                <span className="max-w-[58%] text-right font-digits text-[10px] leading-tight text-white/85">
                  {lastTs ? formatShortDateTime(new Date(lastTs).toISOString()) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[9px] font-medium uppercase tracking-[0.1em] text-white/45">Next run</span>
                <span className="max-w-[58%] text-right font-digits text-[10px] leading-tight text-white/85">
                  {overview?.next_scheduled_run_iso ? formatShortDateTime(overview.next_scheduled_run_iso) : "—"}
                </span>
              </div>
              <div className="border-t border-white/[0.06] pt-2">
                <p className="text-[9px] font-medium uppercase tracking-[0.1em] text-white/45">Watchlist</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {bots.length === 0 && !loading ? (
                    <span className="text-[10px] text-white/50">No symbols</span>
                  ) : (
                    bots.slice(0, 6).map((b) => (
                      <span
                        key={b.id}
                        className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-digits text-[10px] text-white/75"
                      >
                        {b.symbol}
                        <span className="text-white/35"> · </span>
                        <span className="text-white/55">{(b.derived_status ?? "active").toUpperCase()}</span>
                      </span>
                    ))
                  )}
                </div>
                <Link
                  to="/dashboard/bots"
                  className="mt-2 inline-flex text-[11px] font-semibold text-white/75 transition hover:text-white"
                >
                  View all bots →
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-12 gap-2 md:gap-3">
          <div className={cn("col-span-12 flex min-h-[280px] flex-col lg:col-span-8", dashboardCard, "rounded-md p-3 md:p-4")}>
            <Link
              to="/dashboard/portfolio"
              className="mb-2 block w-fit text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45 transition hover:text-white/75"
            >
              Portfolio equity
            </Link>
            <RunningProfitChart
              equityByBot={bundle?.equity_by_bot ?? []}
              baselineEquity={overview?.total_starting_capital ?? cap.startCapital}
              equityDisplay={loading ? "…" : formatUsdPlain(cap.equity)}
              returnDisplay={loading ? "…" : formatReturnPct(cap.realizedReturnPct)}
              realizedDisplay={loading ? "…" : formatSignedUsd(cap.realizedPnl)}
            />
          </div>

          <div className={cn("col-span-12 flex min-h-[280px] flex-col lg:col-span-4", dashboardCard, "rounded-md p-3 md:p-4")}>
            <CommunityRankingCard />
          </div>
        </div>

        <div className="grid min-h-0 shrink-0 grid-cols-12 gap-2 md:gap-3">
          <div className={cn("col-span-12 flex max-h-[220px] min-h-0 flex-col md:col-span-6", dashboardCard, dashboardCardHover, "overflow-hidden p-3 md:p-4")}>
            <p className="mb-2 shrink-0 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Market watch</p>
            <div className="min-h-0 flex-1">
              <MarketTickerTape />
            </div>
          </div>

          <div className={cn("col-span-12 flex max-h-[220px] min-h-0 flex-col md:col-span-6", dashboardCard, dashboardCardHover, "overflow-hidden p-3 md:p-4")}>
            <div className="mb-1.5 flex shrink-0 items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-white/50" aria-hidden />
              <Link
                to="/dashboard/trade-history"
                className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45 transition hover:text-white/75"
              >
                Recent activity
              </Link>
            </div>
            <ul className="min-h-0 flex-1 space-y-0 overflow-y-auto pr-0.5">
              {feed?.length ? (
                feed.map((item, idx) => (
                  <li
                    key={`${item.kind}-${item.at}-${idx}`}
                    className="flex items-center justify-between gap-2 border-b border-white/[0.05] py-1.5 text-[11px] last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate font-digits text-white/90">{activityFeedLine(item)}</span>
                    <span className="shrink-0 font-digits text-[9px] text-white/45">{formatActivityTime(item.at)}</span>
                  </li>
                ))
              ) : fallbackActivity.length ? (
                fallbackActivity.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 border-b border-white/[0.05] py-1.5 text-[11px] last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate font-digits text-white/85">{a.label}</span>
                    <span className="shrink-0 font-digits text-[9px] text-white/45">{a.time}</span>
                  </li>
                ))
              ) : !loading ? (
                <li className="py-1.5 text-[11px] text-white/55">No events yet.</li>
              ) : (
                <li className="py-1.5 text-[11px] text-white/55">Loading…</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
