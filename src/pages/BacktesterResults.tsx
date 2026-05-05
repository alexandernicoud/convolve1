import { useState, useEffect, useMemo, Fragment } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { ArrowLeft, BarChart3, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  BarChart as RechartsBarChart,
  Bar,
  Cell,
  ComposedChart,
  ScatterChart,
  Scatter,
} from "recharts";
import { realtimeBacktesterApi, apiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { dashboardCard } from "@/components/dashboard/dashboardCard";

/* —— Monochrome tokens (white / black / gray) —— */
const C = {
  bg: "#0a0a0a",
  surface: "rgba(255,255,255,0.03)",
  border: "rgba(255,255,255,0.12)",
  text: "#FAFAFA",
  muted: "rgba(250,250,250,0.55)",
  grid: "rgba(255,255,255,0.08)",
  /** Softer horizontal grid on primary equity chart */
  gridSoft: "rgba(255,255,255,0.045)",
  axisLine: "rgba(255,255,255,0.14)",
  accent: "#E5E7EB",
  accent2: "#A1A1AA",
  accentDeep: "#52525B",
  accentBright: "#F4F4F5",
  accentSoft: "#D4D4D8",
  /** Positive / accent bars & fills — violet */
  positive: "#A855F7",
  /** Neutral “down” / secondary series — avoid red in UI */
  negative: "#94A3B8",
  tooltipBg: "#0a0a0a",
};

/** Equity curve: strategy (performance) — violet accent */
const EQ_STRATEGY = "#A855F7";
const EQ_BASELINE_PRIMARY = "rgba(255,255,255,0.82)";
const EQ_BASELINE_SECONDARY = "rgba(203,213,225,0.55)";
/** Threshold sweep: left axis / total return % line — violet; right axis stays neutral */
const TH_LEFT = "#A855F7";
const TH_RIGHT = "rgba(248,250,252,0.88)";

interface BacktestConfig {
  model_path: string;
  dataset_path: string;
  sample_size: string | number;
  confidence_threshold: number;
  tp_pct: number;
  sl_pct: number;
  img_size: number;
  timestamp?: string;
  starting_capital?: number;
  position_size_pct?: number;
  commission_pct?: number;
  slippage_pct?: number;
  max_drawdown_pct?: number;
  max_trades_per_day?: number;
}

interface BacktestKPIs {
  trades: number;
  /** Charts walked in chronological order (may be less than sample_size if halted). */
  total_charts_analyzed?: number;
  no_trade_count?: number;
  trade_frequency?: number;
  no_trade_rate?: number;
  pnl: number;
  return_pct?: number;
  accuracy: number;
  precision: number;
  recall: number;
  sample_size: number;
  buy_and_hold?: number;
  win_rate: number;
  profit_factor: number | null;
  sharpe_ratio: number | null;
  sharpe_ratio_annualized_hint?: number | null;
  metrics_insufficient_sample?: boolean;
  max_drawdown: number;
  /** Realized peak-to-trough drawdown as % of running peak equity */
  max_drawdown_pct?: number;
  avg_win: number;
  avg_loss: number;
  starting_capital: number;
  position_size_pct: number;
  commission_pct: number;
  slippage_pct: number;
  /** Strategy risk setting (halt trading) — not realized drawdown */
  strategy_max_drawdown_limit_pct?: number;
  max_trades_per_day: number;
  model_f1?: number;
  avg_confidence_trades?: number;
  avg_confidence_all_images?: number;
}

interface BacktestTrade {
  trade_id: number;
  entry_price: number;
  exit_price: number;
  prediction: "long" | "short" | "unknown";
  actual: "long" | "short" | "unknown";
  confidence: number;
  outcome: "TP" | "SL" | "NO_TRADE";
  pnl_gross: number;
  commission: number;
  slippage: number;
  pnl_net: number;
  capital_after: number;
  filename: string;
}

/** One row in the full timeline ledger (chart_events when present). */
interface LedgerRow {
  key: number;
  predictedLabel: 0 | 1;
  predDisplay: string;
  actualDisplay: string;
  confidence: number;
  outcome: "TP" | "SL" | "NO_TRADE";
  pnl_net: number;
  capital_after: number;
  filename: string;
  trade_taken: boolean;
  entry_price: number;
  exit_price: number;
  commission: number;
  slippage: number;
}

/** Win rate when predicting label 1: correct / total among predicted_label === 1. Optional min P(long) for threshold sweeps. */
function label1WinRateFromEvents(
  events: Record<string, unknown>[],
  minConfidence?: number,
): number | null {
  let total = 0;
  let correct = 0;
  for (const e of events) {
    const pl = toNumber(e.predicted_label) >= 1 ? 1 : 0;
    const al = toNumber(e.actual_label) >= 1 ? 1 : 0;
    const conf = normalizeConfidence(e.confidence);
    if (pl !== 1) continue;
    if (minConfidence !== undefined && conf < minConfidence) continue;
    total++;
    if (al === 1) correct++;
  }
  return total > 0 ? (correct / total) * 100 : null;
}

function label1WinRateFromLedger(rows: LedgerRow[]): number | null {
  let total = 0;
  let correct = 0;
  for (const r of rows) {
    if (r.predictedLabel !== 1) continue;
    total++;
    if (r.actualDisplay === "long") correct++;
  }
  return total > 0 ? (correct / total) * 100 : null;
}

function label1WinRateFromLedgerAtThreshold(rows: LedgerRow[], threshold: number): number | null {
  let total = 0;
  let correct = 0;
  for (const r of rows) {
    if (r.predictedLabel !== 1) continue;
    if (r.confidence < threshold) continue;
    total++;
    if (r.actualDisplay === "long") correct++;
  }
  return total > 0 ? (correct / total) * 100 : null;
}

interface BacktestSummary {
  total_images_processed: number;
  charts_analyzed?: number;
  trades_executed: number;
  model_predictions: number;
  avg_confidence: number;
  avg_confidence_all_images?: number;
}

interface SeriesEquityPoint {
  trade_index: number;
  step_index?: number;
  equity: number;
  cumulative_pnl: number;
  as_of_date?: string | null;
  chart_end_date?: string | null;
  outcome?: string | null;
  trade_taken?: boolean;
  /** Indexed to 100 at timeline start (equity / starting * 100). */
  strategy_indexed?: number;
  spy_indexed?: number | null;
  underlying_indexed?: number | null;
  /** 0 = no trade (flat equity step); 1 = long attempt; null on initial point. */
  predicted_label?: number | null;
}

interface SeriesDrawdownPoint {
  trade_index: number;
  step_index?: number;
  drawdown_pct: number;
}

interface SeriesConfidencePoint {
  trade_index: number;
  step_index?: number;
  confidence: number;
}

/** Counterfactual sweep: P(long) ≥ entry_threshold, thresholds 0.0 … 1.0 step 0.1 */
interface SeriesThresholdSweepPoint {
  entry_threshold: number;
  return_pct: number;
  win_rate_pct: number;
  trades: number;
}

interface BacktestSeries {
  equity: SeriesEquityPoint[];
  drawdown_pct: SeriesDrawdownPoint[];
  confidence_by_trade: SeriesConfidencePoint[];
  threshold_sweep?: SeriesThresholdSweepPoint[];
}

interface ClassificationMetricsBlock {
  description?: string;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
}

interface BacktestBenchmarkMeta {
  ok?: boolean;
  spy_ticker?: string;
  underlying_symbol?: string | null;
  underlying_ticker?: string | null;
  phase_start?: string | null;
  phase_end?: string | null;
  error?: string | null;
}

interface BacktesterResult {
  timestamp?: string;
  config?: BacktestConfig;
  kpis: BacktestKPIs;
  trades: BacktestTrade[];
  charts: Record<string, string>;
  summary: BacktestSummary;
  series?: BacktestSeries;
  benchmark?: BacktestBenchmarkMeta;
  chart_events?: Record<string, unknown>[];
  classification_metrics?: ClassificationMetricsBlock | null;
}

const DEFAULT_KPIS: BacktestKPIs = {
  trades: 0,
  pnl: 0,
  accuracy: 0,
  precision: 0,
  recall: 0,
  sample_size: 0,
  buy_and_hold: 0,
  win_rate: 0,
  profit_factor: null,
  sharpe_ratio: null,
  max_drawdown: 0,
  max_drawdown_pct: 0,
  avg_win: 0,
  avg_loss: 0,
  starting_capital: 0,
  position_size_pct: 0,
  commission_pct: 0,
  slippage_pct: 0,
  max_trades_per_day: 0,
};

const DEFAULT_SUMMARY: BacktestSummary = {
  total_images_processed: 0,
  trades_executed: 0,
  model_predictions: 0,
  avg_confidence: 0,
};

const toNumber = (value: unknown, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const normalizeConfidence = (value: unknown) => {
  const numeric = toNumber(value, 0);
  const scaled = numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
  return Math.min(1, Math.max(0, scaled));
};

const normalizePrediction = (value: unknown) => {
  if (value === 1 || value === "1") return "long";
  if (value === 0 || value === "0") return "short";
  const normalized = String(value || "").toLowerCase();
  if (normalized.startsWith("l")) return "long";
  if (normalized.startsWith("s")) return "short";
  return "unknown";
};

const normalizeOutcome = (value: unknown) => {
  const normalized = String(value || "").toUpperCase();
  if (normalized.includes("NO_TRADE") || normalized.includes("NO TRADE")) return "NO_TRADE" as const;
  if (normalized.includes("TP")) return "TP";
  if (normalized.includes("SL")) return "SL";
  return "TP";
};

const parseLedgerOutcome = (value: unknown): "TP" | "SL" | "NO_TRADE" => {
  const u = String(value || "").toUpperCase();
  if (u === "NO_TRADE" || u.includes("NO_TRADE")) return "NO_TRADE";
  if (u.includes("TP")) return "TP";
  if (u.includes("SL")) return "SL";
  return "NO_TRADE";
};

const chartFilenamePattern =
  /^([A-Z0-9._-]+)_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})_label\d+(?:_[a-z0-9]+)?\.png$/i;

