import { useMemo } from "react";
import Plot from "react-plotly.js";
import type { Data, Layout } from "plotly.js";
import { analysisPlotLayout } from "./analysisPlotTheme";
import { ChartTitleChip } from "./AnalysisChartChrome";
import { cn } from "@/lib/utils";

type Props = {
  src: string;
  title?: string;
  hint?: string;
  /** Spatial width in pixels (matches model input). */
  widthPx: number;
  heightPx: number;
  className?: string;
};

/**
 * Presents a raster chart input inside the same chart shell as the analysis plots
 * (no axes, no legend — title rendered as an overlay chip). The outer container
 * adopts the image's native aspect ratio so the box *fits* the chart, never stretches.
 */
export function RasterChartPanel({
  src,
  title = "Model input",
  hint,
  widthPx,
  heightPx,
  className,
}: Props) {
  const { data, layout } = useMemo(() => {
    const base = analysisPlotLayout();
    const traces: Data[] = [
      {
        type: "scatter",
        mode: "markers",
        x: [0, widthPx],
        y: [0, heightPx],
        marker: { size: 0, opacity: 0 },
        showlegend: false,
        hoverinfo: "skip",
      },
    ];
    const layoutIn: Partial<Layout> = {
      ...base,
      images: [
        {
          source: src,
          xref: "x",
          yref: "y",
          x: 0,
          y: 0,
          sizex: widthPx,
          sizey: heightPx,
          sizing: "stretch",
          layer: "below",
          xanchor: "left",
          yanchor: "bottom",
        },
      ],
      xaxis: { ...base.xaxis, range: [0, widthPx], constrain: "domain" },
      yaxis: { ...base.yaxis, range: [heightPx, 0], scaleanchor: "x" },
      margin: { l: 0, r: 0, t: 0, b: 0 },
    };
    return { data: traces, layout: layoutIn };
  }, [src, widthPx, heightPx]);

  return (
    <div
      className={cn("relative w-full", className)}
      style={{ aspectRatio: widthPx / heightPx }}
    >
      {title ? <ChartTitleChip label={title} sub={hint} /> : null}
      <Plot
        data={data}
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
