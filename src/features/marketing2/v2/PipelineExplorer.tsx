import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { asset, grid, labmaps, screen, training } from "../data";
import { EASE, ProvenanceTag } from "../ui";
import { FACTS } from "./facts";

type Stage = {
  id: string;
  verb: string;
  title: string;
  body: string;
  facts: string[];
  guard: string;
  tool: { label: string; href: string };
  visual: () => ReactNode;
};

function Frame({ children, caption }: { children: ReactNode; caption: ReactNode }) {
  return (
    <figure className="flex h-full flex-col overflow-hidden rounded-[16px] border border-white/[0.12] bg-[#08090b]">
      <div className="relative min-h-0 flex-1">{children}</div>
      <figcaption className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] px-4 py-2.5">{caption}</figcaption>
    </figure>
  );
}

function Screenshot({ name, alt }: { name: string; alt: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-[#050506] p-3 sm:p-4">
      <img src={screen(name)} alt={alt} loading="lazy" decoding="async" className="max-h-full w-full rounded-[10px] border border-white/[0.08] object-contain object-top" />
    </div>
  );
}

function ChartGrid() {
  const tiles = grid.tiles.slice(0, 8);
  return (
    <div className="grid h-full grid-cols-4 content-center gap-2 p-4 sm:gap-3 sm:p-6">
      {tiles.map((t) => (
        <div key={t.file} className="relative">
          <img
            src={asset(t.file)}
            alt={`${grid.symbol} chart ${t.start} to ${t.end}, label ${t.label}`}
            loading="lazy"
            className="aspect-square w-full rounded-md border border-white/[0.1] bg-white"
          />
          <span
            className={cn(
              "absolute right-1 top-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
              t.label === 1 ? "bg-[color:var(--convolve-chart-accent)] text-black" : "bg-black/70 text-white/80",
            )}
          >
            {t.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function TrainingCurve() {
  const ep = training.epochs;
  const W = 520;
  const H = 260;
  const pad = { l: 40, r: 16, t: 18, b: 30 };
  const maxLoss = Math.max(...ep.flatMap((e) => [e.loss, e.val_loss]));
  const x = (e: number) => pad.l + ((e - 1) / Math.max(1, ep.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / maxLoss) * (H - pad.t - pad.b);
  const path = (k: "loss" | "val_loss") => ep.map((e, i) => `${i ? "L" : "M"}${x(e.e).toFixed(1)},${y(e[k]).toFixed(1)}`).join(" ");
  const bx = x(training.best_epoch);
  return (
    <div className="flex h-full flex-col justify-center p-4 sm:p-6">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Training and validation loss over ${ep.length} epochs; the best validation loss is at epoch ${training.best_epoch}.`}>
        {[0, 0.5, 1, 1.5, 2].filter((v) => v <= maxLoss).map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.06)" />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.4)" fontFamily="ui-monospace, monospace">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        {ep.map((e) => (
          <text key={e.e} x={x(e.e)} y={H - 10} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.4)" fontFamily="ui-monospace, monospace">
            {e.e}
          </text>
        ))}
        <line x1={bx} x2={bx} y1={pad.t} y2={H - pad.b} stroke="rgba(255,255,255,0.35)" strokeDasharray="3 4" />
        <text x={bx + 6} y={pad.t + 10} fontSize="10.5" fill="rgba(255,255,255,0.75)" fontFamily="ui-monospace, monospace">
          best epoch {training.best_epoch}
        </text>
        <path d={path("loss")} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2" />
        <path d={path("val_loss")} fill="none" stroke="var(--convolve-chart-accent)" strokeWidth="2.25" />
      </svg>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-white/55">
        <span className="inline-flex items-center gap-2">
          <span className="h-0.5 w-4 bg-white/45" aria-hidden /> Training loss
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-0.5 w-4 bg-[color:var(--convolve-chart-accent)]" aria-hidden /> Validation loss
        </span>
      </div>
    </div>
  );
}

function Attention() {
  const samples = labmaps.samples.slice(0, 3);
  return (
    <div className="grid h-full grid-cols-3 content-center gap-3 p-4 sm:gap-4 sm:p-6">
      {samples.map((s) => (
        <div key={s.date}>
          <div className="relative aspect-square overflow-hidden rounded-md border border-white/[0.1] bg-white">
            <img src={asset(s.input)} alt={`Chart ending ${s.date}`} loading="lazy" className="absolute inset-0 h-full w-full" />
            <img src={asset(s.gradcam)} alt="" loading="lazy" className="absolute inset-0 h-full w-full opacity-75" />
          </div>
          <div className="mt-2 font-mono text-[10.5px] text-white/50">
            {s.date} · p = {s.p.toFixed(2)}
          </div>
        </div>
      ))}
    </div>
  );
}

const TONE: Record<string, string> = {
  negative: "border-[#d98b84]/40 text-[#e9b0aa]",
  caution: "border-amber-300/35 text-amber-100/85",
  neutral: "border-white/20 text-white/70",
};

function Diagnosis() {
  return (
    <div className="flex h-full flex-col justify-center gap-2 p-4 sm:p-6">
      {FACTS.findings.slice(0, 4).map((f) => (
        <div key={f.title} className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-2.5">
          <div className="flex items-start gap-2.5">
            <span className={cn("mt-0.5 shrink-0 rounded-full border px-2 py-px font-mono text-[9.5px] uppercase tracking-[0.12em]", TONE[f.severity] ?? TONE.neutral)}>
              {f.severity}
            </span>
            <div className="min-w-0">
              <div className="text-[13px] leading-snug text-white/90">{f.title}</div>
              <div className="mt-0.5 text-[12px] leading-snug text-white/50">{f.interpretation}</div>
            </div>
          </div>
        </div>
      ))}
      <div className="mt-1 flex items-center gap-2 rounded-xl border border-dashed border-white/20 px-3.5 py-2.5 text-[12.5px] text-white/70">
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/50" aria-hidden />
        Improve turns findings like these into the next controlled experiment.
      </div>
    </div>
  );
}

export const STAGES: Stage[] = [
  {
    id: "build",
    verb: "Build",
    title: "Turn price history into labelled chart images.",
    body: "Choose symbols, a period and a label rule. The Generator draws one chart per window and labels it by what happened next: did price reach the take-profit before the stop-loss?",
    facts: [`Label rule: ${FACTS.rule.tp} take-profit, ${FACTS.rule.sl} stop-loss, ${FACTS.rule.horizon} bars`, `${FACTS.charts} ${FACTS.symbol} charts at ${FACTS.size} × ${FACTS.size} px`],
    guard: "Test data is generated as its own set, so it can be kept out of training.",
    tool: { label: "Generator", href: "/tools/generator" },
    visual: () => (
      <Frame caption={<ProvenanceTag kind="real" detail={`${FACTS.symbol} charts and labels`} />}>
        <ChartGrid />
      </Frame>
    ),
  },
  {
    id: "train",
    verb: "Train",
    title: "Train a convolutional network on them.",
    body: "Pick an architecture; training runs on Convolve's servers, with no code and no GPU setup. Training stops when the validation loss stops improving.",
    facts: [`${FACTS.trainN} training and ${FACTS.valN} validation charts`, `Best epoch ${FACTS.bestEpoch}; stopped after ${FACTS.epochsTrained} of ${FACTS.epochsConfigured}`],
    guard: "Chronological validation holds out the most recent charts and purges overlapping windows.",
    tool: { label: "Trainer", href: "/tools/trainer" },
    visual: () => (
      <Frame caption={<ProvenanceTag kind="real" detail="training log of the same run" />}>
        <TrainingCurve />
      </Frame>
    ),
  },
  {
    id: "understand",
    verb: "Understand",
    title: "See what the network looked at.",
    body: "The Lab maps which pixels drove each prediction with Grad-CAM, saliency, SmoothGrad and occlusion, then tests whether those maps are faithful to the model.",
    facts: [FACTS.candleAttention, `Maps from layer ${FACTS.labLayer}`],
    guard: "Every finding is labelled supported, inconclusive or hypothesis.",
    tool: { label: "Lab", href: "/tools/analysis" },
    visual: () => (
      <Frame caption={<ProvenanceTag kind="real" detail="Grad-CAM on test charts" />}>
        <Attention />
      </Frame>
    ),
  },
  {
    id: "backtest",
    verb: "Backtest",
    title: "Test it on data it has never seen.",
    body: "The Backtester runs the model on a separate test set with commission, slippage and a decision threshold locked on validation data, against SPY, buy-and-hold and an exposure-matched mix.",
    facts: [`${FACTS.testN} test charts, ${FACTS.period[0]} to ${FACTS.period[1]}`, `${FACTS.commission} commission and ${FACTS.slippage} slippage per trade`],
    guard: "A compatibility check warns when the test data overlaps the model's training data.",
    tool: { label: "Backtester", href: "/tools/backtester" },
    visual: () => (
      <Frame caption={<ProvenanceTag kind="real" detail="Backtester result page" />}>
        <Screenshot name="bt_overview" alt="Backtester overview with equity curve against benchmarks" />
      </Frame>
    ),
  },
  {
    id: "improve",
    verb: "Improve",
    title: "Improve it with controlled experiments.",
    body: "Improve reads the diagnostics, recommends the next experiment and compares every variant with the original model. You decide what to keep; nothing is deleted.",
    facts: ["One recommended experiment at a time", "Variants are compared with one fixed original"],
    guard: "A variant only counts as better when the gain exceeds run-to-run noise from repeated seeds.",
    tool: { label: "Improve", href: "/tools/improve" },
    visual: () => (
      <Frame caption={<ProvenanceTag kind="real" detail="backtest findings of the same run" />}>
        <Diagnosis />
      </Frame>
    ),
  },
  {
    id: "deploy",
    verb: "Deploy",
    title: "Run it on a schedule, on paper.",
    body: "Put a tested model on a schedule: it predicts, acts on a simulated account and reports back. Every deployment traces back to the experiment behind it.",
    facts: ["Scheduled predictions on a virtual balance", "Lineage from label rule to backtest"],
    guard: "Paper trading only: no order reaches a market.",
    tool: { label: "Deploy", href: "/tools/deploy" },
    visual: () => (
      <Frame caption={<ProvenanceTag kind="real" detail="lineage of generator runs, models and backtests" />}>
        <Screenshot name="lineage" alt="Lineage graph linking generator runs, datasets, training runs, models, test sets and backtests" />
      </Frame>
    ),
  },
];

const ADVANCE_MS = 7000;

/** Six-stage tabbed walkthrough. Auto-advances while visible unless the visitor interacts or prefers reduced motion. */
export function PipelineExplorer() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [touched, setTouched] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const inView = useInView(root, { amount: 0.35 });
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const uid = useId();
  const auto = !reduce && !touched && !paused && inView;

  useEffect(() => {
    if (!auto) return;
    const id = window.setTimeout(() => setActive((a) => (a + 1) % STAGES.length), ADVANCE_MS);
    return () => window.clearTimeout(id);
  }, [auto, active]);

  const select = (i: number, focus = false) => {
    setTouched(true);
    setActive(i);
    if (focus) tabs.current[i]?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = STAGES.length - 1;
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? (active === last ? 0 : active + 1)
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (active === 0 ? last : active - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next == null) return;
    e.preventDefault();
    select(next, true);
  };

  const s = STAGES[active];
  return (
    <div
      ref={root}
      className="grid gap-5 lg:grid-cols-12 lg:gap-8"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div
        role="tablist"
        aria-label="Convolve workflow"
        aria-orientation="vertical"
        onKeyDown={onKey}
        className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:-mx-8 sm:px-8 lg:col-span-3 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0"
      >
        {STAGES.map((st, i) => {
          const on = i === active;
          return (
            <button
              key={st.id}
              ref={(el) => (tabs.current[i] = el)}
              id={`${uid}-tab-${st.id}`}
              role="tab"
              type="button"
              aria-selected={on}
              aria-controls={`${uid}-panel`}
              tabIndex={on ? 0 : -1}
              onClick={() => select(i)}
              className={cn(
                "group relative flex shrink-0 items-center gap-3 overflow-hidden rounded-xl border px-3.5 py-2.5 text-left transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--convolve-focus-ring)] lg:px-4 lg:py-3.5",
                on ? "border-white/25 bg-white/[0.06] text-white" : "border-transparent text-white/50 hover:bg-white/[0.03] hover:text-white/85",
              )}
            >
              <span className={cn("font-mono text-[11px] tabular-nums", on ? "text-white/80" : "text-white/35")}>{String(i + 1).padStart(2, "0")}</span>
              <span className="text-[15px] font-medium lg:text-[17px]">{st.verb}</span>
              {on && auto ? (
                <motion.span
                  key={`bar-${active}`}
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-px origin-left bg-white/50"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: ADVANCE_MS / 1000, ease: "linear" }}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        id={`${uid}-panel`}
        role="tabpanel"
        aria-labelledby={`${uid}-tab-${s.id}`}
        className="grid gap-6 lg:col-span-9 lg:grid-cols-9 lg:gap-8"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={s.id}
            className="flex flex-col lg:col-span-4"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <h3 className="text-balance text-[clamp(1.45rem,2vw,2rem)] font-normal leading-[1.12] tracking-[-0.025em] text-white">{s.title}</h3>
            <p className="mt-4 text-[15.5px] leading-[1.6] text-white/60">{s.body}</p>
            <ul className="mt-5 space-y-2 border-t border-white/[0.08] pt-4">
              {s.facts.filter(Boolean).map((f) => (
                <li key={f} className="flex gap-2.5 text-[14px] leading-snug text-white/75">
                  <span className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-white/50" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex gap-2.5 rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-3 text-[13.5px] leading-snug text-white/70">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-white/55" aria-hidden />
              {s.guard}
            </div>
            <Link
              to={s.tool.href}
              className="group mt-5 inline-flex w-fit items-center gap-2 text-[14px] text-white/70 transition-colors hover:text-white lg:mt-auto lg:pt-6"
            >
              Open the {s.tool.label}
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </motion.div>
        </AnimatePresence>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`v-${s.id}`}
            className="h-[320px] sm:h-[400px] lg:col-span-5 lg:h-[460px]"
            initial={reduce ? false : { opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            {s.visual()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
