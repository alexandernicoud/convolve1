import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FLEET_LINE_COLORS } from "@/components/dashboard/fleetPalette";
import { axisProps, gridProps } from "@/components/viz/chartKit";
import type { FleetPayload } from "../api";
import { ACCENT, fmtDateTime, fmtMoney, fmtPct, isNum, ms, tickLabel, timeTicks } from "../lib";
import { BASELINE_STROKE, FrameNote, Panel, TipRow, TooltipBox, Unavailable, useElementSize } from "../ui";

function Tip({ active, payload }: { active?: boolean; payload?: { payload: { t: number; exposure: number | null } }[] }) {
  if (!active || !payload?.length || payload[0].payload.exposure == null) return null;
  return (
    <TooltipBox>
      <p className="mb-1 text-white/50">{fmtDateTime(payload[0].payload.t)}</p>
      <TipRow label="Gross exposure" value={fmtPct(payload[0].payload.exposure, 1, false)} color={ACCENT} />
    </TooltipBox>
  );
}

export function ExposurePanel({ p, hovered }: { p: FleetPayload; hovered: string | null }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const ccy = p.currency.base;
  const k = p.kpis;
  const included = p.bots.filter((b) => b.in_aggregate);
  const equity = isNum(k.equity) ? k.equity : null;
  const open = k.gross_exposure?.open_notional ?? 0;
  const rows = useMemo(() => (p.series.t ?? []).map((t, i) => ({ t: ms(t) ?? 0, exposure: p.series.exposure?.[i] ?? null })), [p.series]);
  const start = ms(p.window.start) ?? rows[0]?.t ?? 0;
  const end = ms(p.window.end) ?? rows[rows.length - 1]?.t ?? 0;
  const { ticks, step } = useMemo(() => timeTicks(start, end, Math.max(120, size.width - 50), 56), [start, end, size.width]);
  const hasExposure = rows.some((r) => r.exposure != null);
  const total = included.reduce((a, b) => a + Math.max(0, b.equity), 0);

  return (
    <Panel id="exposure" title="Capital & exposure" bodyClassName="flex flex-col gap-1">
      {equity == null ? (
        <Unavailable>{k.unavailable ?? "No capital in fleet totals."}</Unavailable>
      ) : (
        <>
          <div className="flex shrink-0 items-baseline justify-between gap-2 text-[11px] text-white/45">
            <span>
              In positions <span className="font-digits tabular-nums text-white">{fmtMoney(open, ccy, { compact: true })}</span>
            </span>
            <span>
              Cash <span className="font-digits tabular-nums text-white">{fmtMoney(equity - open, ccy, { compact: true })}</span>
            </span>
            <span className="font-digits tabular-nums text-white">{fmtPct(k.gross_exposure?.value, 1, false)}</span>
          </div>
          <div className={`flex h-[8px] shrink-0 overflow-hidden rounded-sm ${total > 0 ? "bg-white/[0.05]" : "border border-dashed border-white/[0.14]"}`} title={total > 0 ? "Equity share per bot" : "No capital allocated to bots"}>
            {total > 0
              ? included.map((b, i) => (
                  <div
                    key={b.id}
                    title={`${b.symbol}: ${fmtMoney(b.equity, ccy)} (${fmtPct(b.equity / total, 0, false)})`}
                    style={{ width: `${(Math.max(0, b.equity) / total) * 100}%`, background: FLEET_LINE_COLORS[i % FLEET_LINE_COLORS.length], opacity: hovered && hovered !== b.id ? 0.25 : 0.8 }}
                    className="h-full border-r border-black/60 last:border-r-0"
                  />
                ))
              : null}
          </div>
          <div ref={ref} className="relative min-h-0 flex-1">
            {!hasExposure ? (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={[{ t: start }, { t: end }]} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="t" type="number" scale="time" domain={[start, end]} ticks={ticks} tickFormatter={(t: number) => tickLabel(t, step)} {...axisProps} height={16} />
                    <YAxis {...axisProps} width={40} domain={[0, 1]} ticks={[0, 0.5, 1]} allowDataOverflow tickFormatter={(v: number) => fmtPct(v, 0, false)} />
                    <ReferenceLine y={0} stroke={BASELINE_STROKE} strokeDasharray="5 4" />
                  </AreaChart>
                </ResponsiveContainer>
                <FrameNote
                  title={included.length ? "No exposure history in this window" : "Exposure history unavailable"}
                  sub={`${fmtPct(k.gross_exposure?.value, 1, false)} now · ${k.gross_exposure?.open_positions ?? 0} open positions`}
                />
              </>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="t" type="number" scale="time" domain={[start, end]} ticks={ticks} tickFormatter={(t: number) => tickLabel(t, step)} {...axisProps} height={16} />
                  <YAxis {...axisProps} width={40} domain={[0, (max: number) => Math.max(0.05, Math.min(1, max * 1.15))]} tickCount={3} tickFormatter={(v: number) => fmtPct(v, 0, false)} />
                  <Area dataKey="exposure" type="stepAfter" stroke={ACCENT} strokeWidth={1.2} fill={ACCENT} fillOpacity={0.14} isAnimationActive={false} connectNulls={false} />
                  <Tooltip content={<Tip />} cursor={{ stroke: "rgba(255,255,255,0.3)" }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}
