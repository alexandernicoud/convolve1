import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MotionConfig, motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { FOUNDER_LINKEDIN_URL } from "@/lib/founderLinks";
import { Container, EASE, Kicker, M2Footer, Reveal, TYPE } from "./ui";
import { AboutLanding } from "./visuals/AboutLanding";
import { AboutMethod } from "./visuals/AboutMethod";
import { TopoMap } from "./visuals/TopoMap";

function Label({ num, children }: { num: string; children: ReactNode }) {
  return <Kicker index={num}>{children}</Kicker>;
}

function Rule() {
  return (
    <motion.div
      aria-hidden
      className="h-px w-full origin-left bg-white/[0.12]"
      initial={{ scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 1.2, ease: EASE }}
    />
  );
}

function useIsLg() {
  const [lg, setLg] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setLg(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return lg;
}

const PRINCIPLES: [string, string][] = [
  ["Decide before you look.", "Thresholds and settings are chosen on validation data, then locked before the test set is scored."],
  ["Compare against the obvious.", "Every backtest is set against buy-and-hold and a passive mix with the same exposure."],
  ["Keep every result traceable.", "Each model links to its dataset, label rule, training run and backtest, so any finding can be reproduced and challenged."],
];

type Chapter = { num: string; name: string; title: ReactNode; body: string; extra?: ReactNode };

const CHAPTERS: Chapter[] = [
  {
    num: "I",
    name: "The ambition",
    title: (
      <>
        A research desk&apos;s instruments, <span className="text-white/45">for one person.</span>
      </>
    ),
    body: "Institutions have teams to source data, build datasets, train models and challenge results. Convolve puts that laboratory into one workspace for the independent trader: labelled datasets, neural networks, interpretability, backtesting and deployment, without writing code.",
    extra: (
      <p className="mt-10 border-t border-white/[0.1] pt-6 text-[clamp(1.4rem,2.2vw,1.9rem)] font-extralight leading-[1.2] tracking-[-0.02em] text-white">
        Not blind automation. <span className="text-white/45">Structured decision support.</span>
      </p>
    ),
  },
  {
    num: "II",
    name: "The problem",
    title: (
      <>
        Most trading tools <span className="text-white/45">hand you an answer.</span>
      </>
    ),
    body: "An indicator someone else parameterised. A signal you cannot inspect. A backtest that shows the best curve and none of the attempts behind it. What is left is confidence without evidence, and no way to tell the two apart.",
  },
  {
    num: "III",
    name: "The conviction",
    title: (
      <>
        Trading should be engineered, <span className="text-white/45">researched and tested.</span>
      </>
    ),
    body: "A trading idea is a hypothesis about data, and it can be built like one: a labelled dataset, a trained network, a result measured on data the model never saw. Rigour is part of the method. Three rules run through every experiment.",
    extra: (
      <ol className="mt-8 space-y-5">
        {PRINCIPLES.map(([k, v], i) => (
          <li key={k} className="grid grid-cols-[2rem_1fr] border-t border-white/[0.1] pt-4">
            <span className="font-mono text-[11px] text-white/35">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <div className="text-[16px] text-white">{k}</div>
              <p className="mt-1 text-[14px] leading-relaxed text-white/50">{v}</p>
            </div>
          </li>
        ))}
      </ol>
    ),
  },
  {
    num: "IV",
    name: "The technology",
    title: (
      <>
        Data, networks and markets <span className="text-white/45">in one laboratory.</span>
      </>
    ),
    body: "Market data and outcome labeling, convolutional networks trained by numerical optimisation, interpretability methods that show what a model attends to, backtests with costs and benchmarks, and scheduled deployment that runs a model on new data. Each tool hands its result to the next.",
    extra: (
      <Link to="/#workflow" className="group mt-8 inline-flex items-center gap-2 text-[14px] text-white/70 transition-colors hover:text-white">
        See the workflow
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    ),
  },
];

function Chapters() {
  const reduce = useReducedMotion();
  const lg = useIsLg();
  const textRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress: chapterP } = useScroll({ target: textRef, offset: ["start 0.55", "end 0.85"] });
  const { scrollYProgress: mapP } = useScroll({ target: mapRef, offset: ["start 0.9", "end 0.25"] });
  const [p, setP] = useState(0);
  useMotionValueEvent(chapterP, "change", (v) => lg && setP(v));
  useMotionValueEvent(mapP, "change", (v) => !lg && setP(v));
  const progress = reduce ? 1 : p;

  return (
    <section id="chapters" className="scroll-mt-20 py-16 md:py-24">
      <Container>
        <Rule />
        <div className="mt-12 grid gap-12 lg:grid-cols-12 lg:gap-14">
          <div ref={mapRef} className="lg:order-2 lg:col-span-7">
            <div className="h-[110vw] max-h-[520px] min-h-[360px] lg:sticky lg:top-[12vh] lg:h-[76vh] lg:max-h-none">
              <TopoMap progress={progress} className="h-full" />
            </div>
          </div>
          <div ref={textRef} className="lg:order-1 lg:col-span-5">
            {CHAPTERS.map((c) => (
              <article key={c.num} className="flex flex-col justify-center py-14 lg:min-h-[88vh] lg:py-0">
                <Reveal>
                  <Label num={c.num}>{c.name}</Label>
                  <h2 className={`mt-7 ${TYPE.h2Editorial}`}>{c.title}</h2>
                  <p className={`mt-6 ${TYPE.body}`}>{c.body}</p>
                  {c.extra}
                </Reveal>
              </article>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}

function Origin() {
  const steps: [string, string][] = [
    ["A question", "Can a convolutional network, the kind built to read photographs, learn anything from a picture of a price chart?"],
    ["An experiment", "Render candlestick windows as images, label each by what happened next, train a small CNN and look at the result."],
    ["Instruments", "Each answer raised the next question: what the network attends to, which label rule to use, how a model behaves once it runs."],
    ["A workspace", "Generation, training, interpretability, label search, backtesting and monitored deployment, connected so that every result can be traced."],
  ];
  return (
    <section id="founder" className="scroll-mt-20 py-24 md:py-32">
      <Container>
        <Rule />
        <div className="mt-12 grid gap-12 md:grid-cols-12">
          <Reveal className="md:col-span-3">
            <Label num="VI">Origin and vision</Label>
          </Reveal>
          <Reveal className="md:col-span-4" delay={0.06}>
            <h2 className={TYPE.h2Editorial}>It began with a question.</h2>
            <p className={`mt-6 ${TYPE.body}`}>
              Convolve started as a handful of experiments with candlestick images and convolutional networks, to see whether a visual model could
              find patterns with any predictive value.
            </p>
            <p className={`mt-4 ${TYPE.body}`}>
              Answering that properly took more than one model. It took dataset generation, label search, interpretability and fair backtests,
              so those were built, and grew into one research infrastructure.
            </p>
            <p className={`mt-4 ${TYPE.body}`}>
              The direction from here is a larger laboratory: bigger datasets, model families beyond CNNs and more AI-assisted research. Those
              are plans, not features yet.
            </p>
            <p className="mt-8 text-[13.5px] text-white/40">
              Built in Switzerland by{" "}
              <a href={FOUNDER_LINKEDIN_URL} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-1 text-white/75 transition-colors hover:text-white">
                Alexander Nicoud
                <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
              </a>
            </p>
          </Reveal>
          <Reveal className="md:col-span-5 md:col-start-8" delay={0.12}>
            <ol className="relative border-l border-white/[0.1] pl-7">
              {steps.map(([k, v], i) => (
                <li key={k} className="relative pb-7 last:pb-0">
                  <span
                    aria-hidden
                    className={
                      i === steps.length - 1
                        ? "absolute -left-[33px] top-1.5 h-[11px] w-[11px] rounded-full bg-[#a6ecc8] shadow-[0_0_14px_rgba(166,236,200,0.5)]"
                        : "absolute -left-[32px] top-[7px] h-[9px] w-[9px] rounded-full border border-white/40 bg-[#050506]"
                    }
                  />
                  <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">
                    {String(i + 1).padStart(2, "0")} · {k}
                  </div>
                  <p className="mt-2 text-[15px] leading-relaxed text-white/70">{v}</p>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

function Closing() {
  return (
    <section className="pb-28 pt-12 md:pb-40">
      <Container>
        <Rule />
        <Reveal className="mt-16">
          <p className="text-[clamp(2.6rem,7vw,7rem)] font-extralight leading-[0.98] tracking-[-0.05em] text-white">
            Trading, engineered.
            <br />
            <span className="text-white/40">Researched like science.</span>
          </p>
        </Reveal>
        <Reveal delay={0.1} className="mt-16 flex flex-col gap-4 border-t border-white/[0.1] pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-[15px] leading-relaxed text-white/50">
            See the workspace this approach produced, from the first dataset to a monitored deployment.
          </p>
          <div className="flex flex-wrap gap-6">
            <Link to="/#workflow" className="group inline-flex items-center gap-2 text-[15px] text-white transition-colors hover:text-white/80">
              Explore the product
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
            <Link to="/contact" className="group inline-flex items-center gap-2 text-[15px] text-white/60 transition-colors hover:text-white">
              Get in touch
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

export default function About2Page() {
  useEffect(() => {
    document.title = "About | convolve.";
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <div className="relative overflow-x-clip bg-[#050506] text-white antialiased">
        <AboutLanding />
        <Chapters />
        <AboutMethod label={<Label num="V">Method</Label>} />
        <Origin />
        <Closing />
        <M2Footer />
      </div>
    </MotionConfig>
  );
}
