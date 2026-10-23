import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Chip, Panel } from "@/features/review/components/primitives";
import { axisLabel, axisProps, ChartFrame, ChartTooltip, gridProps } from "@/components/viz/chartKit";
import { fmtPct, fmtPp, isFiniteNum, MISSING } from "@/lib/viz/format";
import { SERIES, SERIES_ORDER } from "@/lib/viz/tokens";
import type { CI, EncodedMap, Prop } from "./api";
import { Field, FilterEditor, IntervalPlot, JobMeta, JobPanel, LayerSelect, Limitations, NumberInput, ResultEmpty, SampleSummary, Select, useLab } from "./components";
import { EMPTY_FILTERS, filtersToParams, fmtCI, fmtProp, intervalDomain, type Filters } from "./lib";
import { MapCanvas, MapScale } from "./maps";

type Deltas = { delta: CI; abs_delta: CI; flip_rate?: Prop };
type SensResult = {
  summary: Parameters<typeof SampleSummary>[0]["summary"];
  target: string;
  baselines: Record<string, string>;
  regions: ({ region: string; baseline: string } & Deltas)[];
  paired: Record<string, { recent_minus_oldest: CI; upper_minus_lower: CI }>;
  sliding: { window: number; stride: number; baseline: string; rows: ({ start: number; end: number } & Deltas)[] };
  occlusion: null | { n: number; patch: number; fill: string; grid: [number, number]; map: EncodedMap };
  region_note: string;
  limitations: string[];
  per_image: Record<string, unknown>[];
};
type FaithRow = { k: number; masked_fraction: number; drop_top: CI; drop_random: CI; drop_bottom: CI; top_minus_random: CI; win_rate: Prop; match_gap: CI };
type FaithResult = {
  layer: string;
  summary: Parameters<typeof SampleSummary>[0]["summary"];
  n_used: number;
  n_all_zero: number;
  grid: number;
  repeats: number;
  baseline: string;
  baseline_note: string;
  rows: FaithRow[];
  design: string;
  limitations: string[];
};

const REGION_LABEL: Record<string, string> = {
  "time:oldest": "Oldest third",
  "time:middle": "Middle third (time)",
  "time:recent": "Most recent third",
  "price:upper": "Upper price third",
  "price:middle": "Middle price band",
  "price:lower": "Lower price third",
};
const BASELINE_LABEL: Record<string, string> = { white: "White background", blur: "Blurred copy", mean: "Sample mean image", black: "Black" };

export default function SensitivityView() {
  return (
    <div className="space-y-5">
      <RegionMasking />
      <Faithfulness />
    </div>
  );
}

function RegionMasking() {
  const { context, session } = useLab();
  const [n, setN] = useState(100);
  const [seed, setSeed] = useState(0);
  const [baselines, setBaselines] = useState<string[]>(["white", "blur", "mean", "black"]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const { result, resultJob } = session.forKind("sensitivity");
  const res = result as unknown as SensResult | null;
  const params = useMemo(() => ({ n, seed, baselines, filters: filtersToParams(filters) }), [n, seed, baselines, filters]);
  const toggle = (b: string) => setBaselines((cur) => (cur.includes(b) ? (cur.length > 1 ? cur.filter((x) => x !== b) : cur) : [...cur, b]));
  return (
    <>
      <JobPanel
        kind="sensitivity"
        title="Region masking"
        description="Replace each third of the chart (by time and by price level) and measure how the predicted class's probability changes, under several replacement baselines."
        params={params}
        runLabel="Run masking"
        estimate={`Roughly ${Math.max(10, Math.round(n * 1.3))} s for ${n} images (about 80 model passes per image).`}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Images" hint={`At most ${context.limits.sensitivity}.`}>
            <NumberInput value={n} min={4} max={context.limits.sensitivity} onChange={setN} />
          </Field>
          <Field label="Seed">
            <NumberInput value={seed} min={0} onChange={setSeed} />
          </Field>
          <Field label="Baselines" hint="The first selected baseline is also used for the sliding window.">
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(BASELINE_LABEL).map((b) => (
                <Chip key={b} active={baselines.includes(b)} onClick={() => toggle(b)} title={context.baselines[b]}>
                  {BASELINE_LABEL[b]}
                </Chip>
              ))}
            </div>
          </Field>
        </div>
        <FilterEditor value={filters} onChange={setFilters} />
      </JobPanel>
      {res ? <SensResults res={res} job={resultJob} /> : <ResultEmpty>No masking results yet for this session.</ResultEmpty>}
    </>
  );
}

