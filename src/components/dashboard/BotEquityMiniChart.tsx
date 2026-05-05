import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BotEquityPoint } from "@/lib/api";
import { CHART_HORIZONTAL_GRID_STROKE } from "@/components/dashboard/chartGrid";
import { formatUsdAxisK } from "@/components/dashboard/compactMoneyFormat";

function formatTickTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric" });
}

type Row = { t: number; v: number; as_of: string; trend?: number };

function addLinearTrend(rows: { t: number; v: number; as_of: string }[]): Row[] {
  if (rows.length < 2) return rows.map((r) => ({ ...r }));
  const n = rows.length;
  let sumT = 0;
  let sumV = 0;
  for (const r of rows) {
    sumT += r.t;
    sumV += r.v;
  }
  const meanT = sumT / n;
  const meanV = sumV / n;
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const dt = r.t - meanT;
    num += dt * (r.v - meanV);
    den += dt * dt;
  }
  const b = den === 0 ? 0 : num / den;
  const a = meanV - b * meanT;
  return rows.map((r) => ({ ...r, trend: a + b * r.t }));
}

type Props = {
  points: BotEquityPoint[] | undefined;
  /**
   * Top bot (Charlie) demo: taller chart, blue equity line, white dotted least-squares trend,
   * jagged (linear) interpolation — reads like a busy tape.
   */
  demoCharlie?: boolean;
};

export function BotEquityMiniChart({ points, demoCharlie = false }: Props) {
  const rows = useMemo(() => {
    const list = points ?? [];
    if (!list.length) return [];
    return list.map((p) => ({
      t: new Date(p.as_of).getTime(),
      v: p.total_equity,
      as_of: p.as_of,
    }));
  }, [points]);

  const rowsWithTrend = useMemo(() => (demoCharlie ? addLinearTrend(rows) : rows.map((r) => ({ ...r }))), [
    rows,
    demoCharlie,
  ]);

  const hEmpty = demoCharlie ? 132 : 100;
  const hChart = demoCharlie ? "min-h-[148px] h-[152px]" : "h-[100px]";

  if (rows.length < 2) {
    return (
      <div
        className="flex w-full items-center justify-center rounded-md border border-white/[0.08] bg-black/40"
        style={{ minHeight: hEmpty }}
      >
        <p className="text-[11px] text-white/45">No equity curve yet</p>
      </div>
    );
  }

  const tickFs = demoCharlie ? 11 : 9;
  const mainStroke = demoCharlie ? "#E8E8E8" : "#e5e5e5";
  const mainWidth = demoCharlie ? 2.1 : 1.75;

  return (
    <div className={`${hChart} w-full min-h-0 overflow-hidden rounded-md border border-white/[0.08] bg-black/50`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rowsWithTrend} margin={{ top: 14, right: 8, left: 0, bottom: 6 }}>
          <CartesianGrid
            strokeDasharray="3 6"
            stroke={CHART_HORIZONTAL_GRID_STROKE}
            vertical={false}
            horizontal
          />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={{
              fill: "rgba(255,255,255,0.45)",
              fontSize: tickFs,
              fontFamily: "'Outfit', 'Inter', system-ui, sans-serif",
            }}
            axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
            tickLine={false}
            minTickGap={32}
            tickFormatter={(v) => (typeof v === "number" ? formatTickTime(new Date(v).toISOString()) : "")}
          />
          <YAxis
            width={demoCharlie ? 50 : 44}
            tick={{
              fill: "rgba(255,255,255,0.45)",
              fontSize: tickFs,
              fontFamily: "'Outfit', 'Inter', system-ui, sans-serif",
            }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) =>
              demoCharlie
                ? formatUsdAxisK(Number(v))
                : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
            }
            domain={["auto", "auto"]}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = (payload.find((p) => p.dataKey === "v")?.payload ?? payload[0]?.payload) as Row | undefined;
              if (!row) return null;
              return (
                <div className="rounded border border-white/15 bg-black/95 px-2 py-1.5 text-[11px] shadow-lg">
                  <p className="font-digits text-white/80">{new Date(row.as_of).toLocaleString()}</p>
                  <p className="font-digits tabular-nums text-white">
                    {demoCharlie
                      ? formatUsdAxisK(row.v)
                      : `$${row.v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </p>
                </div>
              );
            }}
          />
          {demoCharlie ? (
            <Line
              type="linear"
              dataKey="trend"
              stroke="#B0B0B0"
              strokeOpacity={0.92}
              strokeWidth={1.35}
              strokeDasharray="5 5"
              dot={false}
              isAnimationActive={false}
              name="Trend"
              activeDot={false}
            />
          ) : null}
          <Line
            type={demoCharlie ? "linear" : "natural"}
            dataKey="v"
            stroke={mainStroke}
            strokeWidth={mainWidth}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
