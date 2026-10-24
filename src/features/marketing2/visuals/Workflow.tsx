import { useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHAIN, asset, backtest, fleet, grid, labmaps, training } from "../data";
import { linePath, scale } from "../ui";

const TW = 160;
const TH = 100;

export function LossThumb() {
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

export function EquityThumb() {
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

export function FleetThumb() {
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
const pct = (v: number, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`;

function RuleArtifact() {
  const r = CHAIN.labelRule;
  return (
    <div className="flex h-full flex-col justify-center gap-1.5 px-3.5 font-mono text-[11px]">
      {[
        ["take_profit", pct(r.tp)],
        ["stop_loss", pct(-r.sl)],
        ["horizon", `${r.horizon} bars`],
      ].map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-2 border-b border-dashed border-white/[0.08] pb-1.5 last:border-0">
          <span className="text-white/40">{k}</span>
          <span className="text-white">{v}</span>
        </div>
      ))}
    </div>
  );
}

function DatasetArtifact() {
  return (
    <div className="grid h-full grid-cols-4 grid-rows-3 gap-[3px] p-2">
      {grid.tiles.slice(0, 12).map((tl) => (
        <img
          key={tl.file}
          src={asset(tl.file)}
          alt=""
          className={cn("h-full w-full rounded-[2px] border object-cover", tl.label ? "border-white/70" : "border-transparent opacity-55")}
        />
      ))}
    </div>
  );
}

function ModelArtifact() {
  const blocks = training.arch.filter((l) => l.kind === "Conv2D" || l.kind === "Dense");
  const max = Math.max(...blocks.map((b) => b.out[b.out.length - 1]));
  return (
    <div className="flex h-full flex-col justify-end px-3 pb-2.5">
      <div className="flex flex-1 items-end gap-1.5">
        {blocks.map((b) => {
          const ch = b.out[b.out.length - 1];
          return (
            <div key={b.name} className="flex flex-1 flex-col items-center gap-1">
              <div
                className={cn("w-full rounded-[2px]", b.kind === "Conv2D" ? "bg-white/30" : "bg-white/45")}
                style={{ height: `${10 + (ch / max) * 70}px` }}
              />
              <span className="font-mono text-[8.5px] text-white/40">{ch}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[8.5px] text-white/30">
        <span>conv ×3</span>
        <span>dense · σ</span>
      </div>
    </div>
  );
}

function AttentionArtifact() {
  return (
    <div className="flex h-full items-center justify-center p-2">
      <div className="relative aspect-square h-full overflow-hidden rounded-[4px]">
        <img src={asset(s0.input)} alt="" className="absolute inset-0 h-full w-full opacity-30" />
        <img src={asset(s0.gradcam)} alt="" className="absolute inset-0 h-full w-full" />
      </div>
    </div>
  );
}

interface Stage {
  name: string;
  optional?: boolean;
  doing: string;
  artifact: string;
  id: string;
  body: ReactNode;
}

const STAGES: Stage[] = [
  { name: "Explore labels", optional: true, doing: "Score take-profit, stop-loss and horizon rules.", artifact: "Label rule", id: CHAIN.labelRule.note, body: <RuleArtifact /> },
  { name: "Generate", doing: "Render each price window as a labelled image.", artifact: "Image dataset", id: `${grid.count.toLocaleString("en-US")} images · ${CHAIN.dataset}`, body: <DatasetArtifact /> },
  { name: "Train", doing: "Fit a CNN and restore the best epoch.", artifact: "Trained CNN", id: `${CHAIN.modelName} · epoch ${training.best_epoch}`, body: <ModelArtifact /> },
  { name: "Analyse", optional: true, doing: "Open the model on its own charts.", artifact: "Interpretation", id: `Grad-CAM · ${Math.round(s0.gradcam_on_candles * 100)}% on candles`, body: <AttentionArtifact /> },
  {
    name: "Backtest",
    doing: "Unseen data, costs, locked threshold.",
    artifact: "Backtest report",
    id: `${pct(backtest.metrics.total_return)} net · ${CHAIN.backtest}`,
    body: (
      <div className="h-full p-2.5">
        <EquityThumb />
      </div>
    ),
  },
  {
    name: "Deploy",
    doing: "Attach the model to a symbol and schedule.",
    artifact: "Paper trading bot",
    id: "paper wallet · illustrative fleet",
    body: (
      <div className="h-full p-2.5">
        <FleetThumb />
      </div>
    ),
  },
];

/**
 * The six stages as one pipeline: a scroll-linked conduit carries the work from stage to stage and
 * lights the artifact each one produces. A return path marks that every stage can be revisited.
 */
export function Workflow() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.8", "end 0.75"] });
  const fill = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0, 1]);
  const head = useTransform(fill, (v) => `${v * 100}%`);
  const [reached, setReached] = useState(reduce ? STAGES.length : 0);
  useMotionValueEvent(fill, "change", (v) => setReached(Math.min(STAGES.length, Math.floor(v * (STAGES.length - 1) + 1.0001))));
  const n = STAGES.length;
  const centre = (i: number) => `${((i + 0.5) / n) * 100}%`;

  return (
    <div ref={ref} className="relative overflow-hidden rounded-[22px] border border-white/[0.1] bg-[#07080a] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-white/40">
        <span>
          <span className="text-white/75">Research pipeline</span>
        </span>
        <span className="flex items-center gap-4 normal-case tracking-normal">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-[3px] border border-white/40" aria-hidden /> required
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-[3px] border border-dashed border-white/40" aria-hidden /> optional
          </span>
        </span>
      </div>

      <div className="relative">
        <div aria-hidden className="absolute top-[140px] hidden h-px bg-white/[0.08] lg:block" style={{ left: centre(0), right: `${(0.5 / n) * 100}%` }}>
          <motion.div className="absolute inset-y-0 left-0 bg-white/45" style={{ width: head }} />
          <motion.span className="absolute -top-[3.5px] h-2 w-2 -translate-x-1/2 rounded-full bg-white" style={{ left: head }} />
        </div>

        <ol className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6">
          {STAGES.map((st, i) => {
            const on = i < reached;
            return (
              <li key={st.name} className={cn("relative flex flex-col px-5 pb-6 pt-5 lg:border-r lg:border-white/[0.06] lg:last:border-r-0", "border-b border-white/[0.06] lg:border-b-0")}>
                <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.16em]">
                  <span className={cn("transition-colors duration-500", on ? "text-white/80" : "text-white/35")}>{String(i + 1).padStart(2, "0")}</span>
                  {st.optional ? <span className="text-white/35">optional</span> : null}
                </div>
                <div className={cn("mt-2 text-[20px] font-normal tracking-[-0.02em] transition-colors duration-500", on ? "text-white" : "text-white/45")}>{st.name}</div>
                <p className="mt-1 min-h-[2.6em] text-[14px] leading-snug text-white/50">{st.doing}</p>
                <div className="relative mt-3 hidden h-6 items-center justify-center lg:flex" aria-hidden>
                  <span
                    className={cn(
                      "h-3 w-3 rounded-full border transition-all duration-500",
                      on ? "border-white bg-white" : "border-white/25 bg-[#07080a]"
                    )}
                  />
                </div>
                <div
                  className={cn(
                    "mt-3 h-[150px] overflow-hidden rounded-[12px] border bg-[#050506] transition-[opacity,border-color,transform] duration-700",
                    st.optional ? "border-dashed" : "",
                    on ? "border-white/25 opacity-100" : "translate-y-2 border-white/[0.08] opacity-40"
                  )}
                >
                  {st.body}
                </div>
                <div className="mt-3">
                  <div className="text-[14.5px] text-white">{st.artifact}</div>
                  <div className="truncate font-mono text-[11px] text-white/40">{st.id}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/[0.07] px-5 py-3.5 text-[14px] text-white/55">
        <span className="inline-flex items-center gap-2">
          <RotateCcw className="h-4 w-4 text-white/60" aria-hidden />
          Not convinced by the backtest? Change the rule and go again. Every version is kept.
        </span>
      </div>
    </div>
  );
}
