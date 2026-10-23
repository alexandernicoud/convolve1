import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KV, Panel } from "@/features/review/components/primitives";
import { Chip } from "@/features/review/components/primitives";
import { axisLabel, axisProps, ChartFrame, ChartPlaceholder, ChartTooltip, gridProps } from "@/components/viz/chartKit";
import { fmtInt, fmtPct, isFiniteNum, niceScale, paddedDomain } from "@/lib/viz/format";
import { SEMANTIC, SERIES, VIZ } from "@/lib/viz/tokens";
import { useWorkspace } from "../BacktestWorkspace";
import { fmtDay, fmtMoney, fmtSignedPct, metricValue, monthTick, pctTick } from "../ui";
import { useEquityRows } from "./OverviewTab";

const ROLL_WINDOWS = [21, 63, 126] as const;
const BAR_FILL = "rgba(255,255,255,0.62)";

export default function PerformanceTab() {
  const { summary, trades, loadTrades } = useWorkspace();
  const tm = summary.trading_metrics;
  const rows = useEquityRows();
  const [win, setWin] = useState<(typeof ROLL_WINDOWS)[number]>(63);
  useEffect(loadTrades, [loadTrades]);

  const series = useMemo(() => {
    if (!rows) return null;
    return rows.map((r, i) => {
      const prev = i >= win ? rows[i - win].equity : null;
      return {
        date: r.date,
        underwater: isFiniteNum(r.drawdown) ? -r.drawdown : null,
        rolling: prev ? r.equity / prev - 1 : null,
        exposure: r.gross_exposure,
        n_positions: r.n_positions,
        commission_cum: r.commission_cum,
        slippage_cum: r.slippage_cum,
      };
    });
  }, [rows, win]);

  const hist = useMemo(() => {
    const vals = (trades ?? []).filter((t) => t.status === "closed" && isFiniteNum(t.net_return)).map((t) => t.net_return as number);
    if (!vals.length) return null;
    const w = 0.0025;
    const lo = Math.floor(Math.min(...vals) / w) * w;
    const hi = Math.ceil(Math.max(...vals) / w) * w;
    const n = Math.max(1, Math.round((hi - lo) / w));
    const bins = Array.from({ length: n }, (_, i) => ({ lo: lo + i * w, mid: lo + (i + 0.5) * w, count: 0 }));
    for (const v of vals) bins[Math.min(n - 1, Math.max(0, Math.floor((v - lo) / w)))].count += 1;
    return { bins, n: vals.length, width: w };
  }, [trades]);

  const monthlyExposure = useMemo(() => {
    if (!rows) return null;
    const m = new Map<string, { sum: number; n: number; inMarket: number }>();
    for (const r of rows) {
      if (!isFiniteNum(r.gross_exposure)) continue;
      const k = r.date.slice(0, 7);
      const cur = m.get(k) ?? { sum: 0, n: 0, inMarket: 0 };
      cur.sum += r.gross_exposure;
      cur.n += 1;
      if (r.n_positions > 0) cur.inMarket += 1;
      m.set(k, cur);
    }
    return [...m.entries()].map(([month, v]) => ({ month, mean_exposure: v.sum / v.n, days_in_market: v.inMarket / v.n, days: v.n }));
  }, [rows]);

  const hold = (tm.holding_bars?.histogram ?? []) as { bars: number; count: number }[];
  const ddScale = series ? niceScale(paddedDomain([0, ...series.map((r) => r.underwater)], { pad: 0.05, clamp: [-1, 0] }), 5, [-1, 0]) : undefined;

  const loading = <ChartPlaceholder height={220}>Loading…</ChartPlaceholder>;

  return (
    <div className="space-y-5">
      <Panel title="Risk and return summary">
        <div className="pl-4">
          <KV
            cols={3}
            rows={[
              ["Annualized return", fmtVal(tm.annualized_return, fmtSignedPct), tm.annualized_return?.unavailable],
              ["Annualized volatility", fmtVal(tm.annualized_volatility, (v) => fmtPct(v)), tm.annualized_volatility?.unavailable],
              ["Sharpe (rf = 0)", fmtVal(tm.sharpe, (v) => v.toFixed(2)), tm.assumptions?.sharpe],
              ["Sortino (rf = 0)", fmtVal(tm.sortino, (v) => v.toFixed(2)), tm.assumptions?.sortino],
              ["Profit factor", fmtVal(tm.profit_factor, (v) => v.toFixed(2)), "Gross profit of winning trades divided by gross loss of losing trades, after costs."],
              ["Expectancy per trade", fmtVal(tm.expectancy_return, fmtSignedPct), `${fmtMoney(metricValue(tm.expectancy_pnl), 2)} per trade`],
              ["Average win / loss", `${fmtVal(tm.avg_win_return, fmtSignedPct)} / ${fmtVal(tm.avg_loss_return, fmtSignedPct)}`],
              ["Turnover", fmtVal(tm.turnover, (v) => `${v.toFixed(1)}×`), tm.turnover?.definition],
              ["Longest drawdown", `${fmtInt(tm.longest_drawdown_days)} days`, `${fmtDay(tm.max_drawdown_peak_date)} peak → ${fmtDay(tm.max_drawdown_trough_date)} trough; ${tm.max_drawdown_recovery_date ? `recovered ${fmtDay(tm.max_drawdown_recovery_date)}` : "not recovered by the end"}`],
            ]}
          />
          <p className="mt-2 text-[12px] text-white/40">
            {tm.assumptions?.return_frequency}; {tm.assumptions?.periods_per_year} periods per year. Ratios need at least {tm.assumptions?.min_periods} periods.
          </p>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel>
          <ChartFrame title="Drawdown from running peak" note="Marked-to-market equity relative to its highest prior close." height={220}>
            {!series ? loading : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 6, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={monthTick} minTickGap={48} />
                  <YAxis {...axisProps} width={52} domain={ddScale?.domain} ticks={ddScale?.ticks} tickFormatter={pctTick} />
                  <Tooltip content={<ChartTooltip labelFormat={fmtDay} format={(v) => fmtPct(v)} />} />
                  <Area type="linear" dataKey="underwater" name="Drawdown" stroke={SEMANTIC.negative} fill={SEMANTIC.negative} fillOpacity={0.12} strokeWidth={VIZ.stroke.secondary} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartFrame>
        </Panel>
        <Panel>
          <ChartFrame
            title={`Rolling ${win}-day return`}
            note="Computed from daily equity; the first window has no value."
            height={220}
            aside={<div className="flex gap-1">{ROLL_WINDOWS.map((w) => <Chip key={w} active={w === win} onClick={() => setWin(w)}>{w}d</Chip>)}</div>}
          >
            {!series ? loading : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 6, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={monthTick} minTickGap={48} />
                  <YAxis {...axisProps} width={52} tickFormatter={pctTick} />
                  <ReferenceLine y={0} stroke={VIZ.axisLine} />
                  <Tooltip content={<ChartTooltip labelFormat={fmtDay} format={(v) => fmtSignedPct(v)} />} />
                  <Line type="linear" dataKey="rolling" name={`${win}-day return`} stroke={SERIES.primary.color} strokeWidth={VIZ.stroke.secondary} dot={false} isAnimationActive={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartFrame>
        </Panel>
        <Panel>
          <ChartFrame
            title="Gross exposure by month"
            note="Monthly mean of daily exposure (open market value ÷ equity at each close). Daily values are in equity.csv."
            height={220}
            csv={monthlyExposure ? { filename: "monthly_exposure.csv", rows: monthlyExposure, columns: [{ key: "month" }, { key: "mean_exposure" }, { key: "days_in_market" }, { key: "days" }] } : undefined}
          >
            {!monthlyExposure ? loading : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyExposure} margin={{ top: 6, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="month" {...axisProps} tickFormatter={(m: string) => monthTick(`${m}-01`)} minTickGap={24} />
                  <YAxis {...axisProps} width={52} tickFormatter={pctTick} />
                  <Tooltip content={<ChartTooltip format={(v, k) => (k === "mean_exposure" ? fmtPct(v, 1) : String(v))} />} />
                  <Bar dataKey="mean_exposure" name="Mean exposure" fill={BAR_FILL} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartFrame>
        </Panel>
        <Panel>
          <ChartFrame
            title="Cumulative costs"
            note={`Commission ${fmtMoney(metricValue(tm.total_commission))} and slippage ${fmtMoney(metricValue(tm.total_slippage))}, against gross P&L of ${fmtMoney(metricValue(tm.gross_pnl))}.`}
            legend={[{ label: "Commission", color: SERIES.primary.color }, { label: "Slippage", color: SERIES.secondary.color, dash: SERIES.secondary.dash }]}
            height={220}
          >
            {!series ? loading : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 6, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={monthTick} minTickGap={48} />
                  <YAxis {...axisProps} width={56} tickFormatter={(v: number) => fmtMoney(v)} />
                  <Tooltip content={<ChartTooltip labelFormat={fmtDay} format={(v) => fmtMoney(v, 2)} />} />
                  <Line type="linear" dataKey="commission_cum" name="Commission" stroke={SERIES.primary.color} strokeWidth={VIZ.stroke.secondary} dot={false} isAnimationActive={false} />
                  <Line type="linear" dataKey="slippage_cum" name="Slippage" stroke={SERIES.secondary.color} strokeDasharray={SERIES.secondary.dash} strokeWidth={VIZ.stroke.secondary} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartFrame>
        </Panel>
        <Panel>
          <ChartFrame
            title="Net return per closed trade"
            note={hist ? `${fmtInt(hist.n)} trades, ${(hist.width * 100).toFixed(2)}% bins, after commission and slippage.` : undefined}
            height={220}
            csv={hist ? { filename: "trade_return_histogram.csv", rows: hist.bins, columns: [{ key: "lo", label: "bin_start" }, { key: "count" }] } : undefined}
          >
            {!trades ? loading : !hist ? <ChartPlaceholder height={220}>No closed trades.</ChartPlaceholder> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hist.bins} margin={{ top: 6, right: 12, bottom: 16, left: 4 }} barCategoryGap={1}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="mid" {...axisProps} type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => fmtSignedPct(v, 1)} label={axisLabel("Net return", "x")} />
                  <YAxis {...axisProps} width={40} allowDecimals={false} />
                  <ReferenceLine x={0} stroke={VIZ.axisLine} strokeDasharray="3 3" />
                  <Tooltip content={<ChartTooltip labelFormat={(l) => `around ${fmtSignedPct(l, 2)}`} format={(v) => fmtInt(v)} />} />
                  <Bar dataKey="count" name="Trades" fill={BAR_FILL} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartFrame>
        </Panel>
        <Panel>
          <ChartFrame title="Holding period" note={`Bars from entry to exit, closed trades. Median ${fmtInt(tm.holding_bars?.median)}.`} height={220}>
            {!hold.length ? <ChartPlaceholder height={220}>No closed trades.</ChartPlaceholder> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hold} margin={{ top: 6, right: 12, bottom: 16, left: 4 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="bars" {...axisProps} label={axisLabel("Bars held", "x")} />
                  <YAxis {...axisProps} width={40} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip labelFormat={(l) => `${l} bars`} format={(v) => fmtInt(v)} />} />
                  <Bar dataKey="count" name="Trades" fill={BAR_FILL} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartFrame>
        </Panel>
      </div>
    </div>
  );
}

export function fmtVal(m: { value: number | null; unavailable?: string } | undefined, f: (v: number) => string): string {
  return m && isFiniteNum(m.value) ? f(m.value) : "—";
}
