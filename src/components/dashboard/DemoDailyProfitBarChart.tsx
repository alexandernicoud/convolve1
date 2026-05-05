import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_HORIZONTAL_GRID_STROKE } from "@/components/dashboard/chartGrid";
import { DEMO_ACCENT, DEMO_PORTFOLIO } from "@/components/dashboard/demoPortfolioPalette";
import { formatUsdAxisK } from "@/components/dashboard/compactMoneyFormat";

function fract(i: number, s: number) {
  const raw = i * 9301 + 49297 + s * 104729;
  const x = ((raw % 233280) + 233280) % 233280;
  return x / 233280;
}

const BAR_ABOVE = DEMO_ACCENT.barUp;
const BAR_BELOW = DEMO_ACCENT.barDown;
const SMA_STROKE = DEMO_PORTFOLIO.tertiary;

export type DailyProfitRow = {
  day: string;
  profit: number;
  sma: number;
};

function buildDailyProfitData(): DailyProfitRow[] {
  const n = 45;
  const rows: { day: string; profit: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 0 : i / (n - 1);
    /** Crosses zero often (win/loss alternation) with mild net drift upward by end. */
    const oscillate =
      Math.sin(i * 0.75) * 2_400 +
      Math.cos(i * 0.33) * 1_500 +
      Math.sin(i * 2.1) * 900 +
      (fract(i, 11) - 0.5) * 1_100;
    const drift = -1_100 + t * 5_200;
    const profit = oscillate + drift;
    rows.push({
      day: String(i + 1).padStart(2, "0"),
      profit: Number(profit.toFixed(0)),
    });
  }

  const out: DailyProfitRow[] = rows.map((r, i) => {
    const from = Math.max(0, i - 4);
    const slice = rows.slice(from, i + 1);
    const sma = slice.reduce((s, x) => s + x.profit, 0) / slice.length;
    return { ...r, sma: Number(sma.toFixed(0)) };
  });
  return out;
}

/**
 * Demo-only: daily P&amp;L bars + SMA line — greyscale palette matches portfolio equity.
 */
export function DemoDailyProfitBarChart() {
  const data = useMemo(() => buildDailyProfitData(), []);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-1">
      <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.2em] text-white">
        Profit per day
      </p>
      <p className="shrink-0 text-[10px] leading-snug text-white/35">
        Light bars = day profit, dim bars = loss. Line = SMA(5).
      </p>
      <div className="w-full min-h-[132px] flex-1 overflow-hidden rounded-md border border-white/[0.1] bg-black/40">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid
              strokeDasharray="3 6"
              stroke={CHART_HORIZONTAL_GRID_STROKE}
              vertical={false}
              horizontal
            />
            <XAxis
              dataKey="day"
              tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 8 }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tickLine={false}
              interval={4}
              minTickGap={2}
            />
            <YAxis
              width={44}
              tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => {
                const k = formatUsdAxisK(Number(v));
                return `${Number(v) >= 0 ? "+" : ""}${k}`;
              }}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as DailyProfitRow;
                return (
                  <div className="rounded-md border border-white/15 bg-black/95 px-2.5 py-2 text-[10px] shadow-lg">
                    <p className="font-digits text-white/75">Day {row.day}</p>
                    <p className="font-digits mt-1 tabular-nums text-white">
                      Day: {row.profit >= 0 ? "+" : ""}
                      {formatUsdAxisK(row.profit)} · SMA: {row.sma >= 0 ? "+" : ""}
                      {formatUsdAxisK(row.sma)}
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="profit" maxBarSize={12} radius={[4, 4, 4, 4]} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.profit >= 0 ? BAR_ABOVE : BAR_BELOW} />
              ))}
            </Bar>
            <Line
              type="natural"
              dataKey="sma"
              stroke={SMA_STROKE}
              strokeWidth={2.25}
              dot={false}
              isAnimationActive={false}
              name="SMA(5)"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
