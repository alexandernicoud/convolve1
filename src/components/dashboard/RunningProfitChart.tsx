import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardEquitySeries } from "@/lib/api";
import { CHART_HORIZONTAL_GRID_STROKE } from "@/components/dashboard/chartGrid";
import { formatUsdAxisK } from "@/components/dashboard/compactMoneyFormat";

/** Aligned rows for Recharts: one row per timestamp, forward-filled per bot. */
export function alignEquitySeriesForChart(series: DashboardEquitySeries[]) {
  if (!series.length) return { rows: [] as Record<string, number | string>[], keys: [] as string[], labels: [] as string[] };

  const tsSet = new Set<number>();
  for (const s of series) {
    for (const p of s.points) {
      tsSet.add(new Date(p.as_of).getTime());
    }
  }
  const tsSorted = [...tsSet].sort((a, b) => a - b);

  const keys = series.map((s) => `b_${s.bot_id.replace(/-/g, "_")}`);
  const labels = series.map((s) => s.name || s.symbol || s.bot_id.slice(0, 8));

  const lastKnown: Record<string, number> = {};
  const rows: Record<string, number | string>[] = [];

  let i = 0;
  for (const t of tsSorted) {
    i += 1;
    const row: Record<string, number | string> = { i, t };
    for (let j = 0; j < series.length; j++) {
      const s = series[j];
      const key = keys[j];
      const atOrBefore = [...s.points]
        .filter((p) => new Date(p.as_of).getTime() <= t)
        .sort((a, b) => new Date(a.as_of).getTime() - new Date(b.as_of).getTime())
        .pop();
      if (atOrBefore) lastKnown[key] = atOrBefore.total_equity;
      row[key] = lastKnown[key] ?? 0;
    }
    let sum = 0;
    for (const key of keys) {
      sum += Number(row[key]) || 0;
    }
    row.sum_equity = sum;
    rows.push(row);
  }

  return { rows, keys, labels };
}

const BOT_STROKE = ["#E5E7EB", "#C4C4C4", "#A3A3A3", "#9CA3AF", "#D4D4D4", "#B8B8B8", "#E8E8E8", "#F3F4F6"];

