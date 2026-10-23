import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Chip, cx, Panel } from "@/features/review/components/primitives";
import { fmtNum, fmtPct, fmtPp, MISSING } from "@/lib/viz/format";
import { labApi, type ExplainResult, type InterveneResult, type LabImage, type Method } from "./api";
import { btnSm, Field, inputCls, LayerSelect, MiniKV, ProbBars, Select, Thumb, useLab } from "./components";
import { BackdropToggle, ChartBackdropCtx, MapCanvas, MapScale, useAuthedObjectUrl, type ChartBackdrop, type Rect } from "./maps";

const METHODS: { id: Method; label: string }[] = [
  { id: "gradcam", label: "Grad-CAM" },
  { id: "saliency", label: "Saliency" },
  { id: "smoothgrad", label: "SmoothGrad" },
  { id: "occlusion", label: "Occlusion" },
  { id: "activations", label: "Feature maps" },
];

const REGIONS: { id: string; label: string; rect: Rect }[] = [
  { id: "time:oldest", label: "Oldest third (left)", rect: [0, 0, 1 / 3, 1] },
  { id: "time:middle", label: "Middle third (time)", rect: [1 / 3, 0, 2 / 3, 1] },
  { id: "time:recent", label: "Most recent third (right)", rect: [2 / 3, 0, 1, 1] },
  { id: "price:upper", label: "Upper price third", rect: [0, 0, 1, 1 / 3] },
  { id: "price:middle", label: "Middle price band", rect: [0, 1 / 3, 1, 2 / 3] },
  { id: "price:lower", label: "Lower price third", rect: [0, 2 / 3, 1, 1] },
];

type View = { method: Method; target: string; layer: string };

