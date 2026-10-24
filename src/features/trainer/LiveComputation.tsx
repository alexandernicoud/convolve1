import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import type { TrainingSession } from "@/lib/api";
import { fmtInt, fmtNum } from "@/lib/viz/format";
import { cx, Panel } from "@/features/review/components/primitives";
import { fmtSci, runCompute } from "./compute";

const PENDING = "pending";

export const TRAINING_FACTS: { title: string; body: string }[] = [
  { title: "Epoch", body: "One epoch is one full pass over the training images: every training chart is shown to the network once." },
  {
    title: "Backpropagation",
    body: "After each batch, the chain rule is applied backwards through the layers to find how much every weight contributed to the loss. That gradient is what the optimizer acts on.",
  },
  {
    title: "Optimizer",
    body: "The optimizer turns gradients into weight changes. Adam scales each step by running averages of recent gradients, so weights with noisy gradients move more cautiously.",
  },
  { title: "Learning rate", body: "The learning rate sets the size of each step. Too large and the loss oscillates or diverges; too small and training crawls." },
  {
    title: "Validation loss",
    body: "Validation images never update a weight. When training loss keeps falling while validation loss rises, the network is memorising its training charts rather than generalising.",
  },
  {
    title: "Early stopping",
    body: "Early stopping watches the selection metric and ends the run after a set number of epochs without improvement, then restores the weights of the best epoch.",
  },
  {
    title: "Chronological validation",
    body: "With chronological validation the validation charts come after the training charts in time. A random split puts neighbouring, overlapping windows into both sets, which flatters the score.",
  },
  {
    title: "Convolutional filters",
    body: "Each filter is a small grid of learned weights slid across the image. Early filters respond to edges and wicks; deeper ones combine them into larger shapes.",
  },
  { title: "ReLU", body: "ReLU(x) = max(0, x) sets negative responses to zero. That bend is what lets stacked layers represent more than a single linear function." },
  {
    title: "Dropout",
    body: "Dropout switches off a random share of units at every training step, so no unit can rely on one particular partner. It is off during validation and prediction.",
  },
  {
    title: "Accuracy is not profit",
    body: "A model can be right on many small moves and wrong on the few large ones. Trading costs and the decision threshold decide the rest; the backtest is where that is measured.",
  },
];

const ROTATE_MS = 14_000;

function Facts({ active }: { active: boolean }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  const auto = active && !reduce && !held;
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => setI((v) => (v + 1) % TRAINING_FACTS.length), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [auto]);
  const f = TRAINING_FACTS[i];
  const go = (d: number) => setI((v) => (v + d + TRAINING_FACTS.length) % TRAINING_FACTS.length);
  return (
    <div
      className="flex min-h-[148px] flex-col justify-between border-t border-white/[0.07] px-6 py-5 lg:border-l lg:border-t-0"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div aria-live={auto ? "off" : "polite"}>
        <p className="text-[12px] uppercase tracking-[0.14em] text-white/40">{f.title}</p>
        <p className="mt-2 text-[14px] leading-relaxed text-white/75">{f.body}</p>
      </div>
      <div className="mt-4 flex items-center gap-2 text-[12px] text-white/40">
        <button type="button" onClick={() => go(-1)} className="rounded-md border border-white/[0.12] p-1 transition hover:border-white/30 hover:text-white" aria-label="Previous note">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => go(1)} className="rounded-md border border-white/[0.12] p-1 transition hover:border-white/30 hover:text-white" aria-label="Next note">
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <span className="font-digits tabular-nums">
          {i + 1} / {TRAINING_FACTS.length}
        </span>
      </div>
    </div>
  );
}

function Counter({ label, value, note, estimate }: { label: string; value: string; note: string; estimate?: boolean }) {
  const pending = value === PENDING;
  return (
    <div className="bg-black px-5 py-4">
      <p className="flex items-center gap-2 text-[13px] text-white/50">
        {label}
        {estimate ? <span className="rounded border border-white/15 px-1 text-[10.5px] uppercase tracking-[0.08em] text-white/45">estimate</span> : null}
      </p>
      <p className={cx("mt-2 font-digits text-[24px] font-semibold leading-none tabular-nums", pending ? "text-[15px] font-normal text-white/35" : "text-white")}>{value}</p>
      <p className="mt-2 text-[12.5px] leading-snug text-white/40">{note}</p>
    </div>
  );
}

