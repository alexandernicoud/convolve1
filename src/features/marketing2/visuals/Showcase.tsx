import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { screen, type Provenance } from "../data";
import { EASE, ProvenanceTag } from "../ui";
import { GeneratorDemo, TrainerDemo } from "./LiveTools";

/** [left, top, width, height] in percent of the screenshot. Every screenshot is 1920 × 1200 (16:10). */
export type Rect = [number, number, number, number];

export interface Shot {
  key: string;
  file: string;
  path: string;
  alt: string;
  notes: { label: string; body: string; rect: Rect }[];
}

interface View {
  key: string;
  label: string;
  path: string;
  shot?: Shot;
  live?: () => ReactNode;
  points?: { label: string; body: string }[];
}

interface Tool {
  key: string;
  tool: string;
  title: string;
  summary: string;
  provenance: Provenance;
  source: string;
  views: View[];
}

export const SHOT: Record<string, Shot> = {
  heatmap: {
    key: "heatmap",
    file: "opt_heatmap",
    path: "Optimize / INTC label search / Overview",
    alt: "Labeling optimizer overview: take-profit by stop-loss heatmap at a one-day horizon",
    notes: [
      { label: "Evidence first", body: "The best rule, its limiting assumptions and a recommendation, before any chart.", rect: [1, 0, 98, 19] },
      { label: "TP × SL heatmap", body: "Every take-profit and stop-loss pair at one horizon, on a signed-log scale.", rect: [2, 42, 74, 47] },
      { label: "Selected cell", body: "Label payoff next to its market-valued return, and how it behaves across horizons.", rect: [77, 42, 21, 55] },
    ],
  },
  space: {
    key: "space",
    file: "opt_space",
    path: "Optimize / INTC label search / Search space",
    alt: "Labeling optimizer search space: a 3D cube of take-profit, stop-loss and horizon cells",
    notes: [
      { label: "Parameter cube", body: "Take-profit, stop-loss and horizon on three axes; the top 25% of cells by score are drawn.", rect: [20, 26, 56, 49] },
      { label: "Density filters", body: "Top 1% to all cells, a log horizon axis and faint remaining cells.", rect: [2, 19, 58, 5] },
      { label: "Linked selection", body: "A cell picked here is the same cell in the heatmap and the candidate table.", rect: [80, 24, 18, 20] },
    ],
  },
  representation: {
    key: "representation",
    file: "representation",
    path: "Analyse / Interpretability lab / Representation",
    alt: "Analysis lab representation tab: PCA projection of 500 chart images",
    notes: [
      { label: "PCA projection", body: "Each point is one chart in the 128-d vector the classifier reads. Click to open it.", rect: [1, 11, 65, 81] },
      { label: "Structure", body: "Dead units, explained variance and alignment with the classifier weights.", rect: [67, 11, 32, 51] },
      { label: "Limitations", body: "What two components can and cannot show, stated next to the plot.", rect: [67, 63, 32, 29] },
    ],
  },
  btOverview: {
    key: "btOverview",
    file: "bt_overview",
    path: "Test / Backtest workspace / Overview",
    alt: "Backtest overview: key figures, equity against SPY and MSFT buy-and-hold, and a comparison table",
    notes: [
      { label: "One-sentence verdict", body: "Return at the locked threshold, net of costs, next to its benchmarks.", rect: [1, 10, 98, 17] },
      { label: "Equity and benchmarks", body: "Strategy, SPY, MSFT and an exposure-matched mix from the same start.", rect: [1, 30, 98, 42] },
      { label: "Comparison table", body: "Return, drawdown and Sharpe for every series.", rect: [1, 76, 98, 21] },
    ],
  },
  btRobust: {
    key: "btRobust",
    file: "bt_robust",
    path: "Test / Backtest workspace / Robustness",
    alt: "Backtest robustness: P&L by quarter, win rate by probability, by year, calibration and classification quality",
    notes: [
      { label: "P&L by quarter", body: "Net of commission and slippage; thin quarters are faded.", rect: [1, 10, 48, 33] },
      { label: "Win rate by confidence", body: "95% Wilson intervals per probability bucket.", rect: [50, 10, 49, 30] },
      { label: "Classification quality", body: "ROC-AUC 0.496: no better than chance on this test set.", rect: [50, 70, 49, 30] },
    ],
  },
  lineage: {
    key: "lineage",
    file: "lineage",
    path: "Review / Lineage",
    alt: "Review lineage graph linking generator runs, datasets, training runs, models, test sets and backtests",
    notes: [
      { label: "Generator to model", body: "Generator runs fan out into datasets, training runs and models.", rect: [1, 13, 55, 30] },
      { label: "Evaluation", body: "Test sets, analyses and backtests, tied to the exact model they used.", rect: [57, 13, 42, 37] },
      { label: "Filters", body: "Focus one asset and its full ancestry.", rect: [0, 0, 70, 12] },
    ],
  },
};

