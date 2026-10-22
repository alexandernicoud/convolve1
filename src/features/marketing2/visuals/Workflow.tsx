import { useMemo, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { asset, backtest, fleet, grid, labmaps, screen, training } from "../data";
import { EASE, linePath, scale } from "../ui";

const TW = 160;
const TH = 100;

function LossThumb() {
  const d = useMemo(() => {
    const e = training.epochs;
    const all = e.flatMap((r) => [r.loss, r.val_loss]);
    const x = scale(1, e.length, 8, TW - 8);
    const y = scale(Math.min(...all), Math.max(...all), TH - 12, 12);
    return {
      tr: linePath(e.map((r) => [x(r.e), y(r.loss)])),
      va: linePath(e.map((r) => [x(r.e), y(r.val_loss)])),
      best: x(training.best_epoch),
    };
  }, []);
  return (
    <svg viewBox={`0 0 ${TW} ${TH}`} className="h-full w-full" aria-hidden>
      <line x1={d.best} x2={d.best} y1="6" y2={TH - 6} stroke="#b9d3ff" strokeOpacity="0.5" strokeDasharray="2 3" />
      <path d={d.tr} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.4" />
      <path d={d.va} fill="none" stroke="#fff" strokeWidth="1.6" />
    </svg>
  );
}

function EquityThumb() {
  const d = useMemo(() => {
    const s = backtest.series;
    const all = s.flatMap((r) => [r.s, r.spy]);
    const x = scale(0, s.length - 1, 6, TW - 6);
    const y = scale(Math.min(...all), Math.max(...all), TH - 10, 10);
    return { st: linePath(s.map((r, i) => [x(i), y(r.s)])), spy: linePath(s.map((r, i) => [x(i), y(r.spy)])) };
  }, []);
  return (
    <svg viewBox={`0 0 ${TW} ${TH}`} className="h-full w-full" aria-hidden>
      <path d={d.spy} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" strokeDasharray="3 3" />
      <path d={d.st} fill="none" stroke="#fff" strokeWidth="1.6" />
    </svg>
  );
}

function FleetThumb() {
  const lines = useMemo(
    () =>
      fleet.bots.slice(0, 5).map((b, k) => {
        const v = b.spark.map((p) => p ?? 0);
        const x = scale(0, v.length - 1, 6, TW - 6);
        const y = scale(Math.min(...v), Math.max(...v) || 1, 16 + k * 17, 4 + k * 17);
        return { d: linePath(v.map((p, i) => [x(i), y(p)])), on: b.status === "active" };
      }),
    []
  );
  return (
    <svg viewBox={`0 0 ${TW} ${TH}`} className="h-full w-full" aria-hidden>
      {lines.map((l, i) => (
        <g key={i}>
          <circle cx="4" cy={10 + i * 17} r="1.8" fill={l.on ? "#9be7b4" : "#e8c27a"} />
          <path d={l.d} transform="translate(6 0)" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.1" />
        </g>
      ))}
    </svg>
  );
}

const s0 = labmaps.samples[labmaps.trace_index];

interface Step {
  name: string;
  optional?: boolean;
  doing: string;
  output: string;
  thumb: ReactNode;
}

const STEPS: Step[] = [
  {
    name: "Explore labels",
    optional: true,
    doing: "Search take-profit, stop-loss and horizon rules.",
    output: "A label rule",
    thumb: <img src={screen("opt_heatmap")} alt="" className="h-full w-full object-cover [transform-origin:14%_60%] [transform:scale(2.3)]" />,
  },
  {
    name: "Generate",
    doing: "Pick symbols, interval and window length.",
    output: "Labelled chart images",
    thumb: (
      <div className="grid h-full grid-cols-4 gap-[2px] p-1.5">
        {grid.tiles.slice(0, 8).map((tl) => (
          <img key={tl.file} src={asset(tl.file)} alt="" className="h-full w-full rounded-[2px] object-cover" />
        ))}
      </div>
    ),
  },
  {
    name: "Train",
    doing: "Choose an architecture and stopping rule.",
    output: "A saved CNN",
    thumb: <LossThumb />,
  },
  {
    name: "Analyse",
    optional: true,
    doing: "Open the model on its own charts.",
    output: "Attention maps and tests",
    thumb: (
      <div className="relative mx-auto h-full aspect-square">
        <img src={asset(s0.input)} alt="" className="absolute inset-0 h-full w-full opacity-35" />
        <img src={asset(s0.gradcam)} alt="" className="absolute inset-0 h-full w-full" />
      </div>
    ),
  },
  {
    name: "Backtest",
    doing: "Set a test period, costs and threshold.",
    output: "Returns against benchmarks",
    thumb: <EquityThumb />,
  },
  {
    name: "Deploy",
    doing: "Attach the model to a symbol and schedule.",
    output: "A running paper bot",
    thumb: <FleetThumb />,
  },
];

export function Workflow() {
  const reduce = useReducedMotion();
  return (
    <div>
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:gap-0">
        {STEPS.map((s, i) => (
          <motion.li
            key={s.name}
            className="relative lg:pr-5"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px 0px -10% 0px" }}
            transition={{ duration: 0.7, ease: EASE, delay: i * 0.07 }}
          >
            <div
              className={cn(
                "flex h-full flex-col rounded-[14px] border p-3.5 transition-colors duration-300 hover:bg-white/[0.035]",
                s.optional ? "border-dashed border-white/20 bg-transparent" : "border-white/[0.1] bg-white/[0.02]"
              )}
            >
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em]">
                <span className="text-white/70">{String(i + 1).padStart(2, "0")}</span>
                {s.optional ? <span className="text-white/40">Optional</span> : null}
              </div>
              <div className="mt-2 text-[17px] font-medium tracking-[-0.01em] text-white">{s.name}</div>
              <div className="mt-3 h-[92px] overflow-hidden rounded-[8px] border border-white/[0.07] bg-[#07080a]">{s.thumb}</div>
              <p className="mt-3 text-[13px] leading-snug text-white/55">{s.doing}</p>
              <div className="mt-auto pt-3">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11.5px] text-white/85">
                  <span className="h-1 w-1 rounded-full bg-[#b9d3ff]" aria-hidden />
                  {s.output}
                </div>
              </div>
            </div>
            {i < STEPS.length - 1 ? (
              <ArrowRight
                className="absolute right-0 top-1/2 hidden h-4 w-4 -translate-y-1/2 translate-x-[2px] text-white/30 lg:block"
                aria-hidden
              />
            ) : null}
          </motion.li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px] text-white/45">
        <span className="inline-flex items-center gap-2">
          <RotateCcw className="h-3.5 w-3.5 text-white/40" aria-hidden />
          Go back to any step. Every dataset, model and backtest is kept and linked.
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-5 rounded-[4px] border border-dashed border-white/35" aria-hidden />
          Optional step
        </span>
      </div>
    </div>
  );
}
