import { Link } from "react-router-dom";
import { Radio } from "lucide-react";
import type { Bot, BotEquityPoint, DashboardActivityItem, DashboardBundle, DashboardEquitySeries, DashboardOverview } from "@/lib/api";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";
import { RunningProfitChart } from "@/components/dashboard/RunningProfitChart";
import { DemoDailyProfitBarChart } from "@/components/dashboard/DemoDailyProfitBarChart";
import { DemoAccuracyRings } from "@/components/dashboard/DemoAccuracyRings";
import { DemoActivityLog, DEMO_ACTIVITY_LOG } from "@/components/dashboard/DemoActivityLog";
import { DemoLabelMatchRates } from "@/components/dashboard/DemoLabelMatchRates";
import { DemoLastPredictionPanel } from "@/components/dashboard/DemoLastPredictionPanel";
import { DemoModelPredictionsMarquee } from "@/components/dashboard/DemoModelPredictionsMarquee";
import { DEMO_PORTFOLIO_LINE_COLORS, demoLinkClass } from "@/components/dashboard/demoPortfolioPalette";
import { MarketTickerTape } from "@/components/dashboard/MarketTickerTape";
import { dashboardCard, dashboardCardHover } from "@/components/dashboard/dashboardCard";
import { systemOperationalBadgeClass } from "@/components/dashboard/botStatusStyles";
import { cn } from "@/lib/utils";
import {
  capitalOverview,
  formatReturnPct,
  formatSignedUsd,
  formatShortDateTime,
  formatUsdPlain,
  systemStatusFromBots,
} from "@/components/dashboard/dashboardMetrics";

const DEMO_SPECS = [
  { symbol: "AAPL", name: "Alpha · swing" },
  { symbol: "MSFT", name: "Bravo · trend" },
  { symbol: "NVDA", name: "Charlie · momentum" },
  { symbol: "TSLA", name: "Delta · vol" },
  { symbol: "SPY", name: "Echo · index" },
  { symbol: "QQQ", name: "Foxtrot · tech" },
  { symbol: "IWM", name: "Golf · small-cap" },
  { symbol: "GLD", name: "Hotel · metals" },
  { symbol: "EURUSD", name: "India · FX A" },
  { symbol: "GBPUSD", name: "Juliet · FX B" },
  { symbol: "BTC", name: "Kilo · crypto" },
  { symbol: "ETH", name: "Lima · alt" },
] as const;

function buildDemoBots(): Bot[] {
  const base = Date.now();
  return DEMO_SPECS.map((s, i) => {
    const id = `demo-bot-${i + 1}`;
    const runAt = new Date(base - i * 2_700_000 - i * 60_000).toISOString();
    return {
      id,
      symbol: s.symbol,
      name: s.name,
      model_path: "/demo/placeholder.pt",
      model_filename: "placeholder.pt",
      confidence_threshold: 0.55,
      img_size: 224,
      is_active: true,
      created_at: new Date(base - 86400000 * (30 - i)).toISOString(),
      updated_at: new Date(base).toISOString(),
      derived_status: i % 4 === 0 ? "waiting" : i % 7 === 0 ? "running" : "active",
      starting_capital: 10_000 + i * 250,
      latest_run: {
        id: `demo-run-${i}`,
        bot_id: id,
        run_at: runAt,
        label: i % 3 === 0 ? "-1" : "1",
        status: "success",
        confidence: 0.58 + (i % 6) * 0.05,
      },
    };
  });
}

function buildDemoEquityByBot(bots: Bot[]) {
  const dayMs = 86_400_000;
  const start = Date.UTC(2026, 2, 1);
  return bots.map((bot, bi) => {
    const points: BotEquityPoint[] = [];
    let eq = (bot.starting_capital ?? 10_000) + bi * 40;
    for (let d = 0; d < 42; d++) {
      const wobble =
        Math.sin(d * 0.37 + bi) * 220 +
        Math.cos(d * 0.11 + bi * 0.7) * 95 +
        ((d + bi * 3) % 7) * 31 +
        ((d * 13) % 5) * 18;
      eq += wobble * 0.065;
      const asOf = new Date(start + d * dayMs + 16 * 3600 * 1000).toISOString();
      points.push({
        as_of: asOf,
        total_equity: Number(eq.toFixed(2)),
        realized_pnl: Number((eq - (bot.starting_capital ?? 10_000)).toFixed(2)),
      });
    }
    return {
      bot_id: bot.id,
      symbol: bot.symbol,
      name: bot.name,
      points,
    };
  });
}

