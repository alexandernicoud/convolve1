import type { ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, CircleDashed, Info, Lock, XCircle } from "lucide-react";
import FieldTip from "@/components/generator/FieldTip";
import { cn } from "@/lib/utils";

/**
 * Shared building blocks for technical tool pages (Generator, Trainer, Backtester, Optimizer, ...).
 * One scale for spacing, radius, type and inputs so every tool reads as the same product.
 */
export const toolUI = {
  /** 40px control: inputs and selects. */
  field:
    "h-10 w-full rounded-lg border border-white/12 bg-[#0a0a0a]/70 px-3 text-[13px] text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/40 disabled:cursor-not-allowed disabled:opacity-50",
  label: "mb-1.5 flex items-center text-[12px] font-medium text-white/70",
  hint: "text-[12px] leading-relaxed text-white/50",
  card: "rounded-2xl border border-white/[0.12] bg-white/[0.035]",
  inset: "rounded-xl border border-white/[0.1] bg-black/30",
  secondaryBtn:
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/20 bg-white/[0.06] px-3 text-[12px] font-semibold text-white transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-45",
  primaryBtn:
    "accent-btn convolve-press inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-45",
} as const;

export type StepStatus = "todo" | "done" | "locked" | "optional";

function StepBadge({ step, status }: { step: number; status: StepStatus }) {
  return (
    <span
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold tabular-nums transition-colors",
        status === "done" ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-200" : "border-white/20 bg-white/10 text-white",
        status === "locked" && "border-white/10 bg-white/[0.04] text-white/40",
      )}
      aria-hidden
    >
      {status === "done" ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : step}
    </span>
  );
}

/**
 * Numbered workflow step. `status` drives the badge and progressive enabling: a locked step stays
 * readable but dims and shows why it is waiting (`lockedReason`).
 */