function formatAxisTime(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type LineInterpolation = "natural" | "linear" | "step";

type Props = {
  equityByBot: DashboardEquitySeries[];
  /** Pre-formatted headline metrics (equity is visually dominant in the chart header) */
  equityDisplay: string;
  returnDisplay: string;
  realizedDisplay: string;
  /** Optional horizontal reference: aggregate starting capital baseline ($) */
  baselineEquity?: number | null;
  /** Hide aggregate area fill (e.g. demo line-only portfolio view) */
  hideArea?: boolean;
  /** Override per-series line colors (same order as aligned series keys) */
  linePalette?: string[];
  /** Recharts line type: `linear` = jagged segments; `natural` = smooth curves */
  lineInterpolation?: LineInterpolation;
  /** Slightly larger headline metrics (dashboard demo) */
  largeHeader?: boolean;
  /** Hide Equity / Return / Realized headline row (chart only) */
  hideHeader?: boolean;
  /** Y-axis: `$120k` instead of `$120,000` */
  moneyFormat?: "default" | "compactK";
  /** With `hideHeader`, use a taller chart area (e.g. demo dashboard) */
  tallChart?: boolean;
  /** Y-axis as cumulative % return from first sample (per series). */
  yAxisMode?: "currency" | "percentReturn";
};

export function RunningProfitChart({
  equityByBot,
  equityDisplay,
  returnDisplay,
  realizedDisplay,
  baselineEquity,
  hideArea = false,
  linePalette,
  lineInterpolation = "natural",
  largeHeader = false,
  hideHeader = false,
  moneyFormat = "default",
  tallChart = false,
  yAxisMode = "currency",
}: Props) {
  const { rows, keys, labels } = useMemo(() => alignEquitySeriesForChart(equityByBot), [equityByBot]);

  const chartRows = useMemo(() => {
    if (yAxisMode !== "percentReturn" || rows.length === 0) return rows;
    const first = rows[0];
    return rows.map((row) => {
      const r = { ...row } as Record<string, number | string>;
      for (const key of keys) {
        const b = Number(first[key]);
        const v = Number(row[key]);
        r[key] = b > 0 ? ((v / b) - 1) * 100 : 0;
      }
      return r;
    });
  }, [yAxisMode, rows, keys]);

  const flatBaseline = useMemo(() => {
    const b = baselineEquity ?? 0;
    return b > 0 ? b : 10000;
  }, [baselineEquity]);

  const flatRows = useMemo(() => {
    const t0 = Date.now() - 7 * 86400000;
    const t1 = Date.now();
    return [
      { i: 0, t: t0, sum_equity: flatBaseline },
      { i: 1, t: t1, sum_equity: flatBaseline },
    ];
  }, [flatBaseline]);

  const showFlatOnly = rows.length === 0;

  const lastRow = rows.length ? rows[rows.length - 1] : null;
  const lastTs = lastRow && typeof lastRow.t === "number" ? (lastRow.t as number) : null;

  const singlePointValue =
    rows.length === 1 && keys.length
      ? Number(rows[0][keys[0]])
      : rows.length === 1
        ? Number(rows[0].sum_equity)
        : null;

  const hLabel = largeHeader ? "text-[11px] tracking-[0.18em]" : "text-[10px] tracking-[0.2em]";
  const hSub = largeHeader ? "text-[11px] tracking-[0.18em]" : "text-[10px] tracking-[0.18em]";
  const equitySize = largeHeader
    ? "text-[clamp(1.5rem,3.2vw,2.05rem)]"
    : "text-[clamp(1.35rem,3vw,1.85rem)]";
  const returnSize = equitySize;
  const metricSize = largeHeader ? "text-[15px]" : "text-[13px]";
  const lastTsSize = largeHeader ? "text-[11px]" : "text-[10px]";
  const chartMinH = largeHeader ? "min-h-[268px]" : "min-h-[240px]";
  const fmtMoney =
    yAxisMode === "percentReturn"
      ? (v: number) => `${v >= 0 ? "+" : ""}${Number(v).toFixed(0)}%`
      : moneyFormat === "compactK"
        ? formatUsdAxisK
        : (v: number) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const fmtTooltipValue = (v: number) =>
    yAxisMode === "percentReturn" ? `${v >= 0 ? "+" : ""}${Number(v).toFixed(1)}%` : moneyFormat === "compactK" ? formatUsdAxisK(v) : `$${Number(v).toFixed(2)}`;

  /** Recharts needs a non-zero height; flex-only min-height often collapses to 0. */
  const hideHeaderChartClass = tallChart
    ? "min-h-[min(24vh,220px)] flex-1 basis-0"
    : "h-[212px] shrink-0 lg:h-[220px]";

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col ${hideHeader ? "gap-0" : "gap-3"} ${hideHeader && tallChart ? "h-full min-h-0" : ""}`}
    >
      {!hideHeader ? (
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 px-0.5">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
            <div>
              <p className={`font-semibold uppercase ${hLabel} text-white/45`}>Equity</p>
              <p
                className={`mt-0.5 font-digits ${equitySize} font-semibold tabular-nums leading-none tracking-tight text-white`}
              >
                {equityDisplay}
              </p>
            </div>
            <div>
              <p className={`font-semibold uppercase ${hSub} text-white/45`}>Return</p>
              <p
                className={`mt-0.5 font-digits ${returnSize} font-semibold tabular-nums leading-none tracking-tight text-white/90`}
              >
                {returnDisplay}
              </p>
            </div>
            <div>
              <p className={`font-semibold uppercase ${hSub} text-white/45`}>Realized PnL</p>
              <p className={`mt-0.5 font-digits ${metricSize} font-medium tabular-nums text-white/90`}>{realizedDisplay}</p>
            </div>
          </div>
          {lastTs ? (
            <span className={`font-digits ${lastTsSize} text-white/45`}>Last · {formatAxisTime(lastTs)}</span>
          ) : null}
        </div>
      ) : null}
      <div
        className={`${
          hideHeader ? hideHeaderChartClass : `${chartMinH} flex-1`
        } w-full min-w-0 overflow-hidden rounded-md border border-white/[0.08] bg-black`}
      >
        {showFlatOnly ? (
          <div className="flex h-full min-h-[220px] flex-col">
            <p className="shrink-0 border-b border-white/[0.06] px-3 py-2 text-[10px] text-white/45">
              No equity history yet — showing start capital baseline
            </p>
            <div className="min-h-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={flatRows} margin={{ top: 14, right: 10, left: 4, bottom: 10 }}>
                  <CartesianGrid
                    strokeDasharray="4 8"
                    stroke={CHART_HORIZONTAL_GRID_STROKE}
                    vertical={false}
                    horizontal
                  />
                  <ReferenceLine
                    y={flatBaseline}
                    stroke="rgba(160,160,160,0.45)"
                    strokeDasharray="5 4"
                    strokeWidth={1}
                    label={{
                      value: "Start capital",
                      fill: "rgba(200,200,200,0.9)",
                      fontSize: 9,
                      position: "insideTopRight",
                    }}
                  />
                  <Line
                    type="linear"
                    dataKey="sum_equity"
                    name="Equity"
                    stroke="rgba(229,231,235,0.85)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tick={{ fill: "#d4d4d4", fontSize: 9 }}
                    axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
                    tickLine={{ stroke: "rgba(255,255,255,0.08)" }}
                    minTickGap={28}
                    tickFormatter={(v) => (typeof v === "number" ? formatAxisTime(v) : String(v))}
                  />
                  <YAxis
                    tick={{ fill: "#d4d4d4", fontSize: 9 }}
                    axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
                    tickLine={{ stroke: "rgba(255,255,255,0.08)" }}
                    width={56}
                    domain={[flatBaseline * 0.995, flatBaseline * 1.005]}
                    tickFormatter={(v) => fmtMoney(Number(v))}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : rows.length === 1 ? (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-4 px-4">
            <div className="flex h-24 w-full max-w-md items-end justify-center gap-2 border-b border-white/[0.1] pb-2">
              <div
                className="w-2 rounded-t bg-gradient-to-t from-white/40 to-white/80"
                style={{ height: "72%" }}
                aria-hidden
              />
            </div>
            <div className="text-center">
              <p className="font-digits text-[22px] font-semibold tabular-nums text-white">
                {singlePointValue != null && !Number.isNaN(singlePointValue)
                  ? `$${singlePointValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : "—"}
              </p>
              <p className="mt-1 text-[11px] text-white/70">Single snapshot — curve appears after more samples.</p>
              {lastTs ? (
                <p className="mt-0.5 font-digits text-[10px] text-white/80">{formatAxisTime(lastTs)}</p>
              ) : null}
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartRows} margin={{ top: 14, right: 10, left: 4, bottom: 10 }}>
              <defs>
                <linearGradient id="equityAreaFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#E5E7EB" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#E5E7EB" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="4 8"
                stroke={CHART_HORIZONTAL_GRID_STROKE}
                vertical={false}
                horizontal
              />
              {yAxisMode === "percentReturn" ? (
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.14)" strokeDasharray="4 4" strokeWidth={1} />
              ) : baselineEquity != null && baselineEquity > 0 ? (
                <ReferenceLine
                  y={baselineEquity}
                  stroke="rgba(160,160,160,0.45)"
                  strokeDasharray="5 4"
                  strokeWidth={1}
                  label={{
                    value: "Start capital",
                    fill: "rgba(200,200,200,0.9)",
                    fontSize: 9,
                    position: "insideTopRight",
                  }}
                />
              ) : null}
              {!hideArea ? (
                <Area
                  type="natural"
                  dataKey="sum_equity"
                  stroke="none"
                  fill="url(#equityAreaFill)"
                  isAnimationActive={false}
                  connectNulls
                />
              ) : null}
              {keys.map((key, idx) => (
                <Line
                  key={key}
                  type={lineInterpolation}
                  dataKey={key}
                  name={labels[idx] ?? key}
                  stroke={linePalette?.[idx] ?? BOT_STROKE[idx % BOT_STROKE.length]}
                  strokeWidth={hideArea ? 1.85 : 2}
                  strokeOpacity={0.98}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tick={{
                  fill: "#d4d4d4",
                  fontSize: largeHeader ? 10 : 9,
                  fontFamily: "'Outfit', 'Inter', system-ui, sans-serif",
                }}
                axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
                tickLine={{ stroke: "rgba(255,255,255,0.08)" }}
                minTickGap={28}
                tickFormatter={(v) => (typeof v === "number" ? formatAxisTime(v) : String(v))}
              />
              <YAxis
                tick={{
                  fill: "#d4d4d4",
                  fontSize: largeHeader ? 10 : 9,
                  fontFamily: "'Outfit', 'Inter', system-ui, sans-serif",
                }}
                axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
                tickLine={{ stroke: "rgba(255,255,255,0.08)" }}
                width={yAxisMode === "percentReturn" ? 52 : largeHeader ? 60 : 56}
                tickFormatter={(v) => fmtMoney(Number(v))}
                domain={["auto", "auto"]}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as { t?: number } | undefined;
                  const timeLabel =
                    row?.t != null
                      ? new Date(row.t).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : String(label ?? "");
                  const lines = payload.filter((p) => p.dataKey !== "sum_equity" && p.name !== "sum_equity");
                  return (
                    <div
                      className="rounded-md border border-white/20 px-3 py-2 text-[11px] shadow-xl"
                      style={{
                        backgroundColor: "rgba(0,0,0,0.96)",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                      }}
                    >
                      <p className="mb-1.5 text-[10px] text-white/80">{timeLabel}</p>
                      <ul className="space-y-1">
                        {lines.map((p) => (
                          <li key={String(p.dataKey)} className="flex justify-between gap-4 font-digits">
                            <span className="text-neutral-200">{p.name}</span>
                            <span className="text-white">{fmtTooltipValue(Number(p.value))}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
