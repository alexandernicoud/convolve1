import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { Chip, Panel } from "@/features/review/components/primitives";
import { axisLabel, axisProps, ChartFrame, gridProps, SeriesLegend } from "@/components/viz/chartKit";
import { fmtNum, fmtPct, MISSING } from "@/lib/viz/format";
import { CLASS_COLORS, SEMANTIC, SERIES_ORDER, VIZ } from "@/lib/viz/tokens";
import { Field, FilterEditor, JobMeta, JobPanel, Limitations, MiniKV, NumberInput, ResultEmpty, SampleSummary, useLab } from "./components";
import { EMPTY_FILTERS, filtersToParams, type Filters } from "./lib";

type Point = { id: string; x: number; y: number; label: number | null; pred: number; confidence: number; p1: number; symbol: string | null; correct: boolean | null };
type EmbResult = {
  summary: Parameters<typeof SampleSummary>[0]["summary"];
  dim: number;
  inactive_units: number;
  explained_variance: number[];
  classifier_alignment: (number | null)[];
  points: Point[];
  caveats: string[];
};
type ColourBy = "label" | "pred" | "correct" | "symbol" | "confidence";

export default function RepresentationView() {
  const { context, session } = useLab();
  const [n, setN] = useState(500);
  const [seed, setSeed] = useState(0);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const { result, resultJob } = session.forKind("embedding");
  const res = result as unknown as EmbResult | null;
  const params = useMemo(() => ({ n, seed, filters: filtersToParams(filters) }), [n, seed, filters]);
  return (
    <div className="space-y-5">
      <JobPanel
        kind="embedding"
        title="Representation explorer"
        description={`The ${context.model.penultimate_dim}-dimensional vector the classifier reads (penultimate layer), projected to two principal components.`}
        params={params}
        runLabel="Project"
        estimate={`A few seconds for ${n} images.`}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Images" hint={`At most ${context.limits.embedding}.`}>
            <NumberInput value={n} min={10} max={context.limits.embedding} onChange={setN} />
          </Field>
          <Field label="Seed">
            <NumberInput value={seed} min={0} onChange={setSeed} />
          </Field>
        </div>
        <FilterEditor value={filters} onChange={setFilters} />
      </JobPanel>
      {res ? <EmbResults res={res} job={resultJob} /> : <ResultEmpty>No projection yet for this session.</ResultEmpty>}
    </div>
  );
}

