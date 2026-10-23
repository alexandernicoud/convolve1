import { AlertTriangle } from "lucide-react";
import type { ReviewAssetDetail, ReviewBot, ReviewDataset, ReviewModel, ReviewRun } from "@/lib/api";
import { AuthorizedImage } from "@/components/AuthorizedImage";
import { useReview } from "../ReviewContext";
import {
  formatDate,
  formatDuration,
  formatPeriod,
  formatValue,
  int,
  money,
  num,
  pctFrac,
  pctUnits,
} from "../lib/format";
import { labelingTag } from "../lib/naming";
import { AssetLink, Symbols } from "../components/assets";
import { ClassBalanceBar } from "../components/ClassBalance";
import { EquityChart, TrainingCurves } from "../components/Charts";
import { Caveat, KV, Missing, ProvenanceBadge, StatusPill } from "../components/primitives";
import { ConfigKV, Section, TrainingMetricsBlock, TrainingSetupKV } from "./sections";

function Loading({ loading, error }: { loading: boolean; error: string | null }) {
  if (error) return <p className="text-[13px] text-red-300/70">{error}</p>;
  return loading ? <p className="text-[13px] text-white/35">Loading…</p> : null;
}

// ------------------------------------------------------------------ model

export function ModelPanel({ m, detail, loading, error }: { m: ReviewModel; detail: ReviewAssetDetail | null; loading: boolean; error: string | null }) {
  const { graph, find } = useReview();
  const datasetRef = m.dataset_id
    ? { kind: "dataset" as const, id: m.dataset_id }
    : m.generator_run_id
      ? { kind: "dataset" as const, id: `generated:${m.generator_run_id}` }
      : null;
  const backtests = (graph.out.get(`model:${m.id}`) ?? []).filter((e) => e.relation === "backtested").map((e) => e.target.slice(4));
  const history = detail?.history ?? [];
  const setup = detail?.training ?? m.training;
  return (
    <>
      <Section title="Identity">
        <KV
          rows={[
            ["Source", m.source],
            ["Created", formatDate(m.created_at)],
            ["Training run", m.training_run_id ? <AssetLink refv={{ kind: "run", id: m.training_run_id }} /> : null],
            [
              "Training data",
              datasetRef ? (
                <span className="inline-flex items-center gap-1.5">
                  <AssetLink refv={datasetRef} />
                  {m.generator_link ? <ProvenanceBadge p={m.generator_link} compact /> : null}
                </span>
              ) : null,
            ],
            ["Symbols", m.symbols ? <Symbols value={m.symbols} /> : null],
            ["Timeframe", m.timeframe],
            ["Training period", m.training_period_start || m.training_period_end ? formatPeriod(m.training_period_start, m.training_period_end) : null],
            ["Labeling", labelingTag(m.take_profit_fraction, m.stop_loss_fraction, m.horizon_bars)],
            ["Image size", m.image_dimension != null ? `${m.image_dimension}px` : null],
            ["File", detail?.model_file ?? m.auto_name],
            ["Size", m.byte_size != null ? `${(m.byte_size / 1e6).toFixed(1)} MB` : null],
          ]}
        />
        {!m.metadata_available ? <Caveat>No training metadata was stored with this model, so its origin cannot be verified.</Caveat> : null}
        {m.catalog_only ? <Caveat>Listed from the database catalog; the model file is not on this machine.</Caveat> : null}
      </Section>
      <Section title="Classification metrics">
        <TrainingMetricsBlock metrics={detail?.training?.metrics ?? m.metrics} />
      </Section>
      {history.length ? (
        <Section title="Training curves">
          <TrainingCurves history={history} bestEpoch={setup?.best_epoch} />
        </Section>
      ) : null}
      <Section title="Training setup">
        <TrainingSetupKV t={setup} />
        <Loading loading={loading} error={error} />
      </Section>
      {detail?.training_config ? (
        <Section title="Training configuration">
          <ConfigKV obj={detail.training_config} />
        </Section>
      ) : null}
      <Section title={`Backtests · ${backtests.length}`}>
        {backtests.length === 0 ? (
          <p className="text-[13px] text-white/40">No recorded backtests of this model.</p>
        ) : (
          <ul className="space-y-1">
            {backtests.map((id) => {
              const r = find({ kind: "run", id })?.item as ReviewRun | undefined;
              const p = r?.backtest?.performance;
              return (
                <li key={id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">
                    <AssetLink refv={{ kind: "run", id }} />
                  </span>
                  <span className={`font-digits tabular-nums ${p?.estimate ? "text-white/40" : "text-white/70"}`} title={p?.estimate ? "Legacy label-payoff estimate" : undefined}>
                    {p ? `${pctUnits(p.return_pct, 2, true)}${p.estimate ? " est." : ""}` : <Missing />}
                  </span>
                  <span className="w-20 text-right font-digits text-[12.5px] tabular-nums text-white/40">{p ? `${int(p.trades)} ${p.estimate ? "charts" : "trades"}` : ""}</span>
                </li>
              );
            })}
          </ul>
        )}
        {backtests.length ? <Caveat>Net of each backtest's modelled costs; periods and assumptions may differ.</Caveat> : null}
      </Section>
    </>
  );
}

// -------------------------------------------------------------------- run

function RunTiming({ r }: { r: ReviewRun }) {
  return (
    <Section title="Execution">
      <KV
        rows={[
          ["Status", <StatusPill key="s" status={r.status} progress={r.progress} />],
          ["Started", formatDate(r.created_at)],
          ["Finished", formatDate(r.finished_at)],
          ["Duration", formatDuration(r.duration_s)],
          ["Stage", r.stage || null],
          ["Run id", <span key="i" className="font-mono text-[12.5px]">{r.id}</span>],
        ]}
      />
      {r.error || ((r.status === "failed" || r.status === "interrupted") && r.message) ? (
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-red-400/15 bg-red-400/[0.03] p-2.5 font-mono text-[12.5px] leading-relaxed text-red-200/75">
          {r.error || r.message}
        </pre>
      ) : null}
    </Section>
  );
}

export function RunPanel({ r, detail, loading, error }: { r: ReviewRun; detail: ReviewAssetDetail | null; loading: boolean; error: string | null }) {
  return (
    <>
      <RunTiming r={r} />
      {r.tool === "backtester" ? <BacktestSections r={r} detail={detail} /> : null}
      {r.tool === "trainer" ? <TrainerSections r={r} detail={detail} /> : null}
      {r.tool === "labeling-optimizer" ? <OptimizerSections r={r} detail={detail} /> : null}
      {r.tool === "training-chart-generator" ? <GeneratorSections r={r} detail={detail} /> : null}
      {r.tool === "testdata" ? (
        <Section title="Test-set configuration">
          <ConfigKV obj={detail?.testdata?.config} />
          {detail?.testdata?.summary ? (
            <div className="mt-3">
              <ConfigKV obj={detail.testdata.summary} exclude={["example_filenames"]} />
            </div>
          ) : null}
        </Section>
      ) : null}
      {r.tool === "analysis" ? <AnalysisSections r={r} detail={detail} /> : null}
      {loading || error ? (
        <Section title="Details">
          <Loading loading={loading} error={error} />
        </Section>
      ) : null}
    </>
  );
}

function BacktestSections({ r, detail }: { r: ReviewRun; detail: ReviewAssetDetail | null }) {
  const b = detail?.backtest ?? r.backtest;
  const p = b?.performance;
  const legacy = b?.methodology ? b.methodology.id !== "price_sim_v2" : !!p;
  const modelId = r.links?.trainer_run_id || r.links?.model_id;
  return (
    <>
      <Section title="Inputs">
        <KV
          rows={[
            ["Model", modelId ? <AssetLink refv={{ kind: "model", id: modelId }} /> : null],
            ["Test dataset", r.links?.dataset_id ? <AssetLink refv={{ kind: "dataset", id: r.links.dataset_id }} /> : null],
            ["Symbol", b?.symbol],
            ["Period", b?.period?.start || b?.period?.end ? formatPeriod(b?.period?.start, b?.period?.end) : null],
          ]}
        />
      </Section>
      <Section title={legacy ? "Label-payoff estimate · not a trading simulation" : "Trading result · price-based, net of modelled costs"}>
        {p ? (
          <>
            {legacy ? (
              <p className="mb-4 rounded-lg border border-amber-300/25 bg-amber-300/[0.05] px-3 py-2 text-[12.5px] leading-relaxed text-amber-100/85">
                {b?.methodology?.label ?? "Legacy label-payoff estimate — not a price-based trading simulation."} Values come from chart labels at a synthetic entry price, not from market prices.
              </p>
            ) : b?.methodology ? (
              <p className="mb-4 text-[12.5px] text-white/50">
                {b.methodology.evaluation_class === "independent_test" ? "Independent test" : b.methodology.evaluation_class === "blocked" ? "Blocked by leakage audit" : "Exploratory"}
                {" · threshold "}
                {b.methodology.threshold_source === "validation_locked" ? "locked on validation data" : "fixed by the user"}
              </p>
            ) : null}
            <div className="grid grid-cols-3 gap-6">
              {[
                [legacy ? "Estimated return" : "Net return", pctUnits(p.return_pct, 2, true), (p.return_pct ?? 0) < 0],
                legacy ? ["Drawdown below start", pctUnits(p.drawdown_below_start_pct, 2), false] : ["Max drawdown", pctUnits(p.max_drawdown_pct, 2), false],
                [legacy ? "Charts selected" : "Trades", int(p.trades), false],
              ].map(([k, v, neg]) => (
                <div key={k as string} className="border-l border-white/[0.08] pl-4 first:border-0 first:pl-0">
                  <div className="text-[13px] text-white/50">{k}</div>
                  <div className={`mt-1.5 font-digits text-[24px] font-semibold leading-none tracking-tight tabular-nums ${neg ? "text-red-300/85" : "text-white"}`}>{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-5">
              <KV
                rows={[
                  [legacy ? "Estimated P&L" : "Net P&L", money(p.pnl, 2)],
                  legacy
                    ? ["Sharpe", "Withheld", "The legacy value was a clipped per-chart ratio on label payoffs, not a time-series Sharpe."]
                    : ["Sharpe (daily, annualized)", num(p.sharpe_ratio), p.definitions?.sharpe_ratio],
                  ["Profit factor", num(p.profit_factor)],
                  legacy
                    ? ["Label-1 precision", pctUnits(p.label_precision_pct, 1), "Share of selected charts labelled 1. Not a trading win rate."]
                    : ["Net win rate", pctUnits(p.win_rate, 1), p.definitions?.win_rate],
                  ["Avg win / loss", p.avg_win != null || p.avg_loss != null ? `${money(p.avg_win, 2)} / ${money(p.avg_loss, 2)}` : null],
                  ["Charts evaluated", int(p.total_charts_analyzed)],
                  ["No-trade signals", int(p.no_trade_count)],
                  ["Avg confidence (trades)", p.avg_confidence_trades != null ? pctFrac(p.avg_confidence_trades) : null],
                ]}
              />
            </div>
            {p.metrics_insufficient_sample ? (
              <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-white/55">
                <AlertTriangle className="h-3.5 w-3.5" /> Too few trades for stable ratio estimates.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] text-white/40">{r.status === "succeeded" ? "No result file found for this backtest." : "Results are available once the run completes."}</p>
        )}
      </Section>
      {b?.classification && Object.values(b.classification).some((v) => v != null) ? (
        <Section title="Classification · label agreement">
          <KV
            rows={[
              ["Accuracy", pctFrac(b.classification.accuracy)],
              ["Precision", pctFrac(b.classification.precision)],
              ["Recall", pctFrac(b.classification.recall)],
              ["F1", pctFrac(b.classification.f1)],
            ]}
          />
          <Caveat>How often predicted labels matched the test labels. Independent of the trading P&L above.</Caveat>
        </Section>
      ) : null}
      {detail?.backtest?.equity?.length ? (
        <Section title="Equity">
          <EquityChart points={detail.backtest.equity} symbol={detail.backtest.benchmark?.underlying_ticker ?? b?.symbol} spy={detail.backtest.benchmark?.spy_ticker} />
          {detail.backtest.benchmark?.error ? <Caveat>Benchmark: {detail.backtest.benchmark.error}</Caveat> : null}
        </Section>
      ) : null}
      <Section title="Assumptions">
        <KV
          rows={[
            ["Starting capital", money(b?.assumptions?.starting_capital)],
            ["Position size", b?.assumptions?.position_size_pct != null ? `${b.assumptions.position_size_pct}%` : null],
            ["Commission", b?.assumptions?.commission_pct != null ? `${b.assumptions.commission_pct}%` : null],
            ["Slippage", b?.assumptions?.slippage_pct != null ? `${b.assumptions.slippage_pct}%` : null],
            ["Confidence threshold", b?.assumptions?.confidence_threshold != null ? String(b.assumptions.confidence_threshold) : null],
            ["Take profit / stop loss", b?.assumptions?.tp_pct != null || b?.assumptions?.sl_pct != null ? `${b?.assumptions?.tp_pct ?? "—"}% / ${b?.assumptions?.sl_pct ?? "—"}%` : null],
            ["Sample size", b?.assumptions?.sample_size != null ? formatValue(b.assumptions.sample_size) : null],
            ["Image size", b?.assumptions?.img_size != null ? `${b.assumptions.img_size}px` : null],
            ["Max-drawdown stop", b?.assumptions?.max_drawdown_pct != null ? `${b.assumptions.max_drawdown_pct}%` : null],
          ]}
        />
      </Section>
    </>
  );
}

function TrainerSections({ r, detail }: { r: ReviewRun; detail: ReviewAssetDetail | null }) {
  const history = detail?.history ?? [];
  return (
    <>
      <Section title="Produced model">
        <AssetLink refv={{ kind: "model", id: r.id }} />
      </Section>
      <Section title="Classification metrics">
        <TrainingMetricsBlock metrics={detail?.training?.metrics ?? r.training?.metrics} />
      </Section>
      {history.length ? (
        <Section title="Training curves">
          <TrainingCurves history={history} bestEpoch={(detail?.training ?? r.training)?.best_epoch} />
        </Section>
      ) : null}
      <Section title="Training setup">
        <TrainingSetupKV t={detail?.training ?? r.training} />
      </Section>
      {detail?.generator_config ? (
        <Section title="Dataset generation config">
          <ConfigKV obj={detail.generator_config} />
        </Section>
      ) : null}
    </>
  );
}

function OptimizerSections({ r, detail }: { r: ReviewRun; detail: ReviewAssetDetail | null }) {
  const o = detail?.optimizer ?? r.optimizer;
  const best = o?.best;
  const y = o?.yearly;
  return (
    <>
      <Section title="Best labeling parameters · in-sample">
        <p className="mb-4 rounded-lg bg-white/[0.04] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-white/65">
          Hindsight grid search over the same history it scores. These figures describe how well a label definition fits past prices, not expected trading performance.
        </p>
        {best ? (
          <KV
            rows={[
              ["Take profit", pctFrac(best.best_tp, 2)],
              ["Stop loss", pctFrac(best.best_sl, 2)],
              ["Horizon (bars)", best.best_h != null ? int(best.best_h) : null],
              ["Compounded CAGR", pctUnits(best.best_cagr, 1)],
              ["Linear annual P/L", pctUnits(best.best_linear_annual_pl, 1)],
              ["Max drawdown", pctUnits(best.max_drawdown, 1)],
              ["Trades", int(best.trades)],
              ["Win rate", pctFrac(best.win_rate)],
              ["Calmar", num(best.calmar_ratio)],
              ["Asset CAGR (buy & hold)", pctUnits(best.asset_annual_cagr_pct, 1)],
            ]}
          />
        ) : (
          <Missing text="No metrics recorded" />
        )}
      </Section>
      {y?.years?.length ? (
        <Section title="By year · in-sample">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[12.5px] text-white/45">
                <th className="py-1 text-left font-medium">Year</th>
                <th className="py-1 text-right font-medium">Strategy</th>
                <th className="py-1 text-right font-medium">Price</th>
              </tr>
            </thead>
            <tbody>
              {y.years.map((yr, i) => (
                <tr key={yr} className="border-t border-white/[0.04] font-digits tabular-nums">
                  <td className="py-1 text-white/60">{yr}</td>
                  <td className="py-1 text-right text-white/85">{pctUnits(y.strategy_compounded_pct?.[i], 1)}</td>
                  <td className="py-1 text-right text-white/55">{pctUnits(y.price_compounded_pct?.[i], 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}
      <Section title="Search configuration">
        <ConfigKV obj={o?.config} />
      </Section>
    </>
  );
}

function GeneratorSections({ r, detail }: { r: ReviewRun; detail: ReviewAssetDetail | null }) {
  const g = detail?.generator ?? r.generator;
  return (
    <>
      <Section title="Class balance">
        <ClassBalanceBar dist={g?.label_distribution} detailed />
      </Section>
      <Section title="Generation config">
        <ConfigKV obj={g?.config} />
      </Section>
      {g?.stats ? (
        <Section title="Dataset statistics">
          <ConfigKV obj={g.stats} />
        </Section>
      ) : null}
    </>
  );
}

function AnalysisSections({ r, detail }: { r: ReviewRun; detail: ReviewAssetDetail | null }) {
  const a = detail?.analysis;
  const modelId = r.links?.model_id || r.links?.trainer_run_id;
  const urls = a?.image_urls ? Object.entries(a.image_urls).slice(0, 6) : [];
  return (
    <>
      <Section title="Subject">
        <KV rows={[["Model", modelId ? <AssetLink refv={{ kind: "model", id: modelId }} /> : null], ["Artifacts", int(a?.artifact_count ?? r.analysis?.artifact_count)]]} />
      </Section>
      {a?.artifacts?.length ? (
        <Section title="Artifacts">
          <ul className="space-y-1 text-[13px]">
            {a.artifacts.slice(0, 12).map((x, i) => (
              <li key={x.id ?? i} className="flex justify-between gap-3 border-b border-white/[0.04] pb-1">
                <span className="truncate text-white/75">{x.title || x.type || x.id}</span>
                <span className="shrink-0 font-mono text-[12px] text-white/35">{x.layer_name || x.type}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {urls.length ? (
        <Section title="Visualisations">
          <div className="grid grid-cols-3 gap-2">
            {urls.map(([name, url]) => (
              <figure key={name} className="overflow-hidden rounded border border-white/[0.08] bg-black">
                <AuthorizedImage src={url} alt={name} className="aspect-square w-full object-contain" loading="lazy" />
                <figcaption className="truncate px-2 py-1.5 font-mono text-[12px] text-white/45">{name}</figcaption>
              </figure>
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- dataset

export function DatasetPanel({ d, detail, loading, error }: { d: ReviewDataset; detail: ReviewAssetDetail | null; loading: boolean; error: string | null }) {
  const dist = d.label_distribution ?? detail?.summary?.label_distribution ?? detail?.generator?.label_distribution;
  return (
    <>
      <Section title="Identity">
        <KV
          rows={[
            ["Role", d.kind === "unknown" ? "unclassified" : `${d.kind} set`],
            ["Form", d.representation === "archive" ? "ZIP archive (generator output)" : "Extracted image folder"],
            ["Origin", d.source],
            [
              "Generator run",
              d.generator_run_id ? (
                <span className="inline-flex items-center gap-1.5">
                  <AssetLink refv={{ kind: "run", id: d.generator_run_id }} />
                  <ProvenanceBadge p={d.generator_link ?? "recorded"} compact />
                </span>
              ) : null,
            ],
            ["Test-set run", d.testdata_run_id ? <AssetLink refv={{ kind: "run", id: d.testdata_run_id }} /> : null],
            ["Built for model", d.model_id ? <AssetLink refv={{ kind: "model", id: d.model_id }} /> : null],
            ["Created", formatDate(d.created_at)],
            ["Dataset id", d.dataset_id ? <span className="font-mono text-[12.5px]">{d.dataset_id}</span> : null],
          ]}
        />
        {d.generator_link === "recovered" ? <Caveat>The generator link was recovered by matching chart filenames (≥ 90 % overlap). It was not recorded at creation.</Caveat> : null}
        {d.catalog_only ? <Caveat>Listed from the database catalog; files are not on this machine.</Caveat> : null}
      </Section>
      <Section title="Coverage">
        <KV
          rows={[
            ["Symbols", d.symbols ? <Symbols value={d.symbols} /> : null],
            ["Timeframe", d.timeframe],
            [
              d.period_source === "sample_filenames" ? "Period (estimated)" : "Period",
              d.period_start || d.period_end ? formatPeriod(d.period_start, d.period_end) : null,
              d.period_source === "sample_filenames"
                ? "Estimated from a few sample chart filenames; no generator config was recorded."
                : d.period_source === "generator_config"
                  ? "From the recorded generator configuration."
                  : undefined,
            ],
            ["Images", int(d.total_images ?? detail?.summary?.total_images)],
            ["Labeling", labelingTag(d.take_profit_fraction, d.stop_loss_fraction, d.horizon_bars)],
            ["Image size", d.image_dimension != null ? `${d.image_dimension}px` : null],
          ]}
        />
      </Section>
      <Section title="Class balance">
        <ClassBalanceBar dist={dist} detailed />
      </Section>
      {d.representation === "archive" && d.extracted_as?.length ? (
        <Section title="Extracted copies">
          <ul className="space-y-1">
            {d.extracted_as.map((id) => (
              <li key={id}>
                <AssetLink refv={{ kind: "dataset", id }} />
              </li>
            ))}
          </ul>
          <Caveat>Same generator output in a different form. Listed separately; image counts may differ if extraction filtered files.</Caveat>
        </Section>
      ) : null}
      {d.archive_key ? (
        <Section title="Source archive">
          <AssetLink refv={{ kind: "dataset", id: d.archive_key }} />
        </Section>
      ) : null}
      {d.used_by_training_runs?.length ? (
        <Section title={`Training runs · ${d.used_by_training_runs.length}`}>
          <ul className="space-y-1">
            {d.used_by_training_runs.map((id) => (
              <li key={id}>
                <AssetLink refv={{ kind: "run", id }} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {detail?.generator_config || detail?.generator?.config ? (
        <Section title="Generation config">
          <ConfigKV obj={(detail?.generator_config ?? detail?.generator?.config) as Record<string, unknown>} />
        </Section>
      ) : null}
      {detail?.example_filenames?.length ? (
        <Section title="Example files">
          <ul className="space-y-0.5 font-mono text-[12px] text-white/50">
            {detail.example_filenames.slice(0, 8).map((f) => (
              <li key={f} className="truncate">
                {f}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {loading || error ? (
        <Section title="Details">
          <Loading loading={loading} error={error} />
        </Section>
      ) : null}
    </>
  );
}

// -------------------------------------------------------------------- bot

export function BotPanel({ b }: { b: ReviewBot }) {
  const src = b.source_model_id || b.source_training_run_id;
  const prov = !b.provenance || b.provenance === "unknown" ? "unknown" : "recorded";
  return (
    <>
      <Section title="Provenance">
        <KV
          rows={[
            ["Recorded", <ProvenanceBadge key="p" p={prov} />],
            ["Model source", b.provenance === "library" ? "Model library" : b.provenance === "upload" ? "Direct upload" : null],
            ["Model", src ? <AssetLink refv={{ kind: "model", id: src }} /> : null],
            ["Informed by backtest", b.source_backtest_run_id ? <AssetLink refv={{ kind: "run", id: b.source_backtest_run_id }} /> : null],
            ["Model file", b.model_filename],
          ]}
        />
        {prov === "unknown" ? (
          <Caveat>This bot was deployed before provenance was recorded. Its model is not linked to the library; no link is guessed.</Caveat>
        ) : b.provenance === "upload" ? (
          <Caveat>Deployed from a direct file upload; the file is not tied to a library model.</Caveat>
        ) : null}
      </Section>
      <Section title="Configuration (read-only)">
        <KV
          rows={[
            ["Symbol", b.symbol],
            ["State", b.lifecycle_state ?? (b.is_active ? "active" : "paused")],
            ["Created", formatDate(b.created_at)],
            ["Last run", formatDate(b.last_run_at)],
            ["Last signal", b.last_signal],
            ["Confidence threshold", b.confidence_threshold != null ? String(b.confidence_threshold) : null],
            ["Take profit / stop loss", b.tp_pct != null || b.sl_pct != null ? `${b.tp_pct ?? "—"}% / ${b.sl_pct ?? "—"}%` : null],
            ["Starting capital", money(b.starting_capital)],
            ["Commission / slippage", b.commission_pct != null || b.slippage_pct != null ? `${b.commission_pct ?? "—"}% / ${b.slippage_pct ?? "—"}%` : null],
          ]}
        />
      </Section>
    </>
  );
}
