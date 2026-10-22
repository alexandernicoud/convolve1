import { useId, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import logoMark from "@/assets/convolve-mark.png";
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

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1360px] px-5 2xl:max-w-[1560px] sm:px-8 lg:px-12", className)}>{children}</div>;
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
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: "div" | "section" | "li";
}) {
  const reduce = useReducedMotion();
  const Comp = motion[as];
  return (
    <Comp
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </Comp>
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
          kind === "reconstructed" && "border border-[#b9d3ff]",
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

export function PrimaryCta({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        "group inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition-colors duration-200 hover:bg-white/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        className
      )}
    >
      {children}
      <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

export function SecondaryCta({
  to,
  href,
  children,
  className,
}: {
  to?: string;
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  const cls = cn(
    "inline-flex items-center gap-2 rounded-full border border-white/18 px-5 py-3 text-sm text-white/80 transition-colors duration-200 hover:border-white/40 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
    className
  );
  if (href) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to ?? "/"} className={cls}>
      {children}
    </Link>
  );
}

export function M2Footer() {
  const links: [string, string][] = [
    ["Home 2", "/home2"],
    ["About 2", "/about2"],
    ["Products", "/products"],
    ["Contact", "/contact"],
    ["Sign in", "/login"],
  ];
  return (
    <footer className="border-t border-white/[0.07] bg-[#050506]">
      <Container className="flex flex-col gap-10 py-14 md:flex-row md:items-end md:justify-between">
        <div className="max-w-md">
          <Link to="/home2" className="flex items-center gap-2">
            <img src={logoMark} alt="" className="h-8 w-8 object-contain" />
            <span className="text-lg font-semibold tracking-tight text-white">convolve.</span>
          </Link>
          <p className="mt-5 text-[13px] leading-relaxed text-white/40">
            Deployment runs on a paper wallet; there is no brokerage connection. Nothing on this site is investment
            advice. Visuals marked “Illustrative data” use synthetic data.
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
      <Container className="pb-10 font-mono text-[11px] uppercase tracking-[0.18em] text-white/25">
        © {new Date().getFullYear()} Convolve
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