function isoDayFromUnknown(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

/** Chart filename end date — used as the day key for that trade when no ISO date field exists. */
function isoDayFromFilename(filename: string): string | null {
  const fn = filename.split("/").pop() || filename;
  const m = fn.match(chartFilenamePattern);
  if (m?.[3]) return m[3];
  return null;
}

const formatDateRange = (start?: string, end?: string) => {
  if (!start || !end) return "Unknown";
  return `${start} → ${end}`;
};

const calculateDurationDays = (start?: string, end?: string) => {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  const diffMs = endDate.getTime() - startDate.getTime();
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
};

const normalizeResult = (data: Record<string, unknown>): BacktesterResult => {
  const rawConfig = (data?.config ?? {}) as Record<string, unknown>;
  const config: BacktestConfig = {
    model_path: String(rawConfig.model_path ?? ""),
    dataset_path: String(rawConfig.dataset_path ?? ""),
    sample_size: rawConfig.sample_size as string | number,
    confidence_threshold: toNumber(rawConfig.confidence_threshold, 0),
    tp_pct: toNumber(rawConfig.tp_pct, 0),
    sl_pct: toNumber(rawConfig.sl_pct, 0),
    img_size: toNumber(rawConfig.img_size, 0),
    starting_capital: toNumberOrNull(rawConfig.starting_capital) ?? undefined,
    position_size_pct: toNumberOrNull(rawConfig.position_size_pct) ?? undefined,
    commission_pct: toNumberOrNull(rawConfig.commission_pct) ?? undefined,
    slippage_pct: toNumberOrNull(rawConfig.slippage_pct) ?? undefined,
    max_drawdown_pct: toNumberOrNull(rawConfig.max_drawdown_pct) ?? undefined,
    max_trades_per_day: toNumberOrNull(rawConfig.max_trades_per_day) ?? undefined,
  };

  const mergedKpis = { ...DEFAULT_KPIS, ...((data?.kpis ?? {}) as object) };
  const mk = mergedKpis as Record<string, unknown>;

  const kpis: BacktestKPIs = {
    ...DEFAULT_KPIS,
    trades: toNumber(mk.trades),
    total_charts_analyzed:
      mk.total_charts_analyzed !== undefined ? toNumber(mk.total_charts_analyzed) : undefined,
    no_trade_count: mk.no_trade_count !== undefined ? toNumber(mk.no_trade_count) : undefined,
    trade_frequency: mk.trade_frequency !== undefined ? toNumber(mk.trade_frequency) : undefined,
    no_trade_rate: mk.no_trade_rate !== undefined ? toNumber(mk.no_trade_rate) : undefined,
    pnl: toNumber(mk.pnl),
    return_pct: mk.return_pct !== undefined ? toNumber(mk.return_pct) : undefined,
    accuracy: normalizeConfidence(mk.accuracy),
    precision: normalizeConfidence(mk.precision),
    recall: normalizeConfidence(mk.recall),
    sample_size: toNumber(mk.sample_size),
    buy_and_hold: mk.buy_and_hold !== undefined ? toNumber(mk.buy_and_hold) : undefined,
    win_rate: normalizeConfidence(mk.win_rate),
    profit_factor: toNumberOrNull(mk.profit_factor),
    sharpe_ratio: toNumberOrNull(mk.sharpe_ratio),
    sharpe_ratio_annualized_hint: toNumberOrNull(mk.sharpe_ratio_annualized_hint),
    metrics_insufficient_sample: Boolean(mk.metrics_insufficient_sample),
    max_drawdown: toNumber(mk.max_drawdown),
    max_drawdown_pct: mk.max_drawdown_pct !== undefined ? toNumber(mk.max_drawdown_pct) : undefined,
    avg_win: toNumber(mk.avg_win),
    avg_loss: toNumber(mk.avg_loss),
    starting_capital: toNumber(mk.starting_capital),
    position_size_pct: toNumber(mk.position_size_pct),
    commission_pct: toNumber(mk.commission_pct),
    slippage_pct: toNumber(mk.slippage_pct),
    strategy_max_drawdown_limit_pct:
      mk.strategy_max_drawdown_limit_pct !== undefined
        ? toNumber(mk.strategy_max_drawdown_limit_pct)
        : undefined,
    max_trades_per_day: toNumber(mk.max_trades_per_day),
    model_f1: mk.model_f1 !== undefined ? toNumber(mk.model_f1) : undefined,
    avg_confidence_trades:
      mk.avg_confidence_trades !== undefined
        ? normalizeConfidence(mk.avg_confidence_trades)
        : undefined,
    avg_confidence_all_images:
      mk.avg_confidence_all_images !== undefined
        ? normalizeConfidence(mk.avg_confidence_all_images)
        : undefined,
  };

  const mergedSummary = { ...DEFAULT_SUMMARY, ...((data?.summary ?? {}) as object) };
  const ms = mergedSummary as Record<string, unknown>;
  const summary: BacktestSummary = {
    total_images_processed: toNumber(ms.total_images_processed),
    charts_analyzed: ms.charts_analyzed !== undefined ? toNumber(ms.charts_analyzed) : undefined,
    trades_executed: toNumber(ms.trades_executed),
    model_predictions: toNumber(ms.model_predictions),
    avg_confidence: normalizeConfidence(ms.avg_confidence),
    avg_confidence_all_images:
      ms.avg_confidence_all_images !== undefined
        ? normalizeConfidence(ms.avg_confidence_all_images)
        : undefined,
  };

  const rawSeries = data?.series as Record<string, unknown> | undefined;
  let series: BacktestSeries | undefined;
  if (rawSeries && Array.isArray(rawSeries.equity)) {
    series = {
      equity: (rawSeries.equity as Record<string, unknown>[]).map((p) => ({
        trade_index: toNumber(p.trade_index !== undefined ? p.trade_index : p.step_index),
        step_index: p.step_index !== undefined ? toNumber(p.step_index) : undefined,
        equity: toNumber(p.equity),
        cumulative_pnl: toNumber(p.cumulative_pnl),
        as_of_date:
          p.as_of_date !== undefined && p.as_of_date !== null ? String(p.as_of_date) : undefined,
        chart_end_date:
          p.chart_end_date !== undefined && p.chart_end_date !== null ? String(p.chart_end_date) : undefined,
        outcome: p.outcome !== undefined && p.outcome !== null ? String(p.outcome) : undefined,
        trade_taken: p.trade_taken === true,
        strategy_indexed:
          p.strategy_indexed !== undefined && p.strategy_indexed !== null
            ? toNumber(p.strategy_indexed)
            : undefined,
        spy_indexed:
          p.spy_indexed !== undefined && p.spy_indexed !== null ? toNumber(p.spy_indexed) : undefined,
        underlying_indexed:
          p.underlying_indexed !== undefined && p.underlying_indexed !== null
            ? toNumber(p.underlying_indexed)
            : undefined,
        predicted_label:
          p.predicted_label === null || p.predicted_label === undefined
            ? undefined
            : toNumber(p.predicted_label),
      })),
      drawdown_pct: Array.isArray(rawSeries.drawdown_pct)
        ? (rawSeries.drawdown_pct as SeriesDrawdownPoint[]).map((p) => ({
            trade_index: toNumber(p.trade_index !== undefined ? p.trade_index : p.step_index),
            step_index: p.step_index !== undefined ? toNumber(p.step_index) : undefined,
            drawdown_pct: toNumber(p.drawdown_pct),
          }))
        : [],
      confidence_by_trade: Array.isArray(rawSeries.confidence_by_trade)
        ? (rawSeries.confidence_by_trade as SeriesConfidencePoint[]).map((p) => ({
            trade_index: toNumber(p.trade_index !== undefined ? p.trade_index : p.step_index),
            step_index: p.step_index !== undefined ? toNumber(p.step_index) : undefined,
            confidence: toNumber(p.confidence),
          }))
        : [],
      threshold_sweep: Array.isArray(rawSeries.threshold_sweep)
        ? (rawSeries.threshold_sweep as Record<string, unknown>[]).map((row) => ({
            entry_threshold: toNumber(row.entry_threshold),
            return_pct: toNumber(row.return_pct),
            win_rate_pct: toNumber(row.win_rate_pct),
            trades: toNumber(row.trades),
          }))
        : undefined,
    };
  }

  const rawBench = data?.benchmark as Record<string, unknown> | undefined;

  return {
    timestamp: data?.timestamp as string | undefined,
    config,
    kpis,
    trades: ((data?.trades as unknown[]) || []).map((trade: Record<string, unknown>) => ({
      trade_id: toNumber(trade?.trade_id),
      entry_price: toNumber(trade?.entry_price),
      exit_price: toNumber(trade?.exit_price),
      prediction: normalizePrediction(trade?.prediction),
      actual: normalizePrediction(trade?.actual),
      confidence: normalizeConfidence(trade?.confidence),
      outcome: normalizeOutcome(trade?.outcome),
      pnl_gross: toNumber(trade?.pnl_gross),
      commission: toNumber(trade?.commission),
      slippage: toNumber(trade?.slippage),
      pnl_net: toNumber(trade?.pnl_net),
      capital_after: toNumber(trade?.capital_after),
      filename: (trade?.filename as string) || "",
    })) as BacktestTrade[],
    charts: (data?.charts || {}) as Record<string, string>,
    summary,
    series,
    chart_events: Array.isArray(data?.chart_events) ? (data.chart_events as Record<string, unknown>[]) : undefined,
    benchmark: rawBench
      ? {
          ok: Boolean(rawBench.ok),
          spy_ticker: rawBench.spy_ticker !== undefined ? String(rawBench.spy_ticker) : undefined,
          underlying_symbol:
            rawBench.underlying_symbol !== undefined && rawBench.underlying_symbol !== null
              ? String(rawBench.underlying_symbol)
              : undefined,
          underlying_ticker:
            rawBench.underlying_ticker !== undefined && rawBench.underlying_ticker !== null
              ? String(rawBench.underlying_ticker)
              : undefined,
          phase_start:
            rawBench.phase_start !== undefined && rawBench.phase_start !== null
              ? String(rawBench.phase_start)
              : undefined,
          phase_end:
            rawBench.phase_end !== undefined && rawBench.phase_end !== null ? String(rawBench.phase_end) : undefined,
          error: rawBench.error !== undefined && rawBench.error !== null ? String(rawBench.error) : undefined,
        }
      : undefined,
    classification_metrics: (data?.classification_metrics ?? null) as ClassificationMetricsBlock | null,
  };
};

const resolveChartSrc = (charts: Record<string, string>, filename?: string) => {
  if (!filename || !charts) return null;
  const basename = filename.split("/").pop() || filename;
  const candidates = [filename, basename, ...Object.keys(charts).filter((key) => key.endsWith(basename))];
  const chartValue = candidates.map((key) => charts[key]).find(Boolean);
  if (!chartValue) return null;
  if (chartValue.startsWith("data:image")) return chartValue;
  const looksLikeBase64 = /^[A-Za-z0-9+/=\s]+$/.test(chartValue) && chartValue.length > 100;
  if (looksLikeBase64) return `data:image/png;base64,${chartValue.replace(/\s+/g, "")}`;
  if (chartValue.startsWith("http")) return chartValue;
  if (chartValue.startsWith("/")) return apiUrl(chartValue);
  return apiUrl(`/${chartValue}`);
};

function formatUsd(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
}

/** Shorter currency for tight KPI tiles */
function formatUsdCompact(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(n);
}

function formatAxisUsd(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

/** KPI rates from JSON may be 0–1 or already 0–100 */
function formatRatePercent(value: number | undefined, fractionDigits = 1): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const pct = value > 1 ? value : value * 100;
  return `${pct.toFixed(fractionDigits)}%`;
}

function formatShortDate(iso: string | null | undefined) {
  if (!iso || typeof iso !== "string") return "";
  const d = new Date(iso + (iso.length === 10 ? "T12:00:00" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

type ConfidenceScatterPoint = {
  x: number;
  xLabel: string;
  xIsTime: boolean;
  y: number;
  actualLabel: 0 | 1;
  predictedLabel: 0 | 1;
};

function Ambient() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-24 top-0 h-[480px] w-[480px] rounded-full bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.05),transparent_70%)] blur-3xl" />
      <div className="absolute right-0 top-1/3 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.04),transparent_68%)] blur-3xl" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/30 to-black" />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">{children}</p>
  );
}

