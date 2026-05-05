import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Instagram, Linkedin } from "lucide-react";
import { VisionProofStats } from "@/components/vision/VisionProofStats";
import { SoftwarePortraitBox } from "@/components/vision/SoftwarePortraitBox";
import { FOUNDER_INSTAGRAM_URL, FOUNDER_LINKEDIN_URL } from "@/lib/founderLinks";
import { Home2GlowMockup } from "@/pages/VisionHome2Mockup";
import trainingDataImg from "@/assets/trainingdata.png";
import trainingImg from "@/assets/training.png";
import backtesterImg from "@/assets/backtester.png";
import dashboardImg from "@/assets/dashboard.png";

/** Shared section index + label for /home2. */
export function Home2SectionKicker({ num, label, show = true }: { num: string; label: string; show?: boolean }) {
  if (!show) return null;
  return (
    <div className="mb-5 flex flex-wrap items-baseline gap-3 md:mb-7">
      <span className="font-mono text-[11px] font-semibold tabular-nums tracking-[0.22em] text-white/40">
        {num}
      </span>
      <span aria-hidden className="h-px w-8 shrink-0 bg-white/[0.14] sm:w-10" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.26em] text-white/50">{label}</span>
    </div>
  );
}

const BTN_PREMIUM =
  "inline-flex items-center justify-center gap-2 rounded-full border border-white/25 bg-white/[0.08] px-7 py-3.5 text-base font-medium text-white transition duration-300 ease-out hover:border-white/40 hover:bg-white/[0.14] active:scale-[0.98] sm:px-8 sm:py-4 sm:text-lg";

const PIPELINE_STEPS = [
  {
    text: "Generate large scale training data",
    image: trainingDataImg,
    detail: "Create broad, structured chart datasets in minutes with repeatable generation presets.",
  },
  {
    text: "Train your own CNN",
    image: trainingImg,
    detail: "Train visual models directly on chart structure and monitor layer behavior end to end.",
  },
  {
    text: "Backtest your model over 50 years",
    image: backtesterImg,
    detail: "Validate robustness on deep historical windows and inspect model behavior under stress.",
  },
  {
    text: "Deploy your bot to our 24/7 server.",
    image: dashboardImg,
    detail: "Ship to live infrastructure, track signals continuously, and review outcomes from one dashboard.",
  },
] as const;

const ADVANTAGE_BUBBLES_FOUR: { text: string; className: string }[] = [
  { text: "Use research", className: "left-[4%] top-[12%] sm:left-[6%] sm:top-[14%]" },
  { text: "Scale data", className: "right-[4%] top-[14%] sm:right-[8%] sm:top-[16%]" },
  { text: "Own models", className: "left-[4%] bottom-[18%] sm:left-[7%] sm:bottom-[20%]" },
  { text: "Long backtests", className: "right-[4%] bottom-[16%] sm:right-[8%] sm:bottom-[18%]" },
];

