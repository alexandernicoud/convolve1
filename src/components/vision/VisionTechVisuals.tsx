import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Vision page — tech chrome accents                                          */
/*                                                                            */
/*  Minimal, restrained engineering affordances used to reinforce the         */
/*  narrative visuals in §02, §03 and §04 of the homepage:                    */
/*    · corner brackets around a hero image                                   */
/*    · monospace tag + small-caps label strip above                          */
/*    · spec row (key/value pairs)                                            */
/*    · feature-chip ledger (§02)                                             */
/*    · pipeline flow strip (§04)                                             */
/*    · emergent projection rail (§03)                                        */
/* -------------------------------------------------------------------------- */

export function VisionCornerBrackets({
  className,
  tone = "default",
}: {
  className?: string;
  tone?: "default" | "dim";
}) {
  const color = tone === "dim" ? "border-white/15" : "border-white/25";
  const base = cn("pointer-events-none absolute h-3 w-3", color);
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 z-[5]", className)}
    >
      <span className={cn(base, "left-0 top-0 border-l border-t")} />
      <span className={cn(base, "right-0 top-0 border-r border-t")} />
      <span className={cn(base, "bottom-0 left-0 border-b border-l")} />
      <span className={cn(base, "bottom-0 right-0 border-b border-r")} />
    </div>
  );
}

type VisionTechFrameProps = {
  /** Monospace identifier rendered at the top-left (e.g. "F.01"). */
  tag?: string;
  /** Small-caps label rendered next to the tag (e.g. "AAPL · 6M"). */
  label?: string;
  /** Optional mini status string rendered on the right end of the label strip. */
  status?: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

/** Wraps a hero visual with corner brackets + optional identifier strip. */
export function VisionTechFrame({
  tag,
  label,
  status,
  children,
  className,
  contentClassName,
}: VisionTechFrameProps) {
  const showHeader = tag || label || status;
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      {showHeader ? (
        <div className="mb-2 flex items-center gap-2">
          {tag ? (
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.22em] text-white/60">
              {tag}
            </span>
          ) : null}
          {label ? (
            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-white/40">
              {label}
            </span>
          ) : null}
          <span aria-hidden className="ml-auto h-px flex-1 bg-white/[0.08]" />
          {status ? (
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40">
              {status}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={cn("relative min-w-0", contentClassName)}>
        {children}
        <VisionCornerBrackets />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

type VisionSpecRowProps = {
  items: Array<{ key: string; value: string }>;
  className?: string;
};

export function VisionSpecRow({ items, className }: VisionSpecRowProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-white/[0.06] bg-white/[0.015] px-2.5 py-1.5 font-mono text-[9px]",
        className,
      )}
    >
      {items.map((it, i) => (
        <span key={`${it.key}-${i}`} className="inline-flex items-center gap-1.5">
          <span className="uppercase tracking-[0.18em] text-white/40">{it.key}</span>
          <span className="tabular-nums text-white/75">{it.value}</span>
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

type VisionFeatureChipsProps = {
  chips: string[];
  className?: string;
};

/** Row of monospace chips. Used for the "predefined features" ledger in §02. */
export function VisionFeatureChips({ chips, className }: VisionFeatureChipsProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {chips.map((c) => (
        <span
          key={c}
          className="inline-flex items-center rounded-md border border-white/[0.1] bg-white/[0.03] px-2 py-[3px] font-mono text-[9px] uppercase tracking-[0.14em] text-white/65"
        >
          {c}
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

type VisionPipelineStripProps = {
  stages: string[];
  className?: string;
  /** Optional highlighted stage index. */
  current?: number;
};

/** Five-stage pipeline: [GENERATE] → [LABEL] → [TRAIN] → [BACKTEST] → [DEPLOY]. */
export function VisionPipelineStrip({
  stages,
  className,
  current,
}: VisionPipelineStripProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-y-2", className)}>
      {stages.map((s, i) => (
        <span key={s} className="inline-flex items-center">
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.16em]",
              i === current
                ? "border-white/40 bg-white/[0.08] text-white"
                : "border-white/[0.1] bg-white/[0.02] text-white/70",
            )}
          >
            {s}
          </span>
          {i < stages.length - 1 ? (
            <span aria-hidden className="mx-1.5 inline-flex items-center">
              <span className="h-px w-4 bg-white/20" />
              <svg
                className="-ml-[3px] h-2 w-2 text-white/30"
                viewBox="0 0 8 8"
                fill="none"
                aria-hidden
              >
                <path
                  d="M1 1l3 3-3 3"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

type VisionProjectionRailProps = {
  className?: string;
  label?: string;
  minLabel?: string;
  maxLabel?: string;
  height?: number;
};

/** Thin gradient rail — schematic of an emergent 1-D signal. Used in §03. */
export function VisionProjectionRail({
  className,
  label,
  minLabel = "0",
  maxLabel = "1",
  height = 18,
}: VisionProjectionRailProps) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <span className="font-mono text-[9px] tabular-nums text-white/40">{minLabel}</span>
      <div
        className="relative min-w-0 flex-1 overflow-hidden rounded-md border border-white/[0.08]"
        style={{ height }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to right, rgb(8,8,12), rgb(42,36,68) 22%, rgb(88,72,140) 48%, rgb(150,130,200) 72%, rgb(210,200,235) 88%, rgb(248,248,252))",
          }}
        />
        {label ? (
          <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 font-mono text-[8.5px] uppercase tracking-[0.2em] text-white/85 mix-blend-screen">
            {label}
          </span>
        ) : null}
      </div>
      <span className="font-mono text-[9px] tabular-nums text-white/75">{maxLabel}</span>
    </div>
  );
}
