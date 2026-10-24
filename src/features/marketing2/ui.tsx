import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import logoMark from "@/assets/convolve-mark.png";
import { LEGAL_LINKS, OPERATOR } from "@/features/legal/meta";
import { PROVENANCE, type Provenance } from "./data";

export const EASE = [0.16, 1, 0.3, 1] as const;

export const INK = {
  bg: "#050506",
  panel: "#0a0b0d",
  line: "rgba(255,255,255,0.08)",
  lineStrong: "rgba(255,255,255,0.16)",
  text: "#f4f5f7",
  dim: "rgba(244,245,247,0.56)",
  faint: "rgba(244,245,247,0.32)",
  ice: "#b9d3ff",
  iceDim: "rgba(185,211,255,0.35)",
  alert: "#d98b84",
};

/**
 * Public-site type scale. Home and Products use `h2`; About keeps its lighter editorial weight with
 * `h2Editorial`/`h3Editorial`. Labels go through `Kicker`.
 */
export const TYPE = {
  h2: "text-[clamp(1.9rem,2.7vw,3rem)] font-normal leading-[1.08] tracking-[-0.032em] text-white",
  h2Editorial: "text-[clamp(2rem,3.6vw,3.3rem)] font-extralight leading-[1.06] tracking-[-0.04em] text-white",
  h3Editorial: "text-[clamp(1.6rem,2.4vw,2.3rem)] font-extralight leading-[1.1] tracking-[-0.04em] text-white",
  h3Card: "text-[24px] font-normal leading-[1.15] tracking-[-0.025em] text-white",
  intro: "text-[17px] leading-relaxed text-white/55",
  body: "text-[16.5px] leading-[1.65] text-white/60",
  small: "text-[15.5px] leading-[1.6] text-white/55",
} as const;

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1560px] px-5 sm:px-8 lg:px-14 2xl:max-w-[1720px] 2xl:px-20", className)}>{children}</div>;
}

export function Kicker({ index, children, className }: { index?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em] text-white/45", className)}>
      {index ? <span className="text-white/80">{index}</span> : null}
      {index ? <span className="h-px w-6 bg-white/25" aria-hidden /> : null}
      <span>{children}</span>
    </div>
  );
}

