import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, gridProps } from "@/components/viz/chartKit";
import { SEMANTIC } from "@/lib/viz/tokens";
import type { FleetPayload } from "../api";
import { dailyRows, emptyDailyRows, fmtMoney, FRAME_DOMAIN, FRAME_TICKS, isInactive, isNum, type DailyRow } from "../lib";
import { BASELINE_STROKE, FrameNote, Panel, TipRow, TooltipBox, useElementSize } from "../ui";

function Tip({ active, payload, ccy }: { active?: boolean; payload?: { payload: DailyRow & { bar: number | null } }[]; ccy: string | null }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <TooltipBox>
      <p className="mb-1 text-white/50">{d.label} (UTC){d.complete ? "" : " · in progress"}</p>
      <TipRow label="Net P&L" value={isNum(d.pnl) ? fmtMoney(d.pnl, ccy, { signed: true }) : "no valuations"} />
      <TipRow label="Realized (closes)" value={fmtMoney(d.realized, ccy, { signed: true })} />
      {d.flows ? <TipRow label="Deposits (not P&L)" value={fmtMoney(d.flows, ccy)} /> : null}
      <TipRow label="Valuations" value={d.observations} />
    </TooltipBox>
  );
}

export function DailyPnlPanel({ p }: { p: FleetPayload }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const ccy = p.currency.base;
  const maxBars = Math.max(5, Math.floor((size.width - 56) / 13));
  const real = dailyRows(p, maxBars);
  const hasAny = real.some((r) => r.pnl != null);
  const rows = (hasAny ? real : emptyDailyRows(p.as_of, Math.min(maxBars, 14))).map((d) => ({ ...d, bar: d.pnl }));
  const missing = hasAny ? rows.filter((r) => r.pnl == null).length : 0;
  const zero = fmtMoney(0, ccy, { digits: 0 });
  return (
    <Panel id="daily" title="Daily net P&L" aside={<span className="text-[10.5px] text-white/35">UTC days{missing ? ` · ${missing} without valuations` : ""}</span>} bodyClassName="flex flex-col">
      <div ref={ref} className="relative min-h-0 flex-1">
        {!hasAny ? (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="18%">
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={18} height={18} />
                <YAxis {...axisProps} width={52} domain={FRAME_DOMAIN} ticks={FRAME_TICKS} allowDataOverflow tickFormatter={(v: number) => (v === 0 ? zero : "")} />
                <ReferenceLine y={0} stroke={BASELINE_STROKE} strokeDasharray="5 4" />
                <Bar dataKey="bar" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
            <FrameNote className="bottom-auto top-[10%]" title={isInactive(p) ? "No daily observations" : "No daily valuations yet"} sub="One bar per UTC day after the first valuation" />
          </>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="18%">
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={18} height={18} />
              <YAxis {...axisProps} width={52} tickCount={4} tickFormatter={(v: number) => fmtMoney(v, ccy, { compact: true, digits: Math.abs(v) < 10 ? 1 : 0, signed: true })} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.22)" />
              <Bar dataKey="bar" isAnimationActive={false} minPointSize={0}>
                {rows.map((r) => (
                  <Cell key={r.date} fill={(r.pnl ?? 0) >= 0 ? SEMANTIC.positive : SEMANTIC.negative} fillOpacity={r.complete ? 0.85 : 0.4} />
                ))}
              </Bar>
              <Tooltip content={<Tip ccy={ccy} />} cursor={{ fill: "rgba(255,255,255,0.05)" }} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  );
}
