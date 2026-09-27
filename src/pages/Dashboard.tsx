import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  botsApi,
  dashboardApi,
  type Bot,
  type DashboardBundle,
  type DashboardEquitySeries,
  type DashboardTradeRow,
} from "@/lib/api";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";
import { RunningProfitChart } from "@/components/dashboard/RunningProfitChart";
import { DemoDailyProfitBarChart } from "@/components/dashboard/DemoDailyProfitBarChart";
import { DemoAccuracyRings } from "@/components/dashboard/DemoAccuracyRings";
import { DemoActivityLog } from "@/components/dashboard/DemoActivityLog";
import { DemoLabelMatchRates } from "@/components/dashboard/DemoLabelMatchRates";
import { DemoLastPredictionPanel } from "@/components/dashboard/DemoLastPredictionPanel";
import { DemoModelPredictionsMarquee } from "@/components/dashboard/DemoModelPredictionsMarquee";
import { demoLinkClass } from "@/components/dashboard/demoPortfolioPalette";
import { FLEET_LINE_COLORS } from "@/components/dashboard/fleetPalette";
import { MarketTickerTape } from "@/components/dashboard/MarketTickerTape";
import { dashboardCard, dashboardCardHover } from "@/components/dashboard/dashboardCard";
import { systemOperationalBadgeClass } from "@/components/dashboard/botStatusStyles";
import { AccountFleetTable } from "@/components/dashboard/AccountFleetTable";
import { AccountAllocationChart } from "@/components/dashboard/AccountAllocationChart";
import { AccountSignalMix } from "@/components/dashboard/AccountSignalMix";
import { cn } from "@/lib/utils";
import {
  capitalOverview,
  formatConfidence,
  formatReturnPct,
  formatSignal,
  formatSignedUsd,
  formatShortDateTime,
  formatUsdPlain,
  systemStatusFromBots,
} from "@/components/dashboard/dashboardMetrics";

function buildAccountSeries(equityByBot: DashboardEquitySeries[]): DashboardEquitySeries | null {
  if (!equityByBot.length) return null;
  const ts = new Set<string>();
  for (const s of equityByBot) {
    for (const p of s.points) ts.add(p.as_of);
  }
  const sorted = [...ts].sort();
  if (!sorted.length) return null;
  const points = sorted.map((as_of) => {
    let total = 0;
    let realized = 0;
    for (const s of equityByBot) {
      const atOrBefore = [...s.points]
        .filter((p) => p.as_of <= as_of)
        .sort((a, b) => a.as_of.localeCompare(b.as_of))
        .pop();
      if (atOrBefore) {
        total += atOrBefore.total_equity;
        realized += atOrBefore.realized_pnl;
      }
    }
    return { as_of, total_equity: total, realized_pnl: realized };
  });
  return { bot_id: "account", symbol: "ACCT", name: "Account", points };
}

