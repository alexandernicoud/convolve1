import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Technical chart chrome                                                     */
/*                                                                            */
/*  Minimal, engineering-manual-style wrappers that decorate the existing     */
/*  charts with instrument-panel affordances:                                 */
/*    · corner brackets                                                        */
/*    · monospace identifier + label strip above                              */
/*    · dimension tag pinned to the bottom-right                              */
/*    · optional SpecStrip (key/value bar) below                              */
/*                                                                            */
/*  Nothing here draws actual data-bearing visuals except SignalStrip, which  */
/*  renders a 1-D projection of a 2-D heatmap as a thin spectrum rail.        */
/* -------------------------------------------------------------------------- */

export function CornerBrackets({
  className,
  tone = "default",
}: {
  className?: string;
  tone?: "default" | "dim";
}) {
  const color = tone === "dim" ? "border-white/15" : "border-white/30";
  const base = cn("pointer-events-none absolute h-3 w-3", color);
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 z-[4]", className)}
    >
      <span className={cn(base, "left-0 top-0 border-l border-t")} />
      <span className={cn(base, "right-0 top-0 border-r border-t")} />
      <span className={cn(base, "bottom-0 left-0 border-b border-l")} />
      <span className={cn(base, "bottom-0 right-0 border-b border-r")} />
    </div>
  );
}

type TechFrameProps = {
  /** Monospace identifier shown at the top-left (e.g. "F.01" or "D.03"). */
  tag?: string;
  /** Small-caps label rendered next to the tag. */
  label?: string;
  /** Dimension string overlaid on bottom-right of the content (e.g. "224 × 224"). */
  dim?: string;
  /** Right-aligned status text on the label row. */
  status?: string;
  /** Optional key/value row rendered below the content. */
  spec?: Array<{ key: string; value: string }>;
  /** Draw the four corner brackets on the content. Default true. */
  brackets?: boolean;
  /** Skip the leading tag/label row. */
  hideHeader?: boolean;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function TechFrame({
  tag,
  label,
  dim,
  status,
  spec,
  brackets = true,
  hideHeader = false,
  children,
  className,
  contentClassName,
}: TechFrameProps) {
  const showHeader = !hideHeader && (tag || label || status);
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      {showHeader ? (
        <div className="mb-1.5 flex items-center gap-2">
          {tag ? (
            <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.22em] text-white/60">
              {tag}
            </span>
          ) : null}
          {label ? (
            <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-white/40">
              {label}
            </span>
          ) : null}
          <span aria-hidden className="h-px flex-1 bg-white/[0.06]" />
          {status ? (
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">
              {status}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={cn("relative min-w-0", contentClassName)}>
        {children}
        {brackets ? <CornerBrackets /> : null}
        {dim ? (
          <span className="pointer-events-none absolute bottom-2 left-2 z-[5] rounded-md border border-white/[0.08] bg-black/55 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-white/60 backdrop-blur-md">
            {dim}
          </span>
        ) : null}
      </div>
      {spec && spec.length > 0 ? <SpecStrip items={spec} className="mt-2" /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

type SpecStripProps = {
  items: Array<{ key: string; value: string }>;
  className?: string;
};

export function SpecStrip({ items, className }: SpecStripProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-md border border-white/[0.06] bg-white/[0.015] px-2.5 py-1.5 font-mono text-[9.5px]",
        className,
      )}
    >
      {items.map((s, i) => (
        <span key={`${s.key}-${i}`} className="inline-flex items-center gap-1.5">
          <span className="uppercase tracking-[0.18em] text-white/40">{s.key}</span>
          <span className="tabular-nums text-white/75">{s.value}</span>
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Convolve heatmap scale stops as normalized RGB triples. */
const RAMP: Array<[number, [number, number, number]]> = [
  [0, [8, 8, 12]],
  [0.2, [42, 36, 68]],
  [0.45, [88, 72, 140]],
  [0.7, [150, 130, 200]],
  [0.88, [210, 200, 235]],
  [1, [248, 248, 252]],
];

function rampColor(t: number): string {
  const u = Math.max(0, Math.min(1, t));
  for (let i = 0; i < RAMP.length - 1; i++) {
    const [a, ca] = RAMP[i];
    const [b, cb] = RAMP[i + 1];
    if (u >= a && u <= b) {
      const k = (u - a) / (b - a || 1);
      const r = Math.round(ca[0] + k * (cb[0] - ca[0]));
      const g = Math.round(ca[1] + k * (cb[1] - ca[1]));
      const bl = Math.round(ca[2] + k * (cb[2] - ca[2]));
      return `rgb(${r}, ${g}, ${bl})`;
    }
  }
  return "rgb(248, 248, 252)";
}

type SignalStripProps = {
  /** Raw numeric samples (a 1-D projection of a heatmap). */
  values: number[];
  /** Displayed height in px. */
  height?: number;
  className?: string;
  /** Optional overlay label (e.g. "mean over rows"). */
  label?: string;
};

/**
 * Renders a 1-D sequence as a thin horizontal spectrum rail using the Convolve
 * heatmap ramp — a compact, tech-y complement to 2-D heatmap panels.
 */
export function SignalStrip({ values, height = 22, className, label }: SignalStripProps) {
  if (!values.length) {
    return (
      <div
        className={cn("w-full rounded-md border border-white/[0.07] bg-white/[0.015]", className)}
        style={{ height }}
      />
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-md border border-white/[0.07] bg-[#0c0c0e]",
        className,
      )}
      style={{ height }}
    >
      <div className="flex h-full w-full">
        {values.map((v, i) => (
          <span
            key={i}
            aria-hidden
            className="inline-block h-full flex-1"
            style={{ backgroundColor: rampColor((v - min) / range) }}
          />
        ))}
      </div>
      {label ? (
        <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 font-mono text-[8.5px] uppercase tracking-[0.2em] text-white/75 mix-blend-screen">
          {label}
        </span>
      ) : null}
    </div>
  );
}

/** Axis-of-columns mean projection of a 2-D heatmap (1 value per column). */
export function columnProjection(z: number[][]): number[] {
  const rows = z.length;
  const cols = z[0]?.length ?? 0;
  if (!rows || !cols) return [];
  const out = new Array<number>(cols).fill(0);
  for (let r = 0; r < rows; r++) {
    const row = z[r];
    for (let c = 0; c < cols; c++) out[c] += row[c] ?? 0;
  }
  for (let c = 0; c < cols; c++) out[c] /= rows;
  return out;
}

/* -------------------------------------------------------------------------- */

type DepthRailProps = {
  /** Total number of layers in the stack. */
  total: number;
  /** Current (0-based) position. */
  index: number;
  className?: string;
};

/**
 * Vertical "layer depth" indicator — a thin rail with ticks, used in §4/§5 to
 * convey where in the network stack a figure sits.
 */
export function DepthRail({ total, index, className }: DepthRailProps) {
  const n = Math.max(1, total);
  return (
    <div
      className={cn(
        "relative flex h-full min-h-[60px] w-4 shrink-0 flex-col items-center justify-between py-1",
        className,
      )}
      aria-hidden
    >
      <span className="h-full w-px bg-white/10" />
      <div className="absolute inset-y-0 flex w-full flex-col items-center justify-between py-1">
        {Array.from({ length: n }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-[5px] w-[5px] rounded-full border",
              i === index
                ? "border-white/80 bg-white"
                : "border-white/20 bg-white/10",
            )}
          />
        ))}
      </div>
    </div>
  );
}