const TOOLS: Tool[] = [
  {
    key: "optimizer",
    tool: "Labeling optimizer",
    title: "Find a label rule worth learning",
    summary: "Scores every take-profit, stop-loss and horizon combination, then audits the winner at market prices.",
    provenance: "real",
    source: "INTC · 125,000 cells",
    views: [
      { key: "heatmap", label: "Heatmap", path: SHOT.heatmap.path, shot: SHOT.heatmap },
      { key: "space", label: "3D search space", path: SHOT.space.path, shot: SHOT.space },
    ],
  },
  {
    key: "generator",
    tool: "Generator",
    title: "Turn prices into a labelled image dataset",
    summary: "A window of prices becomes a 224 × 224 chart image, labelled by what happened next.",
    provenance: "real",
    source: "MSFT · real windows and dataset images",
    views: [
      {
        key: "gen",
        label: "Prices to dataset",
        path: "Generate / MSFT · 1D · 6-month windows",
        live: () => <GeneratorDemo />,
        points: [
          { label: "Pick a window", body: "Choose any of six real test windows above." },
          { label: "Render", body: "The window is drawn as the exact image the model reads." },
          { label: "Label", body: "+2% take-profit, −1% stop-loss, 7-bar horizon." },
        ],
      },
    ],
  },
  {
    key: "trainer",
    tool: "Trainer",
    title: "Train a CNN and keep the best weights",
    summary: "Each layer is shown with its real output shape and feature maps. Early stopping keeps the best epoch.",
    provenance: "real",
    source: "MSFT4000 · 2,323 train / 581 validation",
    views: [
      {
        key: "train",
        label: "Architecture and curves",
        path: "Train / MSFT4000 / Training session",
        live: () => <TrainerDemo />,
        points: [
          { label: "Architecture", body: "Three convolution blocks, a dense layer and a sigmoid output." },
          { label: "Curves", body: "Validation loss bottoms out at epoch 5; those weights are kept." },
          { label: "Artifact", body: "A saved model, ready for analysis, backtests and bots." },
        ],
      },
    ],
  },
  {
    key: "analysis",
    tool: "Analysis lab",
    title: "Inspect what the model learned",
    summary: "Attention maps, masking tests and the internal representation, on the model's own charts.",
    provenance: "real",
    source: "MSFT model · 500 images · penultimate layer",
    views: [{ key: "rep", label: "Representation", path: SHOT.representation.path, shot: SHOT.representation }],
  },
  {
    key: "backtester",
    tool: "Backtester",
    title: "Test it on data it never saw",
    summary: "Threshold locked on validation charts, costs charged, buy-and-hold benchmarks on every run. This one lost 9.3%.",
    provenance: "real",
    source: "MSFT · 897 days · threshold 0.38",
    views: [
      { key: "ov", label: "Overview", path: SHOT.btOverview.path, shot: SHOT.btOverview },
      { key: "rb", label: "Robustness", path: SHOT.btRobust.path, shot: SHOT.btRobust },
    ],
  },
  {
    key: "review",
    tool: "Review",
    title: "Trace any result to its inputs",
    summary: "Every dataset, model, analysis and backtest, linked to what produced it.",
    provenance: "real",
    source: "Local workspace · 56 nodes, 60 links",
    views: [{ key: "lin", label: "Lineage", path: SHOT.lineage.path, shot: SHOT.lineage }],
  },
];

