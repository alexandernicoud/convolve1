import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FlaskConical } from "lucide-react";
import type { TrainingSession } from "@/lib/api";
import { cx, surface } from "@/features/review/components/primitives";
import { modelHealth } from "./health";
import { recommendedExperiment } from "./improveRecommendation";

/** Primary next step after training: improve this model, led by the strongest Model Health finding. */
export function ImproveCallout({ runId, session }: { runId: string; session: TrainingSession }) {
  const findings = useMemo(() => modelHealth(session, runId), [session, runId]);
  const rec = recommendedExperiment(findings);
  const workspace = `/tools/improve?model=${encodeURIComponent(`trained:${runId}`)}&from=trainer`;
  const isExperiment = !!session.experiment;

  return (
    <section className={cx(surface, "overflow-hidden border-white/15")} aria-label="Improve this model">
      <div className="flex flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/[0.06] text-white">
            <FlaskConical className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-[17px] font-semibold text-white">
              {isExperiment ? "This model is an Improve experiment" : "Improve this model"}
              <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] font-normal uppercase tracking-wide text-white/50">Experimental</span>
            </h2>
            <p className="mt-1 max-w-3xl text-[13.5px] leading-relaxed text-white/65">
              {isExperiment
                ? "It is compared with its original model in the improvement workspace, where you decide whether to keep it in your library or archive it."
                : rec
                  ? `Model Health found: ${rec.finding.title.charAt(0).toLowerCase()}${rec.finding.title.slice(1)}. Test fixes against this model as a fixed baseline, one controlled change at a time, and keep only what clearly improves it.`
                  : "Test controlled changes against this model as a fixed baseline: smaller or regularized networks, other learning rates, class weights. Keep only what clearly improves it."}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          {!isExperiment && rec ? (
            <Link
              to={rec.to}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#0a0a0a] transition hover:bg-white/90"
            >
              {rec.label} <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
          <Link
            to={workspace}
            className={cx(
              "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm transition",
              !isExperiment && rec
                ? "border border-white/25 font-medium text-white hover:bg-white/10"
                : "bg-white font-semibold text-[#0a0a0a] hover:bg-white/90",
            )}
          >
            {isExperiment ? "Open improvement workspace" : "Open Improve"} <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
