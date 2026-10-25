import { useState, type ReactNode } from "react";
import type { Layout } from "plotly.js";
import { cx, surface } from "@/features/review/components/primitives";
import { SEMANTIC, VIZ } from "@/lib/viz/tokens";
import type { Tone } from "./lib";

/** Plot tokens: the workspace's monochrome chart system (see `@/lib/viz/tokens`). */
export const T = {
  text: "rgba(255,255,255,0.88)",
  tick: VIZ.tick,
  title: VIZ.axisTitle,
  grid: VIZ.grid,
  axis: VIZ.axisLine,
  /** Optimizer's label-payoff score: secondary series. */
  label: "rgba(255,255,255,0.56)",
  /** Market-valued audit: primary series. */
  mtm: "rgba(255,255,255,0.94)",
  /** Buy & hold reference. */
  asset: "rgba(190,190,190,0.7)",
  pos: SEMANTIC.positive,
  neg: SEMANTIC.negative,
  /** Selection highlight, shared by the heatmap, 3D view and scatter. */
  select: "#FCD34D",
};

export const PLOT_CONFIG = { displayModeBar: false, responsive: true } as const;

/**
 * Score scale of the TP × SL heatmap (losses rose → 0 near-black → gains violet → near-white),
 * applied to signed-log scores. Localised to score surfaces: the heatmap and the 3D search space.
 */
export const DIVERGING: [number, string][] = [
  [0, "#fb7185"],
  [0.25, "#7f1d3a"],
  [0.5, "#17151b"],
  [0.75, "#6d3fb0"],
  [1, "#f3e8ff"],
];

/** 0–100 research scores (CNN suitability, robustness): the gain half of `DIVERGING`, so 0 reads as "nothing". */
export const SEQUENTIAL: [number, string][] = [
  [0, "#17151b"],
  [0.5, "#6d3fb0"],
  [1, "#f3e8ff"],
];

/** Log horizon axis when the grid has many horizons (1–200 days). */
export function horizonAxis(horizons: number[], extra: Record<string, unknown> = {}) {
  if (horizons.length <= 20) return extra;
  const ticks = [1, 2, 5, 10, 20, 50, 100, 200, 500].filter((t) => t <= horizons[horizons.length - 1]!);
  return { type: "log", tickvals: ticks, ticktext: ticks.map(String), ...extra };
}

export function baseLayout(extra: Partial<Layout> = {}): Partial<Layout> {
  return {
    font: { family: VIZ.font, color: T.text, size: 11.5 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    hoverlabel: { bgcolor: VIZ.tooltip.background, bordercolor: VIZ.tooltip.border, font: { family: VIZ.font, color: "#fff", size: VIZ.tooltip.fontSize } },
    showlegend: false,
    ...extra,
  };
}

export function axis(title: string, extra: Record<string, unknown> = {}) {
  return {
    title: title ? { text: title, font: { size: VIZ.axisTitleSize, color: T.title }, standoff: 10 } : undefined,
    tickfont: { size: 11, color: T.tick, family: VIZ.digits },
    gridcolor: T.grid,
    zerolinecolor: "rgba(255,255,255,0.16)",
    linecolor: T.axis,
    automargin: true,
    ...extra,
  };
}

export const TONE_TEXT: Record<Tone, string> = {
  bad: "text-red-300/90",
  warn: "text-amber-200/85",
  neutral: "text-white/85",
  good: "text-white",
};

export const TONE_DOT: Record<Tone, string> = {
  bad: "bg-red-400/80",
  warn: "bg-amber-300/80",
  neutral: "bg-white/40",
  good: "bg-white",
};

/**
 * Methodological label attached to a number. In-sample / estimated evidence uses a dashed border
 * (as the Backtester's "Exploratory" badge); independent evidence a solid one.
 */
export function MethodTag({ children, kind = "solid", tone }: { children: ReactNode; kind?: "solid" | "dashed"; tone?: Tone }) {
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-px text-[11.5px] leading-[18px]",
        kind === "dashed" ? "border-dashed" : "",
        tone === "bad" ? "border-red-400/30 text-red-200/90" : tone === "warn" ? "border-amber-300/30 text-amber-100/85" : "border-white/[0.16] text-white/60",
      )}
    >
      {children}
    </span>
  );
}

