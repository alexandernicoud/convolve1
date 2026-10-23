import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { FLEET_LINE_COLORS } from "@/components/dashboard/fleetPalette";
import { axisProps, gridProps } from "@/components/viz/chartKit";
import { SEMANTIC, VIZ } from "@/lib/viz/tokens";
import type { FleetPayload, FleetRange } from "../api";
import { FLEET_RANGES } from "../api";
import {
  ACCENT,
  bands,
  botKey,
  buildChartRows,
  fmtDateTime,
  fmtMoney,
  fmtPct,
  FRAME_DOMAIN,
  FRAME_TICKS,
  isInactive,
  isNum,
  ms,
  PORTFOLIO_HREF,
  tickLabel,
  timeTicks,
  type ChartMode,
  type ChartRow,
} from "../lib";
import { BASELINE_STROKE, FrameNote, Panel, Segmented, TipRow, TooltipBox, useElementSize } from "../ui";

const SYNC = "fleet-time";
const Y_AXIS_W = 62;
const PLOT_LEFT = Y_AXIS_W;
const PLOT_RIGHT = 8;

function MainTooltip({ active, payload, mode, ccy, names, hovered }: { active?: boolean; payload?: { payload: ChartRow }[]; mode: ChartMode; ccy: string | null; names: Record<string, string>; hovered: string | null }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  if (r.value == null) return null;
  const money = (v: number | null, signed = false) => fmtMoney(v, ccy, { signed });
  return (
    <TooltipBox>
      <p className="mb-1 text-white/50">{fmtDateTime(r.t)}</p>
      <TipRow label="Net P&L" value={money(r.netPnl, true)} color={mode === "pnl" ? ACCENT : undefined} />
      <TipRow label="· realized" value={money(r.realized, true)} />
      <TipRow label="· unrealized" value={money(r.unrealized, true)} />
      <TipRow label="Equity" value={money(r.equity)} color={mode === "equity" ? ACCENT : undefined} />
      <TipRow label="Contributed" value={money(r.contributed)} />
      <TipRow label="Return (TWR)" value={fmtPct(r.twr)} color={mode === "twr" ? ACCENT : undefined} />
      {hovered && isNum(r[botKey(hovered)]) ? <TipRow label={names[hovered] ?? "Bot"} value={money(r[botKey(hovered)] ?? null, mode === "pnl")} /> : null}
      {r.closes.length ? (
        <p className="mt-1 border-t border-white/10 pt-1 text-white/60">
          {r.closes.length} close{r.closes.length > 1 ? "s" : ""}: {r.closes.map((c) => `${names[c.bot_id] ?? "bot"} ${money(c.pnl, true)}`).join(", ")}
        </p>
      ) : null}
      <p className="mt-1 text-[11px] text-white/40">
        {r.nObs} valuation{r.nObs === 1 ? "" : "s"} in bucket{r.staleBots ? <span className="text-[#FCD34D]"> · {r.staleBots} stale</span> : null}
      </p>
    </TooltipBox>
  );
}

function DdTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  if (!active || !payload?.length || payload[0].payload.drawdown == null) return null;
  return (
    <TooltipBox>
      <TipRow label="Drawdown (worst in bucket)" value={fmtPct(payload[0].payload.drawdown, 2)} color={SEMANTIC.negative} />
    </TooltipBox>
  );
}

