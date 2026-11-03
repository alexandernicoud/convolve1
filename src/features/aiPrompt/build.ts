import { compact, sampleRows, toJson } from "./compact";
import { CONVOLVE_CONTEXT, OUTPUT_FORMAT, RESEARCH_RULES, leversSection, promptHeader, toolGlossary, type AiTool } from "./context";

export type PromptSection = { title: string; note?: string; data: unknown };

export type AiPromptInput = {
  tool: AiTool;
  /** One line identifying the run (ids, symbol, dates). */
  runLabel: string;
  sections: PromptSection[];
};

export function buildPrompt(input: AiPromptInput, userNote = ""): string {
  const note = userNote.trim();
  const parts = [
    promptHeader(input.tool),
    note ? `**My goal / question for the next run:** ${note}` : null,
    CONVOLVE_CONTEXT,
    toolGlossary(input.tool),
    leversSection(),
    RESEARCH_RULES,
    `## The results\n\nRun: ${input.runLabel}\n\nLong series are summarised (count, first, last, min, max, mean and an evenly spaced sample) and images are omitted; every other value is as recorded. null means the value was not available.`,
    ...input.sections
      .filter((s) => s.data != null)
      .map((s) => `### ${s.title}\n${s.note ? `\n${s.note}\n` : ""}\n\`\`\`json\n${toJson(s.data)}\n\`\`\``),
    OUTPUT_FORMAT,
  ];
  return parts.filter(Boolean).join("\n\n");
}

// ------------------------------------------------------------------
// Backtester
// ------------------------------------------------------------------

