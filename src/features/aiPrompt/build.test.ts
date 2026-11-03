import { test } from "node:test";
import assert from "node:assert/strict";
import { compact, roundSig } from "./compact";
import { analysisPromptInput, backtestPromptInput, buildPrompt, optimizerPromptInput, perHorizonBest, summariseTrades } from "./build";

test("compact drops images, summarises long numeric series and keeps scalars", () => {
  const out = compact({
    map: { png: "iVBORw0KGgo".repeat(100), min: 0.123456789 },
    series: Array.from({ length: 500 }, (_, i) => i / 3),
    short: [1, 2, 3],
    rows: Array.from({ length: 100 }, (_, i) => ({ i })),
    name: "AAPL",
    missing: null,
  }) as Record<string, any>;
  assert.equal(out.map.png, "[image omitted]");
  assert.equal(out.map.min, 0.12346);
  assert.equal(out.series.n, 500);
  assert.equal(out.series.max, roundSig(499 / 3));
  assert.equal(out.series.evenly_spaced_sample.length, 24);
  assert.deepEqual(out.short, [1, 2, 3]);
  assert.equal(out.rows.length, 12 + 1 + 4);
  assert.match(out.rows[12], /84 more items omitted \(total 100\)/);
  assert.equal(out.name, "AAPL");
  assert.equal(out.missing, null);
});

const trade = (i: number, ret: number, reason = "tp") => ({
  symbol: "UNH",
  prob: 0.6,
  label: ret > 0 ? 1 : 0,
  decision_ts: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`,
  entry_ts: `2025-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00`,
  exit_ts: "2025-02-01",
  exit_reason: reason,
  status: "closed",
  net_return: ret,
  net_pnl: ret * 1000,
  holding_days: 3,
  bars_held: 3,
});

test("trade summary covers every trade and samples the extremes", () => {
  const trades = Array.from({ length: 60 }, (_, i) => trade(i, (i - 30) / 1000, i < 30 ? "sl" : "tp"));
  const s = summariseTrades(trades);
  assert.equal(s.statistics.closed, 60);
  assert.equal(s.statistics.by_exit_reason.sl.n, 30);
  assert.equal(s.sample.largest_winners[0].net_return, 0.029);
  assert.equal(s.sample.largest_losers[0].net_return, -0.03);
  assert.equal(s.sample.evenly_spaced_others.length, 14);
});

test("backtest prompt explains Convolve, the metrics and the levers, and carries the results", () => {
  const input = backtestPromptInput({
    runId: "abc12345-run",
    summary: {
      methodology: { id: "price_sim_v2", label: "Price-based portfolio simulation" },
      dataset: { symbols: ["UNH"], first_decision: "2025-01-02T00:00:00", last_decision: "2025-06-30T00:00:00" },
      evaluation_class: "independent_test",
      trading_metrics: { total_return: { value: 0.042 } },
      findings: [{ id: "f1", title: "Edge is inconclusive" }],
    },
    metrics: { robustness: { by_year: [] }, threshold_sweep: { rows: [] } },
    equity: { equity: [{ date: "2025-01-02", equity: 10000, drawdown: 0, gross_exposure: 0, n_positions: 0, costs_cum: 0, realized_pnl: 0, unrealized_pnl: 0 }] },
    trades: [trade(1, 0.02)],
    modelMetadata: { generator_config: { horizonBars: 7, takeProfitFraction: 0.02 } },
  });
  const p = buildPrompt(input, "Fewer losing trades");
  for (const needle of [
    "## What Convolve is",
    "validation_locked",
    "## How to read the backtest results",
    "## Settings the user can change for the next run",
    "## Research rules you must respect",
    "independent_test",
    "\"total_return\"",
    "Edge is inconclusive",
    "takeProfitFraction",
    "Fewer losing trades",
    "## What to deliver",
  ]) {
    assert.ok(p.includes(needle), `prompt is missing ${needle}`);
  }
  assert.match(input.runLabel, /UNH · decisions 2025-01-02 → 2025-06-30 · evaluation class: independent_test/);
});

test("legacy backtests are flagged as optimistic", () => {
  const input = backtestPromptInput({ runId: "old", summary: { methodology: { id: "label_payoff_v1" } }, metrics: null, equity: null, trades: null, modelMetadata: null });
  assert.match(buildPrompt(input), /legacy label-payoff/);
});

test("analysis prompt includes each experiment or says it was not run, without images", () => {
  const input = analysisPromptInput({
    sessionId: "s1",
    context: { model: { kind: "trained", id: "run1" }, dataset: { id: "d1", n_images: 400 }, methods: { gradcam: "…" }, baselines: {}, limits: {} },
    jobs: [{ job_id: "j1", kind: "atlas", params: { n: 200 }, status: "succeeded", created_at: 1, result: { mean_map: { png: "x".repeat(1000) }, column_profile: [1, 1.2] } }],
    findings: { findings: [] },
    modelMetadata: null,
  });
  const p = buildPrompt(input);
  assert.ok(p.includes("## How to read the analysis results"));
  assert.ok(p.includes("\"column_profile\""));
  assert.ok(p.includes("\"sensitivity\":\"not run in this session\"") || p.includes("\"sensitivity\": \"not run in this session\""));
  assert.ok(!p.includes("x".repeat(500)));
});

test("optimizer prompt reports the best cell per horizon and top candidates", () => {
  const surface = {
    tp: [1, 2],
    sl: [1, 2],
    horizons: [5, 10],
    label: [
      [[1, 3], [2, null]],
      [[4, 0], [0, 0]],
    ],
    mtm: null,
    best: { tp: 1, sl: 1, h: 10 },
  };
  assert.deepEqual(perHorizonBest(surface)?.map((r) => r.label_payoff_best), [
    { tp: 2, sl: 1, cagr_pct: 3 },
    { tp: 1, sl: 1, cagr_pct: 4 },
  ]);
  const input = optimizerPromptInput({
    runId: "opt1",
    metrics: { symbol: "AAPL" },
    audit: null,
    surface,
    timeseries: null,
    candidates: { periods: { research: { start: "2015-01-01", end: "2022-12-31" }, evaluation: null }, candidates: [{ tp: 2, ranks: { profitability: 1 } }, { tp: 9, ranks: { profitability: 40 } }] },
    runInfo: null,
    conclusion: { headline: "A broad plateau" },
  });
  const p = buildPrompt(input);
  assert.match(input.runLabel, /AAPL · research 2015-01-01 → 2022-12-31 · methodology v2/);
  assert.match(p, /"total_candidates": ?2/);
  assert.ok(p.includes("A broad plateau"));
  assert.ok(p.includes("## How to read the labeling optimizer results"));
});