function SensResults({ res, job }: { res: SensResult; job: Parameters<typeof JobMeta>[0]["job"] }) {
  const baselines = Object.keys(res.baselines);
  const colour = (b: string) => SERIES_ORDER[baselines.indexOf(b) % SERIES_ORDER.length].color;
  const rows = Object.keys(REGION_LABEL).flatMap((region) =>
    baselines.map((b, i) => {
      const r = res.regions.find((x) => x.region === region && x.baseline === b);
      return {
        key: `${region}|${b}`,
        label: i === 0 ? REGION_LABEL[region] : "",
        note: BASELINE_LABEL[b],
        mean: r?.delta.mean ?? null,
        lo: r?.delta.lo ?? null,
        hi: r?.delta.hi ?? null,
        color: colour(b),
      };
    }),
  );
  const pairedRows = baselines.flatMap((b) => [
    { key: `rmo|${b}`, label: "Recent − oldest", note: BASELINE_LABEL[b], ...pick(res.paired[b]?.recent_minus_oldest), color: colour(b) },
    { key: `uml|${b}`, label: "Upper − lower", note: BASELINE_LABEL[b], ...pick(res.paired[b]?.upper_minus_lower), color: colour(b) },
  ]);
  const slide = res.sliding.rows.map((r) => ({
    x: (r.start + r.end) / 2,
    mean: r.delta.mean,
    band: isFiniteNum(r.delta.lo) && isFiniteNum(r.delta.hi) ? [r.delta.lo, r.delta.hi] : null,
  }));
  return (
    <div className="space-y-5">
      <Panel title="Effect of masking each region" description={res.target}>
        <IntervalPlot rows={rows} domain={intervalDomain(rows, 0)} reference={0} format={(v) => fmtPp(v, 2)} referenceLabel="no change" />
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-b border-white/[0.08] text-left text-white/45">
                <th className="py-2 font-normal">Region</th>
                {baselines.map((b) => (
                  <th key={b} className="py-2 text-right font-normal">
                    Flip rate · {BASELINE_LABEL[b]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.keys(REGION_LABEL).map((region) => (
                <tr key={region} className="border-b border-white/[0.05]">
                  <td className="py-1.5 text-white/70">{REGION_LABEL[region]}</td>
                  {baselines.map((b) => (
                    <td key={b} className="py-1.5 text-right font-digits tabular-nums text-white/75">
                      {fmtProp(res.regions.find((x) => x.region === region && x.baseline === b)?.flip_rate)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] text-white/40">Flip rate: share of images whose predicted class changes (Wilson 95% interval).</p>
        </div>
        <div className="mt-4 space-y-1">
          {baselines.map((b) => (
            <p key={b} className="text-[12.5px] leading-relaxed text-white/45">
              <span className="text-white/65">{BASELINE_LABEL[b]}:</span> {res.baselines[b]}
            </p>
          ))}
        </div>
        <div className="mt-4">
          <JobMeta job={job} result={res as unknown as Record<string, unknown>} />
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Paired contrasts" description="Per image: effect of masking one end minus the other. Negative 'recent − oldest' means recent bars matter more.">
          <IntervalPlot rows={pairedRows} domain={intervalDomain(pairedRows, 0)} reference={0} format={(v) => fmtPp(v, 2)} referenceLabel="equal effect" />
        </Panel>
        <Panel title="Sliding window" description={`A ${Math.round(res.sliding.window * 100)}%-wide vertical strip (${BASELINE_LABEL[res.sliding.baseline]}) moved from oldest to most recent.`}>
          <ChartFrame
            height={220}
            note="Line: mean Δ probability of the predicted class. Band: 95% interval."
            csv={{ filename: "sliding-window.csv", rows: res.sliding.rows.map((r) => ({ start: r.start, end: r.end, mean: r.delta.mean, lo: r.delta.lo, hi: r.delta.hi })), columns: [{ key: "start" }, { key: "end" }, { key: "mean" }, { key: "lo" }, { key: "hi" }] }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={slide} margin={{ top: 6, right: 10, bottom: 16, left: 8 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="x" type="number" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} {...axisProps} label={axisLabel("Window centre (oldest → recent)", "x")} />
                <YAxis {...axisProps} width={56} tickFormatter={(v) => fmtPp(v, 1)} />
                <ReferenceLine y={0} stroke={SERIES.tertiary.color} strokeDasharray="3 3" />
                <Tooltip content={<ChartTooltip labelFormat={(l) => `Centre ${Math.round(Number(l) * 100)}%`} format={(v) => (Array.isArray(v) ? `${fmtPp(v[0], 2)} to ${fmtPp(v[1], 2)}` : fmtPp(v, 2))} />} />
                <Area dataKey="band" name="95% interval" stroke="none" fill="rgba(255,255,255,0.12)" isAnimationActive={false} connectNulls />
                <Line dataKey="mean" name="Mean Δ" stroke={SERIES.primary.color} strokeWidth={2} dot={{ r: 2.5, fill: SERIES.primary.color }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Panel>
      </div>

      {res.occlusion ? (
        <Panel title="Mean occlusion map" description={`A ${res.occlusion.patch}-px white patch slid across the image; mean change in the predicted class's probability over ${res.occlusion.n} images.`}>
          <div className="grid gap-6 md:grid-cols-12">
            <div className="md:col-span-4">
              <MapCanvas map={res.occlusion.map} palette="diverging" thirds label="Mean occlusion effect" />
            </div>
            <div className="space-y-3 md:col-span-8">
              <MapScale surface="dark" palette="diverging" min={res.occlusion.map.min} max={res.occlusion.map.max} format={(v) => fmtPp(v, 2)} lowLabel="lowers p" highLabel="raises p" note={res.occlusion.map.normalization} />
              <p className="text-[12.5px] leading-relaxed text-white/40">
                Coarse ({res.occlusion.grid.join(" × ")} positions). Blue cells are where removing candles lowers the model's confidence in its own prediction.
              </p>
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel title="Sample and limitations">
        <SampleSummary summary={res.summary} items={res.per_image.map((r) => ({ id: r.id, target: r.target, p_target: r.p_target }))} filename={`sensitivity-sample-${job?.job_id ?? "result"}.csv`} />
        <p className="mt-3 text-[12.5px] text-white/40">{res.region_note}</p>
        <div className="mt-3">
          <Limitations items={res.limitations} />
        </div>
      </Panel>
    </div>
  );
}

function pick(ci?: CI) {
  return { mean: ci?.mean ?? null, lo: ci?.lo ?? null, hi: ci?.hi ?? null };
}

function Faithfulness() {
  const { context, session } = useLab();
  const [n, setN] = useState(100);
  const [seed, setSeed] = useState(0);
  const [layer, setLayer] = useState(context.model.default_layer);
  const [repeats, setRepeats] = useState(10);
  const [baseline, setBaseline] = useState<"white" | "blur">("white");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const { result, resultJob } = session.forKind("faithfulness");
  const res = result as unknown as FaithResult | null;
  const params = useMemo(() => ({ n, seed, layer, repeats, baseline, filters: filtersToParams(filters) }), [n, seed, layer, repeats, baseline, filters]);
  return (
    <>
      <JobPanel
        kind="faithfulness"
        title="Grad-CAM faithfulness test"
        description="Does masking the cells Grad-CAM highlights hurt the prediction more than masking random cells with similar candle coverage?"
        params={params}
        runLabel="Run test"
        estimate={`Roughly ${Math.max(10, Math.round(n * 0.4))} s for ${n} images.`}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Field label="Images" hint={`At most ${context.limits.faithfulness}.`}>
            <NumberInput value={n} min={4} max={context.limits.faithfulness} onChange={setN} />
          </Field>
          <Field label="Seed">
            <NumberInput value={seed} min={0} onChange={setSeed} />
          </Field>
          <Field label="Layer">
            <LayerSelect value={layer} onChange={setLayer} />
          </Field>
          <Field label="Random repeats" hint="Random control draws per image (averaged).">
            <NumberInput value={repeats} min={1} max={20} onChange={setRepeats} />
          </Field>
          <Field label="Replace with" hint={context.baselines[baseline]}>
            <Select
              value={baseline}
              onChange={(v) => setBaseline(v as typeof baseline)}
              options={[
                { value: "white", label: "White background" },
                { value: "blur", label: "Blurred copy" },
              ]}
            />
          </Field>
        </div>
        <FilterEditor value={filters} onChange={setFilters} />
      </JobPanel>
      {res ? <FaithResults res={res} job={resultJob} /> : <ResultEmpty>No faithfulness test yet for this session.</ResultEmpty>}
    </>
  );
}

function FaithResults({ res, job }: { res: FaithResult; job: Parameters<typeof JobMeta>[0]["job"] }) {
  const rows = res.rows.flatMap((r) => [
    { key: `${r.k}-top`, label: `k = ${r.k} (${fmtPct(r.masked_fraction, 0)} of image)`, note: "Grad-CAM top cells", ...pick(r.drop_top), color: SERIES.primary.color },
    { key: `${r.k}-rand`, label: "", note: "Matched random cells", ...pick(r.drop_random), color: SERIES.secondary.color },
    { key: `${r.k}-bot`, label: "", note: "Lowest-attribution candle cells", ...pick(r.drop_bottom), color: SERIES.tertiary.color },
  ]);
  return (
    <div className="space-y-5">
      <Panel title="Probability drop when masking" description={`Layer ${res.layer} · ${res.grid}×${res.grid} grid · ${res.repeats} random draws per image · ${res.n_used} images (${res.n_all_zero} skipped: all-zero map).`}>
        <IntervalPlot rows={rows} domain={intervalDomain(rows, 0)} reference={0} format={(v) => fmtPp(v, 2)} referenceLabel="no drop" />
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[620px] text-[13px]">
            <thead>
              <tr className="border-b border-white/[0.08] text-left text-white/45">
                <th className="py-2 font-normal">Cells masked</th>
                <th className="py-2 text-right font-normal">Top − random</th>
                <th className="py-2 text-right font-normal">Top hurts more (win rate)</th>
                <th className="py-2 text-right font-normal">Coverage match gap</th>
              </tr>
            </thead>
            <tbody>
              {res.rows.map((r) => (
                <tr key={r.k} className="border-b border-white/[0.05]">
                  <td className="py-1.5 text-white/70">k = {r.k}</td>
                  <td className="py-1.5 text-right font-digits tabular-nums text-white/80">{fmtCI(r.top_minus_random, (v) => fmtPp(v, 2))}</td>
                  <td className="py-1.5 text-right font-digits tabular-nums text-white/80">{fmtProp(r.win_rate)}</td>
                  <td className="py-1.5 text-right font-digits tabular-nums text-white/60">{isFiniteNum(r.match_gap.mean) ? fmtPct(r.match_gap.mean, 1) : MISSING}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[12.5px] leading-relaxed text-white/45">{res.design}</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-white/40">{res.baseline_note}</p>
        <div className="mt-3">
          <JobMeta job={job} result={res as unknown as Record<string, unknown>} />
        </div>
      </Panel>
      <Panel title="Sample and limitations">
        <SampleSummary summary={res.summary} />
        <div className="mt-3">
          <Limitations items={res.limitations} />
        </div>
      </Panel>
    </div>
  );
}
