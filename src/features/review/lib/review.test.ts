import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewDataset, ReviewModel, ReviewOverviewResponse, ReviewRun } from "@/lib/api";
import { classBalance, formatDuration, num, pctFrac, pctUnits } from "./format";
import { datasetName, disambiguate, isOpaqueName, modelName, runName } from "./naming";
import { buildGraph, layoutGraph, lineageOf } from "./graph";
import { compareBacktests, compareModels } from "./compare";

const model = (over: Partial<ReviewModel>): ReviewModel => ({
  id: "20260101_000000_abcdef12",
  source: "trained",
  metadata_available: true,
  ...over,
});

const run = (over: Partial<ReviewRun>): ReviewRun => ({
  id: "r1",
  tool: "backtester",
  status: "succeeded",
  progress: 100,
  stage: "",
  message: "",
  created_at: 1,
  updated_at: 1,
  links: {},
  details: {},
  ...over,
});

test("missing values render as an em dash, never as zero", () => {
  assert.equal(num(undefined), "—");
  assert.equal(num(null), "—");
  assert.equal(num(NaN), "—");
  assert.equal(pctFrac(undefined), "—");
  assert.equal(pctUnits(null), "—");
  assert.equal(formatDuration(null), "—");
  assert.equal(num(0), "0.00");
  assert.equal(pctFrac(0.574), "57.4%");
});

test("class balance shares and empty distributions", () => {
  assert.deepEqual(classBalance(null), []);
  assert.deepEqual(classBalance({ "0": 0 }), []);
  const b = classBalance({ "1": 25, "0": 75 });
  assert.equal(b[0].label, "0");
  assert.equal(b[0].share, 0.75);
});

test("model names derive from metadata; user names win", () => {
  const m = model({ symbols: "aapl", timeframe: "1d", take_profit_fraction: 0.02, stop_loss_fraction: 0.01, horizon_bars: 7 });
  assert.equal(modelName(m).title, "AAPL · 1D · TP2/SL1 · H7 · CNN");
  assert.equal(modelName({ ...m, display_name: "My best" }).title, "My best");
  assert.equal(modelName({ ...m, display_name: "My best" }).derived, "AAPL · 1D · TP2/SL1 · H7 · CNN");
  const bare = modelName(model({ name: "model_20260101_000000_abc.keras", source: "uploaded" }));
  assert.ok(bare.opaque);
  assert.match(bare.title, /^Uploaded CNN /);
  assert.equal(modelName(model({ symbols: "A,B,C,D,E", timeframe: "1h" })).title, "A,B,C+2 · 1H · CNN");
});

test("dataset names keep user-given names and mark archives", () => {
  const base: ReviewDataset = { id: "generated:g1", kind: "training", source: "generated", representation: "archive", symbols: "MSFT", timeframe: "1d" };
  assert.equal(datasetName(base).title, "MSFT · 1D · Training set archive");
  assert.equal(datasetName({ ...base, id: "d1", representation: "extracted", name: "Q3 holdout", kind: "test" }).title, "Q3 holdout · MSFT · 1D");
  assert.ok(isOpaqueName("dataset_20260101_000000_abc"));
  assert.ok(!isOpaqueName("Q3 holdout"));
});

test("run names use linked model titles", () => {
  const titles = new Map([["t1", "AAPL · 1D · CNN"]]);
  assert.equal(runName(run({ links: { trainer_run_id: "t1" }, backtest: { assumptions: {}, symbol: "AAPL" } }), titles).title, "Backtest · AAPL · AAPL · 1D · CNN");
  assert.match(runName(run({ id: "abcdef123456", tool: "analysis" })).title, /^Analysis 123456$/);
});

test("disambiguation appends stable id suffixes only on collision", () => {
  const out = disambiguate(
    [{ id: "aaaa1111" }, { id: "bbbb2222" }, { id: "cccc3333" }],
    (x) => (x.id === "cccc3333" ? "Other" : "Same"),
  );
  assert.equal(out.get("aaaa1111"), "Same · 1111");
  assert.equal(out.get("bbbb2222"), "Same · 2222");
  assert.equal(out.get("cccc3333"), "Other");
});

