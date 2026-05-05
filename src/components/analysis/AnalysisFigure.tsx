import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Dashboard-grade primitives for the analysis page                           */
/*                                                                            */
/*  Optimised for density: the analysis page is a dashboard, not a long-form  */
/*  report. Sections stay compact; each figure is a tile with a one-liner     */
/*  summary and an expandable "How to read" disclosure for newcomers.         */
/* -------------------------------------------------------------------------- */

type AnalysisSectionProps = {
  number: string;
  eyebrow?: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Optional action rendered on the right of the section header. */
  action?: ReactNode;
};

export function AnalysisSection({
  number,
  eyebrow,
  title,
  intro,
  children,
  className,
  action,
}: AnalysisSectionProps) {
  return (
    <section className={cn("border-t border-white/[0.06] pt-6 sm:pt-8", className)}>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
            <span className="font-mono text-white/55">{number}</span>
            {eyebrow ? <span>{eyebrow}</span> : null}
          </div>
          <h2 className="mt-1.5 text-[15.5px] font-medium tracking-[-0.01em] text-white">
            {title}
          </h2>
          {intro ? (
            <p className="mt-1.5 max-w-[72ch] text-[12px] leading-[1.6] text-white/55">{intro}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

type DashboardFigureProps = {
  /** Figure identifier, e.g. "Fig. 1.1". Rendered monospace/uppercase. */
  number?: string;
  /** Bold title, e.g. "Accuracy". */
  title: string;
  /** Single-line description shown always — the headline reading of the chart. */
  summary?: ReactNode;
  /** Longer "How to read it" text, revealed by clicking the info icon. */
  tip?: ReactNode;
  /** The chart tile (should be self-sized / rounded). */
  children: ReactNode;
  className?: string;
};

export function DashboardFigure({
  number,
  title,
  summary,
  tip,
  children,
  className,
}: DashboardFigureProps) {
  return (
    <figure className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="min-w-0">{children}</div>
      <figcaption className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          {number ? (
            <span className="shrink-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.22em] text-white/40">
              {number}
            </span>
          ) : null}
          <h3 className="truncate text-[12.5px] font-medium leading-snug tracking-[-0.005em] text-white/90">
            {title}
          </h3>
        </div>
        {summary ? (
          <p className="text-[11.5px] leading-[1.55] text-white/55">{summary}</p>
        ) : null}
        {tip ? (
          <details className="group/tip mt-0.5">
            <summary
              className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.2em] text-white/40 transition hover:text-white/75"
            >
              <Info className="h-3 w-3" aria-hidden />
              <span>How to read it</span>
              <span aria-hidden className="text-white/30 group-open/tip:hidden">+</span>
              <span aria-hidden className="hidden text-white/40 group-open/tip:inline">–</span>
            </summary>
            <div className="mt-1.5 rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5 text-[11px] leading-[1.6] text-white/65">
              {tip}
            </div>
          </details>
        ) : null}
      </figcaption>
    </figure>
  );
}