/** Scroll-scrubbed headline — tall track, sticky viewport, copy swaps by progress. */
export function SectionPipelineScroll({
  kickerNum = "03",
  kickerLabel = "Pipeline",
  showKicker = true,
}: {
  kickerNum?: string;
  kickerLabel?: string;
  showKicker?: boolean;
} = {}) {
  const reduced = useReducedMotion();
  const trackRef = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);

  const onScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const total = el.offsetHeight - window.innerHeight;
    if (total <= 0) {
      setStep(0);
      return;
    }
    const progress = Math.min(1, Math.max(0, -rect.top / total));
    const i = Math.min(PIPELINE_STEPS.length - 1, Math.floor(progress * PIPELINE_STEPS.length));
    setStep(i);
  }, []);

  useEffect(() => {
    if (reduced) {
      setStep(0);
      return;
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [onScroll, reduced]);

  if (reduced) {
    return (
      <section id="section-pipeline" className="relative border-t border-white/[0.08] bg-black px-5 py-24 md:px-10 lg:px-14">
        <div className="mx-auto mb-10 flex max-w-3xl justify-center">
          <Home2SectionKicker num={kickerNum} label={kickerLabel} show={showKicker} />
        </div>
        <div className="mx-auto max-w-6xl space-y-12 text-center">
          {PIPELINE_STEPS.map((item) => (
            <div key={item.text} className="space-y-6">
              <p className="text-[clamp(1.8rem,4.8vw,3.4rem)] font-normal leading-[1.08] tracking-[-0.03em] text-white/95">
                <span className="font-semibold text-white">{item.text.split(" ").slice(0, 2).join(" ")}</span>{" "}
                <span className="text-white/72">{item.text.split(" ").slice(2).join(" ")}</span>
              </p>
              <img
                src={item.image}
                alt={item.text}
                className="mx-auto h-auto w-full max-w-5xl rounded-2xl border border-white/[0.12] object-cover"
                loading="lazy"
                decoding="async"
              />
              <p className="mx-auto max-w-4xl text-[clamp(1rem,1.6vw,1.25rem)] font-normal leading-relaxed text-white/72">
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      id="section-pipeline"
      ref={trackRef}
      className="relative border-t border-white/[0.08] bg-black"
      style={{ height: `${PIPELINE_STEPS.length * 120}vh` }}
      aria-label="Product pipeline"
    >
      <div className="sticky top-0 flex h-[100dvh] w-full flex-col items-center justify-center px-5 md:px-10">
        <div className="relative z-[1] mx-auto flex w-full max-w-[min(100%,1240px)] flex-col items-center text-center">
          <div className="mb-2 flex w-full justify-center">
            <Home2SectionKicker num={kickerNum} label={kickerLabel} show={showKicker} />
          </div>
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-7">
            <p
              key={PIPELINE_STEPS[step].text}
              className="text-balance text-center text-[clamp(2.1rem,5.1vw,3.9rem)] font-normal leading-[1.08] tracking-[-0.03em] text-white"
              aria-live="polite"
            >
              <span className="font-semibold text-white">
                {PIPELINE_STEPS[step].text.split(" ").slice(0, 2).join(" ")}
              </span>{" "}
              <span className="text-white/72">{PIPELINE_STEPS[step].text.split(" ").slice(2).join(" ")}</span>
            </p>
            <motion.img
              key={PIPELINE_STEPS[step].image}
              src={PIPELINE_STEPS[step].image}
              alt={PIPELINE_STEPS[step].text}
              className="mx-auto h-auto w-full max-w-6xl rounded-2xl border border-white/[0.12] object-cover"
              initial={{ opacity: 0.72, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
              loading="lazy"
              decoding="async"
            />
            <motion.p
              key={PIPELINE_STEPS[step].detail}
              className="mx-auto max-w-4xl text-center text-[clamp(1rem,1.6vw,1.25rem)] font-normal leading-relaxed text-white/72"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              {PIPELINE_STEPS[step].detail}
            </motion.p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Vision §02 — overlapping product shots; `home2` variant styling in `SoftwarePortraitBox`. */
export function SectionSoftwarePortraitHome2({
  kickerNum = "04",
  kickerLabel = "Software",
  showPortrait = true,
  neutralBackdrop = false,
  visionTypography = false,
  showKicker = true,
}: {
  kickerNum?: string;
  kickerLabel?: string;
  /** Set false on /home4 — copy-only, no screenshot mosaic. */
  showPortrait?: boolean;
  /** Match main Vision landing — monochrome wash instead of teal. */
  neutralBackdrop?: boolean;
  /** Heavier headings for /home2; extralight to match `/` Vision. */
  visionTypography?: boolean;
  showKicker?: boolean;
} = {}) {
  const reduced = useReducedMotion();
  const h2Tone = visionTypography
    ? "mt-4 text-balance text-[clamp(1.55rem,4.2vw,2.5rem)] font-extralight leading-[1.08] tracking-[-0.025em] text-white md:mt-5"
    : "mt-4 text-balance text-[clamp(1.55rem,4.2vw,2.5rem)] font-normal leading-[1.08] tracking-[-0.03em] text-white md:mt-5";
  return (
    <section id="section-software" className="relative border-t border-white/[0.08] bg-black">
      <div
        className={`relative flex w-full flex-col items-center justify-center px-5 py-6 md:px-12 md:py-7 lg:px-16 ${showPortrait ? "min-h-[min(62dvh,560px)]" : "min-h-[min(72dvh,620px)]"}`}
      >
        <div className="mb-0 w-full max-w-[min(100%,72rem)] text-center">
          <div className="mb-1 flex justify-center">
            <Home2SectionKicker num={kickerNum} label={kickerLabel} show={showKicker} />
          </div>
          <p className="text-[10px] font-normal uppercase tracking-[0.28em] text-white/60 md:text-[11px]">
            The software
          </p>
          <h2 className={`${h2Tone} text-[clamp(2.15rem,5.2vw,3.9rem)]`}>
            One workspace —{" "}
            <span className={visionTypography ? "text-white/55" : "text-white/48"}>train, backtest, deploy.</span>
          </h2>
          {!showPortrait ? (
            <p className="mx-auto mt-8 max-w-2xl text-[clamp(1.02rem,1.9vw,1.15rem)] leading-relaxed text-white/75">
              A single surface for dataset generation, labeling, training, backtesting, and deployment—versioned runs and
              full transparency across every stage.
            </p>
          ) : null}
        </div>
        {showPortrait ? (
          <motion.div
            className="-mt-4 md:-mt-5"
            initial={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: reduced ? 0 : 0.56, ease: [0.16, 1, 0.3, 1] }}
          >
            <SoftwarePortraitBox variant="home2" />
          </motion.div>
        ) : null}
      </div>
    </section>
  );
}

const ADVANTAGE_BUBBLES: { text: string; className: string }[] = [
  { text: "Use proven research", className: "left-[4%] top-[10%] sm:left-[6%] sm:top-[12%]" },
  { text: "Scale robust data", className: "right-[4%] top-[14%] sm:right-[8%] sm:top-[16%]" },
  { text: "Own visual models", className: "left-[2%] top-[44%] sm:left-[5%] sm:top-[42%]" },
  { text: "Run long backtests", className: "right-[2%] top-[48%] sm:right-[6%] sm:top-[46%]" },
  { text: "Deploy live servers", className: "left-1/2 bottom-[6%] -translate-x-1/2 sm:bottom-[10%]" },
];

function Bubble({ text, className }: { text: string; className: string }) {
  return (
    <div
      className={`pointer-events-none absolute z-[20] max-w-[min(60vw,320px)] sm:max-w-[min(50vw,360px)] ${className}`}
      aria-hidden
    >
      <div className="rounded-2xl border border-white/[0.16] bg-black/60 px-6 py-4 text-center shadow-[0_0_32px_rgba(0,0,0,0.45)] backdrop-blur-sm sm:px-7 sm:py-5">
        <span className="text-[14px] font-bold uppercase tracking-[0.1em] text-white sm:text-base">{text}</span>
      </div>
    </div>
  );
}

export function SectionAdvantagesHub({
  heroReducedMotion,
  kickerNum = "05",
  kickerLabel = "Capabilities",
  bubbleCount = 5,
  neutralMockupGlow = false,
  disableGlow = false,
  showKicker = true,
}: {
  heroReducedMotion: boolean | null;
  kickerNum?: string;
  kickerLabel?: string;
  bubbleCount?: 4 | 5;
  neutralMockupGlow?: boolean;
  disableGlow?: boolean;
  showKicker?: boolean;
}) {
  const rm = !!heroReducedMotion;
  const bubbles = bubbleCount === 4 ? ADVANTAGE_BUBBLES_FOUR : ADVANTAGE_BUBBLES;
  return (
    <section
      id="section-advantages"
      className="relative border-t border-white/[0.08] bg-black px-3 py-14 md:px-6 md:py-16 lg:py-18"
    >
      <div className="relative mx-auto w-full max-w-[min(100%,1600px)] px-4 pb-1 pt-1 md:px-8 md:pt-1">
        <Home2SectionKicker num={kickerNum} label={kickerLabel} show={showKicker} />
        <h2 className="mt-3 text-balance text-center text-[clamp(2.15rem,5.2vw,3.9rem)] font-normal leading-[1.08] tracking-[-0.03em] text-white md:mt-4">
          <span className="font-semibold text-white">One workspace</span> —{" "}
          <span className="text-white/48">train, backtest, deploy.</span>
        </h2>
      </div>
      <div className="relative mx-auto flex min-h-[min(50dvh,420px)] w-full max-w-[min(100%,1600px)] items-center justify-center">
        <div className="relative w-full">
          {bubbles.map((b) => (
            <Bubble key={b.text} text={b.text} className={b.className} />
          ))}
          <motion.div
            className="relative z-[10] mx-auto w-full"
            initial={rm ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: rm ? 0 : 0.65, ease: [0.16, 1, 0.3, 1] }}
          >
            <Home2GlowMockup heroReducedMotion={rm} glowPlacement="hero" hub neutralGlow={neutralMockupGlow} disableGlow={disableGlow} />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

const BTN_NEUTRAL_SOLID =
  "inline-flex items-center justify-center gap-2 rounded-full bg-white px-7 py-3.5 text-base font-medium text-[#0a0a0a] transition duration-300 ease-out hover:bg-white/90 active:scale-[0.98] sm:px-8 sm:py-4 sm:text-lg";

/** Same figures as `/` Vision proof — large mono display for /home2. */
export function SectionHome2ProofStats({
  kickerNum = "06",
  kickerLabel = "Proof",
  showKicker = true,
}: {
  kickerNum?: string;
  kickerLabel?: string;
  showKicker?: boolean;
} = {}) {
  const reduced = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setActive(true);
      },
      { threshold: 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section
      id="section-proof-stats"
      ref={sectionRef}
      className="relative border-t border-white/[0.08] bg-black px-5 py-28 md:px-10 md:py-40 lg:px-14 lg:py-44"
    >
      <div className="relative mx-auto w-full max-w-[min(100%,1440px)]">
        <Home2SectionKicker num={kickerNum} label={kickerLabel} show={showKicker} />
        <h2 className="mt-2 text-balance text-[clamp(2.15rem,5.2vw,3.9rem)] font-normal leading-[1.08] tracking-[-0.03em] text-white">
          <span className="font-semibold text-white">Scale</span> &{" "}
          <span className="text-white/72">history</span>
        </h2>
        <VisionProofStats active={active} reducedMotion={!!reduced} />
        <div className="mt-12 flex justify-center">
          <Link to="/dashboard" className={BTN_PREMIUM}>
            See for yourself&nbsp;&rarr;
          </Link>
        </div>
      </div>
    </section>
  );
}

export function SectionDevelopCta({
  heroReducedMotion,
  kickerNum = "07",
  kickerLabel = "Start",
  showMockup = true,
  neutralCta = false,
  compactBanner = false,
  showKicker = true,
}: {
  heroReducedMotion: boolean | null;
  kickerNum?: string;
  kickerLabel?: string;
  showMockup?: boolean;
  neutralCta?: boolean;
  compactBanner?: boolean;
  showKicker?: boolean;
}) {
  const rm = !!heroReducedMotion;
  const ctaClass = neutralCta ? BTN_NEUTRAL_SOLID : BTN_PREMIUM;
  return (
    <section id="section-develop" className={`relative isolate border-t border-white/[0.08] bg-black ${compactBanner ? "-mt-8 py-5 md:-mt-10 md:py-6 lg:-mt-12 lg:py-8" : "py-12 md:py-16 lg:py-20"}`}>

      <div className="relative z-[2] mx-auto w-full max-w-[min(100%,1440px)] px-4 sm:px-5 md:px-8 lg:px-10">
        <motion.div
          className={`flex w-full flex-col overflow-hidden rounded-[28px] border border-white/[0.14] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_36px_100px_-48px_rgba(0,0,0,0.78)] sm:rounded-[32px] ${showMockup ? "lg:min-h-[min(92dvh,920px)] lg:flex-row" : compactBanner ? "lg:mx-auto lg:max-w-[min(100%,1400px)]" : "lg:max-w-[min(100%,56rem)] lg:mx-auto"}`}
          initial={rm ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: rm ? 0 : 0.58, ease: [0.16, 1, 0.3, 1] }}
        >
          <div
            className={`flex flex-1 ${compactBanner ? "flex-row items-center justify-between gap-6 px-6 py-4 sm:px-8 sm:py-5 lg:px-12 lg:py-5" : "flex-col justify-center px-6 py-12 sm:px-10 sm:py-14 lg:px-14 lg:py-16"} ${showMockup ? "lg:max-w-[min(100%,52%)]" : "max-w-none"}`}
          >
            <Home2SectionKicker num={kickerNum} label={kickerLabel} show={showKicker} />
            <h2 className={`text-balance leading-[1.12] tracking-[-0.03em] text-white ${compactBanner ? "mt-0 text-[clamp(1.1rem,2.1vw,1.7rem)] font-normal" : "mt-2 text-[clamp(2.15rem,5vw,3.9rem)] font-normal"}`}>
              <span className="font-semibold text-white">Start developing</span>{" "}
              <span className="text-white/72">your trading AI with convolve.</span>
            </h2>
          <Link to="/dashboard" className={`${compactBanner ? "mt-0 shrink-0" : "mt-10"} w-fit ${ctaClass}`}>
              Get started&nbsp;&rarr;
            </Link>
          </div>

          {showMockup ? (
            <div className="relative flex min-h-[min(44dvh,400px)] flex-1 items-center justify-center px-4 pb-12 pt-4 sm:px-8 sm:pb-14 sm:pt-8 lg:min-h-0 lg:pb-14 lg:pr-12 lg:pt-14">
              <Home2GlowMockup heroReducedMotion={rm} glowPlacement="cta" neutralGlow={neutralCta} />
            </div>
          ) : null}
        </motion.div>
      </div>
    </section>
  );
}

export function SectionFounderQuote({
  kickerNum = "08",
  kickerLabel = "Founder",
  showKicker = true,
}: {
  kickerNum?: string;
  kickerLabel?: string;
  showKicker?: boolean;
} = {}) {
  const reduced = useReducedMotion();
  const quoteText =
    "I built Convolve so traders could stop hand-waving charts and actually test visual models end to end-data, training, backtests, and live runs in one serious pipeline.";
  return (
    <section
      id="section-founder"
      className="relative border-t border-white/[0.08] bg-black px-5 py-24 md:px-10 md:py-36 lg:px-14 lg:py-44"
    >
      <motion.div
        className="relative mx-auto max-w-[min(100%,56rem)]"
        initial={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.22 }}
        transition={{ duration: reduced ? 0 : 0.62, ease: [0.16, 1, 0.3, 1] }}
      >
        <Home2SectionKicker num={kickerNum} label={kickerLabel} show={showKicker} />
        <blockquote className="relative text-left md:text-center">
          <span
            className="pointer-events-none absolute -left-1 -top-2 font-serif text-[clamp(3.5rem,16vw,9rem)] font-bold leading-none text-white/[0.14] md:left-4 md:-top-6"
            aria-hidden
          >
            &ldquo;
          </span>
          <span
            className="pointer-events-none absolute -bottom-10 -right-1 font-serif text-[clamp(3.5rem,16vw,9rem)] font-bold leading-none text-white/[0.14] md:-bottom-14 md:right-4"
            aria-hidden
          >
            &rdquo;
          </span>
          <p className="relative z-[1] text-balance text-[clamp(1.9rem,4.7vw,3.2rem)] font-normal leading-[1.12] tracking-[-0.028em] text-white md:leading-[1.1]">
            {Array.from(quoteText).map((ch, i) => (
              <motion.span
                key={`q-${i}`}
                initial={reduced ? { opacity: 1 } : { opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: reduced ? 0 : 0.16, delay: reduced ? 0 : 0.2 + i * 0.01 }}
              >
                {ch}
              </motion.span>
            ))}
          </p>
          <footer className="relative z-[1] mt-12 text-left text-sm font-normal uppercase tracking-[0.16em] text-white/50 md:text-center md:text-base">
            Alexander Nicoud — Founder
          </footer>
        </blockquote>
      </motion.div>
    </section>
  );
}

export function SectionPipelineTagline({
  kickerNum = "09",
  kickerLabel = "Platform",
  neutralBackdrop = false,
  showKicker = true,
  withCta = false,
}: {
  kickerNum?: string;
  kickerLabel?: string;
  neutralBackdrop?: boolean;
  showKicker?: boolean;
  withCta?: boolean;
} = {}) {
  const reduced = useReducedMotion();
  return (
    <section
      id="section-tagline"
      className="relative border-t border-white/[0.08] bg-black px-5 pb-8 pt-24 md:px-10 md:pb-10 md:pt-32 lg:px-14"
    >
      <motion.div
        className="relative mx-auto flex max-w-[56rem] translate-y-8 flex-col items-center text-center md:translate-y-10"
        initial={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 22 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.25 }}
        transition={{ duration: reduced ? 0 : 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <Home2SectionKicker num={kickerNum} label={kickerLabel} show={showKicker} />
        <p className="relative mt-2 text-[clamp(2.1rem,5vw,3.9rem)] font-normal leading-[1.08] tracking-[-0.03em] text-white">
          <span className="font-semibold text-white">Make Trading Scientific Again.</span>
        </p>
        {withCta ? (
          <Link to="/dashboard" className={`mt-8 ${BTN_PREMIUM}`}>
            Try the bot
          </Link>
        ) : null}
      </motion.div>
    </section>
  );
}

export function SectionYouWantIn() {
  return (
    <section id="section-you-want-in" className="relative border-t border-white/[0.08] bg-black px-5 py-20 md:px-10 md:py-24 lg:px-14">
      <div className="mx-auto flex max-w-[56rem] flex-col items-center text-center">
        <h2 className="text-[clamp(2.1rem,5vw,3.8rem)] font-normal leading-[1.08] tracking-[-0.03em] text-white">
          <span className="font-semibold">You want in?</span>
        </h2>
        <p className="mt-4 text-[clamp(1rem,1.7vw,1.2rem)] text-white/70">Make Trading Scientific Again.</p>
        <Link to="/contact" className={`mt-8 ${BTN_PREMIUM}`}>
          Reach out&nbsp;&rarr;
        </Link>
      </div>
    </section>
  );
}

export function SectionQuickDeploySimulator() {
  const [symbol, setSymbol] = useState("");
  const [timeRange, setTimeRange] = useState("");
  const [chartAmount, setChartAmount] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (secondsLeft == null) return;
    if (secondsLeft <= 0) return;
    const id = window.setInterval(() => {
      setSecondsLeft((s) => (s == null ? s : Math.max(0, s - 1)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [secondsLeft]);

  const canStart =
    symbol.trim() !== "" &&
    Number.isFinite(Number(timeRange)) &&
    Number.isFinite(Number(chartAmount)) &&
    timeRange.trim() !== "" &&
    chartAmount.trim() !== "";

  const start = () => {
    if (!canStart) return;
    setSecondsLeft(180);
  };

  const mm = secondsLeft == null ? "3" : String(Math.floor(secondsLeft / 60)).padStart(1, "0");
  const ss = secondsLeft == null ? "00" : String(secondsLeft % 60).padStart(2, "0");
  const progress = secondsLeft == null ? 0 : ((180 - secondsLeft) / 180) * 100;
  const isRunning = secondsLeft != null && secondsLeft > 0;
  const isDone = secondsLeft === 0;

  return (
    <section id="section-quick-deploy" className="relative border-t border-white/[0.08] bg-black px-5 py-20 md:px-10 md:py-24 lg:px-14 lg:py-28">
      {isRunning || isDone ? (
        <div className="pointer-events-none fixed bottom-5 right-5 z-[70] w-[min(92vw,420px)] rounded-2xl border border-white/[0.16] bg-black/78 p-5 shadow-[0_24px_80px_-36px_rgba(0,0,0,0.88)] backdrop-blur-md">
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/60">Deployment simulation</p>
          <p className="mt-2 font-mono text-3xl font-semibold text-white">{mm}:{ss}</p>
          <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-white/[0.12]">
            <div
              className="h-full rounded-full bg-white transition-all duration-1000"
              style={{ width: `${progress}%`, boxShadow: "0 0 16px rgba(255,255,255,0.55)" }}
            />
          </div>
        </div>
      ) : null}
      <div className="relative mx-auto max-w-[70rem] overflow-hidden rounded-3xl border border-white/[0.18] bg-white/[0.04] p-7 shadow-[0_34px_110px_-48px_rgba(0,0,0,0.82)] sm:p-10 md:p-12">
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-3xl border border-white/[0.12]" />
        <div aria-hidden className="pointer-events-none absolute -left-14 -top-20 h-72 w-72 rounded-full bg-white/[0.08] blur-[80px]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-white/[0.06] blur-[90px]" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-3xl"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.55) 60deg, transparent 120deg, transparent 360deg)",
            animation: "spin 4.2s linear infinite",
            mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            maskComposite: "exclude",
            WebkitMaskComposite: "xor",
            padding: "1.5px",
          }}
        />
        <h2 className="text-[clamp(2.2rem,5vw,3.8rem)] font-normal tracking-[-0.03em] text-white">
          <span className="font-semibold">Start engineering right on the spot.</span>
        </h2>
        <p className="mt-4 max-w-3xl text-[clamp(1.05rem,1.8vw,1.25rem)] text-white/74">
          Configure the deployment parameters and run a live engineering countdown to initialize your visual AI workflow.
        </p>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Symbol (e.g. NVDA)" className="w-full rounded-xl border border-white/[0.18] bg-black/45 px-5 py-4 text-base text-white outline-none placeholder:text-white/40" />
            <p className="mt-2 text-sm text-white/55">Target stock ticker for the model deployment profile.</p>
          </div>
          <div>
            <input value={timeRange} onChange={(e) => setTimeRange(e.target.value)} placeholder="Timerange (days)" className="w-full rounded-xl border border-white/[0.18] bg-black/45 px-5 py-4 text-base text-white outline-none placeholder:text-white/40" />
            <p className="mt-2 text-sm text-white/55">Historical window length in days for feature extraction.</p>
          </div>
          <div>
            <input value={chartAmount} onChange={(e) => setChartAmount(e.target.value)} placeholder="Chart amount" className="w-full rounded-xl border border-white/[0.18] bg-black/45 px-5 py-4 text-base text-white outline-none placeholder:text-white/40" />
            <p className="mt-2 text-sm text-white/55">Total chart samples allocated to this engineering run.</p>
          </div>
        </div>
        <button type="button" onClick={start} disabled={!canStart} className="mt-7 inline-flex rounded-full border border-white/30 bg-white/[0.1] px-8 py-3.5 text-base font-semibold text-white transition enabled:hover:border-white/45 enabled:hover:bg-white/[0.16] disabled:cursor-not-allowed disabled:opacity-45">
          Deploy visual AI bot
        </button>
        {secondsLeft != null ? (
          <div className="mt-6">
            {isDone ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="font-mono text-2xl text-white">Deployment window complete. Deploy your new bot now.</p>
                <Link to="/dashboard" className="inline-flex rounded-full border border-white/30 bg-white/[0.12] px-5 py-2.5 text-sm font-medium text-white transition hover:border-white/45 hover:bg-white/[0.2]">
                  Deploy your new bot now&nbsp;&rarr;
                </Link>
              </div>
            ) : (
              <p className="font-mono text-[clamp(1.35rem,2.5vw,2rem)] text-white">Calculating... come back in {mm}:{ss} min.</p>
            )}
            <div className="mt-4 h-4 w-full overflow-hidden rounded-full bg-white/[0.12]">
              <div
                className="relative h-full rounded-full bg-white transition-all duration-1000"
                style={{ width: `${progress}%`, boxShadow: "0 0 18px rgba(255,255,255,0.65)" }}
              >
                <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/45 to-transparent" />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function SectionNewsletterSocial({
  kickerNum = "10",
  kickerLabel = "Connect",
  neutralAccent = false,
  showKicker = true,
}: {
  kickerNum?: string;
  kickerLabel?: string;
  neutralAccent?: boolean;
  showKicker?: boolean;
} = {}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSent(true);
  };

  const subscribeBtnClass = neutralAccent ? BTN_NEUTRAL_SOLID : BTN_PREMIUM;
  const inputFocusRing = neutralAccent ? "focus:ring-white/25" : "focus:ring-[#a579e8]/40";

  return (
    <section
      id="section-newsletter"
      className="relative -mt-10 border-t border-white/[0.1] bg-black px-4 py-16 md:-mt-12 md:px-8 md:py-20 lg:px-12 lg:py-24"
    >
      <div className="mx-auto w-full max-w-[min(100%,1180px)] rounded-[28px] border border-white/[0.14] bg-white/[0.04] p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset,0_40px_100px_-48px_rgba(0,0,0,0.8)] backdrop-blur-sm sm:rounded-[32px] sm:p-10 md:p-12 lg:p-14">
        <Home2SectionKicker num={kickerNum} label={kickerLabel} show={showKicker} />
        <div className="mt-4 flex flex-col gap-14 lg:mt-2 lg:flex-row lg:items-start lg:justify-between lg:gap-16">
          <div className="min-w-0 flex-1 text-left">
            <h2 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Stay up to date</h2>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-white/60 md:text-lg">
              Subscribe to our newsletter for product updates and research notes.
            </p>
            {sent ? (
              <p className="mt-8 text-base font-semibold text-white/80">Thanks — we&apos;ll keep you posted.</p>
            ) : (
              <form onSubmit={submit} className="mt-8 flex max-w-xl flex-col gap-4 sm:flex-row sm:items-stretch">
                <label htmlFor="home2-newsletter-email" className="sr-only">
                  Email
                </label>
                <input
                  id="home2-newsletter-email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@domain.com"
                  className={`min-h-[52px] flex-1 rounded-xl border border-white/[0.16] bg-black/40 px-5 text-base text-white placeholder:text-white/35 outline-none ring-offset-0 transition focus:border-white/30 focus:ring-2 ${inputFocusRing}`}
                />
                <button type="submit" className={`${subscribeBtnClass} shrink-0`}>
                  Subscribe
                </button>
              </form>
            )}
          </div>

          <div className="shrink-0 text-left lg:max-w-sm lg:pt-1">
            <h2 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Follow us</h2>
            <p className="mt-3 text-base text-white/60 md:text-lg">LinkedIn and Instagram.</p>
            <div className="mt-8 flex items-center gap-5">
            <a
              href={FOUNDER_INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.16] bg-black/50 text-white/90 transition hover:border-white/28 hover:bg-white/[0.08]"
              aria-label="Instagram"
            >
              <Instagram className="h-6 w-6" strokeWidth={1.75} />
            </a>
            <a
              href={FOUNDER_LINKEDIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.16] bg-black/50 text-white/90 transition hover:border-white/28 hover:bg-white/[0.08]"
              aria-label="LinkedIn"
            >
              <Linkedin className="h-6 w-6" strokeWidth={1.75} />
            </a>
          </div>
        </div>
        </div>
      </div>
    </section>
  );
}
