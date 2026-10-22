import { AlertTriangle, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ReviewRun } from "@/lib/api";
import { useReview } from "../ReviewContext";
import { formatDuration, formatRelative, int, pctFrac, pctUnits, num, formatPeriod } from "../lib/format";
import { btn, cx, EmptyState, KindTag, Missing, Panel, panelLink, Stat, StatusPill, surface } from "../components/primitives";

const FAILED = new Set(["failed", "interrupted", "cancelled"]);

const th = "px-3 py-2.5 text-[12.5px] font-medium text-white/45 first:pl-5 last:pr-5";
const td = "px-3 py-3 first:pl-5 last:pr-5";
const row = "cursor-pointer border-t border-white/[0.06] text-[13.5px] transition-colors hover:bg-white/[0.03] focus:outline-none focus-visible:bg-white/[0.05]";

function plural(n: number, one: string, many = `${one}s`) {
  return `${int(n)} ${n === 1 ? one : many}`;
}

function breakdown(parts: [number, string, string?][]): ReactNode {
  const shown = parts.filter(([n]) => n > 0);
  if (!shown.length) return "None recorded yet";
  return shown.map(([n, one, many]) => plural(n, one, many)).join(" · ");
}

function SeeAll({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={panelLink} onClick={onClick}>
      {children} <ArrowRight className="h-3.5 w-3.5" />
    </button>
  );
}

