import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { asset, hero, labmaps, trace } from "../data";
import { EASE, ProvenanceTag, fmtDate, scale } from "../ui";
import { useInkPath } from "./ModelLab";
import { EquityThumb, FleetThumb } from "./Workflow";

const W = 600;
const CH = 330;
const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

const SAMPLE = labmaps.samples[labmaps.trace_index];
const STAGES = ["Window", "Image", "Conv 1", "Conv 2", "Conv 3", "Grad-CAM", "P(TP)", "Next"];
const LAST = STAGES.length - 1;
const SCAN = [26, 70, 112, 150, 186, 206];

/** Walks the forward pass once, then loops slowly while the console is on screen. */
function useStage(reduce: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(reduce ? LAST : -1);
  const [seen, setSeen] = useState(reduce ? LAST : -1);
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (reduce) return;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    if (ref.current) io.observe(ref.current);
    let i = -1;
    let id = window.setTimeout(function tick() {
      if (visible) {
        i = i >= LAST ? 0 : i + 1;
        if (i === 0) setCycle((c) => c + 1);
        setStage(i);
        setSeen((s) => Math.max(s, i));
      }
      id = window.setTimeout(tick, i === LAST ? 4600 : i === 0 ? 1500 : 1050);
    }, 1100);
    return () => {
      window.clearTimeout(id);
      io.disconnect();
    };
  }, [reduce]);
  return { ref, stage, seen, cycle };
}

function PanelHead({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="whitespace-nowrap text-[14px] font-medium tracking-[-0.01em] text-white/90">{title}</span>
      {meta ? <span className="truncate text-[12px] text-white/40">{meta}</span> : null}
    </div>
  );
}

