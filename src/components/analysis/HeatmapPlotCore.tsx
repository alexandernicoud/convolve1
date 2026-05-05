import { useMemo } from "react";
import Plot from "react-plotly.js";
import type { Data, Layout } from "plotly.js";
import { analysisPlotLayout, CONVOLVE_HEATMAP_SCALE } from "./analysisPlotTheme";
import { ChartTitleChip } from "./AnalysisChartChrome";
import { cn } from "@/lib/utils";

type Props = {
  z: number[][];
  /** Shown as an overlay chip in the top-left so the plot fills the box. */
  title?: string;
  /** Optional one-liner subtitle on the title chip. */
  hint?: string;
  className?: string;
  /**
   * Preserve the data's native aspect ratio. On by default — the caller is
   * responsible for sizing the outer container so the box *fits* the chart.
   */
  preserveAspect?: boolean;
};

/**
 * Axis-less, colorbar-less heatmap that fills its parent container.
 * By default the aspect ratio of the underlying grid is preserved; set
 * `preserveAspect={false}` to let the heatmap stretch to fill a non-matching box.
 */
export function HeatmapPlotCore({
  z,
  title,
  hint,
  className,
  preserveAspect = true,
}: Props) {
  const { traces, layout } = useMemo(() => {
    const base = analysisPlotLayout();
    const tracesIn: Data[] = [
      {
        type: "heatmap",
        z,
        colorscale: CONVOLVE_HEATMAP_SCALE,
        hoverongaps: false,
        showscale: false,
      },
    ];
    const layoutIn: Partial<Layout> = {
      ...base,
      margin: { l: 0, r: 0, t: 0, b: 0 },
      xaxis: {
        ...base.xaxis,
        ...(preserveAspect ? { constrain: "domain" as const } : {}),
      },
      yaxis: {
        ...base.yaxis,
        autorange: "reversed",
        ...(preserveAspect ? { scaleanchor: "x" as const } : {}),
      },
    };
    return { traces: tracesIn, layout: layoutIn };
  }, [z, preserveAspect]);

  return (
    <div className={cn("relative h-full w-full", className)}>
      {title ? <ChartTitleChip label={title} sub={hint} /> : null}
      <Plot
        data={traces}
        layout={layout as Layout}
        config={{
          responsive: true,
          displayModeBar: false,
          displaylogo: false,
        }}
        style={{ width: "100%", height: "100%" }}
        useResizeHandler
      />
    </div>
  );
}

/** Utility: aspect ratio of a 2D grid (cols / rows). */
export function heatmapAspectRatio(z: number[][]): number {
  const rows = z.length || 1;
  const cols = z[0]?.length ?? 1;
  return cols / rows;
}
