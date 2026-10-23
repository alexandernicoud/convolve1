import { useState } from "react";
import { SEMANTIC } from "@/lib/viz/tokens";
import type { FleetPayload } from "../api";
import { ACCENT, fleetLane, fmtClock, fmtMoney, laneOrder, ms, tickLabel, timeTicks } from "../lib";
import { FrameNote, Panel, TipRow, TooltipBox, useElementSize } from "../ui";

const LABEL_W = 64;
const LANE_H = 10;
const AXIS_H = 13;

export function ActivitySwimlane({ p, hovered, onHover }: { p: FleetPayload; hovered: string | null; onHover: (id: string | null) => void }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ lane: string; i: number; x: number; y: number } | null>(null);
  const a = p.activity;
  const start = ms(a.start) ?? 0;
  const bucketMs = a.bucket_s * 1000;
  const end = start + a.buckets * bucketMs;
  const plotW = Math.max(50, size.width - LABEL_W - 4);
  const maxLanes = Math.max(1, Math.floor((size.height - AXIS_H) / LANE_H) - 1);
  const ids = laneOrder(p, maxLanes);
  const hiddenLanes = p.bots.length - ids.length;
  const lanesById = new Map(a.lanes.map((l) => [l.bot_id, l]));
  const fleet = fleetLane(p);
  const names = new Map(p.bots.map((b) => [b.id, b.symbol]));
  const x = (t: number) => LABEL_W + ((t - start) / (end - start)) * plotW;
  const bw = plotW / a.buckets;
  const { ticks, step } = timeTicks(start, end, plotW);
  const ccy = p.currency.base;
  const rowsY = (k: number) => k * LANE_H;

  const tipLane = hover ? (hover.lane === "__fleet" ? null : lanesById.get(hover.lane)) : null;
  const tipCounts = hover ? (hover.lane === "__fleet" ? { ok: fleet.ok[hover.i], error: fleet.error[hover.i], buy: fleet.buy[hover.i] } : { ok: tipLane?.ok[hover.i] ?? 0, error: tipLane?.error[hover.i] ?? 0, buy: tipLane?.buy[hover.i] ?? 0 }) : null;

  return (
    <Panel
      id="activity"
      title="Activity · last 24 h"
      aside={
        <span className="flex items-center gap-2.5 text-[10.5px] text-white/40">
          <span className="flex items-center gap-1"><span className="h-2 w-1 bg-[#8FB3E0]/60" />run</span>
          <span className="flex items-center gap-1"><span className="h-2 w-1 bg-[#F87171]" />failed</span>
          <span className="flex items-center gap-1"><svg width="7" height="7"><path d="M3.5 0 L7 7 L0 7 Z" fill="#FFFFFF" fillOpacity={0.85} /></svg>open</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: SEMANTIC.positive }} />close</span>
          <span className="flex items-center gap-1"><span className="h-2 w-3 bg-white/[0.06]" />no runs</span>
          {hiddenLanes > 0 ? <span>+{hiddenLanes} bots not shown</span> : null}
        </span>
      }
      bodyClassName="relative overflow-visible"
      className="overflow-visible"
    >
      <div ref={ref} className="absolute inset-0" onMouseLeave={() => { setHover(null); onHover(null); }}>
        {size.width > 0 ? (
          <svg width="100%" height="100%" className="block overflow-hidden">
            {[{ id: "__fleet", label: "Fleet" }, ...ids.map((id) => ({ id, label: names.get(id) ?? "bot" }))].map((lane, k) => {
              const y = rowsY(k);
              const isFleet = lane.id === "__fleet";
              const l = isFleet ? null : lanesById.get(lane.id);
              const ok = isFleet ? fleet.ok : (l?.ok ?? []);
              const err = isFleet ? fleet.error : (l?.error ?? []);
              const dim = hovered && !isFleet && hovered !== lane.id;
              return (
                <g key={lane.id} opacity={dim ? 0.35 : 1} onMouseEnter={() => !isFleet && onHover(lane.id)}>
                  <text x={0} y={y + LANE_H - 1.5} fontSize={10} fill={isFleet ? "rgba(255,255,255,0.75)" : hovered === lane.id ? "#FFFFFF" : "rgba(255,255,255,0.5)"}>
                    {lane.label}
                  </text>
                  <rect x={LABEL_W} y={y + 1} width={plotW} height={LANE_H - 2} fill="rgba(255,255,255,0.02)" />
                  {(l?.gaps ?? []).map(([g0, g1]) => {
                    const a0 = ms(g0) ?? start, a1 = ms(g1) ?? end;
                    return <rect key={g0} x={x(a0)} y={y + 1} width={Math.max(1, x(a1) - x(a0))} height={LANE_H - 2} fill="rgba(255,255,255,0.06)" />;
                  })}
                  {ok.map((o, i) => {
                    const e = err[i] ?? 0;
                    if (!o && !e) return null;
                    return <rect key={i} x={LABEL_W + i * bw} y={e ? y + 1 : y + 3} width={Math.max(1, bw - 0.6)} height={e ? LANE_H - 2 : LANE_H - 6} fill={e ? "#F87171" : ACCENT} fillOpacity={e ? 0.9 : isFleet ? 0.6 : 0.45} />;
                  })}
                  {(l?.opens ?? []).map((o) => {
                    const t = ms(o.t);
                    if (t == null || t < start) return null;
                    const cx = x(t);
                    return <path key={`o${o.t}`} d={`M${cx} ${y + 2} L${cx + 4} ${y + LANE_H - 2} L${cx - 4} ${y + LANE_H - 2} Z`} fill="#FFFFFF" fillOpacity={o.precise ? 0.85 : 0.4} />;
                  })}
                  {(l?.closes ?? []).map((c) => {
                    const t = ms(c.t);
                    if (t == null || t < start) return null;
                    return <circle key={`c${c.t}`} cx={x(t)} cy={y + LANE_H / 2} r={2.8} fill={(c.pnl ?? 0) >= 0 ? SEMANTIC.positive : SEMANTIC.negative} fillOpacity={c.precise ? 1 : 0.5} />;
                  })}
                  <rect
                    x={LABEL_W}
                    y={y}
                    width={plotW}
                    height={LANE_H}
                    fill="transparent"
                    onMouseMove={(ev) => {
                      const box = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                      const px = ev.clientX - box.left;
                      const i = Math.min(a.buckets - 1, Math.max(0, Math.floor((px - LABEL_W) / bw)));
                      setHover({ lane: lane.id, i, x: px, y: y });
                    }}
                  />
                </g>
              );
            })}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={0} y2={size.height - AXIS_H} stroke="rgba(255,255,255,0.06)" />
                <text x={x(t)} y={size.height - 3} fontSize={10.5} fill="rgba(255,255,255,0.4)" textAnchor="middle">{tickLabel(t, step)}</text>
              </g>
            ))}
          </svg>
        ) : null}
        {p.bots.length === 0 ? (
          <FrameNote className="pb-[13px] pl-[64px]" title="No analysis runs in the last 24 h" sub={`Runs, failures, opens and closes per bot, in ${a.bucket_s / 60}-minute buckets`} />
        ) : null}
        {hover && tipCounts ? (
          <div className="pointer-events-none absolute z-10" style={{ left: Math.min(hover.x + 12, size.width - 200), bottom: size.height - hover.y + 2 }}>
            <TooltipBox>
              <p className="mb-1 text-white/50">
                {hover.lane === "__fleet" ? "Fleet" : names.get(hover.lane)} · {fmtClock(start + hover.i * bucketMs)}–{fmtClock(start + (hover.i + 1) * bucketMs)}
              </p>
              <TipRow label="Runs ok" value={tipCounts.ok} />
              <TipRow label="Runs failed" value={tipCounts.error} />
              <TipRow label="Buy signals" value={tipCounts.buy} />
              {tipLane
                ? tipLane.closes
                    .filter((c) => {
                      const t = ms(c.t) ?? 0;
                      return t >= start + hover.i * bucketMs && t < start + (hover.i + 1) * bucketMs;
                    })
                    .map((c) => <TipRow key={c.t} label="Close" value={fmtMoney(c.pnl, ccy, { signed: true })} />)
                : null}
            </TooltipBox>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