function Candles({ reduce, lit }: { reduce: boolean; lit: boolean }) {
  const g = useMemo(() => {
    const weekly = hero.weekly;
    const x = scale(t(weekly[0].d), t(weekly[weekly.length - 1].d), 10, W - 10);
    const lo = Math.min(...weekly.map((c) => c.l));
    const hi = Math.max(...weekly.map((c) => c.h));
    const y = scale(lo, hi, CH - 14, 14);
    const body = Math.max(2, ((W - 20) / weekly.length) * 0.56);
    return { weekly, x, y, body };
  }, []);
  const a = g.x(t(trace.sample.start));
  const b = g.x(t(trace.sample.date));
  return (
    <svg viewBox={`0 0 ${W} ${CH}`} preserveAspectRatio="none" className="block h-full w-full" role="img" aria-label="Weekly candles with the six-month window the model reads">
      <defs>
        <clipPath id="m2-hc-reveal">
          <motion.rect x="0" y="0" height={CH} initial={reduce ? { width: W } : { width: 0 }} animate={{ width: W }} transition={{ duration: 1.6, ease: EASE, delay: 0.5 }} />
        </clipPath>
        <linearGradient id="m2-hc-band" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.07" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" x2={W} y1={CH * f} y2={CH * f} stroke="rgba(255,255,255,0.045)" vectorEffect="non-scaling-stroke" />
      ))}
      <g style={{ opacity: lit ? 1 : 0.35, transition: "opacity 0.8s" }}>
        <rect x={a} y="0" width={b - a} height={CH} fill="url(#m2-hc-band)" />
        <rect x={a} y="0.5" width={b - a} height={CH - 1} fill="none" stroke="rgba(255,255,255,0.3)" rx="3" vectorEffect="non-scaling-stroke" />
      </g>
      <g clipPath="url(#m2-hc-reveal)">
        {g.weekly.map((c) => {
          const cx = g.x(t(c.d));
          const up = c.c >= c.o;
          const inBand = cx >= a && cx <= b;
          const ink = inBand ? "rgba(255,255,255,0.95)" : up ? "rgba(236,239,243,0.45)" : "rgba(150,156,166,0.34)";
          return (
            <g key={c.d}>
              <line x1={cx} x2={cx} y1={g.y(c.h)} y2={g.y(c.l)} stroke={ink} strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <rect x={cx - g.body / 2} y={g.y(Math.max(c.o, c.c))} width={g.body} height={Math.max(1.2, Math.abs(g.y(c.o) - g.y(c.c)))} fill={up ? "#07080a" : ink} stroke={ink} strokeWidth="1" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** Feature maps of one conv layer drawn as a stack; it fans out when the pass reaches it. */
function MapStack({ files, layers, size, step, open, active }: { files: string[]; layers: number; size: number; step: number; open: boolean; active: boolean }) {
  const span = size + (layers - 1) * step;
  return (
    <div className="relative shrink-0" style={{ width: `${span}cqw`, height: `${span}cqw` }}>
      {Array.from({ length: layers }, (_, k) => layers - 1 - k).map((i) => (
        <motion.img
          key={i}
          src={asset(files[i % files.length])}
          alt=""
          className="absolute left-0 top-0 rounded-[3px] border bg-[#050506] [image-rendering:pixelated]"
          style={{
            width: `${size}cqw`,
            height: `${size}cqw`,
            borderColor: i === 0 && active ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.14)",
            filter: i === 0 ? "none" : `brightness(${Math.max(0.35, 0.9 - i * 0.07)})`,
            boxShadow: "0 6px 16px -8px rgba(0,0,0,0.9)",
          }}
          initial={false}
          animate={{
            left: `${open ? i * step : 0}cqw`,
            top: `${open ? (layers - 1 - i) * step : (layers - 1) * step}cqw`,
            opacity: open ? 1 : i === 0 ? 0.25 : 0,
          }}
          transition={{ duration: 0.9, ease: EASE, delay: open ? i * 0.035 : 0 }}
        />
      ))}
    </div>
  );
}

function Wire({ on, pulse }: { on: boolean; pulse: string | null }) {
  return (
    <div className="relative mx-[0.6cqw] mt-[11.5cqw] h-px min-w-[1cqw] flex-1 self-start bg-white/[0.08]" aria-hidden>
      <div className="absolute inset-0 origin-left bg-white/40 transition-transform duration-700" style={{ transform: `scaleX(${on ? 1 : 0})` }} />
      {pulse ? (
        <motion.span
          key={pulse}
          className="absolute -top-[2.5px] h-[6px] w-[6px] rounded-full bg-white"
          initial={{ left: "0%", opacity: 0 }}
          animate={{ left: "100%", opacity: [0, 1, 1, 0] }}
          transition={{ duration: 0.85, ease: "easeInOut" }}
        />
      ) : null}
    </div>
  );
}

function Layer({ label, shape, on, children }: { label: string; shape: string; on: boolean; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col items-center">
      <div className="flex h-[20cqw] items-end">{children}</div>
      <div className={cn("mt-3 whitespace-nowrap text-[clamp(11px,1.9cqw,13.5px)] transition-colors duration-500", on ? "text-white" : "text-white/55")}>{label}</div>
      <div className="whitespace-nowrap font-mono text-[clamp(9.5px,1.5cqw,11px)] text-white/35">{shape}</div>
    </div>
  );
}

/** Real forward pass of the trained model on one test window, from price history to a tradeable probability. */
export function HeroFlow() {
  const reduce = !!useReducedMotion();
  const { ref, stage, seen, cycle } = useStage(reduce);
  const ink = useInkPath(asset(SAMPLE.input));
  const p = SAMPLE.p;
  const thr = hero.threshold;
  const feats = labmaps.features;
  const pulse = (i: number) => (stage === i && !reduce ? `${cycle}-${i}` : null);
  const scan = SCAN.map((c) => ({ x: (c / 224) * 100, y: (((ink?.[c] ?? 112) - 7) / 224) * 100 }));
  const next: { label: string; href: string; meta: string; thumb: ReactNode }[] = [
    {
      label: "Analyse",
      href: "#model",
      meta: "Where the network looks, pixel by pixel",
      thumb: (
        <span className="relative block h-full w-full">
          <img src={asset(SAMPLE.input)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
          <img src={asset(SAMPLE.gradcam)} alt="" className="absolute inset-0 h-full w-full object-cover" />
        </span>
      ),
    },
    {
      label: "Backtest",
      href: "#workspace",
      meta: "Unseen data, costs and benchmarks",
      thumb: <EquityThumb />,
    },
    { label: "Deploy", href: "#deploy", meta: "Scheduled predictions, monitored", thumb: <FleetThumb /> },
  ];

  return (
    <div ref={ref} className="relative [perspective:2200px]">
      <motion.div
        className="relative overflow-hidden rounded-[18px] border border-white/[0.1] bg-[#08090a] shadow-[0_60px_120px_-50px_rgba(0,0,0,0.95)]"
        style={{ transformOrigin: "50% 0%" }}
        initial={reduce ? false : { opacity: 0, rotateX: 12, y: 50 }}
        animate={{ opacity: 1, rotateX: 0, y: 0 }}
        transition={{ duration: 1.4, ease: EASE, delay: 0.25 }}
      >
        <div className="flex h-11 items-center gap-3 border-b border-white/[0.07] px-5">
          <span className="truncate font-mono text-[11px] text-white/40">
            <span className="text-white/80">convolve.</span> / analysis / one test chart
          </span>
          <span className="ml-auto whitespace-nowrap font-mono text-[11px] text-white/55" aria-live="off">
            forward pass · <span className="text-[#a6ecc8]">{STAGES[Math.max(0, stage)]}</span>
          </span>
        </div>

        <div className="border-b border-white/[0.07] px-5 pb-4 pt-4">
          <PanelHead
            title="Price history"
            meta={`${fmtDate(trace.sample.start, { day: "numeric", month: "short" })} – ${fmtDate(trace.sample.date, { day: "numeric", month: "short", year: "numeric" })} · the window the model reads`}
          />
          <div className="relative mt-3 h-[96px] sm:h-[110px]">
            <Candles reduce={reduce} lit={seen >= 0} />
          </div>
        </div>

        <div className="border-b border-white/[0.07] px-5 pb-5 pt-4">
          <PanelHead title="Convolutional network" meta="real activations" />
          <div className="mt-4 [container-type:inline-size]">
            <div className="flex w-full items-start">
              <Layer label="Chart image" shape="224²" on={stage === 1}>
                <div className="relative h-[17cqw] w-[17cqw] overflow-hidden rounded-[4px] border border-white/[0.16] bg-[#050506]">
                  <img src={asset(SAMPLE.input)} alt="The 224 by 224 chart image the CNN reads" className="h-full w-full" />
                  {stage === 1 && !reduce ? (
                    <motion.span
                      key={cycle}
                      className="absolute h-[7%] w-[7%] rounded-[1px] border border-white"
                      initial={{ left: `${scan[0].x}%`, top: `${scan[0].y}%` }}
                      animate={{ left: scan.map((s) => `${s.x}%`), top: scan.map((s) => `${s.y}%`) }}
                      transition={{ duration: 1, ease: "linear" }}
                    />
                  ) : null}
                </div>
              </Layer>
              <Wire on={seen >= 2} pulse={pulse(2)} />
              {feats.map((f, k) => (
                <FragmentLayer key={f.name} last={k === feats.length - 1} on={seen >= 3 + k} pulse={pulse(3 + k)}>
                  <Layer label={`Conv ${k + 1}`} shape={`${f.channels} maps`} on={stage === 2 + k}>
                    <MapStack files={f.files} layers={[6, 8, 10][k]} size={[14.5, 12, 9.5][k]} step={[0.9, 0.75, 0.62][k]} open={seen >= 2 + k} active={stage === 2 + k} />
                  </Layer>
                </FragmentLayer>
              ))}
              <Wire on={seen >= 5} pulse={pulse(5)} />
              <Layer label="Grad-CAM" shape="attention" on={stage === 5}>
                <div className={cn("relative h-[17cqw] w-[17cqw] overflow-hidden rounded-[4px] border bg-[#050506] transition-colors duration-700", stage === 5 ? "border-white/60" : "border-white/[0.16]")}>
                  <img src={asset(SAMPLE.input)} alt="" className="absolute inset-0 h-full w-full opacity-30" />
                  <img src={asset(SAMPLE.gradcam)} alt="Grad-CAM attention for this chart" className="absolute inset-0 h-full w-full transition-opacity duration-1000" style={{ opacity: seen >= 5 ? 1 : 0 }} />
                </div>
              </Layer>
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className={cn("border-b border-white/[0.07] px-5 py-4 transition-opacity duration-700 sm:border-b-0 sm:border-r", seen >= 6 ? "opacity-100" : "opacity-30")}>
            <PanelHead title="Prediction" meta={fmtDate(SAMPLE.date, { day: "numeric", month: "short", year: "numeric" })} />
            <div className="mt-2 flex items-baseline gap-3">
              <span className="text-[clamp(2.4rem,3.2vw,3.2rem)] font-light leading-none tracking-[-0.04em] text-white tabular-nums">{p.toFixed(3)}</span>
              <span className="text-[13px] text-white/45">P(take-profit first)</span>
            </div>
            <div className="relative mt-4 h-1 w-full rounded-full bg-white/10">
              <div className="h-full origin-left rounded-full bg-white/75 transition-transform duration-1000" style={{ width: `${p * 100}%`, transform: `scaleX(${seen >= 6 ? 1 : 0})` }} />
              <span className="absolute -top-1.5 h-4 w-px bg-white" style={{ left: `${thr * 100}%` }} />
            </div>
            <div className="mt-2 text-[12.5px] text-white/50">Above the threshold fixed on validation data: the backtest takes this trade.</div>
          </div>
          <ul className="px-3 py-3">
            {next.map((n, k) => (
              <li key={n.label}>
                <a
                  href={n.href}
                  className={cn(
                    "group flex items-center gap-3 rounded-[10px] px-2 py-1.5 transition-[background-color,opacity] duration-700 hover:bg-white/[0.04]",
                    seen >= LAST ? "opacity-100" : "opacity-35"
                  )}
                  style={{ transitionDelay: stage === LAST ? `${k * 150}ms` : "0ms" }}
                >
                  <span className="h-9 w-14 shrink-0 overflow-hidden rounded-[6px] border border-white/[0.08] bg-[#050506]">{n.thumb}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] text-white">{n.label}</span>
                    <span className="block truncate text-[12px] text-white/45">{n.meta}</span>
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-white/35 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </motion.div>
      <div className="mt-3">
        <ProvenanceTag kind="real" detail={`Real test chart and activations · actual outcome: label ${SAMPLE.label}`} />
      </div>
    </div>
  );
}

function FragmentLayer({ children, last, on, pulse }: { children: ReactNode; last: boolean; on: boolean; pulse: string | null }) {
  return (
    <>
      {children}
      {last ? null : <Wire on={on} pulse={pulse} />}
    </>
  );
}
