import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { MotionConfig, motion, useReducedMotion } from "framer-motion";
import { Brain, Eye, FlaskConical, GitBranch, Scale, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import { BetaLimitsList, BetaOfferNote, foundingOfferText, useBetaInfo } from "@/features/beta/BetaUI";
import { EARN_HREF } from "@/features/beta/model";
import { useCreditsStore } from "@/state/creditsStore";
import { Container, EASE, Kicker, M2Footer, PrimaryCta, Reveal, SecondaryCta, SectionHead, TYPE, useStartHref } from "../ui";
import { DomainFigure } from "../visuals/DomainFigure";
import { HeroContours } from "../visuals/HeroContours";
import { Showcase } from "../visuals/Showcase";
import { PipelineExplorer } from "./PipelineExplorer";
import { ProductShowcase } from "./ProductShowcase";
import { CaseStudy } from "./CaseStudy";


function Hero() {
  const reduce = useReducedMotion();
  const start = useStartHref();
  const signedIn = start === "/dashboard";
  const enter = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.85, ease: EASE, delay } };
  const words = ["Build.", "Backtest.", "Improve."];
  return (
    <section className="relative isolate">
      <HeroContours />
      <Container className="relative pb-16 pt-10 lg:pb-20 lg:pt-14">
        <motion.div {...enter(0)}>
          <Kicker>Free public beta · No code</Kicker>
        </motion.div>
        <h1 aria-label="Build. Backtest. Improve." className="mt-6 flex flex-wrap gap-x-[0.28em] text-[clamp(2.7rem,6.4vw,6.6rem)] font-normal leading-[1.0] tracking-[-0.045em] text-white">
          {words.map((w, i) => (
            <span key={w} className="-mb-[0.14em] block overflow-hidden pb-[0.14em]">
              <motion.span
                className={cn("block", i < 2 && "text-white/60")}
                initial={reduce ? false : { y: "105%" }}
                animate={{ y: 0 }}
                transition={{ duration: 1.05, ease: EASE, delay: 0.1 + i * 0.12 }}
              >
                {i === 2 ? (
                  <>
                    Improve<span className="accent-period">.</span>
                  </>
                ) : (
                  w
                )}
              </motion.span>
            </span>
          ))}
        </h1>

        <div className="mt-8 grid gap-12 lg:mt-12 lg:grid-cols-12 lg:gap-10 2xl:gap-14">
          <div className="flex flex-col lg:col-span-4 xl:col-span-4">
            <motion.p className="max-w-[30rem] text-[clamp(1.2rem,1.45vw,1.45rem)] leading-[1.35] tracking-[-0.015em] text-white/90" {...enter(0.35)}>
              The platform for applying convolutional neural networks to the stock market.
            </motion.p>
            <motion.p className="mt-5 max-w-[30rem] text-[16.5px] leading-[1.65] text-white/55" {...enter(0.45)}>
              Turn price history into labelled chart images, train a CNN on them, see what it learned and test it on data it has never seen.
              Then improve it with controlled experiments, and run it on paper.
            </motion.p>
            <motion.div className="mt-8 flex flex-wrap gap-3" {...enter(0.55)}>
              <PrimaryCta to={start} size="lg">
                {signedIn ? "Open workspace" : "Start building"}
              </PrimaryCta>
              <SecondaryCta href="#workflow" size="lg">
                See the workflow
              </SecondaryCta>
            </motion.div>
            <motion.div {...enter(0.65)}>
              <BetaOfferNote className="mt-6" />
            </motion.div>
          </div>
          <motion.div className="relative z-10 min-w-0 lg:col-span-8 xl:col-span-8" {...enter(0.3)}>
            <ProductShowcase />
          </motion.div>
        </div>
      </Container>
    </section>
  );
}

const METHOD = [
  {
    stage: "Hypothesis",
    risk: "Defining success after seeing the results.",
    answer: "The label rule (take-profit, stop-loss, horizon) is fixed before any model sees data and travels with every dataset.",
  },
  {
    stage: "Data",
    risk: "Testing on charts the model was trained on.",
    answer: "Test sets are generated separately, and the Backtester warns when a test set overlaps the model's training data.",
  },
  {
    stage: "Training",
    risk: "A validation score inflated by look-ahead or memorisation.",
    answer: "Chronological validation with purged overlapping windows; early stopping on validation loss restores the best weights.",
  },
  {
    stage: "Interpretation",
    risk: "Heatmaps that look convincing but say nothing.",
    answer: "Four attribution methods, faithfulness checks and findings labelled supported, inconclusive or hypothesis.",
  },
  {
    stage: "Out-of-sample test",
    risk: "Tuning the threshold on the test set and ignoring costs.",
    answer: "The threshold is locked on validation data; commission, slippage and three benchmarks are part of every backtest.",
  },
  {
    stage: "Iteration",
    risk: "Calling noise an improvement.",
    answer: "Every experiment is compared with one fixed original; without repeated seeds the verdict stays 'insufficient evidence'.",
  },
];

