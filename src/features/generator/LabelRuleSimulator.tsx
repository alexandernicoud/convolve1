/**
 * Visual schematic of generator labeling rules: chart lookback window, entry,
 * future horizon, and TP/SL thresholds. Purely local — no API calls.
 */
import { useMemo } from "react";
import { lookbackBars } from "./health";
import type { Timeframe } from "./plan";
import {
  buildSyntheticBars,
  labelRuleLayout,
  timespanLabel,
  toOhlc,
  type OhlcBar,
} from "./labelRuleModel";

export type { OhlcBar };
export { buildSyntheticBars, labelRuleLayout } from "./labelRuleModel";

export type LabelRuleSimulatorProps = {
  horizonBars: number;
  takeProfitFraction: number;
  stopLossFraction: number;
  timespanUnit: string;
  timespanCount: number;
  timeframe: Timeframe;
  /** Prefer candlesticks when true; otherwise a close line. */
  useCandles?: boolean;
  /** Optional live/local OHLC (or close-only numbers). Falls back to a synthetic walk. */
  bars?: Array<OhlcBar | number>;
  className?: string;
};

const MAX_LOOKBACK_DRAW = 36;
const MAX_HORIZON_DRAW = 24;
const PAD = { top: 28, right: 72, bottom: 36, left: 12 };

