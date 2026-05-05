import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { TOOL_MODULES } from "@/components/products/toolModules";
import ToolModule from "@/components/products/ToolModule";
import producthubImg from "@/assets/producthub_img.png";

function CommunityEasterEgg() {
  return (
    <div className="rounded-xl border border-white/15 bg-black/70 px-3 py-2 shadow-lg backdrop-blur-md sm:px-3.5 sm:py-2.5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">Community</p>
      <p className="mt-1 text-xs font-medium leading-snug text-white/85">Coming soon</p>
    </div>
  );
}

export default function ProductsHub() {
  /**
   * Hero → "How each tool fits" transition — mirrors the Vision hero → section 01 dissolve:
   *  · hero is `sticky top-0` and fades/blurs as the next section approaches the viewport top
   *  · the next section sits on a higher z-index with a solid background so it scrolls *over* the hero
   */
  const [heroBlurPx, setHeroBlurPx] = useState(0);
  const [heroAtmosphereOpacity, setHeroAtmosphereOpacity] = useState(1);
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    prefersReducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    const update = () => {
      const target = document.getElementById("how-each-tool-fits");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      /** 0 = section below fold; 1 = section top aligned with viewport top / past */
      const t = Math.min(1, Math.max(0, 1 - rect.top / vh));

      if (prefersReducedMotion.current) {
        setHeroBlurPx(0);
        setHeroAtmosphereOpacity(t >= 1 ? 0 : 1);
        return;
      }

      setHeroAtmosphereOpacity(Math.max(0, 1 - t));
      const p = Math.pow(t, 2.15) * 0.85;
      setHeroBlurPx(14 * p);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div className="relative z-[1] flex w-full flex-1 flex-col bg-[#000000] text-white antialiased">
      {/* Hero: sticky so the next section dissolves in on top of it (mirrors Vision hero → 01) */}
      <section className="sticky top-0 z-[2] w-full border-b border-white/[0.07] bg-[#000000]">
        <div
          className="relative mx-auto flex min-h-[630px] w-full max-w-[1536px] flex-col px-5 pb-10 pt-10 sm:px-8 md:min-h-[710px] md:pb-12 md:pt-14 lg:px-10 lg:min-h-[790px] xl:min-h-[870px]"
          style={heroBlurPx > 0.25 ? { filter: `blur(${heroBlurPx}px)`, willChange: "filter" } : undefined}
        >
          <img
            src={producthubImg}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 top-[150px] z-0 w-full object-contain object-top"
            style={{ opacity: heroAtmosphereOpacity }}
            loading="eager"
            decoding="async"
          />

          <div className="absolute right-5 top-4 z-20 sm:right-8 md:top-6 lg:right-10">
            <CommunityEasterEgg />
          </div>

          <header className="relative z-10 w-full text-center">
            <div className="mx-auto max-w-6xl">
              <p className="marketing-section-label">Products</p>
              <h1 className="mx-auto mt-5 max-w-3xl text-balance text-[clamp(1.75rem,4.5vw,2.75rem)] font-extralight leading-[1.1] tracking-[-0.03em] text-white">
                One pipeline. Every stage.
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-pretty text-sm leading-relaxed text-white/70 sm:text-base">
                From data to training, analysis, testing, optimization, and deployment — then{" "}
                <span className="text-white/90">the dashboard</span>, the seventh layer that unifies bots, runs, and
                history into one operational surface. Pick a step or follow the stack in order; everything converges there.
              </p>
            </div>
          </header>

          <div className="relative z-10 mt-auto flex flex-col items-center justify-center gap-3 pt-8 sm:flex-row sm:gap-4">
            <Link
              to="/tools/trainer"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-medium text-[#0a0a0a] transition hover:bg-white/90 active:scale-[0.98] sm:px-10 sm:text-base"
            >
              Start developing
              <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2} />
            </Link>
            <a
              href="#how-each-tool-fits"
              className="inline-flex items-center justify-center rounded-full border border-white/25 bg-transparent px-8 py-3.5 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/[0.06] sm:px-10 sm:text-base"
            >
              Learn more
            </a>
          </div>
        </div>
      </section>

      {/* Next section sits above the sticky hero on z-[12] and carries its own solid bg so the dissolve reads cleanly */}
      <section
        id="how-each-tool-fits"
        aria-labelledby="tools-deep-dive-heading"
        className="relative z-[12] scroll-mt-[calc(5rem+12px)] bg-[#000000] sm:scroll-mt-24"
      >
        <div className="mx-auto w-full max-w-[1400px] px-5 pb-24 pt-14 sm:px-8 sm:pb-28 sm:pt-20 lg:px-10 lg:pt-24">
          {/* Section header — centered: eyebrow w/ flanking rules, title, constrained intro */}
          <motion.header
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center gap-5 border-b border-white/[0.06] pb-10 text-center sm:pb-12"
          >
            <div className="flex items-center justify-center gap-3">
              <span aria-hidden className="h-px w-8 bg-white/30" />
              <p className="marketing-section-label">Product stack</p>
              <span aria-hidden className="h-px w-8 bg-white/30" />
            </div>
            <h2
              id="tools-deep-dive-heading"
              className="mx-auto max-w-4xl text-[clamp(1.65rem,4vw,2.35rem)] font-extralight leading-[1.08] tracking-[-0.025em] text-white"
            >
              How each tool fits
            </h2>
            <p className="vision-print-adjust mx-auto max-w-[62ch] text-sm leading-relaxed text-white/60 sm:text-[0.95rem] sm:leading-[1.65]">
              Seven modules, one pipeline. Each stage below explains why it exists, what makes it different inside
              Convolve, what it produces, and how you operate it day to day — with the dashboard as the layer that ties
              the stack together.
            </p>
          </motion.header>

          {/* Modules — continuous vertical connector line runs along the left column on desktop */}
          <div className="relative mt-4 sm:mt-6">
            <motion.span
              aria-hidden
              initial={{ scaleY: 0 }}
              whileInView={{ scaleY: 1 }}
              viewport={{ once: true, amount: 0.05 }}
              transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
              style={{ transformOrigin: "top" }}
              className="pointer-events-none absolute bottom-0 left-[32px] top-0 hidden w-px bg-gradient-to-b from-white/0 via-white/12 to-white/0 lg:block"
            />
            {TOOL_MODULES.map((mod, i) => (
              <ToolModule
                key={mod.id}
                module={mod}
                index={i}
                isLast={i === TOOL_MODULES.length - 1}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