function MethodSection() {
  return (
    <section id="method" className="scroll-mt-20 border-t border-white/[0.06] py-24 lg:py-32">
      <Container>
        <SectionHead
          index="03"
          label="Research workflow"
          title={
            <>
              Six stages. <span className="text-white/45">Each with a safeguard.</span>
            </>
          }
          intro="Most ways a trading model fools its author are known. Convolve builds the counter-measure into the stage where the mistake happens."
        />
        <div className="mt-14 hidden grid-cols-12 gap-8 pb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-white/35 md:grid">
          <span className="col-span-3">Stage</span>
          <span className="col-span-4">What goes wrong</span>
          <span className="col-span-5">What Convolve does</span>
        </div>
        <ol className="mt-10 border-b border-white/[0.08] md:mt-0">
          {METHOD.map((m, i) => (
            <Reveal as="li" key={m.stage} delay={0.04 * i} className="grid gap-2 border-t border-white/[0.08] py-6 md:grid-cols-12 md:gap-8">
              <div className="flex items-baseline gap-3 md:col-span-3">
                <span className="font-mono text-[12px] text-white/40">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="text-[19px] font-normal tracking-[-0.015em] text-white">{m.stage}</h3>
              </div>
              <p className="text-[15px] leading-[1.55] text-white/50 md:col-span-4">
                <span className="mb-1 mt-2 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/35 md:hidden">What goes wrong</span>
                {m.risk}
              </p>
              <p className="text-[15px] leading-[1.55] text-white/85 md:col-span-5">
                <span className="mb-1 mt-2 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/35 md:hidden">What Convolve does</span>
                {m.answer}
              </p>
            </Reveal>
          ))}
        </ol>
      </Container>
    </section>
  );
}

const WHY = [
  { icon: Brain, title: "Learns from the chart", body: "An indicator is a formula someone chose. A CNN learns its own features from labelled chart images." },
  { icon: Eye, title: "Shows what it learned", body: "Attribution maps and feature diagnostics for every trained model, with checks on whether they can be trusted." },
  { icon: Scale, title: "Honest by default", body: "Locked thresholds, trading costs and benchmarks in every backtest, and findings that say plainly when a model does not work." },
  { icon: FlaskConical, title: "Improvement as experiments", body: "Improve recommends one change at a time and compares it with the original before calling anything better." },
  { icon: GitBranch, title: "Every result is traceable", body: "Label rule, dataset, training run, model, test set and backtest are linked, so any number can be reproduced." },
  { icon: Server, title: "No code, no GPU setup", body: "Generation, training and backtests run on Convolve's servers. You work in the browser." },
];