export default function ImageExplorer({ imageId, onSelect }: { imageId: string | null; onSelect: (id: string) => void }) {
  const { context } = useLab();
  return (
    <div className="grid gap-5 xl:grid-cols-12">
      <ImageBrowser className="xl:col-span-3" selected={imageId} onSelect={onSelect} />
      {imageId ? (
        <Viewer key={imageId} imageId={imageId} className="xl:col-span-9" />
      ) : (
        <Panel title="No image selected" className="xl:col-span-9">
          <p className="pl-4 text-[14px] leading-relaxed text-white/50">
            Pick an image on the left. Every map is computed on the exact tensor the model receives ({context.model.input_size.join(" × ")} px, decoded as RGB, AREA-resized, scaled to
            0–1), so overlays line up with what the network saw.
          </p>
        </Panel>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- browser

function ImageBrowser({ selected, onSelect, className }: { selected: string | null; onSelect: (id: string) => void; className?: string }) {
  const { ref, context } = useLab();
  const [label, setLabel] = useState<number | null>(null);
  const [split, setSplit] = useState<"all" | "validation" | "training">("all");
  const [symbol, setSymbol] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ total: number; items: LabImage[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const limit = 24;
  const splitOk = context.dataset?.split.status === "recorded" || context.dataset?.split.status === "reconstructed";

  useEffect(() => setOffset(0), [label, split, symbol, q]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    labApi
      .images(ref, { label, split, symbol: symbol || null, q: q || undefined, offset, limit, predict: true })
      .then((d) => alive && (setData(d), setErr(null)))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "Could not list images"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [ref, label, split, symbol, q, offset]);

  useEffect(() => {
    if (!selected && data?.items.length) onSelect(data.items[0].id);
  }, [selected, data, onSelect]);

  return (
    <Panel title="Images" description={data ? `${data.total.toLocaleString("en-US")} matching` : "Loading…"} className={className}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Chip active={label === null} onClick={() => setLabel(null)}>
            All
          </Chip>
          {Array.from({ length: context.model.n_classes }, (_, c) => (
            <Chip key={c} active={label === c} onClick={() => setLabel(c)}>
              Label {c}
            </Chip>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select
            value={split}
            disabled={!splitOk}
            onChange={(v) => setSplit(v as typeof split)}
            options={[
              { value: "all", label: "All splits" },
              { value: "validation", label: "Validation" },
              { value: "training", label: "Training" },
            ]}
          />
          <Select value={symbol} onChange={setSymbol} options={[{ value: "", label: "All symbols" }, ...(context.dataset?.symbols ?? []).map((s) => ({ value: s.symbol, label: s.symbol }))]} />
        </div>
        <input className={inputCls} placeholder="Search filename…" value={q} onChange={(e) => setQ(e.target.value)} />
        {err ? <p className="text-[13px] text-red-300/90">{err}</p> : null}
        <div className={cx("grid grid-cols-3 gap-1.5 transition", loading && "opacity-60")}>
          {data?.items.map((it) => (
            <Thumb
              key={it.id}
              imageId={it.id}
              selected={it.id === selected}
              onClick={() => onSelect(it.id)}
              caption={
                <span className="flex items-center justify-between gap-1">
                  <span>
                    {it.pred != null ? `→${it.pred}` : MISSING} <span className="text-white/35">{fmtPct(it.probs?.[it.pred ?? 0], 0)}</span>
                  </span>
                  <span className={it.label == null || it.pred == null ? "text-white/35" : it.label === it.pred ? "text-white/70" : "text-red-300/80"}>
                    {it.label == null ? "" : it.label === it.pred ? "✓" : "✗"}
                  </span>
                </span>
              }
            />
          ))}
        </div>
        {data && data.total > limit ? (
          <div className="flex items-center justify-between text-[12.5px] text-white/45">
            <button type="button" className={btnSm} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="font-digits tabular-nums">
              {offset + 1}–{Math.min(offset + limit, data.total)} of {data.total}
            </span>
            <button type="button" className={btnSm} disabled={offset + limit >= data.total} onClick={() => setOffset(offset + limit)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
        <p className="text-[12px] leading-relaxed text-white/35">→ predicted class and its probability; ✓/✗ compare with the label in the filename.</p>
      </div>
    </Panel>
  );
}

// --------------------------------------------------------------------------- viewer

function useExplain(imageId: string) {
  const { ref } = useLab();
  const cache = useRef(new Map<string, Promise<ExplainResult>>());
  return useCallback(
    (v: View, channels?: number[]) => {
      const key = JSON.stringify([v, channels ?? null]);
      let p = cache.current.get(key);
      if (!p) {
        p = labApi.explain(ref, { image_id: imageId, target: v.target, layer: v.layer, methods: [v.method], channels, top_channels: 16 });
        p.catch(() => cache.current.delete(key));
        cache.current.set(key, p);
      }
      return p;
    },
    [ref, imageId],
  );
}

function useView(imageId: string, v: View) {
  const explain = useExplain(imageId);
  const [res, setRes] = useState<ExplainResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    explain(v)
      .then((r) => alive && (setRes(r), setErr(null)))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "Could not compute the map"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [explain, v.method, v.target, v.layer]); // eslint-disable-line react-hooks/exhaustive-deps
  return { res, err, loading };
}

function Viewer({ imageId, className }: { imageId: string; className?: string }) {
  const { ref, context } = useLab();
  const [backdrop, setBackdrop] = useState<ChartBackdrop>("dark");
  const baseUrl = useAuthedObjectUrl(useMemo(() => labApi.imagePath(ref, imageId, backdrop === "dark"), [ref, imageId, backdrop]));
  const [a, setA] = useState<View>({ method: "gradcam", target: "predicted", layer: context.model.default_layer });
  const [b, setB] = useState<View>({ method: "saliency", target: "predicted", layer: context.model.default_layer });
  const [compare, setCompare] = useState(false);
  const [opacity, setOpacity] = useState(0.7);
  const [thirds, setThirds] = useState(false);
  const va = useView(imageId, a);
  const vb = useView(imageId, compare ? b : a);
  const main = va.res;

  return (
    <ChartBackdropCtx.Provider value={backdrop}>
    <div className={cx("grid gap-5 lg:grid-cols-12", className)}>
      <Panel
        title={<ViewerTitle imageId={imageId} />}
        className="lg:col-span-8"
        aside={
          <label className="flex items-center gap-2 text-[12.5px] text-white/55">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="accent-white" />
            Compare side by side
          </label>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex items-center gap-3">
              <span className="text-[12.5px] text-white/55">Opacity</span>
              <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-28 accent-white" aria-label="Overlay opacity" />
              <span className="w-9 font-digits text-[12.5px] tabular-nums text-white/60">{Math.round(opacity * 100)}%</span>
            </div>
            <label className="flex items-center gap-2 text-[12.5px] text-white/55">
              <input type="checkbox" checked={thirds} onChange={(e) => setThirds(e.target.checked)} className="accent-white" />
              Region thirds
            </label>
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] text-white/55">Background</span>
              <BackdropToggle value={backdrop} onChange={setBackdrop} />
            </div>
          </div>
          <div className={cx("grid gap-5", compare ? "md:grid-cols-2" : "grid-cols-1")}>
            <ViewPane view={a} setView={setA} state={va} base={baseUrl} opacity={opacity} thirds={thirds} big={!compare} />
            {compare ? <ViewPane view={b} setView={setB} state={vb} base={baseUrl} opacity={opacity} thirds={thirds} /> : null}
          </div>
        </div>
      </Panel>
      <div className="space-y-5 lg:col-span-4">
        <PredictionPanel res={main} />
        <MaskPanel imageId={imageId} base={baseUrl} />
      </div>
    </div>
    </ChartBackdropCtx.Provider>
  );
}

function ViewerTitle({ imageId }: { imageId: string }) {
  return (
    <div className="min-w-0">
      <h2 className="flex items-center gap-2 text-base font-medium text-[#F5F5F5]">
        <span className="h-2 w-2 shrink-0 rounded-full bg-white" />
        Image explorer
      </h2>
      <p className="mt-1 truncate pl-4 font-mono text-[12px] text-white/40" title={imageId}>
        {imageId}
      </p>
    </div>
  );
}

function ViewPane({
  view,
  setView,
  state,
  base,
  opacity,
  thirds,
  big,
}: {
  view: View;
  setView: (v: View) => void;
  state: { res: ExplainResult | null; err: string | null; loading: boolean };
  base: string | null;
  opacity: number;
  thirds: boolean;
  big?: boolean;
}) {
  const { context } = useLab();
  const backdrop = useContext(ChartBackdropCtx);
  const { res, err, loading } = state;
  const m = view.method;
  const map = m !== "activations" ? res?.maps[m] ?? null : null;
  const palette = m === "occlusion" ? "diverging" : "sequential";
  const classes = Array.from({ length: context.model.n_classes }, (_, c) => c);

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {METHODS.map((x) => (
          <Chip key={x.id} active={m === x.id} onClick={() => setView({ ...view, method: x.id })}>
            {x.label}
          </Chip>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Explain class" hint="Predicted = the class the model chose. Pick a class to see evidence for it even when the model did not predict it.">
          <Select value={view.target} onChange={(t) => setView({ ...view, target: t })} options={[{ value: "predicted", label: "Predicted class" }, ...classes.map((c) => ({ value: String(c), label: `Label ${c}` }))]} />
        </Field>
        {m === "gradcam" || m === "activations" ? (
          <Field label="Layer">
            <LayerSelect value={view.layer} onChange={(l) => setView({ ...view, layer: l })} />
          </Field>
        ) : (
          <div />
        )}
      </div>
      {m === "activations" ? (
        <FeatureGrid res={res} loading={loading} />
      ) : (
        <div className={cx("relative", big ? "mx-auto max-w-[560px]" : "")}>
          <MapCanvas base={base} map={map} palette={palette} opacity={opacity} thirds={thirds} label={`${m} overlay`} />
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30">
              <Loader2 className="h-5 w-5 animate-spin text-white/80" />
            </div>
          ) : null}
        </div>
      )}
      {err ? <p className="text-[13px] text-red-300/90">{err}</p> : null}
      {map ? (
        <MapScale
          surface={backdrop === "model" ? "light" : "dark"}
          palette={palette}
          min={map.min}
          max={map.max}
          format={(v) => (m === "occlusion" ? fmtPp(v, 2) : fmtNum(v, Math.abs(map.max) < 0.01 ? 5 : 3))}
          lowLabel={m === "occlusion" ? "lowers p" : undefined}
          highLabel={m === "occlusion" ? "raises p" : undefined}
          note={map.normalization}
        />
      ) : null}
      {map?.all_zero ? <p className="text-[13px] text-amber-200/80">No positive Grad-CAM evidence for this class at this layer: the map is all zero, not missing.</p> : null}
      {res?.notes[m] ? <p className="text-[12.5px] leading-relaxed text-white/45">{res.notes[m]}</p> : null}
      {res && m === "gradcam" && map ? (
        <div className="grid grid-cols-2 gap-x-6">
          <MiniKV label="Mass on candles" value={fmtPct(map.foreground_share)} hint="Share of the upsampled Grad-CAM mass on non-background pixels." />
          <MiniKV label="Candle area" value={fmtPct(res.foreground_fraction)} hint="Share of pixels that are not the white background." />
        </div>
      ) : null}
    </div>
  );
}

function FeatureGrid({ res, loading }: { res: ExplainResult | null; loading: boolean }) {
  const act = res?.maps.activations;
  if (!act) return <div className="flex h-48 items-center justify-center text-[13px] text-white/40">{loading ? "Computing feature maps…" : "No feature maps."}</div>;
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-white/50">
        Tensor {act.layer_shape.join(" × ")} · {act.active_channels} of {act.layer_shape[2]} channels active on this image · showing the {act.channels.length} with the highest mean
      </p>
      <div className="grid grid-cols-4 gap-2">
        {act.channels.map((c) => (
          <div key={c.channel} className="min-w-0">
            <MapCanvas map={c.map} palette="gray" background="#000" label={`Channel ${c.channel}`} />
            <p className="mt-1 flex justify-between font-digits text-[11.5px] tabular-nums text-white/50">
              <span>ch {c.channel}</span>
              <span>μ {fmtNum(c.mean, 3)}</span>
            </p>
          </div>
        ))}
      </div>
      <p className="text-[12px] leading-relaxed text-white/40">{act.normalization}. Channels are numbered, not named.</p>
    </div>
  );
}

function PredictionPanel({ res }: { res: ExplainResult | null }) {
  const { context } = useLab();
  const img = res?.image;
  const splitText = img?.split === "validation" ? "Validation (held out from training)" : img?.split === "training" ? "Training (seen during training)" : "Not available";
  return (
    <Panel title="Prediction">
      {res ? (
        <div className="space-y-4">
          <ProbBars probs={res.probabilities} predicted={res.predicted_class} target={res.target_class} label={img?.label} />
          <div>
            <MiniKV label="Symbol" value={img?.symbol ?? MISSING} />
            <MiniKV label="Window" value={img?.start && img?.end ? `${img.start} → ${img.end}` : MISSING} />
            <MiniKV label="Label (filename)" value={img?.label ?? MISSING} />
            <MiniKV label="Split" value={splitText} hint={context.dataset?.split.note} />
            <MiniKV label="Preprocessing" value="RGB · AREA · /255" hint={res.identity.preprocessing} />
          </div>
          <p className="text-[12px] leading-relaxed text-white/40">
            Probabilities are the model's output, not calibrated likelihoods. The label comes from the dataset filename; it is the training target, not a market outcome
            measured here.
          </p>
        </div>
      ) : (
        <div className="h-40 animate-pulse rounded-lg bg-white/[0.04]" />
      )}
    </Panel>
  );
}

function MaskPanel({ imageId, base }: { imageId: string; base: string | null }) {
  const { ref, context } = useLab();
  const [region, setRegion] = useState(REGIONS[2].id);
  const [baseline, setBaseline] = useState<"white" | "black" | "blur">("white");
  const [res, setRes] = useState<InterveneResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rect = REGIONS.find((r) => r.id === region)!.rect;
  useEffect(() => setRes(null), [region, baseline]);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRes(await labApi.intervene(ref, { image_id: imageId, rect, baseline }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not run the intervention");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Mask a region" description="Replace part of this image and re-run the model. One image is an anecdote; use Sensitivity for sample-level effects.">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Region">
            <Select value={region} onChange={setRegion} options={REGIONS.map((r) => ({ value: r.id, label: r.label }))} />
          </Field>
          <Field label="Replace with" hint={context.baselines[baseline]}>
            <Select
              value={baseline}
              onChange={(v) => setBaseline(v as typeof baseline)}
              options={[
                { value: "white", label: "White background" },
                { value: "blur", label: "Blurred copy" },
                { value: "black", label: "Black" },
              ]}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <MapCanvas base={base} rect={rect} label="Original with region" />
            <p className="mt-1 text-center text-[11.5px] text-white/40">Original</p>
          </div>
          <div>
            {res ? (
              <MapCanvas base={`data:image/png;base64,${res.modified_png}`} alphaFrom={base} rect={rect} label="Modified input" />
            ) : (
              <div className="aspect-square w-full rounded-lg border border-dashed border-white/[0.1]" />
            )}
            <p className="mt-1 text-center text-[11.5px] text-white/40">Modified</p>
          </div>
        </div>
        <button type="button" className={btnSm} disabled={busy} onClick={() => void go()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Mask and re-predict
        </button>
        {err ? <p className="text-[13px] text-red-300/90">{err}</p> : null}
        {res ? (
          <div>
            <MiniKV label={`p(label ${res.target_class}) before`} value={fmtPct(res.original[res.target_class], 2)} />
            <MiniKV label="after" value={fmtPct(res.modified[res.target_class], 2)} />
            <MiniKV label="Change" value={fmtPp(res.delta_target, 2)} />
            <MiniKV label="Prediction flipped" value={res.flipped ? "Yes" : "No"} />
            <MiniKV label="Candle pixels masked" value={fmtPct(res.masked_foreground, 0)} />
            <p className="mt-2 text-[12px] leading-relaxed text-white/40">{res.baseline_note}</p>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
