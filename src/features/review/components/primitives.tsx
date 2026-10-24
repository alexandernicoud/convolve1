import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { dashboardCard } from "@/components/dashboard/dashboardCard";
import { MISSING } from "../lib/format";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** The workspace card surface (same as the Overview dashboard). */
export const surface = dashboardCard;

/** Small heading for groups inside a panel or the inspector. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("text-[13px] font-medium text-white/55", className)}>{children}</p>;
}

/** Panel heading in the tool style: "● Title". */
export function PanelTitle({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <h2 className="flex items-center gap-2 text-base font-medium text-[#F5F5F5]">
      <span className={cx("h-2 w-2 shrink-0 rounded-full", muted ? "bg-[#F5F5F5]/40" : "bg-white")} />
      {children}
    </h2>
  );
}

export function Panel({
  title,
  description,
  aside,
  children,
  className,
  bodyClassName,
  help,
}: {
  title?: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Explain-mode annotation id (see features/help/annotations.ts). */
  help?: string;
}) {
  return (
    <section className={cx(surface, "flex min-w-0 flex-col", className)} data-help={help}>
      {title || aside ? (
        <header className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
          <div className="min-w-0">
            {typeof title === "string" ? <PanelTitle>{title}</PanelTitle> : title}
            {description ? <p className="mt-1 pl-4 text-[13px] leading-relaxed text-white/45">{description}</p> : null}
          </div>
          {aside ? <div className="flex shrink-0 items-center gap-2 pt-0.5">{aside}</div> : null}
        </header>
      ) : null}
      <div className={cx("min-w-0 px-5 pb-5", !(title || aside) && "pt-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Quiet text link used in panel headers ("All backtests →"). */
export const panelLink =
  "inline-flex items-center gap-1 text-[13px] font-medium text-white/55 transition hover:text-white focus:outline-none focus-visible:text-white";

export function Missing({ text = MISSING, title }: { text?: string; title?: string }) {
  return (
    <span className="text-white/25" title={title ?? "Not recorded"}>
      {text}
    </span>
  );
}

/** Large figure. `value` must already be formatted; missing renders as an em dash. */
export function Stat({
  label,
  value,
  sub,
  tone,
  onClick,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "alert" | "muted";
  onClick?: () => void;
  className?: string;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cx(
        "group flex min-w-0 flex-col items-start text-left",
        onClick && "rounded-lg transition focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40",
        className,
      )}
    >
      <span className="text-[13px] text-white/50 transition group-hover:text-white/75">{label}</span>
      <span
        className={cx(
          "mt-1.5 font-digits text-[28px] font-semibold tabular-nums leading-none tracking-tight",
          tone === "alert" ? "text-red-300/90" : tone === "muted" ? "text-white/35" : "text-white",
        )}
      >
        {value}
      </span>
      {sub ? <span className="mt-2 text-[12.5px] leading-snug text-white/45">{sub}</span> : null}
    </Tag>
  );
}

/** Two-column key/value grid. Values of null/undefined/"" render as a muted em dash. */
export function KV({ rows, cols = 2 }: { rows: [ReactNode, ReactNode, string?][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cx("grid gap-x-8 gap-y-0", cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
      {rows.map(([k, v, hint], i) => (
        <div key={i} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-white/[0.06] py-2">
          <dt className="flex shrink-0 items-center gap-1 text-[13px] text-white/50">
            {k}
            {hint ? <Hint text={hint} /> : null}
          </dt>
          <dd className="min-w-0 truncate text-right font-digits text-[13.5px] tabular-nums text-white/90">
            {v == null || v === "" || v === MISSING ? <Missing /> : v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Hint({ text }: { text: string }) {
  return (
    <span title={text} aria-label={text} className="inline-flex cursor-help text-white/30 hover:text-white/60">
      <Info className="h-3.5 w-3.5" />
    </span>
  );
}

const STATUS_TEXT: Record<string, string> = {
  running: "Running",
  queued: "Queued",
  succeeded: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
  active: "Active",
  paused: "Paused",
  closed: "Closed",
  archived: "Archived",
  expired: "Expired",
  waiting: "Waiting",
  error: "Error",
};

export function StatusPill({ status, progress }: { status?: string | null; progress?: number }) {
  if (!status) return <Missing />;
  const failed = status === "failed" || status === "error" || status === "interrupted";
  const live = status === "running" || status === "queued";
  const done = status === "succeeded" || status === "active";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-[13px]",
        failed ? "text-red-300/90" : done ? "text-white/80" : live ? "text-white" : "text-white/45",
      )}
    >
      <span
        className={cx(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          failed ? "bg-red-400/80" : live ? "animate-pulse bg-white" : done ? "bg-white/70" : "border border-white/35",
        )}
      />
      {STATUS_TEXT[status] ?? status}
      {live && progress != null && progress > 0 ? <span className="font-digits tabular-nums text-white/50">{Math.round(progress * 100)}%</span> : null}
    </span>
  );
}

export type Provenance = "recorded" | "recovered" | "unknown" | "unresolved";

const PROV_TEXT: Record<Provenance, string> = {
  recorded: "Recorded",
  recovered: "Recovered",
  unknown: "Unknown",
  unresolved: "Not in workspace",
};

const PROV_HELP: Record<Provenance, string> = {
  recorded: "Written by the tool when the asset was created.",
  recovered: "Reconstructed after the fact (e.g. matching chart filenames). Plausible, not verified.",
  unknown: "No reliable source information was recorded.",
  unresolved: "Referenced by a recorded link, but the asset is not present in this workspace.",
};

export function ProvenanceBadge({ p, basis, compact }: { p: Provenance; basis?: string; compact?: boolean }) {
  return (
    <span
      title={basis ? `${PROV_HELP[p]}\nBasis: ${basis}` : PROV_HELP[p]}
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px]",
        p === "recorded" && "text-white/75",
        p === "recovered" && "text-white/55",
        (p === "unknown" || p === "unresolved") && "text-white/35",
      )}
    >
      <ProvenanceGlyph p={p} />
      {compact ? null : PROV_TEXT[p]}
    </span>
  );
}

export function ProvenanceGlyph({ p }: { p: Provenance }) {
  if (p === "recorded") return <span className="h-2 w-2 shrink-0 rounded-full bg-white/80" />;
  if (p === "recovered") return <span className="h-2 w-2 shrink-0 rounded-full border border-dashed border-white/70" />;
  return <span className="h-2 w-2 shrink-0 rounded-full border border-white/30" />;
}

/** Segmented filter pill (same treatment as the generator's mode toggles). */
export function Chip({ children, active, onClick, title }: { children: ReactNode; active?: boolean; onClick?: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-[13px] font-medium transition focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40",
        active ? "border-white/25 bg-white/[0.1] text-white" : "border-white/[0.1] text-white/55 hover:border-white/20 hover:text-white/90",
      )}
    >
      {children}
    </button>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-md border border-white/[0.1] px-1.5 py-px text-[11.5px] text-white/60">{children}</span>;
}

export function KindTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-md bg-white/[0.07] px-2 py-0.5 text-[12px] font-medium leading-5 text-white/70 first-letter:uppercase">
      {children}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className={cx(surface, "flex flex-col items-start px-6 py-8")}>
      <PanelTitle muted>{title}</PanelTitle>
      {body ? <p className="mt-2 max-w-xl pl-4 text-[14px] leading-relaxed text-white/50">{body}</p> : null}
      {action ? <div className="mt-5 pl-4">{action}</div> : null}
    </div>
  );
}

export const btn =
  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg border border-white/20 bg-white/[0.04] px-3 text-[13px] font-medium text-white/90 transition hover:border-white/40 hover:bg-white/[0.08] hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 disabled:pointer-events-none disabled:opacity-40";

/** Compact variant for table rows. */
export const btnSm =
  "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/[0.14] px-2.5 text-[12.5px] font-medium text-white/80 transition hover:border-white/35 hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 disabled:pointer-events-none disabled:opacity-40";

export const btnPrimary =
  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg bg-white px-4 text-[13px] font-semibold text-[#0a0a0a] transition hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-40";

/** Note qualifying a number (in-sample, net of costs…). */
export function Caveat({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[12.5px] leading-relaxed text-white/40">{children}</p>;
}
