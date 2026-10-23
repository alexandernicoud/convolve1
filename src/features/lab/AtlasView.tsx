import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Chip, cx, Panel } from "@/features/review/components/primitives";
import { axisLabel, axisProps, ChartFrame, ChartTooltip, gridProps } from "@/components/viz/chartKit";
import { fmtNum, fmtPct, fmtPp, MISSING } from "@/lib/viz/format";
import { SERIES } from "@/lib/viz/tokens";
import type { CI, EncodedMap } from "./api";
import { Field, FilterEditor, IntervalPlot, JobMeta, JobPanel, LayerSelect, Limitations, MiniKV, NumberInput, ResultEmpty, SampleSummary, Select, Thumb, useLab } from "./components";
import { EMPTY_FILTERS, filtersToParams, intervalDomain, type Filters } from "./lib";
import { MapCanvas, MapScale } from "./maps";

type RegionStats = { attention: CI; ink: CI; excess_over_ink: CI };
type Profile = {
  n: number;
  time: Record<string, RegionStats>;
  price: Record<string, RegionStats>;
  foreground_share: CI;
  foreground_area: CI;
  col_profile: { mean: number[]; sd: number[] };
  row_profile: { mean: number[]; sd: number[] };
};
type Example = { id: string; label: number | null; pred: number; probs: number[]; typicality: number; map: EncodedMap };
type Group = { n: number; map: EncodedMap; profile: Profile; examples: { typical: Example[]; atypical: Example[] } };
type AtlasResult = {
  layer: string;
  grid: [number, number];
  target: string;
  summary: Parameters<typeof SampleSummary>[0]["summary"];
  n_used: number;
  n_all_zero: number;
  normalization: string;
  mean_map: EncodedMap;
  std_map: EncodedMap;
  typicality: { summary: CI; quartiles: [number, number, number] | null };
  profile: Profile;
  examples: { typical: Example[]; atypical: Example[] };
  groups: Record<string, { groups: Record<string, Group>; difference?: { a: string; b: string; map: EncodedMap; max_abs: number; regions: Record<string, Record<string, CI>>; foreground_share: CI } }>;
  region_note: string;
  items: Record<string, unknown>[];
  method: string;
};

const TIME = [
  ["oldest", "Oldest third"],
  ["middle", "Middle third"],
  ["recent", "Most recent third"],
] as const;
const PRICE = [
  ["upper", "Upper third (high prices)"],
  ["middle", "Middle band"],
  ["lower", "Lower third (low prices)"],
] as const;

export default function AtlasView() {
  const { context, session } = useLab();
  const [n, setN] = useState(200);
  const [seed, setSeed] = useState(0);
  const [layer, setLayer] = useState(context.model.default_layer);
  const [target, setTarget] = useState("predicted");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const { result, resultJob } = session.forKind("atlas");
  const res = result as unknown as AtlasResult | null;
  const params = useMemo(() => ({ n, seed, layer, target, filters: filtersToParams(filters) }), [n, seed, layer, target, filters]);

  return (
    <div className="space-y-5">
      <JobPanel
        kind="atlas"
        title="Attention atlas"
        description="Grad-CAM across a seeded sample of images: where evidence concentrates on average, how consistent it is, and how it differs between groups."
        params={params}
        runLabel="Build atlas"
        estimate={`About ${Math.max(5, Math.round(n / 20))} s for ${n} images at ${context.model.input_size[0]} px.`}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Images" hint={`At most ${context.limits.atlas}.`}>
            <NumberInput value={n} min={4} max={context.limits.atlas} onChange={setN} />
          </Field>
          <Field label="Seed" hint="Same seed + filters = same sample.">
            <NumberInput value={seed} min={0} onChange={setSeed} />
          </Field>
          <Field label="Layer">
            <LayerSelect value={layer} onChange={setLayer} />
          </Field>
          <Field label="Explain class">
            <Select value={target} onChange={setTarget} options={[{ value: "predicted", label: "Predicted class" }, ...Array.from({ length: context.model.n_classes }, (_, c) => ({ value: String(c), label: `Label ${c}` }))]} />
          </Field>
        </div>
        <FilterEditor value={filters} onChange={setFilters} />
      </JobPanel>
      {res ? <AtlasResults res={res} job={resultJob} /> : <ResultEmpty>No atlas yet for this session. Build one to see aggregate attention.</ResultEmpty>}
    </div>
  );
}