/** Status pill in the Trainer's StageBadge style. */
export function StatusBadge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-[12.5px] font-medium",
        tone === "bad" ? "border-red-400/30 text-red-200" : tone === "warn" ? "border-amber-300/30 text-amber-100/90" : "border-white/25 text-white",
      )}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", TONE_DOT[tone])} />
      {children}
    </span>
  );
}

/** Card with an optional "● Title" header, matching the workspace Panel. */
export function Card({
  title,
  note,
  aside,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  note?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx(surface, "flex min-w-0 flex-col", className)}>
      {title || aside ? (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-2.5 pt-3.5 sm:px-5">
          <div className="min-w-0">
            {title ? (
              <h3 className="flex items-center gap-2 text-[14.5px] font-medium text-[#F5F5F5]">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white" />
                {title}
              </h3>
            ) : null}
            {note ? <p className="mt-1 pl-3.5 text-[12.5px] leading-relaxed text-white/45">{note}</p> : null}
          </div>
          {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
        </header>
      ) : null}
      <div className={cx("min-w-0 flex-1 px-4 pb-4 sm:px-5", !(title || aside) && "pt-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Segmented<V extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: V;
  options: { value: NoInfer<V>; label: string; disabled?: boolean; title?: string }[];
  onChange: (v: NoInfer<V>) => void;
  label?: string;
}) {
  return (
    <div className="inline-flex rounded-lg border border-white/[0.12] p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            "whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] transition disabled:cursor-not-allowed disabled:opacity-35",
            value === o.value ? "bg-white/[0.12] text-white" : "text-white/50 hover:text-white/85",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SelectField<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: { value: NoInfer<V>; label: string }[]; onChange: (v: NoInfer<V>) => void }) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-[12.5px] text-white/50">
      <span className="shrink-0">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as V)}
        className="h-8 min-w-0 rounded-lg border border-white/[0.14] bg-black px-2 text-[12.5px] text-white focus:border-white/35 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** HTML legend matching `SeriesLegend`, with Plotly dash names. */
export function Legend({ items }: { items: { label: string; color: string; dash?: "solid" | "dash" | "dot" | "dashdot"; kind?: "line" | "box" | "ring" | "star" }[] }) {
  const dashes = { solid: undefined, dash: "5 4", dot: "1.5 3", dashdot: "6 2 1 2" } as const;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-white/60">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2">
          {it.kind === "box" ? (
            <span className="h-2.5 w-3 rounded-[3px]" style={{ background: it.color }} />
          ) : it.kind === "ring" ? (
            <span className="h-2.5 w-2.5 border-2" style={{ borderColor: it.color }} />
          ) : it.kind === "star" ? (
            <span style={{ color: it.color }}>★</span>
          ) : (
            <svg width="18" height="6" aria-hidden>
              <line x1="0" y1="3" x2="18" y2="3" stroke={it.color} strokeWidth="2" strokeDasharray={dashes[it.dash ?? "solid"]} />
            </svg>
          )}
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Disclosure that mounts its content only once opened. */
export function Disclosure({ title, meta, children, defaultOpen = false }: { title: string; meta?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [mounted, setMounted] = useState(defaultOpen);
  return (
    <div className="border-t border-white/[0.07] first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setMounted(true);
        }}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/[0.02] sm:px-5"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[13.5px] text-white/85">{title}</span>
          {meta ? <span className="text-[12px] text-white/40">{meta}</span> : null}
        </span>
        <svg viewBox="0 0 16 16" className={cx("h-3.5 w-3.5 shrink-0 text-white/50 transition", open && "rotate-180")} aria-hidden>
          <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {mounted ? <div className={cx("px-4 pb-4 sm:px-5", !open && "hidden")}>{children}</div> : null}
    </div>
  );
}

export function Unavailable({ children, height = 200 }: { children: ReactNode; height?: number }) {
  return (
    <div style={{ minHeight: height }} className="flex items-center justify-center rounded-lg border border-dashed border-white/[0.1] px-6 text-center text-[13px] leading-relaxed text-white/40">
      {children}
    </div>
  );
}
