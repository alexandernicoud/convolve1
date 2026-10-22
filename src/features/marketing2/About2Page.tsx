import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MotionConfig, motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { FOUNDER_LINKEDIN_URL } from "@/lib/founderLinks";
import { Container, EASE, M2Footer, Reveal } from "./ui";
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

const LEGEND: [string, string][] = [
  ["Subject", "Visual models of price"],
  ["Method", "Experiment, measure, record"],
  ["Instrument", "Convolve"],
  ["Status", "Survey in progress"],
];

function Opening() {
  const reduce = useReducedMotion();
  const lines: [string, string][] = [
    ["Markets are a landscape", "text-white"],
    ["of unknowns.", "text-white"],
    ["We map them by experiment.", "text-white/40"],
  ];
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:88px_88px] [mask-image:radial-gradient(ellipse_80%_70%_at_30%_30%,black,transparent)]"
      />
      <Container className="relative flex min-h-[calc(88svh-80px)] flex-col justify-between pb-14 pt-16 sm:pt-24">
        <motion.div
          className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.24em] text-white/45"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8 }}
        >
          <span>About Convolve</span>
          <span className="hidden sm:inline">Sheet 01 / 01</span>
        </motion.div>
        <h1 className="mt-14 text-[clamp(2.6rem,7.6vw,8rem)] font-extralight leading-[0.96] tracking-[-0.05em]">
          {lines.map(([text, cls], i) => (
            <span key={text} className="block overflow-hidden pb-[0.06em]">
              <motion.span
                className={`block ${cls}`}
                initial={reduce ? false : { y: "105%" }}
                animate={{ y: 0 }}
                transition={{ duration: 1.1, ease: EASE, delay: 0.15 + i * 0.12 }}
              >
                {text}
              </motion.span>
            </span>
          ))}
        </h1>
        <motion.div
          className="mt-16 grid gap-10 border-t border-white/[0.1] pt-8 md:grid-cols-12"
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.6 }}
        >
          <p className="text-[clamp(1.05rem,1.5vw,1.3rem)] font-light leading-[1.5] text-white/70 md:col-span-5">
            Convolve is a research workspace for traders who would rather test an idea than trust one. This page is about
            why it exists and what it is trying to become.
          </p>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 md:col-span-6 md:col-start-7">
            {LEGEND.map(([k, v]) => (
              <div key={k} className="border-l border-white/[0.12] pl-3">
                <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">{k}</dt>
                <dd className="mt-1 text-[14px] text-white/80">{v}</dd>
              </div>
            ))}
          </dl>
        </motion.div>
      </Container>
    </section>
  );
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
        <Link to="/home2#pipeline" className="group mt-8 inline-flex items-center gap-2 text-[14px] text-white/70 transition-colors hover:text-white">
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
    <section className="py-16 md:py-24">
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
  const meta: [string, string][] = [
    ["Name", "Alexander Nicoud"],
    ["Age", "19"],
    ["Based in", "Switzerland"],
    ["Field", "Applied Mathematics"],
  ];
  return (
    <section id="founder" className="scroll-mt-20 py-24 md:py-32">
      <Container>
        <Rule />
        <div className="mt-12 grid gap-12 md:grid-cols-12">
          <Reveal className="md:col-span-3">
            <Label num="V">Origin</Label>
          </Reveal>
          <Reveal className="md:col-span-5" delay={0.06}>
            <h2 className="text-[clamp(1.8rem,3vw,2.6rem)] font-extralight leading-[1.1] tracking-[-0.035em] text-white">
              Built by a technical founder.
            </h2>
            <p className="mt-6 text-[16px] leading-relaxed text-white/60">
              Convolve is built by <span className="text-white">Alexander Nicoud</span>, a 19-year-old applied mathematics
              student in Switzerland. The focus is on building and testing complete systems, from visual learning to
              backtesting and deployment, rather than on ideas alone.
            </p>
          </Reveal>
          <Reveal className="md:col-span-3 md:col-start-10" delay={0.12}>
            <dl className="border-t border-white/[0.1]">
              {meta.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between border-b border-white/[0.07] py-3">
                  <dt className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">{k}</dt>
                  <dd className="text-[14px] text-white/85">{v}</dd>
                </div>
              ))}
            </dl>
            <a
              href={FOUNDER_LINKEDIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-5 inline-flex items-center gap-1.5 text-[14px] text-white/80 transition-colors hover:text-white"
            >
              LinkedIn
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
            </a>
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
            <Link to="/home2#pipeline" className="group inline-flex items-center gap-2 text-[15px] text-white transition-colors hover:text-white/80">
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
        <Opening />
        <Chapters />
        <Origin />
        <Closing />
        <M2Footer />
      </div>
    </MotionConfig>
  );
}