export function StepCard({
  step,
  title,
  description,
  status = "todo",
  lockedReason,
  aside,
  children,
  className,
  bodyClassName,
  ...rest
}: {
  step: number;
  title: string;
  description?: ReactNode;
  status?: StepStatus;
  lockedReason?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  const locked = status === "locked";
  return (
    <section
      {...rest}
      aria-label={`Step ${step}: ${title}`}
      className={cn(toolUI.card, "flex min-w-0 flex-col p-4 md:p-5", className)}
    >
      <header className="mb-3.5 flex flex-wrap items-start gap-3">
        <StepBadge step={step} status={status} />
        <div className="min-w-[12rem] flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <h3 className={cn("text-[15px] font-semibold leading-7 text-white", locked && "text-white/60")}>{title}</h3>
            {status === "optional" ? <span className="text-[11px] text-white/40">Optional</span> : null}
          </div>
          {description ? <p className="text-[12.5px] leading-relaxed text-white/50">{description}</p> : null}
          {locked && lockedReason ? (
            <p className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-white/45">
              <Lock className="h-3 w-3" aria-hidden />
              {lockedReason}
            </p>
          ) : null}
        </div>
        {aside ? <div className="ml-10 flex items-center gap-2 sm:ml-auto">{aside}</div> : null}
      </header>
      <div className={cn("min-w-0 flex-1 transition-opacity duration-200", locked && "opacity-70", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Numbered heading for steps that live inside one panel (no card of their own). */
export function StepHeading({
  step,
  title,
  description,
  status = "todo",
  className,
}: {
  step: number;
  title: string;
  description?: ReactNode;
  status?: StepStatus;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-start gap-3", className)}>
      <StepBadge step={step} status={status} />
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold leading-7 text-white">{title}</h3>
        {description ? <p className="text-[12.5px] leading-relaxed text-white/50">{description}</p> : null}
      </div>
    </div>
  );
}

/** Steps side by side on wide screens, stacked on narrow ones. Order stays chronological. */
export function StepGrid({ children, cols = 2, className }: { children: ReactNode; cols?: 2 | 3; className?: string }) {
  return (
    <div className={cn("grid min-w-0 items-stretch gap-4", cols === 3 ? "lg:grid-cols-2 2xl:grid-cols-3" : "xl:grid-cols-2", className)}>
      {children}
    </div>
  );
}

/** Labelled group of inputs inside a step ("Signal", "Capital and risk", "Costs"). */
export function FieldGroup({
  title,
  children,
  cols = 3,
  className,
  ...rest
}: {
  title?: string;
  children: ReactNode;
  cols?: 2 | 3 | 4;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const grid = cols === 4 ? "sm:grid-cols-2 xl:grid-cols-4" : cols === 3 ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2";
  return (
    <div {...rest} className={cn("min-w-0", className)}>
      {title ? <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/40">{title}</p> : null}
      <div className={cn("grid grid-cols-1 gap-x-4 gap-y-3", grid)}>{children}</div>
    </div>
  );
}

/** Label + optional tooltip + control. */
export function Field({
  label,
  tip,
  children,
  className,
  htmlFor,
  ...rest
}: {
  label: ReactNode;
  tip?: string;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn("min-w-0", className)}>
      <label className={toolUI.label} htmlFor={htmlFor}>
        {label}
        {tip ? <FieldTip text={tip} /> : null}
      </label>
      {children}
    </div>
  );
}

/** Two- or three-way choice rendered as a compact pill row. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex rounded-xl border border-white/12 bg-white/[0.03] p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition",
            value === o.value ? "accent-btn convolve-press" : "text-white/60 hover:bg-white/[0.06] hover:text-white/85",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type CheckState = "ok" | "warn" | "bad" | "pending" | "info";

const checkIcon: Record<CheckState, ReactNode> = {
  ok: <Check className="h-3.5 w-3.5 text-emerald-300" strokeWidth={2.5} />,
  warn: <AlertTriangle className="h-3.5 w-3.5 text-amber-200" />,
  bad: <XCircle className="h-3.5 w-3.5 text-red-300" />,
  pending: <CircleDashed className="h-3.5 w-3.5 text-white/35" />,
  info: <Info className="h-3.5 w-3.5 text-white/50" />,
};

export type CheckItem = { label: string; value: ReactNode; state: CheckState; detail?: ReactNode };

/** Readiness / integrity checklist ("Model", "Test data", "Engine", "Threshold", ...). */
export function CheckList({ items, className }: { items: CheckItem[]; className?: string }) {
  return (
    <ul className={cn("divide-y divide-white/[0.07]", className)}>
      {items.map((it) => (
        <li key={it.label} className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
          <span className="mt-[3px] shrink-0">{checkIcon[it.state]}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-[12px] text-white/50">{it.label}</span>
              <span className={cn("min-w-0 truncate text-right text-[12.5px] font-medium", it.state === "pending" ? "text-white/40" : "text-white/90")}>
                {it.value}
              </span>
            </div>
            {it.detail ? <p className="mt-0.5 text-[11.5px] leading-relaxed text-white/45">{it.detail}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Inline contextual note. Tones stay muted so warnings read clearly without shouting. */
export function Note({
  tone = "neutral",
  title,
  children,
  className,
}: {
  tone?: "neutral" | "ok" | "warn" | "bad";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const toneCls = {
    neutral: "border-white/[0.12] bg-white/[0.03] text-white/65",
    ok: "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-100/85",
    warn: "border-amber-300/25 bg-amber-300/[0.07] text-amber-100/85",
    bad: "border-red-400/25 bg-red-400/[0.08] text-red-100/85",
  }[tone];
  return (
    <div className={cn("rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-relaxed", toneCls, className)}>
      {title ? <p className={cn("font-medium", tone === "neutral" ? "text-white" : "")}>{title}</p> : null}
      {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
    </div>
  );
}

/** Collapsible group for settings most runs leave at their defaults. */
export function Advanced({
  title = "Advanced settings",
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  title?: string;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details className={cn("group rounded-xl border border-white/[0.1] bg-black/20", className)} open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 text-[12.5px] font-medium text-white/75 hover:text-white [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <ChevronDown className="h-3.5 w-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden />
          {title}
        </span>
        {summary ? <span className="truncate text-[11.5px] font-normal text-white/40">{summary}</span> : null}
      </summary>
      <div className="border-t border-white/[0.07] px-3.5 pb-3.5 pt-3">{children}</div>
    </details>
  );
}

/** One-line page context under the global header (the header already carries the page title). */
export function ToolIntro({ children, actions, className }: { children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-6 gap-y-2", className)}>
      {children ? <p className="min-w-0 max-w-3xl text-[13px] leading-relaxed text-white/55">{children}</p> : <span />}
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
