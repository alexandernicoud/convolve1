import { cn } from "@/lib/utils";

/**
 * Reusable overlay chips used across the analysis charts so Plotly's axis/legend/title chrome
 * can be turned off entirely — giving every chart maximum fill + a consistent premium look.
 */

type ChartTitleChipProps = {
  label: string;
  sub?: string;
  className?: string;
};

export function ChartTitleChip({ label, sub, className }: ChartTitleChipProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute left-3 top-3 z-10 inline-flex max-w-[calc(100%-6rem)] items-center gap-2 rounded-full border border-white/[0.09] bg-black/55 px-3 py-1 backdrop-blur-md",
        className,
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/60" />
      <span className="truncate text-[10px] font-medium uppercase tracking-[0.18em] text-white/80">
        {label}
      </span>
      {sub ? (
        <>
          <span aria-hidden className="h-3 w-px shrink-0 bg-white/15" />
          <span className="truncate text-[10px] text-white/45">{sub}</span>
        </>
      ) : null}
    </div>
  );
}

export type LegendItem = {
  label: string;
  color: string;
  /** Optional short caption appended to the dot/label (e.g., "78%"). */
  value?: string;
};

type PremiumChartLegendProps = {
  items: LegendItem[];
  className?: string;
  /** Where the pill is anchored relative to its parent. Default: top-right. */
  position?: "top-right" | "top-center" | "bottom-right" | "bottom-center";
};

const POSITION_CLASSES: Record<NonNullable<PremiumChartLegendProps["position"]>, string> = {
  "top-right": "right-3 top-3",
  "top-center": "left-1/2 top-3 -translate-x-1/2",
  "bottom-right": "bottom-3 right-3",
  "bottom-center": "bottom-3 left-1/2 -translate-x-1/2",
};

export function PremiumChartLegend({
  items,
  className,
  position = "top-right",
}: PremiumChartLegendProps) {
  if (!items.length) return null;
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-10 inline-flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-white/[0.09] bg-black/55 px-3 py-1 backdrop-blur-md",
        POSITION_CLASSES[position],
        className,
      )}
    >
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span
            aria-hidden
            className="inline-block h-[2px] w-3.5 shrink-0 rounded-full"
            style={{ background: it.color }}
          />
          <span className="text-[11px] font-medium text-white/80">{it.label}</span>
          {it.value ? (
            <span className="text-[11px] tabular-nums text-white/45">{it.value}</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

/**
 * Compact labeled color legend for heatmap plots. Renders the Convolve ramp as a short
 * gradient rail with "low / high" markers, so viewers can read heatmap intensity without
 * relying on a bulky Plotly colorbar.
 */

type HeatmapScaleChipProps = {
  label?: string;
  minLabel?: string;
  maxLabel?: string;
  className?: string;
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-center";
};

const SCALE_POSITIONS: Record<NonNullable<HeatmapScaleChipProps["position"]>, string> = {
  "bottom-right": "bottom-2.5 right-2.5",
  "bottom-left": "bottom-2.5 left-2.5",
  "top-right": "right-2.5 top-2.5",
  "top-center": "left-1/2 top-2.5 -translate-x-1/2",
};

export function HeatmapScaleChip({
  label = "Intensity",
  minLabel = "low",
  maxLabel = "high",
  className,
  position = "bottom-right",
}: HeatmapScaleChipProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-10 inline-flex items-center gap-2 rounded-full border border-white/[0.09] bg-black/60 px-2.5 py-1 backdrop-blur-md",
        SCALE_POSITIONS[position],
        className,
      )}
    >
      <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/55">
        {label}
      </span>
      <span className="text-[9.5px] tabular-nums text-white/45">{minLabel}</span>
      <span
        aria-hidden
        className="h-1.5 w-14 rounded-full"
        style={{
          background:
            "linear-gradient(to right, rgb(8,8,12) 0%, rgb(42,36,68) 20%, rgb(88,72,140) 45%, rgb(150,130,200) 70%, rgb(210,200,235) 88%, rgb(248,248,252) 100%)",
        }}
      />
      <span className="text-[9.5px] font-medium tabular-nums text-white/85">{maxLabel}</span>
    </div>
  );
}

/**
 * Outer frame shared by every analysis chart: rounded, subtle border, solid panel bg,
 * clips all content so Plot strokes never bleed past the rounded corners.
 */
type ChartFrameProps = {
  children: React.ReactNode;
  className?: string;
  /** Applied as inline height when a fixed height is required (Plotly needs a measured parent). */
  height?: number | string;
};

export function ChartFrame({ children, className, height }: ChartFrameProps) {
  return (
    <div
      className={cn(
        "relative min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c0e]",
        className,
      )}
      style={height != null ? { height } : undefined}
    >
      {children}
    </div>
  );
}
