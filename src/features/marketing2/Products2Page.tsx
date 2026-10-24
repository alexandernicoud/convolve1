import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MotionConfig, motion, useInView, useReducedMotion } from "framer-motion";
import { ArrowRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { asset, grid, labmaps, screen } from "./data";
import { Container, EASE, Kicker, M2Footer, PrimaryCta, Reveal, SecondaryCta, SectionHead, useStartHref } from "./ui";
import { DashboardSurface, STAGES, type Region } from "./visuals/ProductStack";
import { EquityThumb, FleetThumb, LossThumb } from "./visuals/Workflow";

const SAMPLE = labmaps.samples[labmaps.trace_index];

const MODULES: Record<string, { does: string; produces: string; feeds: string; thumb: ReactNode }> = {
  generate: {
    does: "Turns price history into labelled chart images, on your symbols, intervals and window lengths.",
    produces: "Labelled dataset",
    feeds: "Train",
    thumb: (
      <div className="grid h-full grid-cols-6 gap-[3px] p-2">
        {grid.tiles.slice(1, 13).map((t) => (
          <img key={t.file} src={asset(t.file)} alt="" className="aspect-square w-full rounded-[2px]" />
        ))}
      </div>
    ),
  },
  train: {
    does: "Trains a convolutional network on a dataset and restores the best epoch by validation loss.",
    produces: "Saved model",
    feeds: "Analyze, Test",
    thumb: (
      <div className="h-full p-3">
        <LossThumb />
      </div>
    ),
  },
  analyze: {
    does: "Opens a model on its own charts: Grad-CAM, saliency, occlusion and the internal representation.",
    produces: "Attention maps and tests",
    feeds: "Test",
    thumb: (
      <div className="relative mx-auto aspect-square h-full">
        <img src={asset(SAMPLE.input)} alt="" className="absolute inset-0 h-full w-full opacity-30" />
        <img src={asset(SAMPLE.gradcam)} alt="" className="absolute inset-0 h-full w-full" />
      </div>
    ),
  },
  test: {
    does: "Backtests the model on unseen data with a locked threshold, trading costs and buy-and-hold benchmarks.",
    produces: "Backtest report",
    feeds: "Deploy, or back to Optimize",
    thumb: (
      <div className="h-full p-3">
        <EquityThumb />
      </div>
    ),
  },
  optimize: {
    does: "Scores every take-profit, stop-loss and horizon rule before you commit to a dataset.",
    produces: "Label rule",
    feeds: "Generate",
    thumb: <img src={screen("opt_heatmap")} alt="" className="h-full w-full object-cover [filter:saturate(0.4)_brightness(0.9)] [transform-origin:14%_62%] [transform:scale(1.9)]" />,
  },
  deploy: {
    does: "Runs a tested model as a scheduled paper-trading bot on any symbol.",
    produces: "Running bot",
    feeds: "Dashboard",
    thumb: (
      <div className="h-full p-3">
        <FleetThumb />
      </div>
    ),
  },
  dashboard: {
    does: "Brings runs, outputs, bots and lineage onto one surface, and is where you move between modules.",
    produces: "One operational view",
    feeds: "Every tool",
    thumb: <DashboardSurface stage={STAGES.length - 1} />,
  },
};

const PIPE = ["optimize", "generate", "train", "analyze", "test", "deploy"] as const;
const OPTIONAL = new Set<string>(["optimize", "analyze"]);
const stage = (id: string) => STAGES.find((s) => s.id === id)!;

const ROLES: { region: Region; name: string; line: string }[] = [
  { region: "runs", name: "Research runs", line: "Label searches, generator runs, training and analysis sessions." },
  { region: "history", name: "Outputs", line: "Datasets, attention maps and backtest reports, kept and reopenable." },
  { region: "bots", name: "Bots", line: "What runs, on which symbol and schedule, and how it performs." },
  { region: "monitor", name: "Monitoring", line: "Status and headline figures at a glance." },
  { region: "lineage", name: "Lineage", line: "Every bot traced to its backtest, model, dataset and label rule." },
  { region: "nav", name: "Navigation", line: "Every module one click away." },
];

function Window({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-white/[0.12] bg-[#060709] shadow-[0_40px_120px_-50px_rgba(0,0,0,0.9)]">
      <div className="flex h-9 items-center gap-3 border-b border-white/[0.07] px-4 font-mono text-[10.5px] text-white/40">
        <span>convolve. / dashboard</span>
        <span className="ml-auto">overview</span>
      </div>
      {children}
    </div>
  );
}

function Hero() {
  const reduce = useReducedMotion();
  const start = useStartHref();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "0px 0px -20% 0px" });
  const [auto, setAuto] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    if (reduce || !inView || picked != null) return;
    const id = window.setInterval(() => setAuto((a) => (a + 1) % ROLES.length), 2800);
    return () => window.clearInterval(id);
  }, [reduce, inView, picked]);
  const active = picked ?? auto;
  const enter = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.8, ease: EASE, delay } };
  return (
    <section className="relative">
      <Container className="pb-20 pt-14 sm:pt-20 lg:pb-28">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <motion.div {...enter(0)}>
              <Kicker>Products</Kicker>
            </motion.div>
            <motion.h1 className="mt-6 text-[clamp(2.6rem,4.6vw,5.1rem)] font-light leading-[1.0] tracking-[-0.045em] text-white" {...enter(0.06)}>
              Six research tools.
              <br />
              <span className="text-white/45">One hub between them.</span>
            </motion.h1>
          </div>
          <motion.div className="lg:col-span-5 lg:pb-2" {...enter(0.14)}>
            <p className="max-w-md text-[17px] leading-relaxed text-white/60">
              Each tool records what it produces, so a running bot can be traced back to its backtest, model, dataset and label rule. This is the
              surface where that record lives.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <PrimaryCta to={start}>Open the workspace</PrimaryCta>
              <SecondaryCta href="#pipeline">How the tools connect</SecondaryCta>
            </div>
          </motion.div>
        </div>

        <motion.div ref={ref} className="mt-14 grid gap-8 lg:mt-16 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10" {...enter(0.24)}>
          <ul className="order-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:order-1 lg:block lg:space-y-0.5 lg:self-center">
            {ROLES.map((r, i) => (
              <li key={r.region}>
                <button
                  type="button"
                  onClick={() => setPicked(i)}
                  onMouseEnter={() => setPicked(i)}
                  onFocus={() => setPicked(i)}
                  aria-pressed={active === i}
                  className={cn(
                    "w-full border-l py-2.5 pl-4 text-left transition-colors duration-500 focus:outline-none focus-visible:bg-white/[0.04]",
                    active === i ? "border-[#a6ecc8]" : "border-white/[0.1] hover:border-white/30"
                  )}
                >
                  <span className={cn("block text-[15px] transition-colors duration-500", active === i ? "text-white" : "text-white/55")}>{r.name}</span>
                  <span className={cn("mt-0.5 hidden text-[12.5px] leading-snug transition-colors duration-500 lg:block", active === i ? "text-white/55" : "text-white/30")}>{r.line}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="order-1 lg:order-2">
            <Window>
              <DashboardSurface region={ROLES[active].region} />
            </Window>
            <p className="mt-4 font-mono text-[10.5px] leading-relaxed text-white/35">
              Illustrative dashboard. Research runs come from the real MSFT run; bots and fleet P&L are simulated.
            </p>
          </div>
        </motion.div>
      </Container>
    </section>
  );
}

function Node({ id, n }: { id: string; n: number }) {
  const s = stage(id);
  const opt = OPTIONAL.has(id);
  return (
    <div className={cn("h-full rounded-[12px] border bg-[#08090b] px-4 py-4", opt ? "border-dashed border-white/20" : "border-white/[0.14]")}>
      <div className="flex items-baseline justify-between gap-2 font-mono text-[10.5px] text-white/35">
        <span>{String(n).padStart(2, "0")}</span>
        {opt ? <span className="uppercase tracking-[0.14em]">optional</span> : null}
      </div>
      <div className="mt-3 text-[19px] font-medium tracking-[-0.02em] text-white">{s.name}</div>
      <div className="mt-1 text-[13px] leading-snug text-white/50">{s.line}</div>
      <div className="mt-4 border-t border-white/[0.07] pt-3 font-mono text-[11px] text-[#a6ecc8]/80">→ {MODULES[id].produces}</div>
    </div>
  );
}

function Pipeline() {
  const hub = stage("dashboard");
  return (
    <section id="pipeline" className="scroll-mt-20 border-t border-white/[0.06] py-20 lg:py-28">
      <Container>
        <SectionHead
          index="01"
          label="How the tools connect"
          title="A chain, not a menu."
          intro="Four tools are required to get from prices to a running bot. Two are optional. All of them can be revisited, and the dashboard records each step."
        />

        <Reveal className="relative mt-16 hidden lg:block">
          <div aria-hidden className="absolute left-[8.33%] right-[25%] top-0 h-12 rounded-t-[16px] border-x border-t border-dashed border-white/25" />
          <ChevronDown aria-hidden className="absolute left-[8.33%] top-[38px] h-4 w-4 -translate-x-1/2 text-white/45" />
          <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 bg-[#050506] px-3 font-mono text-[11px] text-white/50">
            iterate: change the rule, regenerate, retrain
          </div>
          <ol className="grid grid-cols-6 gap-6 pt-14">
            {PIPE.map((id, i) => (
              <li key={id} className="relative">
                <Node id={id} n={i + 1} />
                {i < PIPE.length - 1 ? (
                  <ArrowRight aria-hidden className="absolute -right-[19px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
                ) : null}
              </li>
            ))}
          </ol>
          <div className="grid grid-cols-6 gap-6" aria-hidden>
            {PIPE.map((id) => (
              <div key={id} className="flex justify-center">
                <span className="h-10 w-px bg-gradient-to-b from-white/25 to-[#a6ecc8]/50" />
              </div>
            ))}
          </div>
          <HubBar name={hub.name} />
        </Reveal>

        <div className="mt-12 lg:hidden">
          <ol className="space-y-3">
            {PIPE.map((id, i) => (
              <Reveal as="li" key={id} delay={0.03 * i}>
                <Node id={id} n={i + 1} />
              </Reveal>
            ))}
          </ol>
          <p className="mt-4 font-mono text-[11px] leading-relaxed text-white/45">Iterate: after a backtest, change the rule, regenerate and retrain.</p>
          <div className="mt-6">
            <HubBar name={hub.name} />
          </div>
        </div>
      </Container>
    </section>
  );
}

function HubBar({ name }: { name: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-[#a6ecc8]/30 bg-[#a6ecc8]/[0.03] px-5 py-4 sm:flex-row sm:items-baseline sm:gap-6">
      <span className="text-[19px] font-medium tracking-[-0.02em] text-white">{name}</span>
      <span className="text-[14px] leading-relaxed text-white/55">
        Every tool writes its artifact here, and every tool is opened from here. Runs, outputs, bots and the lineage between them, on one surface.
      </span>
    </div>
  );
}

function Modules() {
  return (
    <section id="modules" className="scroll-mt-20 border-t border-white/[0.06] py-20 lg:py-28">
      <Container>
        <SectionHead index="02" label="The tools" title="What each one does, and what it hands on." />
        <ol className="mt-12 border-t border-white/[0.08]">
          {[...PIPE, "dashboard"].map((id, i) => {
            const s = stage(id);
            const m = MODULES[id];
            return (
              <Reveal as="li" key={id} delay={0.03 * i}>
                <div className="grid gap-6 border-b border-white/[0.08] py-9 md:grid-cols-[minmax(0,1fr)_minmax(0,260px)] md:items-center lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.8fr)_300px] lg:gap-10">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono text-[11px] text-white/35">{String(i + 1).padStart(2, "0")}</span>
                      <h3 className="text-[24px] font-medium tracking-[-0.025em] text-white">{s.name}</h3>
                      {OPTIONAL.has(id) ? <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/35">optional</span> : null}
                    </div>
                    <p className="mt-2 max-w-md text-[15px] leading-relaxed text-white/55">{m.does}</p>
                  </div>
                  <div className="min-w-0 text-[14px] md:col-start-1 lg:col-start-auto">
                    <div className="flex gap-8">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">Produces</div>
                        <div className="mt-1.5 text-white/85">{m.produces}</div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">Feeds</div>
                        <div className="mt-1.5 text-white/60">{m.feeds}</div>
                      </div>
                    </div>
                    <Link to={s.href} className="group mt-5 inline-flex items-center gap-1.5 text-[13.5px] text-white/60 transition-colors hover:text-white">
                      Open {s.name}
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  </div>
                  <div className="overflow-hidden rounded-[10px] border border-white/[0.09] bg-[#07080a] md:col-start-2 md:row-span-2 md:row-start-1 lg:col-start-auto lg:row-span-1 lg:row-start-auto">
                    <div className="aspect-[16/10] w-full overflow-hidden">{m.thumb}</div>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </ol>
      </Container>
    </section>
  );
}

function Closing() {
  const start = useStartHref();
  return (
    <section className="border-t border-white/[0.06] py-20 lg:py-28">
      <Container>
        <Reveal className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="text-[clamp(2.4rem,6vw,5rem)] font-extralight leading-[0.98] tracking-[-0.05em] text-white">
            Make trading
            <br />
            <span className="bg-gradient-to-r from-[#b9d3ff] via-[#9fd8e0] to-[#a6ecc8] bg-clip-text text-transparent">scientific</span> again.
          </h2>
          <div className="flex flex-wrap gap-3">
            <PrimaryCta to={start}>Open the workspace</PrimaryCta>
            <SecondaryCta to="/#workflow">See the workflow</SecondaryCta>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

export default function Products2Page() {
  useEffect(() => {
    document.title = "Products | convolve.";
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <div className="relative overflow-x-clip bg-[#050506] text-white antialiased">
        <Hero />
        <Pipeline />
        <Modules />
        <Closing />
        <M2Footer />
      </div>
    </MotionConfig>
  );
}