function ChartShell({
  title,
  subtitle,
  children,
  className = "",
  density = "default",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  density?: "default" | "compact";
}) {
  const pad = density === "compact" ? "p-3 md:p-3.5" : "p-4 md:p-5";
  const headMb = density === "compact" ? "mb-1.5" : "mb-2";
  const subCls =
    density === "compact" ?
      "mt-0.5 text-[10px] leading-snug text-white/40"
    : "mt-1 text-xs leading-snug text-white/45";
  const titleCls =
    density === "compact" ?
      "mt-0.5 text-[13px] font-semibold tracking-tight text-white"
    : "mt-1 text-sm font-semibold tracking-tight text-white";
  return (
    <div className={cn("flex flex-col", dashboardCard, pad, className)}>
      <div className={`${headMb} shrink-0`}>
        <SectionLabel>Chart</SectionLabel>
        <h3 className={titleCls}>{title}</h3>
        {subtitle ? <p className={subCls}>{subtitle}</p> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg">{children}</div>
    </div>
  );
}

const tooltipStyle = {
  backgroundColor: C.tooltipBg,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  fontSize: 12,
};

function ConfidenceScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: ConfidenceScatterPoint }>;
}) {
  if (!active || !payload?.[0]) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl px-3 py-2 text-xs shadow-xl" style={tooltipStyle}>
      <p className="text-[10px] text-[rgba(255,255,255,0.5)]">
        {p.xIsTime ? formatShortDate(p.xLabel) : p.xLabel}
      </p>
      <p className="mt-1 font-medium tabular-nums text-white">Confidence (P long): {p.y.toFixed(1)}%</p>
      <p className="mt-0.5 text-[rgba(255,255,255,0.78)]">
        Actual label: {p.actualLabel === 1 ? "1 (long)" : "0"}
      </p>
      <p className="text-[rgba(255,255,255,0.78)]">
        Predicted label: {p.predictedLabel === 1 ? "1 (long)" : "0"}
      </p>
    </div>
  );
}

/** Tiny points — default Recharts scatter circles are oversized on dense series. */
function ConfidenceScatterDot(props: { cx?: number; cy?: number; fill?: string; stroke?: string }) {
  const { cx, cy, fill, stroke } = props;
  if (cx == null || cy == null) return null;
  return <circle cx={cx} cy={cy} r={1.5} fill={fill} stroke={stroke} strokeWidth={0.35} />;
}

