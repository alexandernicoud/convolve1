import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { MotionConfig, motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { screen } from "./data";
import { cn } from "@/lib/utils";
import { Container, EASE, Kicker, M2Footer, Pinned, PrimaryCta, Reveal, ScrollIn, SecondaryCta, SectionHead, TYPE, usePinEnabled, useStartHref } from "./ui";
import { ComputeStrip } from "./visuals/ComputeStrip";
import { DomainFigure } from "./visuals/DomainFigure";
import { HeroContours } from "./visuals/HeroContours";
import { HeroFlow } from "./visuals/HeroFlow";
import { Mathematics } from "./visuals/Mathematics";
import { ModelLab } from "./visuals/ModelLab";
import { Operations } from "./visuals/Operations";
import { ProductStack } from "./visuals/ProductStack";
import { QuickStart } from "./visuals/QuickStart";
import { Showcase } from "./visuals/Showcase";
import { Workflow } from "./visuals/Workflow";


function Hero() {
  const reduce = useReducedMotion();
  const start = useStartHref();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const fade = useTransform(scrollYProgress, [0, 0.7], [1, reduce ? 1 : 0.2]);
  const textY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -70]);
  const consoleY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 50]);
  const enter = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.9, ease: EASE, delay } };
  const lines = ["Build your own", "AI that reads charts"];
  return (
    <section ref={ref} className="relative isolate">
      <HeroContours />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-[260px] border-t border-white/[0.07] bg-gradient-to-b from-[#0c0d0f] to-[#050506] lg:block" />
      <Container className="relative pb-16 pt-10 lg:pb-14 lg:pt-12">
        <motion.div style={{ opacity: fade, y: textY }}>
          <motion.div {...enter(0)}>
            <Kicker>Computer vision for financial markets</Kicker>
          </motion.div>
          <h1 className="mt-6 text-[clamp(2.6rem,4.7vw,5.6rem)] font-normal leading-[1.0] tracking-[-0.042em] text-white">
            {lines.map((l, i) => (
              <span key={l} className="-mb-[0.14em] block overflow-hidden pb-[0.14em]">
                <motion.span
                  className={i === 0 ? "block text-white/55" : "block"}
                  initial={reduce ? false : { y: "105%" }}
                  animate={{ y: 0 }}
                  transition={{ duration: 1.1, ease: EASE, delay: 0.1 + i * 0.12 }}
                >
                  {l}
                  {i === 1 && <span className="text-[#a6ecc8]">.</span>}
                </motion.span>
              </span>
            ))}
          </h1>
        </motion.div>

        <div className="mt-8 grid gap-12 lg:mt-12 lg:grid-cols-12 lg:gap-10 2xl:gap-14">
          <motion.div className="flex flex-col lg:col-span-4 lg:pb-12 xl:col-span-3" style={{ y: textY }}>
            <motion.p className="max-w-[26rem] text-[18px] leading-[1.6] text-white/60" {...enter(0.4)}>
              <span className="text-white/90">Neural networks that learn patterns straight from price charts.</span> Convolve turns price
              history into labelled chart images, trains models on them, shows you what they learned and tests the result on data they
              have never seen.
            </motion.p>
            <motion.div className="mt-9 flex flex-wrap gap-3" {...enter(0.55)}>
              <PrimaryCta to={start} size="lg">
                {start === "/dashboard" ? "Open workspace" : "Start building"}
              </PrimaryCta>
              <SecondaryCta href="#workflow" size="lg">
                See how it works
              </SecondaryCta>
            </motion.div>
            <motion.a
              href="#workflow"
              className="group mt-auto hidden items-center gap-3 pt-16 text-[14px] text-white/45 transition-colors hover:text-white lg:flex"
              {...enter(0.8)}
            >
              <span className="relative h-10 w-px overflow-hidden bg-white/15" aria-hidden>
                <motion.span
                  className="absolute inset-x-0 top-0 h-4 bg-white/70"
                  animate={reduce ? undefined : { y: [-16, 40] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.6 }}
                />
              </span>
              Follow one chart through the workflow
            </motion.a>
          </motion.div>
          <motion.div className="relative z-10 min-w-0 lg:col-span-8 xl:col-span-9" style={{ y: consoleY }}>
            <HeroFlow />
          </motion.div>
        </div>
      </Container>
    </section>
  );
}

const CTA_SHOTS = ["opt_heatmap", "representation", "bt_overview"];