/** What the run has computed so far, counted from its configuration, finished epochs and the latest batch report. */
export function LiveComputation({ session, running }: { session: TrainingSession | null; running: boolean }) {
  const c = runCompute(session);
  const arch = session?.architecture;
  const batch = session?.config?.batch_size;
  const train = session?.train_samples;
  const gflops = c.forwardFlops != null ? c.forwardFlops / 1e9 : null;
  const show = (v: number | null, f: (n: number) => string = fmtInt) => (v == null ? PENDING : f(v));

  const model: [string, string][] = [
    ["Architecture", arch?.family ?? session?.config?.architecture ?? PENDING],
    ["Parameters", c.trainableParameters != null ? `${fmtInt(c.trainableParameters)} trainable` : c.parameters != null ? fmtInt(c.parameters) : PENDING],
    ["Input", c.inputShape ? `${c.inputShape[0]} × ${c.inputShape[1]} × ${c.inputShape[2]}` : PENDING],
    ["Learning rate", c.learningRate ? `${fmtSci(c.learningRate.value)} · ${c.learningRate.source}` : PENDING],
  ];

  return (
    <Panel
      help="train-computation"
      title={running ? "The computation so far" : "What the run computed"}
      description={
        <>
          Counted from the run&apos;s configuration
          {c.includesLiveBatch ? ", its finished epochs and the latest batch report, which arrives every few seconds" : " and its finished epochs"}.
          Floating-point operations are estimates.
        </>
      }
      bodyClassName="px-0 pb-0"
    >
      <dl className="grid grid-cols-2 border-b border-white/[0.07] sm:grid-cols-4">
        {model.map(([k, v], i) => (
          <div key={k} className={cx("min-w-0 px-5 py-3", i > 0 && "sm:border-l sm:border-white/[0.07]")}>
            <dt className="text-[12px] text-white/45">{k}</dt>
            <dd className={cx("mt-1 truncate text-[13.5px]", v === PENDING ? "text-white/35" : "text-white/90")} title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <div className={cx("grid", running && "lg:grid-cols-[minmax(0,1fr)_360px]")}>
        <div className="grid grid-cols-1 gap-px bg-white/[0.06] sm:grid-cols-2 xl:grid-cols-4">
          <Counter
            label="Training images processed"
            value={show(c.imagesProcessed)}
            note={train ? `${fmtInt(train)} per epoch; every image is seen again in each epoch.` : "Known once the dataset split is ready."}
          />
          <Counter
            label="Optimizer steps"
            value={show(c.optimizerSteps)}
            note={
              c.stepsPerEpoch != null
                ? `One per batch${batch ? ` of ${batch}` : ""}: loss, backpropagation, weight update. ${fmtInt(c.stepsPerEpoch)} per epoch.`
                : "One per batch: loss, backpropagation, weight update."
            }
          />
          <Counter
            label="Parameter updates"
            value={show(c.parameterUpdates, (n) => fmtSci(n))}
            note={
              c.trainableParameters != null
                ? `Steps × ${fmtInt(c.trainableParameters)} trainable weights: individual values rewritten, not calculations.`
                : "Steps × trainable weights; for this architecture the trainable count is recorded when the model is saved."
            }
          />
          <Counter
            label="Training FLOPs"
            estimate
            value={show(c.trainingFlopsEstimate, (n) => fmtSci(n))}
            note={
              gflops != null
                ? `≈ 3 × ${fmtNum(gflops, gflops < 10 ? 3 : 1)} GFLOPs per image (forward, ${c.forwardFlopsSource === "measured" ? "counted from the saved model" : "from the layer shapes"}; backward ≈ 2 × forward) × images processed. Validation excluded.`
                : "Needs a per-image operation count, available for this architecture once the model is saved."
            }
          />
        </div>
        {running ? <Facts active={running} /> : null}
      </div>
    </Panel>
  );
}
