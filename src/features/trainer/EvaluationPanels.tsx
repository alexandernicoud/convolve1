import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PartitionMetrics, TrainingSession } from "@/lib/api";
import { fmtInt, fmtNum, fmtPct, isFiniteNum } from "@/lib/viz/format";
import { CLASS_COLORS, SEMANTIC, SERIES, VIZ } from "@/lib/viz/tokens";
import { axisLabel, axisProps, ChartFrame, ChartTooltip, gridProps } from "@/components/viz/chartKit";
import { Caveat, Chip, KV, Panel } from "@/features/review/components/primitives";
import { SplitPreviewView } from "./SplitPreview";
import { findings, histogramShares, metricRows, selectionName, stoppingText, versusBaseline, type MetricRow } from "./evaluation";

const PART_TITLE: Record<string, string> = { validation: "Validation", test: "Test period" };

function fmtMetric(r: MetricRow, v: number | null) {
  if (v == null) return "—";
  return r.pct ? fmtPct(v, 1) : fmtNum(v, r.key === "roc_auc" || r.key === "pr_auc" ? 3 : 4);
}

function MetricTable({ m }: { m: PartitionMetrics }) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[11.5px] text-white/40">
          <th className="py-1.5 font-medium">Metric</th>
          <th className="py-1.5 text-right font-medium">Model</th>
          <th className="py-1.5 text-right font-medium">Baseline</th>
          <th className="hidden py-1.5 pl-4 font-medium md:table-cell">Baseline is</th>
        </tr>
      </thead>
      <tbody>
        {metricRows(m).map((r) => {
          const vs = versusBaseline(r);
          return (
            <tr key={r.key} className="border-t border-white/[0.06]">
              <td className="py-1.5 text-white/75">{r.label}</td>
              <td className="py-1.5 text-right font-digits tabular-nums text-white/90" title={r.undefinedReason}>
                {r.model == null && r.undefinedReason ? <span className="text-white/40">undefined</span> : fmtMetric(r, r.model)}
                {vs ? (
                  <span
                    className="ml-2 text-[11px]"
                    style={{ color: vs === "better" ? SEMANTIC.positive : vs === "worse" ? SEMANTIC.negative : undefined }}
                  >
                    {vs === "better" ? "better" : vs === "worse" ? "worse" : "same"}
                  </span>
                ) : null}
              </td>
              <td className="py-1.5 text-right font-digits tabular-nums text-white/50">{fmtMetric(r, r.baseline)}</td>
              <td className="hidden py-1.5 pl-4 text-[12px] text-white/40 md:table-cell">{r.baseline != null ? r.baselineNote : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Confusion({ m }: { m: PartitionMetrics }) {
  const cm = m.confusion_matrix?.rows_true_cols_pred;
  if (!cm) return null;
  const total = cm.flat().reduce((a, b) => a + b, 0) || 1;
  return (
    <div>
      <p className="mb-2 text-[12px] text-white/50">Confusion matrix (threshold 0.5)</p>
      <table className="text-[12.5px]">
        <thead>
          <tr className="text-white/40">
            <th />
            <th className="px-3 pb-1 font-normal">Predicted 0</th>
            <th className="px-3 pb-1 font-normal">Predicted 1</th>
          </tr>
        </thead>
        <tbody>
          {cm.map((row, i) => (
            <tr key={i}>
              <td className="pr-3 text-white/40">True {i}</td>
              {row.map((v, j) => (
                <td key={j} className="px-1 py-0.5">
                  <div
                    className="rounded-md px-3 py-2 text-center font-digits tabular-nums text-white"
                    style={{ background: `rgba(255,255,255,${0.04 + 0.4 * (v / total)})`, outline: i === j ? "1px solid rgba(255,255,255,0.25)" : undefined }}
                  >
                    {fmtInt(v)}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProbabilityHistogram({ m }: { m: PartitionMetrics }) {
  const h = m.probability_histogram;
  if (!h) return null;
  const bins = histogramShares(h);
  const max = Math.max(0.0001, ...bins.flatMap((b) => [b.label0, b.label1]));
  return (
    <div>
      <p className="mb-2 text-[12px] text-white/50">
        Predicted probability of label 1, share of each true label per bin
        {isFiniteNum(m.mean_probability) ? ` · mean ${fmtNum(m.mean_probability, 3)}` : ""}
      </p>
      <div className="flex h-28 items-end gap-[3px]" role="img" aria-label="Probability histogram per true label">
        {bins.map((b) => (
          <div key={b.from} className="flex h-full flex-1 items-end gap-[1px]" title={`${b.from}–${b.to}: label 0 ${fmtPct(b.label0, 0)}, label 1 ${fmtPct(b.label1, 0)}`}>
            <span className="flex-1 rounded-t-sm" style={{ height: `${(b.label0 / max) * 100}%`, background: CLASS_COLORS["0"] }} />
            <span className="flex-1 rounded-t-sm" style={{ height: `${(b.label1 / max) * 100}%`, background: CLASS_COLORS["1"] }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-digits text-[11px] tabular-nums text-white/35">
        <span>0</span>
        <span>0.5</span>
        <span>1</span>
      </div>
      <p className="mt-1 flex gap-4 text-[11.5px] text-white/45">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: CLASS_COLORS["0"] }} /> true label 0
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: CLASS_COLORS["1"] }} /> true label 1
        </span>
      </p>
    </div>
  );
}

function labelMix(counts?: Record<string, number> | null) {
  if (!counts) return null;
  const n0 = counts["0"] ?? 0;
  const n1 = counts["1"] ?? 0;
  const n = n0 + n1;
  return n ? `${fmtInt(n0)} / ${fmtInt(n1)} (${fmtPct(n1 / n, 0)} label 1)` : null;
}

/** Final evaluation of the saved model per partition, always next to the constant baseline. */
export function EvaluationPanel({ session }: { session: TrainingSession }) {
  const ev = session.evaluation;
  const parts = (["validation", "test"] as const).filter((k) => ev?.[k]);
  const [tab, setTab] = useState<"validation" | "test">("validation");
  if (!ev || !parts.length) return null;
  const active = parts.includes(tab) ? tab : parts[0];
  const m = ev[active] as PartitionMetrics;
  const reserved = m.status === "reserved_not_evaluated";
  const facts = findings(m);
  return (
    <Panel
      help="train-evaluation"
      title="Evaluation of the saved model"
      description={`Scored once after training with the weights the run kept (best ${selectionName(session)}). Every metric is shown next to a model that ignores the chart.`}
      aside={
        parts.length > 1 ? (
          <div className="flex gap-2">
            {parts.map((p) => (
              <Chip key={p} active={active === p} onClick={() => setTab(p)}>
                {PART_TITLE[p]}
              </Chip>
            ))}
          </div>
        ) : undefined
      }
    >
      {reserved ? (
        <div className="space-y-2 text-[13.5px] leading-relaxed text-white/65" data-help="train-test-status">
          <p>
            {fmtInt(m.n)} charts from the latest period are reserved as a test set and were not scored by this run. They were not used for
            training, for choosing the epoch, or for any setting.
          </p>
          <p className="text-white/45">
            Keep them for one final check of the model you settle on. Scoring them after every change, and choosing by the result, turns them
            into a second validation set.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {active === "test" ? (
            <p className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12.5px] leading-relaxed text-white/55" data-help="train-test-status">
              Test period scored once after training. It did not influence the saved epoch or any setting of this run; if you change settings
              because of this result, it stops being an independent test.
            </p>
          ) : null}
          {facts.length ? (
            <ul className="list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed text-white/75">
              {facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <MetricTable m={m} />
              <p className="mt-2 text-[12px] text-white/40">
                {fmtInt(m.n)} charts · true labels 0 / 1: {labelMix(m.label_counts) ?? "—"} · predicted: {labelMix(m.predicted_counts) ?? "—"}
              </p>
            </div>
            <div className="space-y-5 lg:col-span-5">
              <Confusion m={m} />
              <ProbabilityHistogram m={m} />
            </div>
          </div>
        </div>
      )}
      <Caveat>
        {ev.threshold_note ? `${ev.threshold_note} ` : ""}These are classification metrics. They do not measure profitability: trading costs, position
        sizing and which errors are expensive are tested in the Backtester. Accuracy above 50% alone is not evidence of skill.
      </Caveat>
    </Panel>
  );
}

/** Partitions, purged charts and warnings as recorded by the run. */
export function SplitPanel({ session }: { session: TrainingSession }) {
  if (!session.split) return null;
  const c = session.config;
  return (
    <Panel
      help="train-split-recorded"
      title="Data split"
      description="Recorded when training started. The exact chart lists are stored with the run, so Analysis Lab can filter by partition."
    >
      <SplitPreviewView
        data={{
          ok: true,
          plan: session.split,
          label_window: {
            label_horizon_bars: c?.label_horizon_bars,
            label_timeframe: c?.label_timeframe,
            label_horizon_source: c?.label_horizon_source ?? null,
          },
        }}
        loading={false}
        error={null}
      />
    </Panel>
  );
}

const SERIES_KEYS = [
  { key: "val_balanced_accuracy", label: "Balanced accuracy", color: SEMANTIC.validation },
  { key: "val_auc", label: "ROC-AUC", color: SERIES.secondary.color, dash: SERIES.secondary.dash },
  { key: "val_pr_auc", label: "PR-AUC", color: SERIES.tertiary.color, dash: SERIES.tertiary.dash },
] as const;

/** Validation ranking/balance metrics and the learning rate per epoch (protocol 2 runs). */
export function SelectionCurves({ session }: { session: TrainingSession }) {
  const rows = useMemo(() => [...(session.history ?? [])].sort((a, b) => a.epoch - b.epoch), [session.history]);
  const present = SERIES_KEYS.filter((s) => rows.some((r) => isFiniteNum(r[s.key])));
  const hasLr = rows.some((r) => isFiniteNum(r.learning_rate));
  if (!present.length && !hasLr) return null;
  const best = session.best_epoch ?? null;
  const lrValues = rows.map((r) => r.learning_rate).filter(isFiniteNum);
  const lrMax = lrValues.length ? Math.max(...lrValues) : 1;
  const metricValues = rows.flatMap((r) => present.map((s) => r[s.key])).filter(isFiniteNum);
  const metricDomain: [number, number] = [
    Math.max(0, Math.floor(Math.min(0.4, ...metricValues) * 20) / 20),
    Math.min(1, Math.ceil(Math.max(0.6, ...metricValues) * 20) / 20),
  ];
  return (
    <Panel
      help="train-selection-curves"
      title="Validation metrics and learning rate"
      description={`The dashed line marks the epoch the run kept, chosen by ${selectionName(session)}. Other metrics can peak at other epochs.`}
    >
      <div className="grid gap-6 xl:grid-cols-2">
        {present.length ? (
          <ChartFrame
            title="Validation balance and ranking"
            note="0.5 is the level of a model that ignores the chart."
            legend={present.map((s) => ({ label: s.label, color: s.color, dash: "dash" in s ? s.dash : undefined }))}
            height={220}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 14, left: 4 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="epoch" type="number" domain={["dataMin", "dataMax"]} allowDecimals={false} {...axisProps} label={axisLabel("Epoch", "x")} />
                <YAxis {...axisProps} width={44} domain={metricDomain} tickFormatter={(v: number) => v.toFixed(2)} />
                <Tooltip content={<ChartTooltip labelFormat={(l) => `Epoch ${l}`} format={(v) => fmtNum(v, 3)} />} />
                <ReferenceLine y={0.5} stroke="rgba(255,255,255,0.3)" strokeDasharray="2 4" />
                {best != null ? <ReferenceLine x={best} stroke="rgba(255,255,255,0.35)" strokeDasharray="3 4" /> : null}
                {present.map((s) => (
                  <Line
                    key={s.key}
                    type="linear"
                    dataKey={s.key}
                    name={s.label}
                    stroke={s.color}
                    strokeDasharray={"dash" in s ? s.dash : undefined}
                    strokeWidth={VIZ.stroke.secondary}
                    dot={rows.length <= 40 ? { r: 2, strokeWidth: 0, fill: s.color } : false}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        ) : null}
        {hasLr ? (
          <ChartFrame title="Learning rate" note="Value at the end of each epoch." height={220}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 14, left: 4 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="epoch" type="number" domain={["dataMin", "dataMax"]} allowDecimals={false} {...axisProps} label={axisLabel("Epoch", "x")} />
                <YAxis {...axisProps} width={60} domain={[0, lrMax * 1.05]} tickFormatter={(v: number) => v.toExponential(1)} />
                <Tooltip content={<ChartTooltip labelFormat={(l) => `Epoch ${l}`} format={(v) => (typeof v === "number" ? v.toExponential(2) : String(v))} />} />
                {best != null ? <ReferenceLine x={best} stroke="rgba(255,255,255,0.35)" strokeDasharray="3 4" /> : null}
                <Line type="stepAfter" dataKey="learning_rate" name="Learning rate" stroke={SERIES.primary.color} strokeWidth={VIZ.stroke.secondary} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        ) : null}
      </div>
    </Panel>
  );
}

/** Stopping reason, model size and what makes the run reproducible. */
export function DiagnosticsPanel({ session, className }: { session: TrainingSession; className?: string }) {
  const r = session.reproducibility;
  const model = session.model;
  const env = (r?.environment ?? {}) as Record<string, unknown>;
  const opts = session.options;
  const stop = stoppingText(session);
  if (!r && !model && !stop) return null;
  const short = (s?: string | null) => (s ? `${s.slice(0, 12)}…` : null);
  return (
    <Panel
      help="train-diagnostics"
      title="Run diagnostics"
      description="How the run ended, what was trained, and what is needed to reproduce it."
      className={className}
    >
      <KV
        cols={1}
        rows={[
          ["Stopped because", stop],
          ["Kept epoch", session.best_epoch ? `${session.best_epoch} (best ${selectionName(session)})` : null],
          ["Parameters", isFiniteNum(model?.parameters) ? fmtInt(model?.parameters) : null],
          [
            "Trainable parameters",
            isFiniteNum(model?.trainable_parameters)
              ? model?.trainable_parameters === model?.parameters
                ? "All"
                : fmtInt(model?.trainable_parameters)
              : null,
          ],
          ["Forward pass", isFiniteNum(model?.forward_gflops) ? `${fmtNum(model?.forward_gflops, 2)} GFLOPs per image` : null],
          ["Class weighting", opts?.class_weighting === "balanced" ? "Balanced (training loss only)" : opts ? "None" : null],
          ["Augmentation", opts ? (opts.augmentation?.length ? opts.augmentation.join(", ").replace(/_/g, " ") : "None") : null],
          [
            "Starting weights",
            opts?.transfer && opts.transfer.mode !== "scratch"
              ? opts.transfer.mode === "frozen"
                ? "ImageNet, frozen"
                : `ImageNet, last ${opts.transfer.trainable_layers} layers fine-tuned`
              : opts
                ? "Random (from scratch)"
                : null,
          ],
          ["Random seed", r?.random_seed ?? null],
          ["Deterministic operations", r ? (r.op_determinism ? "On" : "Off") : null],
          ["Software", env.tensorflow ? `TensorFlow ${String(env.tensorflow)} · Keras ${String(env.keras ?? "?")}` : null],
          ["Device", env.device ? `${String(env.device)}${env.machine ? ` · ${String(env.machine)}` : ""}` : null],
          ["Dataset manifest", short(session.split?.manifest_sha256)],
          ["Weights fingerprint", short(r?.weights_sha256)],
        ]}
      />
      {r ? (
        <Caveat>
          Same dataset manifest, settings, seed, software and hardware reproduce the same weights fingerprint. A different CPU type or a GPU can
          change the last decimal places.
        </Caveat>
      ) : null}
    </Panel>
  );
}

export function isProtocol2(session: TrainingSession | null | undefined): boolean {
  return (session?.trainer_protocol ?? session?.config?.trainer_protocol ?? 1) >= 2;
}