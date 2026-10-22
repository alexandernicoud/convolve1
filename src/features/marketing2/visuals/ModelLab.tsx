import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { asset, labmaps, training, type LabMethod } from "../data";
import { ProvenanceTag, fmtDate } from "../ui";

type Method = LabMethod | "features";

const METHODS: { key: Method; label: string }[] = [
  { key: "gradcam", label: "Grad-CAM" },
  { key: "saliency", label: "Saliency" },
  { key: "smoothgrad", label: "SmoothGrad" },
  { key: "occlusion", label: "Occlusion" },
  { key: "features", label: "Feature maps" },
];

const I = ({ children }: { children: ReactNode }) => <i className="font-serif">{children}</i>;

function Sum({ sub, sup }: { sub: ReactNode; sup?: ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex flex-col items-center align-middle leading-none">
      {sup ? <span className="text-[0.55em] text-white/60">{sup}</span> : null}
      <span className="text-[1.25em]">Σ</span>
      <span className="text-[0.55em] text-white/60">{sub}</span>
    </span>
  );
}

function Frac({ n, d }: { n: ReactNode; d: ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex flex-col items-center align-middle text-[0.8em] leading-tight">
      <span className="border-b border-white/50 px-0.5">{n}</span>
      <span className="px-0.5">{d}</span>
    </span>
  );
}

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

function Colorbar({ kind, ends }: { kind: "sequential" | "diverging" | "features"; ends: [string, string] }) {
  const stops = labmaps.colormaps[kind].stops;
  return (
    <div>
      <div className="h-2 w-full rounded-full" style={{ background: `linear-gradient(90deg, ${stops.join(",")})` }} />
      <div className="mt-1 flex justify-between font-mono text-[9.5px] text-white/40">
        <span>{ends[0]}</span>
        {kind === "diverging" ? <span>no change</span> : null}
        <span>{ends[1]}</span>
      </div>
    </div>
  );
}

