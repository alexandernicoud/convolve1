import { useMemo } from "react";
import { CartesianGrid, ErrorBar, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel, cx } from "@/features/review/components/primitives";
import { axisLabel, axisProps, ChartFrame, ChartPlaceholder, ChartTooltip, gridProps } from "@/components/viz/chartKit";
import { fmtInt, fmtNum, fmtPct, isFiniteNum } from "@/lib/viz/format";
import { SEMANTIC, SERIES, VIZ } from "@/lib/viz/tokens";
import { useWorkspace } from "../BacktestWorkspace";
import { Banner, fmtSignedPct, pctTick } from "../ui";

type SweepRow = {
  threshold: number;
  is_headline: boolean;
  signals: number;
  label1_precision: number | null;
  label1_precision_ci95: [number, number] | null;
  total_return: number | null;
  executed_trades: number;
  max_drawdown: number | null;
};

const MULTIPLES: { key: keyof SweepRow; title: string; fmt: (v: unknown) => string; tick: (v: number) => string; ref?: "zero" | "base" }[] = [
  { key: "total_return", title: "Net total return", fmt: (v) => fmtSignedPct(v), tick: pctTick, ref: "zero" },
  { key: "label1_precision", title: "Label-1 precision (95% CI)", fmt: (v) => fmtPct(v), tick: pctTick, ref: "base" },
  { key: "executed_trades", title: "Executed trades", fmt: fmtInt, tick: (v) => fmtInt(v) },
  { key: "max_drawdown", title: "Max drawdown", fmt: (v) => fmtPct(v), tick: pctTick },
];

