import { useState } from "react";
import { ChevronDown, Loader2, Play } from "lucide-react";
import type { TrainerRunRequest } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { RunCostHint, useRunQuote } from "@/components/RunCostHint";
import { runButtonCost } from "@/features/credits/model";
import { btnPrimary, btnSm, cx } from "@/features/review/components/primitives";
import { unchangedSettings, VARIANT_COPY, type Variant } from "./variants";
import { ACTION_TITLE, type Recommendation } from "./recommend";

const COMPARED = ["ROC-AUC (decides the verdict)", "PR-AUC", "Balanced accuracy", "Log loss", "Validation loss", "Train–validation gap", "Parameters"];

export function ConfigureExperiment({
  variant,
  base,
  pricing,
  originalName,
  datasetName,
  validation,
  recommendation,
  archLabel,
  launching,
  error,
  onClose,
  onRun,
}: {
  variant: Variant | null;
  base: TrainerRunRequest;
  pricing: Record<string, unknown> | null;
  originalName: string;
  datasetName: string;
  validation: string;
  recommendation: Recommendation | null;
  archLabel: (id: string) => string;
  launching: boolean;
  error: string | null;
  onClose: () => void;
  onRun: (v: Variant) => void;
}) {
  const [tech, setTech] = useState(false);
  const { quote, loading } = useRunQuote("trainer", pricing ?? undefined);
  const v = variant;
  const rec = v && recommendation?.key === v.key ? recommendation : null;
  const kept = v ? unchangedSettings(base, v.request, archLabel).map((r) => (r.label === "Dataset" ? { ...r, value: datasetName } : r)) : [];
  const isSeed = v?.key === "seed";

  return (
    <Dialog open={!!v} onOpenChange={(o) => (!o && !launching ? onClose() : undefined)}>
      <DialogContent className="flex max-h-[92vh] max-w-2xl flex-col gap-0 overflow-hidden border-white/10 bg-[#0b0b0b] p-0 text-white sm:rounded-2xl" data-help="improve-config">
        {v ? (
          <>
            <div className="border-b border-white/[0.07] px-6 pb-4 pt-6">
              <p className="text-[12px] uppercase tracking-wide text-white/40">Configure experiment</p>
              <DialogTitle className="mt-1 text-[19px] font-semibold tracking-tight">
                {v.replicate > 0 ? `${VARIANT_COPY[v.key].label} · run ${v.replicate + 1}` : ACTION_TITLE[v.key]}
              </DialogTitle>
              <DialogDescription className="mt-1 text-[13px] leading-relaxed text-white/55">
                Trains a new, separate model. <span className="text-white/80">{originalName}</span> stays unchanged and remains the reference.
              </DialogDescription>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5 text-[13px]">
              <Block title="Why this may help">
                {rec?.observed ? (
                  <p className="text-[13px] text-white/70">
                    <span className="text-white/45">Observed{rec.evidence ? ` (${rec.evidence.toLowerCase()})` : ""}: </span>
                    {rec.observed}
                  </p>
                ) : null}
                <p className={cx("text-[13px] text-white/70", rec?.observed && "mt-1.5")}>
                  <span className="text-white/45">{isSeed ? "Purpose: " : "Hypothesis: "}</span>
                  {rec && rec.key === v.key ? rec.hypothesis : VARIANT_COPY[v.key].hypothesis}
                </p>
                {!isSeed ? <p className="mt-1.5 text-[12.5px] text-white/40">This is a test, not a guaranteed improvement. Many sensible changes make no measurable difference.</p> : null}
              </Block>

              <Block title="What changes">
                <ul className="space-y-1">
                  {v.changed.map((c) => (
                    <li key={c} className="rounded-md border border-white/[0.1] bg-white/[0.03] px-2.5 py-1.5 font-digits text-[12.5px] text-white/85">
                      {c}
                    </li>
                  ))}
                </ul>
                {v.note ? <p className="mt-1.5 text-[12.5px] text-white/45">{v.note}</p> : null}
              </Block>

              <Block title="What stays identical">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                  {kept.map((r) => (
                    <div key={r.label} className="flex min-w-0 justify-between gap-3 border-b border-white/[0.04] py-1">
                      <dt className="text-white/45">{r.label}</dt>
                      <dd className="truncate font-digits text-white/70">{r.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-[12.5px] text-white/45">
                  Validation protocol: {validation}. Same validation charts as the original, so the comparison is like for like.
                </p>
              </Block>

              <Block title="How it will be compared">
                <p className="text-[13px] text-white/65">{COMPARED.join(" · ")}</p>
                <p className="mt-1.5 text-[12.5px] text-white/40">
                  These are validation results. A better validation score is not proof of trading profit; confirm any kept model with a backtest on a later, untouched period.
                </p>
              </Block>

              <div>
                <button type="button" className="inline-flex items-center gap-1 text-[12.5px] text-white/50 hover:text-white/85" aria-expanded={tech} onClick={() => setTech((t) => !t)}>
                  <ChevronDown className={cx("h-3.5 w-3.5 transition-transform", tech && "rotate-180")} aria-hidden /> Technical details
                </button>
                {tech ? (
                  <dl className="mt-2 space-y-1 font-digits text-[12px] text-white/55">
                    <div>Model file: {v.request.model_name}</div>
                    <div>Preset: {v.preset} · replicate {v.replicate}</div>
                    <div>Seed: {v.request.random_seed}</div>
                    <div>Dataset id: {v.request.dataset_id ?? "—"}</div>
                  </dl>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-white/[0.07] px-6 py-4">
              {error ? <p className="text-[13px] text-red-300">{error}</p> : null}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button type="button" className={btnSm} disabled={launching} onClick={onClose}>
                  Cancel
                </button>
                <button type="button" className={cx(btnPrimary, "h-10 px-5")} disabled={launching || !v.available} onClick={() => onRun(v)}>
                  {launching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                  Run Experiment — {runButtonCost(quote, loading)}
                </button>
              </div>
              <RunCostHint tool="trainer" params={pricing ?? undefined} className="text-right" />
              <p className="text-right text-[11.5px] text-white/35">You will be asked to confirm the credits before training starts.</p>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-white/40">{title}</p>
      {children}
    </section>
  );
}
