import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Chip, cx, Panel } from "@/features/review/components/primitives";
import { fmtNum, fmtPct, isFiniteNum, MISSING } from "@/lib/viz/format";
import { CLASS_COLORS } from "@/lib/viz/tokens";
import { labApi, type ActMaxResult, type EncodedMap } from "./api";
import { btnSm, Field, FilterEditor, IntervalPlot, JobMeta, JobPanel, LayerSelect, MiniKV, NumberInput, ResultEmpty, SampleSummary, Thumb, useLab } from "./components";
import { EMPTY_FILTERS, filtersToParams, intervalDomain, type Filters } from "./lib";
import { MapCanvas } from "./maps";

type Eff = { d: number | null; lo: number | null; hi: number | null; n_a: number; n_b: number };
type Channel = {
  channel: number;
  mean: number;
  sd: number;
  active_rate: number;
  peak: number;
  top_images: { id: string; value: number; label: number | null; pred: number }[];
  d_label?: Eff;
  d_pred?: Eff;
  r_logit?: { r: number | null; lo: number | null; hi: number | null; n: number };
};
type FeatResult = {
  layer: string;
  tensor_shape: number[];
  summary: Parameters<typeof SampleSummary>[0]["summary"];
  channels: Channel[];
  dead_channels: number;
  label_separating: { count: number; expected_by_chance: number; of: number };
  notes: string[];
};

type SortKey = "d" | "mean" | "active" | "r";

export default function FeaturesView() {
  const { context, session } = useLab();
  const [n, setN] = useState(200);
  const [seed, setSeed] = useState(0);
  const [layer, setLayer] = useState(context.model.default_layer);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const { result, resultJob } = session.forKind("features");
  const res = result as unknown as FeatResult | null;
  const params = useMemo(() => ({ n, seed, layer, filters: filtersToParams(filters) }), [n, seed, layer, filters]);
  return (
    <div className="space-y-5">
      <JobPanel
        kind="features"
        title="Feature laboratory"
        description="Channel activity in one convolutional layer across a sample: which channels are active, which differ between labels, and which images drive them."
        params={params}
        runLabel="Profile channels"
        estimate={`A few seconds for ${n} images.`}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Layer">
            <LayerSelect value={layer} onChange={setLayer} />
          </Field>
          <Field label="Images" hint={`At most ${context.limits.features}.`}>
            <NumberInput value={n} min={8} max={context.limits.features} onChange={setN} />
          </Field>
          <Field label="Seed">
            <NumberInput value={seed} min={0} onChange={setSeed} />
          </Field>
        </div>
        <FilterEditor value={filters} onChange={setFilters} />
      </JobPanel>
      {res ? <FeatResults res={res} job={resultJob} /> : <ResultEmpty>No channel profile yet for this session.</ResultEmpty>}
    </div>
  );
}

