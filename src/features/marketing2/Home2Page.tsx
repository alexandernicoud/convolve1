import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { MotionConfig, motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { screen } from "./data";
import { Container, EASE, Kicker, M2Footer, PrimaryCta, Reveal, SecondaryCta, useStartHref } from "./ui";
import { GradientLandscape } from "./visuals/GradientLandscape";
import { HeroFlow } from "./visuals/HeroFlow";
import { ModelLab } from "./visuals/ModelLab";
import { Operations } from "./visuals/Operations";
import { Showcase } from "./visuals/Showcase";
import { Workflow } from "./visuals/Workflow";

function SectionHead({ index, label, title, intro }: { index: string; label: string; title: ReactNode; intro?: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
      <Reveal className="lg:col-span-7">
        <Kicker index={index}>{label}</Kicker>
        <h2 className="mt-5 text-[clamp(2rem,4vw,3.5rem)] font-medium leading-[1.05] tracking-[-0.035em] text-white">{title}</h2>
      </Reveal>
      {intro ? (
        <Reveal className="lg:col-span-4 lg:col-start-9" delay={0.1}>
          <p className="text-[15.5px] leading-relaxed text-white/55">{intro}</p>
        </Reveal>
      ) : null}
    </div>
  );
}

function Hero() {
  const reduce = useReducedMotion();
  const start = useStartHref();
  const enter = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.9, ease: EASE, delay } };
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5] [background-image:linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_70%_60%_at_60%_40%,black,transparent)]"
      />
      <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] h-[620px] w-[900px] bg-[radial-gradient(closest-side,rgba(185,211,255,0.08),transparent)]" />
      <Container className="relative grid min-h-[calc(100svh-80px)] items-center gap-12 pb-16 pt-10 lg:grid-cols-12 lg:gap-10 lg:pb-20">
        <div className="lg:col-span-5">
          <motion.div {...enter(0)}>
            <Kicker>No-code CNN research and trading</Kicker>
          </motion.div>
          <motion.h1
            className="mt-7 text-[clamp(2.5rem,8.4vw,3.9rem)] font-medium leading-[1.0] tracking-[-0.045em] text-white lg:text-[clamp(2.9rem,3.8vw,3.9rem)]"
            {...enter(0.08)}
          >
            Build, research and deploy your own CNN trading models.
            <span className="mt-2 block bg-gradient-to-r from-white via-white/80 to-[#9aa6b6] bg-clip-text text-transparent">Without writing code.</span>
          </motion.h1>
          <motion.p className="mt-7 max-w-[30rem] text-[17px] leading-relaxed text-white/60" {...enter(0.2)}>
            Turn price history into chart datasets, train convolutional networks, see what they learned, backtest them and run them as
            bots. One workspace.
          </motion.p>
          <motion.div className="mt-9 flex flex-wrap gap-3" {...enter(0.3)}>
            <PrimaryCta to={start}>Start building</PrimaryCta>
            <SecondaryCta href="#workflow">See the workflow</SecondaryCta>
          </motion.div>
          <motion.p className="mt-10 max-w-[30rem] border-t border-white/[0.08] pt-5 text-[13px] leading-relaxed text-white/40" {...enter(0.4)}>
            Whether CNNs can read markets from charts is an open research question. Convolve lets you test it on your own data.
          </motion.p>
        </div>
        <div className="min-w-0 lg:col-span-7">
          <HeroFlow />
        </div>
      </Container>
    </section>
  );
}

function OptimisationContrast() {
  return (
    <div className="mt-10 grid gap-px overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.08] md:grid-cols-2">
      <div className="bg-[#050506] p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">Training · gradient descent</div>
        <p className="mt-2 text-[14.5px] leading-relaxed text-white/70">
          Weights follow the gradient of the loss. Convolve watches validation loss, stops early and restores the best epoch.
        </p>
      </div>
      <div className="bg-[#050506] p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">Label search · exhaustive grid</div>
        <p className="mt-2 text-[14.5px] leading-relaxed text-white/70">
          No gradients. The Labeling Optimizer scores every take-profit, stop-loss and horizon combination.{" "}
          <a href="#workspace" className="inline-flex items-center gap-1 text-white underline-offset-4 hover:underline">
            See the search space <ArrowRight className="h-3 w-3" aria-hidden />
          </a>
        </p>
      </div>
    </div>
  );
}

const CTA_SHOTS = ["opt_heatmap", "representation", "bt_overview"];

function CtaMockup() {
  const reduce = useReducedMotion();
  return (
    <div className="relative mx-auto aspect-[16/12] w-full max-w-[640px]">
      <div aria-hidden className="pointer-events-none absolute -inset-[12%] bg-[radial-gradient(closest-side,rgba(185,211,255,0.14),transparent)]" />
      {CTA_SHOTS.map((s, i) => (
        <motion.div
          key={s}
          className="absolute w-[78%] overflow-hidden rounded-[12px] border border-white/[0.12] bg-[#08090b] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.95)]"
          style={{ left: `${i * 11}%`, top: `${i * 13}%`, zIndex: i }}
          initial={reduce ? false : { opacity: 0, y: 24, rotate: -2 + i * 2 }}
          whileInView={{ opacity: 1, y: 0, rotate: -2 + i * 2 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.1 + i * 0.12 }}
        >
          <div className="flex h-6 items-center gap-1 border-b border-white/[0.07] px-2.5" aria-hidden>
            <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
            <span className="h-1.5 w-1.5 rounded-full bg-white/12" />
            <span className="h-1.5 w-1.5 rounded-full bg-white/12" />
          </div>
          <img src={screen(s)} alt="" loading="lazy" className="block aspect-[16/10] w-full" />
        </motion.div>
      ))}
    </div>
  );
}

