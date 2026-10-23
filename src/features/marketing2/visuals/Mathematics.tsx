import { useMemo, type ReactNode } from "react";
import { motion, useReducedMotion, type MotionValue } from "framer-motion";
import { cn } from "@/lib/utils";
import { asset, hero, labmaps, training } from "../data";
import { EASE, Pinned, ProvenanceTag, linePath, scale, usePinEnabled } from "../ui";
import { GradientLandscape } from "./GradientLandscape";
import { FitLine, Frac, I, Sum, Term } from "./math";
import { ConvScan } from "./ModelLab";

const convWeights = training.arch.filter((l) => l.kind === "Conv2D").reduce((a, l) => a + l.params, 0);
const SAMPLE = labmaps.samples[labmaps.trace_index];
const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

const inView = (reduce: boolean | null, delay = 0) =>
  reduce
    ? {}
    : {
        initial: { opacity: 0, y: 26, filter: "blur(8px)" },
        whileInView: { opacity: 1, y: 0, filter: "blur(0px)" },
        viewport: { once: true, margin: "0px 0px -15% 0px" },
        transition: { duration: 1, ease: EASE, delay },
      };

function Card({ title, meta, children, className }: { title: string; meta?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-[18px] border border-white/[0.09] bg-[#08090b] p-4 sm:p-6", className)}>
      <div className="flex items-baseline justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-white/40">
        <span>{title}</span>
        {meta ? <span className="hidden normal-case tracking-normal text-white/30 sm:inline">{meta}</span> : null}
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ visuals */

function PoolVisual() {
  const reduce = useReducedMotion();
  const widths = [100, 72, 50];
  const pooled = labmaps.features.map((f) => Math.floor(f.h / 2));
  return (
    <Card title="Three conv blocks" meta="real feature maps · MSFT test window">
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-end gap-3">
        {labmaps.features.map((f, k) => (
          <FragmentRow key={f.name} last={k === labmaps.features.length - 1}>
            <motion.div
              className="flex flex-col items-center"
              initial={reduce ? false : { opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.8, ease: EASE, delay: 0.15 + k * 0.25 }}
            >
              <div className="grid grid-cols-2 gap-1" style={{ width: `${widths[k]}%` }}>
                {f.files.slice(0, 4).map((file) => (
                  <img key={file} src={asset(file)} alt="" className="aspect-square w-full rounded-[3px] border border-white/[0.1] [image-rendering:pixelated]" />
                ))}
              </div>
              <div className="mt-3 text-center font-mono text-[12px] leading-relaxed text-white/45">
                <div className="text-white/80">
                  {f.h}² × {f.channels}
                </div>
                <div>pool → {pooled[k]}²</div>
              </div>
            </motion.div>
          </FragmentRow>
        ))}
      </div>
    </Card>
  );
}

function FragmentRow({ children, last }: { children: ReactNode; last: boolean }) {
  return (
    <>
      {children}
      {last ? null : (
        <div className="mb-14 flex flex-col items-center gap-1 font-mono text-[11px] text-white/35">
          <svg width="30" height="10" viewBox="0 0 30 10" aria-hidden>
            <path d="M1 5H27M23 1l4 4-4 4" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
          </svg>
          max 2×2
        </div>
      )}
    </>
  );
}

const SW = 620;
const SH = 330;

function SigmoidVisual() {
  const reduce = useReducedMotion();
  const thr = hero.threshold;
  const g = useMemo(() => {
    const x = scale(-3, 3, 40, SW - 16);
    const y = scale(0, 1, SH - 34, 14);
    const curve = linePath(Array.from({ length: 121 }, (_, i) => -3 + i * 0.05).map((z) => [x(z), y(sigmoid(z))]));
    const dots = hero.predictions.map((d) => {
      const z = Math.max(-3, Math.min(3, logit(Math.min(0.999, Math.max(0.001, d.p)))));
      return { cx: x(z), cy: y(d.p), on: d.p >= thr };
    });
    return { x, y, curve, dots };
  }, [thr]);
  const above = g.dots.filter((d) => d.on).length;
  const sz = logit(SAMPLE.p);
  return (
    <Card title="Every test day, on the sigmoid" meta={`${hero.predictions.length} MSFT test days`}>
      <svg viewBox={`0 0 ${SW} ${SH}`} className="block h-auto w-full" role="img" aria-label={`Sigmoid curve with ${hero.predictions.length} real test-day probabilities and the locked threshold ${thr}`}>
        <defs>
          <linearGradient id="m2-sig" x1="0" x2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
            <stop offset="100%" stopColor="#ffffff" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={40} x2={SW - 16} y1={g.y(v)} y2={g.y(v)} stroke="rgba(255,255,255,0.06)" />
            <text x={30} y={g.y(v) + 3} textAnchor="end" className="fill-white/35 font-mono text-[10px]">
              {v}
            </text>
          </g>
        ))}
        <line x1={40} x2={SW - 16} y1={g.y(thr)} y2={g.y(thr)} stroke="rgba(255,255,255,0.4)" strokeDasharray="4 4" />
        <text x={SW - 18} y={g.y(thr) - 7} textAnchor="end" className="fill-white/70 font-mono text-[12px]">
          threshold {thr}
        </text>
        <motion.path
          d={g.curve}
          fill="none"
          stroke="url(#m2-sig)"
          strokeWidth="2.2"
          initial={reduce ? false : { pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 1.6, ease: EASE }}
        />
        <motion.g initial={reduce ? false : { opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, amount: 0.5 }} transition={{ duration: 1, delay: 1 }}>
          {g.dots.map((d, i) => (
            <circle key={i} cx={d.cx} cy={d.cy} r="2.2" fill={d.on ? "#ffffff" : "rgba(255,255,255,0.35)"} opacity={d.on ? 0.5 : 0.3} />
          ))}
          <circle cx={g.x(sz)} cy={g.y(SAMPLE.p)} r="6" fill="#050506" stroke="#b9d3ff" strokeWidth="1.8" />
          <text x={g.x(sz) - 10} y={g.y(SAMPLE.p) - 12} textAnchor="end" className="fill-[#b9d3ff] font-mono text-[12.5px]">
            this chart · p {SAMPLE.p.toFixed(2)}
          </text>
        </motion.g>
      </svg>
      <p className="mt-3 text-[14px] text-white/50">
        {above} of {hero.predictions.length} test days clear the threshold: those are the days the backtest trades.
      </p>
    </Card>
  );
}