function ShotCard({ s, i, p }: { s: string; i: number; p: MotionValue<number> }) {
  const reduce = useReducedMotion();
  const x = useTransform(p, [0, 1], reduce ? [`${i * 13}%`, `${i * 13}%`] : ["13%", `${i * 13}%`]);
  const y = useTransform(p, [0, 1], reduce ? [`${i * 15}%`, `${i * 15}%`] : [`${15 + i * 4}%`, `${i * 15}%`]);
  const rotate = useTransform(p, [0, 1], reduce ? [-3 + i * 3, -3 + i * 3] : [0, -3 + i * 3]);
  return (
    <motion.div
      className="absolute left-0 top-0 w-[74%] overflow-hidden rounded-[14px] border border-white/[0.14] bg-[#08090b] shadow-[0_40px_100px_-30px_rgba(0,0,0,0.95)]"
      style={{ x, y, rotate, zIndex: i }}
    >
      <div className="flex h-7 items-center gap-1.5 border-b border-white/[0.07] px-3" aria-hidden>
        <span className="h-2 w-2 rounded-full bg-white/20" />
        <span className="h-2 w-2 rounded-full bg-white/12" />
        <span className="h-2 w-2 rounded-full bg-white/12" />
      </div>
      <img src={screen(s)} alt="" loading="lazy" className="block aspect-[16/10] w-full" />
    </motion.div>
  );
}

function CtaMockup() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.95", "center 0.5"] });
  return (
    <div ref={ref} className="relative mx-auto aspect-[16/12.5] w-full max-w-[820px]">
      {CTA_SHOTS.map((s, i) => (
        <ShotCard key={s} s={s} i={i} p={scrollYProgress} />
      ))}
    </div>
  );
}

function Closing() {
  const start = useStartHref();
  const reduce = useReducedMotion();
  const words = ["Make trading", "scientific", "again."];
  return (
    <section className="relative overflow-hidden border-t border-white/[0.06] py-24 lg:py-32">
      <Container className="relative grid gap-16 lg:grid-cols-12 lg:items-center lg:gap-10">
        <div className="lg:col-span-5">
          <Kicker>End the day-trading LARP</Kicker>
          <motion.h2
            className="mt-6 text-[clamp(2rem,2.9vw,3.2rem)] font-normal leading-[1.06] tracking-[-0.035em] text-white"
            initial={reduce ? false : "hidden"}
            whileInView="shown"
            viewport={{ once: true, amount: 0.4 }}
          >
            {words.map((w, i) => (
              <span key={w} className="-mb-[0.08em] block overflow-hidden pb-[0.16em]">
                <motion.span
                  className={i === 2 ? "block text-white/45" : "block"}
                  variants={{ hidden: { y: "105%" }, shown: { y: 0 } }}
                  transition={{ duration: 1.1, ease: EASE, delay: i * 0.12 }}
                >
                  {w}
                </motion.span>
              </span>
            ))}
          </motion.h2>
          <p className="mt-6 max-w-md text-[17px] leading-[1.65] text-white/55">
            Hypotheses, held-out data and honest backtests instead of gut feel, without writing code. Convolve makes the experiments
            easier to run; it does not promise they will beat the market.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <PrimaryCta to={start}>
              {start === "/dashboard" ? "Open workspace" : "Start building"}
            </PrimaryCta>
            <SecondaryCta href="#workflow">
              See the workflow
            </SecondaryCta>
          </div>
          <div className="mt-8 flex gap-7 text-[14.5px]">
            <Link to="/about" className="text-white/50 transition-colors hover:text-white">
              About Convolve
            </Link>
            <Link to="/contact" className="text-white/50 transition-colors hover:text-white">
              Contact
            </Link>
          </div>
        </div>
        <div className="lg:col-span-7">
          <CtaMockup />
        </div>
      </Container>
    </section>
  );
}


