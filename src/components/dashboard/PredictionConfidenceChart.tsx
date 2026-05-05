import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardActivityItem } from "@/lib/api";

function formatAxisTime(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Row = { t: number; conf: number; symbol: string; title: string };

/**
 * Model signal confidence over time from the activity feed (prediction events).
 * Complements account equity — focuses on model behaviour, not P&amp;L.
 */
export function PredictionConfidenceChart({ feed }: { feed: DashboardActivityItem[] | undefined }) {
  const rows = useMemo(() => {
    if (!feed?.length) return [];
    const out: Row[] = [];
    for (const item of feed) {
      if (item.kind !== "prediction") continue;
      if (item.confidence == null || Number.isNaN(item.confidence)) continue;
      out.push({
        t: new Date(item.at).getTime(),
        conf: Math.round(item.confidence * 1000) / 10,
        symbol: item.symbol,
        title: item.title,
      });
    }
    return out.sort((a, b) => a.t - b.t);
  }, [feed]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-2 px-0.5">
        <div>
          <h2 className="font-sans text-[14px] font-semibold tracking-wide text-white">Signal confidence</h2>
          <p className="mt-0.5 text-[10px] leading-snug text-white/50">
            Prediction confidence over time (when events are logged).
          </p>
        </div>
      </div>
      <div className="min-h-[180px] w-full flex-1 overflow-hidden rounded-md border border-white/[0.1] bg-black">
        {rows.length < 2 ? (
          <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-1 px-4 text-center">
            <p className="text-[12px] font-medium text-white/80">Not enough prediction history</p>
            <p className="max-w-xs text-[10px] leading-relaxed text-white/45">
              As bots emit predictions, confidence traces appear here — separate from equity.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 10, right: 8, left: 4, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.06)" vertical horizontal />
              <ReferenceLine y={50} stroke="rgba(255,255,255,0.12)" strokeDasharray="4 4" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tick={{
                  fill: "#a3a3a3",
                  fontSize: 9,
                  fontFamily: "'Outfit', 'Inter', system-ui, sans-serif",
                }}
                axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                tickLine={{ stroke: "rgba(255,255,255,0.06)" }}
                minTickGap={28}
                tickFormatter={(v) => (typeof v === "number" ? formatAxisTime(v) : String(v))}
              />
              <YAxis
                domain={[0, 100]}
                tick={{
                  fill: "#a3a3a3",
                  fontSize: 9,
                  fontFamily: "'Outfit', 'Inter', system-ui, sans-serif",
                }}
                axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                tickLine={{ stroke: "rgba(255,255,255,0.06)" }}
                width={36}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as Row | undefined;
                  if (!row) return null;
                  return (
                    <div
                      className="rounded-md border border-white/20 px-2.5 py-2 text-[11px] shadow-xl"
                      style={{ backgroundColor: "rgba(0,0,0,0.96)" }}
                    >
                      <p className="mb-1 font-digits text-[10px] text-white/70">{formatAxisTime(row.t)}</p>
                      <p className="font-digits font-semibold text-white">{row.symbol}</p>
                      <p className="mt-0.5 text-white/85">{row.title}</p>
                      <p className="mt-1 font-digits tabular-nums text-white/90">Confidence {row.conf.toFixed(1)}%</p>
                    </div>
                  );
                }}
              />
              <Line
                type="natural"
                dataKey="conf"
                stroke="#d4d4d4"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
