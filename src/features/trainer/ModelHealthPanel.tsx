import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { TrainingSession } from "@/lib/api";
import { Panel } from "@/features/review/components/primitives";
import { FindingsList } from "@/features/research/FindingsList";
import { modelHealth, skillVerdict } from "./health";

export function ModelHealthPanel({ session, runId, compact, hideImprove }: { session: TrainingSession; runId: string; compact?: boolean; hideImprove?: boolean }) {
  const findings = useMemo(() => modelHealth(session, runId), [session, runId]);
  const problems = findings.filter((f) => f.severity === "problem").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const body = (
    <>
      <p className="mb-3 text-[13.5px] leading-relaxed text-white/50">
        Computed from this run's recorded learning curves, validation evaluation, split and architecture. Evidence levels say how far the numbers support each
        finding; none of them measures trading performance.
      </p>
      <FindingsList findings={findings} />
      <div className={hideImprove ? "hidden" : "mt-3"}>
        <Link
          to={`/tools/improve?model=${encodeURIComponent(`trained:${runId}`)}&from=model-health`}
          className="inline-flex items-center rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/10"
        >
          Improve this model
        </Link>
      </div>
    </>
  );
  if (compact) return body;
  return (
    <Panel
      help="model-health"
      title="Model health"
      description={`${skillVerdict(findings).headline} · ${problems} problem${problems === 1 ? "" : "s"} · ${warnings} warning${warnings === 1 ? "" : "s"}`}
    >
      {body}
    </Panel>
  );
}