function MissionAndCta() {
  const start = useStartHref();
  return (
    <>
      <div className="grid gap-8 lg:grid-cols-12">
        <Reveal className="lg:col-span-3">
          <Kicker index="06">Mission</Kicker>
        </Reveal>
        <div className="lg:col-span-8">
          <Reveal>
            <p className="text-[clamp(1.6rem,3vw,2.6rem)] font-light leading-[1.2] tracking-[-0.025em] text-white">
              Quantitative AI research should not require a research team. Convolve lowers the technical barrier so anyone can build
              and test CNN trading models carefully.
            </p>
          </Reveal>
          <Reveal delay={0.08} className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-xl text-[14px] leading-relaxed text-white/45">
              It makes rigorous experiments easier to run. It does not promise they will beat the market.
            </p>
            <Link to="/about2" className="group inline-flex items-center gap-2 text-[14px] text-white/75 transition-colors hover:text-white">
              Why Convolve exists
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </Reveal>
        </div>
      </div>

      <Reveal className="mt-20 lg:mt-28">
        <div className="flex flex-col overflow-hidden rounded-[28px] border border-white/[0.14] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_36px_100px_-48px_rgba(0,0,0,0.78)] sm:rounded-[32px] lg:min-h-[560px] lg:flex-row">
          <div className="flex flex-1 flex-col justify-center px-6 py-12 sm:px-10 sm:py-14 lg:max-w-[48%] lg:px-14">
            <Kicker>Start</Kicker>
            <h2 className="mt-4 text-balance text-[clamp(2.1rem,4.6vw,3.7rem)] font-normal leading-[1.1] tracking-[-0.03em] text-white">
              <span className="font-semibold">Start developing</span> <span className="text-white/70">your trading AI with convolve.</span>
            </h2>
            <div className="mt-10 flex flex-wrap gap-3">
              <PrimaryCta to={start}>Get started</PrimaryCta>
              <SecondaryCta to="/contact">Contact</SecondaryCta>
            </div>
          </div>
          <div className="relative flex flex-1 items-center justify-center px-6 pb-12 pt-2 sm:px-10 lg:py-14 lg:pr-12">
            <CtaMockup />
          </div>
        </div>
      </Reveal>
    </>
  );
}

export default function Home2Page() {
  const { hash } = useLocation();
  useEffect(() => {
    document.title = "convolve. | Build, research and deploy CNN trading models";
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

        <section id="workflow" className="scroll-mt-20 border-t border-white/[0.06] py-20 lg:py-28">
          <Container>
            <SectionHead
              index="01"
              label="Workflow"
              title="Six steps from prices to a running bot."
              intro="Each step hands its output to the next. Two are optional, and you can return to any of them."
            />
            <div className="mt-12">
              <Workflow />
            </div>
          </Container>
        </section>

        <section id="workspace" className="scroll-mt-20 border-t border-white/[0.06] py-20 lg:py-28">
          <Container>
            <SectionHead
              index="02"
              label="The workspace"
              title="Real tools, real outputs."
              intro="Screenshots and live components from a local MSFT research run and an INTC label search. Expand any screenshot."
            />
            <div className="mt-12">
              <Showcase />
            </div>
          </Container>
        </section>

        <section id="model" className="scroll-mt-20 border-t border-white/[0.06] py-20 lg:py-28">
          <Container>
            <SectionHead
              index="03"
              label="Inside the model"
              title="See what the network sees."
              intro="Attention maps for real charts, aligned pixel for pixel, next to the mathematics that produced them. Convolve runs every equation; you choose the experiment."
            />
            <div className="mt-12">
              <ModelLab />
            </div>
          </Container>
        </section>

        <section className="border-t border-white/[0.06] py-20 lg:py-28">
          <Container>
            <SectionHead
              index="04"
              label="Optimisation"
              title="How a network learns."
              intro="Scroll to descend. Click the contour map to start somewhere else and compare plain gradient descent with momentum."
            />
            <div className="mt-12">
              <GradientLandscape />
            </div>
            <OptimisationContrast />
          </Container>
        </section>

        <section id="deploy" className="scroll-mt-20 border-t border-white/[0.06] py-20 lg:py-28">
          <Container>
            <SectionHead
              index="05"
              label="Lineage and deployment"
              title="From backtest to running bot."
              intro="Deploy a model as a paper-trading bot on any symbol and schedule. Every bot is linked to the model, dataset and backtest it came from."
            />
            <div className="mt-12">
              <Operations />
            </div>
          </Container>
        </section>

        <section className="border-t border-white/[0.06] py-20 lg:py-28">
          <Container>
            <MissionAndCta />
          </Container>
        </section>

        <M2Footer />
      </div>
    </MotionConfig>
  );
}
