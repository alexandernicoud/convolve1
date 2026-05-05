import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { motion, type Variants } from "framer-motion";
import type { ToolModule as ToolModuleData } from "./toolModules";

type ToolModuleProps = {
  module: ToolModuleData;
  /** Visual rhythm: even rows get a very subtle tint so modules don't read as a mechanical list. */
  index: number;
  /** Hide the bottom rule on the last module so the stack closes cleanly. */
  isLast?: boolean;
};

const EASE = [0.16, 1, 0.3, 1] as const;

const containerVariants: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.75,
      ease: EASE,
      when: "beforeChildren",
      staggerChildren: 0.08,
      delayChildren: 0.05,
    },
  },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

const bulletItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
};

const bulletList: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

export default function ToolModule({ module, index, isLast }: ToolModuleProps) {
  const { id, number, title, thesis, bullets, paragraph, ctaLabel, ctaHref } = module;
  const tintedRow = index % 2 === 1;

  return (
    <motion.article
      id={id}
      variants={containerVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.2, margin: "0px 0px -80px 0px" }}
      className={[
        "group/module relative scroll-mt-[calc(5rem+12px)] py-12 transition-colors duration-500 sm:scroll-mt-24 sm:py-14 lg:py-16",
        !isLast ? "border-b border-white/[0.06]" : "",
        "hover:bg-white/[0.015]",
        tintedRow ? "lg:bg-white/[0.008]" : "",
      ].join(" ")}
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_minmax(0,1fr)_300px] lg:gap-12">
        {/* Left anchor column — step chip sits on the continuous connector line */}
        <div className="relative flex flex-row items-center gap-4 lg:flex-col lg:items-start lg:gap-5">
          <motion.div
            variants={fadeUp}
            className="relative z-[1] flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-[#050505] text-white/85 transition-colors duration-300 group-hover/module:border-white/35 lg:ml-[8px] lg:h-12 lg:w-12"
          >
            <span className="text-[11px] font-semibold tracking-[0.14em] lg:text-xs">{number}</span>
            <span
              aria-hidden
              className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-white/70 transition-opacity duration-300 group-hover/module:opacity-100 lg:opacity-60"
            />
          </motion.div>
          <motion.div variants={fadeUp} className="flex min-w-0 flex-col gap-1.5">
            <p className="hidden text-[10px] font-medium uppercase tracking-[0.22em] text-white/40 lg:block">
              Module {number}
            </p>
            <h3 className="text-lg font-medium tracking-tight text-white sm:text-xl">{title}</h3>
          </motion.div>
        </div>

        {/* Right content column */}
        <div className="flex min-w-0 flex-col gap-7">
          {/* Thesis + CTA sit on the same row so the CTA anchors with the strong summary */}
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
            <motion.p
              variants={fadeUp}
              className="max-w-2xl text-pretty text-[clamp(1.02rem,1.55vw,1.2rem)] font-light leading-snug tracking-[-0.005em] text-white"
            >
              {thesis}
            </motion.p>
            <motion.div variants={fadeUp} className="shrink-0 self-start sm:pt-1">
              <Link
                to={ctaHref}
                aria-label={`${ctaLabel} — ${title}`}
                className="group/cta inline-flex items-center gap-2 rounded-full border border-white/20 bg-transparent px-4 py-2 text-[13px] font-medium text-white/90 transition-all duration-300 hover:-translate-y-[1px] hover:border-white/40 hover:bg-white/[0.05] hover:text-white sm:px-5"
              >
                <span className="relative">
                  {ctaLabel}
                  <span
                    aria-hidden
                    className="absolute inset-x-0 -bottom-0.5 h-px origin-left scale-x-0 bg-white/70 transition-transform duration-300 group-hover/cta:scale-x-100"
                  />
                </span>
                <ArrowRight
                  className="h-3.5 w-3.5 transition-transform duration-300 group-hover/cta:translate-x-1"
                  strokeWidth={2}
                />
              </Link>
            </motion.div>
          </div>

          {/* Bullets — three compact columns with thin left rules read as system sub-modules */}
          <motion.ul
            variants={bulletList}
            className="grid grid-cols-1 gap-4 border-t border-white/[0.05] pt-6 sm:grid-cols-3 sm:gap-6"
          >
            {bullets.map((bullet, i) => (
              <motion.li
                key={`${id}-bullet-${i}`}
                variants={bulletItem}
                className="relative border-l border-white/[0.08] pl-4 transition-colors duration-300 group-hover/module:border-white/20"
              >
                <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="mt-1.5 block text-[13.5px] leading-[1.55] text-white/85 sm:text-sm">
                  {bullet}
                </span>
              </motion.li>
            ))}
          </motion.ul>

          {/* Long-form paragraph, muted — preserves the depth of the source copy */}
          <motion.div variants={fadeUp} className="max-w-3xl">
            {paragraph.split(/\n\n+/).map((block, i) => (
              <p
                key={`${id}-p-${i}`}
                className="vision-print-adjust vision-print-adjust--justify text-pretty text-sm leading-[1.75] text-white/55 sm:text-[0.925rem] sm:leading-[1.72] [&+p]:mt-4"
              >
                {block.trim()}
              </p>
            ))}
          </motion.div>
        </div>

        {/* Right preview column — neutral placeholder tile; replace with real previews later */}
        <motion.div variants={fadeUp} className="min-w-0 lg:self-start lg:pt-1">
          <ToolPreviewPlaceholder number={number} title={title} />
        </motion.div>
      </div>
    </motion.article>
  );
}

/**
 * Intentional-looking placeholder tile (subtle grid + radial highlight + labels).
 * Premium-neutral by design so swapping in real screenshots later changes nothing structurally.
 */
function ToolPreviewPlaceholder({ number, title }: { number: string; title: string }) {
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-white/[0.07] bg-[#070707] transition-colors duration-500 group-hover/module:border-white/20">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 0%, rgba(255,255,255,0.055) 0%, transparent 62%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.55), transparent 70%)",
        }}
      />

      <div className="absolute left-3 top-3 flex items-center gap-1.5">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white/55" />
        <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/45">
          Preview
        </span>
      </div>
      <div className="absolute right-3 top-3">
        <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/30">
          {number}
        </span>
      </div>

      <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium text-white/70">{title}</p>
          <p className="mt-0.5 text-[9px] uppercase tracking-[0.2em] text-white/30">
            Image placeholder
          </p>
        </div>
        <span
          aria-hidden
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-white/40"
        >
          IMG
        </span>
      </div>
    </div>
  );
}
