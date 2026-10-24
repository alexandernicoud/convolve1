import { useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { asset, grid, outcome, type OutcomeExample } from "../data";
import { Container, Kicker, ProvenanceTag, TYPE, fmtDate, useMediaQuery, useStep } from "../ui";

const COLS = 9;
const LABEL_AT: [number, number] = [0.62, 0.72];
const MINT = "#a6ecc8";
const pct = (x: number) => `${+(x * 100).toFixed(2)}%`;
const rule = `+${pct(grid.tp)} before −${pct(grid.sl)} within ${grid.horizon} bars`;
const perLabel = Math.round(grid.count / 2);
const sampleEvery = Math.max(1, Math.floor(grid.count / grid.tiles.length));
const sampleNote = `${grid.tiles.length} of ${grid.count.toLocaleString("en-US")} images, every ${sampleEvery}th in date order`;

const STAGES = [
  { k: "Price", text: `Six months of daily ${grid.symbol} prices.` },
  { k: "Image", text: `Rendered as the ${grid.size} × ${grid.size} picture the network reads.` },
  { k: "Outcome", text: `The next ${grid.horizon} bars decide: does price reach +${pct(grid.tp)} before −${pct(grid.sl)}?` },
  { k: "Label", text: "Take-profit first: label 1. Stop-loss first, or neither in time: label 0." },
] as const;

function Tile({ i, p }: { i: number; p: MotionValue<number> }) {
  const t = grid.tiles[i];
  const a = i * 2.399963;
  const r = 520 + ((i * 97) % 380);
  const s = (i / grid.tiles.length) * 0.24;
  const x = useTransform(p, [s, s + 0.28], [Math.cos(a) * r, 0]);
  const y = useTransform(p, [s, s + 0.28], [Math.sin(a) * r * 0.62, 0]);
  const rotate = useTransform(p, [s, s + 0.28], [((i * 53) % 70) - 35, 0]);
  const scale = useTransform(p, [s, s + 0.28], [0.45, 1]);
  const opacity = useTransform(p, [s, s + 0.1, LABEL_AT[0], LABEL_AT[1]], [0, 1, 1, t.label ? 1 : 0.5]);
  const ring = useTransform(p, LABEL_AT, [0, t.label ? 1 : 0]);
  return (
    <motion.div className="relative aspect-square" style={{ x, y, rotate, scale, opacity }}>
      <img src={asset(t.file)} alt="" className="h-full w-full rounded-[5px] border border-white/[0.12] bg-[#050506]" draggable={false} />
      <motion.span aria-hidden className="pointer-events-none absolute -inset-[2px] rounded-[6px] border" style={{ opacity: ring, borderColor: `${MINT}b3` }} />
    </motion.div>
  );
}

const PIPELINE = ["Market data", "Chart", "Label", "Convolution", "Features", "Prediction", "Training", "Evaluation"];
const PIPELINE_AT = [0.3, 0.6];
const INTRO = "A trading idea enters Convolve as a rule about the future and leaves as a measured model. First, the rule becomes data.";
const LABEL_NOTE = "The label is the objective the network trains toward; the Labeling Optimizer searches for a good one.";

type Phase = { range: [number, number]; mode: "out" | "in" | "inout"; lines: [string, string]; sub?: string; as?: "h2" | "h3" };

const PHASES: Phase[] = [
  { range: [0.26, 0.32], mode: "out", lines: ["From a price series", "to a tested probability."], sub: INTRO, as: "h2" },
  { range: [0.3, 0.36], mode: "inout", lines: ["Every price window", "becomes an image."] },
  { range: [0.54, 0.62], mode: "in", lines: ["Labelled by", "what happened next."], sub: LABEL_NOTE },
];

function Headline({ p, phase, next }: { p: MotionValue<number>; phase: Phase; next?: [number, number] }) {
  const [a, b] = phase.range;
  const input = phase.mode === "inout" && next ? [a, b, next[0], next[1]] : [a, b];
  const fade = phase.mode === "in" ? [0, 1] : phase.mode === "out" ? [1, 0] : [0, 1, 1, 0];
  const lift = phase.mode === "in" ? [20, 0] : phase.mode === "out" ? [0, -20] : [20, 0, 0, -20];
  const opacity = useTransform(p, input, fade);
  const y = useTransform(p, input, lift);
  const H = phase.as === "h2" ? motion.h2 : motion.h3;
  return (
    <motion.div className="[grid-area:1/1]" style={{ opacity, y }}>
      <H className="text-[clamp(1.9rem,2.7vw,3rem)] font-extralight leading-[1.08] tracking-[-0.04em] text-white">
        {phase.lines[0]}
        <br />
        <span className="text-white/45">{phase.lines[1]}</span>
      </H>
      {phase.sub ? <p className={`mt-4 max-w-sm ${TYPE.small}`}>{phase.sub}</p> : null}
    </motion.div>
  );
}

function Pipeline({ active }: { active: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2.5 gap-y-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/30">
      {PIPELINE.map((s, i) => (
        <li key={s} className="flex items-center gap-2.5">
          <span className={cn("transition-colors duration-500", i < active && "text-white/55", i === active && "text-white")}>{s}</span>
          {i < PIPELINE.length - 1 ? <span aria-hidden className="h-px w-4 bg-white/20" /> : null}
        </li>
      ))}
    </ol>
  );
}

function Stage({ i, p }: { i: number; p: MotionValue<number> }) {
  const at = [0.08, 0.34, 0.5, 0.64][i];
  const opacity = useTransform(p, [at - 0.06, at], [0.32, 1]);
  const bar = useTransform(p, [at - 0.06, at], [0, 1]);
  return (
    <motion.li className="relative grid grid-cols-[5.75rem_1fr] gap-3 py-2.5" style={{ opacity }}>
      <motion.span aria-hidden className="absolute -left-4 top-3 h-[calc(100%-1.5rem)] w-px origin-top bg-white/70" style={{ scaleY: bar }} />
      <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/50">
        0{i + 1} {STAGES[i].k}
      </span>
      <span className="text-[14.5px] leading-snug text-white/70">{STAGES[i].text}</span>
    </motion.li>
  );
}

function Legend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[10.5px] text-white/45", className)}>
      <span className="inline-flex items-center gap-2">
        <span aria-hidden className="h-3 w-3 rounded-[3px] border" style={{ borderColor: `${MINT}b3` }} />
        label 1 · take-profit first
      </span>
      <span className="inline-flex items-center gap-2">
        <span aria-hidden className="h-3 w-3 rounded-[3px] border border-white/15 opacity-60" />
        label 0 · stop-loss first or no hit
      </span>
    </div>
  );
}