function EmbResults({ res, job }: { res: EmbResult; job: Parameters<typeof JobMeta>[0]["job"] }) {
  const { openImage } = useLab();
  const [by, setBy] = useState<ColourBy>("label");
  const symbols = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of res.points) counts.set(p.symbol ?? "?", (counts.get(p.symbol ?? "?") ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  }, [res.points]);
  const colour = (p: Point): string => {
    if (by === "label") return p.label == null ? "rgba(255,255,255,0.25)" : CLASS_COLORS[String(p.label)];
    if (by === "pred") return CLASS_COLORS[String(p.pred)];
    if (by === "correct") return p.correct == null ? "rgba(255,255,255,0.25)" : p.correct ? "rgba(255,255,255,0.7)" : SEMANTIC.negative;
    if (by === "symbol") {
      const i = symbols.indexOf(p.symbol ?? "?");
      return i < 4 ? SERIES_ORDER[i].color : "rgba(255,255,255,0.2)";
    }
    const a = Math.max(0.12, Math.min(1, (p.confidence - 0.5) * 2));
    return `rgba(142,197,255,${a.toFixed(2)})`;
  };
  const legend =
    by === "label" || by === "pred"
      ? Object.entries(CLASS_COLORS).map(([k, c]) => ({ label: `${by === "label" ? "Label" : "Predicted"} ${k}`, color: c, kind: "dot" as const }))
      : by === "correct"
        ? [
            { label: "Correct", color: "rgba(255,255,255,0.7)", kind: "dot" as const },
            { label: "Incorrect", color: SEMANTIC.negative, kind: "dot" as const },
          ]
        : by === "symbol"
          ? [...symbols.slice(0, 4).map((s, i) => ({ label: s, color: SERIES_ORDER[i].color, kind: "dot" as const })), ...(symbols.length > 4 ? [{ label: "Other", color: "rgba(255,255,255,0.2)", kind: "dot" as const }] : [])]
          : [
              { label: "Confidence 50%", color: "rgba(142,197,255,0.12)", kind: "dot" as const },
              { label: "100%", color: "rgba(142,197,255,1)", kind: "dot" as const },
            ];
  const ev = res.explained_variance.map((v, i) => ({ pc: `PC${i + 1}`, v }));

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-12">
        <Panel
          title="Projection"
          description="Click a point to open that image in the explorer."
          className="xl:col-span-8"
          aside={
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["label", "Label"],
                  ["pred", "Predicted"],
                  ["correct", "Outcome"],
                  ["symbol", "Symbol"],
                  ["confidence", "Confidence"],
                ] as [ColourBy, string][]
              ).map(([k, l]) => (
                <Chip key={k} active={by === k} onClick={() => setBy(k)}>
                  {l}
                </Chip>
              ))}
            </div>
          }
        >
          <SeriesLegend items={legend} className="mb-3" />
          <div style={{ height: 420 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: 8 }}>
                <CartesianGrid {...gridProps} vertical />
                <XAxis dataKey="x" type="number" name="PC1" {...axisProps} tickFormatter={(v) => fmtNum(v, 1)} label={axisLabel(`PC1 (${fmtPct(res.explained_variance[0], 1)} of variance)`, "x")} />
                <YAxis dataKey="y" type="number" name="PC2" {...axisProps} width={48} tickFormatter={(v) => fmtNum(v, 1)} label={axisLabel(`PC2 (${fmtPct(res.explained_variance[1], 1)})`, "y")} />
                <ZAxis range={[28, 28]} />
                <Tooltip cursor={{ stroke: VIZ.axisLine }} content={<PointTip />} />
                <Scatter data={res.points} isAnimationActive={false} onClick={(d: { payload?: Point }) => d?.payload && openImage(d.payload.id)} className="cursor-pointer">
                  {res.points.map((p) => (
                    <Cell key={p.id} fill={colour(p)} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3">
            <JobMeta job={job} result={res as unknown as Record<string, unknown>} />
          </div>
        </Panel>
        <div className="space-y-5 xl:col-span-4">
          <Panel title="Structure">
            <MiniKV label="Dimensions" value={res.dim} />
            <MiniKV label="Always-zero units" value={`${res.inactive_units} of ${res.dim}`} hint="Units that never activated on this sample." />
            <MiniKV label="PC1 · PC2 variance" value={`${fmtPct(res.explained_variance[0], 1)} · ${fmtPct(res.explained_variance[1], 1)}`} />
            <MiniKV
              label="Classifier alignment"
              value={res.classifier_alignment.map((v, i) => `PC${i + 1} ${v == null ? MISSING : fmtNum(v, 2)}`).join(" · ")}
              hint="|cos| between the component and the output layer's weight direction (1 = the axis the classifier reads)."
            />
            <div className="mt-4">
              <ChartFrame title="Explained variance" height={200}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ev} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="pc" {...axisProps} interval={0} />
                    <YAxis {...axisProps} width={40} domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                    <Bar dataKey="v" fill="rgba(255,255,255,0.7)" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartFrame>
            </div>
          </Panel>
          <Panel title="Reading this plot">
            <Limitations items={res.caveats} />
          </Panel>
        </div>
      </div>
      <Panel title="Sample">
        <SampleSummary summary={res.summary} items={res.points as unknown as Record<string, unknown>[]} filename={`embedding-${job?.job_id ?? "result"}.csv`} />
      </Panel>
    </div>
  );
}

function PointTip({ active, payload }: { active?: boolean; payload?: { payload?: Point }[] }) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className="max-w-[260px] rounded-[10px] border border-white/[0.14] bg-black px-3 py-2 text-[12.5px] shadow-[0_12px_32px_rgba(0,0,0,0.6)]">
      <p className="truncate font-mono text-[11.5px] text-white/50">{p.id}</p>
      <p className="mt-1 text-white/80">
        Label {p.label ?? MISSING} · predicted {p.pred} ({fmtPct(p.confidence, 0)})
      </p>
      {p.symbol ? <p className="text-white/50">{p.symbol}</p> : null}
    </div>
  );
}