/** The one frame used for every product view: same chrome, radius, ratio and caption. */
export function AppFrame({
  path,
  onExpand,
  live = false,
  className,
  children,
}: {
  path: string;
  onExpand?: () => void;
  live?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <figure className={cn("overflow-hidden rounded-[14px] border border-white/[0.1] bg-[#08090b] shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]", className)}>
      <div className="flex h-9 items-center justify-between gap-3 border-b border-white/[0.07] px-3.5">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex gap-1" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-white/15" />
            <span className="h-2 w-2 rounded-full bg-white/10" />
            <span className="h-2 w-2 rounded-full bg-white/10" />
          </span>
          <span className="min-w-0 truncate font-mono text-[10.5px] text-white/45">
            <span className="text-white/70">convolve</span> / {path}
          </span>
        </span>
        {onExpand ? (
          <button
            type="button"
            onClick={onExpand}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white/45 transition-colors hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50"
          >
            <Maximize2 className="h-3 w-3" aria-hidden />
            Expand
          </button>
        ) : (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-white/30">Interactive</span>
        )}
      </div>
      <div className={cn("relative overflow-hidden", live ? "md:aspect-[16/10]" : "aspect-[16/10]")}>{children}</div>
    </figure>
  );
}

export function ScreenFrame({ shot, highlight, onExpand, className }: { shot: Shot; highlight?: Rect | null; onExpand?: () => void; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <AppFrame path={shot.path} onExpand={onExpand} className={className}>
      <img src={screen(shot.file)} alt={shot.alt} width={1920} height={1200} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full select-none" draggable={false} />
      <AnimatePresence>
        {highlight ? (
          <motion.div
            key="hl"
            aria-hidden
            className="pointer-events-none absolute rounded-[8px] border border-white/80"
            style={{ boxShadow: "0 0 0 9999px rgba(3,4,6,0.62), 0 0 0 4px rgba(255,255,255,0.06)" }}
            initial={{ opacity: 0, left: `${highlight[0]}%`, top: `${highlight[1]}%`, width: `${highlight[2]}%`, height: `${highlight[3]}%` }}
            animate={{ opacity: 1, left: `${highlight[0]}%`, top: `${highlight[1]}%`, width: `${highlight[2]}%`, height: `${highlight[3]}%` }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.45, ease: EASE }}
          />
        ) : null}
      </AnimatePresence>
    </AppFrame>
  );
}

function Lightbox({ shot, onClose }: { shot: Shot; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`${shot.path}, full size`}
      className="fixed inset-0 z-[10000] flex flex-col bg-black/92 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-4 border-b border-white/[0.08] px-5 py-3">
        <div className="min-w-0 truncate font-mono text-[11.5px] text-white/60">convolve / {shot.path}</div>
        <button
          type="button"
          onClick={onClose}
          autoFocus
          className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-[13px] text-white/80 hover:border-white/40 hover:text-white"
        >
          <X className="h-4 w-4" aria-hidden />
          Close
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-8">
        <img
          src={screen(shot.file)}
          alt={shot.alt}
          width={1920}
          height={1200}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full w-auto max-w-full rounded-lg border border-white/10 object-contain"
        />
      </div>
    </motion.div>
  );
}

export function useLightbox() {
  const [open, setOpen] = useState<Shot | null>(null);
  const node = <AnimatePresence>{open ? <Lightbox key={open.key} shot={open} onClose={() => setOpen(null)} /> : null}</AnimatePresence>;
  return { openShot: setOpen, lightbox: node };
}