function AtlasResults({ res, job }: { res: AtlasResult; job: Parameters<typeof JobMeta>[0]["job"] }) {
  const { openImage } = useLab();
  return (
    <div className="space-y-5">
      <Panel title="Average attention" description={`Layer ${res.layer} (${res.grid.join(" × ")} grid) · explaining ${res.target === "predicted" ? "each image's predicted class" : `label ${res.target}`}`}>
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <MapCanvas map={res.mean_map} thirds label="Mean Grad-CAM" />
            <div className="mt-2">
              <MapScale surface="dark" palette="sequential" min={res.mean_map.min} max={res.mean_map.max} format={(v) => fmtNum(v, 2)} note={res.mean_map.normalization} />
            </div>
          </div>
          <div className="lg:col-span-4">
            <MapCanvas map={res.std_map} thirds label="Standard deviation" />
            <div className="mt-2">
              <MapScale surface="dark" palette="sequential" min={res.std_map.min} max={res.std_map.max} format={(v) => fmtNum(v, 2)} note="Dispersion across images: where individual maps disagree most." />
            </div>
          </div>
          <div className="space-y-3 lg:col-span-4">
            <MiniKV label="Images in aggregate" value={`${res.n_used}`} />
            <MiniKV label="All-zero maps (excluded)" value={`${res.n_all_zero}`} hint="No positive evidence at this layer for the explained class." />
            <MiniKV
              label="Typicality (median r)"
              value={res.typicality.quartiles ? `${fmtNum(res.typicality.quartiles[1], 2)} (IQR ${fmtNum(res.typicality.quartiles[0], 2)}–${fmtNum(res.typicality.quartiles[2], 2)})` : MISSING}
              hint="Correlation of each image's map with the mean map. Low values: the mean is a poor summary."
            />
            <MiniKV label="Mass on candles" value={fmtPct(res.profile.foreground_share.mean)} hint={`95% interval ${fmtPct(res.profile.foreground_share.lo)}–${fmtPct(res.profile.foreground_share.hi)}`} />
            <MiniKV label="Candle area" value={fmtPct(res.profile.foreground_area.mean)} />
            <p className="pt-1 text-[12.5px] leading-relaxed text-white/40">{res.normalization}</p>
          </div>
        </div>
        <div className="mt-5">
          <JobMeta job={job} result={res as unknown as Record<string, unknown>} />
        </div>
      </Panel>

      <SpatialProfile profile={res.profile} note={res.region_note} />

      <GroupComparison res={res} />

      <Panel title="Representative images" description="Most typical (highest correlation with the mean map) and most atypical. Click to open in the explorer.">
        <ExampleRow title="Typical" items={res.examples.typical} onOpen={openImage} />
        {res.examples.atypical.length ? <ExampleRow title="Atypical" items={res.examples.atypical} onOpen={openImage} /> : null}
      </Panel>

      <Panel title="Sample" description="What the aggregate was computed on.">
        <SampleSummary summary={res.summary} items={res.items} filename={`atlas-sample-${job?.job_id ?? "result"}.csv`} />
        <p className="mt-3 text-[12.5px] leading-relaxed text-white/40">{res.method}</p>
      </Panel>
    </div>
  );
}

function SpatialProfile({ profile, note }: { profile: Profile; note: string }) {
  const rows = (axis: "time" | "price", names: readonly (readonly [string, string])[]) =>
    names.map(([k, label]) => ({
      key: k,
      label,
      mean: profile[axis][k]?.excess_over_ink.mean ?? null,
      lo: profile[axis][k]?.excess_over_ink.lo ?? null,
      hi: profile[axis][k]?.excess_over_ink.hi ?? null,
      note: `${fmtPct(profile[axis][k]?.attention.mean, 0)} attention vs ${fmtPct(profile[axis][k]?.ink.mean, 0)} candles`,
    }));
  const t = rows("time", TIME);
  const p = rows("price", PRICE);
  const domain = intervalDomain([...t, ...p], 0);
  const colData = profile.col_profile.mean.map((v, i, arr) => ({ x: (i + 0.5) / arr.length, v }));
  const rowData = profile.row_profile.mean.map((v, i, arr) => ({ x: (i + 0.5) / arr.length, v }));
  return (
    <Panel title="Spatial profile" description={note}>
      <div className="grid gap-8 xl:grid-cols-2">
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-[13px] font-medium text-white/70">Time (horizontal thirds)</p>
            <IntervalPlot rows={t} domain={domain} reference={0} format={(v) => fmtPp(v, 1)} referenceLabel="attention equals candle share" />
          </div>
          <div>
            <p className="mb-2 text-[13px] font-medium text-white/70">Price level (vertical thirds)</p>
            <IntervalPlot rows={p} domain={domain} reference={0} format={(v) => fmtPp(v, 1)} referenceLabel="attention equals candle share" />
          </div>
          <p className="text-[12.5px] leading-relaxed text-white/40">
            Each row is attention share minus candle share in that region, per image, averaged (bootstrap 95% interval). Positive: the model concentrates evidence there beyond
            where the candles are. Comparing with candle share rather than area avoids rewarding regions just for containing more ink.
          </p>
        </div>
        <div className="space-y-5">
          <DensityChart title="Attention along time" note="1 = uniform. Left is the oldest bar, right the most recent." data={colData} xLabel="Horizontal position (oldest → recent)" />
          <DensityChart title="Attention along price" note="1 = uniform. Left is the top of the chart (highest price)." data={rowData} xLabel="Vertical position (top → bottom)" />
        </div>
      </div>
    </Panel>
  );
}

