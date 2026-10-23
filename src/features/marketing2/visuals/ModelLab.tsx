import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useReducedMotion, type MotionValue } from "framer-motion";
import { cn } from "@/lib/utils";
import { CHAIN, asset, labmaps, type LabMethod } from "../data";
import { FitLine, Frac, I, Sum } from "./math";
import { ProvenanceTag, fmtDate, useStep } from "../ui";

type Method = LabMethod | "features";

const METHODS: { key: Method; label: string }[] = [
  { key: "gradcam", label: "Grad-CAM" },
  { key: "saliency", label: "Saliency" },
  { key: "smoothgrad", label: "SmoothGrad" },
  { key: "occlusion", label: "Occlusion" },
  { key: "features", label: "Feature maps" },
];

const METHOD_INFO: Record<Method, { formula: ReactNode; scale: "sequential" | "diverging" | "features"; ends: [string, string]; note: string }> = {
  gradcam: {
    formula: (
      <>
        <I>α</I>
        <sub>k</sub> = <Frac n="1" d={<I>Z</I>} />
        <Sum sub="i,j" />
        <Frac n={<>∂<I>p</I></>} d={<>∂<I>A</I><sup>k</sup><sub>ij</sub></>} />, &nbsp; <I>M</I> = ReLU(<Sum sub="k" />
        <I>α</I>
        <sub>k</sub>
        <I>A</I>
        <sup>k</sup>)
      </>
    ),
    scale: "sequential",
    ends: ["0", "image max"],
    note: `Gradient-weighted activations of ${labmaps.layer} (52 × 52), upsampled to 224 px.`,
  },
  saliency: {
    formula: (
      <>
        <I>S</I>(<I>i</I>,<I>j</I>) = max<sub>c</sub> |∂<I>p</I> / ∂<I>x</I>
        <sub>c</sub>(<I>i</I>,<I>j</I>)|
      </>
    ),
    scale: "sequential",
    ends: ["0", "99.5th pct."],
    note: "How much each input pixel can move the probability, at this exact image.",
  },
  smoothgrad: {
    formula: (
      <>
        <I>S̄</I> = <Frac n="1" d="16" />
        <Sum sub="n" />
        <I>S</I>(<I>x</I> + <I>ε</I>
        <sub>n</sub>), &nbsp; <I>ε</I> ~ 𝒩(0, 0.1²)
      </>
    ),
    scale: "sequential",
    ends: ["0", "99.5th pct."],
    note: "Saliency averaged over 16 noisy copies of the chart, which removes gradient speckle.",
  },
  occlusion: {
    formula: (
      <>
        Δ<I>p</I>(<I>r</I>) = <I>p</I>(<I>x</I> with patch <I>r</I> blanked) − <I>p</I>(<I>x</I>)
      </>
    ),
    scale: "diverging",
    ends: ["lowers p", "raises p"],
    note: "The model is re-run with each 32 px patch blanked (stride 16). Blue regions support the prediction.",
  },
  features: {
    formula: (
      <>
        <I>a</I>
        <sub>k</sub> = ReLU(<I>z</I>
        <sub>k</sub>) = max(0, <I>z</I>
        <sub>k</sub>)
      </>
    ),
    scale: "features",
    ends: ["0", "channel max"],
    note: "Activations of individual filters for this chart. Early layers trace candles; later layers respond to larger shapes.",
  },
};

function Colorbar({ kind, ends, label }: { kind: "sequential" | "diverging" | "features"; ends: [string, string]; label: string }) {
  const stops = labmaps.colormaps[kind].stops;
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.14em] text-white/40">{label}</span>
      <div className="min-w-0 flex-1">
        <div className="h-2 w-full rounded-full" style={{ background: `linear-gradient(90deg, ${stops.join(",")})` }} />
        <div className="mt-1 flex justify-between font-mono text-[9.5px] text-white/40">
          <span>{ends[0]}</span>
          {kind === "diverging" ? <span>no change</span> : null}
          <span>{ends[1]}</span>
        </div>
      </div>
    </div>
  );
}