function WhySection() {
  return (
    <section id="why" className="scroll-mt-20 border-t border-white/[0.06] py-24 lg:py-32">
      <Container>
        <SectionHead
          index="04"
          label="Why Convolve"
          title={
            <>
              A research platform, <span className="text-white/45">not a signal service.</span>
            </>
          }
          intro="Convolve does not sell predictions or promise returns. It gives you the tools to find out whether an idea holds up."
        />
        <div className="mt-14 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {WHY.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={(i % 3) * 0.06} className="rounded-[18px] border border-white/[0.1] bg-white/[0.025] p-6 lg:p-7">
              <Icon className="h-5 w-5 text-white/60" strokeWidth={1.6} aria-hidden />
              <h3 className="mt-5 text-[19px] font-normal tracking-[-0.015em] text-white">{title}</h3>
              <p className="mt-2.5 text-[15px] leading-[1.6] text-white/55">{body}</p>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

function BetaSection() {
  const { beta, offer } = useBetaInfo();
  const marketData = useCreditsStore((s) => s.marketData);
  const start = useStartHref();
  const items: { title: string; body: ReactNode }[] = [
    { title: "Free while in beta", body: "No subscription required. Nothing is charged automatically." },
    {
      title: "Fair-use limits",
      body: (
        <>
          Run sizes and the number of runs per day are capped during the beta.{" "}
          <Link to="/products#beta-limits" className="text-white/80 underline decoration-white/25 underline-offset-4 hover:text-white">
            Current limits
          </Link>
        </>
      ),
    },
    {
      title: "Earn extra credits",
      body: (
        <>
          Invite friends, answer the three-minute questionnaire or cite Convolve.{" "}
          <Link to={EARN_HREF} className="text-white/80 underline decoration-white/25 underline-offset-4 hover:text-white">
            How it works
          </Link>
        </>
      ),
    },
  ];
  if (offer?.open) items.push({ title: "Founding member offer", body: foundingOfferText(offer) });
  if (marketData?.access === "cohort")
    items.push({ title: "Market data", body: "Market-data downloads are limited to a test group while licensing is finalised. You can request access." });
  return (
    <section id="beta" className="scroll-mt-20 border-t border-white/[0.06] py-24 lg:py-32">
      <Container className="grid gap-12 lg:grid-cols-12 lg:gap-10">
        <Reveal className="lg:col-span-5">
          <Kicker index="07">Public beta</Kicker>
          <h2 className={cn("mt-5 text-balance", TYPE.h2)}>
            Free during the beta. <span className="text-white/45">Help shape what comes next.</span>
          </h2>
          <p className={cn(TYPE.intro, "mt-5 max-w-md")}>
            Convolve is in public beta. Every tool on this page is available to beta accounts, within fair-use limits.
          </p>
          <div className="mt-8">
            <PrimaryCta to={start}>{start === "/dashboard" ? "Open workspace" : "Create a free account"}</PrimaryCta>
          </div>
        </Reveal>
        <Reveal className="lg:col-span-6 lg:col-start-7" delay={0.08}>
          <dl className="divide-y divide-white/[0.07] border-y border-white/[0.07]">
            {items.map((it) => (
              <div key={it.title} className="grid gap-1.5 py-5 sm:grid-cols-[12rem_1fr] sm:gap-6">
                <dt className="text-[15px] text-white/90">{it.title}</dt>
                <dd className="text-[15px] leading-[1.6] text-white/55">{it.body}</dd>
              </div>
            ))}
          </dl>
          {beta ? (
            <details className="group mt-6">
              <summary className="cursor-pointer list-none text-[14px] text-white/60 transition-colors hover:text-white [&::-webkit-details-marker]:hidden">
                <span className="mr-2 inline-block transition-transform group-open:rotate-90" aria-hidden>
                  ›
                </span>
                Limits per tool
              </summary>
              <div className="mt-4">
                <BetaLimitsList beta={beta} />
              </div>
            </details>
          ) : null}
        </Reveal>
      </Container>
    </section>
  );
}

function Closing() {
  const start = useStartHref();
  return (
    <section className="border-t border-white/[0.06] py-24 lg:py-32">
      <Container className="flex flex-col items-start gap-8 lg:flex-row lg:items-end lg:justify-between">
        <Reveal>
          <h2 className="text-[clamp(2.2rem,4.4vw,4.4rem)] font-normal leading-[1.02] tracking-[-0.04em] text-white">
            Build. Backtest. Improve<span className="accent-period">.</span>
          </h2>
          <p className="mt-5 max-w-xl text-[17px] leading-[1.65] text-white/55">
            Hypotheses, held-out data and honest backtests instead of gut feel. Convolve makes the experiments easier to run; it does not
            promise they will beat the market.
          </p>
        </Reveal>
        <Reveal delay={0.1} className="flex flex-wrap gap-3">
          <PrimaryCta to={start} size="lg">
            {start === "/dashboard" ? "Open workspace" : "Start building"}
          </PrimaryCta>
          <SecondaryCta to="/products" size="lg">
            Explore the products
          </SecondaryCta>
        </Reveal>
      </Container>
    </section>
  );
}

/** Homepage V2 (`/homepage-v2`): noindex draft of a redesigned landing page. The live homepage is Home2Page. */
export default function HomeV2Page() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const id = window.setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView(), 60);
    return () => window.clearTimeout(id);
  }, [hash]);
  return (
    <MotionConfig reducedMotion="user">
      <div className="relative overflow-x-clip bg-[#050506] text-white antialiased">
        <Hero />

        <section id="workflow" className="scroll-mt-20 border-t border-white/[0.06] py-24 lg:py-32">
          <Container>
            <SectionHead
              index="01"
              label="The workflow"
              title={
                <>
                  From price history to a tested model. <span className="text-white/45">In six steps.</span>
                </>
              }
              intro="Every visual below comes from one real research run on Microsoft stock. Pick a step, or let it play."
            />
            <div className="mt-12 lg:mt-16">
              <PipelineExplorer />
            </div>
          </Container>
        </section>

        <section id="technology" className="scroll-mt-20 border-t border-white/[0.06] py-24 lg:py-32">
          <Container>
            <SectionHead
              index="02"
              label="The technology"
              title={
                <>
                  The technology behind image recognition. <span className="text-white/45">Applied to financial markets.</span>
                </>
              }
              intro="Convolutional neural networks learn to recognise patterns in images. They read medical scans; Convolve trains them on price charts."
            />
            <div className="mt-14">
              <DomainFigure />
            </div>
          </Container>
        </section>

        <MethodSection />

        <WhySection />

        <section id="case-study" className="scroll-mt-20 border-t border-white/[0.06] py-24 lg:py-32">
          <Container>
            <SectionHead
              index="05"
              label="Case study"
              title={
                <>
                  Our own model lost money. <span className="text-white/45">Here is how Convolve showed us why.</span>
                </>
              }
              intro="A real run, reported as it came out. Not every idea works; the point is to find out quickly and honestly."
            />
            <div className="mt-14">
              <CaseStudy />
            </div>
          </Container>
        </section>

        <section id="workspace" className="scroll-mt-20 border-t border-white/[0.06] pb-20 pt-24 lg:pb-28 lg:pt-32">
          <Container>
            <SectionHead index="06" label="The workspace" title="Inside the research workspace." intro="The real result pages, annotated." />
            <div className="mt-12 lg:mt-6">
              <Showcase />
            </div>
          </Container>
        </section>

        <BetaSection />

        <Closing />

        <M2Footer />
      </div>
    </MotionConfig>
  );
}
