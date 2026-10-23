import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, gridProps } from "@/components/viz/chartKit";
import { SEMANTIC } from "@/lib/viz/tokens";
import type { FleetPayload } from "../api";
import { ACCENT, contributionRows, decomposition, fmtMoney, FRAME_DOMAIN, FRAME_TICKS, type ContributionRow, type DecompRow } from "../lib";
import { BASELINE_STROKE, FrameNote, Panel, TipRow, TooltipBox, useElementSize } from "../ui";

const EMPTY_ROWS = [{ label: "", realized: null }];

const REALIZED = ACCENT;
const UNREALIZED = "rgba(143,179,224,0.42)";

function ContribTip({ active, payload, ccy }: { active?: boolean; payload?: { payload: ContributionRow }[]; ccy: string | null }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <TooltipBox>
      <p className="mb-1 text-white/50">{r.label}</p>
      <TipRow label="Net P&L change" value={fmtMoney(r.pnl, ccy, { signed: true })} />
      <TipRow label="Realized" value={fmtMoney(r.realized, ccy, { signed: true })} color={REALIZED} />
      <TipRow label="Unrealized Δ" value={fmtMoney(r.unrealized, ccy, { signed: true })} color={UNREALIZED} />
    </TooltipBox>
  );
}

function DecompTip({ active, payload, ccy }: { active?: boolean; payload?: { payload: DecompRow }[]; ccy: string | null }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <TooltipBox>
      <TipRow label={r.label} value={fmtMoney(r.value, ccy, { signed: true })} />
    </TooltipBox>
  );
}

const yTick = { ...axisProps.tick, fontSize: 11 };

export function ContributionPanel({ p, hovered, onHover }: { p: FleetPayload; hovered: string | null; onHover: (id: string | null) => void }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const ccy = p.currency.base;
  const included = p.bots.filter((b) => b.in_aggregate);
  const single = included.length === 1;
  const maxRows = Math.max(2, Math.floor((size.height - 20) / 18));

  if (single) {
    const b = included[0];
    const rows = decomposition(b);
    return (
      <Panel id="contribution" title={`P&L breakdown · ${b.symbol}`} aside={<span className="text-[10.5px] text-white/35">since deployment</span>} bodyClassName="flex flex-col">
        <div ref={ref} className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 2, right: 10, bottom: 0, left: 0 }} barCategoryGap="22%">
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis type="number" {...axisProps} height={16} tickCount={4} tickFormatter={(v: number) => fmtMoney(v, ccy, { compact: true, digits: Math.abs(v) < 10 ? 1 : 0, signed: true })} />
              <YAxis type="category" dataKey="label" {...axisProps} tick={yTick} width={112} interval={0} />
              <ReferenceLine x={0} stroke="rgba(255,255,255,0.25)" />
              <Bar dataKey="value" isAnimationActive={false}>
                {rows.map((r) => (
                  <Cell key={r.key} fill={r.value >= 0 ? SEMANTIC.positive : SEMANTIC.negative} fillOpacity={r.kind === "total" ? 0.95 : 0.55} />
                ))}
              </Bar>
              <Tooltip content={<DecompTip ccy={ccy} />} cursor={{ fill: "rgba(255,255,255,0.05)" }} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    );
  }

  const rows = contributionRows(p, maxRows);
  return (
    <Panel
      id="contribution"
      title="Contribution"
      aside={
        <span className="flex items-center gap-2 text-[10.5px] text-white/40">
          {rows.length ? (
            <>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: REALIZED }} />realized</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: UNREALIZED }} />unrealized Δ</span>
            </>
          ) : null}
          <span className="text-white/30">{rows.length ? "· " : ""}{p.range}</span>
        </span>
      }
      bodyClassName="flex flex-col"
    >
      <div ref={ref} className="relative min-h-0 flex-1">
        {!rows.length ? (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={EMPTY_ROWS} layout="vertical" margin={{ top: 2, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} horizontal={false} vertical />
                <XAxis type="number" {...axisProps} height={16} domain={FRAME_DOMAIN} ticks={FRAME_TICKS} allowDataOverflow tickFormatter={(v: number) => (v === 0 ? fmtMoney(0, ccy, { digits: 0 }) : "")} />
                <YAxis type="category" dataKey="label" {...axisProps} tick={false} width={74} />
                <ReferenceLine x={0} stroke={BASELINE_STROKE} strokeDasharray="5 4" />
                <Bar dataKey="realized" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
            <FrameNote title={p.bots.length ? "No bots in fleet totals" : "No bot contributions"} sub="Realized + unrealized P&L by bot" />
          </>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              layout="vertical"
              stackOffset="sign"
              margin={{ top: 2, right: 10, bottom: 0, left: 0 }}
              barCategoryGap="20%"
              onMouseMove={(s) => {
                const i = typeof s?.activeTooltipIndex === "number" ? s.activeTooltipIndex : Number(s?.activeTooltipIndex);
                const id = Number.isFinite(i) ? rows[i]?.id : undefined;
                onHover(id && id !== "__others" ? id : null);
              }}
              onMouseLeave={() => onHover(null)}
            >
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis type="number" {...axisProps} height={16} tickCount={4} tickFormatter={(v: number) => fmtMoney(v, ccy, { compact: true, digits: Math.abs(v) < 10 ? 1 : 0, signed: true })} />
              <YAxis type="category" dataKey="label" {...axisProps} tick={yTick} width={74} interval={0} />
              <ReferenceLine x={0} stroke="rgba(255,255,255,0.25)" />
              <Bar dataKey="realized" stackId="c" fill={REALIZED} isAnimationActive={false}>
                {rows.map((r) => <Cell key={r.id} fillOpacity={hovered && hovered !== r.id ? 0.35 : 1} />)}
              </Bar>
              <Bar dataKey="unrealized" stackId="c" fill={UNREALIZED} isAnimationActive={false}>
                {rows.map((r) => <Cell key={r.id} fillOpacity={hovered && hovered !== r.id ? 0.35 : 1} />)}
              </Bar>
              <Tooltip content={<ContribTip ccy={ccy} />} cursor={{ fill: "rgba(255,255,255,0.05)" }} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  );
}
