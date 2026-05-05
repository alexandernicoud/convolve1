import { ChevronDown } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { FOUNDER_LINKEDIN_URL as LINKEDIN } from "@/lib/founderLinks";
import logoMark from "@/assets/convolve-mark.png";
import { HEADER_HEIGHT_PX } from "@/context/HeaderRevealContext";

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
};

const bodyLg = "text-[clamp(1.05rem,2.1vw,1.35rem)] leading-[1.5] text-white/75";
const bodyMd = "text-[clamp(1rem,1.85vw,1.15rem)] leading-[1.55] text-white/70";
const sectionPad = "py-24 md:py-32 lg:py-40";
const borderSep = "border-t border-white/[0.06]";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Landing hero                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

function AboutHero() {
  const reducedMotion = useReducedMotion();

  return (
    <section
      id="about-hero"
      className="relative flex w-full items-center justify-center overflow-hidden bg-black"
      style={{ minHeight: `calc(100dvh - ${HEADER_HEIGHT_PX}px)` }}
      aria-label="About — landing"
    >
      {/* soft radial wash to ground the logo */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 55% 40% at 50% 42%, rgba(255,255,255,0.05) 0%, transparent 60%)",
        }}
        aria-hidden
      />

      {/* Centered logo */}
      <motion.img
        src={logoMark}
        alt="Convolve"
        className="relative z-[1] select-none"
        style={{
          width: "min(56vw, 360px)",
          height: "auto",
          filter: "drop-shadow(0 0 24px rgba(255,255,255,0.08))",
        }}
        draggable={false}
        initial={reducedMotion ? false : { opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />

      {/* Scroll hint — lifted well above the fold */}
      <a
        href="#about-founder"
        className="absolute bottom-[34%] left-1/2 z-[2] flex -translate-x-1/2 flex-col items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.24em] text-white/45 transition-colors hover:text-white/85"
        aria-label="Scroll to about content"
      >
        <span>scroll</span>
        <ChevronDown className="h-3.5 w-3.5 animate-bounce" aria-hidden />
      </a>

      {/* Bottom-left "about." — large but bounded to stay fully visible */}
      <motion.h1
        className="pointer-events-none absolute bottom-5 left-5 z-[2] font-extralight leading-[0.92] tracking-[-0.05em] text-white md:bottom-10 md:left-10"
        style={{ fontSize: "clamp(56px, 11vw, 168px)" }}
        initial={reducedMotion ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        about<span className="text-white/55">.</span>
      </motion.h1>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Content                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

function SectionEyebrow({ num, label }: { num: string; label: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.26em] text-white/45">
        {num}
      </span>
      <span aria-hidden className="h-px w-10 bg-white/[0.15]" />
      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/55">
        {label}
      </p>
    </div>
  );
}

export default function Founders() {
  return (
    <div className="min-h-screen bg-black font-sans text-white antialiased">
      <AboutHero />

      {/* ───────── §01 — Founder ───────── */}
      <section id="about-founder" className={`${sectionPad} ${borderSep}`}>
        <div className="container-aligned mx-auto max-w-[92rem] px-5 md:px-10 lg:px-14">
          <motion.div {...fadeUp}>
            <SectionEyebrow num="01" label="Founder" />

            <div className="mt-10 grid gap-14 md:mt-14 md:grid-cols-12 md:gap-12 lg:gap-20">
              {/* Headline — spans the generous left */}
              <h2 className="text-[clamp(2.4rem,6vw,5rem)] font-extralight leading-[1.02] tracking-[-0.035em] text-white md:col-span-7">
                Built by a
                <br />
                technical
                <br />
                <span className="text-white/55">founder.</span>
              </h2>

              {/* Prose + meta */}
              <div className="flex flex-col gap-10 md:col-span-5">
                <div className="space-y-6">
                  <p className={bodyLg}>
                    Convolve is built by{" "}
                    <span className="text-white">Alexander Nicoud</span>, a 19-year-old Swiss
                    student in applied mathematics.
                  </p>
                  <p className={bodyMd}>
                    The focus is not on ideas, but on building and testing full systems — from
                    visual learning to backtesting and deployment.
                  </p>
                </div>

                {/* Minimal meta row — single line, no boxes */}
                <div className="flex flex-col gap-3 border-t border-white/[0.07] pt-6">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[12px] uppercase tracking-[0.16em] text-white/55">
                    <span className="text-white/85">Alexander Nicoud</span>
                    <span className="text-white/25">·</span>
                    <span>19</span>
                    <span className="text-white/25">·</span>
                    <span>Switzerland</span>
                    <span className="text-white/25">·</span>
                    <span>Applied Mathematics</span>
                  </div>
                  <a
                    href={LINKEDIN}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-white/85 underline-offset-4 transition hover:text-white hover:underline"
                  >
                    LinkedIn
                    <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                      →
                    </span>
                  </a>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ───────── §02 — Vision ───────── */}
      <section className={`${sectionPad} ${borderSep} pb-32 md:pb-40`}>
        <div className="container-aligned mx-auto max-w-[92rem] px-5 md:px-10 lg:px-14">
          <motion.div {...fadeUp}>
            <SectionEyebrow num="02" label="Vision" />

            <div className="mt-10 grid gap-14 md:mt-14 md:grid-cols-12 md:gap-12 lg:gap-20">
              {/* Headline */}
              <h2 className="text-[clamp(2rem,5vw,4.25rem)] font-extralight leading-[1.05] tracking-[-0.03em] text-white md:col-span-7">
                Access to advanced
                <br />
                trading systems
                <br />
                <span className="text-white/55">shouldn&apos;t be limited.</span>
              </h2>

              {/* Prose */}
              <div className="flex flex-col gap-8 md:col-span-5">
                <p className={bodyLg}>
                  Most traders either rely on static indicators or blindly follow external
                  signals. Very few can build and test their own systems.
                </p>
                <p className={bodyMd}>Convolve is built to change that.</p>
              </div>
            </div>

            {/* Two-pillar breakdown — full width, no boxes, just a thin divider */}
            <div className="mt-20 grid gap-12 border-t border-white/[0.07] pt-12 md:grid-cols-2 md:gap-16 md:divide-x md:divide-white/[0.07] lg:gap-24">
              <div className="md:pr-12 lg:pr-20">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
                  Visual AI
                </h3>
                <p className="mt-4 text-[clamp(1.05rem,1.9vw,1.2rem)] leading-[1.5] text-white/80">
                  Instead of only using indicators, models are trained directly on chart
                  structure — learning patterns too subtle or complex to encode manually.
                </p>
              </div>
              <div className="md:pl-12 lg:pl-20">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
                  User control
                </h3>
                <p className="mt-4 text-[clamp(1.05rem,1.9vw,1.2rem)] leading-[1.5] text-white/80">
                  The system does not tell you what to do. It allows you to test, evaluate, and
                  decide yourself — with full transparency at every stage.
                </p>
              </div>
            </div>

            <p className="mt-20 max-w-3xl text-[clamp(1.25rem,2.6vw,1.75rem)] font-extralight leading-[1.25] tracking-[-0.01em] text-white">
              Not blind automation.
              <br />
              <span className="text-white/55">Structured decision support.</span>
            </p>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