export function OverviewView() {
  const { data, setTab, inspect, names, graph, open } = useReview();
  if (!data) return null;
  const { summary, runs, models, bots, datasets } = data;

  if (runs.length === 0 && models.length === 0 && datasets.length === 0) {
    return (
      <EmptyState
        title="No research assets yet"
        body="Generate a labelled chart dataset, train a CNN on it and evaluate it in the backtester. Every artifact, and how it was produced, will appear here."
        action={
          <div className="flex gap-2">
            <Link to="/tools/generator" className={btn}>
              Open generator
            </Link>
            <Link to="/tools/trainer" className={btn}>
              Open trainer
            </Link>
          </div>
        }
      />
    );
  }

  const active = runs.filter((r) => r.status === "running" || r.status === "queued");
  const failed = runs.filter((r) => FAILED.has(r.status) && r.status !== "cancelled");
  const cancelled = runs.filter((r) => r.status === "cancelled").length;
  const backtests = runs.filter((r) => r.tool === "backtester" && r.backtest?.performance).slice(0, 6);
  const recentModels = models.slice(0, 6);
  const recentDatasets = [...datasets].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)).slice(0, 6);
  const recovered = graph.edges.filter((e) => e.provenance === "recovered").length;
  const unresolved = [...graph.nodes.values()].filter((n) => n.unresolved).length;
  const thinSamples = runs.filter((r) => r.backtest?.performance?.metrics_insufficient_sample).length;
  const unknownBots = bots.filter((b) => !b.provenance || b.provenance === "unknown").length;
  const noMeta = models.filter((m) => !m.metadata_available).length;
  const byTool = (t: string) => runs.filter((r) => r.tool === t).length;

  const attention: { text: string; onClick: () => void }[] = [];
  if (failed.length) attention.push({ text: `${plural(failed.length, "failed or interrupted run")}`, onClick: () => setTab("runs") });
  if (recovered) attention.push({ text: `${plural(recovered, "lineage link")} recovered heuristically, not recorded`, onClick: () => setTab("lineage") });
  if (unresolved) attention.push({ text: `${plural(unresolved, "referenced asset")} missing from this workspace`, onClick: () => setTab("lineage") });
  if (thinSamples) attention.push({ text: `${plural(thinSamples, "backtest")} with too few trades for stable ratios`, onClick: () => setTab("backtests") });
  if (noMeta) attention.push({ text: `${plural(noMeta, "model")} without training metadata`, onClick: () => setTab("models") });
  if (unknownBots) attention.push({ text: `${plural(unknownBots, "deployed bot")} with unknown model provenance`, onClick: () => setTab("lineage") });

  const latestBt = backtests[0]?.backtest?.performance;

  return (
    <div className="space-y-4">
      {/* Library at a glance */}
      <section className={cx(surface, "grid grid-cols-2 gap-y-6 px-5 py-5 md:grid-cols-4 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.15fr)]")}>
        <Stat
          className="pr-4"
          label="Models"
          value={int(summary.totalModels)}
          sub={breakdown([
            [models.filter((m) => m.source === "trained").length, "trained"],
            [models.filter((m) => m.source === "uploaded").length, "uploaded"],
          ])}
          onClick={() => setTab("models")}
        />
        <Stat
          className="pr-4 md:border-l md:border-white/[0.08] md:pl-5"
          label="Datasets"
          value={int(summary.totalDatasets)}
          sub={breakdown([
            [datasets.filter((d) => d.kind === "training" && d.representation !== "archive").length, "training set"],
            [datasets.filter((d) => d.kind === "test").length, "test set"],
            [datasets.filter((d) => d.representation === "archive").length, "ZIP archive"],
          ])}
          onClick={() => setTab("datasets")}
        />
        <Stat
          className="border-white/[0.08] pr-4 md:border-l md:pl-5"
          label="Backtests"
          value={int(summary.totalBacktests)}
          tone={summary.totalBacktests ? undefined : "muted"}
          sub={latestBt ? `Latest ${pctUnits(latestBt.return_pct, 2, true)} net` : "None recorded yet"}
          onClick={() => setTab("backtests")}
        />
        <Stat
          className="border-white/[0.08] pr-4 md:border-l md:pl-5"
          label="Experiment runs"
          value={int(runs.length)}
          sub={breakdown([
            [byTool("trainer"), "training run"],
            [byTool("labeling-optimizer"), "label search", "label searches"],
            [byTool("training-chart-generator") + byTool("testdata"), "generation"],
            [byTool("analysis"), "analysis", "analyses"],
          ])}
          onClick={() => setTab("runs")}
        />
        <div className="col-span-2 flex flex-col justify-center gap-2 border-white/[0.08] md:col-span-4 md:border-t md:pt-5 xl:col-span-1 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
          <StatusLine label="Running" value={active.length} onClick={() => setTab("runs")} live={active.length > 0} />
          <StatusLine label="Failed" value={failed.length} onClick={() => setTab("runs")} alert={failed.length > 0} note={cancelled ? `${cancelled} cancelled` : undefined} />
          <StatusLine label="Deployed bots" value={summary.totalBots} onClick={() => setTab("lineage")} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-8">
          <Panel
            title="Recent activity"
            description="Latest runs across the generator, trainer, optimizer, backtester and analysis."
            aside={<SeeAll onClick={() => setTab("runs")}>All runs</SeeAll>}
            bodyClassName="px-0 pb-1"
          >
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className={th}>Run</th>
                  <th className={th}>Status</th>
                  <th className={cx(th, "text-right")}>Duration</th>
                  <th className={cx(th, "text-right")}>Finished</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 8).map((r) => (
                  <RunRow key={r.id} r={r} />
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel
            title="Models"
            description="Most recent first. Accuracy is classification agreement on labelled charts, not profitability."
            aside={<SeeAll onClick={() => setTab("models")}>Model library</SeeAll>}
            bodyClassName="px-0 pb-1"
          >
            {recentModels.length === 0 ? (
              <p className="px-5 pb-4 text-[14px] text-white/45">No models yet. Train one on a generated dataset or upload a .keras file.</p>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th className={th}>Model</th>
                    <th className={th}>Source</th>
                    <th className={cx(th, "text-right")} title="Validation set">
                      Val acc
                    </th>
                    <th className={cx(th, "text-right")} title="Training set (in-sample)">
                      Train acc
                    </th>
                    <th className={cx(th, "text-right")}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {recentModels.map((m) => (
                    <tr
                      key={m.id}
                      tabIndex={0}
                      onClick={() => open("models", { kind: "model", id: m.id })}
                      onKeyDown={(e) => e.key === "Enter" && open("models", { kind: "model", id: m.id })}
                      className={row}
                    >
                      <td className={cx(td, "max-w-[360px] truncate font-medium text-white")}>{names.model.get(m.id)}</td>
                      <td className={td}>
                        <KindTag>{m.source}</KindTag>
                      </td>
                      <td className={cx(td, "text-right font-digits tabular-nums text-white")}>{pctFrac(m.metrics?.val_accuracy)}</td>
                      <td className={cx(td, "text-right font-digits tabular-nums text-white/50")}>{pctFrac(m.metrics?.accuracy)}</td>
                      <td className={cx(td, "whitespace-nowrap text-right text-[13px] text-white/45")}>{formatRelative(m.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          {backtests.length === 0 ? (
            <section className={cx(surface, "flex flex-wrap items-center justify-between gap-3 px-5 py-4")}>
              <div>
                <h2 className="flex items-center gap-2 text-base font-medium text-[#F5F5F5]">
                  <span className="h-2 w-2 rounded-full bg-[#F5F5F5]/40" />
                  Backtests
                </h2>
                <p className="mt-1 pl-4 text-[13px] text-white/45">No completed backtests with recorded results yet. Evaluate a model out-of-sample to see returns here.</p>
              </div>
              <Link to="/tools/backtester" className={btn}>
                Open backtester
              </Link>
            </section>
          ) : (
            <Panel
              title="Latest backtests"
              description="Net of each run's modelled commission and slippage. Periods and assumptions differ between rows — use Compare for like-for-like checks."
              aside={<SeeAll onClick={() => setTab("backtests")}>All backtests</SeeAll>}
              bodyClassName="px-0 pb-1"
            >
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th className={th}>Backtest</th>
                    <th className={th}>Period</th>
                    <th className={cx(th, "text-right")}>Net return</th>
                    <th className={cx(th, "text-right")}>Max DD</th>
                    <th className={cx(th, "text-right")}>Trades</th>
                    <th className={cx(th, "text-right")}>Sharpe</th>
                  </tr>
                </thead>
                <tbody>
                  {backtests.map((r) => {
                    const p = r.backtest!.performance!;
                    return (
                      <tr
                        key={r.id}
                        tabIndex={0}
                        onClick={() => inspect({ kind: "run", id: r.id })}
                        onKeyDown={(e) => e.key === "Enter" && inspect({ kind: "run", id: r.id })}
                        className={row}
                      >
                        <td className={cx(td, "max-w-[300px] truncate font-medium text-white")}>{names.run.get(r.id)}</td>
                        <td className={cx(td, "whitespace-nowrap font-digits text-[13px] text-white/55")}>
                          {formatPeriod(r.backtest?.period?.start, r.backtest?.period?.end)}
                        </td>
                        <td className={cx(td, "text-right font-digits tabular-nums", (p.return_pct ?? 0) < 0 ? "text-red-300/85" : "text-white")}>
                          {pctUnits(p.return_pct, 2, true)}
                        </td>
                        <td className={cx(td, "text-right font-digits tabular-nums text-white/70")}>{pctUnits(p.max_drawdown_pct, 2)}</td>
                        <td className={cx(td, "text-right font-digits tabular-nums text-white/70")}>
                          {int(p.trades)}
                          {p.metrics_insufficient_sample ? <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-white/40" aria-label="Too few trades" /> : null}
                        </td>
                        <td className={cx(td, "text-right font-digits tabular-nums text-white/70")}>{num(p.sharpe_ratio)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          )}
        </div>

        <div className="min-w-0 space-y-4 xl:col-span-4">
          <Panel title="Needs attention" bodyClassName="px-3 pb-3">
            {attention.length === 0 ? (
              <p className="px-2 pb-1 text-[14px] text-white/45">Nothing flagged. All links are recorded and no runs failed.</p>
            ) : (
              <ul>
                {attention.map((a) => (
                  <li key={a.text}>
                    <button
                      type="button"
                      onClick={a.onClick}
                      className="group flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-[14px] leading-snug text-white/75 transition hover:bg-white/[0.04] hover:text-white focus:outline-none focus-visible:bg-white/[0.05]"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-white/40 group-hover:text-white/70" />
                      <span className="flex-1">{a.text}</span>
                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-white/25 group-hover:text-white/70" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {active.length ? (
            <Panel title={`In progress · ${active.length}`}>
              <div className="space-y-4">
                {active.map((r) => (
                  <button key={r.id} type="button" onClick={() => inspect({ kind: "run", id: r.id })} className="block w-full text-left">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 break-words text-[14px] font-medium text-white">{names.run.get(r.id)}</span>
                      <StatusPill status={r.status} progress={r.progress} />
                    </div>
                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.08]">
                      <div className="h-full rounded-full bg-white/80 transition-all" style={{ width: `${Math.max(2, Math.round((r.progress || 0) * 100))}%` }} />
                    </div>
                    {r.message || r.stage ? <p className="mt-1.5 truncate text-[12.5px] text-white/45">{r.message || r.stage}</p> : null}
                  </button>
                ))}
              </div>
            </Panel>
          ) : null}

          {failed.length ? (
            <Panel title="Recent failures" bodyClassName="px-3 pb-3">
              {failed.slice(0, 5).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => inspect({ kind: "run", id: r.id })}
                  className="block w-full rounded-lg px-2 py-2 text-left transition hover:bg-white/[0.04]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-[14px] text-white/85">{names.run.get(r.id)}</span>
                    <span className="shrink-0 text-[12.5px] text-white/40">{formatRelative(r.finished_at ?? r.updated_at)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 font-mono text-[12px] leading-relaxed text-red-200/65">
                    {r.error || r.message || <Missing text="No error message recorded" />}
                  </p>
                </button>
              ))}
            </Panel>
          ) : null}

          <Panel title="Recent datasets" aside={<SeeAll onClick={() => setTab("datasets")}>All datasets</SeeAll>} bodyClassName="px-3 pb-3">
            {recentDatasets.length === 0 ? (
              <p className="px-2 pb-1 text-[14px] text-white/45">No datasets yet.</p>
            ) : (
              <ul>
                {recentDatasets.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => open("datasets", { kind: "dataset", id: d.id })}
                      className="flex w-full items-baseline gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/[0.04] focus:outline-none focus-visible:bg-white/[0.05]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[14px] leading-snug text-white/90">{names.dataset.get(d.id)}</span>
                        <span className="mt-0.5 block font-digits text-[12.5px] tabular-nums text-white/40">
                          {d.total_images != null ? `${int(d.total_images)} images` : "Image count not recorded"}
                          {d.used_by_training_runs?.length ? ` · used in ${plural(d.used_by_training_runs.length, "training run")}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-[12.5px] text-white/40">{formatRelative(d.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function StatusLine({ label, value, onClick, live, alert, note }: { label: string; value: number; onClick: () => void; live?: boolean; alert?: boolean; note?: string }) {
  return (
    <button type="button" onClick={onClick} className="group flex items-center gap-2.5 text-left focus:outline-none">
      <span
        className={cx(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          alert ? "bg-red-400/80" : live ? "animate-pulse bg-white" : value ? "bg-white/70" : "border border-white/30",
        )}
      />
      <span className="flex-1 text-[13.5px] text-white/55 group-hover:text-white/85">{label}</span>
      {note ? <span className="text-[12.5px] text-white/35">{note}</span> : null}
      <span className={cx("w-8 text-right font-digits text-[15px] font-semibold tabular-nums", alert ? "text-red-300/90" : value ? "text-white" : "text-white/35")}>
        {int(value)}
      </span>
    </button>
  );
}

function RunRow({ r }: { r: ReviewRun }) {
  const { inspect, names } = useReview();
  return (
    <tr tabIndex={0} onClick={() => inspect({ kind: "run", id: r.id })} onKeyDown={(e) => e.key === "Enter" && inspect({ kind: "run", id: r.id })} className={row}>
      <td className={cx(td, "max-w-[420px] truncate text-white/90")}>{names.run.get(r.id)}</td>
      <td className={td}>
        <StatusPill status={r.status} progress={r.progress} />
      </td>
      <td className={cx(td, "text-right font-digits tabular-nums text-white/55")}>{formatDuration(r.duration_s)}</td>
      <td className={cx(td, "whitespace-nowrap text-right text-[13px] text-white/45")}>{formatRelative(r.finished_at ?? r.updated_at)}</td>
    </tr>
  );
}
