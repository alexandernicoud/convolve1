import { useMemo } from "react";
import Plot from "react-plotly.js";
import type { Data, Layout } from "plotly.js";
import type { TrainerHistoryEpoch } from "@/lib/api";
import { analysisPlotLayout } from "./analysisPlotTheme";
import {
  ChartTitleChip,
  PremiumChartLegend,
  type LegendItem,
} from "./AnalysisChartChrome";
import { cn } from "@/lib/utils";

const CHART_HEIGHT = 300;

const C = {
  trainAcc: "rgba(245,245,245,0.95)",
  valAcc: "rgba(180,180,190,0.9)",
  label1: "#a78bfa",
  trainLoss: "rgba(245,245,245,0.9)",
  valLoss: "rgba(139,140,180,0.95)",
};

type ChartProps = {
  history: TrainerHistoryEpoch[];
  className?: string;
  height?: number;
};

function EmptyCard({ label, className, height }: { label: string; className?: string; height: number }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c0e] text-xs text-white/40",
        className,
      )}
      style={{ height }}
    >
      {label}
    </div>
  );
}

/** Training / validation / per-class accuracy over epochs. */
export function AccuracyPlot({ history, className, height = CHART_HEIGHT }: ChartProps) {
  const { traces, layout, hasSeries, legend } = useMemo(() => {
    const epochs = history.map((h) => h.epoch);
    const trainAcc = history.map((h) => (h.accuracy != null ? Number(h.accuracy) : null));
    const valAcc = history.map((h) => (h.val_accuracy != null ? Number(h.val_accuracy) : null));
    const label1 = history.map((h) => {
      const v = h.val_label_1_accuracy ?? h.val_label_1_recall;
      return v != null && !Number.isNaN(Number(v)) ? Number(v) : null;
    });

    const has = epochs.some((_, i) => trainAcc[i] != null || valAcc[i] != null || label1[i] != null);

    const tracesIn: Data[] = [
      {
        type: "scatter",
        mode: "lines",
        name: "Training accuracy",
        x: epochs,
        y: trainAcc,
        line: { color: C.trainAcc, width: 2, shape: "spline", smoothing: 0.6 },
        connectgaps: false,
        hovertemplate: "Epoch %{x}<br>%{y:.1%}<extra>Training</extra>",
      },
      {
        type: "scatter",
        mode: "lines",
        name: "Validation accuracy",
        x: epochs,
        y: valAcc,
        line: { color: C.valAcc, width: 2, shape: "spline", smoothing: 0.6 },
        connectgaps: false,
        hovertemplate: "Epoch %{x}<br>%{y:.1%}<extra>Validation</extra>",
      },
      {
        type: "scatter",
        mode: "lines",
        name: "Val · label 1",
        x: epochs,
        y: label1,
        line: { color: C.label1, width: 2, shape: "spline", smoothing: 0.6 },
        connectgaps: false,
        hovertemplate: "Epoch %{x}<br>%{y:.1%}<extra>Label 1</extra>",
      },
    ];

    const base = analysisPlotLayout();
    const layoutIn: Partial<Layout> = {
      ...base,
      margin: { l: 10, r: 10, t: 10, b: 10 },
      yaxis: { ...base.yaxis, range: [0, 1] },
    };

    const legendItems: LegendItem[] = [
      { label: "Training", color: C.trainAcc },
      { label: "Validation", color: C.valAcc },
      { label: "Label 1", color: C.label1 },
    ];

    return { traces: tracesIn, layout: layoutIn, hasSeries: has, legend: legendItems };
  }, [history]);

  if (!hasSeries) return <EmptyCard label="No accuracy series." className={className} height={height} />;

  return (
    <div
      className={cn(
        "relative min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c0e]",
        className,
      )}
      style={{ height }}
    >
      <ChartTitleChip label="Accuracy" sub="per epoch" />
      <PremiumChartLegend items={legend} />
      <Plot
        data={traces}
        layout={layout as Layout}
        config={{ responsive: true, displayModeBar: false, displaylogo: false }}
        style={{ width: "100%", height: "100%" }}
        useResizeHandler
      />
    </div>
  );
}

/** Training / validation loss over epochs. */
export function LossPlot({ history, className, height = CHART_HEIGHT }: ChartProps) {
  const { traces, layout, hasSeries, legend } = useMemo(() => {
    const epochs = history.map((h) => h.epoch);
    const trainLoss = history.map((h) => (h.loss != null ? Number(h.loss) : null));
    const valLoss = history.map((h) => (h.val_loss != null ? Number(h.val_loss) : null));
    const has = epochs.some((_, i) => trainLoss[i] != null || valLoss[i] != null);

    const tracesIn: Data[] = [
      {
        type: "scatter",
        mode: "lines",
        name: "Training loss",
        x: epochs,
        y: trainLoss,
        line: { color: C.trainLoss, width: 2, shape: "spline", smoothing: 0.6 },
        connectgaps: false,
        hovertemplate: "Epoch %{x}<br>%{y:.4f}<extra>Training</extra>",
      },
      {
        type: "scatter",
        mode: "lines",
        name: "Validation loss",
        x: epochs,
        y: valLoss,
        line: { color: C.valLoss, width: 2, shape: "spline", smoothing: 0.6 },
        connectgaps: false,
        hovertemplate: "Epoch %{x}<br>%{y:.4f}<extra>Validation</extra>",
      },
    ];

    const base = analysisPlotLayout();
    const layoutIn: Partial<Layout> = {
      ...base,
      margin: { l: 10, r: 10, t: 10, b: 10 },
      yaxis: { ...base.yaxis, autorange: true },
    };

    const legendItems: LegendItem[] = [
      { label: "Training", color: C.trainLoss },
      { label: "Validation", color: C.valLoss },
    ];

    return { traces: tracesIn, layout: layoutIn, hasSeries: has, legend: legendItems };
  }, [history]);

  if (!hasSeries) return <EmptyCard label="No loss series." className={className} height={height} />;

  return (
    <div
      className={cn(
        "relative min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c0e]",
        className,
      )}
      style={{ height }}
    >
      <ChartTitleChip label="Loss" sub="per epoch" />
      <PremiumChartLegend items={legend} />
      <Plot
        data={traces}
        layout={layout as Layout}
        config={{ responsive: true, displayModeBar: false, displaylogo: false }}
        style={{ width: "100%", height: "100%" }}
        useResizeHandler
      />
    </div>
  );
}

/** Legacy side-by-side layout retained for backward compatibility. */
type Props = {
  history: TrainerHistoryEpoch[];
  className?: string;
};

export function TrainingMetricsPlots({ history, className }: Props) {
  return (
    <div className={cn("grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch", className)}>
      <AccuracyPlot history={history} />
      <LossPlot history={history} />
    </div>
  );
}
