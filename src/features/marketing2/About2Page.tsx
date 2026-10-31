import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MotionConfig, motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import founderPhoto from "@/assets/Founder-pic.png";
import { FOUNDER_LINKEDIN_URL } from "@/lib/founderLinks";
import { Container, EASE, Kicker, M2Footer, Reveal, TYPE } from "./ui";
import { AboutLanding } from "./visuals/AboutLanding";
import { AboutMethod } from "./visuals/AboutMethod";
import { FrontierMap } from "./visuals/FrontierMap";
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
  ["Trust held-out data, not a good backtest.", "Try enough settings on the same history and one will look brilliant by chance. Only data the model never influenced counts."],
  ["Compare against the obvious.", "Every result is set against buy-and-hold and a passive mix with the same exposure."],
];

type Chapter = { num: string; name: string; title: ReactNode; body: string; extra?: ReactNode };

const CHAPTERS: Chapter[] = [
  {
    num: "I",
    name: "The problem",
    title: (
      <>
        Chart patterns are simple by design. <span className="text-white/45">Markets may not be.</span>
      </>
    ),
    body: "Head and shoulders, triangles, moving-average crosses: classic technical analysis reduces a chart to a few shapes a person can name and draw by hand. Tested rigorously, many of them show little reliable edge. That is usually read as proof that charts carry no information. It may only show that the vocabulary was too small.",
  },
  {
    num: "II",
    name: "The hypothesis",
    title: (
      <>
        Maybe the patterns aren&apos;t meaningless. <span className="text-white/45">Maybe our methods are too simple.</span>
      </>
    ),
    body: "If structure exists, it is likely nonlinear: combinations of shape, scale and context that nobody would write down as a rule. Convolutional networks learn exactly that kind of visual feature from data, which makes them one way to test the idea. Not proof of it. A network can just as easily learn noise, so every result faces the same three checks.",
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
        <p className="mt-8 border-l border-[#a6ecc8]/50 pl-4 text-[14.5px] leading-relaxed text-white/60">
          Whether such patterns predict anything is an open question. Convolve does not promise profitable trading;{" "}
          <span className="text-white">it makes the question testable.</span>
        </p>
      </>
    ),
  },
  {
    num: "III",
    name: "The vision",
    title: (
      <>
        Scientific trading research <span className="text-white/45">shouldn&apos;t need a quant desk.</span>
      </>
    ),
    body: "Testing an idea like this properly used to take a team: data pipelines, GPUs, model code and the discipline to evaluate honestly. The aim is to make that method mainstream, so that anyone curious enough can run the experiment, read the evidence and accept it when the answer is no.",
    extra: (
      <a href="#method" className="group mt-8 inline-flex items-center gap-2 text-[14px] text-white/70 transition-colors hover:text-white">
        Follow one experiment through the maths
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </a>
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

const MILESTONES: { tag: string; title: string; body: string }[] = [
  {
    tag: "Kantonsschule Wettingen",
    title: "Applied mathematics and physics",
    body: "Matura with an academic focus on applied mathematics and physics, plus an independent project with a Japanese high school exploring quantum computing.",
  },
  {
    tag: "Matura research project",
    title: "Can a CNN read a price chart?",
    body: "Convolutional networks are built to recognise images. The project asked whether they could learn meaningful patterns from financial charts.",
  },
  {
    tag: "Research software",
    title: "Answering it meant building tools",
    body: "Generating datasets, training different networks, looking inside them, comparing results and testing strategies. Development continued after the project ended.",
  },
  {
    tag: "Convolve",
    title: "Opened up to everyone",
    body: "The software built to answer one question, rebuilt so that anyone can ask their own.",
  },
];

function Milestones() {
  const ref = useRef<HTMLOListElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.8", "end 0.55"] });
  const draw = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0, 1]);
  return (
    <ol ref={ref} className="relative">
      <span aria-hidden className="absolute bottom-3 left-[5px] top-3 w-px bg-white/[0.08]" />
      <motion.span
        aria-hidden
        className="absolute bottom-3 left-[5px] top-3 w-px origin-top bg-gradient-to-b from-white/60 via-white/40 to-[#a6ecc8]/70"
        style={{ scaleY: draw }}
      />
      {MILESTONES.map((m, i) => {
        const last = i === MILESTONES.length - 1;
        return (
          <Reveal as="li" key={m.tag} delay={i * 0.06} className="relative grid grid-cols-[11px_1fr] gap-x-7">
            <span
              aria-hidden
              className={
                last
                  ? "mt-[5px] h-[11px] w-[11px] rounded-full bg-[#a6ecc8] shadow-[0_0_16px_rgba(166,236,200,0.55)]"
                  : "mt-[6px] h-[9px] w-[9px] translate-x-[1px] rounded-full border border-white/45 bg-[#050506]"
              }
            />
            <div className={last ? "" : "mb-10 border-b border-white/[0.07] pb-10"}>
              <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.18em]">
                <span className="text-white/80">{String(i + 1).padStart(2, "0")}</span>
                <span className={last ? "text-[#a6ecc8]/80" : "text-white/40"}>{m.tag}</span>
              </div>
              <h3 className="mt-3 text-[clamp(1.35rem,1.9vw,1.75rem)] font-light leading-[1.15] tracking-[-0.03em] text-white">{m.title}</h3>
              <p className="mt-3 max-w-xl text-[15.5px] leading-[1.65] text-white/55">{m.body}</p>
            </div>
          </Reveal>
        );
      })}
    </ol>
  );
}

