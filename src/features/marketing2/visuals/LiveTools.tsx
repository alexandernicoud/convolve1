import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHAIN, asset, grid, hero, labmaps, training } from "../data";
import { EASE, fmtDate, linePath, scale } from "../ui";

const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function Caption({ n, children }: { n: number; children: string }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
      <span className="text-white/75">{n}</span> · {children}
    </div>
  );
}

/* ------------------------------------------------------------------ generator */

const GW = 600;
const GH = 260;

/** `sample` lets a scroll sequence drive which real window is shown; the chips still work. */
export function GeneratorDemo({ sample }: { sample?: number }) {
  const [idx, setIdx] = useState(sample ?? labmaps.trace_index);
  useEffect(() => {
    if (sample != null) setIdx(sample);
  }, [sample]);
  const s = labmaps.samples[idx];
  const g = useMemo(() => {
    const weekly = hero.weekly;
    const x = scale(t(weekly[0].d), t(weekly[weekly.length - 1].d), 8, GW - 8);
    const y = scale(Math.min(...weekly.map((c) => c.l)), Math.max(...weekly.map((c) => c.h)), GH - 8, 8);
    return { weekly, x, y, body: Math.max(1.6, ((GW - 16) / weekly.length) * 0.55) };
  }, []);
  const a = g.x(t(s.start));
  const b = g.x(t(s.date));
  const tiles = grid.tiles.slice(1, 17);

  return (
    <div className="grid h-full grid-cols-1 gap-5 p-4 sm:p-5 md:grid-cols-[1.45fr_1fr] md:gap-6">
      <div className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between gap-3">
          <Caption n={1}>Prices · MSFT, weekly view</Caption>
          <div className="flex flex-wrap justify-end gap-1">
            {labmaps.samples.map((smp, i) => (
              <button
                key={smp.date}
                type="button"
                onClick={() => setIdx(i)}
                aria-pressed={i === idx}
                className={cn(
                  "rounded-full px-2 py-0.5 font-mono text-[10px] transition-colors",
                  i === idx ? "bg-white text-black" : "text-white/45 hover:bg-white/[0.06] hover:text-white"
                )}
              >
                {fmtDate(smp.date, { month: "short", year: "2-digit" })}
              </button>
            ))}
          </div>
        </div>
        <svg viewBox={`0 0 ${GW} ${GH}`} className="mt-3 block h-auto w-full" role="img" aria-label="MSFT price history with the selected six-month window">
          <defs>
            <linearGradient id="m2-gen-ink" gradientUnits="userSpaceOnUse" x1={a} x2={b} y1="0" y2="0">
              <stop offset="0%" stopColor="#7fa8ff" />
              <stop offset="55%" stopColor="#5fc8d0" />
              <stop offset="100%" stopColor="#a6ecc8" />
            </linearGradient>
          </defs>
          {g.weekly.map((c) => {
            const cx = g.x(t(c.d));
            const inB = cx >= a && cx <= b;
            const ink = inB ? "url(#m2-gen-ink)" : "rgba(255,255,255,0.28)";
            return (
              <g key={c.d}>
                <line x1={cx} x2={cx} y1={g.y(c.h)} y2={g.y(c.l)} stroke={ink} strokeWidth="0.8" />
                <rect x={cx - g.body / 2} y={g.y(Math.max(c.o, c.c))} width={g.body} height={Math.max(1, Math.abs(g.y(c.o) - g.y(c.c)))} fill={c.c >= c.o ? "#08090b" : ink} stroke={ink} strokeWidth="0.8" />
              </g>
            );
          })}
          <motion.rect
            initial={false}
            animate={{ x: a, width: b - a }}
            transition={{ duration: 0.6, ease: EASE }}
            y="1"
            height={GH - 2}
            rx="3"
            fill="rgba(185,211,255,0.07)"
            stroke="#b9d3ff"
            strokeOpacity="0.45"
          />
        </svg>

        <div className="mt-auto grid grid-cols-[auto_auto_1fr] items-center gap-3 pt-5 sm:gap-4">
          <div>
            <Caption n={2}>Window</Caption>
            <div className="mt-2 font-mono text-[11.5px] leading-relaxed text-white/80">
              {fmtDate(s.start, { day: "numeric", month: "short", year: "numeric" })}
              <br />→ {fmtDate(s.date, { day: "numeric", month: "short", year: "numeric" })}
            </div>
          </div>
          <div>
            <Caption n={3}>Image</Caption>
            <AnimatePresence mode="wait" initial={false}>
              <motion.img
                key={s.input}
                src={asset(s.input)}
                alt={`Rendered chart image for the window ending ${s.date}`}
                className="mt-2 aspect-square w-[clamp(88px,11vw,132px)] rounded-[6px] border border-white/15 bg-[#050506]"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              />
            </AnimatePresence>
          </div>
          <div className="min-w-0">
            <Caption n={4}>Label</Caption>
            <div className="mt-2 rounded-[8px] border border-white/[0.1] bg-white/[0.03] p-3">
              <div className="text-[20px] font-medium tracking-tight text-white">Label {s.label}</div>
              <div className="mt-1 text-[12px] leading-snug text-white/50">
                {s.label ? "Take-profit reached first" : "Take-profit not reached first"}
              </div>
              <div className="mt-2 font-mono text-[10px] text-white/35">
                rule +{grid.tp * 100}% / −{grid.sl * 100}% / {grid.horizon} bars
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-col border-white/[0.07] md:border-l md:pl-6">
        <div className="flex items-center justify-between">
          <Caption n={5}>Dataset</Caption>
          <span className="font-mono text-[10px] text-white/35">{CHAIN.dataset}</span>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {tiles.map((tl) => (
            <div key={tl.file} className="relative overflow-hidden rounded-[4px] border border-white/[0.07] bg-[#050506]">
              <img src={asset(tl.file)} alt="" className="aspect-square w-full" loading="lazy" />
              <span className={cn("absolute right-1 top-1 h-1.5 w-1.5 rounded-full", tl.label ? "bg-[#8fe0c0]" : "bg-white/30")} aria-hidden />
            </div>
          ))}
        </div>
        <div className="mt-auto flex items-baseline justify-between gap-3 pt-4 text-[12px] text-white/50">
          <span>
            <span className="text-[18px] font-medium text-white tabular-nums">{grid.count.toLocaleString("en-US")}</span> images
            <span className="ml-2 inline-flex items-center gap-1 text-white/40">
              <ArrowRight className="h-3 w-3" aria-hidden /> Trainer input
            </span>
          </span>
          <span className="inline-flex items-center gap-3 font-mono text-[10px]">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[#8fe0c0]" /> label 1
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-white/30" /> label 0
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- trainer */

const FEATS_BY_LAYER: Record<string, string[]> = Object.fromEntries(labmaps.features.map((f) => [f.name, f.files.slice(0, 3)]));
const SAMPLE = labmaps.samples[labmaps.trace_index];

function shape(out: number[]) {
  return out.length === 3 ? `${out[0]}×${out[1]}×${out[2]}` : out.map((v) => v.toLocaleString("en-US")).join("×");
}

function Curves() {
  const CW = 320;
  const CHh = 150;
  const d = useMemo(() => {
    const e = training.epochs;
    const all = e.flatMap((r) => [r.loss, r.val_loss]);
    const x = scale(1, e.length, 26, CW - 6);
    const y = scale(Math.min(...all), Math.max(...all), CHh - 18, 8);
    return {
      tr: linePath(e.map((r) => [x(r.e), y(r.loss)])),
      va: linePath(e.map((r) => [x(r.e), y(r.val_loss)])),
      best: x(training.best_epoch),
      n: e.length,
      x,
      lo: Math.min(...all),
      hi: Math.max(...all),
    };
  }, []);
  return (
    <svg viewBox={`0 0 ${CW} ${CHh}`} className="block h-auto w-full" role="img" aria-label="Training and validation loss per epoch">
      <defs>
        <linearGradient id="m2-tr-val" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#7fa8ff" />
          <stop offset="100%" stopColor="#a6ecc8" />
        </linearGradient>
      </defs>
      <line x1={d.best} x2={d.best} y1="4" y2={CHh - 18} stroke="#b9d3ff" strokeOpacity="0.5" strokeDasharray="3 3" />
      <text x={d.best + 4} y="12" fill="#b9d3ff" fillOpacity="0.8" fontSize="9" fontFamily="ui-monospace, monospace">
        restored · epoch {training.best_epoch}
      </text>
      <path d={d.tr} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.4" />
      <path d={d.va} fill="none" stroke="url(#m2-tr-val)" strokeWidth="1.8" />
      {Array.from({ length: d.n }, (_, i) => (
        <text key={i} x={d.x(i + 1)} y={CHh - 4} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="ui-monospace, monospace">
          {i + 1}
        </text>
      ))}
      <text x="0" y="12" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="ui-monospace, monospace">
        {d.hi.toFixed(2)}
      </text>
      <text x="0" y={CHh - 20} fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="ui-monospace, monospace">
        {d.lo.toFixed(2)}
      </text>
    </svg>
  );
}

/** `focus` lets a scroll sequence walk through the layers; hovering still overrides it. */
export function TrainerDemo({ focus }: { focus?: number }) {
  const [hoverIdx, setHover] = useState<number | null>(null);
  const hover = hoverIdx ?? focus ?? null;
  const best = training.epochs[training.best_epoch - 1];
  const layers = training.arch;
  const maxSide = 224;

  return (
    <div className="flex h-full flex-col gap-5 p-4 sm:p-5">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between">
          <Caption n={1}>Architecture · input to output</Caption>
          <span className="font-mono text-[10px] text-white/35">{training.params.toLocaleString("en-US")} parameters</span>
        </div>
        <div
          className="my-auto flex items-center justify-between gap-2 overflow-x-auto pb-1 pt-6 [scrollbar-width:none]"
          style={{ ["--B" as string]: "clamp(44px, 9.5vw, 132px)" }}
        >
          <div className="flex shrink-0 flex-col items-center">
            <img src={asset(SAMPLE.input)} alt="" style={{ width: "var(--B)" }} className="rounded-[4px] border border-white/20 bg-[#050506]" />
            <div className="mt-2 font-mono text-[9.5px] text-white/60">input</div>
            <div className="font-mono text-[9px] text-white/30">224×224×3</div>
          </div>
          {layers.map((l, i) => {
            const on = hover === i;
            const side = l.out.length === 3 ? l.out[0] : 0;
            const sizeCls = { width: `max(10px, calc(var(--B) * ${(side / maxSide).toFixed(3)}))` };
            const feats = FEATS_BY_LAYER[l.name];
            return (
              <button
                key={l.name}
                type="button"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="flex shrink-0 flex-col items-center focus:outline-none"
              >
                {l.kind === "Conv2D" && feats ? (
                  <div className="relative" style={{ ...sizeCls, aspectRatio: "1 / 1", marginLeft: 8, marginTop: 8 }}>
                    {feats.map((f, k) => (
                      <img
                        key={f}
                        src={asset(f)}
                        alt=""
                        className={cn("absolute inset-0 aspect-square w-full rounded-[3px] border [image-rendering:pixelated] transition-colors", on ? "border-white" : "border-white/20")}
                        style={{ transform: `translate(${(k - 2) * 4}px, ${(2 - k) * 4}px)` }}
                      />
                    ))}
                  </div>
                ) : l.kind === "MaxPooling2D" ? (
                  <div style={sizeCls} className={cn("aspect-square rounded-[3px] border border-dashed transition-colors", on ? "border-white" : "border-white/25")} />
                ) : (
                  <div
                    className={cn("w-3 rounded-[2px] border transition-colors", on ? "border-white bg-white/30" : "border-white/25 bg-white/[0.06]")}
                    style={{ height: l.name === "dense_1" ? 12 : l.kind === "Flatten" ? "var(--B)" : "calc(var(--B) * 0.45)" }}
                  />
                )}
                <div className={cn("mt-2 font-mono text-[9.5px] transition-colors", on ? "text-white" : "text-white/60")}>
                  {l.kind === "Conv2D" ? "conv 3×3" : l.kind === "MaxPooling2D" ? "pool" : l.kind === "Flatten" ? "flatten" : l.name === "dense_1" ? "σ" : "dense"}
                </div>
                <div className="font-mono text-[9px] text-white/30">{shape(l.out)}</div>
              </button>
            );
          })}
        </div>
        <div className="mt-4 min-h-4 font-mono text-[10px] text-white/45">
          {hover != null
            ? `${layers[hover].name} · ${layers[hover].kind} · output ${shape(layers[hover].out)} · ${layers[hover].params.toLocaleString("en-US")} parameters`
            : "Hover a layer. Each conv block stacks three of its real feature maps, drawn to scale."}
        </div>
      </div>

      <div className="mt-auto grid grid-cols-1 gap-5 border-t border-white/[0.07] pt-4 sm:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <div className="flex items-center justify-between">
            <Caption n={2}>Loss per epoch</Caption>
            <span className="flex gap-3 font-mono text-[9.5px] text-white/40">
              <span className="text-[#8fd6d0]">— validation</span>
              <span className="text-white/30">— training</span>
            </span>
          </div>
          <div className="mt-2">
            <Curves />
          </div>
        </div>
        <div>
          <Caption n={3}>Best epoch metrics</Caption>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            {[
              ["Val. accuracy", pct(best.val_acc)],
              ["Val. loss", best.val_loss.toFixed(4)],
              ["Train accuracy", pct(best.acc)],
              ["Train loss", best.loss.toFixed(4)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] text-white/40">{k}</dt>
                <dd className="text-[17px] font-medium tracking-tight text-white tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 font-mono text-[9.5px] text-white/35">
            {training.train_samples.toLocaleString("en-US")} train · {training.val_samples} validation
          </div>
        </div>
        <div>
          <Caption n={4}>Saved model</Caption>
          <div className="mt-3 rounded-[10px] border border-white/[0.12] bg-white/[0.03] p-3.5">
            <div className="text-[15px] font-medium text-white">{CHAIN.modelName}</div>
            <div className="mt-1 font-mono text-[10px] text-white/40">run {CHAIN.trainingRun}</div>
            <div className="mt-3 text-[12px] leading-snug text-white/55">
              Weights from epoch {training.best_epoch} of {training.epochs_trained} restored by early stopping on {training.monitor}.
            </div>
            <div className="mt-3 inline-flex items-center gap-1 text-[11.5px] text-white/70">
              Next: analyse or backtest <ArrowRight className="h-3 w-3" aria-hidden />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