const overview: Pick<ReviewOverviewResponse, "runs" | "models" | "datasets" | "bots" | "edges"> = {
  runs: [run({ id: "g1", tool: "training-chart-generator" }), run({ id: "t1", tool: "trainer" }), run({ id: "b1", tool: "backtester" }), run({ id: "o1", tool: "labeling-optimizer" })],
  models: [model({ id: "t1" })],
  datasets: [{ id: "generated:g1", kind: "training", source: "generated", representation: "archive" }],
  bots: [],
  edges: [
    { source: "run:g1", target: "dataset:generated:g1", relation: "produced", provenance: "recorded", basis: "x" },
    { source: "dataset:generated:g1", target: "run:t1", relation: "trained_on", provenance: "recovered", basis: "y" },
    { source: "run:t1", target: "model:t1", relation: "produced", provenance: "recorded", basis: "z" },
    { source: "model:t1", target: "run:b1", relation: "backtested", provenance: "recorded", basis: "w" },
    { source: "model:gone", target: "run:b1", relation: "backtested", provenance: "recorded", basis: "v" },
  ],
};

test("graph keeps only reported edges and marks missing endpoints unresolved", () => {
  const g = buildGraph(overview);
  assert.equal(g.edges.length, 5);
  assert.equal(g.nodes.get("model:gone")?.unresolved, true);
  assert.equal(g.nodes.get("dataset:generated:g1")?.kind, "archive");
  assert.equal(g.nodes.get("run:o1")?.kind, "optimizer");
  const lin = lineageOf(g, "model:t1");
  assert.ok(lin.has("run:g1") && lin.has("run:b1"));
  assert.ok(!lin.has("run:o1"), "unconnected runs are not part of a lineage");
});

test("layout places stages left to right without overlap", () => {
  const g = buildGraph(overview);
  const keys = new Set(g.nodes.keys());
  const l = layoutGraph(g, keys);
  assert.equal(l.pos.size, keys.size);
  assert.ok(l.pos.get("run:g1")!.x < l.pos.get("run:t1")!.x);
  assert.ok(l.pos.get("run:t1")!.x < l.pos.get("model:t1")!.x);
  const seen = new Set<string>();
  for (const p of l.pos.values()) {
    const k = `${p.x},${p.y}`;
    assert.ok(!seen.has(k), "nodes overlap");
    seen.add(k);
  }
});

test("backtest comparison warns on differing assumptions and suppresses deltas", () => {
  const a = run({ id: "a", backtest: { assumptions: { commission_pct: 0.1 }, period: { start: "2025-01-01", end: "2025-12-31" }, performance: { return_pct: 5 } } });
  const b = run({ id: "b", backtest: { assumptions: { commission_pct: 0.2 }, period: { start: "2025-01-01", end: "2025-12-31" }, performance: { return_pct: 7 } } });
  const c = compareBacktests([a, b], () => "m");
  assert.equal(c.comparable, false);
  assert.ok(c.warnings.some((w) => w.field === "Commission %"));
  assert.equal(c.rows.find((r) => r.def.key === "return_pct")!.deltas, null);
  assert.ok(!c.rows.some((r) => r.def.key === "sharpe_ratio"), "metrics absent everywhere are omitted, not zero-filled");

  const same = compareBacktests([a, { ...b, backtest: { ...b.backtest!, assumptions: { commission_pct: 0.1 } } }], () => "m");
  assert.equal(same.comparable, true);
  assert.deepEqual(same.rows.find((r) => r.def.key === "return_pct")!.deltas, [null, 2]);
});

test("model comparison separates train and validation metrics", () => {
  const c = compareModels([
    model({ id: "m1", dataset_id: "d1", metrics: { accuracy: 0.9, val_accuracy: 0.6 } }),
    model({ id: "m2", dataset_id: "d2", metrics: { accuracy: 0.8, val_accuracy: 0.62 } }),
  ]);
  const acc = c.rows.filter((r) => r.def.key === "accuracy" || r.def.key === "val_accuracy");
  assert.deepEqual(acc.map((r) => r.def.group), ["Validation set", "Training set (in-sample)"]);
  assert.ok(c.warnings.some((w) => w.field === "Training dataset"));
  assert.equal(c.comparable, false);
});
