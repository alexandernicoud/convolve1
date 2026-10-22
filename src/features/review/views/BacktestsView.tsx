import { AlertTriangle, GitCompare } from "lucide-react";
import { useCallback, useMemo } from "react";
import type { ReviewRun } from "@/lib/api";
import { useReview } from "../ReviewContext";
import { formatDate, formatPeriod, int, money, num, pctFrac, pctUnits } from "../lib/format";
import { DataTable, type Column } from "../components/DataTable";
import { LibraryToolbar, useLibraryFilter } from "../components/LibraryToolbar";
import { FavoriteToggle } from "../components/LabelEditor";
import { AssetLink, AssetTitle } from "../components/assets";
import { btn, cx, EmptyState, Missing, StatusPill } from "../components/primitives";

export function BacktestsView() {
  const { data, names, inspect, inspected, compare, toggleCompare, setTab, patchLabel } = useReview();
  const runs = useMemo(() => (data?.runs ?? []).filter((r) => r.tool === "backtester"), [data]);
  const hay = useCallback(
    (r: ReviewRun) => `${names.run.get(r.id)} ${r.id} ${r.backtest?.symbol ?? ""} ${r.links?.trainer_run_id ?? ""} ${r.links?.model_id ?? ""}`,
    [names],
  );
  const f = useLibraryFilter(runs, hay);
  const selected = new Set(compare.filter((c) => c.kind === "run").map((c) => c.id));

  if (runs.length === 0) {
    return <EmptyState title="No backtests yet" body="Run a model against a held-out test set in the backtester. Results, assumptions and equity curves appear here." />;
  }

  const perf = (r: ReviewRun) => r.backtest?.performance;
  const columns: Column<ReviewRun>[] = [
    {
      id: "fav",
      header: "",
      className: "w-6 pr-0",
      cell: (r) => <FavoriteToggle on={r.favorite} onToggle={() => void patchLabel({ kind: "run", id: r.id }, { favorite: !r.favorite })} />,
    },
    { id: "name", header: "Backtest", sort: (r) => names.run.get(r.id), cell: (r) => <div className="max-w-[260px]"><AssetTitle refv={{ kind: "run", id: r.id }} archived={r.archived} /></div> },
    {
      id: "model",
      header: "Model",
      cell: (r) => {
        const id = r.links?.trainer_run_id || r.links?.model_id;
        return id ? <div className="max-w-[180px]"><AssetLink refv={{ kind: "model", id }} /></div> : <Missing />;
      },
    },
    {
      id: "period",
      header: "Period",
      sort: (r) => r.backtest?.period?.start,
      cell: (r) =>
        r.backtest?.period?.start ? <span className="whitespace-nowrap font-digits text-[13px] text-white/55">{formatPeriod(r.backtest.period.start, r.backtest.period.end)}</span> : <Missing />,
    },
    {
      id: "ret",
      header: "Net return",
      align: "right",
      hint: "Net of the modelled commission and slippage of this backtest.",
      sort: (r) => perf(r)?.return_pct,
      cell: (r) => <span className={cx((perf(r)?.return_pct ?? 0) < 0 ? "text-red-300/85" : "text-white")}>{pctUnits(perf(r)?.return_pct, 2, true)}</span>,
    },
    { id: "pnl", header: "Net P&L", align: "right", hideBelow: "xl", sort: (r) => perf(r)?.pnl, cell: (r) => money(perf(r)?.pnl) },
    { id: "dd", header: "Max DD", align: "right", sort: (r) => perf(r)?.max_drawdown_pct, cell: (r) => pctUnits(perf(r)?.max_drawdown_pct, 2) },
    { id: "sharpe", header: "Sharpe", align: "right", hint: "Per-trade Sharpe ratio, not annualised.", sort: (r) => perf(r)?.sharpe_ratio, cell: (r) => num(perf(r)?.sharpe_ratio) },
    { id: "pf", header: "PF", align: "right", hint: "Profit factor: gross wins / gross losses.", sort: (r) => perf(r)?.profit_factor, cell: (r) => num(perf(r)?.profit_factor) },
    { id: "win", header: "Win", align: "right", sort: (r) => perf(r)?.win_rate, cell: (r) => pctUnits(perf(r)?.win_rate, 1) },
    {
      id: "trades",
      header: "Trades",
      align: "right",
      sort: (r) => perf(r)?.trades,
      cell: (r) => (
        <span className="inline-flex items-center gap-1">
          {perf(r)?.metrics_insufficient_sample ? <AlertTriangle className="h-3 w-3 text-white/40" aria-label="Too few trades for stable ratios" /> : null}
          {int(perf(r)?.trades)}
        </span>
      ),
    },
    {
      id: "acc",
      header: "Cls acc",
      hideBelow: "2xl",
      align: "right",
      hint: "Per-chart label agreement. Independent of trade P&L.",
      sort: (r) => r.backtest?.classification?.accuracy,
      cell: (r) => <span className="text-white/55">{pctFrac(r.backtest?.classification?.accuracy)}</span>,
    },
    {
      id: "costs",
      header: "Costs",
      hideBelow: "2xl",
      hint: "Commission % / slippage % assumed by this backtest.",
      cell: (r) => {
        const a = r.backtest?.assumptions;
        return a?.commission_pct != null || a?.slippage_pct != null ? (
          <span className="whitespace-nowrap font-digits text-[12.5px] text-white/50">
            {a?.commission_pct ?? "—"} / {a?.slippage_pct ?? "—"}
          </span>
        ) : (
          <Missing />
        );
      },
    },
    { id: "status", header: "Status", sort: (r) => r.status, cell: (r) => <StatusPill status={r.status} progress={r.progress} /> },
    { id: "created", header: "Run", sort: (r) => r.created_at, cell: (r) => <span className="whitespace-nowrap text-[13px] text-white/45" title={formatDate(r.created_at)}>{formatDate(r.created_at, false)}</span> },
  ];

  return (
    <div>
      <LibraryToolbar
        f={f}
        noun="backtests"
        total={runs.length}
        right={
          <button type="button" className={btn} disabled={selected.size < 2} onClick={() => setTab("compare")}>
            <GitCompare className="h-4 w-4" /> Compare {selected.size ? `(${selected.size})` : ""}
          </button>
        }
      />
      <DataTable
        ariaLabel="Backtests"
        rows={f.filtered}
        rowKey={(r) => r.id}
        columns={columns}
        activeKey={inspected?.kind === "run" ? inspected.id : null}
        onActivate={(r) => inspect({ kind: "run", id: r.id })}
        selected={selected}
        onToggleSelect={(r) => toggleCompare({ kind: "run", id: r.id })}
        defaultSort={{ id: "created", dir: "desc" }}
        rowClassName={(r) => (r.archived ? "opacity-60" : undefined)}
        minWidth={1080}
      />
      <p className="mt-3 text-[13px] leading-relaxed text-white/40">
        Trading metrics are simulated on each run's test set, net of its own cost assumptions. Classification accuracy measures label agreement and says nothing about profitability.
      </p>
    </div>
  );
}