export default function ThresholdTab() {
  const { metrics, summary } = useWorkspace();
  const sweep = metrics?.threshold_sweep;
  const headline = summary.threshold.value;
  const rows = useMemo(
    () =>
      ((sweep?.rows ?? []) as SweepRow[]).map((r) => ({
        ...r,
        ci_err:
          isFiniteNum(r.label1_precision) && r.label1_precision_ci95
            ? [r.label1_precision - r.label1_precision_ci95[0], r.label1_precision_ci95[1] - r.label1_precision]
            : undefined,
      })),
    [sweep],
  );
  const sel = summary.threshold.selection;
  const minPos = Number(sel?.min_predicted_positives ?? 0);
  const curve = useMemo(
    () =>
      ((sel?.curve ?? []) as Record<string, number | null>[]).map((c) =>
        Number(c.predicted_positives) < minPos ? { ...c, precision: null, f1: null } : c,
      ),
    [sel, minPos],
  );

  return (
    <div className="space-y-5">
      <Banner tone="warn">
        <p className="font-medium">{sweep?.label ?? "In-sample sensitivity — not independently validated."}</p>
        <p className="mt-1 text-[13px] text-amber-100/70">
          Every point below re-runs the simulation on the same test data. Picking the best-looking threshold here and reporting its result would be selection on the test set. The headline uses{" "}
          <span className="font-digits">{headline.toFixed(2)}</span>, {summary.threshold.source === "validation_locked" ? "chosen on validation data before the test set was scored" : "fixed by the user before the run"}.
        </p>
      </Banner>

      {sel?.curve?.length ? (
        <Panel>
          <ChartFrame
            title="How the threshold was selected (validation data)"
            note={`Rule ${sel.rule} over ${fmtInt(sel.n_validation)} validation charts (base rate ${fmtPct(sel.validation_base_rate)}). Precision and F1 are blank where fewer than ${sel.min_predicted_positives} charts are predicted positive. Source: ${sel.source}.`}
            legend={[
              { label: "F1 (label 1)", color: SEMANTIC.validation },
              { label: "Precision", color: SERIES.secondary.color, dash: SERIES.secondary.dash },
              { label: "Recall", color: SERIES.tertiary.color, dash: SERIES.tertiary.dash },
            ]}
            height={240}
            csv={{ filename: "validation_threshold_curve.csv", rows: sel.curve, columns: [{ key: "threshold" }, { key: "predicted_positives" }, { key: "precision" }, { key: "recall" }, { key: "f1" }] }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve} margin={{ top: 6, right: 12, bottom: 16, left: 4 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="threshold" type="number" domain={[sel.grid?.[0] ?? 0.3, sel.grid?.[1] ?? 0.9]} {...axisProps} tickFormatter={(v: number) => v.toFixed(2)} label={axisLabel("Threshold", "x")} />
                <YAxis {...axisProps} width={48} domain={[0, 1]} tickFormatter={pctTick} />
                <ReferenceLine x={headline} stroke={SERIES.primary.color} strokeDasharray="3 3" label={{ value: `selected ${headline.toFixed(2)}`, fill: VIZ.tick, fontSize: 11, position: "insideTopRight" }} />
                <Tooltip content={<ChartTooltip labelFormat={(l) => `Threshold ${fmtNum(l, 2)}`} format={(v) => fmtPct(v)} />} />
                <Line type="linear" dataKey="f1" name="F1" stroke={SEMANTIC.validation} strokeWidth={VIZ.stroke.primary} dot={false} isAnimationActive={false} />
                <Line type="linear" dataKey="precision" name="Precision" stroke={SERIES.secondary.color} strokeDasharray={SERIES.secondary.dash} strokeWidth={VIZ.stroke.secondary} dot={false} isAnimationActive={false} />
                <Line type="linear" dataKey="recall" name="Recall" stroke={SERIES.tertiary.color} strokeDasharray={SERIES.tertiary.dash} strokeWidth={VIZ.stroke.secondary} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
          {sel.caveats?.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-[12.5px] text-white/45">
              {sel.caveats.map((c: string) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : null}
        </Panel>
      ) : (
        <Panel title="Threshold source">
          <p className="pl-4 text-[13.5px] text-white/60">
            {summary.threshold.note ?? "The threshold was fixed by the user. No validation predictions were available to select it, so this run is exploratory."}
          </p>
        </Panel>
      )}

      <Panel title="Test-set sensitivity" description="Each panel shares the threshold axis. Points are separate simulations; lines only connect neighbouring grid values. The dashed line marks the headline threshold.">
        {!metrics ? (
          <ChartPlaceholder height={200}>Loading…</ChartPlaceholder>
        ) : !rows.length ? (
          <ChartPlaceholder height={200}>No sweep was computed for this run.</ChartPlaceholder>
        ) : (
          <div className="grid gap-x-6 gap-y-5 pl-1 md:grid-cols-2">
            {MULTIPLES.map((m) => (
              <ChartFrame key={m.key} title={m.title} height={170}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 6, right: 10, bottom: 2, left: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="threshold" type="number" domain={["dataMin", "dataMax"]} {...axisProps} tickFormatter={(v: number) => v.toFixed(2)} />
                    <YAxis {...axisProps} width={48} tickFormatter={m.tick} domain={m.key === "label1_precision" ? [0, 1] : ["auto", "auto"]} />
                    <ReferenceLine x={headline} stroke={SERIES.primary.color} strokeDasharray="3 3" />
                    {m.ref === "zero" ? <ReferenceLine y={0} stroke={VIZ.axisLine} /> : null}
                    {m.ref === "base" && isFiniteNum(sweep?.base_rate) ? (
                      <ReferenceLine y={sweep!.base_rate!} stroke={VIZ.axisLine} strokeDasharray="2 3" label={{ value: "base rate", fill: VIZ.tick, fontSize: 11, position: "insideBottomRight" }} />
                    ) : null}
                    <Tooltip content={<ChartTooltip labelFormat={(l) => `Threshold ${fmtNum(l, 2)}`} format={(v) => m.fmt(v)} />} />
                    <Line type="linear" dataKey={m.key} name={m.title} stroke={SERIES.secondary.color} strokeWidth={1} dot={{ r: 2.5, fill: SERIES.primary.color, stroke: "none" }} isAnimationActive={false} connectNulls={false}>
                      {m.key === "label1_precision" ? <ErrorBar dataKey="ci_err" width={0} stroke={SERIES.tertiary.color} /> : null}
                    </Line>
                  </LineChart>
                </ResponsiveContainer>
              </ChartFrame>
            ))}
          </div>
        )}
      </Panel>

      {rows.length ? (
        <Panel title="Sweep values">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-[13px]">
              <thead className="text-left text-[12px] text-white/45">
                <tr>
                  {["Threshold", "Signals", "Label-1 precision", "95% CI", "Executed", "Net return", "Max drawdown"].map((h) => (
                    <th key={h} className="px-3 py-1.5 font-normal first:pl-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-digits tabular-nums">
                {rows.map((r) => (
                  <tr key={r.threshold} className={cx("border-t border-white/[0.06]", r.is_headline ? "text-white" : "text-white/65")}>
                    <td className="px-3 py-1.5 pl-4">{r.threshold.toFixed(2)}{r.is_headline ? <span className="ml-2 font-sans text-[11.5px] text-white/50">headline</span> : null}</td>
                    <td className="px-3 py-1.5">{fmtInt(r.signals)}</td>
                    <td className="px-3 py-1.5">{fmtPct(r.label1_precision)}</td>
                    <td className="px-3 py-1.5 text-white/45">{r.label1_precision_ci95 ? `${fmtPct(r.label1_precision_ci95[0], 0)}–${fmtPct(r.label1_precision_ci95[1], 0)}` : "—"}</td>
                    <td className="px-3 py-1.5">{fmtInt(r.executed_trades)}</td>
                    <td className="px-3 py-1.5">{fmtSignedPct(r.total_return)}</td>
                    <td className="px-3 py-1.5">{fmtPct(r.max_drawdown)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
