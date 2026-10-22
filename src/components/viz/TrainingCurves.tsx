import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SEMANTIC, SERIES, VIZ } from "@/lib/viz/tokens";
import { fmtNum, fmtPct, isFiniteNum, niceScale, paddedDomain } from "@/lib/viz/format";
import { ema } from "@/lib/viz/smoothing";
import { axisLabel, axisProps, ChartFrame, ChartPlaceholder, ChartTooltip, gridProps, type LegendItem } from "./chartKit";

export type EpochRow = {
  epoch: number;
  loss?: number | null;
  accuracy?: number | null;
  val_loss?: number | null;
  val_accuracy?: number | null;
  val_label_1_recall?: number | null;
};

type Metric = "loss" | "accuracy";

const SMOOTH_WEIGHT = 0.6;

function hasAny(rows: EpochRow[], key: keyof EpochRow) {
  return rows.some((r) => isFiniteNum(r[key]));
}

/**
 * Training vs validation curves per epoch. Raw values are plotted with straight segments between
 * epochs (no spline). Optional EMA smoothing draws the smoothed line over a faint raw line; the
 * tooltip always reports raw values.
 */
export function TrainingCurves({
  history,
  bestEpoch,
  height = 260,
  metrics = ["loss", "accuracy"],
  compact,
  exportName,
}: {
  history: EpochRow[];
  bestEpoch?: number | null;
  height?: number;
  metrics?: Metric[];
  compact?: boolean;
  exportName?: string;
}) {
  const [smooth, setSmooth] = useState(false);
  const [showRecall, setShowRecall] = useState(false);
  const rows = useMemo(() => {
    const sorted = [...history].filter((r) => isFiniteNum(r.epoch)).sort((a, b) => a.epoch - b.epoch);
    const keys = ["loss", "accuracy", "val_loss", "val_accuracy"] as const;
    const smoothed = Object.fromEntries(keys.map((k) => [k, ema(sorted.map((r) => r[k] ?? null), SMOOTH_WEIGHT)]));
    return sorted.map((r, i) => ({
      ...r,
      loss_s: smoothed.loss[i],
      accuracy_s: smoothed.accuracy[i],
      val_loss_s: smoothed.val_loss[i],
      val_accuracy_s: smoothed.val_accuracy[i],
    }));
  }, [history]);

  if (!rows.length) {
    return <ChartPlaceholder height={height}>No completed epochs yet. Curves appear after the first epoch finishes.</ChartPlaceholder>;
  }

  const showDots = rows.length <= 40;
  const toggle = (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-white/55">
      <input type="checkbox" className="h-3.5 w-3.5 accent-white" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} />
      Smooth (EMA {SMOOTH_WEIGHT})
    </label>
  );
  const recallAvailable = hasAny(rows, "val_label_1_recall");
  const recallToggle = recallAvailable ? (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-white/55" title="Share of validation images with label 1 that the model predicted as label 1">
      <input type="checkbox" className="h-3.5 w-3.5 accent-white" checked={showRecall} onChange={(e) => setShowRecall(e.target.checked)} />
      Label 1 recall
    </label>
  ) : null;

  type Spec = {
    m: Metric;
    trainKey: Metric;
    valKey: "val_loss" | "val_accuracy";
    hasTrain: boolean;
    hasVal: boolean;
    extraKey: "val_label_1_recall" | null;
    domain: [number, number] | undefined;
    ticks: number[] | undefined;
    fmt: (v: unknown) => string;
    tickFmt: (v: number) => string;
    legend: LegendItem[];
  };
  const charts = metrics
    .map((m): Spec | null => {
      const trainKey = m;
      const valKey: Spec["valKey"] = m === "loss" ? "val_loss" : "val_accuracy";
      const hasTrain = hasAny(rows, trainKey);
      const hasVal = hasAny(rows, valKey);
      if (!hasTrain && !hasVal) return null;
      const extraKey: Spec["extraKey"] = m === "accuracy" && showRecall && recallAvailable ? "val_label_1_recall" : null;
      const values = rows.flatMap((r) => [r[trainKey], r[valKey], extraKey ? r[extraKey] : null]);
      const clamp: [number, number] = m === "accuracy" ? [0, 1] : [0, Number.POSITIVE_INFINITY];
      const scale = niceScale(paddedDomain(values, { clamp, pad: 0.04 }), 5, clamp);
      const domain = scale?.domain;
      const ticks = scale?.ticks;
      const fmt = m === "accuracy" ? (v: unknown) => fmtPct(v, 1) : (v: unknown) => fmtNum(v, 4);
      const tickFmt = m === "accuracy" ? (v: number) => `${Number((v * 100).toFixed(1))}%` : (v: number) => String(Number(v.toFixed(3)));
      const legend: LegendItem[] = [
        ...(hasVal ? [{ label: "Validation", color: SEMANTIC.validation }] : []),
        ...(hasTrain ? [{ label: "Training", color: SERIES.primary.color, dash: SERIES.secondary.dash }] : []),
        ...(extraKey ? [{ label: "Val. recall (label 1)", color: SERIES.tertiary.color, dash: SERIES.tertiary.dash }] : []),
      ];
      return { m, trainKey, valKey, hasTrain, hasVal, extraKey, domain, ticks, fmt, tickFmt, legend };
    })
    .filter((c): c is Spec => c !== null);

  return (
    <div className={compact ? "space-y-5" : "grid gap-6 xl:grid-cols-2"}>
      {charts.map((c, idx) => (
        <ChartFrame
          key={c.m}
          title={c.m === "loss" ? "Loss" : "Accuracy"}
          note={
            c.m === "loss"
              ? "Binary cross-entropy per epoch. Lower is better."
              : `Share of images classified correctly per epoch.${c.hasVal ? "" : " No validation split was recorded."}`
          }
          legend={c.legend}
          height={height}
          aside={
            <>
              {idx === 0 ? toggle : null}
              {c.m === "accuracy" ? recallToggle : null}
            </>
          }
          csv={
            exportName
              ? {
                  filename: `${exportName}_${c.m}.csv`,
                  rows,
                  columns: [{ key: "epoch" }, { key: c.trainKey }, { key: c.valKey }, ...(c.extraKey ? [{ key: c.extraKey }] : [])],
                }
              : undefined
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 14, left: 4 }}>
              <CartesianGrid {...gridProps} />
              <XAxis
                dataKey="epoch"
                type="number"
                domain={["dataMin", "dataMax"]}
                allowDecimals={false}
                {...axisProps}
                label={axisLabel("Epoch", "x")}
              />
              <YAxis {...axisProps} width={52} domain={c.domain ?? ["auto", "auto"]} ticks={c.ticks} interval={0} tickFormatter={c.tickFmt} label={axisLabel(c.m === "loss" ? "Loss" : "Accuracy", "y")} />
              <Tooltip
                cursor={{ stroke: "rgba(255,255,255,0.25)", strokeWidth: 1 }}
                content={
                  <ChartTooltip
                    labelFormat={(l) => `Epoch ${l}${bestEpoch != null && Number(l) === bestEpoch ? " · best val loss" : ""}`}
                    format={(v) => c.fmt(v)}
                  />
                }
              />
              {bestEpoch != null ? (
                <ReferenceLine
                  x={bestEpoch}
                  stroke="rgba(255,255,255,0.35)"
                  strokeDasharray="3 4"
                  label={{ value: `Best · ${bestEpoch}`, position: "insideTopRight", fill: "rgba(255,255,255,0.55)", fontSize: 11.5 }}
                />
              ) : null}
              {c.hasTrain ? (
                <Line
                  type="linear"
                  dataKey={c.trainKey}
                  name="Training"
                  stroke={SERIES.primary.color}
                  strokeOpacity={smooth ? 0.3 : 1}
                  strokeWidth={VIZ.stroke.secondary}
                  strokeDasharray={SERIES.secondary.dash}
                  dot={showDots && !smooth ? { r: 2, fill: SERIES.primary.color, strokeWidth: 0 } : false}
                  activeDot={{ r: 3.5 }}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              ) : null}
              {c.hasVal ? (
                <Line
                  type="linear"
                  dataKey={c.valKey}
                  name="Validation"
                  stroke={SEMANTIC.validation}
                  strokeOpacity={smooth ? 0.3 : 1}
                  strokeWidth={VIZ.stroke.primary}
                  dot={showDots && !smooth ? { r: 2.5, fill: SEMANTIC.validation, strokeWidth: 0 } : false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              ) : null}
              {c.extraKey ? (
                <Line
                  type="linear"
                  dataKey={c.extraKey}
                  name="Val. recall (label 1)"
                  stroke={SERIES.tertiary.color}
                  strokeWidth={VIZ.stroke.reference}
                  strokeDasharray={SERIES.tertiary.dash}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              ) : null}
              {smooth && c.hasTrain ? (
                <Line type="linear" dataKey={`${c.trainKey}_s`} name="Training (smoothed)" stroke={SERIES.primary.color} strokeWidth={VIZ.stroke.secondary} strokeDasharray={SERIES.secondary.dash} dot={false} isAnimationActive={false} legendType="none" tooltipType="none" />
              ) : null}
              {smooth && c.hasVal ? (
                <Line type="linear" dataKey={`${c.valKey}_s`} name="Validation (smoothed)" stroke={SEMANTIC.validation} strokeWidth={VIZ.stroke.primary} dot={false} isAnimationActive={false} legendType="none" tooltipType="none" />
              ) : null}
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      ))}
    </div>
  );
}
