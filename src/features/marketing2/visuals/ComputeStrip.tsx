import { training } from "../data";
import { SYSTEM, int, optimizerCells, runFigures, sci, trainingSetups } from "../figures";
import { Container, Kicker, Reveal, TYPE } from "../ui";

const run = runFigures(training, [224, 224, 3], 16);
const resnet = SYSTEM.architectures.find((a) => a.id === "convolve-resnet18-v1")!;
const largest = Math.max(...SYSTEM.architectures.map((a) => a.params));
const px = SYSTEM.maxChartSize;
const setups = trainingSetups();
const replays = optimizerCells() * SYSTEM.optimizerRun.bars;

type Figure = { value: number; shown: string; formula: string; caption: string; kind: string };

const HERO: Figure = {
  value: run.trainingFlopsEstimate,
  shown: sci(run.trainingFlopsEstimate),
  formula: `3 × ${(run.forwardFlops / 1e9).toFixed(2)} GFLOP × ${int(training.train_samples)} charts × ${training.epochs_trained} epochs`,
  caption: "operations to train one CNN",
  kind: "estimate from a recorded run",
};

const FIGURES: Figure[] = [
  {
    value: setups.total,
    shown: int(setups.total),
    formula: setups.factors.map(([, n]) => n).join(" × "),
    caption: "training setups per dataset",
    kind: "configuration",
  },
  {
    value: px * px * 3,
    shown: int(px * px * 3),
    formula: `${px} × ${px} × 3`,
    caption: "input values per chart",
    kind: "maximum",
  },
  {
    value: largest,
    shown: int(largest),
    formula: `ResNet-18 · ${resnet.gflops.toFixed(1)} GFLOP per chart`,
    caption: "weights in the largest network",
    kind: "measured",
  },
  {
    value: replays,
    shown: sci(replays),
    formula: `${int(optimizerCells())} rules × ${SYSTEM.optimizerRun.bars} bars`,
    caption: "label outcomes in one Optimizer run",
    kind: `executed · ${SYSTEM.optimizerRun.symbol}`,
  },
];

const AXIS_MIN = 3;
const AXIS_MAX = 14;
const at = (v: number) => ((Math.log10(v) - AXIS_MIN) / (AXIS_MAX - AXIS_MIN)) * 100;
const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const pow = (e: number) => `10${String(e).split("").map((d) => SUP[Number(d)]).join("")}`;

function Axis() {
  const ticks = Array.from({ length: AXIS_MAX - AXIS_MIN + 1 }, (_, i) => AXIS_MIN + i);
  return (
    <Reveal delay={0.1} className="mt-20 hidden lg:block">
      <div className="relative h-[17rem]" aria-hidden>
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/15" />
        {ticks.map((e) => (
          <div key={e} className="absolute top-1/2 -translate-x-1/2" style={{ left: `${at(10 ** e)}%` }}>
            <span className="block h-2 w-px -translate-y-1 bg-white/25" />
            <span className="absolute left-1/2 top-3 -translate-x-1/2 font-mono text-[10px] text-white/30">{pow(e)}</span>
          </div>
        ))}
        {FIGURES.map((f, i) => {
          const up = i % 2 === 1;
          return (
            <div key={f.caption} className="absolute top-1/2" style={{ left: `${at(f.value)}%` }}>
              <span className="absolute left-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-[#050506]" />
              <span className={`absolute left-0 w-px bg-white/20 ${up ? "bottom-1.5 h-10" : "top-1.5 h-10"}`} />
              <div className={`absolute left-0 w-[10.5rem] -translate-x-1 ${up ? "bottom-12" : "top-12"}`}>
                <p className="text-[clamp(1.4rem,1.9vw,2rem)] font-extralight leading-none tracking-[-0.03em] text-white tabular-nums">{f.shown}</p>
                <p className="mt-1.5 text-[12.5px] leading-snug text-white/60">
                  {f.caption} <span className="text-white/30">· {f.kind}</span>
                </p>
                <p className="mt-1 font-mono text-[10.5px] text-white/35">{f.formula}</p>
              </div>
            </div>
          );
        })}
        <div className="absolute top-1/2" style={{ left: `${at(HERO.value)}%` }}>
          <span className="absolute left-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
          <span className="absolute bottom-1.5 left-0 h-10 w-px bg-white/20" />
          <p className="absolute bottom-12 right-0 whitespace-nowrap font-mono text-[10.5px] text-white/45">training one CNN</p>
        </div>
      </div>
    </Reveal>
  );
}

function Column({ className = "" }: { className?: string }) {
  return (
    <dl className={className}>
      {FIGURES.map((f, i) => (
        <Reveal key={f.caption} delay={0.04 * i} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4 border-t border-white/[0.08] py-5">
          <span className="pt-1 font-mono text-[11px] text-white/30">{pow(Math.floor(Math.log10(f.value)))}</span>
          <div>
            <dd className="text-[clamp(1.7rem,2.4vw,2.4rem)] font-extralight leading-none tracking-[-0.035em] text-white tabular-nums">{f.shown}</dd>
            <dt className="mt-2 text-[14px] text-white/65">
              {f.caption} <span className="text-white/30">· {f.kind}</span>
            </dt>
            <p className="mt-1 font-mono text-[11px] text-white/35">{f.formula}</p>
          </div>
        </Reveal>
      ))}
    </dl>
  );
}

/** Platform scale on a log axis; every figure is a recorded run, a measurement or configuration arithmetic (see figures.ts). */
export function ComputeStrip() {
  return (
    <section id="scale" className="scroll-mt-20 border-t border-white/[0.06] py-24 lg:py-36">
      <Container>
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
          <Reveal className="lg:col-span-4">
            <Kicker>Scale</Kicker>
            <h2 className={`mt-6 ${TYPE.h2}`}>
              Orders of <span className="text-white/45">magnitude.</span>
            </h2>
          </Reveal>
          <Reveal className="lg:col-span-8 lg:col-start-5">
            <p className="text-[clamp(3.6rem,8.5vw,8.5rem)] font-extralight leading-[0.9] tracking-[-0.05em] text-white tabular-nums">{HERO.shown}</p>
            <p className="mt-6 font-mono text-[12px] tracking-[0.02em] text-white/45">{HERO.formula}</p>
            <p className="mt-2 text-[15px] text-white/75">
              {HERO.caption} <span className="text-white/35">· {HERO.kind}</span>
            </p>
          </Reveal>
        </div>
        <Axis />
        <Column className="mt-14 lg:sr-only" />
      </Container>
    </section>
  );
}
