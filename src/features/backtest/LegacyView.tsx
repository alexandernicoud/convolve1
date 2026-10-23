import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KV, Panel } from "@/features/review/components/primitives";
import { axisLabel, axisProps, ChartFrame, ChartPlaceholder, ChartTooltip, gridProps } from "@/components/viz/chartKit";
import { fmtInt, fmtNum, fmtPct, fmtPctUnits, isFiniteNum } from "@/lib/viz/format";
import { SERIES, VIZ } from "@/lib/viz/tokens";
import type { V1Summary } from "./api";
import { Banner, fmtMoney } from "./ui";

/** Legacy (label_payoff_v1) results. Never presented as realized trading performance. */
export default function LegacyView({ summary: s }: { summary: V1Summary }) {
  const k = s.kpis;
  const cm = s.classification_metrics;
  const eq = (s.series?.equity ?? []) as { step_index: number; equity: number; as_of_date?: string }[];
  const sweep = (s.series?.threshold_sweep ?? []) as { entry_threshold: number; return_pct: number; win_rate_pct: number; trades: number }[];
  const capital = Number(k.starting_capital);

  return (
    <div className="space-y-5">
      <Banner tone="warn">
        <p className="font-medium">{s.banner}</p>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] text-amber-100/75">
          {s.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <p className="mt-2 text-[13px] text-amber-100/70">Re-run this model on a dataset with stored prices to get a price-based simulation (v2).</p>
      </Banner>

      <Panel title="Label-payoff estimate" description="Each chart above the threshold is valued as if it paid the configured TP or SL from its label. These are not executed trades.">
        <div className="pl-4">
          <KV
            cols={3}
            rows={[
              ["Estimated return", isFiniteNum(k.return_pct) ? fmtPctUnits(k.return_pct) : "—"],
              ["Estimated P&L", fmtMoney(k.pnl, 2), `On ${fmtMoney(capital)} starting capital`],
              ["Charts above threshold", `${fmtInt(k.trades)} of ${fmtInt(k.total_charts_analyzed)}`, "Overlapping charts are counted separately."],
              ["Label-1 precision", isFiniteNum(k.win_rate) ? fmtPctUnits(k.win_rate) : "—", "Share of selected charts labelled 1. Not a trading win rate."],
              ["Drawdown below start", isFiniteNum(k.drawdown_below_start_pct) ? fmtPctUnits(k.drawdown_below_start_pct) : "—", "Lowest estimate relative to starting capital."],
              ["Peak to trough of the estimate", isFiniteNum(k.peak_to_trough_drawdown_pct_of_estimate) ? fmtPctUnits(k.peak_to_trough_drawdown_pct_of_estimate) : "—", "Recomputed from the estimate path with a running peak."],
              ["Profit factor of the estimate", fmtNum(k.profit_factor, 2)],
              ["Model accuracy", isFiniteNum(k.accuracy) ? fmtPctUnits(k.accuracy) : "—", cm.majority_baseline_accuracy != null ? `Majority baseline ${fmtPct(cm.majority_baseline_accuracy)}` : undefined],
              ["Positive base rate", cm.positive_base_rate != null ? fmtPct(cm.positive_base_rate) : "—", cm.n ? `n=${cm.n}` : undefined],
            ]}
          />
          {Object.keys(s.withheld_metrics ?? {}).length ? (
            <p className="mt-3 text-[12.5px] text-white/45">
              Withheld: {Object.entries(s.withheld_metrics).map(([m, why]) => `${m.replace(/_/g, " ")} (${why})`).join("; ")}
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <ChartFrame
          title="Estimate path by chart order"
          note="Cumulative label payoff in the order charts were scored. The x-axis is chart index, not calendar time."
          height={260}
        >
          {!eq.length ? (
            <ChartPlaceholder height={260}>No estimate path recorded.</ChartPlaceholder>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={eq} margin={{ top: 6, right: 12, bottom: 16, left: 4 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="step_index" type="number" domain={["dataMin", "dataMax"]} {...axisProps} label={axisLabel("Chart index", "x")} />
                <YAxis {...axisProps} width={64} domain={["auto", "auto"]} tickFormatter={(v: number) => fmtMoney(v)} />
                <ReferenceLine y={capital} stroke={VIZ.axisLine} strokeDasharray="3 3" />
                <Tooltip content={<ChartTooltip labelFormat={(l) => `Chart ${l}`} format={(v) => fmtMoney(v, 2)} />} />
                <Line type="linear" dataKey="equity" name="Estimate" stroke={SERIES.secondary.color} strokeDasharray={SERIES.secondary.dash} strokeWidth={VIZ.stroke.secondary} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartFrame>
      </Panel>

      {sweep.length ? (
        <Panel title={s.threshold_sweep_label} description="Computed on the same test charts. Not a basis for choosing a threshold.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-[13px]">
              <thead className="text-left text-[12px] text-white/45">
                <tr>
                  {["Threshold", "Charts selected", "Estimated return", "Label-1 precision"].map((h) => (
                    <th key={h} className="px-3 py-1.5 font-normal first:pl-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-digits tabular-nums text-white/70">
                {sweep.map((r) => (
                  <tr key={r.entry_threshold} className="border-t border-white/[0.06]">
                    <td className="px-3 py-1.5 pl-4">{fmtNum(r.entry_threshold, 2)}</td>
                    <td className="px-3 py-1.5">{fmtInt(r.trades)}</td>
                    <td className="px-3 py-1.5">{fmtPctUnits(r.return_pct)}</td>
                    <td className="px-3 py-1.5">{fmtPctUnits(r.win_rate_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <Panel title="Run settings">
        <div className="pl-4">
          <KV
            cols={3}
            rows={Object.entries(s.config)
              .filter(([, v]) => v == null || typeof v !== "object")
              .slice(0, 18)
              .map(([key, v]) => [key.replace(/_/g, " "), v == null ? "—" : String(v)] as [string, string])}
          />
        </div>
      </Panel>
    </div>
  );
}
