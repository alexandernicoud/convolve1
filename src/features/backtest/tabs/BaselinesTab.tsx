import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { btnSm, cx, EmptyState, Panel } from "@/features/review/components/primitives";
import { IntervalPlot, type IntervalRow } from "@/features/lab/components";
import { fmtInt, fmtNum, fmtPct, isFiniteNum } from "@/lib/viz/format";
import { SEMANTIC } from "@/lib/viz/tokens";
import type { IncrementalStrategy, IncrementalValue, PairedComparison } from "../api";
import { useWorkspace } from "../BacktestWorkspace";
import { findingActionLink } from "../findingActions";
import { fmtSignedPct } from "../ui";

const VERDICT_TONE: Record<IncrementalValue["verdict"]["id"], string> = {
  edge: SEMANTIC.positive,
  inconclusive: SEMANTIC.warning,
  no_edge: SEMANTIC.negative,
  invalid: "rgba(255,255,255,0.45)",
};

type Row = { key: string; name: string; note?: string; s: IncrementalStrategy | null; range?: [number | null, number | null] };

export default function BaselinesTab() {
  const { summary, runId } = useWorkspace();
  const inc = summary.incremental;
  if (!inc) {
    return (
      <EmptyState
        title="No baseline comparison for this run"
        body="This backtest was created before Convolve compared every run with no-model baselines. Run it again to see whether the CNN adds value over trading the same setups without it."
      />
    );
  }
  const tone = VERDICT_TONE[inc.verdict.id] ?? VERDICT_TONE.invalid;
  const trainerRunId = summary.model.trainer_run_id ?? summary.model.training_run_id ?? null;
  const ctx = { runId, trainerRunId, modelId: summary.model.model_id ?? null, datasetId: summary.dataset.dataset_id ?? null };
  const next =
    inc.verdict.id === "edge"
      ? findingActionLink({ kind: "new_test_set", label: "Confirm on a new, later test set" }, ctx)
      : inc.verdict.id === "invalid"
        ? null
        : findingActionLink({ kind: "improve", label: "Improve the model" }, ctx) ?? findingActionLink({ kind: "analyze", label: "Analyze what the model attends to" }, ctx);

  const re = inc.random_entry;
  const rows: Row[] = [
    { key: "cnn", name: "CNN strategy", note: `${fmtInt(inc.candidates.cnn)} of ${fmtInt(inc.candidates.eligible)} charts above the threshold`, s: inc.cnn },
    { key: "ae", name: "Every eligible chart", note: "Same setups, no model filter", s: inc.always_eligible ?? null },
    {
      key: "re",
      name: "Random entry (median)",
      note: re ? `${re.draws} seeded draws of the same size; range is the 5th–95th percentile` : undefined,
      s: re ? { total_return: re.median_total_return, executed_trades: re.median_executed_trades ?? undefined } : null,
      range: re ? [re.p05_total_return, re.p95_total_return] : undefined,
    },
    { key: "pa", name: "Exposure-matched passive", note: inc.passive?.label, s: inc.passive ? { total_return: inc.passive.total_return } : null },
  ];

  const paired: IntervalRow[] = [
    pairedRow("ae", "CNN − every eligible chart", inc.paired?.always_eligible),
    pairedRow("pa", "CNN − exposure-matched passive", inc.paired?.passive),
  ].filter((r): r is IntervalRow => r !== null);
  const domain = span(paired);

  return (
    <div className="space-y-5" data-help="bt-baselines">
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5" style={{ borderLeft: `2px solid ${tone}` }}>
        <p className="text-[11.5px] uppercase tracking-wide" style={{ color: tone }}>Incremental value of the CNN</p>
        <h3 className="mt-1 text-[17px] font-medium text-white">{inc.verdict.label}</h3>
        <ul className="mt-2 space-y-1 text-[13.5px] leading-relaxed text-white/70">
          {inc.verdict.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
        {summary.evaluation_class !== "independent_test" ? (
          <p className="mt-2 text-[12.5px] text-white/45">This run is not an independent test, so the verdict is capped at inconclusive.</p>
        ) : null}
        {next ? (
          <Link to={next.to} className={cx(btnSm, "mt-3 inline-flex items-center gap-1.5")}>
            {next.label}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : null}
      </section>

      <Panel title="Same trades, with and without the model" description={inc.same_as_cnn}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-white/[0.08] text-left text-[12px] text-white/45">
                <th className="py-2 pr-3 font-normal">Strategy</th>
                <th className="py-2 pr-3 text-right font-normal">Total return</th>
                <th className="py-2 pr-3 text-right font-normal">Sharpe</th>
                <th className="py-2 pr-3 text-right font-normal">Max drawdown</th>
                <th className="py-2 pr-3 text-right font-normal">Per trade (net)</th>
                <th className="py-2 text-right font-normal">Trades</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={cx("border-b border-white/[0.05] align-top", r.key === "cnn" && "text-white")}>
                  <td className="py-2.5 pr-3">
                    <p className={r.key === "cnn" ? "font-medium" : "text-white/80"}>{r.name}</p>
                    {r.note ? <p className="mt-0.5 text-[12px] text-white/40">{r.note}</p> : null}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-digits tabular-nums text-white/85">
                    {r.s ? fmtSignedPct(r.s.total_return) : "—"}
                    {r.range ? <span className="block text-[11.5px] text-white/40">{fmtSignedPct(r.range[0])} to {fmtSignedPct(r.range[1])}</span> : null}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-digits tabular-nums text-white/70">{fmtNum(r.s?.sharpe, 2)}</td>
                  <td className="py-2.5 pr-3 text-right font-digits tabular-nums text-white/70">{fmtPct(r.s?.max_drawdown)}</td>
                  <td className="py-2.5 pr-3 text-right font-digits tabular-nums text-white/70">{fmtSignedPct(r.s?.expectancy_return, 3)}</td>
                  <td className="py-2.5 text-right font-digits tabular-nums text-white/70">{fmtInt(r.s?.executed_trades)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {re && isFiniteNum(re.cnn_percentile) ? (
          <p className="mt-3 text-[13px] text-white/60">
            The CNN beats {fmtPct(re.cnn_percentile, 0)} of random selections of the same size
            {isFiniteNum(re.p_random_ge_cnn) ? ` (estimated chance that random selection does at least as well: ${fmtPct(re.p_random_ge_cnn, 0)})` : ""}.
          </p>
        ) : null}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Paired difference, annualized"
          description="Circular moving-block bootstrap of the per-bar return difference on the dates both strategies share. An interval that crosses zero means the difference is not established."
        >
          {paired.length ? (
            <IntervalPlot rows={paired} domain={domain} reference={0} referenceLabel="no difference" format={(v) => fmtSignedPct(v, 1)} />
          ) : (
            <p className="text-[13px] text-white/40">Not enough shared dates to compare.</p>
          )}
          {paired.length ? (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] text-white/45">
              {inc.paired?.always_eligible ? (
                <>
                  <dt>Bootstrap</dt>
                  <dd className="text-white/60">
                    {fmtInt(inc.paired.always_eligible.n_periods)} periods, block length {inc.paired.always_eligible.block_length}, {fmtInt(inc.paired.always_eligible.n_boot)} resamples
                  </dd>
                </>
              ) : null}
            </dl>
          ) : null}
        </Panel>

        <Panel title="By year" description={isFiniteNum(inc.years_cnn_ahead) && inc.by_year?.length ? `The CNN was ahead of every eligible chart in ${inc.years_cnn_ahead} of ${inc.by_year.length} years.` : undefined}>
          {inc.by_year?.length ? (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-white/[0.08] text-left text-[12px] text-white/45">
                  <th className="py-2 pr-3 font-normal">Year</th>
                  <th className="py-2 pr-3 text-right font-normal">CNN</th>
                  <th className="py-2 pr-3 text-right font-normal">Every eligible</th>
                  <th className="py-2 text-right font-normal">Difference</th>
                </tr>
              </thead>
              <tbody>
                {inc.by_year.map((y) => (
                  <tr key={y.year} className="border-b border-white/[0.05]">
                    <td className="py-2 pr-3 font-digits text-white/80">{y.year}</td>
                    <td className="py-2 pr-3 text-right font-digits tabular-nums text-white/70">{fmtSignedPct(y.cnn)}</td>
                    <td className="py-2 pr-3 text-right font-digits tabular-nums text-white/70">{fmtSignedPct(y.always_eligible)}</td>
                    <td
                      className="py-2 text-right font-digits tabular-nums"
                      style={{ color: !isFiniteNum(y.diff) || y.diff === 0 ? undefined : y.diff > 0 ? SEMANTIC.positive : SEMANTIC.negative }}
                    >
                      {fmtSignedPct(y.diff)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[13px] text-white/40">No yearly breakdown.</p>
          )}
        </Panel>
      </div>

      <details className="rounded-xl border border-white/[0.06] px-4 py-3 text-[12.5px] text-white/50">
        <summary className="cursor-pointer text-white/65">How the baselines are built</summary>
        <p className="mt-2 whitespace-pre-line leading-relaxed">{inc.method}</p>
      </details>
    </div>
  );
}

function pairedRow(key: string, label: string, p: PairedComparison | undefined): IntervalRow | null {
  if (!p || !isFiniteNum(p.mean_diff_annualized)) return null;
  return {
    key,
    label,
    mean: p.mean_diff_annualized,
    lo: p.ci95_annualized?.[0] ?? null,
    hi: p.ci95_annualized?.[1] ?? null,
    note: isFiniteNum(p.p_diff_le_0) ? `P(diff ≤ 0) ${fmtPct(p.p_diff_le_0, 0)}` : undefined,
  };
}

function span(rows: IntervalRow[]): [number, number] | null {
  const v = rows.flatMap((x) => [x.lo, x.hi, x.mean]).filter(isFiniteNum);
  if (!v.length) return null;
  const lo = Math.min(0, ...v), hi = Math.max(0, ...v), pad = (hi - lo) * 0.1 || 0.01;
  return [lo - pad, hi + pad];
}