/** What a CNN is, shown on two images rather than explained in paragraphs. */
function TechnologySection() {
  return (
    <section id="technology" className="scroll-mt-20 pb-24 pt-20 lg:pb-32">
      <Container>
        <SectionHead
          index="01"
          label="The technology"
          title={
            <>
              The technology behind image recognition. <span className="text-white/45">Applied to financial markets.</span>
            </>
          }
          intro="Convolutional neural networks learn to recognise patterns in images. They read medical scans; Convolve trains them on price charts."
        />
        <div className="mt-14 grid gap-12 lg:grid-cols-12 lg:items-end lg:gap-10">
          <ScrollIn className="lg:col-span-8">
            <DomainFigure />
          </ScrollIn>
          <Reveal className="border-t border-white/[0.08] pt-6 lg:col-span-3 lg:col-start-10 lg:mb-[4.5rem]">
            <p className="text-balance text-[clamp(1.35rem,1.7vw,1.75rem)] leading-[1.25] tracking-[-0.02em] text-white/90">
              Don't just analyse the chart. <span className="text-white/45">Train a model to analyse it.</span>
            </p>
            <p className={cn(TYPE.small, "mt-5")}>
              An indicator is a formula someone chose. A CNN learns its own features from the data, and they need not have a name.
            </p>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

function ModelSection() {
  const pin = usePinEnabled();
  const head = (
    <SectionHead
      index="04"
      label="Inside the model"
      title="See what the network sees."
      intro="Real attention maps on real charts. Switch method or chart at any point."
    />
  );
  if (!pin)
    return (
      <section id="model" className="scroll-mt-20 border-t border-white/[0.06] py-24">
        <Container>
          {head}
          <ScrollIn className="mt-12">
            <ModelLab />
          </ScrollIn>
        </Container>
      </section>
    );
  return (
    <section id="model" className="scroll-mt-20 border-t border-white/[0.06]">
      <Pinned length="270vh">
        {(p) => (
          <Container>
            {head}
            <div className="mt-7">
              <ModelLab progress={p} />
            </div>
          </Container>
        )}
      </Pinned>
    </section>
  );
}

/** 02 and 06 hold in place while their scroll-driven sequence runs, like the model section. */
function WorkflowSection() {
  const pin = usePinEnabled(820);
  const head = (
    <SectionHead
      index="02"
      label="Workflow"
      title="From a label rule to a deployed model."
      intro="Each tool hands its result to the next. Dashed stages are optional; any stage can be revisited."
    />
  );
  if (!pin)
    return (
      <section id="workflow" className="scroll-mt-20 border-t border-white/[0.06] pb-24 pt-20 lg:pb-32">
        <Container>
          {head}
          <ScrollIn className="mt-14">
            <Workflow />
          </ScrollIn>
        </Container>
      </section>
    );
  return (
    <section id="workflow" className="scroll-mt-20 border-t border-white/[0.06]">
      <Pinned length="190vh">
        {(p) => (
          <Container>
            {head}
            <div className="mt-12">
              <Workflow progress={p} />
            </div>
          </Container>
        )}
      </Pinned>
    </section>
  );
}

function SystemSection() {
  const pin = usePinEnabled(860);
  const head = (
    <SectionHead index="06" label="One system" title="One pipeline. Every stage." intro="The dashboard brings runs, results and deployed models onto one surface." />
  );
  if (!pin)
    return (
      <section id="system" className="scroll-mt-20 border-t border-white/[0.06] py-24 lg:py-32">
        <Container>
          {head}
          <ScrollIn className="mt-14">
            <ProductStack mode="scroll" />
          </ScrollIn>
        </Container>
      </section>
    );
  return (
    <section id="system" className="scroll-mt-20 border-t border-white/[0.06]">
      <Pinned length="240vh">
        {(p) => (
          <Container>
            {head}
            <div className="mx-auto mt-8 w-full" style={{ maxWidth: "calc((100svh - 360px) / 0.6 + 390px)" }}>
              <ProductStack mode="scroll" progress={p} />
            </div>
          </Container>
        )}
      </Pinned>
    </section>
  );
}

export default function Home2Page() {
  const { hash } = useLocation();
  useEffect(() => {
    document.title = "convolve. | Build your own AI that reads charts";
  }, []);
  useEffect(() => {
    if (!hash) return;
    const id = window.setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView(), 60);
    return () => window.clearTimeout(id);
  }, [hash]);
  return (
    <MotionConfig reducedMotion="user">
      <div className="relative overflow-x-clip bg-[#050506] text-white antialiased">
        <Hero />

        <TechnologySection />

        <WorkflowSection />

        <section id="workspace" className="scroll-mt-20 border-t border-white/[0.06] pb-20 pt-24 lg:pb-28 lg:pt-32">
          <Container>
            <SectionHead index="03" label="The workspace" title="Inside the research workspace." intro="Six connected tools, each shown on a real research run." />
            <div className="mt-12 lg:mt-6">
              <Showcase />
            </div>
          </Container>
        </section>

        <ModelSection />

        <section id="deploy" className="scroll-mt-20 border-t border-white/[0.06] py-24 lg:py-32">
          <Container>
            <SectionHead
              index="05"
              label="Lineage and deployment"
              title="From backtest to deployed model."
              intro="Put a tested model on a schedule: it predicts, acts on a simulated account and reports back. Every deployment traces to the experiment behind it."
            />
            <ScrollIn className="mt-12">
              <Operations />
            </ScrollIn>
          </Container>
        </section>

        <SystemSection />

        <section id="math" className="scroll-mt-20 border-t border-white/[0.06] pt-24 lg:pt-32">
          <Container>
            <SectionHead
              index="07"
              label="For the curious"
              title="From pixels to a prediction."
              intro="The maths behind every prediction, for those who want it. Five operations, repeated, turn a chart into a probability; matching colours link each equation to its picture."
            />
            <div className="mt-12 pb-24 lg:pb-32">
              <Mathematics />
            </div>
          </Container>
        </section>

        <ComputeStrip />

        <section id="start" className="scroll-mt-20 pb-24 lg:pb-32">
          <Container>
            <ScrollIn>
              <QuickStart />
            </ScrollIn>
          </Container>
        </section>

        <Closing />

        <M2Footer />
      </div>
    </MotionConfig>
  );
}