export function Reveal({
  children,
  className,
  delay = 0,
  y = 22,
  as = "div",
  amount,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: "div" | "section" | "li";
  /** Share of the element that must be visible before it reveals; default triggers as its top edge enters. */
  amount?: number;
}) {
  const reduce = useReducedMotion();
  const Comp = motion[as];
  return (
    <Comp
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={amount != null ? { once: true, amount } : { once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </Comp>
  );
}

export function useMediaQuery(query: string) {
  const [on, setOn] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setOn(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [query]);
  return on;
}

export function SectionHead({
  index,
  label,
  title,
  intro,
}: {
  index?: string;
  label: string;
  title: ReactNode;
  intro?: ReactNode;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-12 lg:items-end">
      <Reveal className="lg:col-span-8">
        <Kicker index={index}>{label}</Kicker>
        <h2 className={cn("mt-5 text-balance", TYPE.h2)}>{title}</h2>
      </Reveal>
      {intro ? (
        <Reveal className="lg:col-span-3 lg:col-start-10" delay={0.1}>
          <p className={TYPE.intro}>{intro}</p>
        </Reveal>
      ) : null}
    </div>
  );
}

/** Pinning needs a desktop viewport, a precise pointer and motion; elsewhere sections render as normal flow. */
export function usePinEnabled(minHeight = 720) {
  const reduce = useReducedMotion();
  const fits = useMediaQuery(`(min-width: 1024px) and (min-height: ${minHeight}px) and (hover: hover) and (pointer: fine)`);
  return fits && !reduce;
}

/**
 * Tall scroll track with a sticky, header-offset viewport. Progress runs 0 → 1 across the track, so
 * the sequence follows the scrollbar, reverses with it and is always skippable.
 */
export function Pinned({ length, className, children }: { length: string; className?: string; children: (p: MotionValue<number>) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 80px", "end end"] });
  return (
    <div ref={ref} className="relative" style={{ height: length }}>
      <div className={cn("sticky top-[80px] flex h-[calc(100svh-80px)] flex-col justify-center", className)}>{children(scrollYProgress)}</div>
    </div>
  );
}

/** Discrete step of a progress value, re-rendering only when the step changes. */
export function useStep(p: MotionValue<number> | undefined, cuts: number[], fallback: number) {
  const [step, setStep] = useState(() => (p ? cuts.filter((c) => p.get() >= c).length : fallback));
  useEffect(() => {
    if (!p) {
      setStep(fallback);
      return;
    }
    const at = (v: number) => setStep(cuts.filter((c) => v >= c).length);
    at(p.get());
    return p.on("change", at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, fallback, cuts.join(",")]);
  return step;
}

/** Content that settles into place as it scrolls into view (scroll-linked, so it also reverses). */
export function ScrollIn({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 1", "start 0.55"] });
  const opacity = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0.25, 1]);
  const y = useTransform(scrollYProgress, [0, 1], [reduce ? 0 : 56, 0]);
  const scaleV = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0.965, 1]);
  return (
    <motion.div ref={ref} className={className} style={{ opacity, y, scale: scaleV, transformOrigin: "50% 0%" }}>
      {children}
    </motion.div>
  );
}

/**
 * Scroll-linked connector between two sections: a line draws downward and the artifact that one step
 * hands to the next travels along it.
 */
export function Handoff({ from, to, thumb }: { from: string; to: string; thumb?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.95", "end 0.45"] });
  const draw = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0, 1]);
  const y = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [-26, 0]);
  const fade = useTransform(scrollYProgress, [0, 0.45], [reduce ? 1 : 0, 1]);
  return (
    <Container>
      <div ref={ref} className="relative flex h-[132px] items-center gap-5 pl-[3px]" aria-label={`${from} becomes ${to}`}>
        <div className="absolute inset-y-0 left-[3px] w-px bg-white/[0.06]" aria-hidden />
        <motion.div className="absolute inset-y-0 left-[3px] w-px origin-top bg-gradient-to-b from-white/0 via-white/50 to-white/30" style={{ scaleY: draw }} aria-hidden />
        <motion.div className="relative ml-6 flex items-center gap-3 rounded-full border border-white/[0.1] bg-[#08090b]/90 py-1.5 pl-1.5 pr-4" style={{ y, opacity: fade }}>
          {thumb ? <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-white/10 bg-[#050506]">{thumb}</span> : null}
          <span className="font-mono text-[11px] text-white/45">
            <span className="text-white/80">{from}</span>
            <span className="mx-2 text-white/30">→</span>
            {to}
          </span>
        </motion.div>
      </div>
    </Container>
  );
}

export function ProvenanceTag({ kind, detail, className }: { kind: Provenance; detail?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-[10px] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] sm:rounded-full",
        kind === "illustrative" ? "border-dashed border-white/35 text-white/75" : "border-white/12 text-white/55",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          kind === "real" && "bg-white/85",
          kind === "reconstructed" && "border border-white/70",
          kind === "illustrative" && "border border-dashed border-white/70"
        )}
      />
      <span className="min-w-0 leading-snug sm:truncate">
        {PROVENANCE[kind]}
        {detail ? <span className="normal-case tracking-normal text-white/40"> · {detail}</span> : null}
      </span>
    </span>
  );
}

export function useStartHref() {
  const { session } = useAuth();
  return session ? "/dashboard" : "/signup";
}