type TradeLike = {
  sample_id?: string;
  symbol: string;
  prob: number;
  label: number | null;
  decision_ts: string;
  entry_ts: string;
  exit_ts: string | null;
  exit_reason: string | null;
  status: string;
  net_return: number | null;
  net_pnl: number | null;
  holding_days: number | null;
  bars_held: number | null;
  costs?: number;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function tradeRow(t: TradeLike) {
  return {
    symbol: t.symbol,
    decision: t.decision_ts?.slice(0, 10),
    entry: t.entry_ts?.slice(0, 10),
    exit: t.exit_ts?.slice(0, 10) ?? null,
    exit_reason: t.exit_reason ?? t.status,
    prob: t.prob,
    label: t.label,
    net_return: t.net_return,
    bars_held: t.bars_held,
  };
}

/** Statistics over the full trade list plus a readable sample (best, worst, evenly spaced). */
export function summariseTrades(trades: TradeLike[]) {
  const closed = trades.filter((t) => t.status === "closed" && t.net_return != null);
  const rets = closed.map((t) => t.net_return as number);
  const byReason: Record<string, { n: number; mean_net_return: number | null }> = {};
  for (const t of closed) {
    const k = t.exit_reason ?? "unknown";
    (byReason[k] ??= { n: 0, mean_net_return: null }).n += 1;
  }
  for (const k of Object.keys(byReason)) byReason[k].mean_net_return = mean(closed.filter((t) => (t.exit_reason ?? "unknown") === k).map((t) => t.net_return as number));
  const labelled = closed.filter((t) => t.label != null);
  const byEntry = [...trades].sort((a, b) => a.entry_ts.localeCompare(b.entry_ts));
  const sorted = [...closed].sort((a, b) => (b.net_return as number) - (a.net_return as number));
  const best = sorted.slice(0, 8);
  const worst = sorted.slice(-8).reverse();
  const picked = new Set([...best, ...worst]);
  const rest = sampleRows(byEntry.filter((t) => !picked.has(t)), 14);
  return {
    statistics: {
      trades: trades.length,
      closed: closed.length,
      open_at_end: trades.length - closed.length,
      mean_net_return: mean(rets),
      median_net_return: median(rets),
      best_net_return: rets.length ? Math.max(...rets) : null,
      worst_net_return: rets.length ? Math.min(...rets) : null,
      mean_bars_held: mean(closed.map((t) => t.bars_held).filter((v): v is number => v != null)),
      by_exit_reason: byReason,
      share_of_trades_with_label_1: labelled.length ? labelled.filter((t) => t.label === 1).length / labelled.length : null,
      mean_prob: mean(trades.map((t) => t.prob)),
      first_entry: byEntry[0]?.entry_ts.slice(0, 10) ?? null,
      last_entry: byEntry[byEntry.length - 1]?.entry_ts.slice(0, 10) ?? null,
    },
    sample: {
      largest_winners: best.map(tradeRow),
      largest_losers: worst.map(tradeRow),
      evenly_spaced_others: rest.map(tradeRow),
    },
  };
}

type EquityLike = { date: string; equity: number; drawdown: number; gross_exposure: number | null; n_positions: number; costs_cum: number; realized_pnl: number; unrealized_pnl: number };

export function backtestPromptInput(args: {
  runId: string;
  summary: Record<string, any>;
  metrics: Record<string, any> | null;
  equity: { equity: EquityLike[] } | null;
  trades: TradeLike[] | null;
  modelMetadata: unknown;
}): AiPromptInput {
  const { runId, summary: s, metrics, equity, trades, modelMetadata } = args;
  const v2 = s.methodology?.id === "price_sim_v2";
  const ds = s.dataset ?? {};
  const runLabel = [
    `backtest ${runId}`,
    v2 ? null : "legacy label-payoff methodology (v1)",
    Array.isArray(ds.symbols) ? ds.symbols.join(", ") : null,
    ds.first_decision && ds.last_decision ? `decisions ${String(ds.first_decision).slice(0, 10)} → ${String(ds.last_decision).slice(0, 10)}` : null,
    s.evaluation_class ? `evaluation class: ${s.evaluation_class}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (!v2) {
    return {
      tool: "backtester",
      runLabel,
      sections: [
        { title: "Backtest summary (legacy v1)", note: "This run used the older label-payoff backtest: trades are booked from the labels, not simulated on prices. Treat its returns as optimistic and recommend rerunning with the current engine.", data: s },
        { title: "Model training metadata", data: modelMetadata },
      ],
    };
  }

  const { findings, ...rest } = s;
  const eq = equity?.equity ?? null;
  return {
    tool: "backtester",
    runLabel,
    sections: [
      { title: "Backtest summary", note: "Methodology, model, dataset, configuration, threshold, leakage audit, trading and classification metrics, benchmarks, diagnostics and warnings.", data: rest },
      {
        title: "Robustness and threshold sweep",
        data: metrics ? { robustness: metrics.robustness, threshold_sweep: metrics.threshold_sweep } : null,
      },
      {
        title: "Equity curve (evenly spaced sample)",
        data: eq
          ? {
              days: eq.length,
              rows: sampleRows(eq, 40).map((r) => ({
                date: r.date,
                equity: r.equity,
                drawdown: r.drawdown,
                gross_exposure: r.gross_exposure,
                n_positions: r.n_positions,
                realized_pnl: r.realized_pnl,
                unrealized_pnl: r.unrealized_pnl,
                costs_cum: r.costs_cum,
              })),
            }
          : null,
      },
      { title: "Trades", note: "Statistics over all trades, then a sample of individual trades. net_return is a fraction (0.02 = +2 %) after commission and slippage.", data: trades ? summariseTrades(trades) : null },
      { title: "Findings (rule-based)", data: findings },
      { title: "Model training metadata", note: "Generator and trainer settings that produced this model.", data: modelMetadata },
    ],
  };
}

// ------------------------------------------------------------------
// Analysis lab
// ------------------------------------------------------------------

type LabJobLike = { job_id: string; kind: string; params: Record<string, unknown>; status: string; created_at: number; finished_at?: number; result?: Record<string, unknown> | null };

export function analysisPromptInput(args: {
  sessionId: string | null;
  context: Record<string, any>;
  jobs: LabJobLike[];
  findings: unknown;
  modelMetadata: unknown;
}): AiPromptInput {
  const { sessionId, context, jobs, findings, modelMetadata } = args;
  const m = context.model ?? {};
  const d = context.dataset;
  const runLabel = [
    `${m.kind ?? "model"} model ${m.id ?? ""}`.trim(),
    d ? `images from dataset ${d.id} (${d.n_images} images)` : "no dataset",
    sessionId ? `lab session ${sessionId}` : "no experiments run yet",
  ].join(" · ");

  const kinds = ["atlas", "sensitivity", "faithfulness", "features", "embedding"];
  const experiments: Record<string, unknown> = {};
  for (const kind of kinds) {
    const latest = jobs.filter((j) => j.kind === kind && j.status === "succeeded" && j.result).sort((a, b) => b.created_at - a.created_at)[0];
    experiments[kind] = latest ? { params: latest.params, result: latest.result } : "not run in this session";
  }
  const { methods, baselines, limits, ...ctx } = context;
  return {
    tool: "analysis",
    runLabel,
    sections: [
      { title: "Model and image context", data: ctx },
      { title: "Method notes", note: "How each attribution method and masking baseline is defined in Convolve.", data: { methods, baselines } },
      { title: "Experiments (latest successful result of each)", note: "params record the sample, filters, layer, target and seed.", data: experiments },
      { title: "Findings (rule-based)", data: findings },
      { title: "Model training metadata", note: "Generator and trainer settings that produced this model.", data: modelMetadata },
    ],
  };
}

// ------------------------------------------------------------------
// Labeling optimizer
// ------------------------------------------------------------------

type SurfaceLike = { tp: number[]; sl: number[]; horizons: number[]; label: (number | null)[][][]; mtm: (number | null)[][][] | null; best: { tp: number; sl: number; h: number } };

function argmax(grid: (number | null)[][] | undefined) {
  let best: { si: number; ti: number; v: number } | null = null;
  grid?.forEach((row, si) => row.forEach((v, ti) => {
    if (v != null && Number.isFinite(v) && (!best || v > best.v)) best = { si, ti, v };
  }));
  return best as { si: number; ti: number; v: number } | null;
}

export function perHorizonBest(surface: SurfaceLike | null) {
  if (!surface) return null;
  return surface.horizons.map((h, hi) => {
    const lab = argmax(surface.label[hi]);
    const mtm = argmax(surface.mtm?.[hi]);
    return {
      h,
      label_payoff_best: lab ? { tp: surface.tp[lab.ti], sl: surface.sl[lab.si], cagr_pct: lab.v } : null,
      market_valued_best: mtm ? { tp: surface.tp[mtm.ti], sl: surface.sl[mtm.si], cagr_pct: mtm.v } : null,
    };
  });
}

export function optimizerPromptInput(args: {
  runId: string;
  metrics: Record<string, any> | null;
  audit: Record<string, any> | null;
  surface: SurfaceLike | null;
  timeseries: Record<string, unknown> | null;
  candidates: Record<string, any> | null;
  runInfo: unknown;
  conclusion: unknown;
}): AiPromptInput {
  const { runId, metrics, audit, surface, timeseries, candidates, runInfo, conclusion } = args;
  const symbol = audit?.symbol ?? metrics?.symbol;
  const periods = candidates?.periods;
  const runLabel = [
    `labeling optimizer run ${runId}`,
    symbol,
    periods?.research ? `research ${periods.research.start} → ${periods.research.end}` : audit ? `${audit.start} → ${audit.end}` : null,
    periods?.evaluation ? `evaluation ${periods.evaluation.start} → ${periods.evaluation.end}` : null,
    candidates ? "methodology v2" : "legacy methodology v1",
  ]
    .filter(Boolean)
    .join(" · ");

  let cand: unknown = null;
  if (candidates && Array.isArray(candidates.candidates)) {
    const list = candidates.candidates as { ranks?: Record<string, number | null>; index?: unknown }[];
    const top = list.filter((c) => Object.values(c.ranks ?? {}).some((r) => r != null && r <= 5)).map(({ index: _i, ...c }) => c);
    const { candidates: _all, ...docs } = candidates;
    cand = { ...docs, total_candidates: list.length, candidates_ranked_top_5_in_any_mode: top };
  }

  return {
    tool: "optimizer",
    runLabel,
    sections: [
      { title: "Conclusion shown on the results page", data: conclusion },
      { title: "Run settings and periods", data: runInfo },
      { title: "Methodology audit", note: "Best cell, exits, market-valued check, buy & hold, robustness, walk-forward holdout, configuration check, defects and the top candidates.", data: audit },
      { title: "Research candidates (methodology v2)", data: cand },
      { title: "Best cell per horizon", note: "Values are CAGR % over the research period.", data: surface ? { tp_grid: surface.tp, sl_grid: surface.sl, horizons: surface.horizons, best: surface.best, per_horizon: perHorizonBest(surface) } : null },
      { title: "Metrics", data: metrics },
      { title: "Best system time series", data: timeseries ? compact(timeseries) : null },
    ],
  };
}