/** Deterministic noise — reads like tape / bar-to-bar equity (jagged when rendered with `linear`). */
function fract01(i: number, salt: number) {
  const raw = i * 9301 + 49297 + salt * 104729;
  const x = ((raw % 233280) + 233280) % 233280;
  return x / 233280;
}

function buildDemoTriplePortfolioLines(): DashboardEquitySeries[] {
  const stepMs = 90 * 60 * 1000;
  const start = Date.UTC(2025, 8, 1);
  const n = 260;

  const mk = (
    bot_id: string,
    symbol: string,
    name: string,
    salt: number,
    drift: number
  ): DashboardEquitySeries => {
    let eq = 100_000 + salt * 1_400;
    const points: BotEquityPoint[] = [];
    for (let i = 0; i < n; i++) {
      const f = fract01(i, salt);
      const g = fract01(i * 3 + 1, salt + 2);
      const h = fract01(i * 7 + 5, salt + 11);
      const gap = (fract01(i * 13, salt) - 0.5) * 5_800;
      const micro = (f - 0.5) * 3_600 + (g - 0.5) * 2_200;
      const burst = Math.sin(i * 0.31) * 1_100 + Math.sin(i * 0.09) * 420 + Math.cos(i * 0.47) * 380;
      const jump = fract01(i * 19, salt) > 0.92 ? (fract01(i * 41, salt) - 0.5) * 9_200 : 0;
      const chop = ((i * 17 + salt) % 11) - 5;
      eq += drift + micro * 0.16 + burst * 0.12 + gap * 0.14 + jump + chop * 44;
      const as_of = new Date(start + i * stepMs).toISOString();
      points.push({
        as_of,
        total_equity: Number(eq.toFixed(2)),
        realized_pnl: Number((eq - 100_000).toFixed(2)),
      });
    }
    return { bot_id, symbol, name, points };
  };

  return [
    mk("demo-book-primary", "BOOK-A", "Primary sleeve", 1, 42),
    mk("demo-book-hedge", "BOOK-B", "Hedge sleeve", 4, -38),
    mk("demo-book-vol", "BOOK-C", "Volatility sleeve", 7, 6),
  ];
}

/** Two model sleeves + aggregate account line (aligned point indices). */
function buildBotPerformanceSeries(lines: DashboardEquitySeries[]): DashboardEquitySeries[] {
  const [a, b, c] = lines;
  if (!a || !b || !c) return lines;
  const accountPoints = a.points.map((_, i) => ({
    as_of: a.points[i].as_of,
    total_equity: a.points[i].total_equity + b.points[i].total_equity + c.points[i].total_equity,
    realized_pnl: 0,
  }));
  return [
    { ...a, bot_id: "demo-m-xl", name: "Convolve‑XL" },
    { ...b, bot_id: "demo-m-s", name: "Convolve‑S" },
    {
      bot_id: "demo-account",
      symbol: "ACCT",
      name: "Account",
      points: accountPoints,
    },
  ];
}

function buildDemoActivityFeed(bots: Bot[]): DashboardActivityItem[] {
  const out: DashboardActivityItem[] = [];
  let t = Date.now() - 3_600_000 * 48;
  for (let i = 0; i < 28; i++) {
    const b = bots[i % bots.length];
    t += 180_000 + (i % 4) * 90_000;
    out.push({
      at: new Date(t).toISOString(),
      kind: "prediction",
      symbol: b.symbol,
      title: i % 2 === 0 ? "LONG bias" : "SHORT bias",
      confidence: 0.52 + (i % 8) * 0.045,
    });
  }
  return out;
}

function buildDemoBundle(bots: Bot[], equityByBot: ReturnType<typeof buildDemoEquityByBot>): DashboardBundle {
  const bestId = bots[2]?.id ?? bots[0].id;
  const totalStart = bots.reduce((s, b) => s + (b.starting_capital ?? 10_000), 0);
  const overview: DashboardOverview = {
    total_realized_pnl: 18_240.55,
    open_unrealized_pnl: 1_120.4,
    active_bots: bots.length,
    best_bot_id: bestId,
    best_bot_name: bots[2]?.name ?? "—",
    best_bot_symbol: bots[2]?.symbol ?? "—",
    best_realized_pnl: 6_890.12,
    win_rate_closed: 0.58,
    total_closed_trades: 142,
    open_trades_count: 9,
    next_scheduled_run_iso: new Date(Date.now() + 3_600_000 * 2).toISOString(),
    total_starting_capital: totalStart,
    current_equity: totalStart + 18_240.55 + 1_120.4,
    label_1_precision: 0.612,
    label_1_precision_sample: 84,
    best_bot_starting_capital: bots[2]?.starting_capital ?? 10_000,
    best_bot_return_pct: 12.45,
    best_bot_max_drawdown_pct: -8.2,
    best_bot_label_1_precision: 0.64,
    best_bot_label_1_sample: 50,
  };

  return {
    overview,
    equity_by_bot: equityByBot,
    activity_feed: buildDemoActivityFeed(bots),
  };
}

