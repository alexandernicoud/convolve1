import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Rocket } from "lucide-react";
import { reviewApi, type ReviewOverviewResponse } from "@/lib/api";
import { useBetaInfo } from "@/features/beta/BetaUI";
import { dashboardCard } from "@/components/dashboard/dashboardCard";
import { cn } from "@/lib/utils";
import { nextStep, researchSteps } from "./researchPath";
import { writeHideResearchStart } from "./researchStartPrefs";

function useOverview() {
  const [data, setData] = useState<ReviewOverviewResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    reviewApi
      .getOverview()
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  return { data, failed };
}

/** Overview for accounts without paper bots: the research path first, the fleet one click away. */
export function ResearchStart({
  onShowFleet,
  onDismissForever,
}: {
  onShowFleet: () => void;
  onDismissForever: () => void;
}) {
  const { data, failed } = useOverview();
  const { beta } = useBetaInfo();
  const [dontShow, setDontShow] = useState(false);
  const s = data?.summary;
  const steps = researchSteps({
    datasets: s?.totalDatasets ?? 0,
    models: s?.totalModels ?? 0,
    analyses: s?.totalAnalyses ?? 0,
    backtests: s?.totalBacktests ?? 0,
    improveExperiments: data?.models.filter((m) => m.improve).length ?? 0,
  });
  const next = data || failed ? nextStep(steps) : null;
  const fresh = !!data && steps.every((x) => !x.done);

  const goFleet = () => {
    if (dontShow) {
      writeHideResearchStart(true);
      onDismissForever();
    } else {
      onShowFleet();
    }
  };

  const onDontShowChange = (v: boolean) => {
    setDontShow(v);
    if (v) writeHideResearchStart(true);
  };

  return (
    <div data-research-start className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <section className={cn(dashboardCard, "px-5 py-5 md:px-7 md:py-6")}>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">{fresh ? "Start here" : "Your research"}</p>
        <h2 className="mt-1.5 text-[clamp(1.35rem,2.4vw,1.9rem)] font-semibold tracking-tight text-white">
          {fresh ? "Build and test your first chart model" : next ? `Next: ${next.title.toLowerCase()}` : "Every research step has been run at least once"}
        </h2>
        <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-white/60">
          Convolve trains a neural network to read candlestick charts, then checks honestly whether it has any edge: Model Health after
          training, baselines and leakage checks in the backtest, and controlled experiments in Improve.
        </p>
        {beta?.free_beta ? (
          <p className="mt-2 text-[12.5px] text-[#a6ecc8]/85">Free during the public beta, within fair-use limits. Every run shows its credit cost; nothing is charged.</p>
        ) : null}
        {next ? (
          <Link
            to={next.to}
            className="convolve-btn-glow accent-btn mt-5 inline-flex h-12 items-center gap-2 rounded-xl px-6 text-[15px] font-semibold transition"
          >
            {next.cta}
            <ArrowRight className="h-5 w-5" aria-hidden />
          </Link>
        ) : null}
      </section>

      <ol className="grid gap-2 md:grid-cols-5" aria-label="Research path">
        {steps.map((step, i) => {
          const isNext = next?.id === step.id;
          return (
            <li key={step.id}>
              <Link
                to={step.to}
                className={cn(
                  dashboardCard,
                  "flex h-full flex-col gap-1.5 px-4 py-3.5 transition hover:border-white/25",
                  isNext && "border-white/35 shadow-[0_0_28px_rgba(255,255,255,0.08)]",
                )}
              >
                <span className="flex items-center justify-between">
                  <span className="font-digits text-[11px] text-white/40">
                    0{i + 1}
                    {step.id === "analyze" ? " · optional" : ""}
                  </span>
                  {step.done ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#a6ecc8]">
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      {step.count}
                    </span>
                  ) : isNext ? (
                    <span className="text-[11px] font-medium text-white">Next</span>
                  ) : null}
                </span>
                <span className="text-[14px] font-semibold text-white">{step.title}</span>
                <span className="text-[12.5px] leading-snug text-white/55">{step.what}</span>
              </Link>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-2 md:grid-cols-2">
        <section className={cn(dashboardCard, "px-5 py-4")}>
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/55">What a label means</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-white/65">
            Each chart is labelled by what happened next. <strong className="font-medium text-white/85">Label 1</strong>: entering at the next
            bar’s open, price reached your take-profit before your stop-loss within the horizon. <strong className="font-medium text-white/85">Label 0</strong>:
            the stop came first or the horizon ran out. The model learns to predict that label from the picture alone.
          </p>
        </section>
        <section className={cn(dashboardCard, "px-5 py-4")}>
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/55">How to read results</h3>
          <ul className="mt-2 space-y-1 text-[13px] leading-relaxed text-white/65">
            <li>Training finishing is not success: Model Health says whether the model ranks better than chance.</li>
            <li>Validation accuracy is label agreement on held-out charts, not profit.</li>
            <li>A backtest is a simulation on past prices; only a test on a later, untouched period counts as independent.</li>
          </ul>
        </section>
      </div>

      <section className={cn(dashboardCard, "flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between")}>
        <p className="flex max-w-xl items-start gap-2.5 text-[14px] leading-relaxed text-white/60">
          <Rocket className="mt-0.5 h-5 w-5 shrink-0 text-white/45" aria-hidden />
          No paper bots are running. Launch one only after a model holds up on an independent backtest; execution is always simulated.
        </p>
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={goFleet}
              className="convolve-btn-glow inline-flex h-12 items-center justify-center rounded-xl border border-white/30 bg-white/[0.06] px-5 text-[15px] font-semibold text-white transition hover:border-white/50 hover:bg-white/[0.1]"
            >
              Show fleet dashboard
            </button>
            <Link
              to="/tools/deploy"
              className="convolve-btn-glow accent-btn inline-flex h-12 items-center justify-center rounded-xl px-5 text-[15px] font-semibold transition"
            >
              Launch Bot
            </Link>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-white/50">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-white/30 bg-black"
              checked={dontShow}
              onChange={(e) => onDontShowChange(e.target.checked)}
            />
            Don&apos;t show this starting screen again
          </label>
        </div>
      </section>
    </div>
  );
}