function Explorer() {
  const [idx, setIdx] = useState(labmaps.trace_index);
  const [method, setMethod] = useState<Method>("gradcam");
  const [mix, setMix] = useState(0.85);
  const [split, setSplit] = useState(false);
  const [layer, setLayer] = useState(0);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const info = METHOD_INFO[method];
  const features = method === "features";
  const s = labmaps.samples[features ? labmaps.trace_index : idx];
  const map = features ? null : s[method as LabMethod];
  const occl = method === "occlusion";
  const occMax = Math.max(Math.abs(s.occlusion_range[0]), Math.abs(s.occlusion_range[1]));

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

  const panel = (body: ReactNode, label: string) => (
    <div className="min-w-0">
      <div
        className="relative aspect-square w-full cursor-crosshair overflow-hidden rounded-[10px] border border-white/[0.1] bg-[#050506]"
        onPointerMove={track}
        onPointerLeave={() => setCursor(null)}
      >
        {body}
        <Cross />
      </div>
      {split ? <div className="mt-1.5 font-mono text-[10px] text-white/40">{label}</div> : null}
    </div>
  );

  const inputImg = <img src={asset(s.input)} alt={`Chart image for the window ending ${s.date}`} className="absolute inset-0 h-full w-full" />;
  const mapImg = map ? (
    <img src={asset(map)} alt={`${METHODS.find((m) => m.key === method)?.label} map`} className="absolute inset-0 h-full w-full transition-opacity duration-150" style={{ opacity: split ? 1 : mix }} />
  ) : null;

  return (
    <div className="rounded-[18px] border border-white/[0.09] bg-[#08090b] p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Explanation method">
        {METHODS.map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={m.key === method}
            onClick={() => setMethod(m.key)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[12.5px] transition-colors",
              m.key === method ? "border-white/50 bg-white text-black" : "border-white/[0.1] text-white/60 hover:border-white/25 hover:text-white"
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-5 sm:grid-cols-[minmax(0,440px)_190px] sm:justify-between">
        <div className="min-w-0">
          {features ? (
            <div>
              <div className="grid grid-cols-4 gap-1.5">
                {labmaps.features[layer].files.slice(0, 12).map((f) => (
                  <img key={f} src={asset(f)} alt="" className="aspect-square w-full rounded-[4px] border border-white/[0.08] [image-rendering:pixelated]" />
                ))}
              </div>
            </div>
          ) : split ? (
            <div className="grid grid-cols-2 gap-3">
              {panel(inputImg, "Chart image")}
              {panel(
                <>
                  {occl ? null : <div className="absolute inset-0 bg-[#050506]" />}
                  {mapImg}
                </>,
                `${METHODS.find((m) => m.key === method)?.label}, same pixels`
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
              ""
            )
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">{features ? "Layer" : "Chart"}</div>
            {features ? (
              <div className="mt-2 flex flex-col gap-1">
                {labmaps.features.map((f, i) => (
                  <button
                    key={f.name}
                    type="button"
                    aria-pressed={i === layer}
                    onClick={() => setLayer(i)}
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
                    onClick={() => setIdx(i)}
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
                    onClick={() => setSplit(i === 1)}
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
                    onChange={(e) => setMix(Number(e.target.value))}
                    className="mt-1.5 w-full accent-white"
                    aria-label="Overlay opacity"
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-2 border-t border-white/[0.07] pt-3 text-[11px]">
            <div>
              <dt className="text-white/40">p (take-profit)</dt>
              <dd className="text-[16px] font-medium text-white tabular-nums">{s.p.toFixed(3)}</dd>
            </div>
            <div>
              <dt className="text-white/40">True label</dt>
              <dd className="text-[16px] font-medium text-white tabular-nums">{s.label}</dd>
            </div>
            {method === "gradcam" ? (
              <div className="col-span-2">
                <dt className="text-white/40">Evidence on candle pixels</dt>
                <dd className="text-white/80 tabular-nums">
                  {Math.round(s.gradcam_on_candles * 100)}% of map mass · candles cover {Math.round(s.foreground * 100)}%
                </dd>
              </div>
            ) : null}
            {occl ? (
              <div className="col-span-2">
                <dt className="text-white/40">Largest change</dt>
                <dd className="text-white/80 tabular-nums">Δp ±{occMax.toFixed(3)}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>

      <div className="mt-5 grid gap-4 border-t border-white/[0.07] pt-4 sm:grid-cols-[1fr_190px] sm:items-end">
        <div className="min-w-0">
          <div className="overflow-x-auto whitespace-nowrap text-[15px] text-white/90 [scrollbar-width:none]">{info.formula}</div>
          <p className="mt-2 text-[12px] leading-snug text-white/45">{info.note}</p>
        </div>
        <Colorbar kind={info.scale} ends={occl ? [`−${occMax.toFixed(2)}`, `+${occMax.toFixed(2)}`] : info.ends} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- convolution scan */

const SAMPLE = labmaps.samples[labmaps.trace_index];
const FEAT = labmaps.features[0].files[0];

/** Row of the drawn price line in each column of the chart image, so the scan follows the candles. */
function useInkPath(src: string) {
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

function ConvScan() {
  const reduce = useReducedMotion();
  const ink = useInkPath(asset(SAMPLE.input));
  const [col, setCol] = useState(150);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    let visible = false;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    if (ref.current) io.observe(ref.current);
    const t0 = performance.now();
    const tick = (now: number) => {
      if (visible) {
        const f = ((now - t0) / 9000) % 1;
        setCol(Math.round(10 + (f < 0.5 ? f * 2 : 2 - f * 2) * 200));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [reduce]);
  const row = ink ? Math.min(208, Math.max(8, (ink[col + 1] ?? 112) - 1)) : 112;
  const pos: [number, number] = [col, row];
  const [j, i] = pos;
  const loupe = (src: string, n: number, cx: number, cy: number, box: number, bg: string, pixel = false) => (
    <div className="relative aspect-square w-full overflow-hidden rounded-[8px] border border-white/[0.12]" style={{ background: bg }}>
      <div
        className={cn("absolute inset-0", pixel && "[image-rendering:pixelated]")}
        style={{
          backgroundImage: `url(${src})`,
          backgroundSize: `${(n / 15) * 100}%`,
          backgroundPosition: `${((cx - 7) / (n - 15)) * 100}% ${((cy - 7) / (n - 15)) * 100}%`,
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
        }}
      />
      <span
        className="absolute border-2 border-[#ff7a45] shadow-[0_0_0_1px_rgba(0,0,0,0.85)]"
        style={{ left: `${((7 - (box >> 1)) / 15) * 100}%`, top: `${((7 - (box >> 1)) / 15) * 100}%`, width: `${(box / 15) * 100}%`, height: `${(box / 15) * 100}%` }}
      />
    </div>
  );
  return (
    <div ref={ref} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      <div>
        {loupe(asset(SAMPLE.input), 224, j + 1, i + 1, 3, "#050506")}
        <div className="mt-1.5 font-mono text-[9.5px] text-white/40">input · 3×3 at ({i}, {j})</div>
      </div>
      <div className="text-center font-mono text-[11px] text-white/50">
        <div className="text-white/80">∗ W</div>
        <div className="mt-1">ReLU</div>
      </div>
      <div>
        {loupe(asset(FEAT), 222, j, i, 1, "#000", true)}
        <div className="mt-1.5 font-mono text-[9.5px] text-white/40">conv2d · pixel ({i}, {j})</div>
      </div>
      <span className="sr-only">Zoomed views of the chart image and the first layer's feature map at matching positions.</span>
    </div>
  );
}

/* ------------------------------------------------------------------- equations */

const convWeights = training.arch.filter((l) => l.kind === "Conv2D").reduce((a, l) => a + l.params, 0);

const EQUATIONS: { name: string; eq: ReactNode; real: string }[] = [
  {
    name: "Convolution",
    eq: (
      <>
        <I>z</I>
        <sub>k</sub>(<I>i</I>,<I>j</I>) = <I>b</I>
        <sub>k</sub> + <Sum sub="c" />
        <Sum sub="u,v=0" sup="2" />
        <I>W</I>
        <sub>k,c</sub>(<I>u</I>,<I>v</I>) <I>a</I>
        <sub>c</sub>(<I>i</I>+<I>u</I>, <I>j</I>+<I>v</I>)
      </>
    ),
    real: `3×3 kernels · 32, 64, 128 filters · ${convWeights.toLocaleString("en-US")} weights`,
  },
  {
    name: "Activation and pooling",
    eq: (
      <>
        <I>a</I> = max(0, <I>z</I>), &nbsp; <I>m</I>(<I>i</I>,<I>j</I>) = max<sub>u,v∈{"{0,1}"}</sub> <I>a</I>(2<I>i</I>+<I>u</I>, 2<I>j</I>+<I>v</I>)
      </>
    ),
    real: "222² → 111² · 109² → 54² · 52² → 26²",
  },
  {
    name: "Output",
    eq: (
      <>
        <I>p</I> = σ(<I>w</I>
        <sup>⊤</sup>ReLU(<I>V</I>
        <I>h</I> + <I>c</I>) + <I>b</I>)
      </>
    ),
    real: "h: 86,528 values → 128 → 1 probability",
  },
  {
    name: "Loss",
    eq: (
      <>
        <I>L</I> = −<Frac n="1" d={<I>N</I>} />
        <Sum sub="n" />[<I>y</I> log <I>p</I> + (1−<I>y</I>) log(1−<I>p</I>)]
      </>
    ),
    real: "binary cross-entropy · batches of 16",
  },
  {
    name: "Update",
    eq: (
      <>
        <I>θ</I> ← <I>θ</I> − <I>η</I> <Frac n={<I>m̂</I>} d={<>√<I>v̂</I> + <I>ε</I></>} />
      </>
    ),
    real: `Adam · η = 10⁻³ · ${training.params.toLocaleString("en-US")} parameters`,
  },
];

function Equations() {
  return (
    <div className="rounded-[18px] border border-white/[0.09] bg-[#08090b] p-4 sm:p-5">
      <ConvScan />
      <ol className="mt-5 border-t border-white/[0.07]">
        {EQUATIONS.map((e, k) => (
          <li key={e.name} className="grid grid-cols-[22px_1fr] gap-x-2 border-b border-white/[0.06] py-3 last:border-b-0">
            <span className="pt-0.5 font-mono text-[10px] text-white/35">{k + 1}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-[12px] text-white/50">{e.name}</span>
                <span className="font-mono text-[9.5px] text-white/35">{e.real}</span>
              </div>
              <div className="mt-1.5 overflow-x-auto whitespace-nowrap text-[15px] text-white/90 [scrollbar-width:none]">{e.eq}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ModelLab() {
  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
        <div className="min-w-0 lg:col-span-7">
          <Explorer />
        </div>
        <div className="min-w-0 lg:col-span-5">
          <Equations />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <ProvenanceTag kind="real" detail="MSFT model · 6 test windows · computed with the Analysis Lab's own code" />
        <span className="font-mono text-[10.5px] text-white/30">Maps share the chart's 224 × 224 pixel grid</span>
      </div>
    </div>
  );
}
