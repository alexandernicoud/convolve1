import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { motion, useReducedMotion as useFramerReducedMotion } from "framer-motion";
import { HEADER_HEIGHT_PX } from "@/context/HeaderRevealContext";
import dashboardTableCutout from "@/assets/Dashboard Table Cutout.png";
import {
  SectionAdvantagesHub,
  SectionDevelopCta,
  SectionFounderQuote,
  SectionHome2ProofStats,
  SectionNewsletterSocial,
  SectionPipelineScroll,
  SectionPipelineTagline,
  SectionQuickDeploySimulator,
  SectionYouWantIn,
} from "@/pages/VisionHome2Sections";

const LINE1 = "Stop guessing.";
const LINE2_PREFIX = "Trade ";
const LINE2_GRADIENT_WORD = "convolutional";
const LINE2_SUFFIX = ".*";
const LINE2 = `${LINE2_PREFIX}${LINE2_GRADIENT_WORD}${LINE2_SUFFIX}`;

const heroBtnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-full border border-white/30 bg-white/[0.12] px-8 py-4 text-lg font-medium text-white transition duration-300 ease-out hover:border-white/45 hover:bg-white/[0.2] active:scale-[0.98] sm:px-10 sm:py-5 sm:text-xl";
const heroBtnGhost =
  "inline-flex items-center justify-center gap-2 rounded-full border border-white/20 px-8 py-4 text-lg font-medium text-white/95 transition duration-300 hover:border-white/35 hover:bg-white/[0.06] sm:px-10 sm:py-5 sm:text-xl";

const TOTAL_CHARS = LINE1.length + LINE2.length;

const TITLE_DURATION_MS = 1000;
const CHAR_MS = Math.max(28, Math.round(TITLE_DURATION_MS / TOTAL_CHARS));
const heroTitleDoneSec = TITLE_DURATION_MS / 1000;

const FULL_LABEL = `${LINE1} ${LINE2}`;

function HeroAtmosphere() {
  return (
    <div
      className="pointer-events-none absolute bottom-0 left-0 right-0 z-0 overflow-hidden bg-black opacity-100"
      style={{ top: -HEADER_HEIGHT_PX }}
      aria-hidden
    />
  );
}

function Home2HeroTitle() {
  const [visibleCount, setVisibleCount] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setVisibleCount(TOTAL_CHARS);
      return;
    }
    setVisibleCount(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setVisibleCount(i);
      if (i >= TOTAL_CHARS) window.clearInterval(id);
    }, CHAR_MS);
    return () => window.clearInterval(id);
  }, [reducedMotion]);

  const line1Shown = Math.min(visibleCount, LINE1.length);
  const line2Shown = Math.max(0, visibleCount - LINE1.length);

  return (
    <h1
      aria-label={FULL_LABEL}
      className="relative z-[9999] max-w-full text-balance text-[clamp(34px,min(10.5vw),86px)] font-normal leading-[1.04] tracking-[-0.03em] text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)] sm:text-[clamp(42px,min(9.6vw),86px)]"
    >
      <span className="block">
        {Array.from({ length: line1Shown }, (_, i) => (
          <span key={i} className="font-normal text-white">
            {LINE1[i] === " " ? "\u00A0" : LINE1[i]}
          </span>
        ))}
      </span>
      <span className="mt-2 block md:mt-1">
        {Array.from({ length: line2Shown }, (_, j) => {
          const i = LINE1.length + j;
          return (
            <span key={i} className="font-normal text-white">
              {LINE2[j] === " " ? "\u00A0" : LINE2[j]}
            </span>
          );
        })}
      </span>
    </h1>
  );
}