function marqueeSectors(bots: Bot[]) {
  return bots.slice(0, 12).map((b) => {
    const sig = formatSignal(b.last_signal || b.latest_run?.signal || b.latest_run?.label);
    const conf = formatConfidence(b.last_confidence ?? b.latest_run?.confidence);
    const short = sig === "LONG" ? "L" : sig === "SHORT" ? "S" : "N";
    return {
      model: b.name || b.symbol,
      line: `${b.symbol} · ${short} ${conf}`,
    };
  });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.12em] text-white/40">{label}</p>
      <p className="font-digits text-[18px] font-semibold tabular-nums text-white sm:text-[20px]">{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [bundle, setBundle] = useState<DashboardBundle | null>(null);
  const [trades, setTrades] = useState<DashboardTradeRow[]>([]);
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
      const [list, dash, tradeRows] = await Promise.all([
        botsApi.listBots(),
        dashboardApi.getBundle(),
        dashboardApi.listTrades().catch(() => [] as DashboardTradeRow[]),
      ]);
      setBots(list);
      setBundle(dash);
      setTrades(tradeRows);
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
    interval = setInterval(refresh, 8000);

    return () => {
      active = false;
      if (interval) clearInterval(interval);
    };
  }, [fetchDashboard]);

  const overview = bundle?.overview;
  const cap = capitalOverview(overview, bots);
  const systemStatus = systemStatusFromBots(bots);
  const pollSec = overview?.poll_interval_seconds ?? 60;

  const lastPred = bundle?.last_prediction;
  const lastLive = lastPred
    ? {
        symbol: lastPred.symbol,
        model: lastPred.model,
        tp: lastPred.tp_pct != null ? `+${lastPred.tp_pct.toFixed(1)}%` : null,
        sl: lastPred.sl_pct != null ? `−${Math.abs(lastPred.sl_pct).toFixed(1)}%` : null,
        confidence: lastPred.confidence != null ? formatConfidence(lastPred.confidence) : null,
        heatmapSrc:
          lastPred.bot_id && lastPred.run_id
            ? lastPred.has_heatmap
              ? botsApi.getRunHeatmapUrl(
                  lastPred.bot_id,
                  lastPred.run_id,
                  lastPred.finished_at || lastPred.run_id
                )
              : botsApi.getRunChartUrl(
                  lastPred.bot_id,
                  lastPred.run_id,
                  lastPred.finished_at || lastPred.run_id
                )
            : null,
        botHref: lastPred.bot_id ? `/dashboard/bots/${lastPred.bot_id}` : null,
      }
    : {
        symbol: "—",
        model: "—",
        tp: "—",
        sl: "—",
        confidence: "—",
        heatmapSrc: null,
        botHref: null,
      };

  const equityByBot = bundle?.equity_by_bot ?? [];
  const perfLines = useMemo(() => {
    const account = buildAccountSeries(equityByBot);
    const botsLines = equityByBot.slice(0, 8).map((s, i) => ({
      ...s,
      name: s.name || s.symbol || `Bot ${i + 1}`,
    }));
    return account ? [...botsLines, account] : botsLines;
  }, [equityByBot]);

  const perfLegend = perfLines.map((s, i) => ({
    label: s.name || s.symbol,
    color: FLEET_LINE_COLORS[i % FLEET_LINE_COLORS.length],
  }));

  const activity = bundle?.activity_feed ?? [];
  const sectors = marqueeSectors(bots);
  const recentCloses = trades.filter((t) => t.exit_date).slice(0, 6);
  const liveBots = bots.filter((b) => (b.lifecycle_state ?? "active") !== "archived");
  const pausedCount =
    overview?.paused_bots ?? liveBots.filter((b) => (b.lifecycle_state ?? "") === "paused").length;
  const errorCount =
    overview?.error_bots ?? liveBots.filter((b) => (b.derived_status ?? "").toLowerCase() === "error").length;

  const closeWorkflowGuide = () => {
    setShowWorkflowGuide(false);
    try {
      window.localStorage.setItem("dashboard-workflow-guide-dismissed", "1");
    } catch {
      // no-op
    }
  };

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden font-sans">
      <DashboardTopBar className="mb-0 shrink-0" />
      <p className="shrink-0 px-2 py-0.5 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-red-500">
        notifications every {pollSec}s
      </p>

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

      <div className="shrink-0 px-1.5 pb-1 pt-0.5 md:px-2">
        <DemoModelPredictionsMarquee
          sectors={
            sectors.length
              ? sectors
              : [{ model: "No bot", line: "Deploy to see signals" }]
          }
        />
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden p-1.5 md:p-2">
        <div className={cn(dashboardCard, "w-full px-2 py-1.5")}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
            Market watch
          </p>
          <MarketTickerTape className="min-h-[46px] w-full" />
        </div>

        <div className="grid gap-1.5 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.85fr)]">
          <div className={cn(dashboardCard, dashboardCardHover, "p-2.5 md:p-3")}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Link
                to="/dashboard/portfolio"
                className={cn("text-[11px] font-semibold uppercase tracking-[0.2em]", demoLinkClass)}
              >
                Account overview
              </Link>
              <span className={systemOperationalBadgeClass(systemStatus)}>{systemStatus}</span>
            </div>
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-[0.1em] text-white/35">Total equity</p>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 font-digits text-[clamp(1.95rem,4vw,2.75rem)] font-semibold tabular-nums leading-none tracking-tight">
                {loading ? (
                  "…"
                ) : (
                  <>
                    <span className="text-white">{formatUsdPlain(cap.equity)}</span>
                    <span
                      className={cn(
                        "text-[0.92em] font-semibold",
                        cap.realizedReturnPct >= 0 ? "text-white/80" : "text-white/45"
                      )}
                    >
                      ({formatReturnPct(cap.realizedReturnPct)})
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
              <Stat label="Start capital" value={loading ? "…" : formatUsdPlain(cap.startCapital)} />
              <Stat label="Realized PnL" value={loading ? "…" : formatSignedUsd(cap.realizedPnl)} />
              <Stat label="Open MTM" value={loading ? "…" : formatSignedUsd(cap.openMtm)} />
              <Stat
                label="Win rate"
                value={
                  loading || overview?.win_rate_closed == null
                    ? "—"
                    : `${(overview.win_rate_closed * 100).toFixed(1)}%`
                }
              />
              <Stat label="Open trades" value={loading ? "…" : String(cap.openTrades)} />
              <Stat label="Closed trades" value={loading ? "…" : String(cap.closedTrades)} />
              <Stat
                label="Analyses (24h)"
                value={loading ? "…" : String(overview?.analyses_24h ?? 0)}
              />
              <Stat
                label="Bots"
                value={
                  loading
                    ? "…"
                    : `${overview?.active_bots ?? liveBots.length} live / ${pausedCount} paused`
                }
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] pt-2 text-[11px] text-white/60">
              <span>
                Next run{" "}
                <span className="font-digits text-white/85">
                  {overview?.next_scheduled_run_iso
                    ? formatShortDateTime(overview.next_scheduled_run_iso)
                    : "—"}
                </span>
              </span>
              <span>
                Best bot{" "}
                {overview?.best_bot_id ? (
                  <Link to={`/dashboard/bots/${overview.best_bot_id}`} className={demoLinkClass}>
                    {overview.best_bot_name || overview.best_bot_symbol || "—"}
                    {overview.best_realized_pnl != null
                      ? ` · ${formatSignedUsd(overview.best_realized_pnl)}`
                      : ""}
                  </Link>
                ) : (
                  <span className="text-white/45">—</span>
                )}
              </span>
              {errorCount > 0 ? (
                <span className="text-white/80">{errorCount} bot{errorCount === 1 ? "" : "s"} in error</span>
              ) : null}
            </div>
          </div>

          <div className={cn(dashboardCard, dashboardCardHover, "flex min-h-0 flex-col overflow-hidden p-2.5 md:p-3")}>
            <AccountFleetTable bots={bots} equityByBot={equityByBot} loading={loading} />
          </div>
        </div>

        <div className="grid min-h-[260px] gap-1.5 lg:grid-cols-2">
          <div className={cn(dashboardCard, "flex min-h-[240px] flex-col p-2 md:p-2.5")}>
            <div className="mb-1 flex shrink-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  to="/dashboard/portfolio"
                  className={cn("block w-fit text-[11px] font-semibold uppercase tracking-[0.2em]", demoLinkClass)}
                >
                  Account performance
                </Link>
                <p className="mt-0.5 text-[10px] leading-snug text-white/40 md:text-[11px]">
                  Combined equity plus each bot. Open a bot for its own curve.
                </p>
              </div>
              <div className="flex max-h-[72px] shrink-0 flex-col items-end gap-1 overflow-y-auto text-[9px] leading-tight text-white/75">
                {perfLegend.map((item) => (
                  <span key={item.label} className="flex items-center gap-1.5">
                    <span className="h-px w-4 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />
                    <span className="max-w-[7rem] truncate font-medium text-white/90">{item.label}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="flex min-h-[220px] flex-1 flex-col">
              <RunningProfitChart
                equityByBot={perfLines}
                baselineEquity={overview?.total_starting_capital ?? cap.startCapital}
                equityDisplay=""
                returnDisplay=""
                realizedDisplay=""
                hideArea
                hideHeader
                linePalette={[...FLEET_LINE_COLORS]}
                lineInterpolation="linear"
                largeHeader
                tallChart
                yAxisMode="currency"
              />
            </div>
          </div>

          <div className={cn(dashboardCard, "flex min-h-[240px] flex-col p-2 md:p-2.5")}>
            <DemoDailyProfitBarChart rows={bundle?.daily_profit ?? []} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5 xl:flex-row xl:items-stretch">
          <div className={cn(dashboardCard, "min-h-[220px] flex-1 p-2.5")}>
            <AccountAllocationChart bots={liveBots} equityByBot={equityByBot} />
          </div>
          <div className={cn(dashboardCard, "min-h-[220px] flex-1 p-2.5")}>
            <AccountSignalMix bots={liveBots} />
          </div>
          <div className={cn(dashboardCard, "min-h-[220px] flex-1 p-2.5")}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white">Recent closes</p>
              <Link to="/dashboard/trade-history" className={cn("text-[12px] font-semibold", demoLinkClass)}>
                History →
              </Link>
            </div>
            {recentCloses.length === 0 ? (
              <p className="mt-3 text-sm text-white/45">No closed trades on this account yet.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {recentCloses.map((t) => (
                  <li key={t.id} className="flex items-baseline justify-between gap-2 text-[11px]">
                    <Link to={`/dashboard/bots/${t.bot_id}`} className="min-w-0 truncate text-white/85 hover:underline">
                      <span className="font-digits font-semibold">{t.symbol}</span>
                      <span className="text-white/45"> · {t.status}</span>
                    </Link>
                    <span
                      className={cn(
                        "shrink-0 font-digits tabular-nums",
                        (t.pnl_amount ?? 0) >= 0 ? "text-white" : "text-white/50"
                      )}
                    >
                      {t.pnl_amount == null ? "—" : formatSignedUsd(t.pnl_amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div
            className={cn(
              dashboardCard,
              "mx-auto flex w-full max-w-[124px] shrink-0 flex-col p-1.5 md:p-2 xl:mx-0 xl:w-[124px] xl:min-w-[124px] xl:max-w-[124px]"
            )}
          >
            <DemoAccuracyRings
              weekPct={bundle?.accuracy?.week_pct ?? 0}
              monthPct={bundle?.accuracy?.month_pct ?? 0}
              yearPct={bundle?.accuracy?.year_pct ?? 0}
            />
          </div>
          <div
            className={cn(
              dashboardCard,
              "mx-auto flex w-full max-w-[124px] shrink-0 flex-col p-1.5 md:p-2 xl:mx-0 xl:w-[124px] xl:min-w-[124px] xl:max-w-[124px]"
            )}
          >
            <DemoLabelMatchRates
              correctL1={bundle?.label_match?.correct_l1_pct ?? 0}
              wrongL1={bundle?.label_match?.wrong_l1_pct ?? 0}
              correctL0={bundle?.label_match?.correct_l0_pct ?? 0}
            />
          </div>
        </div>

        <div className="grid gap-1.5 lg:grid-cols-2">
          <div className={cn(dashboardCard, "min-h-[220px] p-2.5")}>
            <DemoLastPredictionPanel live={lastLive} />
          </div>
          <div className={cn(dashboardCard, "min-h-[220px] overflow-hidden p-2.5")}>
            <DemoActivityLog
              items={
                activity.length
                  ? activity
                  : [
                      {
                        at: new Date().toISOString(),
                        kind: "prediction",
                        symbol: "—",
                        title: "Waiting",
                        subtitle: "No events yet",
                      },
                    ]
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
