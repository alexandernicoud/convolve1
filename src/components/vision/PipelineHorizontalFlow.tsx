import { useEffect, useState } from "react";
import { motion, useReducedMotion, LayoutGroup } from "framer-motion";
import { ArrowDown } from "lucide-react";
import trainingdataPng from "@/assets/trainingdata.png";
import trainingPng from "@/assets/training.png";
import backtesterPng from "@/assets/backtester.png";
import dashboardPng from "@/assets/dashboard.png";

const SLIDE_MS = 3000;

/** Main preview slot matches `dashboard.png` (3360×1864); class `aspect-[3360/1864]` must stay literal for Tailwind. */

type PipelineStep = {
  id: string;
  num: string;
  label: string;
  short: string;
  description: string;
  imageSrc: string;
};

const STEPS: PipelineStep[] = [
  {
    id: "charts",
    num: "01",
    label: "Charts",
    short: "Charts",
    description: "Mass-generate large datasets of custom-labeled charts within seconds.",
    imageSrc: trainingdataPng,
  },
  {
    id: "training",
    num: "02",
    label: "Training",
    short: "Train",
    description:
      "Train convolutional neural networks to build custom visual AI models — enhanced with advanced learning visualizations.",
    imageSrc: trainingPng,
  },
  {
    id: "backtest",
    num: "03",
    label: "Backtesting",
    short: "Backtest",
    description:
      "Test your model on real market history and gain clear, data-driven insights into its performance.",
    imageSrc: backtesterPng,
  },
  {
    id: "deploy",
    num: "04",
    label: "Deployment",
    short: "Deploy",
    description: "Once validated, deploy your bot and receive custom-timed predictions from your own model.",
    imageSrc: dashboardPng,
  },
];

type Props = {
  active: boolean;
  reducedMotion: boolean;
};

const pipeLayoutTransition = { type: "spring" as const, stiffness: 160, damping: 28, mass: 1.05 };

function StepNumBadge({ n, size }: { n: string; size: "main" | "queue" }) {
  return (
    <span
      className={`pointer-events-none absolute left-2 top-2 z-[4] sm:left-2.5 sm:top-2.5 ${
        size === "main" ? "text-[clamp(1rem,2.8vw,1.5rem)]" : "text-[clamp(0.65rem,1.5vw,0.85rem)]"
      }`}
      aria-hidden
    >
      <span className="inline-flex items-center justify-center rounded-md bg-white/[0.08] px-1 py-px shadow-[0_1px_3px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.12] backdrop-blur-[1.5px] sm:px-1.5 sm:py-0.5">
        <span className="font-extralight tabular-nums tracking-[-0.06em] text-white [text-shadow:0_0_12px_rgba(255,255,255,0.25),0_1px_2px_rgba(0,0,0,0.5)]">
          {n}
        </span>
      </span>
    </span>
  );
}

function StepImageFrame({
  step,
  variant,
  layoutId,
  motionOff,
}: {
  step: PipelineStep;
  variant: "main" | "queue";
  layoutId?: string;
  motionOff: boolean;
}) {
  const isMain = variant === "main";

  const queueImgClass =
    step.num === "04"
      ? "mx-auto block h-auto max-h-[min(72px,14vw)] w-full max-w-full object-contain object-center"
      : "mx-auto block h-auto max-h-[min(112px,20vw)] w-full max-w-full object-contain object-center";

  const inner = isMain ? (
    <>
      <StepNumBadge n={step.num} size="main" />
      <img
        src={step.imageSrc}
        alt={step.label}
        className="absolute inset-0 z-[1] h-full w-full object-contain object-center"
        loading="lazy"
        decoding="async"
      />
    </>
  ) : (
    <>
      <StepNumBadge n={step.num} size="queue" />
      <img
        src={step.imageSrc}
        alt={step.label}
        className={queueImgClass}
        loading="lazy"
        decoding="async"
      />
    </>
  );

  const shellClass = isMain
    ? "relative z-0 w-full overflow-hidden bg-[#07080c] aspect-[3360/1864]"
    : "relative w-full overflow-hidden rounded-md border border-white/[0.12] bg-[#07080c]";

  if (motionOff || !layoutId) {
    return <div className={shellClass}>{inner}</div>;
  }

  return (
    <motion.div layoutId={layoutId} layout transition={pipeLayoutTransition} className={shellClass}>
      {inner}
    </motion.div>
  );
}