const lineStrokeRounded = { strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/** Recharts ResponsiveContainer needs a definite pixel height; % inside flex often resolves to 0. */
/** Plot height only; legend sits below in the card (does not reduce this). */
const EQUITY_CHART_PX = 228;

const kpiLabelClass = "text-[9px] font-medium uppercase tracking-[0.12em] text-white/40";

export default function BacktesterResults() {
  const { runId } = useParams<{ runId: string }>();
  const location = useLocation();
  const backHref =
    (location.state as { fromRunHistory?: string } | null | undefined)?.fromRunHistory ??
    "/tools/run-log/backtester";

  const [result, setResult] = useState<BacktesterResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    status: string;
    progress: number;
    stage: string;
    message: string;
  } | null>(null);

  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "TP" | "SL" | "NO_TRADE">("all");
  const [predictionFilter, setPredictionFilter] = useState<"all" | "long" | "short" | "unknown">("all");
  const [confidenceFilter, setConfidenceFilter] = useState<number>(0);
  const [expandedTrade, setExpandedTrade] = useState<number | null>(null);
  const [ledgerExpanded, setLedgerExpanded] = useState(false);

  useEffect(() => {
    setLedgerExpanded(false);
  }, [outcomeFilter, predictionFilter, confidenceFilter]);

  const processedData = useMemo(() => {
    if (!result) return null;

    const { kpis, trades, summary, series, chart_events } = result;
    const config = result.config ?? ({} as BacktestConfig);

    const modelName = config.model_path?.split("/").pop()?.split(".")[0] || "—";
    const datasetName = config.dataset_path?.split("/").pop() || "—";

    const returnPct =
      kpis.return_pct !== undefined && Number.isFinite(kpis.return_pct)
        ? kpis.return_pct
        : kpis.starting_capital
          ? (kpis.pnl / kpis.starting_capital) * 100
          : 0;

    const startCap = kpis.starting_capital > 0 ? kpis.starting_capital : 0;

    const equityData =
      series?.equity?.length ?
        series.equity.map((p) => {
          const stratIdx =
            p.strategy_indexed !== undefined && Number.isFinite(p.strategy_indexed)
              ? p.strategy_indexed
              : kpis.starting_capital > 0
                ? (p.equity / kpis.starting_capital) * 100
                : 100;
          const asOfDate = (p.as_of_date ?? p.chart_end_date ?? "") as string;
          const datePart = asOfDate.length >= 10 ? asOfDate.slice(0, 10) : asOfDate || "__";
          const spyIdx =
            p.spy_indexed !== undefined && p.spy_indexed !== null && Number.isFinite(p.spy_indexed)
              ? p.spy_indexed
              : null;
          const undIdx =
            p.underlying_indexed !== undefined &&
            p.underlying_indexed !== null &&
            Number.isFinite(p.underlying_indexed)
              ? p.underlying_indexed
              : null;
          const spyDollar =
            startCap > 0 && spyIdx != null && Number.isFinite(spyIdx) ? startCap * (spyIdx / 100) : null;
          const undDollar =
            startCap > 0 && undIdx != null && Number.isFinite(undIdx) ? startCap * (undIdx / 100) : null;
          return {
            trade: p.trade_index,
            dateXKey: `${datePart}·${p.trade_index}`,
            asOfDate,
            capital: p.equity,
            stratIdx,
            spyIdx,
            undIdx,
            spyDollar,
            undDollar,
            cumulativePnl: p.cumulative_pnl,
            baseline: kpis.starting_capital,
            outcome: p.outcome ?? null,
            tradeTaken: p.trade_taken === true,
            predicted_label:
              p.predicted_label === undefined || p.predicted_label === null ? null : p.predicted_label,
          };
        })
      : trades.map((trade, index) => ({
          trade: index + 1,
          dateXKey: `·${index + 1}`,
          asOfDate: "",
          capital: trade.capital_after,
          stratIdx:
            kpis.starting_capital > 0 ? (trade.capital_after / kpis.starting_capital) * 100 : 100,
          spyIdx: null as number | null,
          undIdx: null as number | null,
          spyDollar: null as number | null,
          undDollar: null as number | null,
          cumulativePnl: trade.capital_after - kpis.starting_capital,
          baseline: kpis.starting_capital,
          outcome: null as string | null,
          tradeTaken: true,
          predicted_label: null as number | null,
        }));

    const hasBenchmarkLines =
      equityData.some((row) => row.spyDollar != null && Number.isFinite(row.spyDollar)) ||
      equityData.some((row) => row.undDollar != null && Number.isFinite(row.undDollar));

    const firstRow = equityData[0];
    const firstCap =
      firstRow && Number.isFinite(firstRow.capital) && firstRow.capital > 0
        ? firstRow.capital
        : kpis.starting_capital > 0
          ? kpis.starting_capital
          : 0;
    const firstSpyRow = equityData.find(
      (d) => d.spyDollar != null && Number.isFinite(d.spyDollar) && d.spyDollar > 0,
    );
    const firstSpy = firstSpyRow?.spyDollar ?? null;
    const firstUndRow = equityData.find(
      (d) => d.undDollar != null && Number.isFinite(d.undDollar) && d.undDollar > 0,
    );
    const firstUnd = firstUndRow?.undDollar ?? null;

    const equityChartData = equityData.map((p) => ({
      ...p,
      strategyReturnPct:
        firstCap > 0 && Number.isFinite(p.capital) ? ((p.capital / firstCap) - 1) * 100 : 0,
      spyReturnPct:
        firstSpy != null && p.spyDollar != null && Number.isFinite(p.spyDollar)
          ? ((p.spyDollar / firstSpy) - 1) * 100
          : null,
      undReturnPct:
        firstUnd != null && p.undDollar != null && Number.isFinite(p.undDollar)
          ? ((p.undDollar / firstUnd) - 1) * 100
          : null,
    }));

    const pctVals: number[] = [];
    equityChartData.forEach((p) => {
      pctVals.push(p.strategyReturnPct);
      if (p.spyReturnPct != null && Number.isFinite(p.spyReturnPct)) pctVals.push(p.spyReturnPct);
      if (p.undReturnPct != null && Number.isFinite(p.undReturnPct)) pctVals.push(p.undReturnPct);
    });
    const equityMinPct = pctVals.length ? Math.min(...pctVals) : 0;
    const equityMaxPct = pctVals.length ? Math.max(...pctVals) : 0;
    const spanPct = equityMaxPct - equityMinPct;
    const padPct =
      equityMinPct === equityMaxPct ?
        Math.max(Math.abs(equityMaxPct) * 0.08, 4)
      : Math.max(spanPct * 0.055, Math.max(Math.abs(equityMaxPct), Math.abs(equityMinPct)) * 0.012);
    let equityReturnPctDomain: [number, number] = [equityMinPct - padPct, equityMaxPct + padPct];
    const [pc0, pc1] = equityReturnPctDomain;
    if (!Number.isFinite(pc0) || !Number.isFinite(pc1)) {
      equityReturnPctDomain = [-1, 1];
    } else if (Math.abs(pc1 - pc0) < 1e-9) {
      equityReturnPctDomain = [pc0 - 1, pc1 + 1];
    }

    const drawdownData =
      series?.drawdown_pct?.length ?
        series.drawdown_pct.map((p, idx) => ({
          trade: p.trade_index,
          asOfDate: (series.equity?.[idx]?.as_of_date ?? "") as string,
          drawdownNeg: -Math.abs(toNumber(p.drawdown_pct)),
        }))
      : (() => {
          const start = kpis.starting_capital || 0;
          return equityData.map((point) => {
            const cap = point.capital;
            const dd = start > 0 && cap < start ? ((start - cap) / start) * 100 : 0;
            return { trade: point.trade, asOfDate: point.asOfDate, drawdownNeg: -Math.abs(dd) };
          });
        })();

    const ddVals = drawdownData.map((d) => d.drawdownNeg);
    const ddMinComputed = ddVals.length ? Math.min(...ddVals, 0) : -0.5;
    const drawdownYDomain: [number, number] = [ddMinComputed >= -1e-6 ? -0.5 : ddMinComputed * 1.08, 0];

    const noTradeCount =
      kpis.no_trade_count !== undefined && Number.isFinite(kpis.no_trade_count)
        ? Math.round(kpis.no_trade_count)
        : 0;
    const outcomeBars = [
      { name: "Take profit", key: "TP", count: trades.filter((t) => t.outcome === "TP").length, fill: C.accentBright },
      { name: "Stop loss", key: "SL", count: trades.filter((t) => t.outcome === "SL").length, fill: C.accentDeep },
      { name: "No trade", key: "NO_TRADE", count: noTradeCount, fill: "rgba(212,212,216,0.85)" },
    ];

    /** Net P&amp;L summed by calendar day (chart events → step P&amp;L; else equity step deltas; else executed trades by filename date). */
    const profitPerDayBarData: { dayKey: string; label: string; pnl: number }[] = (() => {
      const map = new Map<string, number>();
      const add = (day: string | null, v: number) => {
        if (!day || !Number.isFinite(v)) return;
        map.set(day, (map.get(day) ?? 0) + v);
      };

      if (chart_events?.length) {
        for (const e of chart_events) {
          const rec = e as Record<string, unknown>;
          let day = isoDayFromUnknown(rec.as_of_date ?? rec.chart_end_date ?? rec.chart_date);
          if (!day) day = isoDayFromFilename(String(rec.filename ?? ""));
          add(day, toNumber(rec.pnl_net));
        }
      } else if (series?.equity?.length && equityData.length) {
        for (let i = 0; i < equityData.length; i++) {
          const d = equityData[i].asOfDate;
          const day = typeof d === "string" && d.length >= 10 ? d.slice(0, 10) : null;
          const prevCap = i === 0 ? kpis.starting_capital : equityData[i - 1].capital;
          add(day, equityData[i].capital - prevCap);
        }
      } else if (trades.length) {
        for (const t of trades) {
          add(isoDayFromFilename(t.filename), t.pnl_net);
        }
      }

      const keys = [...map.keys()].sort();
      return keys.map((dayKey) => ({
        dayKey,
        label: formatShortDate(dayKey),
        pnl: map.get(dayKey) ?? 0,
      }));
    })();

    const profitPerDayYDomain: [number, number] = (() => {
      if (!profitPerDayBarData.length) return [-1, 1];
      const vals = profitPerDayBarData.map((d) => d.pnl).filter((v) => Number.isFinite(v));
      if (!vals.length) return [-1, 1];
      const lo = Math.min(...vals, 0);
      const hi = Math.max(...vals, 0);
      const span = hi - lo;
      const pad = span < 1e-9 ? Math.max(Math.abs(hi) * 0.1, 1) : span * 0.12;
      const loP = lo - pad;
      const hiP = hi + pad;
      return Number.isFinite(loP) && Number.isFinite(hiP) ? [loP, hiP] : [-1, 1];
    })();

    const profitPerDayXTickInterval = Math.max(0, Math.floor(profitPerDayBarData.length / 8) - 1);

    const equityXTickInterval = Math.max(0, Math.floor(equityData.length / 6) - 1);

    const ledgerRows: LedgerRow[] = (() => {
      if (chart_events?.length) {
        return chart_events.map((e, idx) => {
          const pl = toNumber(e.predicted_label) >= 1 ? 1 : 0;
          const al = toNumber(e.actual_label) >= 1 ? 1 : 0;
          const keyRaw = e.event_index ?? e.step_index ?? idx + 1;
          return {
            key: toNumber(keyRaw),
            predictedLabel: pl as 0 | 1,
            predDisplay: pl === 1 ? "long" : "no trade",
            actualDisplay: al === 1 ? "long" : "short",
            confidence: normalizeConfidence(e.confidence),
            outcome: parseLedgerOutcome(e.outcome),
            pnl_net: toNumber(e.pnl_net),
            capital_after: toNumber(e.capital_after),
            filename: String(e.filename ?? ""),
            trade_taken: e.trade_taken === true,
            entry_price: toNumber(e.entry_price),
            exit_price: toNumber(e.exit_price),
            commission: toNumber(e.commission),
            slippage: toNumber(e.slippage),
          };
        });
      }
      const eqPts = series?.equity?.filter((p) => p.trade_index > 0) ?? [];
      const canLedgerFromSeries =
        eqPts.length > 0 &&
        eqPts.some((p) => p.predicted_label !== undefined && p.predicted_label !== null);
      if (canLedgerFromSeries) {
        const confByStep = new Map<number, number>();
        for (const c of series?.confidence_by_trade ?? []) {
          confByStep.set(c.trade_index, c.confidence);
        }
        const sorted = [...eqPts].sort((a, b) => a.trade_index - b.trade_index);
        return sorted.map((p, i) => {
          const prevEq = i === 0 ? kpis.starting_capital : sorted[i - 1].equity;
          const pl =
            p.predicted_label !== undefined && p.predicted_label !== null && p.predicted_label >= 1 ? 1 : 0;
          const oc = parseLedgerOutcome(p.outcome);
          return {
            key: p.trade_index,
            predictedLabel: pl as 0 | 1,
            predDisplay: pl === 1 ? "long" : "no trade",
            actualDisplay: "—",
            confidence: normalizeConfidence(confByStep.get(p.trade_index) ?? 0),
            outcome: oc,
            pnl_net: p.equity - prevEq,
            capital_after: p.equity,
            filename: "",
            trade_taken: p.trade_taken === true,
            entry_price: 0,
            exit_price: 0,
            commission: 0,
            slippage: 0,
          };
        });
      }
      return trades
        .map((trade) => ({
          key: trade.trade_id,
          predictedLabel: (trade.prediction === "long" ? 1 : 0) as 0 | 1,
          predDisplay: trade.prediction === "long" ? "long" : "no trade",
          actualDisplay: trade.actual,
          confidence: trade.confidence,
          outcome: trade.outcome,
          pnl_net: trade.pnl_net,
          capital_after: trade.capital_after,
          filename: trade.filename,
          trade_taken: trade.outcome !== "NO_TRADE",
          entry_price: trade.entry_price,
          exit_price: trade.exit_price,
          commission: trade.commission,
          slippage: trade.slippage,
        }))
        .sort((a, b) => a.key - b.key);
    })();

    const confidenceScatterPoints: ConfidenceScatterPoint[] = (() => {
      if (chart_events?.length) {
        return chart_events.map((e, idx) => {
          const rawDate = String(e.as_of_date ?? e.chart_end_date ?? e.chart_date ?? "");
          const parsed = rawDate.length >= 8 ? Date.parse(rawDate) : NaN;
          const xIsTime = Number.isFinite(parsed);
          const xNum = xIsTime ? (parsed as number) : idx;
          const xLabel = xIsTime ? rawDate : `Step ${idx + 1}`;
          const conf = normalizeConfidence(e.confidence) * 100;
          const pl = toNumber(e.predicted_label) >= 1 ? 1 : 0;
          const al = toNumber(e.actual_label) >= 1 ? 1 : 0;
          return {
            x: xNum,
            xLabel,
            xIsTime,
            y: conf,
            actualLabel: al as 0 | 1,
            predictedLabel: pl as 0 | 1,
          };
        });
      }
      const out: ConfidenceScatterPoint[] = [];
      for (const row of ledgerRows) {
        const actualLabel = (row.actualDisplay === "long" ? 1 : 0) as 0 | 1;
        out.push({
          x: row.key,
          xLabel: `Step ${row.key}`,
          xIsTime: false,
          y: row.confidence * 100,
          actualLabel,
          predictedLabel: row.predictedLabel,
        });
      }
      return out;
    })();

    const confidenceScatterLabel1 = confidenceScatterPoints.filter((p) => p.actualLabel === 1);
    const confidenceScatterLabel0 = confidenceScatterPoints.filter((p) => p.actualLabel === 0);

    const filteredLedgerRows = ledgerRows.filter((row) => {
      if (outcomeFilter !== "all" && row.outcome !== outcomeFilter) return false;
      if (predictionFilter === "long" && row.predictedLabel !== 1) return false;
      if (predictionFilter === "short" && row.predictedLabel !== 0) return false;
      if (row.trade_taken && row.confidence < confidenceFilter) return false;
      return true;
    });

    const filenames = trades.map((t) => t.filename).filter(Boolean);
    const parsedDates = filenames
      .map((name) => {
        const fn = name.split("/").pop() || name;
        const m = fn.match(chartFilenamePattern);
        return m ? { start: m[2], end: m[3] } : null;
      })
      .filter(Boolean) as Array<{ start: string; end: string }>;

    const earliestStart = parsedDates.length
      ? parsedDates.reduce((m, c) => (c.start < m ? c.start : m), parsedDates[0].start)
      : undefined;
    const latestEnd = parsedDates.length
      ? parsedDates.reduce((m, c) => (c.end > m ? c.end : m), parsedDates[0].end)
      : undefined;

    const thresholdSweepRaw =
      series?.threshold_sweep?.filter(
        (p) =>
          Number.isFinite(p.entry_threshold) &&
          Number.isFinite(p.return_pct) &&
          Number.isFinite(p.win_rate_pct),
      ) ?? [];
    const thresholdSweepData = [...thresholdSweepRaw].sort((a, b) => a.entry_threshold - b.entry_threshold);
    const hasThresholdSweep = thresholdSweepData.length > 0;
    const sweepTicks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    let sweepReturnDomain: [number, number] = [-1, 1];
    if (thresholdSweepData.length) {
      const rs = thresholdSweepData.map((p) => p.return_pct);
      const rmin = Math.min(...rs);
      const rmax = Math.max(...rs);
      const span = rmax - rmin;
      const pad = span < 1e-9 ? Math.max(Math.abs(rmax) * 0.1, 1) : span * 0.1;
      sweepReturnDomain = [rmin - pad, rmax + pad];
    }

    const symbolTicker = (() => {
      for (const name of filenames) {
        const fn = name.split("/").pop() || name;
        const m = fn.match(chartFilenamePattern);
        if (m?.[1]) return m[1];
      }
      return result.benchmark?.underlying_symbol ?? "—";
    })();

    const label1WinRateKpi = (() => {
      if (chart_events?.length) {
        return label1WinRateFromEvents(chart_events as Record<string, unknown>[]);
      }
      if (ledgerRows.length) {
        return label1WinRateFromLedger(ledgerRows);
      }
      return null;
    })();

    const thresholdSweepDisplay =
      hasThresholdSweep && (chart_events?.length || ledgerRows.length)
        ? thresholdSweepData.map((row) => {
            const wr = chart_events?.length
              ? label1WinRateFromEvents(chart_events as Record<string, unknown>[], row.entry_threshold)
              : label1WinRateFromLedgerAtThreshold(ledgerRows, row.entry_threshold);
            return { ...row, win_rate_pct: wr !== null ? wr : 0 };
          })
        : thresholdSweepData;

    return {
      modelName,
      datasetName,
      symbolTicker,
      label1WinRateKpi,
      returnPct,
      equityData,
      equityChartData,
      equityReturnPctDomain,
      drawdownData,
      drawdownYDomain,
      confidenceScatterPoints,
      confidenceScatterLabel1,
      confidenceScatterLabel0,
      outcomeBars,
      profitPerDayBarData,
      profitPerDayYDomain,
      profitPerDayXTickInterval,
      filteredLedgerRows,
      ledgerRowCount: ledgerRows.length,
      hasLedgerRows: ledgerRows.length > 0,
      hasTrades: trades.length > 0,
      hasEquityData: equityData.length > 0,
      hasBenchmarkLines,
      equityXTickInterval,
      thresholdSweepDisplay,
      hasThresholdSweep,
      sweepReturnDomain,
      sweepTicks,
      config,
      testingWindow: formatDateRange(earliestStart, latestEnd),
      testingStart: earliestStart ?? null,
      testingEnd: latestEnd ?? null,
      durationDays: calculateDurationDays(earliestStart, latestEnd),
    };
  }, [result, outcomeFilter, predictionFilter, confidenceFilter]);

  useEffect(() => {
    let isActive = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const loadResults = async () => {
      try {
        const statusData = await realtimeBacktesterApi.getStatus(runId!);
        if (!isActive) return;
        setStatus({
          status: statusData.status,
          progress: statusData.progress,
          stage: statusData.message,
          message: statusData.message,
        });

        if (statusData.status === "succeeded") {
          try {
            const resultData = await realtimeBacktesterApi.getResult(runId!);
            if (!isActive) return;
            setResult(normalizeResult(resultData as unknown as Record<string, unknown>));
            setError(null);
            setLoading(false);
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
          } catch (err: unknown) {
            if (!isActive) return;
            const statusCode = (err as { status?: number; response?: { status?: number } })?.status ?? (err as { response?: { status?: number } })?.response?.status;
            if (statusCode === 404 || statusCode === 409) {
              setError(statusCode === 404 ? "Results not found for this run." : "Results not ready yet.");
              setLoading(false);
            } else {
              setError("Failed to load backtest results");
              setLoading(false);
            }
          }
        } else if (statusData.status === "failed") {
          setError(`Backtester failed: ${statusData.message}`);
          setLoading(false);
        } else if (statusData.status === "running") {
          setLoading(false);
        } else {
          setError(`Backtester status: ${statusData.status} - ${statusData.message}`);
          setLoading(false);
        }
      } catch {
        if (!isActive) return;
        setError("Failed to load backtest results");
        setLoading(false);
      }
    };

    if (!runId) {
      setLoading(false);
      setError("Missing run id.");
      return;
    }
    void loadResults();
    pollTimer = setInterval(() => void loadResults(), 2000);
    return () => {
      isActive = false;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [runId]);

  if (error || status?.status === "failed") {
    return (
      <div className="relative min-h-screen overflow-hidden bg-black text-white">
        <Ambient />
        <div className="relative mx-auto max-w-2xl px-6 pb-20 pt-4">
          <Link
            to={backHref}
            className="mb-6 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03]"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-xl font-semibold">Backtest results</h1>
          <p className="mt-2 text-sm text-zinc-400">{error || status?.message}</p>
        </div>
      </div>
    );
  }

  const showProgress =
    status && (["running", "queued", "pending"].includes(status.status) || (status.status === "succeeded" && !result));

  if (showProgress) {
    const isFinalizing = status!.status === "succeeded" && !result;
    return (
      <div className="relative min-h-screen overflow-hidden bg-black text-white">
        <Ambient />
        <div className="relative mx-auto max-w-lg px-6 pt-28 pb-20">
          <Link
            to="/tools/backtester"
            className="mb-6 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03]"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-xl font-semibold">Backtest results</h1>
          <p className="mt-2 text-sm text-[rgba(255,255,255,0.55)]">
            {isFinalizing ? "Finalizing results…" : "Running backtest…"}
          </p>
          <div className="mt-8 h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-white/90 to-white/50 transition-all"
              style={{ width: `${isFinalizing ? 100 : (status!.progress ?? 0) * 100}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-[rgba(255,255,255,0.55)]">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      </div>
    );
  }

  if (!result || !processedData) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-black text-white">
        <Ambient />
        <div className="relative mx-auto max-w-2xl px-6 pt-4">
          <p className="text-sm text-zinc-400">{error || "No results"}</p>
        </div>
      </div>
    );
  }

  const { kpis, summary, classification_metrics } = result;
  const {
    modelName,
    datasetName,
    symbolTicker,
    label1WinRateKpi,
    returnPct,
    equityData,
    equityChartData,
    equityReturnPctDomain,
    drawdownData,
    drawdownYDomain,
    confidenceScatterPoints,
    confidenceScatterLabel1,
    confidenceScatterLabel0,
    outcomeBars,
    profitPerDayBarData,
    profitPerDayYDomain,
    profitPerDayXTickInterval,
    filteredLedgerRows,
    ledgerRowCount,
    hasLedgerRows,
    hasTrades,
    hasEquityData,
    hasBenchmarkLines,
    equityXTickInterval,
    thresholdSweepDisplay,
    hasThresholdSweep,
    sweepReturnDomain,
    sweepTicks,
    config,
    testingStart,
    testingEnd,
    durationDays,
  } = processedData;

  const ledgerRowsVisible =
    ledgerExpanded ? filteredLedgerRows : filteredLedgerRows.length <= 10 ? filteredLedgerRows : filteredLedgerRows.slice(-10);
  const ledgerHasMore = filteredLedgerRows.length > 10;

  const ddPct = kpis.max_drawdown_pct !== undefined && Number.isFinite(kpis.max_drawdown_pct) ? kpis.max_drawdown_pct : null;
  const fmtSharpe =
    kpis.sharpe_ratio === null || kpis.sharpe_ratio === undefined ? "—" : kpis.sharpe_ratio.toFixed(2);
  const fmtSharpeAnnual =
    kpis.sharpe_ratio_annualized_hint === null || kpis.sharpe_ratio_annualized_hint === undefined ?
      "—"
    : kpis.sharpe_ratio_annualized_hint.toFixed(2);
  const fmtF1 =
    kpis.model_f1 !== undefined && Number.isFinite(kpis.model_f1) ?
      `${(kpis.model_f1 > 1 ? kpis.model_f1 : kpis.model_f1 * 100).toFixed(1)}%`
    : classification_metrics?.f1 !== undefined && Number.isFinite(classification_metrics.f1) ?
      `${(classification_metrics.f1 > 1 ? classification_metrics.f1 : classification_metrics.f1 * 100).toFixed(1)}%`
    : "—";
  const fmtBuyHold =
    kpis.buy_and_hold === undefined || !Number.isFinite(kpis.buy_and_hold) ? "—"
    : Math.abs(kpis.buy_and_hold) <= 2 ? `${(kpis.buy_and_hold * 100).toFixed(2)}%`
    : `${kpis.buy_and_hold.toFixed(2)}%`;
  const confThresholdDisplayPct =
    ((config.confidence_threshold ?? 0) > 1 ? (config.confidence_threshold ?? 0) / 100 : (config.confidence_threshold ?? 0)) *
    100;
  const chartsAnalyzedCount =
    kpis.total_charts_analyzed ?? summary.charts_analyzed ?? ledgerRowCount;
  const hasNoTradeRate = kpis.no_trade_rate !== undefined && Number.isFinite(kpis.no_trade_rate);

  const equityDateTick = (raw: string | number) => {
    const key = String(raw);
    const iso = key.split("·")[0];
    if (!iso || iso === "__") return "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    return formatShortDate(iso);
  };

  return (
    <div className="relative min-h-screen shrink-0 overflow-x-hidden bg-black font-sans text-white">
      <Ambient />

      <div className="relative mx-auto max-w-[1400px] px-3 pb-16 pt-2 sm:px-4 md:px-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Link
            to={backHref}
            className="text-[11px] font-medium text-white/50 transition hover:text-white/85"
          >
            Back to run log
          </Link>
          <p className="text-[10px] text-white/40">
            <span className="font-mono text-white/55">{runId}</span>
            {result.timestamp ? ` · ${new Date(result.timestamp).toLocaleString()}` : ""}
          </p>
        </div>

        {!hasEquityData ? (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-10 text-center">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-400/90" />
            <h2 className="text-lg font-semibold text-white">No equity timeline</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-[rgba(255,255,255,0.5)]">
              The backtest did not produce an equity series. Re-run the backtester or check the results JSON.
            </p>
          </div>
        ) : (
          <>
            {hasTrades ? null : result.chart_events?.length ? (
              <div className="mb-3 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-[rgba(255,255,255,0.55)] sm:mb-4 sm:text-sm">
                No executed long trades in this run (all steps are no-trade or below entry threshold). The full timeline is still in the ledger and charts.
              </div>
            ) : (
              <div className="mb-3 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-[rgba(255,255,255,0.55)] sm:mb-4 sm:text-sm">
                No long entries in this run — the model predicted short (no trade) on every chart step, so equity is flat.
              </div>
            )}

            {/* 6 headline KPIs — above equity */}
            <div className="mb-3">
              <div className={cn("grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6 sm:gap-2", dashboardCard, "p-2 sm:p-2.5")}>
                <div className="flex min-h-0 min-w-0 flex-col gap-0.5 rounded-md border border-white/[0.07] bg-white/[0.025] px-2.5 py-2">
                  <p className={`${kpiLabelClass} shrink-0`}>Total return</p>
                  <p
                    className={`w-full min-w-0 break-words text-base font-semibold tabular-nums leading-tight sm:text-lg ${returnPct >= 0 ? "text-violet-400" : "text-zinc-400"}`}
                  >
                    {returnPct >= 0 ? "+" : ""}
                    {returnPct.toFixed(2)}%
                  </p>
                </div>
                <div className="flex min-h-0 min-w-0 flex-col gap-0.5 rounded-md border border-white/[0.07] bg-white/[0.025] px-2.5 py-2 text-right">
                  <p className={`${kpiLabelClass} shrink-0`}>Net P&amp;L</p>
                  <p
                    className={`w-full min-w-0 break-words text-base font-semibold tabular-nums leading-tight sm:text-lg ${kpis.pnl >= 0 ? "text-violet-400/95" : "text-zinc-400"}`}
                    title={formatUsd(kpis.pnl)}
                  >
                    {formatUsdCompact(kpis.pnl)}
                  </p>
                </div>
                <div className="flex min-h-0 min-w-0 flex-col gap-0.5 rounded-md border border-white/[0.07] bg-white/[0.025] px-2.5 py-2">
                  <p className={`${kpiLabelClass} shrink-0`}>Trades</p>
                  <p className="w-full min-w-0 break-words text-base font-semibold tabular-nums leading-tight text-white sm:text-lg">
                    {kpis.trades}
                  </p>
                </div>
                <div className="flex min-h-0 min-w-0 flex-col gap-0.5 rounded-md border border-white/[0.07] bg-white/[0.025] px-2.5 py-2 text-right">
                  <p className={`${kpiLabelClass} shrink-0`}>Label 1 hit rate</p>
                  <p className="w-full min-w-0 break-words text-base font-semibold tabular-nums leading-tight text-white sm:text-lg">
                    {label1WinRateKpi !== null ? `${label1WinRateKpi.toFixed(1)}%` : "—"}
                  </p>
                  <p className="text-[8px] leading-tight text-[rgba(255,255,255,0.32)]">When pred = long</p>
                </div>
                <div className="flex min-h-0 min-w-0 flex-col gap-0.5 rounded-md border border-white/[0.07] bg-white/[0.025] px-2.5 py-2">
                  <p className={`${kpiLabelClass} shrink-0`}>Charts analyzed</p>
                  <p className="w-full min-w-0 break-words text-base font-semibold tabular-nums leading-tight text-white sm:text-lg">
                    {chartsAnalyzedCount}
                  </p>
                </div>
                <div className="flex min-h-0 min-w-0 flex-col gap-0.5 rounded-md border border-white/[0.07] bg-white/[0.025] px-2.5 py-2 text-right">
                  <p className={`${kpiLabelClass} shrink-0`}>{hasNoTradeRate ? "No-trade rate" : "Max drawdown"}</p>
                  <p
                    className={`w-full min-w-0 break-words text-base font-semibold tabular-nums leading-tight sm:text-lg ${hasNoTradeRate ? "text-white" : "text-zinc-400"}`}
                  >
                    {hasNoTradeRate ? formatRatePercent(kpis.no_trade_rate) : ddPct !== null ? `${ddPct.toFixed(2)}%` : "—"}
                  </p>
                </div>
              </div>
            </div>

            {/* Equity curve + optional entry threshold (side by side on large screens) */}
            <div className="mb-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-12 lg:gap-4">
              <div className={cn("min-h-0", hasThresholdSweep ? "lg:col-span-8" : "lg:col-span-12")}>
                <ChartShell
                  title="Equity curve"
                  density="compact"
                  subtitle={
                    hasBenchmarkLines
                      ? `Total return % from the first step (0% at start for strategy and each buy & hold line).${
                          equityData.some((d) => d.spyDollar != null) ? "" : result.benchmark?.error ? ` ${result.benchmark.error}` : ""
                        }`
                      : "Total return % from the first step over the backtest timeline (chronological steps)."
                  }
                  className="w-full"
                >
                  <div className="w-full px-1 pt-0 sm:px-2">
                    {hasEquityData ? (
                      <>
                        <ResponsiveContainer width="100%" height={EQUITY_CHART_PX}>
                          <ComposedChart
                            data={equityChartData}
                            margin={{
                              left: 4,
                              right: 10,
                              top: 10,
                              bottom: 4,
                            }}
                          >
                            <CartesianGrid strokeDasharray="4 8" stroke={C.gridSoft} vertical={false} horizontal={false} />
                            <XAxis
                              dataKey="dateXKey"
                              tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9 }}
                              tickLine={false}
                              axisLine={{ stroke: C.axisLine }}
                              tickFormatter={equityDateTick}
                              interval={equityXTickInterval}
                              angle={-20}
                              textAnchor="end"
                              height={40}
                            />
                            <YAxis
                              yAxisId="left"
                              domain={equityReturnPctDomain}
                              tick={{ fill: "rgba(192,132,252,0.95)", fontSize: 9 }}
                              tickLine={false}
                              axisLine={{ stroke: EQ_STRATEGY, strokeOpacity: 0.45 }}
                              width={56}
                              tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                            />
                            <Tooltip
                              contentStyle={tooltipStyle}
                              formatter={(v: number, name: string) => [
                                `${Number(v).toFixed(2)}%`,
                                name,
                              ]}
                              labelFormatter={(l) => {
                                const iso = String(l).split("·")[0];
                                if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatShortDate(iso);
                                return "Start";
                              }}
                            />
                            <ReferenceLine
                              yAxisId="left"
                              y={0}
                              stroke="rgba(255,255,255,0.11)"
                              strokeDasharray="6 6"
                              strokeWidth={1}
                            />
                            <Line
                              yAxisId="left"
                              type="natural"
                              dataKey="strategyReturnPct"
                              stroke={EQ_STRATEGY}
                              strokeWidth={2.85}
                              strokeOpacity={1}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              name="Strategy performance"
                              dot={false}
                              isAnimationActive={false}
                              activeDot={{ r: 5, fill: EQ_STRATEGY, stroke: "rgba(15,17,28,0.85)", strokeWidth: 1 }}
                            />
                            {equityData.some((d) => d.spyDollar != null && Number.isFinite(d.spyDollar)) ? (
                              <Line
                                yAxisId="left"
                                type="monotone"
                                dataKey="spyReturnPct"
                                stroke={EQ_BASELINE_PRIMARY}
                                strokeWidth={2.25}
                                strokeOpacity={0.95}
                                dot={false}
                                name={`${result.benchmark?.spy_ticker ?? "SPY"} (buy & hold)`}
                                connectNulls
                                isAnimationActive={false}
                                {...lineStrokeRounded}
                              />
                            ) : null}
                            {equityData.some((d) => d.undDollar != null && Number.isFinite(d.undDollar)) ? (
                              <Line
                                yAxisId="left"
                                type="monotone"
                                dataKey="undReturnPct"
                                stroke={EQ_BASELINE_SECONDARY}
                                strokeWidth={2.1}
                                strokeOpacity={0.92}
                                dot={false}
                                name={`${result.benchmark?.underlying_ticker ?? "Underlying"} (buy & hold)`}
                                connectNulls
                                isAnimationActive={false}
                                {...lineStrokeRounded}
                              />
                            ) : null}
                          </ComposedChart>
                        </ResponsiveContainer>
                        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-white/[0.06] px-1 pb-1 pt-2 text-[11px] text-[rgba(255,255,255,0.78)]">
                          <span className="inline-flex items-center gap-2 font-medium text-violet-400/95">
                            <span className="h-[3px] w-6 rounded-full bg-violet-500" aria-hidden />
                            Strategy performance
                          </span>
                          {equityData.some((d) => d.spyDollar != null && Number.isFinite(d.spyDollar)) ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="h-[3px] w-6 rounded-full bg-white/80" aria-hidden />
                              {result.benchmark?.spy_ticker ?? "SPY"} (buy &amp; hold)
                            </span>
                          ) : null}
                          {equityData.some((d) => d.undDollar != null && Number.isFinite(d.undDollar)) ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="h-[3px] w-6 rounded-full bg-[rgba(203,213,225,0.65)]" aria-hidden />
                              {result.benchmark?.underlying_ticker ?? "Underlying"} (buy &amp; hold)
                            </span>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <div className="flex h-full min-h-[120px] items-center justify-center text-xs text-[rgba(255,255,255,0.45)]">
                        No equity series
                      </div>
                    )}
                  </div>
                </ChartShell>
              </div>

              {hasThresholdSweep ? (
                <div className="min-h-0 lg:col-span-4">
                  <ChartShell
                    title="Entry threshold sensitivity"
                    density="compact"
                    subtitle="Return % vs start at each minimum P(long). Right axis: label-1 hit rate — correct long predictions ÷ all long predictions (with P(long) ≥ threshold)."
                    className="h-full w-full min-w-0"
                  >
                    <div className="w-full min-w-0">
                      <div className="h-[200px] sm:h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={thresholdSweepDisplay}
                        margin={{ left: 6, right: 10, top: 8, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                        <XAxis
                          type="number"
                          dataKey="entry_threshold"
                          domain={[0, 1]}
                          ticks={sweepTicks}
                          tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }}
                          tickFormatter={(v) => Number(v).toFixed(1)}
                          axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
                        />
                        <YAxis
                          yAxisId="left"
                          domain={sweepReturnDomain}
                          tick={{ fill: TH_LEFT, fontSize: 10 }}
                          axisLine={{ stroke: TH_LEFT, strokeOpacity: 0.35 }}
                          tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                          width={54}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          domain={[0, 100]}
                          tick={{ fill: TH_RIGHT, fontSize: 10 }}
                          axisLine={{ stroke: TH_RIGHT, strokeOpacity: 0.35 }}
                          tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                          width={44}
                        />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v: number, name: string) =>
                            String(name).includes("Win") ?
                              [`${Number(v).toFixed(1)}%`, name]
                            : [`${Number(v).toFixed(2)}%`, name]
                          }
                          labelFormatter={(_label, items) => {
                            const row = (
                              items as unknown as { payload?: { entry_threshold: number; trades: number } }[] | undefined
                            )?.[0]?.payload;
                            if (!row) return "";
                            return `P(long) ≥ ${row.entry_threshold.toFixed(1)} · ${row.trades} trades`;
                          }}
                        />
                        <ReferenceLine yAxisId="left" y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 3" />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="return_pct"
                          name="Total return %"
                          stroke={TH_LEFT}
                          strokeWidth={2.65}
                          dot={{ r: 3, fill: TH_LEFT, strokeWidth: 0 }}
                          activeDot={{ r: 5 }}
                          isAnimationActive={false}
                          {...lineStrokeRounded}
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="win_rate_pct"
                          name="Label 1 hit rate %"
                          stroke={TH_RIGHT}
                          strokeWidth={2.35}
                          dot={{ r: 3, fill: TH_RIGHT, strokeWidth: 0 }}
                          activeDot={{ r: 5 }}
                          isAnimationActive={false}
                          {...lineStrokeRounded}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 border-t border-white/[0.06] pt-2.5 text-[11px] text-[rgba(255,255,255,0.78)]">
                    <span className="inline-flex items-center gap-2 text-violet-400/95">
                      <span className="h-[3px] w-6 rounded-full bg-violet-500" aria-hidden />
                      Total return %
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-[3px] w-6 rounded-full bg-white/75" aria-hidden />
                      Label 1 hit rate %
                    </span>
                  </div>
                </div>
              </ChartShell>
                </div>
              ) : null}
            </div>

            <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
              <ChartShell
                title="Profit per day"
                subtitle="Net P&amp;L summed by calendar day (steps or trades attributed to each day)."
              >
                <div className="h-52">
                  {profitPerDayBarData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsBarChart data={profitPerDayBarData} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fill: C.muted, fontSize: 9 }}
                          axisLine={{ stroke: C.grid }}
                          interval={profitPerDayXTickInterval}
                          angle={-28}
                          textAnchor="end"
                          height={48}
                        />
                        <YAxis
                          domain={profitPerDayYDomain}
                          tick={{ fill: C.muted, fontSize: 10 }}
                          axisLine={{ stroke: C.grid }}
                          tickFormatter={(v) => formatAxisUsd(Number(v))}
                          width={68}
                        />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v: number) => [formatUsd(v), "Net P&L"]}
                          labelFormatter={(l) => String(l ?? "")}
                        />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.28)" strokeDasharray="4 3" />
                        <Bar dataKey="pnl" radius={[6, 6, 0, 0]} maxBarSize={56}>
                          {profitPerDayBarData.map((entry, i) => (
                            <Cell
                              key={entry.dayKey + String(i)}
                              fill={entry.pnl >= 0 ? C.positive : C.accentDeep}
                              stroke="rgba(255,255,255,0.1)"
                            />
                          ))}
                        </Bar>
                      </RechartsBarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full min-h-[120px] items-center justify-center px-2 text-center text-sm text-[rgba(255,255,255,0.45)]">
                      No per-day series — need dated chart events, an equity timeline with dates, or trade filenames that
                      include dates.
                    </div>
                  )}
                </div>
              </ChartShell>

              <ChartShell
                title="Confidence vs time"
                subtitle={
                  confidenceScatterPoints.length ?
                    `${confidenceScatterPoints.length} points · violet = actual label 1, slate = actual label 0 · y = P(long) · entry ≥ ${confThresholdDisplayPct.toFixed(1)}%`
                  : "No chart-level timeline — run a backtest with chart events or ledger steps."
                }
              >
                <div className="h-52">
                  {confidenceScatterPoints.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ left: 2, right: 8, top: 6, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                        <XAxis
                          type="number"
                          dataKey="x"
                          domain={["dataMin", "dataMax"]}
                          tick={{ fill: C.muted, fontSize: 9 }}
                          axisLine={{ stroke: C.axisLine }}
                          tickFormatter={(v) =>
                            confidenceScatterPoints[0]?.xIsTime ?
                              new Date(v).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })
                            : String(Math.round(Number(v)))
                          }
                          name={confidenceScatterPoints[0]?.xIsTime ? "Time" : "Step"}
                        />
                        <YAxis
                          type="number"
                          dataKey="y"
                          domain={[0, 100]}
                          tick={{ fill: C.muted, fontSize: 10 }}
                          axisLine={{ stroke: C.axisLine }}
                          tickFormatter={(v) => `${v}%`}
                          width={44}
                          label={{
                            value: "P(long) %",
                            angle: -90,
                            position: "insideLeft",
                            fill: "rgba(255,255,255,0.4)",
                            fontSize: 10,
                          }}
                        />
                        <Tooltip content={<ConfidenceScatterTooltip />} cursor={{ strokeDasharray: "3 3" }} />
                        <Scatter
                          name="Actual 1"
                          data={confidenceScatterLabel1}
                          fill="#A855F7"
                          stroke="rgba(91,33,182,0.88)"
                          shape={ConfidenceScatterDot}
                        />
                        <Scatter
                          name="Actual 0"
                          data={confidenceScatterLabel0}
                          fill="#64748B"
                          stroke="rgba(51,65,85,0.9)"
                          shape={ConfidenceScatterDot}
                        />
                      </ScatterChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full min-h-[120px] items-center justify-center text-sm text-[rgba(255,255,255,0.45)]">
                      No scatter data
                    </div>
                  )}
                </div>
              </ChartShell>
            </div>

            {/* Drawdown + outcome mix */}
            <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
              <ChartShell title="Drawdown" density="compact" subtitle="0% at top; negative = % below start.">
                <div className="h-44 sm:h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={drawdownData} margin={{ left: 0, right: 8, top: 8, bottom: 2 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                      <XAxis
                        dataKey="asOfDate"
                        tick={{ fill: C.muted, fontSize: 9 }}
                        axisLine={{ stroke: C.grid }}
                        tickFormatter={(v) => formatShortDate(String(v))}
                        interval={equityXTickInterval}
                        angle={-22}
                        textAnchor="end"
                        height={44}
                      />
                      <YAxis
                        domain={drawdownYDomain}
                        tick={{ fill: C.muted, fontSize: 10 }}
                        axisLine={{ stroke: C.grid }}
                        tickFormatter={(v) => `${v.toFixed(1)}%`}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(v: number) => [`${Math.abs(Number(v)).toFixed(2)}% vs start`, "Drawdown"]}
                      />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.35)" strokeDasharray="4 3" />
                      <Line
                        type="natural"
                        dataKey="drawdownNeg"
                        stroke={C.accent2}
                        strokeWidth={2.4}
                        dot={false}
                        {...lineStrokeRounded}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </ChartShell>

              <ChartShell title="Outcome mix" density="compact" subtitle="TP / SL on longs, plus no-trade steps.">
                <div className="h-44 sm:h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsBarChart data={outcomeBars} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: C.muted, fontSize: 11 }} axisLine={{ stroke: C.grid }} />
                      <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={{ stroke: C.grid }} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="count" radius={[12, 12, 12, 12]}>
                        {outcomeBars.map((e, i) => (
                          <Cell key={i} fill={e.fill} stroke="rgba(255,255,255,0.12)" />
                        ))}
                      </Bar>
                    </RechartsBarChart>
                  </ResponsiveContainer>
                </div>
              </ChartShell>
            </div>

            {/* Full metric list from backtest JSON — below chart grid */}
            <section className={cn("mb-8 px-4 py-4 sm:px-5 sm:py-5", dashboardCard)}>
              <SectionLabel>Details</SectionLabel>
              <h3 className="mt-1 text-sm font-semibold tracking-tight text-white">Run metrics</h3>
              <p className="mt-0.5 text-[11px] text-[rgba(255,255,255,0.4)]">
                Values from the backtest output (KPIs, summary, and config).
              </p>
              {classification_metrics?.description ? (
                <p className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-[rgba(255,255,255,0.48)]">
                  {classification_metrics.description}
                </p>
              ) : null}
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Total return</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                    {returnPct >= 0 ? "+" : ""}
                    {returnPct.toFixed(2)}%
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Net P&amp;L</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">{formatUsd(kpis.pnl)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Starting capital</dt>
                  <dd className="mt-0.5 break-all text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                    {formatUsd(kpis.starting_capital)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Final equity</dt>
                  <dd className="mt-0.5 break-all text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                    {formatUsd(kpis.starting_capital + kpis.pnl)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Buy &amp; hold</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">{fmtBuyHold}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Max drawdown %</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-300 sm:text-[15px]">
                    {ddPct !== null ? `${ddPct.toFixed(2)}%` : "—"}
                  </dd>
                  <dd className="text-[10px] text-[rgba(255,255,255,0.35)]">vs peak</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Max drawdown ($)</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-300 sm:text-[15px]">
                    {Number.isFinite(kpis.max_drawdown) ? formatUsd(kpis.max_drawdown) : "—"}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Sharpe</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">{fmtSharpe}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Sharpe (annualized hint)</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">{fmtSharpeAnnual}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Profit factor</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                    {kpis.profit_factor === null || kpis.profit_factor === undefined ? "—" : kpis.profit_factor.toFixed(2)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Win rate</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                    {formatRatePercent(kpis.win_rate)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Avg win</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">{formatUsd(kpis.avg_win)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Avg loss</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">{formatUsd(kpis.avg_loss)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Trades (executed)</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">{kpis.trades}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Trades (summary)</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">{summary.trades_executed}</dd>
                </div>
                {kpis.trade_frequency !== undefined && Number.isFinite(kpis.trade_frequency) ? (
                  <div className="min-w-0">
                    <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Trade frequency</dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                      {formatRatePercent(kpis.trade_frequency)}
                    </dd>
                  </div>
                ) : null}
                {kpis.no_trade_count !== undefined && Number.isFinite(kpis.no_trade_count) ? (
                  <div className="min-w-0">
                    <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">No-trade count</dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                      {Math.round(kpis.no_trade_count)}
                    </dd>
                  </div>
                ) : null}
                {kpis.no_trade_rate !== undefined && Number.isFinite(kpis.no_trade_rate) ? (
                  <div className="min-w-0">
                    <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">No-trade rate</dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                      {formatRatePercent(kpis.no_trade_rate)}
                    </dd>
                  </div>
                ) : null}
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Position size</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                    {formatRatePercent(kpis.position_size_pct)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Commission</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                    {formatRatePercent(kpis.commission_pct, 3)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Slippage</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                    {formatRatePercent(kpis.slippage_pct, 3)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Max trades / day</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">{kpis.max_trades_per_day}</dd>
                </div>
                {kpis.strategy_max_drawdown_limit_pct !== undefined &&
                Number.isFinite(kpis.strategy_max_drawdown_limit_pct) ? (
                  <div className="min-w-0">
                    <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">
                      Strategy DD limit
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                      {formatRatePercent(kpis.strategy_max_drawdown_limit_pct)}
                    </dd>
                  </div>
                ) : null}
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Entry P(long) min</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                    {confThresholdDisplayPct.toFixed(1)}%
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Take profit</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                    {formatRatePercent(config.tp_pct)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Stop loss</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                    {formatRatePercent(config.sl_pct)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Testing span (days)</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                    {durationDays !== null && durationDays !== undefined ? String(durationDays) : "—"}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Sample size</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">{kpis.sample_size}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Charts analyzed</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">{chartsAnalyzedCount}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Images processed</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                    {summary.total_images_processed}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Model predictions</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">{summary.model_predictions}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Label 1 hit rate</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                    {label1WinRateKpi !== null ? `${label1WinRateKpi.toFixed(1)}%` : "—"}
                  </dd>
                  <dd className="text-[10px] text-[rgba(255,255,255,0.35)]">when pred = long</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Accuracy</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                    {formatRatePercent(kpis.accuracy)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Precision</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                    {formatRatePercent(kpis.precision)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Recall</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">{formatRatePercent(kpis.recall)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">F1</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">{fmtF1}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">Avg conf (trades)</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                    {formatRatePercent(kpis.avg_confidence_trades ?? summary.avg_confidence)}
                  </dd>
                </div>
                {kpis.avg_confidence_all_images !== undefined || summary.avg_confidence_all_images !== undefined ? (
                  <div className="min-w-0">
                    <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.36)]">
                      Avg conf (all images)
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white sm:text-[15px]">
                      {formatRatePercent(kpis.avg_confidence_all_images ?? summary.avg_confidence_all_images)}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {kpis.metrics_insufficient_sample ? (
                <p className="mt-4 rounded-lg border border-amber-500/15 bg-amber-500/[0.06] px-3 py-2 text-[10px] leading-snug text-amber-200/85">
                  Few trades — Sharpe and related ratios may be unreliable.
                </p>
              ) : null}
            </section>
          </>
        )}

        {/* Full timeline ledger (chart_events when present; else executed trades only) */}
        {hasLedgerRows && (
          <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
            <div className="flex flex-col gap-4 border-b border-white/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-white/45" />
                <h2 className="text-base font-semibold text-white">Chart ledger</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={outcomeFilter}
                  onChange={(e) => setOutcomeFilter(e.target.value as typeof outcomeFilter)}
                  className="rounded-lg border border-white/[0.1] bg-[#0a0a0a] px-3 py-1.5 text-xs text-white"
                >
                  <option value="all">All outcomes</option>
                  <option value="TP">TP</option>
                  <option value="SL">SL</option>
                  <option value="NO_TRADE">No trade</option>
                </select>
                <select
                  value={predictionFilter}
                  onChange={(e) => setPredictionFilter(e.target.value as typeof predictionFilter)}
                  className="rounded-lg border border-white/[0.1] bg-[#0a0a0a] px-3 py-1.5 text-xs text-white"
                >
                  <option value="all">All predictions</option>
                  <option value="long">Long</option>
                  <option value="short">No trade</option>
                </select>
                <label className="flex items-center gap-2 text-xs text-[rgba(255,255,255,0.5)]">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={confidenceFilter}
                    onChange={(e) => setConfidenceFilter(parseFloat(e.target.value))}
                    className="w-24 accent-neutral-400"
                  />
                  Min conf (trades only) {(confidenceFilter * 100).toFixed(0)}%
                </label>
              </div>
            </div>
            <p className="border-b border-white/[0.04] px-5 py-2 text-xs text-[rgba(255,255,255,0.45)]">
              Showing {ledgerRowsVisible.length} of {filteredLedgerRows.length} filtered ({ledgerRowCount} total steps)
              {ledgerHasMore && !ledgerExpanded ? " · last 10 rows (chronological tail)" : ""}
              {result.chart_events?.length ?
                ""
              : result.trades.length >= 500 ?
                " · executed-trades export capped at 500"
              : ""}
            </p>

            <div
              className={`overflow-x-auto transition-[max-height] duration-500 ease-in-out ${
                ledgerExpanded ? "max-h-[8000px]" : "max-h-[min(480px,52vh)] overflow-y-hidden"
              }`}
            >
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-[10px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.4)]">
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Pred</th>
                    <th className="px-4 py-3">Actual</th>
                    <th className="px-4 py-3">Conf</th>
                    <th className="px-4 py-3">Out</th>
                    <th className="px-4 py-3">P&amp;L</th>
                    <th className="px-4 py-3">Equity</th>
                    <th className="px-4 py-3 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {ledgerRowsVisible.map((row) => (
                    <Fragment key={row.key}>
                      <tr className="text-sm transition hover:bg-white/[0.02]">
                        <td className="px-4 py-3 font-mono text-[rgba(255,255,255,0.75)]">{row.key}</td>
                        <td className="px-4 py-3 text-[rgba(255,255,255,0.8)]">{row.predDisplay}</td>
                        <td className="px-4 py-3 text-[rgba(255,255,255,0.6)]">{row.actualDisplay}</td>
                        <td className="px-4 py-3">{(row.confidence * 100).toFixed(1)}%</td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              row.outcome === "TP" ? "text-violet-400/90"
                              : row.outcome === "SL" ? "text-zinc-400"
                              : "text-white/75"
                            }
                          >
                            {row.outcome === "NO_TRADE" ? "No trade" : row.outcome}
                          </span>
                        </td>
                        <td className={`px-4 py-3 font-medium ${row.pnl_net >= 0 ? "text-violet-400" : "text-zinc-400"}`}>
                          {formatUsd(row.pnl_net)}
                        </td>
                        <td className="px-4 py-3 text-[rgba(255,255,255,0.65)]">{formatUsd(row.capital_after)}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setExpandedTrade(expandedTrade === row.key ? null : row.key)}
                            className="text-[rgba(255,255,255,0.4)] hover:text-white"
                          >
                            {expandedTrade === row.key ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                      </tr>
                      {expandedTrade === row.key && (
                        <tr>
                          <td colSpan={8} className="bg-[#080a12] px-4 py-4">
                            <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                              <div>
                                <span className="text-[rgba(255,255,255,0.4)]">Entry</span>{" "}
                                <span className="text-white">${row.entry_price.toFixed(2)}</span>
                              </div>
                              <div>
                                <span className="text-[rgba(255,255,255,0.4)]">Exit</span>{" "}
                                <span className="text-white">${row.exit_price.toFixed(2)}</span>
                              </div>
                              <div>
                                <span className="text-[rgba(255,255,255,0.4)]">Commission</span>{" "}
                                <span>{formatUsd(row.commission)}</span>
                              </div>
                              <div>
                                <span className="text-[rgba(255,255,255,0.4)]">Slippage</span>{" "}
                                <span>{formatUsd(row.slippage)}</span>
                              </div>
                              <div className="sm:col-span-2 lg:col-span-4">
                                <span className="text-[rgba(255,255,255,0.4)]">File</span>{" "}
                                <span className="break-all font-mono text-[rgba(255,255,255,0.65)]">{row.filename}</span>
                              </div>
                            </div>
                            {(() => {
                              const chartSrc = resolveChartSrc(result.charts || {}, row.filename);
                              if (!chartSrc) return null;
                              return (
                                <a href={chartSrc} target="_blank" rel="noreferrer" className="mt-4 block">
                                  <div className="rounded-xl border border-white/[0.08] bg-[#05060d] p-3">
                                    <img src={chartSrc} alt="" className="mx-auto max-h-64 w-full max-w-2xl rounded object-contain" />
                                  </div>
                                </a>
                              );
                            })()}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredLedgerRows.length > 10 ? (
              <div className="flex justify-center border-t border-white/[0.06] py-3">
                <button
                  type="button"
                  onClick={() => setLedgerExpanded((v) => !v)}
                  className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 py-2 text-xs font-medium text-white/85 transition hover:bg-white/[0.08] hover:text-white"
                >
                  {ledgerExpanded ? "Show less" : "Show more"}
                </button>
              </div>
            ) : null}
          </section>
        )}
      </div>
    </div>
  );
}