function LossVisual() {
  const reduce = useReducedMotion();
  const ep = training.epochs;
  const g = useMemo(() => {
    const vals = ep.flatMap((e) => [e.loss, e.val_loss]);
    const x = scale(1, ep.length, 48, SW - 20);
    const y = scale(Math.min(...vals) - 0.01, Math.max(...vals) + 0.01, SH - 34, 16);
    return {
      x,
      y,
      train: linePath(ep.map((e) => [x(e.e), y(e.loss)])),
      val: linePath(ep.map((e) => [x(e.e), y(e.val_loss)])),
      ticks: [Math.min(...vals), Math.max(...vals)],
    };
  }, [ep]);
  const best = ep.find((e) => e.e === training.best_epoch) ?? ep[0];
  const draw = (delay: number) =>
    reduce
      ? {}
      : { initial: { pathLength: 0 }, whileInView: { pathLength: 1 }, viewport: { once: true, amount: 0.5 }, transition: { duration: 1.5, ease: EASE, delay } };
  return (
    <Card title="Loss per epoch" meta={`${training.train_samples.toLocaleString("en-US")} train / ${training.val_samples} validation`}>
      <svg viewBox={`0 0 ${SW} ${SH}`} className="block h-auto w-full" role="img" aria-label={`Training and validation loss over ${ep.length} epochs; best epoch ${best.e}`}>
        <defs>
          <linearGradient id="m2-loss" x1="0" x2="1">
            <stop offset="0%" stopColor="#a6ecc8" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#a6ecc8" />
          </linearGradient>
        </defs>
        {g.ticks.map((v) => (
          <g key={v}>
            <line x1={48} x2={SW - 20} y1={g.y(v)} y2={g.y(v)} stroke="rgba(255,255,255,0.06)" />
            <text x={40} y={g.y(v) + 3} textAnchor="end" className="fill-white/35 font-mono text-[10px]">
              {v.toFixed(3)}
            </text>
          </g>
        ))}
        {ep.map((e) => (
          <text key={e.e} x={g.x(e.e)} y={SH - 12} textAnchor="middle" className="fill-white/30 font-mono text-[10px]">
            {e.e}
          </text>
        ))}
        <line x1={g.x(best.e)} x2={g.x(best.e)} y1={12} y2={SH - 28} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 4" />
        <motion.path d={g.train} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.6" {...draw(0)} />
        <motion.path d={g.val} fill="none" stroke="url(#m2-loss)" strokeWidth="2.4" {...draw(0.25)} />
        <circle cx={g.x(best.e)} cy={g.y(best.val_loss)} r="5.5" fill="#050506" stroke="#a6ecc8" strokeWidth="1.8" />
        <text x={g.x(best.e) + 10} y={g.y(best.val_loss) + 20} className="fill-white font-mono text-[12.5px]">
          best epoch {best.e}, restored
        </text>
      </svg>
      <div className="mt-3 flex gap-5 text-[13px] text-white/50">
        <span>
          <span className="text-white/60">—</span> training
        </span>
        <span>
          <span className="text-[#a6ecc8]">—</span> validation
        </span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ equations */

type Eq = { name: string; flow: string; plain: string; eq: ReactNode; real: string[]; visual: ReactNode };

const EQUATIONS: Eq[] = [
  {
    name: "Convolution",
    flow: "chart pixels → activations",
    plain: "A 3 × 3 filter slides over the chart image. Each output value (blue) is a weighted sum of the patch under it (green), plus a bias.",
    eq: (
      <>
        <Term c="ice">
          <I>z</I>
          <sub>k</sub>(<I>i</I>,<I>j</I>)
        </Term>{" "}
        = <I>b</I>
        <sub>k</sub> + <Sum sub="c" />
        <Sum sub="u,v" />
        <I>W</I>
        <sub>k,c</sub>(<I>u</I>,<I>v</I>){" "}
        <Term c="mint">
          <I>a</I>
          <sub>c</sub>(<I>i</I>+<I>u</I>, <I>j</I>+<I>v</I>)
        </Term>
      </>
    ),
    real: ["3 × 3 kernels", "32 · 64 · 128 filters", `${convWeights.toLocaleString("en-US")} weights`],
    visual: (
      <Card title="One filter, one position" meta="input → first conv layer">
        <ConvScan />
      </Card>
    ),
  },
  {
    name: "Activation and pooling",
    flow: "activations → smaller, deeper maps",
    plain: "ReLU keeps the positive responses; a 2 × 2 max (green) halves the resolution. Three blocks deep, the chart is 128 maps of 26 × 26.",
    eq: (
      <>
        <I>m</I>(<I>i</I>,<I>j</I>) ={" "}
        <Term c="mint">
          max<sub>u,v∈{"{0,1}"}</sub>
        </Term>{" "}
        max(0, <I>z</I>(2<I>i</I>+<I>u</I>, 2<I>j</I>+<I>v</I>))
      </>
    ),
    real: ["222² → 111²", "109² → 54²", "52² → 26²"],
    visual: <PoolVisual />,
  },
  {
    name: "Output",
    flow: "86,528 features → one probability",
    plain: "The last maps are flattened, passed through a dense layer and squashed into one probability (blue). The marked point is the chart from the Analysis Lab above.",
    eq: (
      <>
        <Term c="ice">
          <I>p</I>
        </Term>{" "}
        = σ(<I>w</I>
        <sup>⊤</sup>ReLU(<I>V</I>
        <I>h</I> + <I>c</I>) + <I>b</I>)
      </>
    ),
    real: ["86,528 features", "128 units", "1 probability"],
    visual: <SigmoidVisual />,
  },
  {
    name: "Loss",
    flow: "probability vs. what happened → one number",
    plain: "Binary cross-entropy compares each probability with the realised label. The validation loss (green) decides which epoch is kept.",
    eq: (
      <>
        <Term c="mint">
          <I>L</I>
        </Term>{" "}
        = −<Frac n="1" d={<I>N</I>} />
        <Sum sub="n" />[<I>y</I>
        <sub>n</sub> log <I>p</I>
        <sub>n</sub> + (1−<I>y</I>
        <sub>n</sub>) log(1−<I>p</I>
        <sub>n</sub>)]
      </>
    ),
    real: ["binary cross-entropy", "batches of 16", "early stopping on validation loss"],
    visual: <LossVisual />,
  },
];

function EquationRow({ e, k }: { e: Eq; k: number }) {
  const reduce = useReducedMotion();
  const flip = k % 2 === 1;
  return (
    <article id={`eq-${k + 1}`} className="grid scroll-mt-24 gap-10 border-t border-white/[0.07] py-14 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-20">
      <div className={cn("min-w-0", flip && "lg:order-2")}>
        <motion.div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em] text-white/45" {...inView(reduce)}>
          <span className="text-white/80">{String(k + 1).padStart(2, "0")}</span>
          <span className="h-px w-8 bg-white/25" aria-hidden />
          {e.name}
        </motion.div>
        <motion.div
          className="mt-8 pb-2 text-[clamp(1.75rem,2.75vw,3rem)] font-light leading-[1.3] text-white"
          {...inView(reduce, 0.08)}
        >
          <FitLine>{e.eq}</FitLine>
        </motion.div>
        <motion.p className="mt-7 max-w-lg text-[18px] leading-[1.6] text-white/60" {...inView(reduce, 0.16)}>
          {e.plain}
        </motion.p>
        <motion.details className="group mt-6 text-[14px] text-white/50" {...inView(reduce, 0.22)}>
          <summary className="inline-flex cursor-pointer list-none items-center gap-2 transition-colors hover:text-white [&::-webkit-details-marker]:hidden">
            <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
              ›
            </span>
            Numbers from this model
          </summary>
          <ul className="mt-3 flex flex-wrap gap-2">
            {e.real.map((r) => (
              <li key={r} className="rounded-full border border-white/[0.1] px-3 py-1 font-mono text-[12px] text-white/60">
                {r}
              </li>
            ))}
          </ul>
        </motion.details>
      </div>
      <motion.div className={cn("min-w-0", flip && "lg:order-1")} {...inView(reduce, 0.1)}>
        {e.visual}
      </motion.div>
    </article>
  );
}

function Update({ progress }: { progress?: MotionValue<number> }) {
  const reduce = useReducedMotion();
  const anim = progress ? () => ({}) : (d: number) => inView(reduce, d);
  return (
    <div className="w-full">
      <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
        <motion.div className="lg:col-span-7" {...anim(0)}>
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em] text-white/45">
            <span className="text-white/80">05</span>
            <span className="h-px w-8 bg-white/25" aria-hidden />
            Training
          </div>
          <h3 className="mt-5 text-[clamp(1.8rem,2.5vw,2.7rem)] font-normal leading-[1.1] tracking-[-0.03em] text-white">How the network learns.</h3>
          <p className="mt-4 max-w-xl text-[18px] leading-[1.6] text-white/60">
            Training nudges all {training.params.toLocaleString("en-US")} weights, step by step, downhill on the loss. This is the network&rsquo;s own
            optimisation, not the Labeling Optimizer&rsquo;s search over label rules.
          </p>
        </motion.div>
        <motion.div className="lg:col-span-5" {...anim(0.1)}>
          <div className="text-[clamp(1.6rem,2.3vw,2.4rem)] font-light leading-[1.2] text-white">
            <I>θ</I> ← <I>θ</I> − <I>η</I> <Frac n={<I>m̂</I>} d={<>√<I>v̂</I> + <I>ε</I></>} />
          </div>
          <p className="mt-3 text-[14px] leading-relaxed text-white/45">
            Adam, η = 10⁻³. Below: the same idea on a two-parameter surface{progress ? ", driven by your scroll" : ""}.
          </p>
        </motion.div>
      </div>
      <div className="mt-7">
        <GradientLandscape progress={progress} compact={!!progress} />
      </div>
    </div>
  );
}

/** Five equations of the real network, each set large next to the visual it describes. */
export function Mathematics() {
  const pin = usePinEnabled();
  return (
    <div>
      {EQUATIONS.map((e, k) => (
        <EquationRow key={e.name} e={e} k={k} />
      ))}

      <article id="eq-5" className="scroll-mt-24 border-t border-white/[0.07]">
        {pin ? (
          <Pinned length="240vh">{(p) => <Update progress={p} />}</Pinned>
        ) : (
          <div className="pt-14 lg:pt-20">
            <Update />
          </div>
        )}
      </article>

      <div className="mt-8">
        <ProvenanceTag kind="real" detail="Equations, shapes, feature maps, probabilities and losses from the MSFT4000 run; the loss surface is illustrative" />
      </div>
    </div>
  );
}