export function EquityPanel({
  p,
  range,
  onRange,
  mode,
  onMode,
  breakdown,
  onBreakdown,
  hovered,
  showUnderwater,
  loadingRange,
}: {
  p: FleetPayload;
  range: FleetRange;
  onRange: (r: FleetRange) => void;
  mode: ChartMode;
  onMode: (m: ChartMode) => void;
  breakdown: boolean;
  onBreakdown: (v: boolean) => void;
  hovered: string | null;
  showUnderwater: boolean;
  loadingRange: boolean;
}) {
  const ccy = p.currency.base;
  const rows = useMemo(() => buildChartRows(p, mode), [p, mode]);
  const [plotRef, plot] = useElementSize<HTMLDivElement>();
  const bucketMs = (p.window.bucket_s ?? 300) * 1000;
  const start = ms(p.window.start) ?? rows[0]?.t ?? 0;
  const end = ms(p.window.end) ?? rows[rows.length - 1]?.t ?? 0;
  const { ticks, step } = useMemo(() => timeTicks(start, end, Math.max(200, plot.width - 70)), [start, end, plot.width]);
  const names = useMemo(() => Object.fromEntries(p.bots.map((b) => [b.id, b.symbol])), [p.bots]);
  const botIds = p.currency.included_bot_ids;
  const staleBands = useMemo(() => bands(rows, (r) => r.staleBots > 0, bucketMs), [rows, bucketMs]);
  const gapBands = useMemo(() => bands(rows, (r) => r.value != null && r.nObs === 0, bucketMs).filter(([a, b]) => b - a >= 3 * bucketMs), [rows, bucketMs]);
  const first = rows.find((r) => r.value != null);
  const last = [...rows].reverse().find((r) => r.value != null);
  const delta = first && last && isNum(first.value) && isNum(last.value) ? (mode === "twr" ? (1 + last.value) / (1 + first.value) - 1 : last.value - first.value) : null;
  const fmtY = (v: number) => (mode === "twr" ? fmtPct(v, Math.abs(v) < 0.01 ? 2 : 1) : fmtMoney(v, ccy, { compact: true, digits: Math.abs(v) < 10 ? 2 : 0, signed: mode === "pnl" }));
  const inactive = isInactive(p);
  const hasValues = rows.some((r) => r.value != null);
  const frameRows = useMemo(() => [{ t: start }, { t: end }], [start, end]);
  const zeroLabel = mode === "twr" ? "0.00%" : fmtMoney(0, ccy, { compact: true, digits: 0 });
  const frameTick = (v: number) => (v === 0 ? zeroLabel : "");
  const showBots = mode !== "twr" && (breakdown || hovered != null);
  const ddMin = Math.min(-0.001, ...rows.map((r) => r.drawdown ?? 0));
  const deploys = (p.markers?.deployments ?? []).map((d) => ({ ...d, x: ms(d.t) ?? 0 })).filter((d) => d.x >= start);
  const bucketLabel = bucketMs >= 86400e3 ? `${bucketMs / 86400e3} d` : bucketMs >= 3600e3 ? `${bucketMs / 3600e3} h` : `${bucketMs / 60e3} min`;
  const xAxis = (hide: boolean) => (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={[start, end]}
      ticks={ticks}
      tickFormatter={(t: number) => tickLabel(t, step)}
      {...axisProps}
      tick={hide ? false : axisProps.tick}
      height={hide ? 4 : 20}
      allowDataOverflow
    />
  );

  return (
    <Panel
      id="equity"
      title="Fleet performance"
      link={{ to: PORTFOLIO_HREF, label: "Portfolio" }}
      aside={
        <>
          <Segmented
            label="Chart mode"
            value={mode}
            onChange={onMode}
            options={[
              { value: "pnl", label: "Net P&L", title: "Equity minus contributed capital" },
              { value: "equity", label: "Equity", title: "Fleet equity with contributed capital" },
              { value: "twr", label: "TWR %", title: "Time-weighted return, flows removed" },
            ]}
          />
          <Segmented label="Range" value={range} onChange={onRange} options={FLEET_RANGES.map((r) => ({ value: r, label: r }))} />
          <button
            type="button"
            aria-pressed={breakdown}
            disabled={mode === "twr" || inactive}
            onClick={() => onBreakdown(!breakdown)}
            title={mode === "twr" ? "Per-bot lines are shown in Net P&L and Equity modes" : "Show each bot"}
            className={`h-[22px] rounded-md border px-2 text-[11px] font-medium transition disabled:opacity-35 ${breakdown && mode !== "twr" ? "border-white/30 bg-white/[0.1] text-white" : "border-white/[0.1] text-white/45 hover:text-white/80"}`}
          >
            Bots
          </button>
        </>
      }
      bodyClassName="flex flex-col"
    >
      <div className="flex h-[18px] shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap text-[11px] text-white/45">
        <span>
          Window Δ{" "}
          <span className="font-digits tabular-nums" style={{ color: !isNum(delta) || delta === 0 ? "#E5E5E5" : delta > 0 ? SEMANTIC.positive : SEMANTIC.negative }}>
            {mode === "twr" ? fmtPct(delta) : fmtMoney(delta, ccy, { signed: true })}
          </span>
        </span>
        {hasValues ? (
          <>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full" style={{ background: ACCENT }} />Fleet</span>
            {mode === "equity" ? <span className="flex items-center gap-1.5"><svg width="14" height="4"><line x1="0" y1="2" x2="14" y2="2" stroke="rgba(255,255,255,0.45)" strokeDasharray="3 2" /></svg>Contributed</span> : null}
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: SEMANTIC.positive }} />close</span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5"><svg width="14" height="4"><line x1="0" y1="2" x2="14" y2="2" stroke={BASELINE_STROKE} strokeDasharray="4 3" /></svg>{inactive ? "inactive baseline" : "no valuations"}</span>
            {inactive && mode !== "twr" ? <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-[#8FB3E0]" />current state</span> : null}
          </>
        )}
        {staleBands.length ? <span className="flex items-center gap-1.5"><span className="h-[3px] w-3 rounded-[1px] bg-[#FCD34D]/70" />stale mark</span> : null}
        <span className="ml-auto text-white/35">{bucketLabel} buckets · local time{loadingRange ? " · loading…" : ""}</span>
      </div>
      <div ref={plotRef} className="relative min-h-0 flex-1">
        {staleBands.length && plot.width > 0 && end > start ? (
          <div className="pointer-events-none absolute inset-x-0 top-[1px] z-[1] h-[3px]" aria-hidden>
            {staleBands.map(([a, b]) => {
              const left = PLOT_LEFT + ((Math.max(a, start) - start) / (end - start)) * (plot.width - PLOT_LEFT - PLOT_RIGHT);
              const right = PLOT_LEFT + ((Math.min(b, end) - start) / (end - start)) * (plot.width - PLOT_LEFT - PLOT_RIGHT);
              return <span key={a} className="absolute top-0 h-full rounded-[1px] bg-[#FCD34D]/70" style={{ left, width: Math.max(2, right - left) }} title="At least one bot's valuation was stale" />;
            })}
          </div>
        ) : null}
        {!hasValues ? (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={frameRows} syncId={SYNC} margin={{ top: 6, right: PLOT_RIGHT + 26, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                {xAxis(showUnderwater)}
                <YAxis {...axisProps} width={Y_AXIS_W} domain={FRAME_DOMAIN} ticks={FRAME_TICKS} tickFormatter={frameTick} allowDataOverflow />
                <ReferenceLine
                  y={0}
                  stroke={BASELINE_STROKE}
                  strokeDasharray="5 4"
                  label={{ value: inactive ? "Inactive baseline — no historical observations" : "No valuations in this window", position: "insideBottomLeft", fill: "rgba(201,219,241,0.65)", fontSize: 11, offset: 8 }}
                />
                {inactive && mode !== "twr" ? (
                  <ReferenceDot
                    x={end}
                    y={0}
                    r={3.5}
                    fill="#000"
                    stroke={ACCENT}
                    strokeWidth={1.5}
                    ifOverflow="visible"
                    label={{ value: `now · ${fmtMoney(0, ccy, { digits: 0 })}`, position: "top", fill: "rgba(201,219,241,0.8)", fontSize: 10.5, offset: 8 }}
                  />
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
            {inactive ? (
              <FrameNote
                className="bottom-auto top-[18%]"
                title="Fleet history begins with the first deployed bot"
                sub={`Equity ${fmtMoney(0, ccy, { digits: 0 })} · contributed ${fmtMoney(0, ccy, { digits: 0 })} · 0 open positions`}
              />
            ) : null}
          </>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} syncId={SYNC} margin={{ top: 6, right: PLOT_RIGHT, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              {xAxis(showUnderwater)}
              <YAxis {...axisProps} width={Y_AXIS_W} tickFormatter={fmtY} domain={["auto", "auto"]} tickCount={5} />
              {gapBands.map(([a, b]) => <ReferenceArea key={`g${a}`} x1={a} x2={b} fill="rgba(255,255,255,0.035)" strokeOpacity={0} ifOverflow="hidden" />)}
              {mode !== "equity" ? <ReferenceLine y={0} stroke="rgba(255,255,255,0.22)" /> : null}
              {deploys.map((d) => (
                <ReferenceLine
                  key={`d${d.bot_id}`}
                  x={d.x}
                  stroke="rgba(255,255,255,0.28)"
                  strokeDasharray="2 3"
                  label={{ value: `+ ${names[d.bot_id] ?? "bot"}`, position: "insideTopLeft", fill: "rgba(255,255,255,0.5)", fontSize: 10.5 }}
                />
              ))}
              {mode === "equity" ? <Line dataKey="contributed" type="stepAfter" stroke="rgba(255,255,255,0.45)" strokeDasharray="4 3" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} /> : null}
              {showBots
                ? botIds.map((id, i) => {
                    if (!breakdown && hovered !== id) return null;
                    const hi = hovered === id;
                    return (
                      <Line
                        key={id}
                        dataKey={botKey(id)}
                        type="stepAfter"
                        stroke={hi ? "#FFFFFF" : FLEET_LINE_COLORS[i % FLEET_LINE_COLORS.length]}
                        strokeOpacity={hovered && !hi ? 0.22 : hi ? 0.95 : 0.6}
                        strokeWidth={hi ? 1.6 : 1}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls={false}
                      />
                    );
                  })
                : null}
              <Line dataKey="value" type="stepAfter" stroke={ACCENT} strokeWidth={VIZ.stroke.primary} dot={false} isAnimationActive={false} connectNulls={false} />
              <Scatter dataKey="closeUp" fill={SEMANTIC.positive} shape="circle" isAnimationActive={false} legendType="none" />
              <Scatter dataKey="closeDown" fill={SEMANTIC.negative} shape="circle" isAnimationActive={false} legendType="none" />
              <Tooltip content={<MainTooltip mode={mode} ccy={ccy} names={names} hovered={hovered} />} cursor={{ stroke: "rgba(255,255,255,0.3)" }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      {showUnderwater && !hasValues ? (
        <div className="h-[27%] min-h-[64px] shrink-0 border-t border-white/[0.06] pt-0.5">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={frameRows} syncId={SYNC} margin={{ top: 4, right: PLOT_RIGHT + 26, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              {xAxis(false)}
              <YAxis {...axisProps} width={Y_AXIS_W} domain={[-0.01, 0]} ticks={[-0.01, -0.005, 0]} allowDataOverflow tickFormatter={(v: number) => (v === 0 ? "0.00%" : "")} />
              <ReferenceLine
                y={0}
                stroke={BASELINE_STROKE}
                strokeDasharray="5 4"
                label={{ value: "Drawdown · unavailable until valuations exist", position: "insideBottomLeft", fill: "rgba(255,255,255,0.4)", fontSize: 10.5, offset: 6 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      {showUnderwater && hasValues ? (
        <div className="h-[27%] min-h-[64px] shrink-0 border-t border-white/[0.06] pt-0.5">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} syncId={SYNC} margin={{ top: 4, right: PLOT_RIGHT, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              {xAxis(false)}
              <YAxis {...axisProps} width={Y_AXIS_W} domain={[Math.min(ddMin * 1.1, -0.001), 0]} tickCount={3} tickFormatter={(v: number) => fmtPct(v, Math.abs(ddMin) < 0.01 ? 2 : 1)} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.22)" />
              <Area dataKey="drawdown" type="stepAfter" stroke={SEMANTIC.negative} strokeWidth={1.2} fill={SEMANTIC.negative} fillOpacity={0.16} isAnimationActive={false} connectNulls={false} />
              <Tooltip content={<DdTooltip />} cursor={{ stroke: "rgba(255,255,255,0.3)" }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </Panel>
  );
}
