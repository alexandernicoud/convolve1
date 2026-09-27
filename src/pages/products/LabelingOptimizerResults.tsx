import { useState, useEffect, useMemo } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import Plot from "react-plotly.js";
import type { Layout, ColorScale, Data } from "plotly.js";
import { fetchApi, labelingOptimizerApi } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Chart tokens — neutral base + violet accent (matches BacktesterResults). */
const DA = {
  text: "#fafafa",
  tick: "rgba(255,255,255,0.62)",
  muted: "rgba(255,255,255,0.45)",
  grid: "rgba(255,255,255,0.08)",
  gridSoft: "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.1)",
  strategy: "#A855F7",
  strategyLine: "#A855F7",
  price: "#a3a3a3",
  priceLine: "rgba(255,255,255,0.82)",
  accent: "#A855F7",
  accentSoft: "rgba(168,85,247,0.55)",
  accent2: "#737373",
  deep: "#525252",
  bright: "#d4d4d4",
  soft: "#a3a3a3",
};

/** Heatmap data marks — violet scale (UI chrome stays neutral). */
const HEATMAP_VIOLET: ColorScale = [
  [0, "#0a0a0a"],
  [0.25, "#2a2444"],
  [0.5, "#5b3d8a"],
  [0.75, "#A855F7"],
  [1, "#f5e9ff"],
];

const CORRELATION_VIOLET: ColorScale = [
  [0, "#171717"],
  [0.35, "#3b2d55"],
  [0.65, "#7c5cbf"],
  [1, "#e9d5ff"],
];

const BENCHMARK_BAR_COLORS = ["#A855F7", "#6b7280", "#52525b", "#404040", "#a3a3a3"];

/** Use WebGL scatter for large clouds (Plotly scattergl). */
const SCATTERGL_THRESHOLD = 1800;

const CHART_H = 320;
const CHART_H_TALL = 400;

const TS_STRATEGY_LINE = "#A855F7";
const TS_BUYHOLD_WHITE = "rgba(255,255,255,0.82)";

/** 3D voxel points: dark → violet (data marks only). */
const VOXEL_CAGR_COLORSCALE: ColorScale = [
  [0, "#404040"],
  [0.35, "#737373"],
  [0.65, "#A855F7"],
  [1, "#e9d5ff"],
];

const SPREAD_HORIZON_LINE_COLORS = [
  "#A855F7",
  "#c084fc",
  "#a78bfa",
  "#8b5cf6",
  "#d4d4d8",
  "#a1a1aa",
  "#71717a",
  "#e5e5e5",
  "#fafafa",
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
      <div className="absolute -left-24 top-0 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.05),transparent_70%)] blur-3xl" />
      <div className="absolute right-0 top-1/3 h-[380px] w-[380px] rounded-full bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06),transparent_68%)] blur-3xl" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0a0a0a]/45 to-[#0a0a0a]" />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55">{children}</p>
  );
}

function SectionHead({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-3">
      <SectionLabel>{eyebrow}</SectionLabel>
      <h2 className="mt-0.5 text-base font-semibold tracking-tight text-white sm:text-lg">{title}</h2>
      {subtitle ? <p className="mt-0.5 text-xs text-white/45">{subtitle}</p> : null}
    </div>
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
  dense?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-white/[0.015] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        dense ? "p-3" : "p-3.5 sm:p-4",
        className,
      )}
      style={style}
    >
      <div className={cn("shrink-0", dense ? "mb-1.5" : "mb-2")}>
        <h3
          className={cn(
            "font-semibold tracking-tight text-white",
            dense ? "text-[13px]" : "text-[14px] sm:text-[15px]",
          )}
        >
          {title}
        </h3>
        {subtitle ? (
          <p className="mt-0.5 text-[10px] leading-snug text-white/40">{subtitle}</p>
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
    <div className="flex h-[4.5rem] flex-col items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-2 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">{title}</div>
      <div className="mt-1 text-base font-semibold tabular-nums tracking-tight text-white sm:text-lg">
        {value}
      </div>
    </div>
  );
}

