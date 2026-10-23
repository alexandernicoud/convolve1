import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MotionConfig, motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { FOUNDER_LINKEDIN_URL } from "@/lib/founderLinks";
import { Container, EASE, M2Footer, Reveal } from "./ui";
import { AboutLanding } from "./visuals/AboutLanding";
import { TopoMap } from "./visuals/TopoMap";

function Label({ num, children }: { num: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.24em] text-white/45">
      <span className="text-white/85">{num}</span>
      <span className="h-px w-8 bg-white/25" />
      {children}
    </div>
  );
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
  ["Say what you don’t know.", "Findings are marked supported, inconclusive or hypothesis, with their limits written next to them."],
];

type Chapter = { num: string; name: string; title: ReactNode; body: string; extra?: ReactNode };

const CHAPTERS: Chapter[] = [
  {
    num: "I",
    name: "The problem",
    title: (
      <>
        Most trading tools <span className="text-white/45">hand you an answer.</span>
      </>
    ),
    body: "An indicator someone else parameterised. A signal you cannot inspect. A backtest that shows the best curve and none of the attempts behind it. What is left is confidence without evidence, and no way to tell the two apart.",
  },
  {
    num: "II",
    name: "The belief",
    title: (
      <>
        The unknown is not the enemy. <span className="text-white/45">Unexamined assumptions are.</span>
      </>
    ),
    body: "A model is a hypothesis. A backtest is a measurement. Neither is a promise. Progress comes from stating what you are testing, testing it fairly, and writing down what you found, including when the answer is nothing.",
  },
  {
    num: "III",
    name: "The approach",
    title: (
      <>
        Survey the ground <span className="text-white/45">before building on it.</span>
      </>
    ),
    body: "Convolve turns each question into an instrument: labelled chart datasets, convolutional networks, attribution and masking tests, backtests against buy-and-hold. Three rules run through all of them.",
    extra: (
      <>
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
        <Link to="/#workflow" className="group mt-8 inline-flex items-center gap-2 text-[14px] text-white/70 transition-colors hover:text-white">
          See the workflow
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      </>
    ),
  },
  {
    num: "IV",
    name: "The ambition",
    title: (
      <>
        A research desk&apos;s instruments, <span className="text-white/45">for one person.</span>
      </>
    ),
    body: "Institutions have teams to build datasets, train models and challenge results. Convolve's ambition is to put that discipline in the hands of an individual, without code, and without pretending the map is finished.",
    extra: (
      <p className="mt-10 border-t border-white/[0.1] pt-6 text-[clamp(1.4rem,2.2vw,1.9rem)] font-extralight leading-[1.2] tracking-[-0.02em] text-white">
        Not blind automation. <span className="text-white/45">Structured decision support.</span>
      </p>
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
                  <h2 className="mt-7 text-[clamp(2rem,3.6vw,3.3rem)] font-extralight leading-[1.06] tracking-[-0.04em] text-white">{c.title}</h2>
                  <p className="mt-6 text-[16.5px] leading-[1.65] text-white/60">{c.body}</p>
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
    ["Doubt", "A good validation score is easy to fool yourself with. So thresholds got locked, test periods kept unseen, and every result set against buy-and-hold."],
    ["Instruments", "Each answer raised the next question: what the network attends to, which label rule to use, how a model behaves once it runs."],
    ["A workspace", "Generation, training, interpretability, label search, backtesting and paper deployment, connected so that every result can be traced."],
  ];
  return (
    <section id="founder" className="scroll-mt-20 py-24 md:py-32">
      <Container>
        <Rule />
        <div className="mt-12 grid gap-12 md:grid-cols-12">
          <Reveal className="md:col-span-3">
            <Label num="V">Origin</Label>
          </Reveal>
          <Reveal className="md:col-span-4" delay={0.06}>
            <h2 className="text-[clamp(2rem,3.6vw,3.3rem)] font-extralight leading-[1.06] tracking-[-0.04em] text-white">It began with a question.</h2>
            <p className="mt-6 text-[16px] leading-relaxed text-white/60">
              Convolve started as a handful of experiments with candlestick images and convolutional networks, to see whether a visual model could
              find patterns with any predictive value.
            </p>
            <p className="mt-4 text-[16px] leading-relaxed text-white/60">
              The honest answer was always “it depends, and here is how to check”. Checking properly needed more tools than the experiment
              itself, so the tools were built, one question at a time.
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
            The map is never finished.
            <br />
            <span className="text-white/40">That is the point.</span>
          </p>
        </Reveal>
        <Reveal delay={0.1} className="mt-16 flex flex-col gap-4 border-t border-white/[0.1] pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-[15px] leading-relaxed text-white/50">
            See the workspace this approach produced, from the first dataset to a monitored paper bot.
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
        <Origin />
        <Closing />
        <M2Footer />
      </div>
    </MotionConfig>
  );
}
