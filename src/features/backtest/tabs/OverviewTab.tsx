import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KV, Panel, cx, surface } from "@/features/review/components/primitives";
import { axisProps, ChartFrame, ChartPlaceholder, ChartTooltip, gridProps, type LegendItem } from "@/components/viz/chartKit";
import { fmtInt, fmtPct, isFiniteNum, niceScale, paddedDomain } from "@/lib/viz/format";
import { SERIES, VIZ } from "@/lib/viz/tokens";
import { useWorkspace } from "../BacktestWorkspace";
import { AuditList, Banner, fmtDay, fmtMoney, fmtSignedPct, metricValue, MetricStat, monthTick } from "../ui";

export const BENCH_STYLE: Record<string, { color: string; dash?: string }> = {
  spy: SERIES.secondary,
  underlying: SERIES.tertiary,
  exposure_matched: SERIES.quaternary,
  equal_weight: SERIES.tertiary,
};

export function useEquityRows() {
  const { equity } = useWorkspace();
  return useMemo(() => {
    if (!equity) return null;
    const bench = new Map(equity.benchmarks.map((b) => [String(b.date), b]));
    return equity.equity.map((r) => ({ ...bench.get(r.date), ...r }));
  }, [equity]);
}

export default function OverviewTab() {
  const { summary, equity } = useWorkspace();
  const tm = summary.trading_metrics;
  const bm = summary.benchmarks.benchmarks;
  const rows = useEquityRows();
  const capital = Number(summary.config.starting_capital);
  const benchKeys = Object.keys(bm).filter((k) => rows?.some((r) => isFiniteNum((r as Record<string, unknown>)[k])));

  const legend: LegendItem[] = [
    { label: "Strategy (net, marked to market)", color: SERIES.primary.color },
    ...benchKeys.map((k) => ({ label: bm[k].label, color: BENCH_STYLE[k]?.color ?? SERIES.tertiary.color, dash: BENCH_STYLE[k]?.dash })),
  ];
  const scale = rows ? niceScale(paddedDomain(rows.flatMap((r) => ["equity", ...benchKeys].map((k) => (r as Record<string, unknown>)[k])))) : undefined;

  const ret = metricValue(tm.total_return);
  const spy = metricValue(bm.spy?.total_return);
  const em = metricValue(bm.exposure_matched?.total_return);
  const diag = summary.diagnostics;
  const acc = diag.accounting ?? {};

  return (
    <div className="space-y-5">
      {summary.warnings.length ? (
        <Banner tone="warn">
          <ul className="list-disc space-y-1 pl-4">
            {summary.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Banner>
      ) : null}

      <section className={cx(surface, "p-5")} aria-label="Headline result">
        <p className="text-[13.5px] leading-relaxed text-white/70">
          {ret == null ? (
            "Total return is unavailable."
          ) : (
            <>
              At a locked threshold of <span className="font-digits text-white">{summary.threshold.value.toFixed(2)}</span>, the strategy returned{" "}
              <span className="font-digits text-white">{fmtSignedPct(ret)}</span> net of costs over {fmtInt(tm.span_days)} days
              {spy != null ? (
                <>
                  , against <span className="font-digits text-white">{fmtSignedPct(spy)}</span> for SPY buy-and-hold
                </>
              ) : null}
              {em != null ? (
                <>
                  {" "}
                  and <span className="font-digits text-white">{fmtSignedPct(em)}</span> for a static mix with the same average exposure
                </>
              ) : null}
              .
            </>
          )}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
          <MetricStat label="Net return" metric={tm.total_return} format={(v) => fmtSignedPct(v)} sub={`${fmtMoney(metricValue(tm.net_pnl))} on ${fmtMoney(capital)}`} />
          <MetricStat label="Max drawdown" metric={tm.max_drawdown} format={(v) => fmtPct(v)} sub="Peak to trough, marked daily" />
          <MetricStat label="Trades executed" metric={{ value: tm.executed_trades }} format={fmtInt} sub={`of ${fmtInt(diag.candidates)} signals`} />
          <MetricStat
            label="Net win rate"
            metric={tm.win_rate}
            format={(v) => fmtPct(v)}
            sub={tm.win_rate?.ci95 ? `95% CI ${fmtPct(tm.win_rate.ci95[0], 0)}–${fmtPct(tm.win_rate.ci95[1], 0)}` : undefined}
          />
          <MetricStat label="Costs paid" metric={tm.total_costs} format={(v) => fmtMoney(v)} sub={`Gross P&L ${fmtMoney(metricValue(tm.gross_pnl))}`} />
          <MetricStat label="Average exposure" metric={tm.avg_exposure} format={(v) => fmtPct(v)} sub={`In market ${fmtPct(metricValue(tm.time_in_market), 0)} of days`} />
        </div>
      </section>

      <Panel>
        <ChartFrame
          title="Equity and benchmarks"
          note="Daily closes on the strategy's calendar. Every benchmark starts with the same capital on the first entry day."
          legend={legend}
          height={320}
          csv={rows ? { filename: "equity_and_benchmarks.csv", rows, columns: [{ key: "date" }, { key: "equity" }, ...benchKeys.map((k) => ({ key: k, label: bm[k].label }))] } : undefined}
        >
          {!equity ? (
            <ChartPlaceholder height={320}>Loading equity…</ChartPlaceholder>
          ) : !rows?.length ? (
            <ChartPlaceholder height={320}>No equity series was written.</ChartPlaceholder>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 6, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" {...axisProps} tickFormatter={monthTick} minTickGap={48} />
                <YAxis {...axisProps} width={64} domain={scale?.domain ?? ["auto", "auto"]} ticks={scale?.ticks} tickFormatter={(v: number) => fmtMoney(v)} />
                <ReferenceLine y={capital} stroke={VIZ.axisLine} strokeDasharray="3 3" />
                <Tooltip content={<ChartTooltip labelFormat={fmtDay} format={(v) => fmtMoney(v)} />} />
                {benchKeys.map((k) => (
                  <Line key={k} type="linear" dataKey={k} name={bm[k].label} stroke={BENCH_STYLE[k]?.color} strokeDasharray={BENCH_STYLE[k]?.dash} strokeWidth={VIZ.stroke.secondary} dot={false} isAnimationActive={false} connectNulls={false} />
                ))}
                <Line type="linear" dataKey="equity" name="Strategy" stroke={SERIES.primary.color} strokeWidth={VIZ.stroke.primary} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartFrame>
        <BenchmarkTable />
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Method and inputs">
          <div className="pl-4">
            <KV
              cols={1}
              rows={[
                ["Execution", "Next bar's open; exits on stored bars", summary.methodology.execution],
                ["Threshold", `${summary.threshold.value.toFixed(2)} · ${summary.threshold.source === "validation_locked" ? "selected on validation data, then locked" : "fixed by the user"}`, summary.threshold.note],
                ["Sizing", `${fmtPct(Number(summary.config.position_size_pct) / 100, 1)} of equity per trade · max ${summary.config.max_concurrent_positions} open · exposure cap ${fmtPct(Number(summary.config.max_exposure_pct) / 100, 0)}`],
                ["Costs", `Commission ${summary.config.commission_pct}% and slippage ${summary.config.slippage_pct}% per side`, String(summary.config.cost_convention ?? "")],
                ["Outcome", `${summary.dataset.label_method} · ${summary.methodology.outcome_convention}`],
                ["Data", `${summary.dataset.symbols.join(", ")} · ${summary.dataset.timeframe} · ${summary.dataset.price_adjustment}`],
                ["Period", `${fmtDay(summary.dataset.first_decision)} → ${fmtDay(summary.dataset.last_decision)} · ${fmtInt(summary.dataset.n_samples_used)} samples`],
                ["Model", summary.model.model_id ?? summary.model.trainer_run_id ?? "—"],
                ["Dataset fingerprint", <span className="font-digits text-[12px]">{summary.dataset.fingerprint?.slice(0, 16)}</span>],
              ]}
            />
            <details className="mt-3 text-[12.5px] text-white/50">
              <summary className="cursor-pointer text-white/60 hover:text-white">Limitations of this method</summary>
              <ul className="mt-2 list-disc space-y-1 pl-4 leading-relaxed">
                {summary.methodology.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </details>
          </div>
        </Panel>
        <Panel title="Leakage and evaluation checks" description="An independent test needs every check to pass.">
          <div className="pl-4">
            <AuditList checks={summary.leakage_audit.checks} />
            {summary.leakage_audit.missing_information.length ? (
              <p className="mt-2 text-[12.5px] text-white/45">Missing information: {summary.leakage_audit.missing_information.join("; ")}</p>
            ) : null}
          </div>
        </Panel>
      </div>

      <Panel title="Data quality and accounting">
        <div className="pl-4">
          <KV
            cols={3}
            rows={[
              ["Same-bar stop and target", fmtInt(diag.ambiguous_same_bar_tp_sl), "Both levels inside one bar; resolved as the stop (conservative)."],
              ["Gaps through stop", fmtInt(diag.gap_through_stop), "Filled at the open, below the stop."],
              ["Gaps through target", fmtInt(diag.gap_through_target), "Filled at the target level, not the better open."],
              ["Stale marks", fmtInt(diag.stale_marks), "Days a position was valued at its last known close."],
              ["Irregular bar gaps", fmtInt(diag.irregular_bar_gaps)],
              ["Signals skipped", fmtInt(Object.values(diag.skipped_by_reason ?? {}).reduce((a: number, b) => a + Number(b), 0))],
              ["Equity = cash + positions", acc.identity_equity_eq_cash_plus_positions ? "Holds every day" : "Violated", `Max error ${acc.identity_max_abs_error}`],
              ["Daily P&L reconciles", acc.daily_reconciliation_ok ? "Yes" : "No", `Max error ${acc.daily_reconciliation_max_abs_error}`],
              ["Trade P&L = equity change", acc.pnl_reconciliation_ok ? "Yes" : "No", `Error ${acc.pnl_reconciliation_abs_error}`],
            ]}
          />
          {Object.keys(diag.skipped_by_reason ?? {}).length ? (
            <p className="mt-3 text-[12.5px] text-white/50">
              Skipped by reason:{" "}
              {Object.entries(diag.skipped_by_reason)
                .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
                .join(" · ")}
            </p>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

function BenchmarkTable() {
  const { summary } = useWorkspace();
  const tm = summary.trading_metrics;
  const bm = summary.benchmarks;
  const rows = [
    { key: "strategy", label: "Strategy", total_return: tm.total_return, max_drawdown: tm.max_drawdown, sharpe: tm.sharpe, note: "" },
    ...Object.entries(bm.benchmarks).map(([k, b]) => ({ key: k, label: b.label, total_return: b.total_return, max_drawdown: b.max_drawdown, sharpe: b.sharpe, note: b.note ?? "" })),
  ];
  const cell = (m: { value: number | null; unavailable?: string } | undefined, f: (v: number) => string) =>
    m && isFiniteNum(m.value) ? f(m.value) : <span className="text-white/35" title={m?.unavailable}>—</span>;
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[480px] text-[13px]">
        <thead className="text-left text-[12px] text-white/45">
          <tr>
            <th className="py-1.5 pr-3 font-normal">Series</th>
            <th className="py-1.5 pr-3 text-right font-normal">Total return</th>
            <th className="py-1.5 pr-3 text-right font-normal">Max drawdown</th>
            <th className="py-1.5 text-right font-normal">Sharpe (daily, annualized)</th>
          </tr>
        </thead>
        <tbody className="font-digits tabular-nums">
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-white/[0.06]" title={r.note}>
              <td className={cx("py-1.5 pr-3 font-sans", r.key === "strategy" ? "text-white" : "text-white/65")}>{r.label}</td>
              <td className="py-1.5 pr-3 text-right text-white/85">{cell(r.total_return, (v) => fmtSignedPct(v))}</td>
              <td className="py-1.5 pr-3 text-right text-white/85">{cell(r.max_drawdown, (v) => fmtPct(v))}</td>
              <td className="py-1.5 text-right text-white/85">{cell(r.sharpe, (v) => v.toFixed(2))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {Object.keys(bm.unavailable ?? {}).length ? (
        <p className="mt-2 text-[12px] text-white/40">
          Not shown: {Object.entries(bm.unavailable).map(([k, v]) => `${k} (${v})`).join("; ")}
        </p>
      ) : null}
    </div>
  );
}
