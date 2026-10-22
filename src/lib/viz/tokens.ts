/**
 * Convolve visualization tokens. One source for chart colours, type and strokes across Recharts,
 * Plotly and canvas renderers. Monochrome first; colour only where it encodes a distinction.
 */

export const VIZ = {
  /** Plot surfaces sit on the black card (`dashboardCard`); charts never paint their own background. */
  background: "transparent",
  grid: "rgba(255,255,255,0.07)",
  axisLine: "rgba(255,255,255,0.16)",
  tick: "rgba(255,255,255,0.5)",
  axisTitle: "rgba(255,255,255,0.42)",
  tickSize: 11.5,
  axisTitleSize: 11.5,
  font: "Inter, ui-sans-serif, system-ui, sans-serif",
  digits: "Outfit, Inter, ui-sans-serif, sans-serif",
  tooltip: {
    background: "#000",
    border: "rgba(255,255,255,0.14)",
    radius: 10,
    fontSize: 12.5,
  },
  stroke: { primary: 2, secondary: 1.5, reference: 1 },
  marker: { small: 2.5, default: 3.5, active: 5 },
} as const;

/** Series hierarchy: brightness + dash pattern carry identity, so charts survive greyscale printing. */
export const SERIES = {
  primary: { color: "rgba(255,255,255,0.94)", dash: undefined as string | undefined },
  secondary: { color: "rgba(255,255,255,0.56)", dash: "5 4" },
  tertiary: { color: "rgba(255,255,255,0.32)", dash: "1.5 3" },
  quaternary: { color: "rgba(190,190,190,0.7)", dash: "6 2 1 2" },
} as const;

export const SERIES_ORDER = [SERIES.primary, SERIES.secondary, SERIES.tertiary, SERIES.quaternary];

/**
 * Semantic colours. Use sparingly:
 * - `validation` distinguishes held-out from training series.
 * - `positive`/`negative` only for signed financial quantities or signed effects.
 * - `warning` for low sample size / caveats, `danger` for failures.
 * - `classA`/`classB` are the two label colours used everywhere (label 0 / label 1).
 */
export const SEMANTIC = {
  training: "rgba(255,255,255,0.92)",
  validation: "#8EC5FF",
  positive: "#6EE7B7",
  negative: "#FCA5A5",
  warning: "#FCD34D",
  danger: "#F87171",
  classA: "rgba(255,255,255,0.78)",
  classB: "#8EC5FF",
  highlight: "#FFFFFF",
} as const;

export const CLASS_COLORS: Record<string, string> = { "0": SEMANTIC.classA, "1": SEMANTIC.classB };
