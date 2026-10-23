import type { ReactNode } from "react";
import { cx, Hint, Stat } from "@/features/review/components/primitives";
import { fmtPct, isFiniteNum, MISSING } from "@/lib/viz/format";
import { SEMANTIC } from "@/lib/viz/tokens";
import type { AuditCheck, Metric, V2Summary } from "./api";

export const metricValue = (m: Metric | undefined | null): number | null => (m && isFiniteNum(m.value) ? (m.value as number) : null);

export const fmtMoney = (v: unknown, digits = 0): string =>
  isFiniteNum(v) ? `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}` : MISSING;

export const fmtSignedPct = (v: unknown, digits = 1): string => (isFiniteNum(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(digits)}%` : MISSING);

export const fmtDay = (iso: unknown): string => (typeof iso === "string" && iso ? iso.slice(0, 10) : MISSING);

/** "Mar 2025" style ticks for daily date axes. */
export const monthTick = (iso: unknown): string => {
  if (typeof iso !== "string") return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
};

/** A metric figure that shows its unavailable reason instead of a number when undefined. */
export function MetricStat({ label, metric, format, sub, hint }: { label: string; metric?: Metric | null; format: (v: number) => string; sub?: ReactNode; hint?: string }) {
  const v = metricValue(metric);
  return (
    <div className="min-w-0">
      <Stat
        label={label}
        value={v == null ? MISSING : format(v)}
        tone={v == null ? "muted" : undefined}
        sub={v == null ? metric?.unavailable ?? "Not available" : sub}
      />
      {hint ? (
        <span className="mt-1 inline-flex">
          <Hint text={hint} />
        </span>
      ) : null}
    </div>
  );
}

export function UnavailableNote({ metric }: { metric?: Metric | null }) {
  if (!metric || metric.value != null) return null;
  return <span className="text-[12px] text-white/40">{metric.unavailable ?? "Not available"}</span>;
}

const EVAL_TEXT: Record<V2Summary["evaluation_class"], { label: string; help: string }> = {
  independent_test: {
    label: "Independent test",
    help: "Threshold locked on validation data, no dataset reuse, no label overlap with training, and every check could be completed.",
  },
  exploratory: {
    label: "Exploratory",
    help: "At least one condition for an independent evaluation is not met or could not be verified. See the leakage checks.",
  },
  blocked: { label: "Blocked", help: "The evaluation failed a blocking leakage check." },
};

export function EvaluationBadge({ cls }: { cls: V2Summary["evaluation_class"] }) {
  const t = EVAL_TEXT[cls] ?? EVAL_TEXT.exploratory;
  return (
    <span
      title={t.help}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px]",
        cls === "independent_test" ? "border-white/25 text-white/85" : "border-dashed border-white/25 text-white/60",
      )}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", cls === "independent_test" ? "bg-white" : "border border-white/60")} />
      {t.label}
    </span>
  );
}

export function MethodologyBadge({ id }: { id: string }) {
  const v2 = id === "price_sim_v2";
  return (
    <span
      title={v2 ? "Price-based portfolio simulation on stored OHLC bars (v2)" : "Legacy label-payoff estimate (v1) — not a trading simulation"}
      className="inline-flex items-center rounded-md bg-white/[0.07] px-2 py-0.5 text-[12px] text-white/70"
    >
      {v2 ? "Price simulation · v2" : "Label payoff · v1 (legacy)"}
    </span>
  );
}

const CHECK_GLYPH: Record<AuditCheck["status"], { color: string; text: string }> = {
  pass: { color: "rgba(255,255,255,0.85)", text: "Pass" },
  info: { color: "rgba(255,255,255,0.4)", text: "Info" },
  warn: { color: SEMANTIC.warning, text: "Warning" },
  fail: { color: SEMANTIC.danger, text: "Fail" },
  unknown: { color: "rgba(255,255,255,0.3)", text: "Unknown" },
};

export function AuditList({ checks }: { checks: AuditCheck[] }) {
  return (
    <ul className="divide-y divide-white/[0.06]">
      {checks.map((c) => {
        const g = CHECK_GLYPH[c.status];
        return (
          <li key={c.id} className="flex gap-3 py-2.5">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={c.status === "unknown" ? { border: `1px solid ${g.color}` } : { background: g.color }} />
            <div className="min-w-0">
              <p className="text-[13.5px] text-white/85">
                {c.title} <span className="ml-1 text-[12px] text-white/45">{g.text}</span>
              </p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-white/50">{c.detail}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Banner({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  return (
    <div
      role="note"
      className={cx(
        "rounded-xl border px-4 py-3 text-[13.5px] leading-relaxed",
        tone === "warn" ? "border-amber-300/25 bg-amber-300/[0.05] text-amber-100/90" : "border-white/[0.12] bg-white/[0.03] text-white/75",
      )}
    >
      {children}
    </div>
  );
}

export const pctTick = (v: number) => fmtPct(v, 0);
