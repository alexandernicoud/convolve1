import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { btnSm, cx, EmptyState, surface } from "@/features/review/components/primitives";
import { fmtInt } from "@/lib/viz/format";
import { SEMANTIC } from "@/lib/viz/tokens";
import type { Finding } from "../api";
import { useWorkspace } from "../BacktestWorkspace";
import { findingActionLink } from "../findingActions";
import { pairedHeadline } from "../verdict";

const SEVERITY: Record<Finding["severity"], { label: string; color: string }> = {
  negative: { label: "Against the strategy", color: SEMANTIC.negative },
  caution: { label: "Caution", color: SEMANTIC.warning },
  neutral: { label: "Context", color: "rgba(255,255,255,0.45)" },
  positive: { label: "In favour", color: SEMANTIC.positive },
};
const ORDER: Finding["severity"][] = ["negative", "caution", "neutral", "positive"];

export default function FindingsTab() {
  const { summary, runId } = useWorkspace();
  const actionCtx = {
    runId,
    trainerRunId: summary.model.trainer_run_id ?? summary.model.training_run_id ?? null,
    modelId: summary.model.model_id ?? null,
    datasetId: summary.dataset.dataset_id ?? null,
  };
  const findings = [...summary.findings].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  const headline = summary.incremental && summary.incremental.verdict.id !== "invalid" ? pairedHeadline(summary.incremental, summary.evaluation_class === "independent_test") : null;
  if (!findings.length) return <EmptyState title="No findings" body="No rule produced a finding for this run." />;
  return (
    <div className="space-y-3" data-help="bt-findings">
      {headline?.tone === "negative" ? (
        <p className={cx(surface, "p-4 text-[14px] font-medium")} style={{ borderLeft: `2px solid ${SEMANTIC.negative}`, color: SEMANTIC.negative }}>
          {headline.text} <span className="font-normal text-white/55">See Baselines for the intervals.</span>
        </p>
      ) : null}
      <p className="text-[13px] text-white/50">
        Each finding is produced by a fixed rule from the stored results. Measurements are quoted exactly; nothing here is generated free text.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {findings.map((f) => {
          const s = SEVERITY[f.severity] ?? SEVERITY.neutral;
          const action = findingActionLink(f.action, actionCtx);
          return (
            <article key={f.id} className={cx(surface, "p-4")} style={{ borderLeft: `2px solid ${s.color}` }}>
              <p className="text-[11.5px] uppercase tracking-wide" style={{ color: s.color }}>{s.label}</p>
              <h3 className="mt-1 text-[14.5px] font-medium text-white">{f.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/75">{f.measurement}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-white/60">{f.interpretation}</p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] text-white/45">
                {f.sample_size != null ? (<><dt>Sample</dt><dd className="font-digits text-white/60">{fmtInt(f.sample_size)}</dd></>) : null}
                {f.baseline ? (<><dt>Baseline</dt><dd className="text-white/60">{f.baseline}</dd></>) : null}
                {f.ci95 ? (<><dt>95% CI</dt><dd className="font-digits text-white/60">[{f.ci95[0].toFixed(3)}, {f.ci95[1].toFixed(3)}]</dd></>) : null}
                {f.assumptions ? (<><dt>Assumes</dt><dd>{f.assumptions}</dd></>) : null}
                {f.limitations ? (<><dt>Limits</dt><dd>{f.limitations}</dd></>) : null}
              </dl>
              {action ? (
                <Link to={action.to} className={cx(btnSm, "mt-3 inline-flex items-center gap-1.5")}>
                  {action.label}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
