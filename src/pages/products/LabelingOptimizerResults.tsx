import { useState, useEffect, useMemo } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import Plot from "react-plotly.js";
import type { Layout, ColorScale, Data } from "plotly.js";
import { fetchApi, labelingOptimizerApi } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Monochrome chart tokens (no purple / indigo accents). */
const DA = {
  text: "#fafafa",
  tick: "rgba(255,255,255,0.62)",
  muted: "rgba(255,255,255,0.45)",
  grid: "rgba(255,255,255,0.08)",
  gridSoft: "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.1)",
  strategy: "#e5e5e5",
  strategyLine: "#e5e5e5",
  price: "#a3a3a3",
  priceLine: "#d4d4d4",
  accent2: "#737373",
  deep: "#525252",
  bright: "#d4d4d4",
  soft: "#a3a3a3",
};

const HEATMAP_GRAY: ColorScale = [
  [0, "#0a0a0a"],
  [0.35, "#404040"],
  [0.55, "#737373"],
  [0.75, "#a3a3a3"],
  [1, "#fafafa"],
];

const CORRELATION_GRAY: ColorScale = [
  [0, "#171717"],
  [0.35, "#404040"],
  [0.65, "#737373"],
  [1, "#e5e5e5"],
];

const BENCHMARK_BAR_COLORS = ["#262626", "#404040", "#525252", "#737373", "#a3a3a3"];

/** Use WebGL scatter for large clouds (Plotly scattergl). */
const SCATTERGL_THRESHOLD = 1800;

const CHART_H_2UP = 240;
const CHART_H_CORR = 280;
const CHART_H_VOXEL = 440;
const CHART_H_TS = 300;
/** Extra plot height for compounded return vs buy & hold (product request). */
const CHART_COMPOUND_EXTRA_PX = 202;

/** Compounded return chart: strategy vs buy & hold (Convolve palette). */
const TS_STRATEGY_LINE = "#e5e5e5";
const TS_BUYHOLD_WHITE = "rgba(255,255,255,0.92)";

/** 3D voxel: low → high (grayscale). */
const VOXEL_CAGR_COLORSCALE: ColorScale = [
  [0, "#0a0a0a"],
  [0.2, "#262626"],
  [0.45, "#525252"],
  [0.7, "#a3a3a3"],
  [1, "#fafafa"],
];

const SPREAD_HORIZON_LINE_COLORS = [
  "#262626",
  "#404040",
  "#525252",
  "#737373",
  "#a3a3a3",
  "#c4c4c4",
  "#d4d4d4",
  "#e5e5e5",
  "#f5f5f5",
];

function SeriesLegendStrip({ items }: { items: { label: string; swatchClass: string }[] }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-white/[0.07] pb-2.5">
      {items.map((it) => (
        <span
          key={it.label}
          className="inline-flex items-center gap-2 text-[11px] font-medium tracking-tight text-[rgba(255,255,255,0.9)]"
        >
          <span className={cn("shrink-0", it.swatchClass)} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function prepareHistogram(hist_data: Record<string, unknown> | undefined): {
  x: number[];
  y: number[];
  barWidth: number | number[];
} | null {
  if (!hist_data || !Array.isArray(hist_data.counts)) return null;
  const counts = hist_data.counts as number[];
  if (counts.length === 0) return null;
  const n = counts.length;
  if (Array.isArray(hist_data.centers) && (hist_data.centers as number[]).length === n) {
    const centers = hist_data.centers as number[];
    let barWidth: number | number[];
    if (Array.isArray(hist_data.widths) && (hist_data.widths as number[]).length === n) {
      barWidth = (hist_data.widths as number[]).map((w) => Math.max(Number(w) * 0.96, 1e-9));
    } else if (centers.length > 1) {
      const step = Math.abs(centers[1]! - centers[0]!);
      barWidth = Math.max(step * 0.96, 1e-9);
    } else {
      barWidth = 1;
    }
    return { x: centers, y: counts, barWidth };
  }
  if (Array.isArray(hist_data.bins) && (hist_data.bins as number[]).length === n) {
    const bins = hist_data.bins as number[];
    const widths: number[] = [];
    const centers: number[] = [];
    for (let i = 0; i < n; i++) {
      const lo = bins[i]!;
      const hi = i + 1 < n ? bins[i + 1]! : lo + (i > 0 ? lo - bins[i - 1]! : 1);
      const w = hi - lo;
      widths.push(Math.max(w * 0.96, 1e-9));
      centers.push(lo + w / 2);
    }
    return { x: centers, y: counts, barWidth: widths };
  }
  return null;
}

function scatterSampleSubtitle(meta: {
  sampled?: boolean;
  total_points?: number;
  displayed_points?: number;
}): string | undefined {
  const t = meta.total_points;
  const d = meta.displayed_points;
  if (typeof t !== "number" || typeof d !== "number") return undefined;
  if (!meta.sampled && t === d) return `${t.toLocaleString()} parameter sets`;
  return `${d.toLocaleString()} of ${t.toLocaleString()} shown (density-balanced sample)`;
}

function joinChartSubtitle(...parts: (string | undefined | null | false)[]): string | undefined {
  const s = parts.filter((x): x is string => typeof x === "string" && x.length > 0);
  return s.length ? s.join(" · ") : undefined;
}

function plotFontLayout(): Partial<Layout> {
  return {
    font: {
      family: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      color: DA.text,
      size: 11,
    },
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
  };
}

function axisPrimary(titleText: string, extras: Record<string, unknown> = {}) {
  return {
    title: { text: titleText, font: { size: 10, color: DA.text } },
    tickfont: { size: 9, color: DA.tick },
    gridcolor: DA.grid,
    zerolinecolor: "rgba(255,255,255,0.06)",
    ...extras,
  };
}

function Ambient() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-24 top-0 h-[480px] w-[480px] rounded-full bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06),transparent_70%)] blur-3xl" />
      <div className="absolute right-0 top-1/3 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_68%)] blur-3xl" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0a0a0a]/40 to-[#0a0a0a]" />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/65">{children}</p>
  );
}