export default function LabelingOptimizerResults() {
  const { runId } = useParams<{ runId: string }>();
  const location = useLocation();
  const backHref =
    (location.state as { fromRunHistory?: string } | null)?.fromRunHistory ||
    "/products/labeling-optimizer/technical";
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

  const heatmapHorizons =
    heatmaps?.horizons && heatmaps.tp_values && heatmaps.sl_values
      ? Object.keys(heatmaps.horizons)
          .map(Number)
          .sort((a, b) => a - b)
      : [];
  const currentHorizon = heatmapHorizons[currentHeatmapIndex] ?? heatmapHorizons[0];
  const heatmapMatrix =
    currentHorizon != null && heatmaps?.horizons ? heatmaps.horizons[currentHorizon] : null;

  return (
    <div className="relative min-h-0 shrink-0 overflow-x-hidden bg-[#0a0a0a] pb-10 text-white">
      <Ambient />
      <div className="relative mx-auto max-w-[1280px] space-y-8 px-4 pt-4 sm:px-6 sm:pt-5 lg:px-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <SectionLabel>Labeling optimizer</SectionLabel>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl">Results</h1>
            {metrics?.symbol ? (
              <p className="mt-1 text-sm text-white/50">
                <span className="font-medium text-white/80">{metrics.symbol}</span>
                {" · "}
                {metrics.start || metrics.start_date || "—"} → {metrics.end || metrics.end_date || "—"}
                {runId ? (
                  <>
                    {" · "}
                    <span className="font-mono text-xs text-white/35">{runId.slice(-8)}</span>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          <Link
            to={backHref}
            className="inline-flex shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white/85 transition hover:border-white/25 hover:bg-white/[0.08]"
          >
            Back
          </Link>
        </header>

        {loading && <div className="text-sm text-white/50">Loading data…</div>}

        {error && (
          <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.08] p-4 text-sm text-rose-200/90">
            Error: {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {metrics && (
              <section>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                  <KPICard
                    title="Best TP"
                    value={metrics.best_tp != null ? `${(metrics.best_tp * 100).toFixed(1)}%` : "—"}
                  />
                  <KPICard
                    title="Best SL"
                    value={metrics.best_sl != null ? `${(metrics.best_sl * 100).toFixed(1)}%` : "—"}
                  />
                  <KPICard
                    title="Best Horizon"
                    value={
                      metrics.best_h || metrics.best_horizon
                        ? `${metrics.best_h || metrics.best_horizon}d`
                        : "—"
                    }
                  />
                  <KPICard
                    title="Best CAGR"
                    value={metrics.best_cagr != null ? `${metrics.best_cagr.toFixed(2)}%` : "—"}
                  />
                  <KPICard
                    title="Best Linear P/L"
                    value={
                      metrics.best_linear_annual_pl != null || metrics.best_linear_per_year_pct != null
                        ? `${(metrics.best_linear_annual_pl || metrics.best_linear_per_year_pct).toFixed(2)}%`
                        : "—"
                    }
                  />
                </div>
              </section>
            )}

            {(voxelCube || timeseries) && (
              <section>
                <SectionHead
                  eyebrow="Performance"
                  title="Search space & equity"
                  subtitle="3D grid of evaluated labels beside the best-parameter equity path."
                />
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
                  {voxelCube ? (
                    <AnalyticsChartCard
                      title="TP–SL–H 3D search space"
                      subtitle="Each point is one grid evaluation. Color: dark → violet by CAGR."
                      style={{ minHeight: CHART_H_TALL }}
                    >
                      <div className="h-[340px] w-full sm:h-[360px]">
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
                                opacity: 0.78,
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
                              bgcolor: "rgba(10,8,18,0.55)",
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
                      </div>
                    </AnalyticsChartCard>
                  ) : null}

                  {timeseries ? (
                    <AnalyticsChartCard
                      title="Compounded return vs buy & hold"
                      subtitle="Total return % from first bar — violet strategy vs asset."
                      style={{ minHeight: CHART_H_TALL }}
                    >
                      <SeriesLegendStrip
                        items={[
                          {
                            label: "Strategy (best params)",
                            swatchClass: "h-0.5 w-9 rounded-full bg-violet-500",
                          },
                          {
                            label: "Buy & hold (asset)",
                            swatchClass: "h-0.5 w-9 rounded-full bg-white/80",
                          },
                        ]}
                      />
                      <div className="h-[300px] w-full sm:h-[320px]">
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
                                width: 2.25,
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
                                width: 1.75,
                                shape: "spline",
                                smoothing: 1.05,
                              },
                            },
                          ]}
                          layout={{
                            ...plotFontLayout(),
                            margin: { l: 44, r: 12, t: 6, b: 48 },
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
                          config={{
                            displayModeBar: false,
                            responsive: true,
                            toImageButtonOptions: { format: "svg" },
                          }}
                          style={{ width: "100%", height: "100%" }}
                        />
                      </div>
                    </AnalyticsChartCard>
                  ) : null}
                </div>
              </section>
            )}

            {(yearlyReturns || (cagrSpreadTraces && cagrSpreadTraces.length > 0)) && (
              <section>
                <SectionHead
                  eyebrow="Calendar"
                  title="Yearly & horizon structure"
                  subtitle="How the best label set behaves by year, and how CAGR varies with horizon / spread."
                />
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
                  {yearlyReturns ? (
                    <AnalyticsChartCard
                      title="Yearly compounded returns"
                      subtitle="Within each calendar year: last / first session total return %."
                      style={{ minHeight: CHART_H }}
                    >
                      <SeriesLegendStrip
                        items={[
                          {
                            label: "Strategy (best params)",
                            swatchClass: "h-3 w-3 rounded-md bg-violet-500",
                          },
                          {
                            label: "Buy & hold (asset)",
                            swatchClass: "h-3 w-3 rounded-md bg-white/85 ring-1 ring-white/25",
                          },
                        ]}
                      />
                      <div className="h-[260px] w-full">
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
                                color: "rgba(255,255,255,0.82)",
                                line: { color: "rgba(255,255,255,0.25)", width: 1 },
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
                          config={{
                            displayModeBar: false,
                            responsive: true,
                            toImageButtonOptions: { format: "svg" },
                          }}
                          style={{ width: "100%", height: "100%" }}
                        />
                      </div>
                    </AnalyticsChartCard>
                  ) : null}

                  {cagrSpreadTraces && cagrSpreadTraces.length > 0 ? (
                    <AnalyticsChartCard
                      dense
                      title="CAGR vs horizon (by spread)"
                      subtitle="Spread = TP − SL. Each line = mean CAGR in that spread bucket."
                      style={{ minHeight: CHART_H }}
                    >
                      <div className="h-[280px] w-full">
                        <Plot
                          data={cagrSpreadTraces}
                          layout={{
                            ...plotFontLayout(),
                            hovermode: "closest",
                            margin: { l: 44, r: 8, t: 8, b: 44 },
                            xaxis: axisPrimary("Horizon (days)"),
                            yaxis: axisPrimary("CAGR (%)"),
                            showlegend: true,
                            legend: {
                              orientation: "h",
                              yanchor: "top",
                              y: -0.22,
                              xanchor: "center",
                              x: 0.5,
                              font: { size: 9, color: "rgba(255,255,255,0.75)" },
                              bgcolor: "rgba(10,8,18,0.55)",
                              borderwidth: 0,
                            },
                          }}
                          config={{
                            displayModeBar: false,
                            responsive: true,
                            toImageButtonOptions: { format: "svg" },
                          }}
                          style={{ width: "100%", height: "100%" }}
                        />
                      </div>
                    </AnalyticsChartCard>
                  ) : null}
                </div>
              </section>
            )}

            {(metrics?.scatter_data?.max_dd?.length > 0 ||
              metrics?.prediction_data?.l1_rate?.length > 0 ||
              histPlot ||
              metrics?.benchmark_data) && (
              <section>
                <SectionHead
                  eyebrow="Grid diagnostics"
                  title="Risk, labels & benchmarks"
                  subtitle="Scatter and distributions across the full search grid."
                />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {metrics?.scatter_data?.max_dd?.length > 0 && (
                    <AnalyticsChartCard
                      dense
                      title="CAGR vs max drawdown"
                      subtitle={joinChartSubtitle(
                        scatterSampleSubtitle(metrics.scatter_data),
                        scatterGl ? "WebGL" : null,
                      )}
                    >
                      <div className="h-[240px] w-full">
                        <Plot
                          data={[
                            {
                              type: scatterGl ? "scattergl" : "scatter",
                              mode: "markers",
                              x: metrics.scatter_data.max_dd,
                              y: metrics.scatter_data.cagr,
                              marker: {
                                size: scatterGl ? 2 : 2.75,
                                color: "rgba(168,85,247,0.55)",
                                line: { width: 0 },
                                opacity: scatterGl ? 0.4 : 0.5,
                              },
                            },
                          ]}
                          layout={{
                            ...plotFontLayout(),
                            margin: { l: 44, r: 10, t: 4, b: 36 },
                            xaxis: axisPrimary("Max drawdown (%)"),
                            yaxis: axisPrimary("CAGR (%)"),
                          }}
                          config={{
                            displayModeBar: false,
                            responsive: true,
                            toImageButtonOptions: { format: "svg" },
                          }}
                          style={{ width: "100%", height: "100%" }}
                        />
                      </div>
                    </AnalyticsChartCard>
                  )}

                  {metrics?.prediction_data?.l1_rate?.length > 0 && (
                    <AnalyticsChartCard
                      dense
                      title="L1 rate vs cumulative linear return"
                      subtitle={joinChartSubtitle(
                        scatterSampleSubtitle(metrics.prediction_data),
                        predictionGl ? "WebGL" : null,
                      )}
                    >
                      <div className="h-[240px] w-full">
                        <Plot
                          data={[
                            {
                              type: predictionGl ? "scattergl" : "scatter",
                              mode: "markers",
                              x: metrics.prediction_data.l1_rate,
                              y: (metrics.prediction_data.pnl as number[]).map((p: number) =>
                                Number.isFinite(p) ? p * 100 : NaN,
                              ),
                              marker: {
                                size: predictionGl ? 2 : 2.75,
                                color: "rgba(167,139,250,0.55)",
                                line: { width: 0 },
                                opacity: predictionGl ? 0.38 : 0.48,
                              },
                            },
                          ]}
                          layout={{
                            ...plotFontLayout(),
                            margin: { l: 48, r: 10, t: 4, b: 36 },
                            xaxis: axisPrimary("L1 label rate (share)"),
                            yaxis: axisPrimary("Cumulative linear return (%)"),
                          }}
                          config={{
                            displayModeBar: false,
                            responsive: true,
                            toImageButtonOptions: { format: "svg" },
                          }}
                          style={{ width: "100%", height: "100%" }}
                        />
                      </div>
                    </AnalyticsChartCard>
                  )}

                  {histPlot && (
                    <AnalyticsChartCard
                      dense
                      title="Annual linear P/L distribution"
                      subtitle="All grid rows; Freedman–Diaconis bins."
                    >
                      <div className="h-[240px] w-full">
                        <Plot
                          data={[
                            {
                              type: "bar",
                              x: histPlot.x,
                              y: histPlot.y,
                              marker: {
                                color: "rgba(168,85,247,0.35)",
                                line: { color: "rgba(168,85,247,0.2)", width: 0 },
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
                          config={{
                            displayModeBar: false,
                            responsive: true,
                            toImageButtonOptions: { format: "svg" },
                          }}
                          style={{ width: "100%", height: "100%" }}
                        />
                      </div>
                    </AnalyticsChartCard>
                  )}

                  {metrics?.benchmark_data && (
                    <AnalyticsChartCard
                      dense
                      title="Best system vs benchmarks"
                      subtitle="Reference CAGRs (not window-matched backtests)."
                    >
                      <div className="h-[240px] w-full">
                        <Plot
                          data={[
                            {
                              type: "bar",
                              x: metrics.benchmark_data.names,
                              y: metrics.benchmark_data.values,
                              marker: {
                                color: metrics.benchmark_data.names.map(
                                  (_: string, i: number) =>
                                    BENCHMARK_BAR_COLORS[i % BENCHMARK_BAR_COLORS.length],
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
                          config={{
                            displayModeBar: false,
                            responsive: true,
                            toImageButtonOptions: { format: "svg" },
                          }}
                          style={{ width: "100%", height: "100%" }}
                        />
                      </div>
                    </AnalyticsChartCard>
                  )}
                </div>
              </section>
            )}

            {(metrics?.correlation_data || heatmapMatrix) && (
              <section>
                <SectionHead
                  eyebrow="Surfaces"
                  title="Correlation & TP–SL heatmaps"
                  subtitle="Parameter correlations beside TP×SL CAGR slices by horizon."
                />
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
                  {metrics?.correlation_data ? (
                    <AnalyticsChartCard
                      dense
                      title="Parameter correlation matrix"
                      subtitle="Pearson ρ across grid rows."
                    >
                      <div className="h-[300px] w-full">
                        <Plot
                          data={[
                            {
                              type: "heatmap",
                              z: metrics.correlation_data.matrix,
                              x: metrics.correlation_data.labels,
                              y: metrics.correlation_data.labels,
                              colorscale: CORRELATION_VIOLET,
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
                          config={{
                            displayModeBar: false,
                            responsive: true,
                            toImageButtonOptions: { format: "svg" },
                          }}
                          style={{ width: "100%", height: "100%" }}
                        />
                      </div>
                    </AnalyticsChartCard>
                  ) : null}

                  {heatmapMatrix && heatmaps && currentHorizon != null ? (
                    <AnalyticsChartCard
                      title={`CAGR heatmap · h=${currentHorizon}`}
                      subtitle="TP × SL plane at fixed horizon."
                    >
                      <div className="mb-2 flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setCurrentHeatmapIndex(
                              (prev) => (prev - 1 + heatmapHorizons.length) % heatmapHorizons.length,
                            )
                          }
                          className="rounded-lg border border-white/15 bg-white/[0.04] px-2 py-1 text-sm text-white/80 transition hover:bg-white/[0.08] disabled:opacity-40"
                          disabled={heatmapHorizons.length <= 1}
                        >
                          ‹
                        </button>
                        <span className="min-w-[48px] text-center text-xs text-white/45">
                          {currentHeatmapIndex + 1} / {heatmapHorizons.length}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setCurrentHeatmapIndex((prev) => (prev + 1) % heatmapHorizons.length)
                          }
                          className="rounded-lg border border-white/15 bg-white/[0.04] px-2 py-1 text-sm text-white/80 transition hover:bg-white/[0.08] disabled:opacity-40"
                          disabled={heatmapHorizons.length <= 1}
                        >
                          ›
                        </button>
                      </div>
                      <div className="h-[280px] w-full">
                        <Plot
                          data={[
                            {
                              type: "heatmap",
                              z: heatmapMatrix,
                              x: heatmaps.tp_values,
                              y: heatmaps.sl_values,
                              colorscale: HEATMAP_VIOLET,
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
                          config={{
                            displayModeBar: false,
                            responsive: true,
                            toImageButtonOptions: { format: "svg" },
                          }}
                          style={{ width: "100%", height: "100%" }}
                          useResizeHandler
                        />
                      </div>
                    </AnalyticsChartCard>
                  ) : null}
                </div>
              </section>
            )}

            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <SectionLabel>Export</SectionLabel>
                  <p className="mt-1 text-sm text-white/55">
                    Download charts &amp; JSON artifacts for this run.
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-white/90"
                  onClick={async () => {
                    try {
                      const response = await fetchApi(
                        `/api/labeling-optimizer/download-visuals/${runId}`,
                        { method: "GET" },
                      );
                      if (response.ok) {
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `labeling_optimizer_visuals_${runId}.zip`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                      } else {
                        alert("Failed to download visuals. Please try again.");
                      }
                    } catch (err) {
                      console.error("Download error:", err);
                      alert("Error downloading visuals. Check console for details.");
                    }
                  }}
                >
                  Download ZIP
                </button>
              </div>
              {artifacts.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-white/[0.08] pt-3">
                  {artifacts.map((artifact) => (
                    <code
                      key={artifact}
                      className="rounded-md border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[10px] text-white/55"
                    >
                      {artifact}
                    </code>
                  ))}
                </div>
              ) : null}
            </section>
          </>
        )}
      </div>
    </div>
  );
}