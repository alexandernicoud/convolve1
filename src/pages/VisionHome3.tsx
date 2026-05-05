import { useEffect, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { HEADER_HEIGHT_PX } from "@/context/HeaderRevealContext";
import logoMark from "@/assets/convolve-mark.png";
import macbookCutoutImg from "@/assets/macbook_cutout_transparent.png";
import { Home2GlowMockup } from "@/pages/VisionHome2Mockup";
import {
  Home2SectionKicker,
  SectionAdvantagesHub,
  SectionDevelopCta,
  SectionFounderQuote,
  SectionHome2ProofStats,
  SectionNewsletterSocial,
  SectionPipelineScroll,
  SectionPipelineTagline,
  SectionSoftwarePortraitHome2,
} from "@/pages/VisionHome2Sections";

const heroBtnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white px-8 py-4 text-lg font-semibold text-[#0a0a0a] transition duration-300 ease-out hover:bg-white/90 active:scale-[0.98] sm:px-10 sm:py-5 sm:text-xl";

function Home3ScienceSection({ reducedMotion }: { reducedMotion: boolean | null }) {
  const rm = !!reducedMotion;
  return (
    <section
      id="section-science"
      className="relative isolate z-[2] flex min-h-[100dvh] w-full flex-col overflow-x-clip border-t border-white/[0.1] bg-[#07090a] lg:flex-row"
    >
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 65% 45% at 20% 48%, rgba(255,255,255,0.06) 0%, transparent 52%), linear-gradient(145deg, rgba(22,26,28,0.45) 0%, transparent 52%, rgba(12,14,18,0.62) 100%)",
        }}
        aria-hidden
      />

      <div className="relative z-[2] flex min-h-[100dvh] w-full flex-1 flex-col lg:flex-row">
        <div className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(90deg,rgba(255,255,255,0.03)_0%,transparent_38%,transparent_62%,rgba(255,255,255,0.03)_100%)]" aria-hidden />

        <div className="relative z-[9999] flex min-h-0 flex-1 flex-col justify-center px-5 pb-16 pt-14 md:px-10 md:pb-24 md:pt-20 lg:max-w-[min(100%,50%)] lg:px-14 lg:pb-40 lg:pt-28">
          <motion.div
            className="relative z-[9999] w-full max-w-[min(100%,620px)]"
            initial={rm ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.35 }}
            transition={{ duration: rm ? 0 : 0.55, ease: [0.16, 1, 0.3, 1] }}
          >
            <Home2SectionKicker num="02" label="Approach" />
            <h2 className="mt-2 text-balance text-[clamp(1.75rem,4.8vw,2.85rem)] font-bold leading-[1.12] tracking-[-0.035em] text-white">
              High-end visual AI for systematic trading.
            </h2>
            <p className="mt-7 text-[clamp(1.05rem,2.4vw,1.35rem)] font-medium leading-relaxed text-white/80 sm:text-xl md:text-[1.28rem] md:leading-[1.5]">
              Build your own model architecture around chart context, train over historical depth, and deploy with
              full-stack workflow controls in one premium workspace.
            </p>
            <motion.div
              className="mt-11"
              initial={rm ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: rm ? 0 : 0.48, delay: rm ? 0 : 0.12, ease: [0.16, 1, 0.3, 1] }}
            >
              <Link to="/contact" className={heroBtnPrimary}>
                Get started&nbsp;&rarr;
              </Link>
            </motion.div>
          </motion.div>
        </div>

        <div className="relative z-[10] flex min-h-[min(44dvh,420px)] flex-1 flex-col items-center justify-center px-5 pb-10 pt-6 md:pb-12 md:pt-8 lg:min-h-[100dvh] lg:items-center lg:justify-center lg:pr-10 lg:pb-36 lg:pt-8">
          <Home2GlowMockup heroReducedMotion={rm} glowPlacement="science" />
        </div>
      </div>
    </section>
  );
}

export default function VisionHome3() {
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    document.body.classList.add("vision-landing-scroll");
    return () => document.body.classList.remove("vision-landing-scroll");
  }, []);

  const scrollToScience = (e?: MouseEvent<HTMLElement>) => {
    e?.preventDefault();
    document.getElementById("section-science")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main lang="en" className="vision-page relative min-h-screen bg-black font-sans text-white antialiased">
      <section
        id="hero-home3"
        className="relative flex w-full items-center justify-center overflow-hidden bg-black"
        style={{ minHeight: `calc(100dvh - ${HEADER_HEIGHT_PX}px)` }}
        aria-label="Convolve landing — Home 3"
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(ellipse 55% 40% at 50% 42%, rgba(255,255,255,0.05) 0%, transparent 60%)",
          }}
          aria-hidden
        />

        <motion.div
          className="relative z-[1] flex w-full max-w-[min(100%,1040px)] flex-col items-center gap-5 px-6 md:gap-7"
          initial={reducedMotion ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.86, ease: [0.22, 1, 0.36, 1] }}
        >
          <img
            src={logoMark}
            alt="Convolve"
            className="h-auto w-[min(34vw,182px)] select-none"
            style={{ filter: "drop-shadow(0 0 24px rgba(255,255,255,0.08))" }}
            draggable={false}
          />
          <img
            src={macbookCutoutImg}
            alt=""
            className="h-auto w-[min(92vw,960px)] max-w-full object-contain"
            loading="eager"
            decoding="async"
          />
        </motion.div>

        <button
          type="button"
          onClick={scrollToScience}
          className="vision-chevron-hop absolute bottom-[32%] left-1/2 z-[2] flex -translate-x-1/2 flex-col items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.24em] text-white/45 transition-colors hover:text-white/85"
          aria-label="Scroll to sections"
        >
          <span>scroll</span>
          <ChevronDown className="h-3.5 w-3.5 animate-bounce" aria-hidden />
        </button>

        <motion.h1
          className="pointer-events-none absolute bottom-5 left-5 z-[2] font-extralight leading-[0.92] tracking-[-0.05em] text-white md:bottom-10 md:left-10"
          style={{ fontSize: "clamp(56px, 11vw, 168px)" }}
          initial={reducedMotion ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.8, delay: reducedMotion ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          convolve<span className="text-white/55">.</span>
        </motion.h1>
      </section>

      <div className="[filter:saturate(0.22)_contrast(1.04)]">
        <Home3ScienceSection reducedMotion={reducedMotion} />
        <SectionPipelineScroll />
        <SectionSoftwarePortraitHome2 />
        <SectionAdvantagesHub heroReducedMotion={reducedMotion} />
        <SectionHome2ProofStats />
        <SectionDevelopCta heroReducedMotion={reducedMotion} />
        <SectionFounderQuote />
        <SectionPipelineTagline />
        <SectionNewsletterSocial />
      </div>
    </main>
  );
}
