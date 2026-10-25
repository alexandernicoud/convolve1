import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { screen, type Provenance } from "../data";
import { SYSTEM, int, trainingSetups } from "../figures";
import { EASE, Kicker, ProvenanceTag, TYPE, useMediaQuery } from "../ui";
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
  heading: string;
  path: string;
  shot?: Shot;
  live?: (sub?: number) => ReactNode;
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
    path: "Optimize / Label search / Overview",
    alt: "Labeling optimizer overview: take-profit by stop-loss heatmap at a one-day horizon",
    notes: [
      { label: "Evidence first", body: "The best rule, its limiting assumptions and a recommendation, before any chart.", rect: [1, 0, 98, 19] },
      { label: "TP × SL heatmap", body: "Every take-profit and stop-loss pair at one horizon, on a signed-log scale.", rect: [2, 42, 74, 47] },
      { label: "Selected cell", body: "Label payoff next to its market-valued return, and how it behaves across horizons.", rect: [77, 42, 21, 55] },
    ],
  },
  space: {
    key: "space",
    file: "opt_scatter",
    path: "Optimize / Label search / Search space",
    alt: "Labeling optimizer parameter-space scatter: all 125,000 grid cells, market-valued CAGR against label-payoff CAGR, ranked candidates ringed",
    notes: [
      { label: "125,000 cells", body: "Every take-profit, stop-loss and horizon rule of one run, shaded by horizon.", rect: [13, 6, 20, 72] },
      { label: "Ranked candidates", body: "The 15 best label payoffs, 582% to 842%, fall to between −43% and +42% once open trades are valued at market.", rect: [62, 34, 17, 31] },
      { label: "Selected cell", body: "The same cell is selected in the heatmap, the 3D view and the candidate table.", rect: [82, 56, 5, 8] },
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
    alt: "Backtest overview: key figures, equity against SPY and buy-and-hold, and a comparison table",
    notes: [
      { label: "One-sentence verdict", body: "Return at the locked threshold, net of costs, next to its benchmarks.", rect: [1, 10, 98, 17] },
      { label: "Equity and benchmarks", body: "Strategy, SPY, the asset itself and an exposure-matched mix from the same start.", rect: [1, 30, 98, 42] },
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
    summary: "Every take-profit, stop-loss and horizon pair, scored and audited at market prices.",
    provenance: "real",
    source: "125,000 rule combinations scored",
    views: [
      { key: "heatmap", label: "Heatmap", heading: "Score every label rule before you train.", path: SHOT.heatmap.path, shot: SHOT.heatmap },
      { key: "space", label: "Search space", heading: "See the whole search space at once.", path: SHOT.space.path, shot: SHOT.space },
    ],
  },
  {
    key: "generator",
    tool: "Generator",
    title: "Turn prices into a labelled dataset",
    summary: "Each window becomes the exact 224 × 224 image the network reads, labelled by what happened next.",
    provenance: "real",
    source: "Real price windows and dataset images",
    views: [
      {
        key: "gen",
        label: "Prices to dataset",
        heading: "Turn prices into labelled chart images.",
        path: "Generate / Daily bars · 6-month windows",
        live: (sub) => <GeneratorDemo sample={sub == null ? undefined : Math.min(5, Math.floor(sub * 6))} />,
        points: [
          { label: "Window", body: "Six months of real daily prices." },
          { label: "Image", body: "Rendered at 224 × 224." },
          { label: "Label", body: "+2% before −1% within 7 bars." },
        ],
      },
    ],
  },
  {
    key: "trainer",
    tool: "Trainer",
    title: "Architecture is a research variable",
    summary: `Choose the network, optimiser, learning-rate schedule and augmentation: ${int(trainingSetups().total)} discrete setups for one dataset, each a hypothesis you can compare against the others.`,
    provenance: "real",
    source: "2,323 training / 581 validation charts",
    views: [
      {
        key: "train",
        label: "Architecture and curves",
        heading: "Architecture is a research variable.",
        path: "Train / Training session",
        live: (sub) => <TrainerDemo focus={sub == null ? undefined : Math.min(8, Math.floor(sub * 9))} />,
        points: [
          { label: "Architecture", body: `The original CNN shown here, or one of ${SYSTEM.architectureCount - 1} others up to ResNet-18 and EfficientNet-B0.` },
          { label: "Curves", body: "Validation loss bottoms at epoch 5; that epoch is kept." },
          { label: "Compare", body: "Same split, same metrics. A larger network is not assumed better." },
        ],
      },
    ],
  },
  {
    key: "analysis",
    tool: "Analysis lab",
    title: "Inspect what the model learned",
    summary: "Attention, masking tests and the internal representation, on the model's own charts.",
    provenance: "real",
    source: "500 charts · penultimate layer",
    views: [{ key: "rep", label: "Representation", heading: "Inspect what the model learned.", path: SHOT.representation.path, shot: SHOT.representation }],
  },
  {
    key: "backtester",
    tool: "Backtester",
    title: "Test it on data it never saw",
    summary: "Threshold locked on validation, costs charged, benchmarks on every run. A losing result is still a result.",
    provenance: "real",
    source: "897 unseen trading days",
    views: [
      { key: "ov", label: "Overview", heading: "Test it on data it never saw.", path: SHOT.btOverview.path, shot: SHOT.btOverview },
      { key: "rb", label: "Robustness", heading: "Check whether the result holds up.", path: SHOT.btRobust.path, shot: SHOT.btRobust },
    ],
  },
  {
    key: "review",
    tool: "Review",
    title: "Trace any result to its inputs",
    summary: "Datasets, models, analyses and backtests, linked to what produced them.",
    provenance: "real",
    source: "Example workspace · 56 nodes, 60 links",
    views: [{ key: "lin", label: "Lineage", heading: "Trace every result to its inputs.", path: SHOT.lineage.path, shot: SHOT.lineage }],
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

function ShotBody({ shot, highlight }: { shot: Shot; highlight?: Rect | null }) {
  const reduce = useReducedMotion();
  return (
    <>
      <img src={screen(shot.file)} alt={shot.alt} width={1920} height={1200} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full select-none" draggable={false} />
      <AnimatePresence>
        {highlight ? (
          <motion.div
            key="hl"
            aria-hidden
            className="pointer-events-none absolute rounded-[8px] border border-white/70"
            style={{ boxShadow: "0 0 0 9999px rgba(3,4,6,0.5), 0 0 0 4px rgba(185,211,255,0.06)" }}
            initial={{ opacity: 0, left: `${highlight[0]}%`, top: `${highlight[1]}%`, width: `${highlight[2]}%`, height: `${highlight[3]}%` }}
            animate={{ opacity: 1, left: `${highlight[0]}%`, top: `${highlight[1]}%`, width: `${highlight[2]}%`, height: `${highlight[3]}%` }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.6, ease: EASE }}
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}

export function ScreenFrame({ shot, highlight, onExpand, className }: { shot: Shot; highlight?: Rect | null; onExpand?: () => void; className?: string }) {
  return (
    <AppFrame path={shot.path} onExpand={onExpand} className={className}>
      <ShotBody shot={shot} highlight={highlight} />
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

const STEP_VH = 90;

/** Desktop: the frame stays pinned and scrolling advances tool and view; each view has one title. */
function PinnedShowcase() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [p, setP] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", setP);
  const { openShot, lightbox } = useLightbox();

  const n = TOOLS.length;
  const f = Math.min(n - 1e-6, Math.max(0, p * n));
  const idx = Math.floor(f);
  const sub = f - idx;
  const tool = TOOLS[idx];
  const vIdx = Math.min(tool.views.length - 1, Math.floor(sub * tool.views.length));
  const view = tool.views[vIdx];
  const vSub = Math.min(0.999, sub * tool.views.length - vIdx);

  const jump = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const travel = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + travel * ((i + 0.04) / n), behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div ref={ref} className="relative" style={{ height: `${n * STEP_VH}vh` }}>
      <div className="sticky top-[80px] flex h-[calc(100svh-80px)] flex-col justify-center">
        <div className="mx-auto w-full" style={{ maxWidth: "calc((100svh - 300px) * 1.6)" }}>
          <ol className="grid grid-cols-6 gap-4" aria-label="Tools in order">
            {TOOLS.map((tl, i) => {
              const fill = i < idx ? 1 : i === idx ? sub : 0;
              return (
                <li key={tl.key}>
                  <button type="button" onClick={() => jump(i)} aria-current={i === idx ? "step" : undefined} className="group block w-full text-left focus:outline-none">
                    <span className="flex items-baseline gap-2">
                      <span className={cn("font-mono text-[11px] tabular-nums transition-colors duration-500", i === idx ? "text-white" : "text-white/30")}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className={cn("truncate text-[14.5px] transition-colors duration-500", i === idx ? "text-white" : "text-white/40 group-hover:text-white/70")}>{tl.tool}</span>
                    </span>
                    <span className="mt-2.5 block h-px w-full bg-white/[0.1]">
                      <span className="block h-full origin-left bg-white/70" style={{ transform: `scaleX(${fill})` }} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="relative mt-7 h-[clamp(2.4rem,3vw,3.2rem)]">
            <AnimatePresence initial={false}>
              <motion.h3
                key={`${tool.key}-${view.key}`}
                className="absolute inset-x-0 top-0 truncate text-[clamp(1.6rem,2.2vw,2.4rem)] font-normal leading-[1.15] tracking-[-0.03em] text-white"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 22, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -16, filter: "blur(6px)" }}
                transition={{ duration: reduce ? 0 : 0.55, ease: EASE }}
              >
                {view.heading}
              </motion.h3>
            </AnimatePresence>
          </div>

          <div className="mt-5">
            <AppFrame path={view.path} onExpand={view.shot ? () => openShot(view.shot!) : undefined}>
              <AnimatePresence initial={false}>
                <motion.div
                  key={`${tool.key}-${view.key}`}
                  className="absolute inset-0"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.015, filter: "blur(4px)" }}
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.55, ease: EASE }}
                >
                  {view.shot ? <ShotBody shot={view.shot} /> : view.live?.(vSub)}
                </motion.div>
              </AnimatePresence>
            </AppFrame>
            <div className="mt-3 flex items-center justify-between gap-3">
              <ProvenanceTag kind={tool.provenance} detail={tool.source} />
            </div>
          </div>
        </div>
      </div>
      {lightbox}
    </div>
  );
}

/** Small screens: the same six steps, stacked, no clicking required. */
function StackedShowcase() {
  const { openShot, lightbox } = useLightbox();
  return (
    <div className="space-y-14">
      {TOOLS.map((tl, i) => {
        const v = tl.views[0];
        return (
          <div key={tl.key}>
            <Kicker index={String(i + 1).padStart(2, "0")}>{tl.tool}</Kicker>
            <h3 className={`mt-3 ${TYPE.h3Card}`}>{v.heading}</h3>
            <div className="mt-5">
              {v.shot ? (
                <ScreenFrame shot={v.shot} onExpand={() => openShot(v.shot!)} />
              ) : (
                <AppFrame path={v.path} live>
                  {v.live?.()}
                </AppFrame>
              )}
            </div>
            <div className="mt-3">
              <ProvenanceTag kind={tl.provenance} detail={tl.source} />
            </div>
          </div>
        );
      })}
      {lightbox}
    </div>
  );
}

export function Showcase() {
  const lg = useMediaQuery("(min-width: 1024px)");
  return lg ? <PinnedShowcase /> : <StackedShowcase />;
}