const DEMO_BOTS = buildDemoBots();
const DEMO_EQUITY = buildDemoEquityByBot(DEMO_BOTS);
const DEMO_BUNDLE = buildDemoBundle(DEMO_BOTS, DEMO_EQUITY);
const DEMO_PORTFOLIO_LINES = buildDemoTriplePortfolioLines();
const DEMO_BOT_PERF_LINES = buildBotPerformanceSeries(DEMO_PORTFOLIO_LINES);

const BOT_PERF_LEGEND = [
  { label: "Convolve‑XL", color: DEMO_PORTFOLIO_LINE_COLORS[0] },
  { label: "Convolve‑S", color: DEMO_PORTFOLIO_LINE_COLORS[1] },
  { label: "Account", color: DEMO_PORTFOLIO_LINE_COLORS[2] },
] as const;

/**
 * Static preview of the dashboard with placeholder multi-bot data.
 */
export default function DashboardDemo() {
  const loading = false;
  const bots = DEMO_BOTS;
  const bundle = DEMO_BUNDLE;

  const overview = bundle.overview;
  const cap = capitalOverview(overview, bots);

  const systemStatus = systemStatusFromBots(bots);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden font-sans">
      <DashboardTopBar className="mb-0 shrink-0" />

      <div className="shrink-0 px-1.5 pb-1 pt-0.5 md:px-2">
        <DemoModelPredictionsMarquee />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden p-1.5 md:p-2">
        {/* Row 1: Account + Operations flex; accuracy column fixed width (donuts only) */}
        <div className="flex shrink-0 flex-col gap-1 md:flex-row md:items-stretch md:gap-1.5 md:justify-start">
          <div
            className={cn(
              "flex h-full min-h-0 min-w-0 w-full shrink-0 flex-col md:max-w-[min(495px,50vw)]",
              dashboardCard,
              dashboardCardHover,
              "p-2 md:p-2.5"
            )}
          >
            <Link
              to="/dashboard/portfolio"
              className={cn(
                "block w-fit shrink-0 text-[11px] font-semibold uppercase tracking-[0.2em]",
                demoLinkClass
              )}
            >
              Account & Performance
            </Link>
            <div className="mt-2 shrink-0">
              <p className="text-[10px] uppercase tracking-[0.1em] text-white/35">Equity</p>
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
            <div className="mt-2.5 grid shrink-0 grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/40">Start capital</p>
                <p className="font-digits text-[20px] font-semibold tabular-nums text-white sm:text-[23px]">
                  {loading ? "…" : formatUsdPlain(cap.startCapital)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/40">Realized PnL</p>
                <p className="font-digits text-[20px] font-semibold tabular-nums text-white sm:text-[23px]">
                  {loading ? "…" : formatSignedUsd(cap.realizedPnl)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/40">Open MTM</p>
                <p className="font-digits text-[20px] font-semibold tabular-nums text-white sm:text-[23px]">
                  {loading ? "…" : formatSignedUsd(cap.openMtm)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/40">Open trades</p>
                <p className="font-digits text-[20px] font-semibold tabular-nums text-white sm:text-[23px]">
                  {loading ? "…" : cap.openTrades}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/40">Closed trades</p>
                <p className="font-digits text-[20px] font-semibold tabular-nums text-white sm:text-[23px]">
                  {loading ? "…" : cap.closedTrades}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/40">Win rate (closed)</p>
                <p className="font-digits text-[20px] font-semibold tabular-nums text-white sm:text-[23px]">
                  {loading || overview?.win_rate_closed == null
                    ? "…"
                    : `${(overview.win_rate_closed * 100).toFixed(1)}%`}
                </p>
              </div>
            </div>
            <div className="mt-auto border-t border-white/[0.1] pt-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-white">Market watch</p>
              <div className="mt-2 w-full min-w-0">
                <MarketTickerTape compact className="min-h-[64px]" />
              </div>
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-1 md:flex-row md:items-stretch md:gap-1.5">
            <div
              className={cn(
                "flex min-h-0 min-w-0 flex-1 flex-col",
                dashboardCard,
                dashboardCardHover,
                "p-2 md:p-2.5"
              )}
            >
              <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.2em] text-white">Operations</p>
              <div className="mt-1.5 flex min-h-0 flex-1 flex-col gap-1.5">
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] pb-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">System</span>
                  <span className={systemOperationalBadgeClass(systemStatus)}>{systemStatus}</span>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[14px] font-medium text-white/90">
                    <Radio className="h-4 w-4 shrink-0 text-white/55" aria-hidden />
                    Active bots
                  </span>
                  <span className="font-digits text-[19px] font-semibold tabular-nums text-white">
                    {loading ? "…" : overview?.active_bots ?? 0}
                  </span>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-1 border-t border-white/[0.06] pt-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-white">Next run</span>
                  <span className="max-w-[58%] text-right font-digits text-[11px] leading-tight text-white/85">
                    {overview?.next_scheduled_run_iso ? formatShortDateTime(overview.next_scheduled_run_iso) : "—"}
                  </span>
                </div>
                <div className="min-h-0 flex-1">
                  <DemoLastPredictionPanel />
                </div>
                <Link to="/dashboard/bots" className={cn("mt-auto inline-flex shrink-0 pt-0.5 text-[13px] font-semibold", demoLinkClass)}>
                  View all bots →
                </Link>
              </div>
            </div>

            <div
              className={cn(
                "flex min-h-0 w-full flex-col overflow-hidden md:h-full md:min-h-0 md:w-[275px] md:max-w-[295px] md:shrink-0 md:self-stretch",
                dashboardCard,
                dashboardCardHover,
                "p-2 md:p-2.5"
              )}
            >
              <DemoActivityLog items={DEMO_ACTIVITY_LOG} />
            </div>
          </div>

          <div
            className={cn(
              "mx-auto flex h-full min-h-0 w-full max-w-[124px] shrink-0 flex-col md:ml-0 md:mr-0 md:w-[124px] md:min-w-[124px] md:max-w-[124px]",
              dashboardCard,
              dashboardCardHover,
              "p-1.5 md:p-2"
            )}
          >
            <DemoAccuracyRings />
          </div>

          <div
            className={cn(
              "mx-auto flex h-full min-h-0 w-full max-w-[124px] shrink-0 flex-col md:ml-0 md:w-[124px] md:min-w-[124px] md:max-w-[124px]",
              dashboardCard,
              dashboardCardHover,
              "p-1.5 md:p-2"
            )}
          >
            <DemoLabelMatchRates />
          </div>
        </div>

        {/* Row 2: Portfolio equity | Profit per day — flex so both columns share height and charts get flex space */}
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden lg:flex-row">
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden max-lg:min-h-[168px] lg:min-w-0",
              dashboardCard,
              "rounded-md p-1.5 md:p-2"
            )}
          >
            <div className="mb-1 flex shrink-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  to="/dashboard/portfolio"
                  className={cn("block w-fit text-[11px] font-semibold uppercase tracking-[0.2em]", demoLinkClass)}
                >
                  Bot performances
                </Link>
                <p className="mt-0.5 text-[10px] leading-snug text-white/40 md:text-[11px]">
                  Cumulative % return vs first sample — two models + account.
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5 text-[9px] leading-tight text-white/75">
                {BOT_PERF_LEGEND.map((item) => (
                  <span key={item.label} className="flex items-center gap-1.5">
                    <span className="h-px w-4 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />
                    <span className="max-w-[7rem] truncate font-medium text-white/90">{item.label}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <RunningProfitChart
                equityByBot={DEMO_BOT_PERF_LINES}
                baselineEquity={overview?.total_starting_capital ?? cap.startCapital}
                equityDisplay=""
                returnDisplay=""
                realizedDisplay=""
                hideArea
                hideHeader
                linePalette={[...DEMO_PORTFOLIO_LINE_COLORS]}
                lineInterpolation="linear"
                largeHeader
                tallChart
                yAxisMode="percentReturn"
              />
            </div>
          </div>

          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden max-lg:min-h-[168px] lg:min-w-0",
              dashboardCard,
              "rounded-md p-1.5 md:p-2"
            )}
          >
            <DemoDailyProfitBarChart />
          </div>
        </div>
      </div>
    </div>
  );
}