function ScienceSection({ heroReducedMotion }: { heroReducedMotion: boolean | null }) {
  const rm = !!heroReducedMotion;
  const trackRef = useRef<HTMLElement>(null);
  const LINES = [
    "Forget falling wedges and FVGs.",
    "Visual AI can abstract way more complex structures than you could ever identify.",
    "Convolve doesnt only offer this tech - it makes you the engineer.",
  ] as const;
  const [lineIdx, setLineIdx] = useState(0);
  const line = LINES[lineIdx];

  useEffect(() => {
    if (rm) {
      setLineIdx(0);
      return;
    }
    const onScroll = () => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = el.offsetHeight - window.innerHeight;
      if (total <= 0) {
        setLineIdx(0);
        return;
      }
      const progress = Math.min(1, Math.max(0, -rect.top / total));
      if (progress < 0.33) {
        setLineIdx(0);
      } else if (progress < 0.66) {
        setLineIdx(1);
      } else {
        setLineIdx(2);
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [rm]);

  return (
    <section
      id="section-science"
      ref={trackRef}
      className="relative isolate z-[2] flex w-full flex-col overflow-x-clip border-t border-white/[0.1] bg-black"
      style={{ height: rm ? undefined : "220vh" }}
    >
        <div className="sticky top-0 relative z-[2] flex h-[100dvh] w-full flex-col">
          <div className="relative z-[9999] flex min-h-0 flex-1 flex-col items-center justify-center px-5 pb-20 pt-16 text-center md:px-10 md:pb-24 md:pt-20 lg:px-14 lg:pb-28 lg:pt-24">
          <motion.div
            className="relative z-[9999] w-full max-w-[min(100%,1200px)] text-center"
            initial={rm ? { opacity: 1, y: 0 } : { opacity: 1, y: 0 }}
          >
            <motion.div
              key={LINES[lineIdx]}
              className="text-center text-[clamp(2rem,6vw,5rem)] font-normal leading-[1.06] tracking-[-0.03em] text-white"
              initial={rm ? { opacity: 1, x: 0 } : { opacity: 0, x: 90 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: rm ? 0 : 0.52, ease: [0.16, 1, 0.3, 1] }}
              aria-live="polite"
            >
              {Array.from(line).map((ch, i) => (
                <motion.span
                  key={`${lineIdx}-${i}`}
                  initial={rm ? { opacity: 1 } : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: rm ? 0 : 0.18, delay: rm ? 0 : 0.2 + i * 0.012 }}
                >
                  {ch}
                </motion.span>
              ))}
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

export default function VisionHome2() {
  const navigate = useNavigate();
  const heroReducedMotion = useFramerReducedMotion();

  useEffect(() => {
    document.body.classList.add("vision-landing-scroll");
    return () => document.body.classList.remove("vision-landing-scroll");
  }, []);

  const scrollToScience = (e?: MouseEvent<HTMLElement>) => {
    e?.preventDefault();
    document.getElementById("section-science")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const goHomePipeline = (e?: MouseEvent<HTMLElement>) => {
    e?.preventDefault();
    navigate("/");
    window.setTimeout(() => {
      document.getElementById("section-01")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  };

  return (
    <main
      lang="en"
      className="vision-page relative min-h-screen bg-black font-sans font-normal text-white antialiased"
    >
      <div
        aria-hidden
        className="pointer-events-none fixed left-1/2 top-1/2 z-[1] h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/12 blur-[165px] animate-drift"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed left-1/2 top-1/2 z-[1] h-[320px] w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/15 blur-[110px] animate-float"
      />
      <section
        id="hero-home2"
        className="relative isolate z-[2] flex min-h-[100dvh] w-full flex-col overflow-x-clip bg-black lg:flex-row"
      >
        <HeroAtmosphere />

        <div className="relative z-[2] flex min-h-[100dvh] w-full flex-1 flex-col lg:flex-row">
          <div className="relative z-[9999] flex min-h-0 flex-1 flex-col justify-center px-5 pb-28 pt-[max(5rem,env(safe-area-inset-top,0px)+4.5rem)] md:px-10 md:pb-32 md:pt-24 lg:max-w-[min(100%,52%)] lg:px-14 lg:pb-40 lg:pt-28">
            <div className="relative z-[9999] w-full max-w-[min(100%,600px)]">
              <header className="min-w-0">
                <Home2HeroTitle />
              </header>
              <motion.p
                className="relative z-[9999] mt-4 block w-full max-w-[600px] text-left text-base font-normal leading-snug text-white sm:text-lg lg:text-[23px] [font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif]"
                initial={heroReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: heroReducedMotion ? 0 : heroTitleDoneSec + 0.06,
                  duration: heroReducedMotion ? 0 : 0.52,
                  ease: [0.16, 1, 0.3, 1],
                }}
              >
                Develop your own visual AI-based trading bot using convolve&apos;s unique no-code, end-to-end
                pipeline. Train, backtest and deploy - all within a few clicks.
              </motion.p>
              <motion.div
                className="relative z-[9999] mt-[46px] flex flex-wrap items-center gap-3 sm:gap-4"
                initial={heroReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: heroReducedMotion ? 0 : heroTitleDoneSec + 0.22,
                  duration: heroReducedMotion ? 0 : 0.48,
                  ease: [0.16, 1, 0.3, 1],
                }}
              >
                <Link to="/dashboard" className={heroBtnPrimary}>
                  Get early access&nbsp;&rarr;
                </Link>
                <button type="button" onClick={goHomePipeline} className={heroBtnGhost}>
                  How it works
                </button>
              </motion.div>
            </div>
          </div>

          <div className="relative z-[10] flex min-h-[min(52dvh,480px)] flex-1 flex-col items-end justify-end px-5 pb-20 pt-4 md:px-10 lg:min-h-[100dvh] lg:pr-4 lg:pb-20">
            <img
              src={dashboardTableCutout}
              alt="Convolve dashboard table"
              className="h-[770px] w-[min(1379px,calc(100vw-2.5rem))] max-w-none shrink-0 object-contain object-right-bottom drop-shadow-[0_38px_110px_-36px_rgba(0,0,0,0.86)] lg:w-[1379px] lg:-translate-x-[280px] lg:-translate-y-[30px]"
              loading="eager"
              decoding="async"
            />
          </div>

          <motion.div
            className="pointer-events-none absolute bottom-20 left-0 right-0 z-40 flex min-h-[44px] items-center justify-center px-5 md:bottom-24 lg:bottom-28"
            initial={heroReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: heroReducedMotion ? 0 : heroTitleDoneSec + 0.32,
              duration: heroReducedMotion ? 0 : 0.45,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            <button
              type="button"
              onClick={scrollToScience}
              className="vision-chevron-hop pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/[0.06] text-white transition duration-500 ease-out hover:border-white/35 hover:bg-white/[0.1] active:scale-95"
              aria-label="Scroll to next section"
            >
              <ChevronDown className="h-5 w-5" strokeWidth={2} />
            </button>
          </motion.div>
        </div>
      </section>

      <ScienceSection heroReducedMotion={heroReducedMotion} />

      <SectionPipelineScroll showKicker={false} />
      <SectionQuickDeploySimulator />
      <SectionAdvantagesHub heroReducedMotion={heroReducedMotion} showKicker={false} disableGlow />
      <SectionDevelopCta heroReducedMotion={heroReducedMotion} showMockup={false} compactBanner showKicker={false} />
      <SectionHome2ProofStats showKicker={false} />
      <SectionFounderQuote showKicker={false} />
      <SectionPipelineTagline showKicker={false} neutralBackdrop withCta />
      <SectionYouWantIn />
      <SectionNewsletterSocial showKicker={false} neutralAccent />
    </main>
  );
}
