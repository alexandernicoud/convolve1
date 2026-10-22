import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReviewEquityPoint, ReviewHistoryPoint } from "@/lib/api";
import { TrainingCurves as SharedTrainingCurves, type EpochRow } from "@/components/viz/TrainingCurves";
import { axisLabel, axisProps, ChartTooltip, gridProps, SeriesLegend, type LegendItem } from "@/components/viz/chartKit";
import { SERIES_ORDER, VIZ } from "@/lib/viz/tokens";
import { fmtNum, isFiniteNum } from "@/lib/viz/format";

/** Learning curves in the inspector: the same component as the training session, stacked. */
export function TrainingCurves({ history, bestEpoch }: { history: ReviewHistoryPoint[]; bestEpoch?: number | null }) {
  const rows: EpochRow[] = history
    .filter((p) => isFiniteNum(p.epoch))
    .map((p) => ({
      epoch: p.epoch as number,
      loss: p.loss ?? null,
      accuracy: p.accuracy ?? null,
      val_loss: p.val_loss ?? null,
      val_accuracy: p.val_accuracy ?? null,
    }));
  return <SharedTrainingCurves history={rows} bestEpoch={bestEpoch ?? null} compact height={170} metrics={["accuracy", "loss"]} />;
}

function seriesStyle(i: number) {
  const s = SERIES_ORDER[i % SERIES_ORDER.length];
  return { stroke: s.color, strokeDasharray: s.dash, strokeWidth: i === 0 ? VIZ.stroke.primary : VIZ.stroke.secondary };
}

function legendFor(names: string[]): LegendItem[] {
  return names.map((label, i) => ({ label, color: SERIES_ORDER[i % SERIES_ORDER.length].color, dash: SERIES_ORDER[i % SERIES_ORDER.length].dash }));
}

export function EquityChart({ points, symbol, spy }: { points: ReviewEquityPoint[]; symbol?: string; spy?: string }) {
  const indexed = points.some((p) => isFiniteNum(p.strategy_indexed));
  const series = indexed
    ? [
        { key: "strategy_indexed", name: "Strategy (net)" },
        { key: "underlying_indexed", name: symbol ? `${symbol} buy & hold` : "Underlying" },
        { key: "spy_indexed", name: spy || "SPY" },
      ].filter((s) => points.some((p) => isFiniteNum(p[s.key as keyof ReviewEquityPoint])))
    : [{ key: "equity", name: "Equity (net)" }];
  return (
    <div className="space-y-2">
      <SeriesLegend items={legendFor(series.map((s) => s.name))} />
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="as_of_date" {...axisProps} minTickGap={40} tickFormatter={(v: string) => String(v ?? "").slice(0, 7)} />
            <YAxis {...axisProps} domain={["auto", "auto"]} width={50} tickFormatter={(v: number) => String(Number(v.toFixed(2)))} />
            <Tooltip content={<ChartTooltip format={(v) => fmtNum(v, 2)} />} cursor={{ stroke: VIZ.axisLine }} />
            {series.map((s, i) => (
              <Line key={s.key} type="linear" dataKey={s.key} name={s.name} {...seriesStyle(i)} dot={false} isAnimationActive={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {indexed ? <p className="text-[12px] text-white/40">Indexed: 100 = value at the start of the test (strategy: starting capital).</p> : null}
    </div>
  );
}

/** Several series on a shared x-axis (epoch or step). */
export function OverlayChart({
  series,
  xLabel,
  fmt,
  height = 200,
}: {
  series: { name: string; points: { x: number | string; y: number | null | undefined }[] }[];
  xLabel: string;
  fmt?: (v: number) => string;
  height?: number;
}) {
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))];
  const rows = xs.map((x) => {
    const row: Record<string, number | string | null> = { x };
    series.forEach((s, i) => {
      const p = s.points.find((q) => q.x === x);
      row[`s${i}`] = p && isFiniteNum(p.y) ? p.y : null;
    });
    return row;
  });
  return (
    <div className="space-y-2">
      <SeriesLegend items={legendFor(series.map((s) => s.name))} />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 6, bottom: 14, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="x" {...axisProps} minTickGap={30} label={axisLabel(xLabel, "x")} />
            <YAxis {...axisProps} tickFormatter={fmt} domain={["auto", "auto"]} width={48} />
            <Tooltip
              content={<ChartTooltip labelFormat={(l) => `${xLabel} ${String(l)}`} format={(v) => (isFiniteNum(v) ? (fmt ? fmt(v) : v.toFixed(3)) : "—")} />}
              cursor={{ stroke: VIZ.axisLine }}
            />
            {series.map((s, i) => (
              <Line key={i} type="linear" dataKey={`s${i}`} name={s.name} {...seriesStyle(i)} dot={false} isAnimationActive={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
