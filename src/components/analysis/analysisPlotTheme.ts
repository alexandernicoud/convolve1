import type { ColorScale, Layout } from "plotly.js";

/** Shared dark analysis UI (aligned with optimizer results). */
export const ANALYSIS_BG = "#0c0c0e";
export const ANALYSIS_GRID = "rgba(255,255,255,0.06)";
export const ANALYSIS_TEXT = "rgba(245,245,245,0.55)";
export const ANALYSIS_TITLE = "rgba(245,245,245,0.92)";

/** Homogeneous heatmap ramp: dark → indigo/violet → off-white (no random jet). */
export const CONVOLVE_HEATMAP_SCALE: ColorScale = [
  [0, "rgb(8,8,12)"],
  [0.2, "rgb(42,36,68)"],
  [0.45, "rgb(88,72,140)"],
  [0.7, "rgb(150,130,200)"],
  [0.88, "rgb(210,200,235)"],
  [1, "rgb(248,248,252)"],
];

/**
 * Premium analysis layout: transparent paper, no axes, no native legend,
 * near-zero margins so chart content fills its container edge-to-edge.
 * Titles/legends are rendered as HTML chips (see AnalysisChartChrome.tsx).
 */
export function analysisPlotLayout(overrides: Partial<Layout> = {}): Partial<Layout> {
  return {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "ui-sans-serif, system-ui, sans-serif", size: 11, color: ANALYSIS_TEXT },
    margin: { l: 6, r: 6, t: 6, b: 6 },
    xaxis: {
      visible: false,
      showgrid: false,
      zeroline: false,
      fixedrange: true,
    },
    yaxis: {
      visible: false,
      showgrid: false,
      zeroline: false,
      fixedrange: true,
    },
    showlegend: false,
    hoverlabel: {
      bgcolor: "rgba(10,10,12,0.92)",
      bordercolor: "rgba(255,255,255,0.12)",
      font: { size: 11, color: ANALYSIS_TITLE },
    },
    ...overrides,
  };
}
