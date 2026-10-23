import { Bar, BarChart, CartesianGrid, Cell, ErrorBar, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { KV, Panel, cx } from "@/features/review/components/primitives";
import { IntervalPlot, type IntervalRow } from "@/features/lab/components";
import { axisLabel, axisProps, ChartFrame, ChartPlaceholder, ChartTooltip, gridProps } from "@/components/viz/chartKit";
import { fmtInt, fmtNum, fmtPct, isFiniteNum } from "@/lib/viz/format";
import { SEMANTIC, SERIES, VIZ } from "@/lib/viz/tokens";
import { useWorkspace } from "../BacktestWorkspace";
import { fmtMoney, fmtSignedPct, metricValue, pctTick } from "../ui";
import { fmtVal } from "./PerformanceTab";

type Group = { group: string; n: number; net_pnl: number; mean_net_return: number | null; win_rate: number | null; win_rate_ci95: [number, number] | null; unstable: boolean };

export default function RobustnessTab() {
  const { metrics, summary } = useWorkspace();
  if (!metrics) return <ChartPlaceholder height={240}>Loading…</ChartPlaceholder>;
  const r = metrics.robustness ?? {};
  const cm = metrics.classification_metrics ?? {};
  const tm = metrics.trading_metrics ?? {};
  const minN = r.min_group_size ?? 10;
  const overallWin = metricValue(tm.win_rate);

  const probRows: IntervalRow[] = ((r.by_probability ?? []) as Group[]).map((g) => ({
    key: g.group,
    label: `p ${g.group}`,
    mean: g.win_rate,
    lo: g.win_rate_ci95?.[0] ?? null,
    hi: g.win_rate_ci95?.[1] ?? null,
    note: `n=${g.n}${g.unstable ? " · small" : ""}`,
    muted: g.unstable,
  }));

  const calib = ((cm.calibration ?? []) as { lo: number; hi: number; n: number; mean_prob: number | null; observed_rate: number | null; ci95: [number, number] | null }[])
    .filter((b) => b.n > 0 && isFiniteNum(b.mean_prob) && isFiniteNum(b.observed_rate))
    .map((b) => ({ ...b, err: b.ci95 ? [b.observed_rate! - b.ci95[0], b.ci95[1] - b.observed_rate!] : undefined }));

  const boot = r.bootstrap ?? {};
  const bootRows: IntervalRow[] = [
    { key: "ret", label: "Total return", mean: metricValue(tm.total_return), lo: boot.total_return_ci95?.[0] ?? null, hi: boot.total_return_ci95?.[1] ?? null },
  ];
  const sharpeRows: IntervalRow[] = [{ key: "sh", label: "Sharpe", mean: metricValue(tm.sharpe), lo: boot.sharpe_ci95?.[0] ?? null, hi: boot.sharpe_ci95?.[1] ?? null }];
  const span = (rows: IntervalRow[]): [number, number] | null => {
    const v = rows.flatMap((x) => [x.lo, x.hi, x.mean]).filter(isFiniteNum);
    if (!v.length) return null;
    const lo = Math.min(0, ...v), hi = Math.max(0, ...v), pad = (hi - lo) * 0.1 || 0.01;
    return [lo - pad, hi + pad];
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel>
          <ChartFrame
            title="Net P&L by quarter"
            note={`Faded bars have fewer than ${minN} trades.`}
            height={230}
            csv={{ filename: "pnl_by_quarter.csv", rows: r.by_quarter ?? [], columns: [{ key: "group", label: "quarter" }, { key: "n" }, { key: "net_pnl" }, { key: "mean_net_return" }, { key: "win_rate" }] }}
          >
            {!(r.by_quarter ?? []).length ? <ChartPlaceholder height={230}>No closed trades.</ChartPlaceholder> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={r.by_quarter} margin={{ top: 6, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="group" {...axisProps} interval="preserveStartEnd" />
                  <YAxis {...axisProps} width={56} tickFormatter={(v: number) => fmtMoney(v)} />
                  <ReferenceLine y={0} stroke={VIZ.axisLine} />
                  <Tooltip content={<ChartTooltip format={(v, k) => (k === "net_pnl" ? fmtMoney(v, 2) : String(v))} />} />
                  <Bar dataKey="net_pnl" name="Net P&L" isAnimationActive={false}>
                    {(r.by_quarter as Group[]).map((g) => (
                      <Cell key={g.group} fill={g.net_pnl >= 0 ? SEMANTIC.positive : SEMANTIC.negative} fillOpacity={g.unstable ? 0.3 : 0.75} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartFrame>
        </Panel>
        <Panel title="Net win rate by model probability" description={`95% Wilson intervals. Dashed line: overall net win rate ${fmtPct(overallWin)}.`}>
          <div className="pl-4">
            <IntervalPlot rows={probRows} domain={[0, 1]} reference={overallWin ?? undefined} referenceLabel="overall" format={(v) => fmtPct(v, 0)} />
            <p className="mt-2 text-[12.5px] text-white/45">If higher probabilities do not win more often, the model's ranking is not adding value at execution.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <GroupTable title="By year" rows={r.by_year ?? []} />
        <GroupTable title="By symbol" rows={r.by_symbol ?? []} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel>
          <ChartFrame
            title="Calibration"
            note="Observed label-1 rate against mean predicted probability, per probability decile with ≥1 chart. On the diagonal = calibrated."
            height={260}
          >
            {!calib.length ? <ChartPlaceholder height={260}>No populated probability bins.</ChartPlaceholder> : (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 6, right: 12, bottom: 16, left: 4 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis type="number" dataKey="mean_prob" domain={[0, 1]} {...axisProps} tickFormatter={pctTick} label={axisLabel("Mean predicted probability", "x")} />
                  <YAxis type="number" dataKey="observed_rate" domain={[0, 1]} {...axisProps} width={44} tickFormatter={pctTick} />
                  <ZAxis range={[40, 40]} />
                  <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke={VIZ.axisLine} strokeDasharray="3 3" />
                  <Tooltip content={<ChartTooltip format={(v) => fmtPct(v)} />} />
                  <Scatter data={calib} name="Observed" fill={SERIES.primary.color} isAnimationActive={false}>
                    <ErrorBar dataKey="err" direction="y" width={0} stroke={SERIES.tertiary.color} />
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </ChartFrame>
        </Panel>
        <Panel title="Classification quality against baselines" description={cm.note}>
          <div className="pl-4">
            <KV
              cols={2}
              rows={[
                ["Accuracy", `${fmtVal(cm.accuracy, (v) => fmtPct(v))} vs majority ${fmtVal(cm.majority_baseline_accuracy, (v) => fmtPct(v))}`, "Majority baseline always predicts the more common label."],
                ["ROC-AUC", `${fmtVal(cm.roc_auc, (v) => fmtNum(v, 3))}${cm.roc_auc?.ci95 ? ` [${fmtNum(cm.roc_auc.ci95[0], 3)}, ${fmtNum(cm.roc_auc.ci95[1], 3)}]` : ""}`, "0.5 = no ranking skill. Bootstrap 95% CI."],
                ["PR-AUC", `${fmtVal(cm.pr_auc, (v) => fmtNum(v, 3))} vs base rate ${fmtNum(cm.pr_auc?.baseline, 3)}`],
                ["Brier score", `${fmtVal(cm.brier, (v) => fmtNum(v, 3))} vs ${fmtNum(cm.brier?.reference_constant_base_rate, 3)}`, "Lower is better. Reference: always predicting the base rate."],
                ["Label-1 precision", `${fmtVal(cm.precision_label1, (v) => fmtPct(v))} (n=${fmtInt(cm.precision_label1?.n)})`, "Share of charts above the threshold that were labelled 1. Not a trading win rate."],
                ["Label-1 recall", fmtVal(cm.recall_label1, (v) => fmtPct(v))],
                ["Label-0 precision", fmtVal(cm.precision_label0, (v) => fmtPct(v))],
                ["Label-0 recall", fmtVal(cm.recall_label0, (v) => fmtPct(v))],
              ]}
            />
            {cm.confusion_matrix ? (
              <table className="mt-3 text-[12.5px] font-digits tabular-nums text-white/70">
                <thead className="text-white/40">
                  <tr><th /><th className="px-3 font-normal">Predicted 1</th><th className="px-3 font-normal">Predicted 0</th></tr>
                </thead>
                <tbody>
                  <tr><td className="pr-3 font-sans text-white/45">Label 1</td><td className="px-3 text-center">{cm.confusion_matrix.tp}</td><td className="px-3 text-center">{cm.confusion_matrix.fn}</td></tr>
                  <tr><td className="pr-3 font-sans text-white/45">Label 0</td><td className="px-3 text-center">{cm.confusion_matrix.fp}</td><td className="px-3 text-center">{cm.confusion_matrix.tn}</td></tr>
                </tbody>
              </table>
            ) : null}
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Cost sensitivity" description="Full re-simulation with costs scaled; same signals, sizing and threshold.">
          <div className="grid gap-4 px-4 sm:grid-cols-2">
            <SensTable title="Slippage" rows={r.slippage_sensitivity ?? []} pctKey="slippage_pct" />
            <SensTable title="Commission" rows={r.commission_sensitivity ?? []} pctKey="commission_pct" />
          </div>
        </Panel>
        <Panel title="Bootstrap uncertainty" description={`${boot.method ?? "Block bootstrap"}; block ${boot.block_length ?? "—"} days, ${fmtInt(boot.n_boot)} resamples, seed ${boot.seed ?? "—"}.`}>
          <div className="space-y-3 pl-4">
            <IntervalPlot rows={bootRows} domain={span(bootRows)} reference={0} format={(v) => fmtSignedPct(v)} />
            <IntervalPlot rows={sharpeRows} domain={span(sharpeRows)} reference={0} format={(v) => fmtNum(v, 2)} />
            <KV
              cols={2}
              rows={[
                ["Share of resamples ≤ 0 return", fmtPct(boot.p_total_return_le_0)],
                ["Top 3 trades' share of net P&L", r.concentration?.top3_share_of_net == null ? "Not meaningful" : fmtPct(r.concentration.top3_share_of_net), r.concentration?.note],
              ]}
            />
            <p className="text-[12px] text-white/40">The bootstrap resamples daily returns of this one path; it does not capture model or data-period uncertainty.</p>
          </div>
        </Panel>
      </div>
      <p className="text-[12px] text-white/35">Threshold {summary.threshold.value.toFixed(2)} for every robustness view.</p>
    </div>
  );
}

function GroupTable({ title, rows }: { title: string; rows: Group[] }) {
  return (
    <Panel title={title}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] text-[13px]">
          <thead className="text-left text-[12px] text-white/45">
            <tr>
              {["Group", "Trades", "Net P&L", "Mean net return", "Net win rate"].map((h) => (
                <th key={h} className="px-3 py-1.5 font-normal first:pl-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="font-digits tabular-nums">
            {rows.map((g) => (
              <tr key={g.group} className={cx("border-t border-white/[0.06]", g.unstable ? "text-white/40" : "text-white/75")}>
                <td className="px-3 py-1.5 pl-4 font-sans">{g.group}</td>
                <td className="px-3 py-1.5">{fmtInt(g.n)}</td>
                <td className="px-3 py-1.5">{fmtMoney(g.net_pnl, 2)}</td>
                <td className="px-3 py-1.5">{fmtSignedPct(g.mean_net_return, 2)}</td>
                <td className="px-3 py-1.5">
                  {fmtPct(g.win_rate)}
                  {g.win_rate_ci95 ? <span className="ml-1.5 text-white/35">[{fmtPct(g.win_rate_ci95[0], 0)}, {fmtPct(g.win_rate_ci95[1], 0)}]</span> : null}
                </td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={5} className="px-4 py-4 font-sans text-white/40">No closed trades.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function SensTable({ title, rows, pctKey }: { title: string; rows: Record<string, number>[]; pctKey: string }) {
  return (
    <table className="w-full text-[13px]">
      <caption className="pb-1 text-left text-[12.5px] text-white/60">{title}</caption>
      <thead className="text-left text-[12px] text-white/40">
        <tr><th className="py-1 font-normal">Multiplier</th><th className="py-1 text-right font-normal">Per side</th><th className="py-1 text-right font-normal">Return</th></tr>
      </thead>
      <tbody className="font-digits tabular-nums text-white/75">
        {rows.map((x) => (
          <tr key={x.multiplier} className={cx("border-t border-white/[0.06]", x.multiplier === 1 && "text-white")}>
            <td className="py-1">{x.multiplier}×{x.multiplier === 1 ? <span className="ml-1.5 font-sans text-[11.5px] text-white/45">headline</span> : null}</td>
            <td className="py-1 text-right">{fmtNum(x[pctKey], 3)}%</td>
            <td className="py-1 text-right">{fmtSignedPct(x.total_return)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