function AnalyticsChartCard({
  title,
  subtitle,
  children,
  className,
  style,
  dense,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** Tighter padding and typography for 2-up grid cells. */
  dense?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border border-white/[0.07] bg-gradient-to-b from-white/[0.04] to-white/[0.015] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        dense ? "p-3 sm:p-3" : "p-3.5 sm:p-4",
        className
      )}
      style={style}
    >
      <div className={cn("shrink-0", dense ? "mb-1" : "mb-2")}>
        <SectionLabel>Chart</SectionLabel>
        <h3
          className={cn(
            "mt-0.5 font-semibold tracking-tight text-white",
            dense ? "text-[13px]" : "text-[15px]"
          )}
        >
          {title}
        </h3>
        {subtitle ? (
          <p className="mt-0.5 text-[9px] leading-snug text-[rgba(255,255,255,0.4)] sm:text-[10px]">{subtitle}</p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl">{children}</div>
    </div>
  );
}

// Helper function to resolve metrics filename
function resolveMetricsFilename(artifacts: string[]): string | null {
  const candidates = ['metrics.json', 'metrics'];
  for (const candidate of candidates) {
    if (artifacts.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Helper function to resolve timeseries filename
function resolveTimeseriesFilename(artifacts: string[], symbol?: string): string | null {
  const candidates = [
    `${symbol}_best_timeseries.json`,
    `${symbol}_best_timeseries`,
    'best_timeseries.json',
    'best_timeseries',
    'best_system_timeseries.json',
    'best_system_timeseries'
  ];
  for (const candidate of candidates) {
    if (artifacts.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Helper function to resolve voxel cube filename
function resolveVoxelFilename(artifacts: string[], symbol?: string): string | null {
  const candidates = [
    `${symbol}_voxel_cube_cagr.json`,
    `${symbol}_voxel_cube_cagr`,
    'voxel_cube_cagr.json',
    'voxel_cube_cagr',
    'voxel_points.json',
    'voxel_points',
    'voxel_points_top.json',
    'voxel_points_top'
  ];
  for (const candidate of candidates) {
    if (artifacts.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Helper function to resolve yearly returns filename
function resolveYearlyReturnsFilename(artifacts: string[], symbol?: string): string | null {
  const candidates = [
    `${symbol}_yearly_returns.json`,
    `${symbol}_yearly_returns`,
    'yearly_returns.json',
    'yearly_returns',
    'yearly_compounded.json',
    'yearly_compounded'
  ];
  for (const candidate of candidates) {
    if (artifacts.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Helper function to resolve heatmaps filename
function resolveHeatmapsFilename(artifacts: string[]): string | null {
  const candidates = [
    'heatmaps_cagr.json',
    'heatmaps_cagr',
    'tp_sl_heatmap_grid_cagr.json',
    'tp_sl_heatmap_grid_cagr'
  ];
  for (const candidate of candidates) {
    if (artifacts.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveCagrVsHorizonSpreadFilename(artifacts: string[]): string | null {
  const candidates = ["cagr_vs_horizon_spread", "cagr_vs_horizon_spread.json"];
  for (const candidate of candidates) {
    if (artifacts.includes(candidate)) {
      return candidate.replace(/\.json$/i, "");
    }
  }
  return null;
}

// Data normalization functions
function normalizeVoxelCube(data: any): { tp: number[]; sl: number[]; h: number[]; metric: number[] } | null {
  if (!data) return null;

  // Handle different voxel cube formats
  if (Array.isArray(data)) {
    // Array of objects format - common from Python scripts
    if (data.length > 0 && typeof data[0] === "object") {
      const tp = data.map(d => d.tp || d.take_profit || d.TP).filter(x => typeof x === 'number');
      const sl = data.map(d => d.sl || d.stop_loss || d.SL).filter(x => typeof x === 'number');
      const h = data.map(d => d.h || d.horizon || d.H).filter(x => typeof x === 'number');
      const metric = data.map(d => d.metric || d.cagr || d.CAGR || d.value || 0).filter(x => typeof x === 'number');

      if (tp.length === sl.length && sl.length === h.length && h.length === metric.length && tp.length > 0) {
        return { tp, sl, h, metric };
      }
    }
  } else if (typeof data === "object") {
    // Object with arrays format
    const tp = Array.isArray(data.tp) ? data.tp : Array.isArray(data.TP) ? data.TP : [];
    const sl = Array.isArray(data.sl) ? data.sl : Array.isArray(data.SL) ? data.SL : [];
    const h = Array.isArray(data.h) ? data.h : Array.isArray(data.H) ? data.H : [];
    const metric = Array.isArray(data.metric) ? data.metric : Array.isArray(data.cagr) ? data.cagr : Array.isArray(data.CAGR) ? data.CAGR : [];

    if (tp.length === sl.length && sl.length === h.length && h.length === metric.length && tp.length > 0) {
      return { tp, sl, h, metric };
    }
  }

  return null;
}

/** Both series start at 0% total return at the first bar; paths show change from there. */
function zeroBasePercentSeries(arr: number[]): number[] {
  if (!arr.length) return arr;
  const b = arr[0];
  if (typeof b !== "number" || !Number.isFinite(b)) return arr;
  return arr.map((v) => (typeof v === "number" && Number.isFinite(v) ? v - b : v));
}

function normalizeTimeseries(data: any): { dates: any[]; strategy: number[]; price: number[] } | null {
  if (!data) return null;

  const dates = data.dates || data.Date || data.date || [];
  const strategy =
    data.strategy || data.strategy_cum_compounded || data.strategy_compounded_pct || data.Strategy || [];
  const price = data.price || data.price_norm || data.price_normalized_pct || data.asset || data.Price || [];

  if (!Array.isArray(dates) || !Array.isArray(strategy) || !Array.isArray(price)) {
    return null;
  }

  if (dates.length === 0 || strategy.length === 0 || price.length === 0) {
    return null;
  }

  const n = Math.min(dates.length, strategy.length, price.length);
  const s = strategy.slice(0, n).map((v: unknown) => (typeof v === "number" ? v : Number(v)));
  const p = price.slice(0, n).map((v: unknown) => (typeof v === "number" ? v : Number(v)));
  return {
    dates: dates.slice(0, n),
    strategy: zeroBasePercentSeries(s),
    price: zeroBasePercentSeries(p),
  };
}

function normalizeYearlyReturns(data: any): { years: any[]; strategy: number[]; price: number[] } | null {
  if (!data) return null;

  const years = data.years || data.Year || data.year || [];
  const strategy =
    data.strategy || data.strategy_yearly_compounded || data.strategy_compounded_pct || data.Strategy || [];
  const price =
    data.price || data.price_compounded_pct || data.asset_yearly || data.asset || data.Price || [];

  if (!Array.isArray(years) || !Array.isArray(strategy) || !Array.isArray(price)) {
    return null;
  }

  if (years.length === 0 || strategy.length === 0 || price.length === 0) {
    return null;
  }

  const minLength = Math.min(years.length, strategy.length, price.length);
  return {
    years: years.slice(0, minLength),
    strategy: strategy.slice(0, minLength),
    price: price.slice(0, minLength),
  };
}

type CagrSpreadPayload = {
  spread_groups?: Array<{
    label?: string;
    spread_pct_label?: string;
    horizons?: number[];
    cagr_values?: number[];
  }>;
};

function KPICard({ title, value }: { title: string; value: string }) {
  return (
    <div className="flex h-16 flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.02] px-2 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.38)]">{title}</div>
      <div className="mt-1 text-base font-semibold tabular-nums tracking-tight text-white">{value}</div>
    </div>
  );
}

export default function LabelingOptimizerResults() {
  const { runId } = useParams<{ runId: string }>();
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [timeseries, setTimeseries] = useState<any>(null);
  const [voxelCube, setVoxelCube] = useState<any>(null);
  const [yearlyReturns, setYearlyReturns] = useState<any>(null);
  const [heatmaps, setHeatmaps] = useState<any>(null);
  const [cagrHorizonSpread, setCagrHorizonSpread] = useState<CagrSpreadPayload | null>(null);
  const [currentHeatmapIndex, setCurrentHeatmapIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const histPlot = useMemo(() => prepareHistogram(metrics?.hist_data), [metrics?.hist_data]);
  const scatterN = metrics?.scatter_data?.max_dd?.length ?? 0;
  const predictionN = metrics?.prediction_data?.l1_rate?.length ?? 0;
  const scatterGl = scatterN >= SCATTERGL_THRESHOLD;
  const predictionGl = predictionN >= SCATTERGL_THRESHOLD;

  const cagrSpreadTraces = useMemo((): Data[] | null => {
    const groups = cagrHorizonSpread?.spread_groups;
    if (!Array.isArray(groups) || groups.length === 0) return null;
    const traces = groups
      .filter(
        (g) =>
          Array.isArray(g.horizons) &&
          Array.isArray(g.cagr_values) &&
          g.horizons.length > 0 &&
          g.horizons.length === g.cagr_values.length
      )
      .map((g, i) => {
        const name = (g.spread_pct_label || g.label || `Spread group ${i + 1}`) as string;
        return {
          type: "scatter" as const,
          mode: "lines" as const,
          name,
          x: g.horizons,
          y: g.cagr_values,
          line: {
            color: SPREAD_HORIZON_LINE_COLORS[i % SPREAD_HORIZON_LINE_COLORS.length],
            width: 1.35,
            shape: "spline" as const,
            smoothing: 1.12,
          },
          hovertemplate:
            "<b>Spread bucket</b>: %{fullData.name}<br><b>Horizon</b>: %{x} days<br><b>Mean CAGR</b>: %{y:.2f}%<extra></extra>",
        };
      });
    return traces.length ? traces : null;
  }, [cagrHorizonSpread]);

  useEffect(() => {
    if (!runId) return;

    const loadData = async () => {
      try {
        setLoading(true);
        setCagrHorizonSpread(null);

        // Load artifacts list
        const artifactsResponse = await labelingOptimizerApi.listArtifacts(runId);
        const availableArtifacts = artifactsResponse.artifacts;
        setArtifacts(availableArtifacts);

        // Load metrics if available (capture symbol for artifact resolution in this same request)
        let metricsSymbol: string | undefined;
        const metricsFilename = resolveMetricsFilename(availableArtifacts);
        if (metricsFilename) {
          try {
            const metricsData = await labelingOptimizerApi.getArtifact(runId, metricsFilename);
            if (metricsData && typeof metricsData === "object") {
              setMetrics(metricsData);
              metricsSymbol =
                typeof (metricsData as { symbol?: string }).symbol === "string"
                  ? (metricsData as { symbol: string }).symbol
                  : undefined;
            } else {
              console.warn("Invalid metrics data received");
            }
          } catch (metricsErr) {
            console.warn("Failed to load metrics:", metricsErr);
          }
        }

        // Load timeseries if available
        const timeseriesFilename = resolveTimeseriesFilename(availableArtifacts, metricsSymbol);
        if (timeseriesFilename) {
          try {
            const timeseriesData = await labelingOptimizerApi.getArtifact(runId, timeseriesFilename);
            const normalizedTimeseriesData = normalizeTimeseries(timeseriesData);
            setTimeseries(normalizedTimeseriesData);
          } catch (timeseriesErr) {
            console.warn("Failed to load timeseries:", timeseriesErr);
            // Don't set error for timeseries - it's optional
          }
        }

        // Load voxel cube if available
        const voxelFilename = resolveVoxelFilename(availableArtifacts, metricsSymbol);
        if (voxelFilename) {
          try {
            const voxelData = await labelingOptimizerApi.getArtifact(runId, voxelFilename);
            const normalizedVoxelData = normalizeVoxelCube(voxelData);
            setVoxelCube(normalizedVoxelData);
          } catch (voxelErr) {
            console.warn("Failed to load voxel cube:", voxelErr);
            // Don't set error for voxel cube - it's optional
          }
        }

        // Load yearly returns if available
        const yearlyReturnsFilename = resolveYearlyReturnsFilename(availableArtifacts, metricsSymbol);
        if (yearlyReturnsFilename) {
          try {
            const yearlyData = await labelingOptimizerApi.getArtifact(runId, yearlyReturnsFilename);
            const normalizedYearlyData = normalizeYearlyReturns(yearlyData);
            setYearlyReturns(normalizedYearlyData);
          } catch (yearlyErr) {
            console.warn("Failed to load yearly returns:", yearlyErr);
            // Don't set error for yearly returns - it's optional
          }
        }

        // Load heatmaps if available
        const heatmapsFilename = resolveHeatmapsFilename(availableArtifacts);
        if (heatmapsFilename) {
          try {
            const heatmapsData = await labelingOptimizerApi.getArtifact(runId, heatmapsFilename);
            setHeatmaps(heatmapsData);
          } catch (heatmapsErr) {
            console.warn("Failed to load heatmaps:", heatmapsErr);
            // Don't set error for heatmaps - it's optional
          }
        }

        const cagrSpreadFilename = resolveCagrVsHorizonSpreadFilename(availableArtifacts);
        if (cagrSpreadFilename) {
          try {
            const spreadData = await labelingOptimizerApi.getArtifact(runId, cagrSpreadFilename);
            if (
              spreadData &&
              typeof spreadData === "object" &&
              Array.isArray((spreadData as CagrSpreadPayload).spread_groups) &&
              (spreadData as CagrSpreadPayload).spread_groups!.length > 0
            ) {
              setCagrHorizonSpread(spreadData as CagrSpreadPayload);
            }
          } catch (spreadErr) {
            console.warn("Failed to load CAGR vs horizon spread:", spreadErr);
          }
        }

        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
        console.error("Failed to load data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [runId]);

  if (!runId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] text-white">
        <div className="text-center">
          <h1 className="mb-4 text-2xl font-semibold tracking-tight">Invalid Run ID</h1>
          <p className="text-[rgba(255,255,255,0.55)]">No run ID provided in URL</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen shrink-0 overflow-x-hidden bg-[#0a0a0a] text-white">
      <Ambient />
      <div className="relative mx-auto max-w-[1400px] px-5 pb-20 pt-4 sm:px-8 sm:pt-6 lg:pt-6">
        <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <SectionLabel>Labeling optimizer</SectionLabel>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl">Advanced Analytics Dashboard</h1>
            {metrics && metrics.symbol && (
              <p className="mt-1 text-xs text-[rgba(255,255,255,0.48)] sm:text-sm">
                {metrics.symbol}: {metrics.start || metrics.start_date || "—"} → {metrics.end || metrics.end_date || "—"}
              </p>
            )}
          </div>
          <Link
            to={backHref}
            className="inline-flex shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white transition hover:border-white/25 hover:bg-white/[0.06]"
          >
            Back
          </Link>
        </header>

        {loading && <div className="text-sm text-[rgba(255,255,255,0.5)]">Loading data…</div>}

        {error && (
          <div className="mb-4 rounded-xl border border-rose-500/25 bg-rose-500/[0.08] p-4 text-sm text-rose-200/90">
            Error: {error}
          </div>
        )}

        {!loading && !error && (
          <div>
            {metrics && (
              <div className="mb-6">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
                  <KPICard
                    title="Best TP"
                    value={metrics.best_tp ? `${(metrics.best_tp * 100).toFixed(1)}%` : "—"}
                  />
                  <KPICard
                    title="Best SL"
                    value={metrics.best_sl ? `${(metrics.best_sl * 100).toFixed(1)}%` : "—"}
                  />
                  <KPICard
                    title="Best Horizon"
                    value={metrics.best_h || metrics.best_horizon ? `${metrics.best_h || metrics.best_horizon}d` : "—"}
                  />
                  <KPICard
                    title="Best CAGR"
                    value={metrics.best_cagr ? `${metrics.best_cagr.toFixed(2)}%` : "—"}
                  />
                  <KPICard
                    title="Best Linear P/L"
                    value={metrics.best_linear_annual_pl || metrics.best_linear_per_year_pct ? `${(metrics.best_linear_annual_pl || metrics.best_linear_per_year_pct).toFixed(2)}%` : "—"}
                  />
                </div>
              </div>
            )}

            <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
              <div className="min-w-0">
                {voxelCube ? (
                  <AnalyticsChartCard
                    title="TP–SL–H 3D Search Space"
                    subtitle="Each point is one (TP, SL, horizon) grid evaluation. Color: dark → light by CAGR (%), light = highest."
                    style={{ height: CHART_H_VOXEL }}
                  >
                    <Plot
                      data={[
                        {
                          type: "scatter3d",
                          mode: "markers",
                          x: voxelCube.tp,
                          y: voxelCube.sl,
                          z: voxelCube.h,
                          marker: {
                            size: 1.6,
                            opacity: 0.72,
                            color: voxelCube.metric,
                            colorscale: VOXEL_CAGR_COLORSCALE,
                            showscale: true,
                            colorbar: {
                              title: { text: "CAGR (%)", font: { size: 10, color: DA.text } },
                              thickness: 12,
                              len: 0.55,
                              tickfont: { color: DA.tick },
                            },
                          },
                        },
                      ]}
                      layout={{
                        ...plotFontLayout(),
                        margin: { l: 0, r: 0, t: 0, b: 0 },
                        scene: {
                          bgcolor: "rgba(7,8,18,0.4)",
                          xaxis: {
                            title: { text: "Take Profit (%)", font: { size: 10, color: DA.text } },
                            tickfont: { size: 9, color: DA.tick },
                            gridcolor: DA.grid,
                          },
                          yaxis: {
                            title: { text: "Stop Loss (%)", font: { size: 10, color: DA.text } },
                            tickfont: { size: 9, color: DA.tick },
                            gridcolor: DA.grid,
                          },
                          zaxis: {
                            title: { text: "Horizon", font: { size: 10, color: DA.text } },
                            tickfont: { size: 9, color: DA.tick },
                            gridcolor: DA.grid,
                          },
                          camera: { eye: { x: 1.5, y: 1.5, z: 1.5 } },
                        },
                      }}
                      config={{ displayModeBar: false, responsive: true }}
                      style={{ width: "100%", height: "100%" }}
                    />
                  </AnalyticsChartCard>
                ) : (
                  <AnalyticsChartCard title="TP–SL–H 3D Search Space" style={{ height: CHART_H_VOXEL - 40 }}>
                    <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-[rgba(255,255,255,0.45)]">
                      No voxel cube data available
                    </div>
                  </AnalyticsChartCard>
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-3">
                {timeseries ? (
                  <AnalyticsChartCard
                    title="Compounded return vs buy & hold"
                    subtitle="Same calendar, same axis: total return % from first bar. Strategy uses the same compounded equity path as the grid KPIs."
                    style={{ height: CHART_H_TS + 100 + CHART_COMPOUND_EXTRA_PX }}
                  >
                    <SeriesLegendStrip
                      items={[
                        { label: "Strategy (best params)", swatchClass: "h-0.5 w-9 rounded-full bg-neutral-300" },
                        { label: "Buy & hold (asset)", swatchClass: "h-0.5 w-9 rounded-full bg-white/90" },
                      ]}
                    />
                    <div className="w-full min-h-0" style={{ height: 300 + CHART_COMPOUND_EXTRA_PX }}>
                      <Plot
                        data={[
                          {
                            type: "scatter",
                            mode: "lines",
                            name: "Strategy (best params)",
                            x: timeseries.dates,
                            y: timeseries.strategy,
                            line: {
                              color: TS_STRATEGY_LINE,
                              width: 2,
                              shape: "spline",
                              smoothing: 1.05,
                            },
                          },
                          {
                            type: "scatter",
                            mode: "lines",
                            name: "Buy & hold (asset)",
                            x: timeseries.dates,
                            y: timeseries.price,
                            line: {
                              color: TS_BUYHOLD_WHITE,
                              width: 2,
                              shape: "spline",
                              smoothing: 1.05,
                            },
                          },
                        ]}
                        layout={{
                          ...plotFontLayout(),
                          margin: { l: 44, r: 12, t: 6, b: 52 },
                          xaxis: {
                            ...axisPrimary("Date"),
                            type: "date",
                            tickformat: "%d %b %Y",
                            tickangle: -22,
                            showgrid: true,
                            automargin: true,
                          },
                          yaxis: axisPrimary("Total return (%)"),
                          showlegend: false,
                        }}
                        config={{ displayModeBar: false, responsive: true, toImageButtonOptions: { format: "svg" } }}
                        style={{ width: "100%", height: "100%" }}
                      />
                    </div>
                  </AnalyticsChartCard>
                ) : (
                  <AnalyticsChartCard title="Compounded return vs buy & hold" style={{ height: CHART_H_TS + 40 }}>
                    <div className="flex h-full min-h-[120px] items-center justify-center text-sm text-[rgba(255,255,255,0.45)]">
                      No timeseries data available
                    </div>
                  </AnalyticsChartCard>
                )}

                <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-5 lg:gap-4">
                  <div className="min-w-0 lg:col-span-2">
                    {cagrSpreadTraces && cagrSpreadTraces.length > 0 ? (
                      <AnalyticsChartCard
                        dense
                        title="CAGR vs horizon (grouped by spread)"
                        subtitle="Spread = TP − SL (fraction). ~8 quantile buckets; each line = mean compounded CAGR (%) over all grid rows in that bucket, by horizon."
                        className="min-w-0"
                        style={{ height: CHART_H_TS + 100 }}
                      >
                        <div className="h-[260px] w-full min-h-0 sm:h-[280px]">
                          <Plot
                            data={cagrSpreadTraces}
                            layout={{
                              ...plotFontLayout(),
                              hovermode: "closest",
                              margin: { l: 44, r: 18, t: 8, b: 44 },
                              xaxis: axisPrimary("Horizon (days)"),
                              yaxis: axisPrimary("CAGR (%)"),
                              showlegend: true,
                              legend: {
                                orientation: "v",
                                yanchor: "top",
                                y: 1,
                                xanchor: "left",
                                x: 1.02,
                                xref: "paper",
                                font: { size: 8, color: "rgba(255,255,255,0.88)" },
                                bgcolor: "rgba(7,8,18,0.75)",
                                bordercolor: "rgba(255,255,255,0.15)",
                                borderwidth: 1,
                                itemwidth: 14,
                              },
                            }}
                            config={{ displayModeBar: false, responsive: true, toImageButtonOptions: { format: "svg" } }}
                            style={{ width: "100%", height: "100%" }}
                          />
                        </div>
                      </AnalyticsChartCard>
                    ) : (
                      <AnalyticsChartCard dense title="CAGR vs horizon (grouped by spread)" style={{ height: CHART_H_TS + 40 }}>
                        <div className="flex h-full min-h-[100px] items-center justify-center text-xs text-[rgba(255,255,255,0.45)]">
                          No spread–horizon data
                        </div>
                      </AnalyticsChartCard>
                    )}
                  </div>
                  <div className="min-w-0 lg:col-span-3">
                    {yearlyReturns ? (
                      <AnalyticsChartCard
                        title="Yearly compounded returns"
                        subtitle="Within each calendar year: last / first session total return % (aligned with equity path vs close)."
                        style={{ height: CHART_H_TS + 100 }}
                      >
                        <SeriesLegendStrip
                          items={[
                            { label: "Strategy (best params)", swatchClass: "h-3 w-3 rounded-md bg-neutral-300" },
                            {
                              label: "Buy & hold (asset)",
                              swatchClass: "h-3 w-3 rounded-md bg-white/90 ring-1 ring-white/25",
                            },
                          ]}
                        />
                        <div className="h-[280px] w-full min-h-0">
                          <Plot
                            data={[
                              {
                                type: "bar",
                                name: "Strategy (best params)",
                                x: yearlyReturns.years,
                                y: yearlyReturns.strategy,
                                marker: {
                                  color: TS_STRATEGY_LINE,
                                  line: { width: 0 },
                                  cornerradius: 5,
                                },
                              },
                              {
                                type: "bar",
                                name: "Buy & hold (asset)",
                                x: yearlyReturns.years,
                                y: yearlyReturns.price,
                                marker: {
                                  color: "rgba(255,255,255,0.9)",
                                  line: { color: "rgba(255,255,255,0.35)", width: 1 },
                                  cornerradius: 5,
                                },
                              },
                            ]}
                            layout={{
                              ...plotFontLayout(),
                              margin: { l: 44, r: 12, t: 6, b: 44 },
                              xaxis: axisPrimary("Year"),
                              yaxis: axisPrimary("Return (%)"),
                              barmode: "group",
                              bargap: 0.16,
                              showlegend: false,
                            }}
                            config={{ displayModeBar: false, responsive: true, toImageButtonOptions: { format: "svg" } }}
                            style={{ width: "100%", height: "100%" }}
                          />
                        </div>
                      </AnalyticsChartCard>
                    ) : (
                      <AnalyticsChartCard title="Yearly compounded returns" style={{ height: CHART_H_TS + 40 }}>
                        <div className="flex h-full min-h-[120px] items-center justify-center text-sm text-[rgba(255,255,255,0.45)]">
                          No yearly returns data available
                        </div>
                      </AnalyticsChartCard>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-x-5 lg:gap-y-5">
              {metrics && metrics.scatter_data?.max_dd?.length > 0 && (
                <AnalyticsChartCard
                  dense
                  title="CAGR vs max drawdown"
                  subtitle={joinChartSubtitle(
                    scatterSampleSubtitle(metrics.scatter_data),
                    scatterGl ? "WebGL renderer" : null
                  )}
                  className="min-w-0"
                >
                  <div className="h-[240px] w-full min-h-0 sm:h-[260px]">
                    <Plot
                      data={[
                        {
                          type: scatterGl ? "scattergl" : "scatter",
                          mode: "markers",
                          x: metrics.scatter_data.max_dd,
                          y: metrics.scatter_data.cagr,
                          marker: {
                            size: scatterGl ? 2 : 2.75,
                            color: "rgba(129,140,248,0.5)",
                            line: { width: 0 },
                            opacity: scatterGl ? 0.38 : 0.45,
                          },
                        },
                      ]}
                      layout={{
                        ...plotFontLayout(),
                        margin: { l: 44, r: 10, t: 4, b: 36 },
                        xaxis: axisPrimary("Max drawdown (%)"),
                        yaxis: axisPrimary("CAGR (%)"),
                      }}
                      config={{ displayModeBar: false, responsive: true, toImageButtonOptions: { format: "svg" } }}
                      style={{ width: "100%", height: "100%" }}
                    />
                  </div>
                </AnalyticsChartCard>
              )}

              {metrics && metrics.prediction_data?.l1_rate?.length > 0 && (
                <AnalyticsChartCard
                  dense
                  title="L1 rate vs cumulative linear return"
                  subtitle={joinChartSubtitle(
                    scatterSampleSubtitle(metrics.prediction_data),
                    "Y: cumulative linear return (%)",
                    predictionGl ? "WebGL" : null
                  )}
                  className="min-w-0"
                >
                  <div className="h-[240px] w-full min-h-0 sm:h-[260px]">
                    <Plot
                      data={[
                        {
                          type: predictionGl ? "scattergl" : "scatter",
                          mode: "markers",
                          x: metrics.prediction_data.l1_rate,
                          y: (metrics.prediction_data.pnl as number[]).map((p: number) =>
                            Number.isFinite(p) ? p * 100 : NaN
                          ),
                          marker: {
                            size: predictionGl ? 2 : 2.75,
                            color: "rgba(167,139,250,0.5)",
                            line: { width: 0 },
                            opacity: predictionGl ? 0.36 : 0.44,
                          },
                        },
                      ]}
                      layout={{
                        ...plotFontLayout(),
                        margin: { l: 48, r: 10, t: 4, b: 36 },
                        xaxis: axisPrimary("L1 label rate (share)"),
                        yaxis: axisPrimary("Cumulative linear return (%)"),
                      }}
                      config={{ displayModeBar: false, responsive: true, toImageButtonOptions: { format: "svg" } }}
                      style={{ width: "100%", height: "100%" }}
                    />
                  </div>
                </AnalyticsChartCard>
              )}

              {metrics && histPlot && (
                <AnalyticsChartCard
                  dense
                  title="Annual linear P/L distribution"
                  subtitle="All grid rows; bin width via Freedman–Diaconis (clamped)."
                  className="min-w-0"
                >
                  <div className="h-[240px] w-full min-h-0 sm:h-[260px]">
                    <Plot
                      data={[
                        {
                          type: "bar",
                          x: histPlot.x,
                          y: histPlot.y,
                          marker: {
                            color: "rgba(255,255,255,0.15)",
                            line: { color: "rgba(255,255,255,0.06)", width: 0 },
                            cornerradius: 3,
                          },
                          width: histPlot.barWidth,
                        },
                      ]}
                      layout={{
                        ...plotFontLayout(),
                        margin: { l: 44, r: 10, t: 4, b: 36 },
                        xaxis: axisPrimary("Annual linear P/L (%)"),
                        yaxis: axisPrimary("Grid count"),
                        bargap: 0.02,
                      }}
                      config={{ displayModeBar: false, responsive: true, toImageButtonOptions: { format: "svg" } }}
                      style={{ width: "100%", height: "100%" }}
                    />
                  </div>
                </AnalyticsChartCard>
              )}

              {metrics && metrics.benchmark_data && (
                <AnalyticsChartCard
                  dense
                  title="Best system vs benchmarks"
                  subtitle="S&P / bonds / risk-free are fixed long-run reference CAGRs, not backtested on this window."
                  className="min-w-0"
                >
                  <div className="h-[240px] w-full min-h-0 sm:h-[260px]">
                    <Plot
                      data={[
                        {
                          type: "bar",
                          x: metrics.benchmark_data.names,
                          y: metrics.benchmark_data.values,
                          marker: {
                            color: metrics.benchmark_data.names.map(
                              (_: string, i: number) => BENCHMARK_BAR_COLORS[i % BENCHMARK_BAR_COLORS.length]
                            ),
                            line: { width: 0 },
                            cornerradius: 5,
                          },
                        },
                      ]}
                      layout={{
                        ...plotFontLayout(),
                        margin: { l: 44, r: 10, t: 4, b: 72 },
                        xaxis: {
                          tickangle: -35,
                          tickfont: { size: 9, color: DA.tick },
                          gridcolor: DA.grid,
                        },
                        yaxis: axisPrimary("CAGR (%)"),
                        bargap: 0.28,
                      }}
                      config={{ displayModeBar: false, responsive: true, toImageButtonOptions: { format: "svg" } }}
                      style={{ width: "100%", height: "100%" }}
                    />
                  </div>
                </AnalyticsChartCard>
              )}

            </div>

            {(metrics?.correlation_data ||
              (heatmaps && heatmaps.horizons && heatmaps.tp_values && heatmaps.sl_values)) && (
              <div className="mb-8 mt-10 min-w-0">
                <SectionLabel>Surfaces</SectionLabel>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-white">
                  Correlation matrix &amp; TP–SL CAGR heatmaps
                </h2>
                <p className="mt-1 text-xs text-[rgba(255,255,255,0.45)]">
                  Parameter correlations next to TP×SL CAGR slices by horizon (same grid data).
                </p>
                <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
                  {metrics?.correlation_data ? (
                    <AnalyticsChartCard
                      dense
                      title="Parameter correlation matrix"
                      subtitle="Pearson ρ across grid rows (exported metric columns)."
                      className="min-w-0"
                    >
                      <div className="h-[280px] w-full min-h-0 sm:h-[300px]">
                        <Plot
                          data={[
                            {
                              type: "heatmap",
                              z: metrics.correlation_data.matrix,
                              x: metrics.correlation_data.labels,
                              y: metrics.correlation_data.labels,
                              colorscale: CORRELATION_GRAY,
                              showscale: true,
                              colorbar: {
                                title: { text: "ρ", font: { size: 11, color: DA.text } },
                                thickness: 14,
                                len: 0.65,
                                tickfont: { color: DA.tick },
                              },
                            },
                          ]}
                          layout={{
                            ...plotFontLayout(),
                            margin: { l: 100, r: 72, t: 8, b: 88 },
                            xaxis: {
                              tickangle: -35,
                              side: "bottom",
                              tickfont: { color: DA.tick, size: 9 },
                              gridcolor: DA.gridSoft,
                            },
                            yaxis: {
                              autorange: "reversed",
                              tickfont: { color: DA.tick, size: 9 },
                              gridcolor: DA.gridSoft,
                            },
                          }}
                          config={{ displayModeBar: false, responsive: true, toImageButtonOptions: { format: "svg" } }}
                          style={{ width: "100%", height: "100%" }}
                        />
                      </div>
                    </AnalyticsChartCard>
                  ) : (
                    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 text-center text-sm text-[rgba(255,255,255,0.45)]">
                      No correlation data
                    </div>
                  )}

                  {heatmaps && heatmaps.horizons && heatmaps.tp_values && heatmaps.sl_values ? (() => {
                    const availableHorizons = Object.keys(heatmaps.horizons).map(Number).sort((a, b) => a - b);
                    const currentHorizon = availableHorizons[currentHeatmapIndex];
                    const matrix = heatmaps.horizons[currentHorizon];

                    return (
                      <div className="flex min-w-0 flex-col gap-4">
                      <AnalyticsChartCard
                        title={`CAGR heatmap · horizon ${currentHorizon} candle${currentHorizon > 1 ? "s" : ""}`}
                        subtitle="TP × SL plane at fixed horizon; grayscale scale."
                        style={{ minHeight: 320 }}
                      >
                        <div className="mb-2 flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setCurrentHeatmapIndex((prev) => (prev - 1 + availableHorizons.length) % availableHorizons.length)
                            }
                            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-sm text-[rgba(255,255,255,0.75)] transition hover:border-white/25 hover:bg-white/[0.06] disabled:opacity-40"
                            disabled={availableHorizons.length <= 1}
                          >
                            ‹
                          </button>
                          <span className="min-w-[48px] text-center text-xs text-[rgba(255,255,255,0.5)]">
                            {currentHeatmapIndex + 1} / {availableHorizons.length}
                          </span>
                          <button
                            type="button"
                            onClick={() => setCurrentHeatmapIndex((prev) => (prev + 1) % availableHorizons.length)}
                            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-sm text-[rgba(255,255,255,0.75)] transition hover:border-white/25 hover:bg-white/[0.06] disabled:opacity-40"
                            disabled={availableHorizons.length <= 1}
                          >
                            ›
                          </button>
                        </div>

                        {matrix ? (
                          <div className="h-[280px] w-full">
                            <Plot
                              data={[
                                {
                                  type: "heatmap",
                                  z: matrix,
                                  x: heatmaps.tp_values,
                                  y: heatmaps.sl_values,
                                  colorscale: HEATMAP_GRAY,
                                  zmin: heatmaps.vmin,
                                  zmax: heatmaps.vmax,
                                  showscale: true,
                                  colorbar: {
                                    title: { text: "CAGR %", font: { size: 9, color: DA.text } },
                                    thickness: 12,
                                    len: 0.8,
                                    tickfont: { color: DA.tick },
                                  },
                                },
                              ]}
                              layout={{
                                ...plotFontLayout(),
                                margin: { l: 50, r: 55, t: 12, b: 50 },
                                xaxis: {
                                  ...axisPrimary("Take profit (%)"),
                                  tickfont: { size: 8, color: DA.tick },
                                },
                                yaxis: {
                                  ...axisPrimary("Stop loss (%)"),
                                  tickfont: { size: 8, color: DA.tick },
                                },
                              }}
                              config={{ displayModeBar: false, responsive: true, toImageButtonOptions: { format: "svg" } }}
                              style={{ width: "100%", height: "100%" }}
                              useResizeHandler={true}
                            />
                          </div>
                        ) : (
                          <div className="flex aspect-square w-full items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.02]">
                            <span className="text-sm text-[rgba(255,255,255,0.45)]">No data</span>
                          </div>
                        )}
                      </AnalyticsChartCard>

                    <AnalyticsChartCard title="Export visuals" style={{ minHeight: 200 }}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-[#0a0a0a] shadow-lg shadow-black/20 transition hover:bg-white/90"
                        onClick={async () => {
                          try {
                            // Trigger download of all visuals as ZIP
                            const response = await fetchApi(`/api/labeling-optimizer/download-visuals/${runId}`, {
                              method: 'GET',
                            });

                            if (response.ok) {
                              const blob = await response.blob();
                              const url = window.URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `labeling_optimizer_visuals_${runId}.zip`;
                              document.body.appendChild(a);
                              a.click();
                              window.URL.revokeObjectURL(url);
                              document.body.removeChild(a);
                            } else {
                              alert('Failed to download visuals. Please try again.');
                            }
                          } catch (error) {
                            console.error('Download error:', error);
                            alert('Error downloading visuals. Check console for details.');
                          }
                        }}
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                        Download all as ZIP
                      </button>
                      <p className="mt-3 text-xs text-[rgba(255,255,255,0.42)]">Downloads JSON artifacts in a ZIP archive.</p>
                    </AnalyticsChartCard>
                      </div>
                );
              })() : (
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 text-center text-sm text-[rgba(255,255,255,0.45)]">
                  No heatmap data available
                </div>
              )}
                </div>
              </div>
            )}

            <div className="mt-10 border-t border-white/[0.06] pt-6">
              <SectionLabel>Artifacts</SectionLabel>
              <div className="mt-2 flex flex-wrap gap-2">
                {artifacts.map((artifact, index) => (
                  <code
                    key={index}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-[rgba(255,255,255,0.7)]"
                  >
                    {artifact}
                  </code>
                ))}
              </div>
              {artifacts.length === 0 && (
                <div className="mt-2 text-sm text-[rgba(255,255,255,0.45)]">No artifacts found for this run.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}