export function Showcase() {
  const reduce = useReducedMotion();
  const [toolIdx, setToolIdx] = useState(0);
  const [viewIdx, setViewIdx] = useState(0);
  const [note, setNote] = useState<number | null>(null);
  const { openShot, lightbox } = useLightbox();
  const stage = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start end", "start 0.3"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [reduce ? 0 : 10, 0]);
  const scaleV = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0.95, 1]);
  const tool = TOOLS[toolIdx];
  const view = tool.views[Math.min(viewIdx, tool.views.length - 1)];

  const selectTool = (i: number) => {
    setToolIdx(i);
    setViewIdx(0);
    setNote(null);
  };

  return (
    <div>
      <div role="tablist" aria-label="Convolve tools" className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-2 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        {TOOLS.map((tl, i) => (
          <button
            key={tl.key}
            role="tab"
            aria-selected={i === toolIdx}
            onClick={() => selectTool(i)}
            className={cn(
              "shrink-0 rounded-full border px-4 py-2 text-[13px] transition-colors duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
              i === toolIdx ? "border-white/40 bg-white/[0.08] text-white" : "border-white/[0.09] text-white/50 hover:border-white/20 hover:text-white/80"
            )}
          >
            {tl.tool}
          </button>
        ))}
      </div>

      <div ref={stage} className="mt-8 grid gap-8 lg:grid-cols-12 lg:gap-10" style={{ perspective: 1800 }}>
        <motion.div className="min-w-0 lg:col-span-9" style={{ rotateX, scale: scaleV, transformOrigin: "50% 0%" }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${tool.key}-${view.key}`}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, filter: "blur(4px)" }}
              transition={{ duration: 0.4, ease: EASE }}
            >
              {view.shot ? (
                <ScreenFrame shot={view.shot} highlight={note == null ? null : view.shot.notes[note]?.rect} onExpand={() => openShot(view.shot!)} />
              ) : (
                <AppFrame path={view.path} live>
                  {view.live?.()}
                </AppFrame>
              )}
            </motion.div>
          </AnimatePresence>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <ProvenanceTag kind={tool.provenance} detail={tool.source} />
            <span className="font-mono text-[10.5px] text-white/30">
              {view.shot ? "Screenshot of the running app" : "Live component built from the run's saved outputs"}
            </span>
          </div>
        </motion.div>

        <div className="lg:col-span-3">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tool.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.25 }}>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">{tool.tool}</div>
              <h3 className="mt-2 text-[22px] font-medium leading-tight tracking-[-0.02em] text-white">{tool.title}</h3>
              <p className="mt-3 text-[14px] leading-relaxed text-white/55">{tool.summary}</p>
              {tool.views.length > 1 ? (
                <div className="mt-5 inline-flex rounded-full border border-white/[0.1] p-0.5" role="group" aria-label="View">
                  {tool.views.map((v, i) => (
                    <button
                      key={v.key}
                      type="button"
                      aria-pressed={v.key === view.key}
                      onClick={() => {
                        setViewIdx(i);
                        setNote(null);
                      }}
                      className={cn("rounded-full px-3 py-1 text-[12px] transition-colors", v.key === view.key ? "bg-white text-black" : "text-white/55 hover:text-white")}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <ul className="mt-6 border-t border-white/[0.08]" onMouseLeave={() => setNote(null)}>
                {(view.shot ? view.shot.notes : view.points ?? []).map((n, i) => (
                  <li key={n.label} className="border-b border-white/[0.08]">
                    <button
                      type="button"
                      onMouseEnter={() => view.shot && setNote(i)}
                      onFocus={() => view.shot && setNote(i)}
                      onBlur={() => setNote(null)}
                      className="flex w-full gap-3 py-3 text-left focus:outline-none"
                    >
                      <span className={cn("mt-[3px] font-mono text-[10px] tabular-nums transition-colors", note === i ? "text-white" : "text-white/30")}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>
                        <span className={cn("block text-[14px] transition-colors", note === i ? "text-white" : "text-white/80")}>{n.label}</span>
                        <span className="mt-0.5 block text-[12.5px] leading-snug text-white/40">{n.body}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      {lightbox}
    </div>
  );
}
