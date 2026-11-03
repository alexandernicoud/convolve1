import { AlertTriangle, CheckCircle2, ChevronRight, Info, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { EVIDENCE_LABEL, type Finding, type Severity } from "./findings";

const ICON: Record<Severity, ReactNode> = {
  problem: <XCircle className="h-4 w-4 text-red-300/90" aria-hidden />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-300/90" aria-hidden />,
  info: <Info className="h-4 w-4 text-sky-300/80" aria-hidden />,
  ok: <CheckCircle2 className="h-4 w-4 text-emerald-300/80" aria-hidden />,
};

const SEVERITY_LABEL: Record<Severity, string> = { problem: "Problem", warning: "Warning", info: "Note", ok: "OK" };

export function FindingsList({
  findings,
  onTarget,
  emptyText = "Nothing to report.",
  okCollapsed = true,
}: {
  findings: Finding[];
  /** Reveals a page-local target (form field or section) named by a finding's action. */
  onTarget?: (target: string) => void;
  emptyText?: string;
  okCollapsed?: boolean;
}) {
  const [showOk, setShowOk] = useState(!okCollapsed);
  const shown = showOk ? findings : findings.filter((f) => f.severity !== "ok");
  const okCount = findings.length - findings.filter((f) => f.severity !== "ok").length;
  if (!findings.length) return <p className="text-sm text-white/45">{emptyText}</p>;
  return (
    <div className="space-y-2">
      {shown.map((f) => (
        <FindingRow key={f.id} f={f} onTarget={onTarget} />
      ))}
      {okCount && okCollapsed ? (
        <button type="button" onClick={() => setShowOk((v) => !v)} className="text-xs text-white/45 underline-offset-2 hover:text-white/75 hover:underline">
          {showOk ? "Hide passed checks" : `Show ${okCount} passed check${okCount > 1 ? "s" : ""}`}
        </button>
      ) : null}
    </div>
  );
}

function FindingRow({ f, onTarget }: { f: Finding; onTarget?: (target: string) => void }) {
  const [open, setOpen] = useState(f.severity === "problem");
  const hasMore = !!(f.why || f.measured?.length || f.experiment);
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 text-sm ${
        f.severity === "problem"
          ? "border-red-400/30 bg-red-500/[0.06]"
          : f.severity === "warning"
            ? "border-amber-300/25 bg-amber-300/[0.05]"
            : "border-white/10 bg-white/[0.02]"
      }`}
      data-finding={f.id}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0" title={SEVERITY_LABEL[f.severity]}>
          {ICON[f.severity]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-medium text-white/90">{f.title}</span>
            {f.evidence ? (
              <span className="rounded border border-white/15 px-1.5 py-px text-[11px] uppercase tracking-wide text-white/55">{f.evidence === "confirmed" && (f.severity === "info" || f.severity === "ok") ? "Confirmed" : EVIDENCE_LABEL[f.evidence]}</span>
            ) : null}
          </div>
          <p className="mt-0.5 leading-relaxed text-white/60">{f.detail}</p>
          {open && hasMore ? (
            <div className="mt-2 space-y-1.5 text-white/55">
              {f.why ? (
                <p className="leading-relaxed">
                  <span className="text-white/70">Why it matters: </span>
                  {f.why}
                </p>
              ) : null}
              {f.measured?.length ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 font-mono text-[12.5px]">
                  {f.measured.map((m) => (
                    <div key={m.label} className="contents">
                      <dt className="text-white/45">{m.label}</dt>
                      <dd className="text-white/75">{m.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {f.experiment ? (
                <p className="leading-relaxed">
                  <span className="text-white/70">Experiment: </span>
                  {f.experiment}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {f.action?.to ? (
              <Link to={f.action.to} className="inline-flex items-center gap-1 text-[13px] font-medium text-white/85 underline decoration-white/30 underline-offset-2 hover:text-white">
                {f.action.label} <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ) : f.action?.target && onTarget ? (
              <button
                type="button"
                onClick={() => onTarget(f.action!.target!)}
                className="inline-flex items-center gap-1 text-[13px] font-medium text-white/85 underline decoration-white/30 underline-offset-2 hover:text-white"
              >
                {f.action.label} <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
            {hasMore ? (
              <button type="button" onClick={() => setOpen((v) => !v)} className="text-[12.5px] text-white/45 hover:text-white/75" aria-expanded={open}>
                {open ? "Less" : "Details"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