/** Scroll-story phases: 0 chart · 1 attention · 2 evidence · 3 method · 4 output. */
export const LAB_STEPS = ["Chart", "Attention", "Evidence", "Method", "Output"];

function Explorer({ phase = 4 }: { phase?: number }) {
  const [idx, setIdx] = useState(labmaps.trace_index);
  const [method, setMethod] = useState<Method>("gradcam");
  const [mix, setMix] = useState(0.85);
  const [split, setSplit] = useState(false);
  const [layer, setLayer] = useState(0);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [free, setFree] = useState(false);
  const ph = free ? 4 : phase;
  const touch = <T,>(fn: (v: T) => void) => (v: T) => {
    setFree(true);
    fn(v);
  };
  const info = METHOD_INFO[method];
  const features = method === "features";
  const s = labmaps.samples[features ? labmaps.trace_index : idx];
  const map = features ? null : s[method as LabMethod];
  const occl = method === "occlusion";
  const occMax = Math.max(Math.abs(s.occlusion_range[0]), Math.abs(s.occlusion_range[1]));
  const label = METHODS.find((m) => m.key === method)?.label ?? "";

  const track = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setCursor([((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100]);
  };

  const Cross = () =>
    cursor ? (
      <>
        <span className="pointer-events-none absolute inset-y-0 w-px bg-white/60" style={{ left: `${cursor[0]}%` }} />
        <span className="pointer-events-none absolute inset-x-0 h-px bg-white/60" style={{ top: `${cursor[1]}%` }} />
      </>
    ) : null;

  const caption =
    ph === 0
      ? "Input · the 224 × 224 chart image"
      : ph === 1
        ? `${label} · where the decision came from`
        : method === "gradcam"
          ? `${Math.round(s.gradcam_on_candles * 100)}% of attention on candle pixels, which cover ${Math.round(s.foreground * 100)}% of the image`
          : null;

  const panel = (body: ReactNode, name: string, withCaption: boolean) => (
    <div className="min-w-0">
      <div
        className="relative aspect-square w-full cursor-crosshair overflow-hidden rounded-[10px] border border-white/[0.1] bg-[#050506]"
        onPointerMove={track}
        onPointerLeave={() => setCursor(null)}
      >
        {body}
        <Cross />
        {withCaption && caption && !free && ph < 3 ? (
          <span className="pointer-events-none absolute bottom-2.5 left-2.5 right-2.5 rounded-md bg-black/70 px-2.5 py-1.5 font-mono text-[10.5px] text-white/85 backdrop-blur-sm">{caption}</span>
        ) : null}
      </div>
      {split ? <div className="mt-1.5 font-mono text-[10px] text-white/40">{name}</div> : null}
    </div>
  );

  const inputImg = (
    <img
      src={asset(s.input)}
      alt={`Chart image for the window ending ${s.date}`}
      className="absolute inset-0 h-full w-full transition-opacity duration-700"
      style={{ opacity: !split && !occl && ph === 2 ? 0.4 : 1 }}
    />
  );
  const mapImg = map ? (
    <img
      src={asset(map)}
      alt={`${label} map`}
      className="absolute inset-0 h-full w-full transition-opacity duration-700"
      style={{ opacity: split ? 1 : ph >= 1 ? mix : 0 }}
    />
  ) : null;
  const reveal = (on: boolean) => cn("transition-[opacity,transform] duration-700", on ? "translate-y-0 opacity-100" : "translate-y-2 opacity-[0.06]");

  return (
    <div className="rounded-[20px] border border-white/[0.09] bg-[#08090b] p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Explanation method">
        {METHODS.map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={m.key === method}
            onClick={() => touch(setMethod)(m.key)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[12.5px] transition-colors",
              m.key === method ? "border-white/50 bg-white text-black" : "border-white/[0.1] text-white/60 hover:border-white/25 hover:text-white"
            )}
          >
            {m.label}
          </button>
        ))}
        <span className="ml-auto hidden font-mono text-[10px] text-white/30 md:inline">
          {CHAIN.modelName} · {fmtDate(s.date, { day: "numeric", month: "short", year: "numeric" })}
        </span>
      </div>

      <div
        className="mt-5 grid gap-6 lg:grid-cols-[var(--img)_minmax(0,1fr)_180px] lg:gap-9"
        style={{ ["--img" as string]: "min(520px, max(320px, calc(100svh - 440px)))" }}
      >
        <div className="min-w-0">
          {features ? (
            <div className="grid grid-cols-4 gap-1.5">
              {labmaps.features[layer].files.slice(0, 12).map((f) => (
                <img key={f} src={asset(f)} alt="" className="aspect-square w-full rounded-[4px] border border-white/[0.08] [image-rendering:pixelated]" />
              ))}
            </div>
          ) : split ? (
            <div className="grid grid-cols-2 gap-3">
              {panel(inputImg, "Chart image", false)}
              {panel(
                <>
                  {occl ? null : <div className="absolute inset-0 bg-[#050506]" />}
                  {mapImg}
                </>,
                `${label}, same pixels`,
                false
              )}
            </div>
          ) : (
            panel(
              occl ? (
                <>
                  {mapImg}
                  {inputImg}
                </>
              ) : (
                <>
                  {inputImg}
                  {mapImg}
                </>
              ),
              "",
              true
            )
          )}
          <div className={cn("mt-3", reveal(ph >= 1))}>
            <Colorbar kind={info.scale} ends={occl ? [`−${occMax.toFixed(2)}`, `+${occMax.toFixed(2)}`] : info.ends} label={features ? "activation" : label} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col">
          <div className={reveal(ph >= 3)}>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">The method</div>
            <div className="mt-5 text-[clamp(1.6rem,2.4vw,2.6rem)] font-light leading-[1.25] text-white">
              <FitLine>{info.formula}</FitLine>
            </div>
            <p className="mt-5 max-w-md text-[14.5px] leading-relaxed text-white/55">{info.note}</p>
          </div>

          <dl className={cn("mt-auto grid grid-cols-2 gap-x-6 gap-y-4 border-t border-white/[0.08] pt-5", reveal(ph >= 4))}>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">P(take-profit)</dt>
              <dd className="mt-1 text-[clamp(2rem,2.6vw,2.6rem)] font-light leading-none tracking-[-0.03em] text-white tabular-nums">{s.p.toFixed(3)}</dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">True label</dt>
              <dd className="mt-1 text-[clamp(2rem,2.6vw,2.6rem)] font-light leading-none tracking-[-0.03em] text-white tabular-nums">{s.label}</dd>
            </div>
            {method === "gradcam" ? (
              <div className="col-span-2">
                <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">Evidence on candle pixels</dt>
                <dd className="mt-1 text-[13.5px] text-white/80 tabular-nums">
                  {Math.round(s.gradcam_on_candles * 100)}% of map mass · candles cover {Math.round(s.foreground * 100)}% of the image
                </dd>
              </div>
            ) : null}
            {occl ? (
              <div className="col-span-2">
                <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">Largest change</dt>
                <dd className="mt-1 text-[13.5px] text-white/80 tabular-nums">Δp ±{occMax.toFixed(3)}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="flex flex-col gap-5">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">{features ? "Layer" : "Chart"}</div>
            {features ? (
              <div className="mt-2 flex flex-col gap-1">
                {labmaps.features.map((f, i) => (
                  <button
                    key={f.name}
                    type="button"
                    aria-pressed={i === layer}
                    onClick={() => touch(setLayer)(i)}
                    className={cn("flex items-baseline justify-between rounded-md px-2 py-1 text-left text-[12px] transition-colors", i === layer ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white")}
                  >
                    {f.name}
                    <span className="font-mono text-[10px] text-white/40">
                      {f.channels} × {f.h}²
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-2">
                {labmaps.samples.map((smp, i) => (
                  <button
                    key={smp.date}
                    type="button"
                    aria-pressed={i === idx}
                    aria-label={`Window ending ${smp.date}, p ${smp.p}`}
                    onClick={() => touch(setIdx)(i)}
                    className={cn("relative overflow-hidden rounded-[6px] border bg-[#050506] transition-colors", i === idx ? "border-white/80" : "border-white/[0.08] hover:border-white/30")}
                  >
                    <img src={asset(smp.input)} alt="" className="aspect-square w-full opacity-80" />
                    <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 font-mono text-[9px] text-white/80">
                      {fmtDate(smp.date, { month: "short", year: "2-digit" })} · {smp.p.toFixed(2)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {!features ? (
            <div className="space-y-3">
              <div className="inline-flex rounded-full border border-white/[0.1] p-0.5" role="group" aria-label="Layout">
                {(["Overlay", "Side by side"] as const).map((l, i) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={split === (i === 1)}
                    onClick={() => touch(setSplit)(i === 1)}
                    className={cn("rounded-full px-2.5 py-1 text-[11.5px] transition-colors", split === (i === 1) ? "bg-white text-black" : "text-white/55 hover:text-white")}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {!split ? (
                <label className="block">
                  <span className="flex justify-between font-mono text-[10px] text-white/40">
                    <span>Overlay</span>
                    <span>{Math.round(mix * 100)}%</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={mix}
                    onChange={(e) => touch(setMix)(Number(e.target.value))}
                    className="mt-1.5 w-full accent-white"
                    aria-label="Overlay opacity"
                  />
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- convolution scan */

const SAMPLE = labmaps.samples[labmaps.trace_index];
const FEAT = labmaps.features[0].files[0];
const STOPS = [26, 58, 92, 124, 156, 186, 206];
const DWELL = 2600;

/** Row of the drawn price line in each column of the chart image, so the scan follows the candles. */
export function useInkPath(src: string) {
  const [rows, setRows] = useState<number[] | null>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = img.width;
      cv.height = img.height;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);
      const out: number[] = [];
      let last = height / 2;
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let n = 0;
        for (let y = 0; y < height; y++)
          if (data[(y * width + x) * 4 + 3] > 64) {
            sum += y;
            n++;
          }
        last = n ? sum / n : last;
        out.push(last);
      }
      setRows(out.map((_, x) => Math.round(out.slice(Math.max(0, x - 3), x + 4).reduce((a, b) => a + b, 0) / Math.min(7, out.length))));
    };
    img.src = src;
  }, [src]);
  return rows;
}

const PAN = "background-position 1.6s cubic-bezier(0.16,1,0.3,1)";

function Loupe({ src, n, cx, cy, box, label, pixel = false, tone = "#a6ecc8" }: { src: string; n: number; cx: number; cy: number; box: number; label: string; pixel?: boolean; tone?: string }) {
  const span = 15;
  return (
    <div>
      <div className="relative aspect-square w-full overflow-hidden rounded-[10px] border border-white/[0.1] bg-[#08090b]">
        <div
          className={cn("absolute inset-0", pixel && "[image-rendering:pixelated]")}
          style={{
            backgroundImage: `url(${src})`,
            backgroundSize: `${(n / span) * 100}%`,
            backgroundPosition: `${((cx - 7) / (n - span)) * 100}% ${((cy - 7) / (n - span)) * 100}%`,
            backgroundRepeat: "no-repeat",
            imageRendering: "pixelated",
            transition: PAN,
          }}
        />
        <span
          className="absolute rounded-[2px] border-[1.5px] shadow-[0_0_0_1px_rgba(0,0,0,0.7)]"
          style={{ borderColor: tone, left: `${((7 - (box >> 1)) / span) * 100}%`, top: `${((7 - (box >> 1)) / span) * 100}%`, width: `${(box / span) * 100}%`, height: `${(box / span) * 100}%` }}
        />
        <div className="absolute bottom-1.5 right-1.5 aspect-square w-[30%] overflow-hidden rounded-[4px] border border-white/15 bg-[#050506]">
          <img src={src} alt="" className={cn("h-full w-full opacity-80", pixel && "[image-rendering:pixelated]")} />
          <span
            className="absolute border border-[#a6ecc8]/90"
            style={{ left: `${((cx - 7) / n) * 100}%`, top: `${((cy - 7) / n) * 100}%`, width: `${(span / n) * 100}%`, height: `${(span / n) * 100}%`, transition: "left 1.6s cubic-bezier(0.16,1,0.3,1), top 1.6s cubic-bezier(0.16,1,0.3,1)" }}
          />
        </div>
      </div>
      <div className="mt-2 font-mono text-[10px] text-white/45">{label}</div>
    </div>
  );
}

export function ConvScan() {
  const reduce = useReducedMotion();
  const ink = useInkPath(asset(SAMPLE.input));
  const [k, setK] = useState(3);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reduce) return;
    let visible = false;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    if (ref.current) io.observe(ref.current);
    const id = window.setInterval(() => visible && setK((v) => (v + 1) % STOPS.length), DWELL);
    return () => {
      window.clearInterval(id);
      io.disconnect();
    };
  }, [reduce]);
  const col = STOPS[k];
  const row = ink ? Math.min(208, Math.max(8, (ink[col + 1] ?? 112) - 1)) : 112;
  return (
    <div ref={ref}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <Loupe src={asset(SAMPLE.input)} n={224} cx={col + 1} cy={row + 1} box={3} label={`input · 3 × 3 patch at (${row}, ${col})`} />
        <div className="flex flex-col items-center gap-1 font-mono text-[10.5px] text-white/45">
          <svg width="44" height="14" viewBox="0 0 44 14" aria-hidden>
            <defs>
              <linearGradient id="m2-cs-ar" x1="0" x2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0.8" />
              </linearGradient>
            </defs>
            <path d="M1 7H40M35 2l5 5-5 5" fill="none" stroke="url(#m2-cs-ar)" strokeWidth="1.3" />
          </svg>
          <span className="text-white/80">∗ W + b</span>
          <span>ReLU</span>
        </div>
        <Loupe src={asset(FEAT)} n={222} cx={col} cy={row} box={1} label={`conv2d · output (${row}, ${col})`} pixel tone="#b9d3ff" />
      </div>
      <span className="sr-only">Zoomed views of the chart image and the first layer's feature map at matching positions.</span>
    </div>
  );
}

export function ModelLab({ progress }: { progress?: MotionValue<number> }) {
  const phase = useStep(progress, [0.1, 0.28, 0.46, 0.64], 4);
  return (
    <div>
      {progress ? (
        <ol className="mb-4 flex items-center gap-2" aria-label="Sequence">
          {LAB_STEPS.map((st, i) => (
            <li key={st} className="flex items-center gap-2">
              <span className={cn("font-mono text-[10px] uppercase tracking-[0.16em] transition-colors duration-500", i === phase ? "text-white" : i < phase ? "text-white/50" : "text-white/25")}>
                {String(i + 1).padStart(2, "0")} {st}
              </span>
              {i < LAB_STEPS.length - 1 ? <span className={cn("h-px w-8 transition-colors duration-500", i < phase ? "bg-white/50" : "bg-white/10")} aria-hidden /> : null}
            </li>
          ))}
        </ol>
      ) : null}
      <Explorer phase={phase} />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <ProvenanceTag kind="real" detail="MSFT model · 6 test windows · Analysis Lab code" />
        <span className="font-mono text-[10.5px] text-white/30">Maps share the chart's 224 × 224 pixel grid</span>
      </div>
    </div>
  );
}
