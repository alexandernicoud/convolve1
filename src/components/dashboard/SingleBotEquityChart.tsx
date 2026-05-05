import { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BotEquityPoint } from "@/lib/api";

type Row = { i: number; t: number; equity: number };

type Props = {
  points: BotEquityPoint[];
  title?: string;
};

export function SingleBotEquityChart({ points, title = "Equity" }: Props) {
  const rows = useMemo(() => {
    return points.map((p, idx) => ({
      i: idx + 1,
      t: new Date(p.as_of).getTime(),
      equity: p.total_equity,
    })) as Row[];
  }, [points]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <h3 className="font-sans text-[13px] font-semibold tracking-wide text-white">{title}</h3>
      <div className="min-h-[200px] w-full flex-1 rounded border border-white/[0.07] bg-[#0a0a0a]/80">
        {rows.length === 0 ? (
          <div className="flex h-full min-h-[160px] items-center justify-center text-[13px] text-neutral-300">
            No equity snapshots yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 10, right: 10, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.07)" vertical horizontal />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 3" strokeWidth={1} />
              <Line
                type="linear"
                dataKey="equity"
                name="Equity"
                stroke="#E5E7EB"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
              <XAxis
                dataKey="i"
                tick={{ fill: "#D1D5DB", fontSize: 9 }}
                axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
                tickLine={{ stroke: "rgba(255,255,255,0.1)" }}
                minTickGap={8}
              />
              <YAxis
                tick={{ fill: "#D1D5DB", fontSize: 9 }}
                axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
                tickLine={{ stroke: "rgba(255,255,255,0.1)" }}
                width={52}
                tickFormatter={(v) => Number(v).toFixed(0)}
                domain={["auto", "auto"]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "rgba(8,10,16,0.98)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "4px",
                  fontSize: 11,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                }}
                labelStyle={{ color: "#D1D5DB", fontSize: 10 }}
                formatter={(value: number) => [`$${Number(value).toFixed(2)}`, "Equity"]}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as Row | undefined;
                  if (row?.t) {
                    return new Date(row.t).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                  }
                  return "";
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