function DensityChart({ title, note, data, xLabel }: { title: string; note: string; data: { x: number; v: number }[]; xLabel: string }) {
  return (
    <ChartFrame title={title} note={note} height={170} csv={{ filename: `${title.toLowerCase().replace(/\s+/g, "-")}.csv`, rows: data, columns: [{ key: "x", label: "position" }, { key: "v", label: "relative density" }] }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 10, bottom: 16, left: 4 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="x" type="number" domain={[0, 1]} ticks={[0, 0.333, 0.667, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} {...axisProps} label={axisLabel(xLabel, "x")} />
          <YAxis {...axisProps} width={40} tickFormatter={(v) => fmtNum(v, 1)} />
          <ReferenceLine y={1} stroke={SERIES.tertiary.color} strokeDasharray="3 3" />
          <Tooltip content={<ChartTooltip labelFormat={(l) => `Position ${Math.round(Number(l) * 100)}%`} format={(v) => fmtNum(v as number, 2)} />} />
          <Line type="monotone" dataKey="v" name="Relative density" stroke={SERIES.primary.color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function GroupComparison({ res }: { res: AtlasResult }) {
  const keys = Object.keys(res.groups);
  const [by, setBy] = useState(keys[0] ?? "");
  const { openImage } = useLab();
  if (!keys.length) return null;
  const g = res.groups[by] ?? res.groups[keys[0]];
  const diff = g.difference;
  const names = Object.keys(g.groups);
  const diffRows = diff
    ? [...TIME.map(([k, l]) => ({ axis: "time", k, l })), ...PRICE.map(([k, l]) => ({ axis: "price", k, l }))].map(({ axis, k, l }) => ({
        key: `${axis}:${k}`,
        label: l,
        mean: diff.regions[axis]?.[k]?.mean ?? null,
        lo: diff.regions[axis]?.[k]?.lo ?? null,
        hi: diff.regions[axis]?.[k]?.hi ?? null,
        note: `n ${diff.regions[axis]?.[k]?.n_a ?? "—"} / ${diff.regions[axis]?.[k]?.n_b ?? "—"}`,
      }))
    : [];
  return (
    <Panel
      title="Group comparison"
      description="Where each group places its attention (maps divided by their own mean, so 1 = uniform), the difference, and region-share differences."
      aside={
        <div className="flex gap-1.5">
          {keys.map((k) => (
            <Chip key={k} active={by === k} onClick={() => setBy(k)}>
              {k === "predicted" ? "Predicted class" : k === "label" ? "True label" : "Correct vs incorrect"}
            </Chip>
          ))}
        </div>
      }
    >
      <div className="grid gap-5 md:grid-cols-3">
        {names.map((name) => (
          <div key={name}>
            <MapCanvas map={g.groups[name].map} thirds label={name} />
            <p className="mt-1.5 text-[13px] text-white/70">
              {name} <span className="text-white/40">· n {g.groups[name].n}</span>
            </p>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {g.groups[name].examples.typical.slice(0, 4).map((e) => (
                <Thumb key={e.id} imageId={e.id} map={e.map} onClick={() => openImage(e.id)} />
              ))}
            </div>
          </div>
        ))}
        {diff ? (
          <div>
            <MapCanvas map={diff.map} palette="diverging" thirds label="Difference" />
            <p className="mt-1.5 text-[13px] text-white/70">
              {diff.a} − {diff.b}
            </p>
            <div className="mt-2">
              <MapScale surface="dark" palette="diverging" min={diff.map.min} max={diff.map.max} format={(v) => fmtNum(v, 2)} lowLabel={`more in ${diff.b}`} highLabel={`more in ${diff.a}`} note={diff.map.normalization} />
            </div>
          </div>
        ) : null}
      </div>
      {diff ? (
        <div className={cx("mt-6")}>
          <p className="mb-2 text-[13px] font-medium text-white/70">
            Attention share difference ({diff.a} − {diff.b})
          </p>
          <IntervalPlot rows={diffRows} domain={intervalDomain(diffRows, 0)} reference={0} format={(v) => fmtPp(v, 1)} referenceLabel="no difference" />
          <Limitations items={["Six comparisons, not corrected for multiplicity.", "Group maps share one colour scale; the difference map uses its own symmetric scale."]} />
        </div>
      ) : (
        <p className="mt-4 text-[12.5px] text-white/40">Difference statistics are shown for two-group comparisons.</p>
      )}
    </Panel>
  );
}

function ExampleRow({ title, items, onOpen }: { title: string; items: Example[]; onOpen: (id: string) => void }) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-[13px] text-white/55">{title}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {items.map((e) => (
          <Thumb
            key={e.id}
            imageId={e.id}
            map={e.map}
            onClick={() => onOpen(e.id)}
            caption={
              <span className="flex justify-between">
                <span>
                  →{e.pred} {fmtPct(e.probs[e.pred], 0)}
                </span>
                <span className="font-digits text-white/40">r {fmtNum(e.typicality, 2)}</span>
              </span>
            }
          />
        ))}
      </div>
    </div>
  );
}
