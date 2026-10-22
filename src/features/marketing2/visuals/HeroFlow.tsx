import { useMemo, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { asset, hero, labmaps, trace } from "../data";
import { EASE, ProvenanceTag, fmtDate, scale } from "../ui";

const W = 1000;
const CH = 300;
const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

const SAMPLE = labmaps.samples[labmaps.trace_index];

function useChart() {
  return useMemo(() => {
    const weekly = hero.weekly;
    const x = scale(t(weekly[0].d), t(weekly[weekly.length - 1].d), 14, W - 14);
    const lo = Math.min(...weekly.map((c) => c.l));
    const hi = Math.max(...weekly.map((c) => c.h));
    const y = scale(lo, hi, CH - 18, 18);
    const body = Math.max(2, ((W - 28) / weekly.length) * 0.56);
    return { weekly, x, y, body };
  }, []);
}

function Stack({ files, delay, reduce }: { files: string[]; delay: number; reduce: boolean }) {
  const shown = files.slice(0, 3);
  return (
    <div className="relative aspect-square w-full">
      {shown.map((f, i) => (
        <motion.img
          key={f}
          src={asset(f)}
          alt=""
          className="absolute aspect-square rounded-[4px] border border-white/15 shadow-[0_8px_20px_-8px_rgba(0,0,0,0.9)] [image-rendering:pixelated]"
          style={{ width: "82%", left: `${i * 9}%`, top: `${(2 - i) * 9}%` }}
          initial={reduce ? false : { opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: delay + i * 0.08 }}
        />
      ))}
    </div>
  );
}

const PULSE_CSS = `@keyframes m2hfPulse{0%,100%{opacity:0}6%{opacity:1}22%{opacity:0}}`;

function Node({
  label,
  meta,
  children,
  delay,
  reduce,
  pulse,
  className,
}: {
  label: string;
  meta: string;
  children: ReactNode;
  delay: number;
  reduce: boolean;
  pulse: number;
  className?: string;
}) {
  return (
    <motion.div
      className={cn("relative min-w-0", className)}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      <div className="relative">
        {children}
        {!reduce ? (
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-1 rounded-[9px] border border-[#b9d3ff]/70 opacity-0 shadow-[0_0_24px_rgba(185,211,255,0.25)]"
            style={{ animation: `m2hfPulse 4.2s ${delay + 0.6 + pulse * 0.32}s infinite` }}
          />
        ) : null}
      </div>
      <div className="mt-2 truncate text-[11px] text-white/75">{label}</div>
      <div className="truncate font-mono text-[9.5px] text-white/35">{meta}</div>
    </motion.div>
  );
}

/** Real CNN pass for one MSFT test window: price chart, rendered image, three conv layers, Grad-CAM, probability. */
export function HeroFlow() {
  const reduce = !!useReducedMotion();
  const g = useChart();
  const bandStart = g.x(t(trace.sample.start));
  const bandEnd = g.x(t(trace.sample.date));
  const bandW = bandEnd - bandStart;
  const feats = labmaps.features;
  const base = reduce ? 0 : 2.5;
  const p = SAMPLE.p;
  const thr = hero.threshold;

  return (
    <div className="relative">
      <motion.div
        className="relative overflow-hidden rounded-[18px] border border-white/[0.1] bg-[#0a0b0d] shadow-[0_60px_120px_-30px_rgba(0,0,0,0.9)]"
        initial={reduce ? false : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE, delay: 0.15 }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
        <div className="flex h-10 items-center gap-3 border-b border-white/[0.07] px-4">
          <span className="text-[12.5px] font-semibold tracking-tight text-white/90">convolve.</span>
          <span className="truncate font-mono text-[10px] text-white/35">/ {hero.symbol} · 1D · {labmaps.model.replace(".keras", "")}</span>
          <span className="ml-auto hidden font-mono text-[10px] uppercase tracking-[0.16em] text-white/35 sm:inline">one real forward pass</span>
        </div>

        <div className="px-4 pb-2 pt-4 sm:px-5">
          <div className="flex items-baseline justify-between gap-3 text-[11px] text-white/40">
            <span>
              <span className="text-white/75">1 · Prices</span> MSFT weekly, {fmtDate(g.weekly[0].d)} – {fmtDate(g.weekly[g.weekly.length - 1].d)}
            </span>
            <span className="hidden font-mono text-[10px] text-[#d6e5ff]/70 sm:inline">6-month window</span>
          </div>
          <svg viewBox={`0 0 ${W} ${CH}`} className="mt-2 block h-auto w-full" role="img" aria-label="MSFT weekly candles with the six-month window the model reads">
            <defs>
              <clipPath id="m2-hf-reveal">
                <motion.rect x="0" y="0" height={CH} initial={reduce ? { width: W } : { width: 0 }} animate={{ width: W }} transition={{ duration: 1.5, ease: EASE, delay: 0.35 }} />
              </clipPath>
              <linearGradient id="m2-hf-band" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#b9d3ff" stopOpacity="0.16" />
                <stop offset="100%" stopColor="#b9d3ff" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {[0.33, 0.66].map((f) => (
              <line key={f} x1="0" x2={W} y1={CH * f} y2={CH * f} stroke="rgba(255,255,255,0.05)" />
            ))}
            <g clipPath="url(#m2-hf-reveal)">
              {g.weekly.map((c) => {
                const cx = g.x(t(c.d));
                const up = c.c >= c.o;
                const inBand = cx >= bandStart && cx <= bandEnd;
                const ink = inBand ? "#ffffff" : up ? "rgba(236,239,243,0.7)" : "rgba(150,156,166,0.55)";
                return (
                  <g key={c.d}>
                    <line x1={cx} x2={cx} y1={g.y(c.h)} y2={g.y(c.l)} stroke={ink} strokeWidth="1" />
                    <rect
                      x={cx - g.body / 2}
                      y={g.y(Math.max(c.o, c.c))}
                      width={g.body}
                      height={Math.max(1.2, Math.abs(g.y(c.o) - g.y(c.c)))}
                      fill={up ? "#0a0b0d" : ink}
                      stroke={ink}
                      strokeWidth="1"
                    />
                  </g>
                );
              })}
            </g>
            <motion.g
              initial={reduce ? false : { x: -bandStart + 4, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 1.3, ease: EASE, delay: 1.2 }}
            >
              <rect x={bandStart} y="0" width={bandW} height={CH} fill="url(#m2-hf-band)" />
              <rect x={bandStart} y="0.5" width={bandW} height={CH - 1} fill="none" stroke="#b9d3ff" strokeOpacity="0.6" rx="3" />
            </motion.g>
          </svg>
        </div>

        <div className="relative border-t border-white/[0.07] px-4 pb-5 pt-4 sm:px-5">
          <style>{PULSE_CSS}</style>
          <div className="relative grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-6 sm:gap-x-4">
            <Node label="2 · Chart image" meta="224 × 224 × 3" delay={base} reduce={reduce} pulse={0}>
              <div className="aspect-square w-full overflow-hidden rounded-[6px] border border-[#b9d3ff]/40 bg-[#050506]">
                <img src={asset(SAMPLE.input)} alt="The 224 by 224 chart image the CNN reads" className="h-full w-full" />
              </div>
            </Node>
            {feats.map((f, i) => (
              <Node key={f.name} label={`${3 + i} · ${f.name}`} meta={`${f.channels} maps · ${f.h}²`} delay={base + 0.3 + i * 0.3} reduce={reduce} pulse={1 + i}>
                <Stack files={f.files} delay={base + 0.3 + i * 0.3} reduce={reduce} />
              </Node>
            ))}
            <Node label="6 · Grad-CAM" meta={`evidence · ${labmaps.layer}`} delay={base + 1.3} reduce={reduce} pulse={4}>
              <div className="relative aspect-square w-full overflow-hidden rounded-[6px] border border-white/15 bg-[#050506]">
                <img src={asset(SAMPLE.input)} alt="" className="absolute inset-0 h-full w-full opacity-35" />
                <img src={asset(SAMPLE.gradcam)} alt="Grad-CAM attention for this chart" className="absolute inset-0 h-full w-full" />
              </div>
            </Node>
            <Node label="7 · Output" meta="P(take-profit first)" delay={base + 1.6} reduce={reduce} pulse={5} className="col-span-3 sm:col-span-1">
              <div className="flex aspect-[3/1] w-full flex-col justify-center rounded-[6px] border border-white/15 bg-white/[0.03] px-3 sm:aspect-square">
                <div className="whitespace-nowrap text-[clamp(1.3rem,2.1vw,1.75rem)] font-medium leading-none tracking-tight text-white tabular-nums">
                  <span className="mr-1 text-[0.6em] font-normal text-white/45">p</span>
                  {p.toFixed(2)}
                </div>
                <div className="relative mt-3 h-1 w-full rounded-full bg-white/10">
                  <motion.div
                    className="h-full origin-left rounded-full bg-white"
                    style={{ width: `${p * 100}%` }}
                    initial={reduce ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.9, ease: EASE, delay: base + 1.8 }}
                  />
                  <span className="absolute -top-1 h-3 w-px bg-[#b9d3ff]" style={{ left: `${thr * 100}%` }} />
                </div>
                <div className="mt-2 font-mono text-[9.5px] text-[#d6e5ff]/70">≥ {thr.toFixed(2)} threshold → signal</div>
              </div>
            </Node>
          </div>

          <motion.div
            className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: base + 2.1 }}
          >
            <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">Then</span>
            {[
              ["Analyse it", "#model"],
              ["Backtest it", "#workspace"],
              ["Deploy it as a bot", "#deploy"],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="group inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-1.5 text-[12px] text-white/75 transition-colors hover:border-white/35 hover:text-white"
              >
                {label}
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </a>
            ))}
          </motion.div>
        </div>
      </motion.div>
      <div className="mt-3">
        <ProvenanceTag
          kind="real"
          detail={`MSFT window ${fmtDate(trace.sample.start, { day: "numeric", month: "short" })} – ${fmtDate(trace.sample.date, { day: "numeric", month: "short", year: "numeric" })}, real model activations`}
        />
      </div>
    </div>
  );
}