export function PrimaryCta({ to, children, className, size = "md" }: { to: string; children: ReactNode; className?: string; size?: "md" | "lg" }) {
  return (
    <Link
      to={to}
      className={cn(
        "group relative inline-flex items-center gap-2.5 overflow-hidden rounded-full bg-white font-medium text-black transition-[background-color,transform] duration-300 hover:-translate-y-px hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        size === "lg" ? "px-8 py-4 text-[15.5px]" : "px-6 py-3.5 text-[14.5px]",
        className
      )}
    >
      <span className="relative">{children}</span>
      <ArrowRight className="relative h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden />
    </Link>
  );
}

export function SecondaryCta({
  to,
  href,
  children,
  className,
  size = "md",
}: {
  to?: string;
  href?: string;
  children: ReactNode;
  className?: string;
  size?: "md" | "lg";
}) {
  const cls = cn(
    "group inline-flex items-center gap-2.5 rounded-full border border-white/20 bg-white/[0.03] text-white/85 backdrop-blur-sm transition-colors duration-200 hover:border-white/45 hover:bg-white/[0.07] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
    size === "lg" ? "px-8 py-4 text-[15.5px]" : "px-6 py-3.5 text-[14.5px]",
    className
  );
  const body = (
    <>
      {children}
      <ArrowRight className="h-4 w-4 -rotate-45 text-white/50 transition-[transform,color] duration-200 group-hover:rotate-0 group-hover:text-white" aria-hidden />
    </>
  );
  if (href) {
    return (
      <a href={href} className={cls}>
        {body}
      </a>
    );
  }
  return (
    <Link to={to ?? "/"} className={cls}>
      {body}
    </Link>
  );
}

export function M2Footer() {
  const links: [string, string][] = [
    ["Home", "/"],
    ["About", "/about"],
    ["Pricing", "/pricing"],
    ["Products", "/products"],
    ["Contact", "/contact"],
    ["Sign in", "/login"],
  ];
  return (
    <footer className="border-t border-white/[0.07] bg-[#050506]">
      <Container className="flex flex-col gap-10 py-14 md:flex-row md:items-end md:justify-between">
        <div className="max-w-md">
          <Link to="/" className="flex items-center gap-2">
            <img src={logoMark} alt="" className="h-8 w-8 object-contain" />
            <span className="text-lg font-semibold tracking-tight text-white">convolve.</span>
          </Link>
          <p className="mt-5 text-[13px] leading-relaxed text-white/40">
            Deployed models currently run with simulated (paper) execution; there is no brokerage connection. Nothing on this site is
            investment advice. Visuals marked “Illustrative data” use synthetic data.
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-7 gap-y-3 text-sm text-white/55" aria-label="Footer">
          {links.map(([label, to]) => (
            <Link key={to} to={to} className="transition-colors hover:text-white">
              {label}
            </Link>
          ))}
        </nav>
      </Container>
      <Container className="flex flex-col gap-4 pb-10 sm:flex-row sm:items-center sm:justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/25">© {new Date().getFullYear()} {OPERATOR.name}</span>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-white/40" aria-label="Legal">
          {LEGAL_LINKS.map((l) => (
            <Link key={l.href} to={l.href} className="transition-colors hover:text-white">
              {l.label}
            </Link>
          ))}
        </nav>
      </Container>
    </footer>
  );
}

/* ----------------------------------------------------------------------------- chart helpers */

export function scale(d0: number, d1: number, r0: number, r1: number) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}

/** Left-to-right SVG reveal. Unlike pathLength, it keeps strokeDasharray intact. */
export function RevealGroup({ w, h, delay = 0.1, duration = 1.6, children }: { w: number; h: number; delay?: number; duration?: number; children: ReactNode }) {
  const reduce = useReducedMotion();
  const id = `rv${useId().replace(/:/g, "")}`;
  if (reduce) return <g>{children}</g>;
  return (
    <>
      <defs>
        <clipPath id={id}>
          <motion.rect x="0" y="0" width={w} height={h} style={{ originX: 0 }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration, ease: EASE, delay }} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>{children}</g>
    </>
  );
}

export function linePath(points: [number, number][]) {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
}

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", year: "numeric" }) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}