function FeatResults({ res, job }: { res: FeatResult; job: Parameters<typeof JobMeta>[0]["job"] }) {
  const [sort, setSort] = useState<SortKey>("d");
  const [selected, setSelected] = useState<number | null>(null);
  const val = (c: Channel): number => {
    const v = sort === "d" ? c.d_label?.d : sort === "mean" ? c.mean : sort === "active" ? c.active_rate : c.r_logit?.r;
    if (!isFiniteNum(v)) return -Infinity;
    return sort === "d" || sort === "r" ? Math.abs(v) : v;
  };
  const sorted = useMemo(() => [...res.channels].sort((a, b) => val(b) - val(a) || a.channel - b.channel), [res.channels, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const forest = [...res.channels]
    .filter((c) => isFiniteNum(c.d_label?.d))
    .sort((a, b) => Math.abs(b.d_label!.d!) - Math.abs(a.d_label!.d!))
    .slice(0, 12)
    .map((c) => ({ key: String(c.channel), label: `Channel ${c.channel}`, mean: c.d_label!.d, lo: c.d_label!.lo, hi: c.d_label!.hi, note: `active ${fmtPct(c.active_rate, 0)}` }));
  const sel = selected != null ? res.channels.find((c) => c.channel === selected) ?? null : null;

  return (
    <div className="space-y-5">
      <Panel title={`Layer ${res.layer}`} description={`Tensor ${res.tensor_shape.join(" × ")} per image (height × width × channels).`}>
        <div className="grid gap-x-8 sm:grid-cols-3">
          <MiniKV label="Channels" value={res.channels.length} />
          <MiniKV label="Never active on sample" value={`${res.dead_channels} (${fmtPct(res.dead_channels / Math.max(1, res.channels.length), 0)})`} hint="Zero activation on every sampled image." />
          <MiniKV
            label="Separate the labels"
            value={`${res.label_separating.count} (≈${res.label_separating.expected_by_chance} by chance)`}
            hint="Channels whose Cohen's d interval (label 1 vs 0) excludes zero. About 5% would by chance."
          />
        </div>
        {forest.length ? (
          <div className="mt-5">
            <p className="mb-2 text-[13px] font-medium text-white/70">Strongest label differences (Cohen's d, label 1 − label 0)</p>
            <IntervalPlot rows={forest} domain={intervalDomain(forest, 0)} reference={0} format={(v) => fmtNum(v, 2)} referenceLabel="no difference" />
          </div>
        ) : null}
        <div className="mt-4 space-y-1">
          {res.notes.map((t) => (
            <p key={t} className="text-[12.5px] leading-relaxed text-white/40">
              {t}
            </p>
          ))}
        </div>
        <div className="mt-3">
          <JobMeta job={job} result={res as unknown as Record<string, unknown>} />
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-12">
        <Panel
          title="Channels"
          className="xl:col-span-5"
          aside={
            <div className="flex gap-1">
              {(
                [
                  ["d", "|d|"],
                  ["mean", "Mean"],
                  ["active", "Active"],
                  ["r", "|r|"],
                ] as [SortKey, string][]
              ).map(([k, l]) => (
                <Chip key={k} active={sort === k} onClick={() => setSort(k)}>
                  {l}
                </Chip>
              ))}
            </div>
          }
        >
          <div className="max-h-[520px] overflow-y-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-black">
                <tr className="border-b border-white/[0.08] text-left text-white/45">
                  <th className="py-2 font-normal">Ch</th>
                  <th className="py-2 text-right font-normal">Mean</th>
                  <th className="py-2 text-right font-normal">Active</th>
                  <th className="py-2 text-right font-normal" title="Cohen's d, label 1 − label 0">
                    d (label)
                  </th>
                  <th className="py-2 text-right font-normal" title="Correlation with the model's logit">
                    r (logit)
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => (
                  <tr
                    key={c.channel}
                    onClick={() => setSelected(c.channel)}
                    className={cx("cursor-pointer border-b border-white/[0.05] transition hover:bg-white/[0.04]", selected === c.channel && "bg-white/[0.08]", c.active_rate === 0 && "text-white/30")}
                  >
                    <td className="py-1.5 font-digits tabular-nums">{c.channel}</td>
                    <td className="py-1.5 text-right font-digits tabular-nums">{fmtNum(c.mean, 3)}</td>
                    <td className="py-1.5 text-right font-digits tabular-nums">{fmtPct(c.active_rate, 0)}</td>
                    <td className="py-1.5 text-right font-digits tabular-nums">{c.d_label?.d != null ? fmtNum(c.d_label.d, 2) : MISSING}</td>
                    <td className="py-1.5 text-right font-digits tabular-nums">{c.r_logit?.r != null ? fmtNum(c.r_logit.r, 2) : MISSING}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="xl:col-span-7">{sel ? <ChannelDetail layer={res.layer} channel={sel} /> : <ResultEmpty>Select a channel to see the images that activate it most.</ResultEmpty>}</div>
      </div>

      <Panel title="Sample">
        <SampleSummary summary={res.summary} />
      </Panel>
    </div>
  );
}

function ChannelDetail({ layer, channel }: { layer: string; channel: Channel }) {
  const { ref, openImage } = useLab();
  const [maps, setMaps] = useState<Record<string, EncodedMap>>({});
  const [am, setAm] = useState<ActMaxResult | null>(null);
  const [amBusy, setAmBusy] = useState(false);
  const [amErr, setAmErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setMaps({});
    setAm(null);
    for (const img of channel.top_images) {
      labApi
        .explain(ref, { image_id: img.id, layer, methods: ["activations"], channels: [channel.channel] })
        .then((r) => {
          const m = r.maps.activations?.channels[0]?.map;
          if (alive && m) setMaps((cur) => ({ ...cur, [img.id]: m }));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [ref, layer, channel]);

  const runAm = async () => {
    setAmBusy(true);
    setAmErr(null);
    try {
      setAm(await labApi.actmax(ref, { layer, channel: channel.channel, steps: 96 }));
    } catch (e) {
      setAmErr(e instanceof Error ? e.message : "Could not run activation maximization");
    } finally {
      setAmBusy(false);
    }
  };

  return (
    <Panel title={`Channel ${channel.channel}`} description="Top-activating sampled images, with this channel's feature map overlaid (scaled to the layer's maximum for each image).">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {channel.top_images.map((img) => (
          <Thumb
            key={img.id}
            imageId={img.id}
            map={maps[img.id] ?? null}
            onClick={() => openImage(img.id)}
            caption={
              <span className="flex justify-between">
                <span style={{ color: img.label != null ? CLASS_COLORS[String(img.label)] : undefined }}>label {img.label ?? MISSING}</span>
                <span className="font-digits text-white/40">{fmtNum(img.value, 3)}</span>
              </span>
            }
          />
        ))}
      </div>
      <div className="mt-4 grid gap-x-8 sm:grid-cols-2">
        <MiniKV label="Mean intensity" value={fmtNum(channel.mean, 4)} />
        <MiniKV label="Active on" value={fmtPct(channel.active_rate, 0)} />
        <MiniKV label="d (label 1 − 0)" value={channel.d_label?.d != null ? `${fmtNum(channel.d_label.d, 2)} [${fmtNum(channel.d_label.lo, 2)}, ${fmtNum(channel.d_label.hi, 2)}]` : MISSING} />
        <MiniKV label="r with logit" value={channel.r_logit?.r != null ? `${fmtNum(channel.r_logit.r, 2)} [${fmtNum(channel.r_logit.lo, 2)}, ${fmtNum(channel.r_logit.hi, 2)}]` : MISSING} />
      </div>
      <div className="mt-5 rounded-xl border border-white/[0.08] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium text-white/75">Activation maximization · exploratory</p>
            <p className="text-[12.5px] text-white/40">Synthesize an input that increases this channel. Not a description of what it "means".</p>
          </div>
          <button type="button" className={btnSm} disabled={amBusy || channel.active_rate === 0} onClick={() => void runAm()}>
            {amBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Generate
          </button>
        </div>
        {channel.active_rate === 0 ? <p className="mt-2 text-[12.5px] text-white/40">This channel never activated on the sample, so gradient ascent has nothing to follow.</p> : null}
        {amErr ? <p className="mt-2 text-[13px] text-red-300/90">{amErr}</p> : null}
        {am ? (
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <MapCanvas base={`data:image/png;base64,${am.png}`} label="Synthesized input" />
            <div className="space-y-2 text-[12.5px] leading-relaxed text-white/45 sm:col-span-2">
              {am.stalled ? <p className="text-amber-200/80">The channel stayed at zero from this starting image; the result is the unchanged start.</p> : null}
              <p>Objective (mean activation) every 16 steps: {am.objective_trace.map((v) => fmtNum(v, 3)).join(" → ")}</p>
              <p>{am.note}</p>
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