export default function LabelRuleSimulator({
  horizonBars,
  takeProfitFraction,
  stopLossFraction,
  timespanUnit,
  timespanCount,
  timeframe,
  useCandles = true,
  bars,
  className = "",
}: LabelRuleSimulatorProps) {
  const rawLookback = lookbackBars(
    timeframe,
    timespanUnit,
    Number.isFinite(timespanCount) ? timespanCount : 1,
  );
  const horizonDrawn =
    Number.isFinite(horizonBars) && horizonBars >= 1 ? Math.min(MAX_HORIZON_DRAW, horizonBars) : 1;
  const layout = labelRuleLayout({
    lookback: Math.min(MAX_LOOKBACK_DRAW, rawLookback),
    horizon: horizonDrawn,
    takeProfitFraction,
    stopLossFraction,
  });
  /** Copy uses the configured horizon even when the schematic is capped for readability. */
  const horizonCopy = Number.isFinite(horizonBars) && horizonBars >= 1 ? Math.round(horizonBars) : layout.horizon;

  const series = useMemo(() => {
    const needed = layout.totalBars;
    if (bars && bars.length >= 2) {
      const ohlc = toOhlc(bars);
      if (ohlc.length >= needed) return ohlc.slice(ohlc.length - needed);
      // Pad the start if a short live slice was provided.
      const pad = buildSyntheticBars(needed - ohlc.length, 11);
      const bridge = pad[pad.length - 1]?.close ?? 100;
      const scale = ohlc[0] ? ohlc[0].open / bridge : 1;
      return [
        ...pad.map((b) => ({
          open: b.open * scale,
          high: b.high * scale,
          low: b.low * scale,
          close: b.close * scale,
        })),
        ...ohlc,
      ].slice(-needed);
    }
    return buildSyntheticBars(needed, 7);
  }, [bars, layout.totalBars]);

  const entry = series[layout.entryIndex] ?? series[series.length - 1];
  const entryPrice = entry?.open ?? 100;
  const tpPrice = entryPrice * (1 + layout.tp);
  const slPrice = entryPrice * (1 - layout.sl);

  const width = 640;
  const height = 220;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const prices = series.flatMap((b) => [b.high, b.low, tpPrice, slPrice, entryPrice]);
  const ymin = Math.min(...prices);
  const ymax = Math.max(...prices);
  const yPad = (ymax - ymin) * 0.08 || 1;
  const y0 = ymin - yPad;
  const y1 = ymax + yPad;

  const xAt = (i: number) => PAD.left + ((i + 0.5) / series.length) * plotW;
  const yAt = (p: number) => PAD.top + ((y1 - p) / (y1 - y0)) * plotH;
  const barW = Math.max(2, (plotW / series.length) * 0.55);

  const lookbackX0 = PAD.left;
  const lookbackX1 = PAD.left + (layout.lookback / series.length) * plotW;
  const horizonX0 = PAD.left + ((layout.entryIndex + 1) / series.length) * plotW;
  const horizonX1 = PAD.left + plotW;

  const linePath = series
    .map((b, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(b.close).toFixed(1)}`)
    .join(" ");

  const tpPct = layout.tp * 100;
  const slPct = layout.sl * 100;
  const tpLabel = `TP +${Number.isInteger(tpPct) ? tpPct : tpPct.toFixed(1)}%`;
  const slLabel = `SL −${Number.isInteger(slPct) ? slPct : slPct.toFixed(1)}%`;

  return (
    <div
      className={`rounded-xl border border-white/12 bg-[#0a0a0a]/40 p-4 ${className}`}
      data-help="gen-label-simulator"
      data-tour="gen-label-simulator"
    >
      <h4 className="text-sm font-semibold text-white">Labeling rules</h4>
      <p className="mt-1 text-xs leading-relaxed text-white/50">
        Lookback ({timespanLabel(timespanUnit, timespanCount)}) is what the image shows. Horizon (
        {horizonCopy} bar{horizonCopy === 1 ? "" : "s"}) is how far the label looks ahead. TP/SL are
        the percentage thresholds from the entry open after the chart window.
      </p>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-3 h-auto w-full"
        role="img"
        aria-label="Schematic of lookback window, entry, horizon, take-profit and stop-loss"
      >
        <rect
          x={lookbackX0}
          y={PAD.top}
          width={Math.max(0, lookbackX1 - lookbackX0)}
          height={plotH}
          fill="rgba(255,255,255,0.06)"
        />
        <rect
          x={horizonX0}
          y={PAD.top}
          width={Math.max(0, horizonX1 - horizonX0)}
          height={plotH}
          fill="rgba(120,180,255,0.08)"
        />

        <text
          x={(lookbackX0 + lookbackX1) / 2}
          y={PAD.top - 10}
          textAnchor="middle"
          className="fill-white/45"
          style={{ fontSize: 11 }}
        >
          Lookback / chart window
        </text>
        <text
          x={(horizonX0 + horizonX1) / 2}
          y={PAD.top - 10}
          textAnchor="middle"
          className="fill-sky-200/70"
          style={{ fontSize: 11 }}
        >
          Horizon
        </text>

        <line
          x1={xAt(layout.entryIndex)}
          x2={horizonX1}
          y1={yAt(tpPrice)}
          y2={yAt(tpPrice)}
          stroke="rgba(110,231,160,0.85)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        <text
          x={horizonX1 + 4}
          y={yAt(tpPrice) + 4}
          className="fill-emerald-300/90"
          style={{ fontSize: 11 }}
        >
          {tpLabel}
        </text>
        <line
          x1={xAt(layout.entryIndex)}
          x2={horizonX1}
          y1={yAt(slPrice)}
          y2={yAt(slPrice)}
          stroke="rgba(252,165,165,0.85)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        <text
          x={horizonX1 + 4}
          y={yAt(slPrice) + 4}
          className="fill-red-300/90"
          style={{ fontSize: 11 }}
        >
          {slLabel}
        </text>

        <line
          x1={xAt(layout.entryIndex)}
          x2={horizonX1}
          y1={yAt(entryPrice)}
          y2={yAt(entryPrice)}
          stroke="rgba(255,255,255,0.25)"
          strokeWidth={1}
        />

        {useCandles
          ? series.map((b, i) => {
              const x = xAt(i);
              const up = b.close >= b.open;
              const color = i < layout.lookback ? (up ? "#a3a3a3" : "#737373") : up ? "#e5e5e5" : "#a3a3a3";
              return (
                <g key={i}>
                  <line x1={x} x2={x} y1={yAt(b.high)} y2={yAt(b.low)} stroke={color} strokeWidth={1} />
                  <rect
                    x={x - barW / 2}
                    y={yAt(Math.max(b.open, b.close))}
                    width={barW}
                    height={Math.max(1, Math.abs(yAt(b.open) - yAt(b.close)))}
                    fill={color}
                  />
                </g>
              );
            })
          : (
            <path d={linePath} fill="none" stroke="rgba(245,245,245,0.75)" strokeWidth={1.5} />
          )}

        <circle
          cx={xAt(layout.entryIndex)}
          cy={yAt(entryPrice)}
          r={4.5}
          fill="#fff"
          stroke="#0a0a0a"
          strokeWidth={1.5}
        />
        <text
          x={xAt(layout.entryIndex)}
          y={height - 12}
          textAnchor="middle"
          className="fill-white/70"
          style={{ fontSize: 11 }}
        >
          Entry
        </text>
      </svg>
    </div>
  );
}