function Origin() {
  return (
    <section id="founder" className="scroll-mt-20 py-24 md:py-32">
      <Container>
        <Rule />
        <Reveal className="mt-12">
          <Label num="V">Origin</Label>
          <h2 className="mt-8 max-w-[18ch] text-[clamp(2.4rem,5.2vw,5rem)] font-extralight leading-[1.02] tracking-[-0.045em] text-white">
            It started as a school research project. <span className="text-white/40">It never stopped.</span>
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-14 lg:mt-20 lg:grid-cols-12 lg:gap-16">
          <Reveal className="lg:col-span-4" delay={0.06}>
            <figure className="lg:sticky lg:top-[14vh]">
              <div className="relative aspect-[4/5] max-w-[420px] overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03]">
                <img
                  src={founderPhoto}
                  alt="Alexander Nicoud"
                  loading="lazy"
                  className="h-full w-full origin-[30%_70%] scale-[1.07] object-cover object-top [filter:grayscale(1)_contrast(1.05)_brightness(0.9)]"
                />
                <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#050506]/85 to-transparent" />
                <figcaption className="absolute inset-x-5 bottom-5 flex items-end justify-between gap-3">
                  <div>
                    <div className="text-[17px] font-normal tracking-[-0.01em] text-white">Alexander Nicoud</div>
                    <div className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/55">Founder · Switzerland</div>
                  </div>
                  <a
                    href={FOUNDER_LINKEDIN_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Alexander Nicoud on LinkedIn"
                    className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/20 bg-[#050506]/60 text-white/75 backdrop-blur-sm transition-colors hover:border-white/40 hover:text-white"
                  >
                    <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
                  </a>
                </figcaption>
              </div>
              <p className="mt-6 max-w-[420px] text-[14.5px] leading-[1.6] text-white/45">
                Alongside Convolve, I co-founded <span className="text-white/75">NEXT Events</span>, a separate Swiss initiative that brings
                ambitious young people together through events, entrepreneurship and networking.
              </p>
            </figure>
          </Reveal>

          <div className="lg:col-span-7 lg:col-start-6">
            <Milestones />
          </div>
        </div>
      </Container>
    </section>
  );
}

function Community() {
  return (
    <section id="community" className="scroll-mt-20 pb-24 md:pb-32">
      <Container>
        <Rule />
        <div className="mt-12 grid gap-10 lg:grid-cols-12 lg:gap-14">
          <Reveal className="lg:col-span-7">
            <Label num="VI">Community and what comes next</Label>
            <h2 className="mt-8 text-[clamp(2.2rem,4.4vw,4.2rem)] font-extralight leading-[1.03] tracking-[-0.045em] text-white">
              One researcher surveys a corner. <span className="text-white/40">A community maps the terrain.</span>
            </h2>
          </Reveal>
          <Reveal className="lg:col-span-4 lg:col-start-9 lg:self-end" delay={0.08}>
            <p className={TYPE.body}>
              A result one person finds is an anecdote. A result others can re-run, challenge and improve on the same held-out data becomes
              evidence. The long-term goal is a collaborative research community exploring AI and financial markets in the open.
            </p>
            <Link to="/contact" className="group mt-6 inline-flex items-center gap-2 text-[14px] text-white/70 transition-colors hover:text-white">
              Want to help build it? Get in touch
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </Reveal>
        </div>
        <Reveal className="mt-14" delay={0.06}>
          <FrontierMap />
        </Reveal>
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
  return (
    <MotionConfig reducedMotion="user">
      <div className="relative overflow-x-clip bg-[#050506] text-white antialiased">
        <AboutLanding />
        <Chapters />
        <AboutMethod label={<Label num="IV">Method</Label>} />
        <Origin />
        <Community />
        <Closing />
        <M2Footer />
      </div>
    </MotionConfig>
  );
}