function Pinned({ label }: { label: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const stage = useStep(p, PIPELINE_AT, 0);
  const count = useTransform(p, [0.02, 0.5], [0, grid.count]);
  const countText = useTransform(count, (v) => Math.round(v).toLocaleString("en-US"));
  const countOpacity = useTransform(p, [0.01, 0.05], [0, 1]);
  const ruleOpacity = useTransform(p, LABEL_AT, [0, 1]);
  const mosaicScale = useTransform(p, [0.88, 1], [1, 0.96]);
  const bar = useTransform(p, [0, 1], [0, 1]);
  return (
    <div ref={ref} className="relative h-[210vh]">
      <div className="sticky top-[80px] flex h-[calc(100svh-80px)] items-center overflow-hidden">
        <Container className="relative grid grid-cols-12 items-center gap-x-12 gap-y-10">
          <div className="col-span-4 self-end">{label}</div>
          <div className="col-span-8 self-end">
            <Pipeline active={stage} />
          </div>
          <div className="relative z-10 col-span-4 flex flex-col">
            <div className="grid">
              <Headline p={p} phase={PHASES[0]} />
              <Headline p={p} phase={PHASES[1]} next={[0.46, 0.54]} />
              <Headline p={p} phase={PHASES[2]} />
            </div>
            <ol className="mt-7 border-l border-white/[0.1] pl-4">
              {STAGES.map((_, i) => (
                <Stage key={i} i={i} p={p} />
              ))}
            </ol>
            <div className="mt-6 border-t border-white/[0.1] pt-5">
              <motion.div className="flex items-baseline gap-3" style={{ opacity: countOpacity }}>
                <motion.span className="text-[clamp(2.2rem,3vw,3.2rem)] font-light tabular-nums tracking-[-0.04em] text-white">{countText}</motion.span>
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/40">chart images</span>
              </motion.div>
              <motion.p className="mt-2 font-mono text-[11px] text-white/45" style={{ opacity: ruleOpacity }}>
                {perLabel.toLocaleString("en-US")} of each label · balanced
              </motion.p>
            </div>
          </div>
          <div className="col-span-8">
            <motion.div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, scale: mosaicScale }}>
              {grid.tiles.map((t, i) => (
                <Tile key={t.file} i={i} p={p} />
              ))}
            </motion.div>
            <motion.div className="mt-4 flex flex-wrap items-center justify-between gap-3" style={{ opacity: ruleOpacity }}>
              <Legend />
              <span className="rounded-full border border-white/20 px-2.5 py-1 font-mono text-[10.5px] text-white/70">{rule}</span>
            </motion.div>
            <div className="mt-3 flex items-center justify-between gap-4">
              <ProvenanceTag kind="real" detail={`dataset ${grid.symbol} · ${sampleNote} · ${fmtDate(grid.tiles[0].start, { year: "numeric" })} onward`} />
              <span className="h-px w-32 shrink-0 bg-white/[0.1]">
                <motion.span className="block h-full origin-left bg-white/70" style={{ scaleX: bar }} />
              </span>
            </div>
          </div>
        </Container>
      </div>
    </div>
  );
}