export function PipelineHorizontalFlow({ active, reducedMotion }: Props) {
  const prefersReduced = useReducedMotion();
  const motionOff = reducedMotion || prefersReduced;
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      setPhase((p) => (p + 1) % STEPS.length);
    }, SLIDE_MS);
    return () => window.clearInterval(id);
  }, [active]);

  const featured = STEPS[phase];
  const lid = (id: string) => (motionOff ? undefined : `pipeline-step-${id}`);

  return (
    <div className="flex h-full w-full min-w-0 flex-col gap-1 sm:gap-1.5">
      <LayoutGroup id="vision-pipeline-flow">
        {/* Widget is pinned to bottom of the available vertical space (mt-auto); main preview keeps native aspect */}
        <div className="mx-auto mt-auto w-full max-w-[min(100%,1200px)]">
        <div className="flex min-h-0 flex-1 flex-col rounded-[1rem] border border-white/[0.12] bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:rounded-[1.1rem] lg:flex-row lg:items-start">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/[0.08] sm:mx-0 lg:min-w-0">
            <div className="relative w-full shrink-0">
              <StepImageFrame
                key={featured.id}
                step={featured}
                variant="main"
                layoutId={lid(featured.id)}
                motionOff={motionOff}
              />
            </div>
            <div className="shrink-0 border-t border-white/[0.12] bg-black/45 px-3.5 py-3 sm:px-[1.125rem] sm:py-[1.125rem]">
              <motion.p
                key={`${featured.id}-label`}
                className="text-sm font-semibold uppercase tracking-[0.14em] text-white sm:text-[0.95rem]"
                initial={motionOff ? false : { opacity: 0.65 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.55 }}
              >
                {featured.label} · {featured.num}
              </motion.p>
              <motion.p
                key={`${featured.id}-desc`}
                className="mt-2.5 text-left text-sm leading-relaxed text-white/90 sm:mt-3 sm:text-[0.9rem] sm:leading-[1.5]"
                initial={motionOff ? false : { opacity: 0.55 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.05 }}
              >
                {featured.description}
              </motion.p>
            </div>
          </div>

          <div className="flex w-full shrink-0 flex-col border-t border-white/[0.08] px-2 py-3 sm:px-3 sm:py-4 lg:flex-[0_0_calc(20%-30px)] lg:border-l lg:border-t-0">
            <p className="mb-3 shrink-0 text-[10px] uppercase tracking-[0.18em] text-white/50 sm:text-[11px]">Pipeline</p>
            <div className="flex flex-col gap-[22px] sm:gap-[26px]">
              {STEPS.map((step, i) => {
                const isFeatured = phase === i;
                const isLit = active && phase === i;
                const isPast = active && phase > i;

                return (
                  <div key={step.id} className="flex min-w-0 shrink-0 flex-col gap-2 sm:gap-2.5">
                    <motion.div
                      initial={false}
                      animate={{
                        scale: motionOff || !isLit ? 1 : 1.02,
                        opacity: !active ? 0.5 : isLit || isPast ? 1 : 0.45,
                      }}
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      className={`w-full shrink-0 rounded-lg border px-2 py-1.5 text-center sm:py-2 ${
                        isLit ? "border-white/35 bg-white/[0.1] ring-1 ring-white/12" : "border-white/[0.1] bg-white/[0.03]"
                      }`}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/90 sm:text-xs">{step.short}</p>
                    </motion.div>

                    {!isFeatured ? (
                      <div className="w-full">
                        <StepImageFrame step={step} variant="queue" layoutId={lid(step.id)} motionOff={motionOff} />
                      </div>
                    ) : null}

                    {i < STEPS.length - 1 ? (
                      <div className="relative flex h-4 w-full shrink-0 items-center justify-center">
                        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-white/25 via-white/12 to-white/25 opacity-60" />
                        {active && !motionOff ? (
                          <motion.div
                            className="absolute left-1/2 top-0 h-1/3 w-1.5 -translate-x-1/2 bg-gradient-to-b from-transparent via-white/60 to-transparent"
                            animate={{ y: ["-20%", "120%"] }}
                            transition={{
                              duration: 5.6,
                              repeat: Infinity,
                              ease: "linear",
                              repeatDelay: 0.2,
                              delay: i * 0.15,
                            }}
                          />
                        ) : null}
                        <ArrowDown className="relative z-[1] h-3 w-3 text-white/50" strokeWidth={2} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        </div>
      </LayoutGroup>
    </div>
  );
}
