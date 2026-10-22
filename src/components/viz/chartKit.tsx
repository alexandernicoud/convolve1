import type { ReactNode } from "react";
import { Download } from "lucide-react";
import { VIZ } from "@/lib/viz/tokens";
import { downloadText, isFiniteNum, MISSING, toCsv } from "@/lib/viz/format";

/** Recharts axis props: quiet axis line, readable ticks, no tick marks. */
export const axisProps = {
  stroke: VIZ.axisLine,
  tick: { fill: VIZ.tick, fontSize: VIZ.tickSize, fontFamily: VIZ.digits },
  tickLine: false,
} as const;

export const gridProps = { stroke: VIZ.grid, vertical: false } as const;

export function axisLabel(value: string, axis: "x" | "y") {
  return axis === "x"
    ? { value, position: "insideBottom" as const, offset: -2, fill: VIZ.axisTitle, fontSize: VIZ.axisTitleSize }
    : { value, angle: -90, position: "insideLeft" as const, offset: 12, fill: VIZ.axisTitle, fontSize: VIZ.axisTitleSize, style: { textAnchor: "middle" as const } };
}

type TooltipRow = { name?: string | number; value?: unknown; color?: string; dataKey?: string | number; payload?: Record<string, unknown> };

/** Shared tooltip body. Pass `format` to render values with units; missing values show an em dash. */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormat,
  format,
}: {
  active?: boolean;
  payload?: TooltipRow[];
  label?: unknown;
  labelFormat?: (label: unknown) => ReactNode;
  format?: (value: unknown, key: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="min-w-[150px] rounded-[10px] border px-3 py-2 shadow-[0_12px_32px_rgba(0,0,0,0.6)]"
      style={{ background: VIZ.tooltip.background, borderColor: VIZ.tooltip.border, fontSize: VIZ.tooltip.fontSize }}
    >
      {label != null ? <p className="mb-1.5 text-white/50">{labelFormat ? labelFormat(label) : String(label)}</p> : null}
      <ul className="space-y-1">
        {payload.map((row, i) => (
          <li key={`${row.dataKey ?? i}`} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-white/70">
              <span className="h-0.5 w-3 rounded-full" style={{ background: row.color }} />
              {row.name}
            </span>
            <span className="font-digits tabular-nums text-white">
              {format ? format(row.value, String(row.dataKey ?? "")) : isFiniteNum(row.value) ? row.value.toFixed(3) : MISSING}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type LegendItem = { label: string; color: string; dash?: string; kind?: "line" | "dot" | "area" };

/** HTML legend: readable at any chart size, consistent across libraries. */
export function SeriesLegend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <ul className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-white/60 ${className ?? ""}`}>
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2">
          {it.kind === "dot" ? (
            <span className="h-2 w-2 rounded-full" style={{ background: it.color }} />
          ) : it.kind === "area" ? (
            <span className="h-2.5 w-3.5 rounded-sm" style={{ background: it.color }} />
          ) : (
            <svg width="18" height="6" aria-hidden>
              <line x1="0" y1="3" x2="18" y2="3" stroke={it.color} strokeWidth="2" strokeDasharray={it.dash} />
            </svg>
          )}
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Chart block: title, one-line reading note, legend, optional CSV export, then the plot.
 * The plot area has an explicit height so ResponsiveContainer never collapses.
 */
export function ChartFrame({
  title,
  note,
  legend,
  height = 240,
  csv,
  aside,
  children,
  className,
  ariaLabel,
}: {
  title?: ReactNode;
  note?: ReactNode;
  legend?: LegendItem[];
  height?: number | string;
  csv?: { filename: string; rows: Record<string, unknown>[]; columns: { key: string; label?: string }[] };
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <figure className={`min-w-0 ${className ?? ""}`} aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}>
      {title || legend || csv || aside ? (
        <figcaption className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title ? <p className="text-[14px] font-medium text-[#F5F5F5]">{title}</p> : null}
            {note ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-white/45">{note}</p> : null}
          </div>
          <div className="flex items-center gap-3">
            {legend ? <SeriesLegend items={legend} /> : null}
            {aside}
            {csv ? (
              <button
                type="button"
                onClick={() => downloadText(csv.filename, toCsv(csv.rows, csv.columns))}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/[0.12] px-2 text-[12px] text-white/60 transition hover:border-white/30 hover:text-white"
                title="Download the plotted values as CSV"
              >
                <Download className="h-3.5 w-3.5" />
                CSV
              </button>
            ) : null}
          </div>
        </figcaption>
      ) : null}
      <div style={{ height }} className="min-w-0">
        {children}
      </div>
    </figure>
  );
}

/** Placeholder with the plot's footprint for loading / empty / unavailable states. */
export function ChartPlaceholder({ height = 240, children }: { height?: number | string; children: ReactNode }) {
  return (
    <div style={{ height }} className="flex items-center justify-center rounded-lg border border-dashed border-white/[0.1] px-6 text-center text-[13px] leading-relaxed text-white/40">
      {children}
    </div>
  );
}