function Static({ label }: { label: ReactNode }) {
  return (
    <Container className="pt-16">
      {label}
      <h2 className="mt-6 text-[clamp(1.9rem,7vw,3rem)] font-extralight leading-[1.08] tracking-[-0.04em] text-white">
        From a price series <span className="text-white/45">to a tested probability.</span>
      </h2>
      <p className={`mt-5 max-w-xl ${TYPE.small}`}>{INTRO}</p>
      <div className="mt-6">
        <Pipeline active={2} />
      </div>
      <h3 className="mt-12 text-[clamp(1.5rem,5vw,2.2rem)] font-extralight leading-[1.1] tracking-[-0.04em] text-white">
        Every price window becomes an image, <span className="text-white/45">labelled by what happened next.</span>
      </h3>
      <p className={`mt-4 max-w-xl ${TYPE.small}`}>{LABEL_NOTE}</p>
      <ol className="mt-6 space-y-2 border-l border-white/[0.12] pl-4">
        {STAGES.map((s, i) => (
          <li key={s.k} className="grid grid-cols-[5.75rem_1fr] gap-3">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/50">
              0{i + 1} {s.k}
            </span>
            <span className="text-[14.5px] leading-snug text-white/70">{s.text}</span>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-[15px] text-white/55">
        {grid.count.toLocaleString("en-US")} real {grid.symbol} chart images, {perLabel.toLocaleString("en-US")} of each label.
      </p>
      <div className="mt-6 grid grid-cols-6 gap-1.5 sm:grid-cols-9">
        {grid.tiles.map((t) => (
          <img
            key={t.file}
            src={asset(t.file)}
            alt=""
            className={cn("aspect-square w-full rounded-[4px] border bg-[#050506]", t.label ? "" : "border-white/[0.1] opacity-50")}
            style={t.label ? { borderColor: `${MINT}b3` } : undefined}
          />
        ))}
      </div>
      <Legend className="mt-4" />
      <ProvenanceTag className="mt-3" kind="real" detail={`dataset ${grid.symbol} · ${sampleNote}`} />
    </Container>
  );
}

/** Real daily bars around one chart's end: the chart's last bars, then the horizon that set its label. */
function OutcomeChart({ ex }: { ex: OutcomeExample }) {
  const W = 360;
  const H = 150;
  const padR = 64;
  const n = ex.bars.length;
  const dec = outcome.context_bars;
  const hi = Math.max(ex.tp_price, ...ex.bars.map((b) => b.h));
  const lo = Math.min(ex.sl_price, ...ex.bars.map((b) => b.l));
  const y = (v: number) => 10 + ((hi - v) / (hi - lo)) * (H - 28);
  const step = (W - padR - 8) / n;
  const x = (i: number) => 8 + step * i + step / 2;
  const exitIdx = ex.bars.findIndex((b) => b.d === ex.exit.d);
  const tpColor = `${MINT}cc`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Daily ${outcome.symbol} bars around ${ex.decision} with take-profit and stop-loss levels`}>
      <rect x={x(dec) + step / 2} y={4} width={x(n - 1) - x(dec)} height={H - 18} className="fill-white/[0.035]" />
      <text x={x(dec) + step / 2 + 4} y={H - 4} className="fill-white/40 font-mono text-[8px]">
        next {outcome.rule.horizon} bars
      </text>
      <text x={8} y={H - 4} className="fill-white/40 font-mono text-[8px]">
        end of chart
      </text>
      <line x1={x(dec) + step / 2} x2={x(dec) + step / 2} y1={4} y2={H - 14} className="stroke-white/30" strokeDasharray="2 3" />
      <line x1={8} x2={W - padR + 4} y1={y(ex.tp_price)} y2={y(ex.tp_price)} stroke={tpColor} strokeDasharray="4 3" />
      <line x1={8} x2={W - padR + 4} y1={y(ex.sl_price)} y2={y(ex.sl_price)} className="stroke-white/45" strokeDasharray="2 3" />
      <text x={W - padR + 8} y={y(ex.tp_price) + 3} fill={tpColor} className="font-mono text-[8.5px]">
        +{pct(outcome.rule.tp)} {ex.tp_price.toFixed(2)}
      </text>
      <text x={W - padR + 8} y={y(ex.sl_price) + 3} className="fill-white/55 font-mono text-[8.5px]">
        −{pct(outcome.rule.sl)} {ex.sl_price.toFixed(2)}
      </text>
      {ex.bars.map((b, i) => {
        const up = b.c >= b.o;
        const future = i > dec;
        return (
          <g key={b.d} className={future ? "opacity-100" : "opacity-60"}>
            <line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} className="stroke-white/50" />
            <rect
              x={x(i) - step * 0.3}
              y={y(Math.max(b.o, b.c))}
              width={step * 0.6}
              height={Math.max(1, Math.abs(y(b.o) - y(b.c)))}
              className={up ? "fill-white/85" : "fill-white/30"}
            />
          </g>
        );
      })}
      <circle cx={x(dec + 1)} cy={y(ex.entry.price)} r={2.5} className="fill-white" />
      {exitIdx >= 0 ? (
        <circle cx={x(exitIdx)} cy={y(ex.exit.price)} r={5} fill="none" strokeWidth={1.5} stroke={ex.label ? MINT : "rgba(255,255,255,0.7)"} />
      ) : null}
    </svg>
  );
}

function describeExit(ex: OutcomeExample): string {
  const when = fmtDate(ex.exit.d, { day: "numeric", month: "short" });
  if (ex.exit.reason === "tp") return `Take-profit reached on ${when}, bar ${ex.exit.bars_held} of ${outcome.rule.horizon}.`;
  if (ex.exit.reason === "sl")
    return ex.exit.bars_held === 1 ? `Stop-loss hit on the entry bar, ${when}.` : `Stop-loss hit on ${when}, bar ${ex.exit.bars_held} of ${outcome.rule.horizon}.`;
  return `Neither level reached within ${outcome.rule.horizon} bars.`;
}

function ExampleCard({ ex }: { ex: OutcomeExample }) {
  const positive = ex.label === 1;
  return (
    <figure className="rounded-2xl border border-white/[0.09] bg-white/[0.015] p-4 sm:p-5">
      <div className="grid grid-cols-[88px_1fr] items-center gap-4 sm:grid-cols-[104px_1fr]">
        <div>
          <img src={asset(ex.image)} alt={`Chart image ending ${ex.decision}`} className="aspect-square w-full rounded-md border border-white/[0.12] bg-black" loading="lazy" />
          <p className="mt-1.5 font-mono text-[9.5px] leading-tight text-white/40">
            chart to {fmtDate(ex.decision, { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
        <OutcomeChart ex={ex} />
      </div>
      <figcaption className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-3">
        <p className="text-[13.5px] leading-snug text-white/65">
          Entry at the next open, {ex.entry.price.toFixed(2)}. {describeExit(ex)}
        </p>
        <span
          className="shrink-0 rounded-full border px-3 py-1 font-mono text-[11px]"
          style={positive ? { borderColor: `${MINT}99`, color: MINT } : { borderColor: "rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.7)" }}
        >
          label {ex.label}
        </span>
      </figcaption>
    </figure>
  );
}

function Examples() {
  const { session } = useAuth();
  const trainHref = session ? "/tools/trainer" : `/signup?next=${encodeURIComponent("/tools/trainer")}`;
  return (
    <Container className="pb-20 pt-12 lg:-mt-16 lg:pb-24 lg:pt-0">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">Two real charts, labelled</p>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-white/55">
            The network only ever sees the image on the left. The bars to the right of the dashed line are what decided its label.
          </p>
        </div>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {outcome.examples.map((ex) => (
          <ExampleCard key={ex.decision} ex={ex} />
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <ProvenanceTag kind="real" detail={`${outcome.symbol} daily prices · test period · labelled with the Generator's rule`} />
        <div className="flex flex-wrap items-center gap-5 text-[14px]">
          <Link to="/help#labeling" className="text-white/50 transition-colors hover:text-white">
            How labels work
          </Link>
          <Link to={trainHref} className="group inline-flex items-center gap-2 text-white/85 transition-colors hover:text-white">
            Train a CNN on labels like these
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>
      </div>
    </Container>
  );
}

/** Real dataset tiles assemble into the dataset and reveal their labels; two real charts show how a label is decided. */
export function DatasetAssembly({ label }: { label: ReactNode }) {
  const lg = useMediaQuery("(min-width: 1024px)");
  const reduce = useReducedMotion();
  return (
    <section id="dataset" className="scroll-mt-20">
      {lg && !reduce ? <Pinned label={label} /> : <Static label={label} />}
      <Examples />
    </section>
  );
}
